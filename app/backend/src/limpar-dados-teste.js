// ============================================================================
// LIMPAR DADOS DE TESTE — Apaga em TODOS os tenants:
//   pedidos, pedido_itens, pedido_timeline, mensagens_pedido, pagamentos,
//   webhook_events, clientes, entregadores, restaurante_users, refresh_tokens
//
// NÃO apaga: cardápio (produtos, categorias, produtos_extras), raios_entrega,
//            mesas, banners, restaurantes.
//
// ⚠️ DESTRUTIVO — rode apenas quando tiver certeza.
//
// Uso: node src/limpar-dados-teste.js
// ============================================================================

import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  host: process.env.DB_HOST || '86.48.18.22',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'delivery',
  user: process.env.DB_USER || 'default',
  password: process.env.DB_PASS || 'default',
  max: 1,
  query_timeout: 60000,
});

// Tabelas apagadas (ordem FK-safe) + suas sequences
const TABELAS = [
  { tabela: 'webhook_events', seq: 'webhook_events_id_seq' },
  { tabela: 'mensagens_pedido', seq: 'mensagens_pedido_id_seq' },
  { tabela: 'pedido_timeline', seq: 'pedido_timeline_id_seq' },
  { tabela: 'pedido_itens', seq: 'pedido_itens_id_seq' },
  { tabela: 'pagamentos', seq: 'pagamentos_id_seq' },
  { tabela: 'pedidos', seq: 'pedidos_id_seq' },
  { tabela: 'clientes', seq: 'clientes_id_seq' },
  { tabela: 'entregadores', seq: 'entregadores_id_seq' },
  { tabela: 'restaurante_users', seq: 'restaurante_users_id_seq' },
  { tabela: 'refresh_tokens', seq: 'refresh_tokens_id_seq' },
];

async function main() {
  console.log('\n🧹 Limpando dados de teste (TODOS os tenants)...\n');

  // Em alguns setups o papel do banco é o dono das tabelas e já ignora RLS;
  // se não for, tenta desabilitar RLS na sessão (só funciona p/ owner/superuser).
  try {
    await pool.query('SET row_security = off');
    console.log('ℹ️  RLS desabilitado na sessão (owner/superuser).');
  } catch {
    console.log('ℹ️  RLS permanece ativo (sem permissão p/ row_security=off).');
  }

  // ─── ANTES ───
  console.log('📊 ANTES:');
  for (const { tabela } of TABELAS) {
    const r = await pool.query(`SELECT COUNT(*) AS total FROM ${tabela}`);
    console.log(`  ${tabela}: ${r.rows[0].total}`);
  }

  // ─── DELETAR (ordem FK-safe) ───
  console.log('\n🗑️  Deletando...');
  for (const { tabela } of TABELAS) {
    const r = await pool.query(`DELETE FROM ${tabela}`);
    console.log(`  ✅ ${tabela}: ${r.rowCount} registro(s) removido(s)`);
  }

  // ─── RESETAR SEQUENCES ───
  console.log('\n🔁 Resetando sequences...');
  for (const { tabela, seq } of TABELAS) {
    try {
      await pool.query(
        `SELECT setval('${seq}', (SELECT COALESCE(MAX(id), 0) FROM ${tabela}))`
      );
    } catch (err) {
      console.warn(`  ⚠️  ${seq}: ${err.message}`);
    }
  }

  // ─── DEPOIS ───
  console.log('\n📊 DEPOIS:');
  for (const { tabela } of TABELAS) {
    const r = await pool.query(`SELECT COUNT(*) AS total FROM ${tabela}`);
    console.log(`  ${tabela}: ${r.rows[0].total}`);
  }

  // ─── VERIFICAR O QUE FOI MANTIDO ───
  console.log('\n✅ MANTIDO (cardápio e config):');
  for (const tabela of ['restaurantes', 'categorias', 'produtos', 'produtos_extras', 'raios_entrega', 'mesas', 'banners']) {
    const r = await pool.query(`SELECT COUNT(*) AS total FROM ${tabela}`);
    console.log(`  ${tabela}: ${r.rows[0].total}`);
  }

  await pool.end();
  console.log('\n✅ Limpeza concluída! Rode agora o seed para recriar os usuários padrão.');
}

main().catch((err) => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
