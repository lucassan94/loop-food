// ============================================================================
// Seed Multi-Tenant — Configura Tenant 2 e atualiza Tenant 1
// ============================================================================
// Este script:
//   1. Atualiza o tenant existente (id=1, Palazzo) com slug/domínio real
//   2. Cria um novo tenant (id=2, SaborExpress)
//   3. Popula dados de teste no tenant 2 (admin, categorias, produtos, etc.)
//
// Uso: DB_HOST=86.48.18.22 node src/seed-tenant2.js
// ============================================================================

import crypto from 'crypto';
import bcrypt from 'bcrypt';
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

async function seedTenant2() {
  console.log('\n🌱 Multi-Tenant Seed\n');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ─── 1. ATUALIZAR TENANT 1 (Palazzo) ───
    console.log('📌 Atualizando Tenant 1 (Palazzo)...');
    
    // Gerar JWT secret para tenant 1 se não existir
    const jwt1 = crypto.randomBytes(32).toString('hex');
    const up1 = await client.query(
      `UPDATE restaurantes SET
         slug = COALESCE(NULLIF(slug, ''), 'palazzomooca'),
         dominio = COALESCE(NULLIF(dominio, ''), 'palazzomooca'),
         nome = COALESCE(NULLIF(nome, ''), 'Palazzo'),
         rede_env = COALESCE(rede_env, 'sandbox'),
         jwt_secret = COALESCE(jwt_secret, $1),
         config = '{}'::jsonb,
         atualizado_em = NOW()
       WHERE id = 1
       RETURNING id, slug, jwt_secret IS NOT NULL as tem_jwt`,
      [jwt1]
    );
    if (up1.rows[0]?.tem_jwt) {
      console.log('   ✅ Tenant 1 atualizado: palazzomooca (JWT secret gerado)');
    } else {
      console.log('   ⏩ Tenant 1 já configurado');
    }

    // ─── 2. CRIAR TENANT 2 (SaborExpress) ───
    console.log('\n📌 Criando Tenant 2 (SaborExpress)...');

    const tenantExists = await client.query('SELECT id FROM restaurantes WHERE slug = $1', ['saborexpress']);
    
    let tenant2Id;
    if (tenantExists.rows.length > 0) {
      tenant2Id = tenantExists.rows[0].id;
      // Garantir que o tenant existente tenha coordenadas + JWT secret
      const jwt2 = crypto.randomBytes(32).toString('hex');
      await client.query(
        `UPDATE restaurantes SET
           latitude = COALESCE(latitude, -23.5505),
           longitude = COALESCE(longitude, -46.6333),
           jwt_secret = COALESCE(jwt_secret, $1),
           atualizado_em = NOW()
         WHERE id = $2 AND (latitude IS NULL OR longitude IS NULL OR jwt_secret IS NULL)`,
        [jwt2, tenant2Id]
      );
      console.log(`   ⏩ Tenant 2 já existe (id=${tenant2Id}), coordenadas + JWT verificados`);
    } else {
      const jwt2 = crypto.randomBytes(32).toString('hex');
      const result = await client.query(
        `INSERT INTO restaurantes (nome, slug, dominio, rede_env, status_loja, tempo_preparo_min, latitude, longitude, jwt_secret, config)
         VALUES ('SaborExpress', 'saborexpress', 'saborexpress', 'sandbox', true, 20, -23.5505, -46.6333, $1, '{}'::jsonb)
         RETURNING id`,
        [jwt2]
      );
      tenant2Id = result.rows[0].id;
      console.log(`   ✅ Tenant 2 criado (id=${tenant2Id}) com JWT secret`);
    }

    // ─── 3. CATEGORIAS para Tenant 2 ───
    console.log('\n📌 Criando categorias para Tenant 2...');
    
    const categorias = [
      { nome: 'Em Destaque', slug: 'destaques', ordem: 0 },
      { nome: 'Burguers', slug: 'burguers', ordem: 1 },
      { nome: 'Pizzas', slug: 'pizzas', ordem: 2 },
      { nome: 'Bebidas', slug: 'bebidas', ordem: 3 },
      { nome: 'Sobremesas', slug: 'sobremesas', ordem: 4 },
      { nome: 'Porções', slug: 'porcoes', ordem: 5 },
    ];

    const catMap = {};
    for (const cat of categorias) {
      const existing = await client.query(
        'SELECT id FROM categorias WHERE slug = $1 AND restaurant_id = $2',
        [cat.slug, tenant2Id]
      );
      if (existing.rows.length > 0) {
        catMap[cat.slug] = existing.rows[0].id;
      } else {
        const r = await client.query(
          `INSERT INTO categorias (restaurant_id, nome, slug, ordem)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [tenant2Id, cat.nome, cat.slug, cat.ordem]
        );
        catMap[cat.slug] = r.rows[0].id;
      }
    }
    console.log(`   ✅ ${Object.keys(catMap).length} categorias criadas/verificadas`);

    // ─── 4. PRODUTOS para Tenant 2 ───
    console.log('\n📌 Criando produtos para Tenant 2...');
    
    const produtos = [
      { nome: 'X-Burguer', descricao: 'Hambúrguer 180g, queijo cheddar, alface e tomate.', preco: 28.90, cat: 'burguers', destaque: true },
      { nome: 'X-Salada', descricao: 'Hambúrguer 180g, queijo mussarela, alface, tomate e maionese.', preco: 25.90, cat: 'burguers' },
      { nome: 'X-Bacon', descricao: 'Hambúrguer 180g, queijo cheddar, bacon crocante e barbecue.', preco: 32.90, cat: 'burguers' },
      { nome: 'Pizza Margherita', descricao: 'Molho de tomate, mussarela, manjericão fresco e azeite.', preco: 45.00, cat: 'pizzas', destaque: true },
      { nome: 'Pizza Calabresa', descricao: 'Molho de tomate, mussarela, calabresa e cebola.', preco: 48.00, cat: 'pizzas' },
      { nome: 'Pizza Portuguesa', descricao: 'Molho de tomate, mussarela, presunto, ovos, cebola e azeitonas.', preco: 52.00, cat: 'pizzas' },
      { nome: 'Coca-Cola 2L', descricao: 'Refrigerante Coca-Cola 2 litros gelado.', preco: 10.00, cat: 'bebidas' },
      { nome: 'Suco de Laranja', descricao: 'Suco natural de laranja 500ml.', preco: 8.00, cat: 'bebidas' },
      { nome: 'Água Mineral', descricao: 'Água mineral sem gás 500ml.', preco: 4.00, cat: 'bebidas' },
      { nome: 'Pudim', descricao: 'Pudim de leite condensado com calda de caramelo.', preco: 12.00, cat: 'sobremesas' },
      { nome: 'Brownie', descricao: 'Brownie de chocolate com nozes e sorvete.', preco: 15.00, cat: 'sobremesas' },
      { nome: 'Batata Frita', descricao: 'Porção de batata frita crocante com cheddar e bacon.', preco: 22.00, cat: 'porcoes' },
    ];

    let prodCount = 0;
    for (const p of produtos) {
      const existing = await client.query(
        'SELECT id FROM produtos WHERE nome = $1 AND restaurant_id = $2',
        [p.nome, tenant2Id]
      );
      if (existing.rows.length > 0) continue;

      await client.query(
        `INSERT INTO produtos (restaurant_id, nome, descricao, preco, categoria_id, ativo, destaque)
         VALUES ($1, $2, $3, $4, $5, true, $6)`,
        [tenant2Id, p.nome, p.descricao, p.preco, catMap[p.cat], p.destaque || false]
      );
      prodCount++;
    }
    console.log(`   ✅ ${prodCount} produtos criados`);

    // ─── 5. EXTRAS para Tenant 2 ───
    console.log('\n📌 Criando extras para Tenant 2...');
    
    const extras = [
      { produto: 'X-Burguer', nome: 'Bacon Extra', preco: 4.00 },
      { produto: 'X-Burguer', nome: 'Cheddar Extra', preco: 3.00 },
      { produto: 'X-Burguer', nome: 'Ovo', preco: 2.50 },
      { produto: 'X-Bacon', nome: 'Cheddar Extra', preco: 3.00 },
      { produto: 'Pizza Margherita', nome: 'Borda de Cheddar', preco: 5.00 },
      { produto: 'Pizza Margherita', nome: 'Queijo Extra', preco: 6.00 },
      { produto: 'Pizza Calabresa', nome: 'Borda de Cheddar', preco: 5.00 },
      { produto: 'Pizza Calabresa', nome: 'Cebola Extra', preco: 2.00 },
    ];

    let extraCount = 0;
    for (const e of extras) {
      const prodResult = await client.query(
        'SELECT id FROM produtos WHERE nome = $1 AND restaurant_id = $2',
        [e.produto, tenant2Id]
      );
      if (prodResult.rows.length === 0) continue;

      const existing = await client.query(
        'SELECT id FROM produtos_extras WHERE nome = $1 AND produto_id = $2',
        [e.nome, prodResult.rows[0].id]
      );
      if (existing.rows.length > 0) continue;

      await client.query(
        `INSERT INTO produtos_extras (produto_id, nome, preco) VALUES ($1, $2, $3)`,
        [prodResult.rows[0].id, e.nome, e.preco]
      );
      extraCount++;
    }
    console.log(`   ✅ ${extraCount} extras criados`);

    // ─── 6. RAIOS DE ENTREGA para Tenant 2 ───
    console.log('\n📌 Criando raios de entrega para Tenant 2...');
    
    const raios = [
      { km: 3, tMin: 15, tMax: 25, custo: 5.00 },
      { km: 5, tMin: 20, tMax: 35, custo: 8.00 },
      { km: 8, tMin: 30, tMax: 50, custo: 12.00 },
    ];

    let raioCount = 0;
    for (const r of raios) {
      const result = await client.query(
        `INSERT INTO raios_entrega (restaurant_id, raio_km, tempo_min, tempo_max, custo)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (restaurant_id, raio_km) DO NOTHING
         RETURNING id`,
        [tenant2Id, r.km, r.tMin, r.tMax, r.custo]
      );
      if (result.rows.length > 0) raioCount++;
    }
    console.log(`   ✅ ${raioCount} raios criados`);

    // ─── 7. ADMIN USER para Tenant 2 ───
    console.log('\n📌 Criando admin user para Tenant 2...');
    
    const adminHash = await bcrypt.hash('admin123', 12);
    const adminResult = await client.query(
      `INSERT INTO restaurante_users (restaurant_id, nome, email, apelido, senha_hash, cargo)
       VALUES ($1, 'Admin SaborExpress', 'admin@saborexpress2.com', 'admin', $2, 'admin')
       ON CONFLICT (restaurant_id, email) DO NOTHING
       RETURNING id`,
      [tenant2Id, adminHash]
    );
    if (adminResult.rows.length > 0) {
      console.log('   ✅ Admin criado: admin@saborexpress2.com / admin123');
    } else {
      console.log('   ⏩ Admin já existe');
    }

    // Garantir apelido 'admin' para admins criados antes da migration 022
    await client.query(
      `UPDATE restaurante_users
       SET apelido = COALESCE(NULLIF(apelido, ''), 'admin')
       WHERE restaurant_id = $1 AND email = 'admin@saborexpress2.com'`,
      [tenant2Id]
    );

    // ─── 8. CLIENTE DE TESTE para Tenant 2 (username: cliente / cliente123) ───
    console.log('\n📌 Criando cliente de teste para Tenant 2...');
    
    const clienteHash = await bcrypt.hash('cliente123', 12);
    const clienteResult = await client.query(
      `INSERT INTO clientes (restaurant_id, nome, sobrenome, apelido, email, telefone, senha_hash, endereco, cep, bairro, cidade, estado)
       VALUES ($1, 'João', 'Santos', 'cliente', 'joao@email.com', '(11) 97777-6666', $2, 'Rua Augusta, 500', '01305-000', 'Consolação', 'São Paulo', 'SP')
       ON CONFLICT (restaurant_id, email) DO NOTHING
       RETURNING id`,
      [tenant2Id, clienteHash]
    );
    // Backfill: garantir apelido 'cliente' caso o registro já existisse
    await client.query(
      `UPDATE clientes SET apelido = COALESCE(NULLIF(apelido, ''), 'cliente')
       WHERE restaurant_id = $1 AND email = 'joao@email.com'`,
      [tenant2Id]
    );
    if (clienteResult.rows.length > 0) {
      console.log('   ✅ Cliente criado: cliente / cliente123');
    } else {
      console.log('   ⏩ Cliente já existe');
    }

    // ─── 8.1 ENTREGADOR DE TESTE para Tenant 2 (username: entregador / entregador123) ───
    console.log('\n📌 Criando entregador de teste para Tenant 2...');

    const entregadorHash = await bcrypt.hash('entregador123', 12);
    const entregadorResult = await client.query(
      `INSERT INTO entregadores (restaurant_id, nome, apelido, email, telefone, senha_hash, status)
       VALUES ($1, 'Entregador', 'entregador', 'entregador@saborexpress2.com', '(11) 96666-5555', $2, 'ativo')
       ON CONFLICT (restaurant_id, email) DO NOTHING
       RETURNING id`,
      [tenant2Id, entregadorHash]
    );
    // Backfill: garantir apelido 'entregador' caso o registro já existisse
    await client.query(
      `UPDATE entregadores SET apelido = COALESCE(NULLIF(apelido, ''), 'entregador')
       WHERE restaurant_id = $1 AND email = 'entregador@saborexpress2.com'`,
      [tenant2Id]
    );
    if (entregadorResult.rows.length > 0) {
      console.log('   ✅ Entregador criado: entregador / entregador123');
    } else {
      console.log('   ⏩ Entregador já existe');
    }

    // ─── 9. RESUMO ───
    console.log('\n═══════════════════════════════════════');
    console.log('📊 RESUMO DO SEED');
    console.log('═══════════════════════════════════════');
    
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM restaurantes) as restaurantes,
        (SELECT COUNT(*) FROM categorias WHERE restaurant_id = $1) as cat2,
        (SELECT COUNT(*) FROM produtos WHERE restaurant_id = $1) as prod2,
        (SELECT COUNT(*) FROM produtos_extras WHERE produto_id IN (SELECT id FROM produtos WHERE restaurant_id = $1)) as extra2,
        (SELECT COUNT(*) FROM raios_entrega WHERE restaurant_id = $1) as raios2,
        (SELECT COUNT(*) FROM clientes WHERE restaurant_id = $1) as clientes2,
        (SELECT COUNT(*) FROM restaurante_users WHERE restaurant_id = $1) as staff2
    `, [tenant2Id]);
    
    const row = counts.rows[0];
    console.log(`   🏪 Total de restaurantes: ${row.restaurantes}`);
    console.log(`   📂 Categorias Tenant 2: ${row.cat2}`);
    console.log(`   🍔 Produtos Tenant 2: ${row.prod2}`);
    console.log(`   🧀 Extras Tenant 2: ${row.extra2}`);
    console.log(`   📏 Raios entrega Tenant 2: ${row.raios2}`);
    console.log(`   👤 Clientes Tenant 2: ${row.clientes2}`);
    console.log(`   👥 Staff Tenant 2: ${row.staff2}`);
    console.log('═══════════════════════════════════════\n');

    await client.query('COMMIT');
    console.log('✅ Seed concluído com sucesso!\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Seed falhou:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedTenant2();
