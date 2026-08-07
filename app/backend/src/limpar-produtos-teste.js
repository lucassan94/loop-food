// ============================================================================
// Limpeza: produtos fake/teste do cardápio (tenant 1 — Palazzo)
// ============================================================================
// Remove:
//   1. Produtos de teste: 'Dbg3 1785805651' (124), 'Produto Teste UI 22562' (111),
//      'Teste' (56, 58) — todos com 0 pedidos.
//   2. Imagens órfãs desses produtos na tabela `imagens` (56_teste.svg, 58_teste.svg).
//   3. Categorias de teste do tenant 1 (slug 'cat-ui-%').
//
// NÃO remove: produtos do seed (X-Burguer etc.), duplicados Em Destaque×categoria,
// tenant 2 (SaborExpress).
//
// Segurança:
//   - Aborta se qualquer produto alvo tiver histórico em pedido_itens.
//   - Roda em transação única (tudo ou nada).
//   - Define app.restaurant_id = 1 (padrão dos scripts de seed) para respeitar RLS.
//   - Idempotente: re-executar não remove nada além dos alvos já definidos.
//
// Uso: node src/limpar-produtos-teste.js
// ============================================================================
import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({
  host: process.env.DB_HOST || '86.48.18.22',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'delivery',
  user: process.env.DB_ADMIN_USER || process.env.DB_USER || 'default',
  password: process.env.DB_ADMIN_PASS || process.env.DB_PASS || 'default',
  max: 1,
});

const PRODUTOS_TESTE = [124, 111, 56, 58];

async function run() {
  const client = await pool.connect();
  try {
    await client.query("SET app.restaurant_id = 1");
    await client.query('BEGIN');

    // ── Pré-checagem DENTRO da transação: produtos alvo não podem ter pedidos ──
    const check = await client.query(
      `SELECT p.id, p.nome,
              (SELECT COUNT(*) FROM pedido_itens pi WHERE pi.produto_id = p.id) AS n_pedidos
       FROM produtos p
       WHERE p.id = ANY($1) AND p.restaurant_id = 1
       ORDER BY p.id`,
      [PRODUTOS_TESTE]
    );
    console.log('Pré-checagem dos produtos alvo:');
    console.table(check.rows);
    const comPedido = check.rows.filter(r => parseInt(r.n_pedidos) > 0);
    if (comPedido.length > 0) {
      throw new Error(`ABORTADO: ${comPedido.length} produto(s) com pedidos!`);
    }

    // ── 1. Remover produtos de teste (extras/opções/subcategorias em cascata) ──
    const delProd = await client.query(
      'DELETE FROM produtos WHERE id = ANY($1) AND restaurant_id = 1',
      [PRODUTOS_TESTE]
    );
    console.log(`\n🗑️  Produtos removidos: ${delProd.rowCount}`);

    // ── 2. Remover imagens órfãs (56_teste.svg, 58_teste.svg) ──
    const delImg = await client.query(
      `DELETE FROM imagens
       WHERE restaurant_id = 1 AND tipo = 'cardapio'
         AND filename IN ('56_teste.svg', '58_teste.svg')`
    );
    console.log(`🗑️  Imagens removidas: ${delImg.rowCount}`);

    // ── 3. Remover categorias de teste (slug 'cat-ui-%') ──
    const catInfo = await client.query(`
      SELECT c.id, c.nome, c.slug, COUNT(p.id)::int AS n_produtos
      FROM categorias c
      LEFT JOIN produtos p ON p.categoria_id = c.id AND p.restaurant_id = 1
      WHERE c.restaurant_id = 1 AND c.slug LIKE 'cat-ui-%'
      GROUP BY c.id, c.nome, c.slug
      ORDER BY c.ordem, c.nome`);
    console.log(`\n📂 Categorias de teste a remover (${catInfo.rows.length}):`);
    console.table(catInfo.rows);

    const delCat = await client.query(
      'DELETE FROM categorias WHERE id = ANY($1)',
      [catInfo.rows.map(c => c.id)]
    );
    console.log(`🗑️  Categorias removidas: ${delCat.rowCount}`);

    await client.query('COMMIT');

    // ── Resumo pós-limpeza ──
    console.log('\n══════════ RESUMO PÓS-LIMPEZA ══════════');
    const after = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM produtos WHERE restaurant_id = 1) AS produtos_t1,
        (SELECT COUNT(*) FROM categorias WHERE restaurant_id = 1) AS categorias_t1,
        (SELECT COUNT(*) FROM produtos WHERE restaurant_id = 2) AS produtos_t2,
        (SELECT COUNT(*) FROM produtos WHERE id = ANY($1)) AS restantes_teste,
        (SELECT COUNT(*) FROM imagens WHERE restaurant_id = 1 AND tipo = 'cardapio') AS imagens_t1
    `, [PRODUTOS_TESTE]);
    console.table(after.rows);
    console.log('✅ Limpeza concluída!\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Erro:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
