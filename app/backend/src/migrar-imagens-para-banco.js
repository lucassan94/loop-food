// ============================================================================
// Migrar imagens para o BANCO (tabela imagens, BYTEA)
// ============================================================================
// 1. Lê imagens do DISCO ({UPLOAD_DIR}/{tenantId}/{tipo}/{filename}) referenciadas
//    por imagem_url/foto_url e insere na tabela imagens.
// 2. Lê produtos/banners com imagem_base64 (coluna) e insere na tabela imagens,
//    atualizando imagem_url e limpando imagem_base64.
//
// Uso: node src/migrar-imagens-para-banco.js
//       node src/migrar-imagens-para-banco.js --tenant=5
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { getTenantUploadDir, getTenantUploadUrl, detectMimeFromBase64 } from './config/upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_HOST = process.env.DB_HOST || '86.48.18.22';
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const DB_NAME = process.env.DB_NAME || 'delivery';
const DB_USER = process.env.DB_ADMIN_USER || process.env.DB_USER || 'default';
const DB_PASS = process.env.DB_ADMIN_PASS || process.env.DB_PASS || 'default';

// Aceitar --tenant=X como argumento opcional
const TENANT_ID = (() => {
  const idx = process.argv.findIndex(a => a.startsWith('--tenant='));
  if (idx >= 0) return parseInt(process.argv[idx].split('=')[1]);
  return null;
})();

// UPLOAD_DIR padrão (mesmo default do config)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

const pool = new pg.Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASS,
  max: 1,
  query_timeout: 60000,
});

const TIPOS = ['cardapio', 'banners', 'entregadores', 'categorias', 'logos'];

async function upsertImagem(tenantId, tipo, filename, buffer, mime) {
  // RLS exige o contexto do tenant na sessão
  await pool.query(`SET app.restaurant_id = ${tenantId}`);
  await pool.query(
    `INSERT INTO imagens (restaurant_id, tipo, filename, mime, dados, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (restaurant_id, tipo, filename)
     DO UPDATE SET dados = EXCLUDED.dados, mime = EXCLUDED.mime, atualizado_em = now()`,
    [tenantId, tipo, filename, mime, buffer]
  );
}

// ─── Passo 1: disco → banco (imagens referenciadas por URL) ───
async function migrarDoDisco() {
  const where = TENANT_ID ? 'AND restaurant_id = ' + TENANT_ID : '';
  const result = await pool.query(
    `SELECT id, restaurant_id, imagem_url, nome, 'produto' as tipo_registro
     FROM produtos WHERE imagem_url LIKE '/uploads/%' ${where}
     UNION ALL
     SELECT id, restaurant_id, imagem_url, COALESCE(titulo,'banner'), 'banner'
     FROM banners WHERE imagem_url LIKE '/uploads/%' ${where}`
  );

  let ok = 0, erros = 0;
  for (const row of result.rows) {
    // /uploads/{tenantId}/{tipo}/{filename}
    const m = row.imagem_url.match(/^\/uploads\/(\d+)\/([a-z]+)\/([^/]+)$/);
    if (!m) { erros++; continue; }
    const [, tenantId, tipo, filename] = m;
    if (!TIPOS.includes(tipo)) { erros++; continue; }

    const filePath = path.join(getTenantUploadDir(tenantId, tipo), filename);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⏩ [T${tenantId}] ${tipo}/${filename} não está no disco (pular)`);
      continue;
    }
    try {
      const buffer = fs.readFileSync(filePath);
      const mime = detectMimeFromBase64(buffer.toString('base64')) || 'image/jpeg';
      await upsertImagem(tenantId, tipo, filename, buffer, mime);
      console.log(`  ✅ [T${tenantId}] ${tipo}/${filename} (${(buffer.length/1024).toFixed(1)} KB)`);
      ok++;
    } catch (err) {
      console.error(`  ❌ [T${tenantId}] ${tipo}/${filename}: ${err.message}`);
      erros++;
    }
  }
  console.log(`\n📦 Disco → banco: ${ok} migradas, ${erros} erros.\n`);
  return ok + erros;
}

// ─── Passo 2: base64 em colunas → banco ───
async function migrarBase64Colunas() {
  const where = TENANT_ID ? 'AND restaurant_id = ' + TENANT_ID : '';
  const result = await pool.query(
    `SELECT id, restaurant_id, imagem_base64, nome, 'produto' as tipo_registro FROM produtos
     WHERE imagem_base64 IS NOT NULL AND imagem_base64 != '' ${where}
     UNION ALL
     SELECT id, restaurant_id, imagem_base64, COALESCE(titulo,'banner'), 'banner' FROM banners
     WHERE imagem_base64 IS NOT NULL AND imagem_base64 != '' ${where}`
  );

  let ok = 0, erros = 0;
  for (const row of result.rows) {
    const b64 = row.imagem_base64;
    if (!b64 || b64.length < 50) { continue; }
    const tenantId = row.restaurant_id;
    const tipoRegistro = row.tipo_registro; // 'produto' | 'banner'
    const tipo = tipoRegistro === 'banner' ? 'banners' : 'cardapio';
    const tabela = tipoRegistro === 'banner' ? 'banners' : 'produtos';
    const colunaNome = tipoRegistro === 'banner' ? 'titulo' : 'nome';
    const nome = String(row.nome || 'imagem').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 50) || 'imagem';
    const mimeDetect = detectMimeFromBase64(b64);
    const ext = mimeDetect === 'image/png' ? 'png'
      : mimeDetect === 'image/gif' ? 'gif'
      : mimeDetect === 'image/webp' ? 'webp'
      : mimeDetect === 'image/svg+xml' ? 'svg' : 'jpg';
    // Prefixo com tipo evita colisão de filename entre produto e banner de mesmo id
    const filename = `${tipoRegistro}_${row.id}_${nome}.${ext}`;
    try {
      const buffer = Buffer.from(b64, 'base64');
      const mime = mimeDetect;
      await upsertImagem(tenantId, tipo, filename, buffer, mime);
      // Atualizar referência na coluna certa e limpar base64
      await pool.query(
        `UPDATE ${tabela} SET imagem_url = $1, imagem_base64 = '' WHERE id = $2 AND imagem_base64 = $3`,
        [getTenantUploadUrl(tenantId, tipo, filename), row.id, b64]
      );
      console.log(`  ✅ [T${tenantId}] ${tipoRegistro} ${row.id}: ${filename} (${(buffer.length/1024).toFixed(1)} KB)`);
      ok++;
    } catch (err) {
      console.error(`  ❌ ${tipoRegistro} ${row.id}: ${err.message}`);
      erros++;
    }
  }
  console.log(`\n📦 Base64 (colunas) → banco: ${ok} migradas, ${erros} erros.\n`);
  return ok + erros;
}

async function main() {
  console.log(`🔍 Migrando imagens para o banco (${TENANT_ID ? 'tenant ' + TENANT_ID : 'TODOS os tenants'})...\n`);
  const disco = await migrarDoDisco();
  const colunas = await migrarBase64Colunas();
  console.log(`\n📊 TOTAL: ${disco + colunas} imagens processadas.`);
  await pool.end();
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
