import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { query } from './config/database.js';
import { config } from './config/index.js';
import 'dotenv/config';

async function seed() {
  console.log('\n🌱 Seeding database...\n');

  try {
    // Gerar JWT secret para o tenant se não existir
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    await query(
      'UPDATE restaurantes SET jwt_secret = COALESCE(jwt_secret, $1) WHERE id = $2',
      [jwtSecret, config.restaurantId]
    );
    console.log('✅ JWT secret gerado/verificado para o tenant');

    // Admin user
    const adminHash = await bcrypt.hash('admin123', 12);
    await query(
      `INSERT INTO restaurante_users (restaurant_id, nome, email, apelido, senha_hash, cargo)
       VALUES ($1, 'Administrador', 'admin@saborexpress.com', 'admin', $2, 'admin')
       ON CONFLICT (restaurant_id, email) DO NOTHING`,
      [config.restaurantId, adminHash]
    );
    // Garantir apelido se o usuário já existia
    await query(
      "UPDATE restaurante_users SET apelido = COALESCE(apelido, 'admin') WHERE restaurant_id = $1 AND nome = 'Administrador'",
      [config.restaurantId]
    );
    console.log('✅ Admin user created: admin / admin123');

    // Sample products
    const produtos = [
      { nome: 'X-Burguer', descricao: 'Hambúrguer 180g, queijo cheddar, alface, tomate e molho especial.', preco: 28.90, categoria_slug: 'burguers' },
      { nome: 'X-Salada', descricao: 'Hambúrguer 180g, queijo mussarela, alface, tomate, cebola roxa e maionese.', preco: 25.90, categoria_slug: 'burguers' },
      { nome: 'X-Bacon', descricao: 'Hambúrguer 180g, queijo cheddar, bacon crocante, alface, tomate e barbecue.', preco: 32.90, categoria_slug: 'burguers' },
      { nome: 'Pizza Margherita', descricao: 'Molho de tomate, mussarela, manjericão fresco e azeite.', preco: 45.00, categoria_slug: 'pizzas' },
      { nome: 'Pizza Calabresa', descricao: 'Molho de tomate, mussarela, calabresa fatiada e cebola.', preco: 48.00, categoria_slug: 'pizzas' },
      { nome: 'Pizza Portuguesa', descricao: 'Molho de tomate, mussarela, presunto, ovos, cebola e azeitonas.', preco: 52.00, categoria_slug: 'pizzas' },
      { nome: 'Coca-Cola 2L', descricao: 'Refrigerante Coca-Cola 2 litros gelado.', preco: 10.00, categoria_slug: 'bebidas' },
      { nome: 'Suco de Laranja', descricao: 'Suco natural de laranja 500ml.', preco: 8.00, categoria_slug: 'bebidas' },
      { nome: 'Água Mineral', descricao: 'Água mineral sem gás 500ml.', preco: 4.00, categoria_slug: 'bebidas' },
      { nome: 'Pudim', descricao: 'Pudim de leite condensado com calda de caramelo.', preco: 12.00, categoria_slug: 'sobremesas' },
      { nome: 'Brownie', descricao: 'Brownie de chocolate com nozes e sorvete.', preco: 15.00, categoria_slug: 'sobremesas' },
      { nome: 'Batata Frita', descricao: 'Porção de batata frita crocante com queijo cheddar e bacon.', preco: 22.00, categoria_slug: 'porcoes' },
    ];

    for (const p of produtos) {
      const catResult = await query(
        'SELECT id FROM categorias WHERE slug = $1 AND restaurant_id = $2',
        [p.categoria_slug, config.restaurantId]
      );
      const categoriaId = catResult.rows[0]?.id;

      await query(
        `INSERT INTO produtos (restaurant_id, nome, descricao, preco, categoria_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [config.restaurantId, p.nome, p.descricao, p.preco, categoriaId]
      );
    }
    console.log(`✅ ${produtos.length} products created`);

    // Extras for some products
    const extras = [
      { produto_nome: 'X-Burguer', extra_nome: 'Bacon Extra', extra_preco: 4.00 },
      { produto_nome: 'X-Burguer', extra_nome: 'Cheddar Extra', extra_preco: 3.00 },
      { produto_nome: 'X-Burguer', extra_nome: 'Ovo', extra_preco: 2.50 },
      { produto_nome: 'X-Bacon', extra_nome: 'Cheddar Extra', extra_preco: 3.00 },
      { produto_nome: 'Pizza Margherita', extra_nome: 'Borda de Cheddar', extra_preco: 5.00 },
      { produto_nome: 'Pizza Margherita', extra_nome: 'Queijo Extra', extra_preco: 6.00 },
      { produto_nome: 'Pizza Calabresa', extra_nome: 'Borda de Cheddar', extra_preco: 5.00 },
      { produto_nome: 'Pizza Calabresa', extra_nome: 'Cebola Extra', extra_preco: 2.00 },
    ];

    for (const e of extras) {
      const prodResult = await query(
        'SELECT id FROM produtos WHERE nome = $1 AND restaurant_id = $2',
        [e.produto_nome, config.restaurantId]
      );
      if (prodResult.rows[0]) {
        await query(
          `INSERT INTO produtos_extras (produto_id, nome, preco)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [prodResult.rows[0].id, e.extra_nome, e.extra_preco]
        );
      }
    }
    console.log(`✅ ${extras.length} extras created`);

    // Sample cliente
    const clienteHash = await bcrypt.hash('cliente123', 12);
    await query(
      `INSERT INTO clientes (restaurant_id, nome, sobrenome, email, telefone, senha_hash, endereco, cep, bairro, cidade, estado)
       VALUES ($1, 'Maria', 'Silva', 'maria@email.com', '(11) 99999-8888', $2, 'Av. Paulista, 1000', '01310-100', 'Bela Vista', 'São Paulo', 'SP')
       ON CONFLICT (restaurant_id, email) DO NOTHING`,
      [config.restaurantId, clienteHash]
    );
    console.log('✅ Test client created: maria@email.com / cliente123');

    // Raios de entrega
    const raios = [
      { km: 1, min: 15, max: 25, custo: 5.00 },
      { km: 3, min: 20, max: 35, custo: 7.00 },
      { km: 5, min: 25, max: 45, custo: 10.00 },
      { km: 10, min: 30, max: 60, custo: 15.00 },
    ];
    for (const r of raios) {
      await query(
        `INSERT INTO raios_entrega (restaurant_id, raio_km, tempo_min, tempo_max, custo)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (restaurant_id, raio_km) DO NOTHING`,
        [config.restaurantId, r.km, r.min, r.max, r.custo]
      );
    }
    console.log(`✅ ${raios.length} delivery zones created`);

    // Mesas
    const mesaCount = await query('SELECT COUNT(*) as total FROM mesas WHERE restaurant_id = $1', [config.restaurantId]);
    if (parseInt(mesaCount.rows[0].total) === 0) {
      for (let i = 1; i <= 10; i++) {
        await query(
          `INSERT INTO mesas (restaurant_id, nome, capacidade, status)
           VALUES ($1, $2, $3, $4)`,
          [config.restaurantId, `Mesa ${i}`, i === 1 ? 2 : (i <= 3 ? 6 : 4), 'livre']
        );
      }
      console.log('✅ 10 tables created (2-6 seats each)');
    } else {
      console.log(`⏩ ${mesaCount.rows[0].total} tables already exist, skipping`);
    }

    // Banners
    const bannerCount = await query('SELECT COUNT(*) as total FROM banners WHERE restaurant_id = $1', [config.restaurantId]);
    if (parseInt(bannerCount.rows[0].total) === 0) {
      const banners = [
        { titulo: 'Promoção do Dia!', subtitulo: 'Desconto especial em todos os burguers', ordem: 1 },
        { titulo: 'Novidade no Cardápio', subtitulo: 'Experimente nossa nova Pizza Especial', ordem: 2 },
        { titulo: 'Combos Imperdíveis', subtitulo: 'Burger + Batata + Refri por apenas R$ 34,90', ordem: 3 },
      ];
      for (const b of banners) {
        await query(
          `INSERT INTO banners (restaurant_id, titulo, subtitulo, ordem, ativo)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT DO NOTHING`,
          [config.restaurantId, b.titulo, b.subtitulo, b.ordem]
        );
      }
      console.log(`✅ ${banners.length} banners created`);
    } else {
      console.log(`⏩ ${bannerCount.rows[0].total} banners already exist, skipping`);
    }

    console.log('\n🌱 Seed completed successfully!\n');
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  }

  process.exit(0);
}

seed();
