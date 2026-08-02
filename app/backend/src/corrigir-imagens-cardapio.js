// ============================================================================
// Corrigir imagens do cardápio — formato multi-tenant
// ============================================================================
// PROBLEMA:
//   Os produtos têm imagem_url = "/uploads/cardapio/13_foto.jpg" (formato antigo,
//   sem tenantId) e os arquivos estão em {UPLOAD_DIR}/cardapio/. A rota atual do
//   backend (serveUploadFile, CWE-22) exige /uploads/{tenantId}/cardapio/{filename}.
//
// ESTE SCRIPT:
//   1. Lê produtos com imagem_url no formato antigo "/uploads/cardapio/%"
//   2. Move o arquivo de {UPLOAD_DIR}/cardapio/ → {UPLOAD_DIR}/{tenantId}/cardapio/
//      (procura variantes sem prefixo "{id}_" se o nome exato não existir)
//   3. Atualiza imagem_url no banco para /uploads/{tenantId}/cardapio/{filename}
//
// Uso: node src/corrigir-imagens-cardapio.js
//      node src/corrigir-imagens-cardapio.js --tenant=1   (opcional)
//      node src/corrigir-imagens-cardapio.js --dry-run     (não altera nada)
// ============================================================================

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { getTenantUploadDir, getTenantUploadUrl, getUploadBaseDir } from './config/upload.js';

const DB_HOST = process.env.DB_HOST || '86.48.18.22';
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const DB_NAME = process.env.DB_NAME || 'delivery';
const DB_USER = process.env.DB_USER || 'default';
const DB_PASS = process.env.DB_PASS || 'default';

const TENANT_ID = (() => {
  const idx = process.argv.findIndex(a => a.startsWith('--tenant='));
  if (idx >= 0) return parseInt(process.argv[idx].split('=')[1]);
  return null;
})();

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new pg.Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASS,
  max: 1,
  query_timeout: 60000,
});

async function main() {
  const tenantFilter = TENANT_ID ? `AND restaurant_id = ${TENANT_ID}` : '';
  console.log(`🔍 Buscando produtos com imagem_url no formato antigo (/uploads/cardapio/)...`);
  console.log(`   ${DRY_RUN ? '🧪 MODO DRY-RUN (nada será alterado)' : '✏️ MODO EXECUÇÃO'}\n`);

  const result = await pool.query(
    `SELECT id, nome, restaurant_id, imagem_url
     FROM produtos
     WHERE imagem_url LIKE '/uploads/cardapio/%'
       ${tenantFilter}
     ORDER BY restaurant_id, id`
  );

  console.log(`📦 Encontrados ${result.rows.length} produtos no formato antigo\n`);

  let migrados = 0;
  let semArquivo = 0;
  let erros = 0;
  const tenantsAfetados = new Set();

  for (const produto of result.rows) {
    const { id, nome, restaurant_id: tenantId } = produto;
    const oldUrl = produto.imagem_url;
    const filename = path.basename(oldUrl); // ex: 13_foto.jpg

    // 1. Localizar arquivo de origem (nome exato ou variante sem prefixo "{id}_")
    const origemExata = path.join(getUploadBaseDir(), 'cardapio', filename);
    const variante = path.join(getUploadBaseDir(), 'cardapio', filename.replace(/^\d+_/, ''));
    let origem = fs.existsSync(origemExata) ? origemExata : null;
    if (!origem && fs.existsSync(variante)) origem = variante;

    if (!origem) {
      console.log(`  ❌ [T${tenantId}] ID ${id} "${nome}": arquivo NÃO encontrado (${filename})`);
      semArquivo++;
      continue;
    }

    // 2. Destino tenant-aware
    const destDir = getTenantUploadDir(tenantId, 'cardapio');
    const destFilename = origem === origemExata ? filename : path.basename(origem);
    const destino = path.join(destDir, destFilename);
    const novaUrl = getTenantUploadUrl(tenantId, 'cardapio', destFilename);

    try {
      if (!DRY_RUN) {
        fs.mkdirSync(destDir, { recursive: true });
        if (fs.existsSync(destino) && destino !== origem) {
          fs.unlinkSync(destino); // remove duplicado antes do rename
        }
        fs.renameSync(origem, destino);
        await pool.query(
          `UPDATE produtos SET imagem_url = $1 WHERE id = $2`,
          [novaUrl, id]
        );
      }
      tenantsAfetados.add(tenantId);
      migrados++;
      console.log(`  ✅ [T${tenantId}] ID ${id} "${nome}" → ${novaUrl}`);
    } catch (err) {
      console.error(`  ❌ ID ${id} "${nome}": ${err.message}`);
      erros++;
    }
  }

  console.log(`\n📊 RESULTADO:`);
  console.log(`   ✅ Migrados: ${migrados}`);
  console.log(`   ❌ Sem arquivo: ${semArquivo}`);
  console.log(`   ❌ Erros: ${erros}`);
  console.log(`   🏪 Tenants afetados: ${[...tenantsAfetados].join(', ') || 'nenhum'}`);
  console.log(DRY_RUN ? '\n✅ DRY-RUN concluído (nenhuma alteração feita).' : '\n✅ Correção concluída!');

  await pool.end();
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
