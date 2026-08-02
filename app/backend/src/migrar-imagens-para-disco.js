// ============================================================================
// Migrar imagens base64 do banco para arquivos no disco (multi-tenant)
// ============================================================================
// Este script:
// 1. Lê todos os produtos com imagem_base64 (de todos os tenants)
// 2. Salva as imagens como arquivos em /uploads/{tenantId}/cardapio/
// 3. Atualiza imagem_url no banco para o caminho do arquivo
// 4. Limpa imagem_base64 (opcional)
//
// Uso: node src/migrar-imagens-para-disco.js
//       node src/migrar-imagens-para-disco.js --tenant=5
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { getTenantUploadDir, getTenantUploadUrl } from './config/upload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_HOST = process.env.DB_HOST || '86.48.18.22';
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const DB_NAME = process.env.DB_NAME || 'delivery';
const DB_USER = process.env.DB_USER || 'default';
const DB_PASS = process.env.DB_PASS || 'default';

// Aceitar --tenant=X como argumento opcional
const TENANT_ID = (() => {
  const idx = process.argv.findIndex(a => a.startsWith('--tenant='));
  if (idx >= 0) return parseInt(process.argv[idx].split('=')[1]);
  return null; // Todos os tenants
})();

const pool = new pg.Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASS,
  max: 1,
  query_timeout: 60000, // 60s para queries grandes
});

function detectFileExtension(base64) {
  if (!base64) return 'jpg'
  if (base64.startsWith('/9j/')) return 'jpg'
  if (base64.startsWith('iVBORw0KGgo')) return 'png'
  if (base64.startsWith('R0lGOD')) return 'gif'
  if (base64.startsWith('UklGR')) return 'webp'
  try {
    const decoded = Buffer.from(base64.substring(0, 20), 'base64').toString()
    if (decoded.startsWith('<svg')) return 'svg'
  } catch {}
  return 'jpg'
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 60)
}

async function main() {
  const tenantFilter = TENANT_ID ? `restaurant_id = ${TENANT_ID}` : '1=1';
  const tenantLabel = TENANT_ID ? `tenant ${TENANT_ID}` : 'TODOS os tenants';
  console.log(`🔍 Buscando produtos com imagem_base64 (${tenantLabel})...\n`)

  // Buscar produtos com imagem_base64
  const result = await pool.query(
    `SELECT id, nome, preco, restaurant_id, imagem_base64, imagem_url
     FROM produtos
     WHERE imagem_base64 IS NOT NULL AND imagem_base64 != ''
       AND ${tenantFilter}
     ORDER BY restaurant_id ASC, id ASC`
  )

  console.log(`📦 Encontrados ${result.rows.length} produtos com imagem base64\n`)

  let migrados = 0
  let erros = 0
  let ignorados = 0
  const tenantsAfetados = new Set()

  for (const produto of result.rows) {
    const b64 = produto.imagem_base64
    if (!b64 || b64.length < 50) {
      console.log(`  ⏩ ID ${produto.id} "${produto.nome}": base64 muito curto, ignorando`)
      ignorados++
      continue
    }

    try {
      const tenantId = produto.restaurant_id || 1
      tenantsAfetados.add(tenantId)

      // Determinar extensão
      const ext = detectFileExtension(b64)
      const nomeArquivo = `${produto.id}_${slugify(produto.nome)}.${ext}`

      // Diretório tenant-aware (usa o helper do upload.js para consistência)
      const tenantDir = getTenantUploadDir(tenantId, 'cardapio')
      if (!fs.existsSync(tenantDir)) {
        fs.mkdirSync(tenantDir, { recursive: true })
      }
      const caminhoArquivo = path.join(tenantDir, nomeArquivo)
      const urlRelativa = getTenantUploadUrl(tenantId, 'cardapio', nomeArquivo)

      // Decodificar base64 e salvar
      const buffer = Buffer.from(b64, 'base64')
      fs.writeFileSync(caminhoArquivo, buffer)

      // Verificar tamanho
      const stats = fs.statSync(caminhoArquivo)
      const tamanhoKB = (stats.size / 1024).toFixed(1)

      // Atualizar banco: imagem_url = novo caminho, imagem_base64 = null
      await pool.query(
        `UPDATE produtos SET imagem_url = $1, imagem_base64 = NULL
         WHERE id = $2`,
        [urlRelativa, produto.id]
      )

      console.log(`  ✅ [T${tenantId}] ID ${produto.id} "${produto.nome}": ${nomeArquivo} (${tamanhoKB} KB)`)
      migrados++
    } catch (err) {
      console.error(`  ❌ ID ${produto.id} "${produto.nome}": ${err.message}`)
      erros++
    }
  }

  console.log(`\n📊 RESULTADO:`)
  console.log(`   ✅ Migrados: ${migrados}`)
  console.log(`   ⏩ Ignorados: ${ignorados}`)
  console.log(`   ❌ Erros: ${erros}`)
  console.log(`   🏪 Tenants afetados: ${[...tenantsAfetados].join(', ')}`)

  await pool.end()
  console.log('\n✅ Migração concluída!')
}

main().catch(err => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
