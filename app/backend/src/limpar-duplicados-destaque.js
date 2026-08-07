// ============================================================================
// Limpeza: cópias duplicadas em 'Em Destaque' (tenant 1 — Palazzo)
// ============================================================================
// Remove as cópias de 'Em Destaque' dos 5 pratos que também existem na sua
// categoria normal, mantendo a cópia da categoria (preço/navegação corretos):
//   - 13 Medalhão de Filé Mignon ao Molho Gorgonzola  (mantém id 22)
//   - 14 Ancho Grelhado com Salada de Batata          (mantém id 27)
//   - 15 Filé Mignon à Parmegiana com Catupiry        (mantém id 20)
//   - 17 Lasanha de costela com Molho Branco e Pomodoro (mantém id 21)
//   - 18 Salada Caesar com Frango                     (mantém id 29)
// Também remove as imagens órfãs dessas cópias na tabela `imagens`.
//
// Segurança:
//   - Apenas remove se existir a duplicata na categoria normal (anti-drift).
//   - pedido_itens.produto_id é ON DELETE SET NULL — histórico preservado
//     (snapshot de nome/preço no item).
//   - Roda em transação única e define app.restaurant_id = 1 (RLS).
//   - Idempotente: re-executar não remove nada.
//
// Uso: node src/limpar-duplicados-destaque.js
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

// Cópias de 'Em Destaque' a remover → cópia da categoria normal que permanece
const PARES = [
  { destId: 13, normalId: 22 },
  { destId: 14, normalId: 27 },
  { destId: 15, normalId: 20 },
  { destId: 17, normalId: 21 },
  { destId: 18, normalId: 29 },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('SET app.restaurant_id = 1');
    await client.query('BEGIN');

    // ── Pré-checagem: confirmar que cada par existe como esperado ──
    const destIds = PARES.map(p => p.destId);
    const normalIds = PARES.map(p => p.normalId);
    const checagem = await client.query(
      `SELECT id, nome, preco, imagem_url,
              (SELECT c.slug FROM categorias c WHERE c.id = p.categoria_id) AS cat_slug,
              (SELECT COUNT(*) FROM pedido_itens pi WHERE pi.produto_id = p.id)::int AS n_pedidos
       FROM produtos p WHERE p.id = ANY($1) ORDER BY id`,
      [[...destIds, ...normalIds]]
    );
    console.log('Pré-checagem dos produtos envolvidos:');
    console.table(checagem.rows);

    const porId = new Map(checagem.rows.map(r => [r.id, r]));
    let erro = null;
    for (const { destId, normalId } of PARES) {
      const d = porId.get(destId);
      const n = porId.get(normalId);
      if (!d) { erro = `Cópia de destaque ${destId} não encontrada`; break; }
      if (!n) { erro = `Cópia normal ${normalId} não encontrada`; break; }
      if ((d.cat_slug || '') !== 'destaques') { erro = `Produto ${destId} (${d.nome}) não está em Em Destaque`; break; }
      if (d.nome !== n.nome) { erro = `Nomes divergentes: ${destId}="${d.nome}" vs ${normalId}="${n.nome}"`; break; }
    }
    if (erro) throw new Error(`ABORTADO: ${erro}`);

    // ── Imagens órfãs das cópias de destaque (filenames derivados do imagem_url) ──
    const filenames = checagem.rows
      .filter(r => destIds.includes(r.id))
      .map(r => r.imagem_url ? r.imagem_url.split('/').pop() : null)
      .filter(Boolean);
    console.log('\n📸 Imagens órfãs a remover:');
    console.table(filenames.map(f => ({ filename: f })));
    const delImg = await client.query(
      `DELETE FROM imagens
       WHERE restaurant_id = 1 AND tipo = 'cardapio' AND filename = ANY($1)`,
      [filenames]
    );
    console.log(`🗑️  Imagens removidas: ${delImg.rowCount}`);

    // ── Remover as cópias de 'Em Destaque' ──
    const delProd = await client.query(
      'DELETE FROM produtos WHERE id = ANY($1) AND restaurant_id = 1',
      [destIds]
    );
    console.log(`🗑️  Produtos de destaque removidos: ${delProd.rowCount}`);

    await client.query('COMMIT');

    // ── Resumo pós-limpeza ──
    console.log('\n══════════ RESUMO PÓS-LIMPEZA ══════════');
    const after = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM produtos WHERE restaurant_id = 1) AS produtos_t1,
        (SELECT COUNT(*) FROM produtos p JOIN categorias c ON c.id = p.categoria_id
          WHERE p.restaurant_id = 1 AND c.slug = 'destaques') AS em_destaque,
        (SELECT COUNT(*) FROM produtos WHERE id = ANY($1)) AS copias_destaque_restantes,
        (SELECT COUNT(*) FROM produtos WHERE id = ANY($2)) AS copias_normais_restantes
    `, [destIds, normalIds]);
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
