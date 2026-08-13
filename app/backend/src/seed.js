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
    // Migrar email antigo da marca (SaborExpress) — torna o re-seed idempotente
    // e evita criar um segundo admin quando o banco já foi populado antes.
    await query(
      `UPDATE restaurante_users SET email = 'admin@kardapiodigital.com'
       WHERE restaurant_id = $1 AND apelido = 'admin'
         AND email IS DISTINCT FROM 'admin@kardapiodigital.com'`,
      [config.restaurantId]
    );
    await query(
      `INSERT INTO restaurante_users (restaurant_id, nome, email, apelido, senha_hash, cargo)
       VALUES ($1, 'Administrador', 'admin@kardapiodigital.com', 'admin', $2, 'admin')
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
      { nome: 'X-Burguer', descricao: 'Hambúrguer 180g, queijo cheddar, alface, tomate e molho especial.', preco: 28.90, categoria_slug: 'burguers', talheres: true, modulos: ['delivery', 'salao'] },
      { nome: 'X-Salada', descricao: 'Hambúrguer 180g, queijo mussarela, alface, tomate, cebola roxa e maionese.', preco: 25.90, categoria_slug: 'burguers', talheres: false, modulos: ['delivery', 'salao'] },
      { nome: 'X-Bacon', descricao: 'Hambúrguer 180g, queijo cheddar, bacon crocante, alface, tomate e barbecue.', preco: 32.90, categoria_slug: 'burguers', talheres: true, modulos: ['delivery', 'salao'] },
      { nome: 'Pizza Margherita', descricao: 'Molho de tomate, mussarela, manjericão fresco e azeite.', preco: 45.00, categoria_slug: 'pizzas', talheres: false, modulos: ['delivery', 'salao'] },
      { nome: 'Pizza Calabresa', descricao: 'Molho de tomate, mussarela, calabresa fatiada e cebola.', preco: 48.00, categoria_slug: 'pizzas', talheres: false, modulos: ['delivery', 'salao'] },
      { nome: 'Pizza Portuguesa', descricao: 'Molho de tomate, mussarela, presunto, ovos, cebola e azeitonas.', preco: 52.00, categoria_slug: 'pizzas', talheres: false, modulos: ['delivery'] },
      { nome: 'Coca-Cola 2L', descricao: 'Refrigerante Coca-Cola 2 litros gelado.', preco: 10.00, categoria_slug: 'bebidas', talheres: false, modulos: ['delivery', 'salao'] },
      { nome: 'Suco de Laranja', descricao: 'Suco natural de laranja 500ml.', preco: 8.00, categoria_slug: 'bebidas', talheres: false, modulos: ['delivery', 'salao'] },
      { nome: 'Água Mineral', descricao: 'Água mineral sem gás 500ml.', preco: 4.00, categoria_slug: 'bebidas', talheres: false, modulos: ['delivery', 'salao'] },
      { nome: 'Pudim', descricao: 'Pudim de leite condensado com calda de caramelo.', preco: 12.00, categoria_slug: 'sobremesas', talheres: false, modulos: ['delivery', 'salao'] },
      { nome: 'Brownie', descricao: 'Brownie de chocolate com nozes e sorvete.', preco: 15.00, categoria_slug: 'sobremesas', talheres: false, modulos: ['delivery', 'salao'] },
      { nome: 'Batata Frita', descricao: 'Porção de batata frita crocante com queijo cheddar e bacon.', preco: 22.00, categoria_slug: 'porcoes', talheres: true, modulos: ['delivery', 'salao'] },
    ];

    for (const p of produtos) {
      const catResult = await query(
        'SELECT id FROM categorias WHERE slug = $1 AND restaurant_id = $2',
        [p.categoria_slug, config.restaurantId]
      );
      const categoriaId = catResult.rows[0]?.id;

      await query(
        `INSERT INTO produtos (restaurant_id, nome, descricao, preco, categoria_id, talheres_obrigatorio, modulos)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [config.restaurantId, p.nome, p.descricao, p.preco, categoriaId, p.talheres, JSON.stringify(p.modulos)]
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

    // Opções do prato (gratuitas) — grupos + escolhas por produto
    const opcoes = [
      { produto_nome: 'X-Burguer', grupo: 'Ponto da carne', tipo: 'unica', obrigatoria: true, opcoes: ['Mal passado', 'Ao ponto', 'Bem passado'] },
      { produto_nome: 'X-Burguer', grupo: 'Molhos grátis', tipo: 'multipla', obrigatoria: false, opcoes: ['Ketchup', 'Maionese', 'Mostarda'] },
      { produto_nome: 'X-Bacon', grupo: 'Ponto da carne', tipo: 'unica', obrigatoria: true, opcoes: ['Mal passado', 'Ao ponto', 'Bem passado'] },
      { produto_nome: 'Pizza Margherita', grupo: 'Espessura da borda', tipo: 'unica', obrigatoria: true, opcoes: ['Fina', 'Média', 'Grossa'] },
      { produto_nome: 'Pizza Calabresa', grupo: 'Espessura da borda', tipo: 'unica', obrigatoria: true, opcoes: ['Fina', 'Média', 'Grossa'] },
    ];

    for (const o of opcoes) {
      const prodResult = await query(
        'SELECT id FROM produtos WHERE nome = $1 AND restaurant_id = $2',
        [o.produto_nome, config.restaurantId]
      );
      if (!prodResult.rows[0]) continue;
      let ordem = 0;
      for (const nome of o.opcoes) {
        const existente = await query(
          'SELECT id FROM produto_opcoes WHERE produto_id = $1 AND grupo = $2 AND nome = $3 LIMIT 1',
          [prodResult.rows[0].id, o.grupo, nome]
        );
        if (!existente.rows[0]) {
          await query(
            `INSERT INTO produto_opcoes (produto_id, grupo, nome, tipo, obrigatoria, ordem)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [prodResult.rows[0].id, o.grupo, nome, o.tipo, o.obrigatoria, ordem++]
          );
        }
      }
    }
    console.log(`✅ ${opcoes.length} grupos de opções created`);

    // Subcategorias de adicionais (catálogo compartilhado)
    const subcategorias = [
      { nome: 'Porções', itens: [
        { nome: 'Arroz', preco: 5.00, maximo: 2 },
        { nome: 'Feijão', preco: 4.00, maximo: 2 },
        { nome: 'Batata Frita', preco: 6.00, maximo: 1 },
        { nome: 'Salada', preco: 4.50, maximo: 1 },
      ]},
      { nome: 'Extra', itens: [
        { nome: 'Queijo', preco: 4.00, maximo: 3 },
        { nome: 'Carne', preco: 6.00, maximo: 2 },
        { nome: 'Molho Especial', preco: 3.00, maximo: 1 },
      ]},
      { nome: 'Bebidas', itens: [
        { nome: 'Coca-Cola Lata', preco: 6.00, maximo: 4 },
        { nome: 'Água', preco: 3.50, maximo: 2 },
        { nome: 'Chá Gelado', preco: 5.00, maximo: 2 },
        { nome: 'Cerveja', preco: 8.00, maximo: 4 },
      ]},
    ];

    const subIds = {};
    for (const sub of subcategorias) {
      const existente = await query(
        'SELECT id FROM extra_subcategorias WHERE restaurant_id = $1 AND nome = $2 LIMIT 1',
        [config.restaurantId, sub.nome]
      );
      let subId;
      if (existente.rows[0]) {
        subId = existente.rows[0].id;
      } else {
        const criada = await query(
          'INSERT INTO extra_subcategorias (restaurant_id, nome, ordem) VALUES ($1, $2, $3) RETURNING id',
          [config.restaurantId, sub.nome, Object.keys(subIds).length]
        );
        subId = criada.rows[0].id;
      }
      let ordem = 0;
      for (const item of sub.itens) {
        const itemExistente = await query(
          'SELECT id FROM extra_subcategoria_itens WHERE subcategoria_id = $1 AND nome = $2 LIMIT 1',
          [subId, item.nome]
        );
        if (!itemExistente.rows[0]) {
          await query(
            `INSERT INTO extra_subcategoria_itens (subcategoria_id, nome, preco, maximo, ordem)
             VALUES ($1, $2, $3, $4, $5)`,
            [subId, item.nome, item.preco, item.maximo, ordem++]
          );
        }
      }
      subIds[sub.nome] = subId;
    }

    // Ativar subcategorias em alguns produtos
    const produtosComSubcats = [
      { nome: 'X-Burguer', subs: ['Porções', 'Extra', 'Bebidas'] },
      { nome: 'X-Bacon', subs: ['Porções', 'Extra', 'Bebidas'] },
      { nome: 'Pizza Margherita', subs: ['Extra', 'Bebidas'] },
      { nome: 'Pizza Calabresa', subs: ['Extra', 'Bebidas'] },
    ];
    for (const p of produtosComSubcats) {
      const prodResult = await query(
        'SELECT id FROM produtos WHERE nome = $1 AND restaurant_id = $2',
        [p.nome, config.restaurantId]
      );
      if (!prodResult.rows[0]) continue;
      for (const subNome of p.subs) {
        const sid = subIds[subNome];
        if (!sid) continue;
        await query(
          'INSERT INTO produto_extra_subcategorias (produto_id, subcategoria_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [prodResult.rows[0].id, sid]
        );
      }
    }
    console.log(`✅ ${subcategorias.length} subcategorias de adicionais created`);

    // Sample cliente — login por username: cliente / cliente123 (ou telefone)
    const clienteHash = await bcrypt.hash('cliente123', 12);
    await query(
      `INSERT INTO clientes (restaurant_id, nome, sobrenome, apelido, email, telefone, senha_hash, endereco, cep, bairro, cidade, estado)
       VALUES ($1, 'Maria', 'Silva', 'cliente', 'maria@email.com', '(11) 99999-8888', $2, 'Av. Paulista, 1000', '01310-100', 'Bela Vista', 'São Paulo', 'SP')
       ON CONFLICT (restaurant_id, email) DO NOTHING`,
      [config.restaurantId, clienteHash]
    );
    // Backfill: garantir apelido 'cliente' caso o registro já existisse
    await query(
      `UPDATE clientes SET apelido = COALESCE(NULLIF(apelido, ''), 'cliente')
       WHERE restaurant_id = $1 AND email = 'maria@email.com'`,
      [config.restaurantId]
    );
    console.log('✅ Test client created: cliente / cliente123 (ou telefone (11) 99999-8888)');

    // Sample entregador — login por username: entregador / entregador123
    const entregadorHash = await bcrypt.hash('entregador123', 12);
    // Migrar email antigo da marca (SaborExpress) — idempotente como o admin
    await query(
      `UPDATE entregadores SET email = 'entregador@kardapiodigital.com'
       WHERE restaurant_id = $1 AND apelido = 'entregador'
         AND email IS DISTINCT FROM 'entregador@kardapiodigital.com'`,
      [config.restaurantId]
    );
    await query(
      `INSERT INTO entregadores (restaurant_id, nome, apelido, email, telefone, senha_hash, status)
       VALUES ($1, 'Entregador', 'entregador', 'entregador@kardapiodigital.com', '(11) 98888-7777', $2, 'ativo')
       ON CONFLICT (restaurant_id, email) DO NOTHING`,
      [config.restaurantId, entregadorHash]
    );
    // Backfill: garantir apelido 'entregador' caso o registro já existisse
    await query(
      `UPDATE entregadores SET apelido = COALESCE(NULLIF(apelido, ''), 'entregador')
       WHERE restaurant_id = $1 AND email = 'entregador@kardapiodigital.com'`,
      [config.restaurantId]
    );
    console.log('✅ Test driver created: entregador / entregador123');

    // Configurar retirada e horários de funcionamento
    await query(
      `UPDATE restaurantes SET
        retirada_habilitada = true,
        horarios_funcionamento = $1
       WHERE id = $2`,
      [JSON.stringify([
        { aberto: false, abre: '', fecha: '' },         // domingo
        { aberto: true, abre: '08:00', fecha: '23:00' }, // segunda
        { aberto: true, abre: '08:00', fecha: '23:00' }, // terça
        { aberto: true, abre: '08:00', fecha: '23:00' }, // quarta
        { aberto: true, abre: '08:00', fecha: '23:00' }, // quinta
        { aberto: true, abre: '08:00', fecha: '23:59' }, // sexta
        { aberto: true, abre: '09:00', fecha: '23:00' }, // sábado
      ]), config.restaurantId]
    );
    console.log('✅ Retirada habilitada com horários de funcionamento');

    // Raios de entrega
    // Calibração (BUG-018): a distância calculada é EM LINHA RETA — a rota real
    // é ~1,4× maior. Valores de tempo/frete refletem o deslocamento real
    // (moto ~22 km/h) + margem de operação.
    const raios = [
      { km: 1, min: 10, max: 15, custo: 6.00 },
      { km: 3, min: 15, max: 25, custo: 8.00 },
      { km: 5, min: 25, max: 35, custo: 10.00 },
      { km: 10, min: 40, max: 55, custo: 15.00 },
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
