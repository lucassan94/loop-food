import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { query } from './config/database.js';
import { config } from './config/index.js';
import 'dotenv/config';

// ============================================================================
// SEED — popula o tenant configurado (config.restaurantId / RESTAURANT_ID)
// ============================================================================
// O tenant padrão para TESTES LOCAIS é o LOOP (RESTAURANT_ID=3, slug 'loop').
// O seed é idempotente: pode ser re-executado sem duplicar dados
// (categorias/produtos/extras/opções são verificados antes de inserir;
// clientes/entregador/admin fazem upsert; pedidos só são criados se o tenant
// ainda não tiver nenhum).
// ============================================================================

const minAtras = (n) => new Date(Date.now() - n * 60000);

async function seed() {
  const rid = config.restaurantId;
  console.log('\n🌱 Seeding database...\n');
  console.log(`🏪 Tenant alvo: #${rid}`);

  try {
    // ────────────────────────────────────────────────────────────────────────
    // JWT SECRET DO TENANT
    // ────────────────────────────────────────────────────────────────────────
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    await query(
      'UPDATE restaurantes SET jwt_secret = COALESCE(jwt_secret, $1) WHERE id = $2',
      [jwtSecret, rid]
    );
    console.log('✅ JWT secret gerado/verificado para o tenant');

    // ────────────────────────────────────────────────────────────────────────
    // ADMIN — upsert determinístico (admin / admin123)
    // ────────────────────────────────────────────────────────────────────────
    const adminHash = await bcrypt.hash('admin123', 12);
    const adminExistente = await query(
      `SELECT id FROM restaurante_users
       WHERE restaurant_id = $1 AND (apelido = 'admin' OR cargo = 'admin')
       ORDER BY id LIMIT 1`,
      [rid]
    );
    if (adminExistente.rows[0]) {
      await query(
        `UPDATE restaurante_users
         SET nome = 'Administrador', email = 'admin@kardapiodigital.com', apelido = 'admin',
             senha_hash = $2, cargo = 'admin', ativo = true
         WHERE id = $1`,
        [adminExistente.rows[0].id, adminHash]
      );
    } else {
      await query(
        `INSERT INTO restaurante_users (restaurant_id, nome, email, apelido, senha_hash, cargo)
         VALUES ($1, 'Administrador', 'admin@kardapiodigital.com', 'admin', $2, 'admin')
         ON CONFLICT (restaurant_id, email) DO NOTHING`,
        [rid, adminHash]
      );
    }
    console.log('✅ Admin garantido: admin / admin123');

    // ────────────────────────────────────────────────────────────────────────
    // CATEGORIAS (idempotente por slug)
    // ────────────────────────────────────────────────────────────────────────
    const categorias = [
      { nome: 'Burguers', slug: 'burguers', ordem: 1 },
      { nome: 'Pizzas', slug: 'pizzas', ordem: 2 },
      { nome: 'Bebidas', slug: 'bebidas', ordem: 3 },
      { nome: 'Sobremesas', slug: 'sobremesas', ordem: 4 },
      { nome: 'Porções', slug: 'porcoes', ordem: 5 },
    ];
    const catIds = {};
    for (const c of categorias) {
      const existente = await query(
        'SELECT id FROM categorias WHERE restaurant_id = $1 AND slug = $2',
        [rid, c.slug]
      );
      if (existente.rows[0]) {
        catIds[c.slug] = existente.rows[0].id;
      } else {
        const criada = await query(
          'INSERT INTO categorias (restaurant_id, nome, slug, ordem) VALUES ($1, $2, $3, $4) RETURNING id',
          [rid, c.nome, c.slug, c.ordem]
        );
        catIds[c.slug] = criada.rows[0].id;
      }
    }
    console.log(`✅ ${categorias.length} categorias garantidas`);

    // ────────────────────────────────────────────────────────────────────────
    // PRODUTOS (idempotente por restaurant_id + nome)
    // ────────────────────────────────────────────────────────────────────────
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

    const produtoIds = {};
    for (const p of produtos) {
      const existente = await query(
        'SELECT id FROM produtos WHERE nome = $1 AND restaurant_id = $2',
        [p.nome, rid]
      );
      if (existente.rows[0]) {
        produtoIds[p.nome] = existente.rows[0].id;
        continue;
      }
      const criado = await query(
        `INSERT INTO produtos (restaurant_id, nome, descricao, preco, categoria_id, talheres_obrigatorio, modulos)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [rid, p.nome, p.descricao, p.preco, catIds[p.categoria_slug], p.talheres, JSON.stringify(p.modulos)]
      );
      produtoIds[p.nome] = criado.rows[0].id;
    }
    console.log(`✅ ${produtos.length} produtos garantidos`);

    // Extras de produtos (idempotente por produto + nome)
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
      const pid = produtoIds[e.produto_nome];
      if (!pid) continue;
      const existente = await query(
        'SELECT id FROM produtos_extras WHERE produto_id = $1 AND nome = $2',
        [pid, e.extra_nome]
      );
      if (!existente.rows[0]) {
        await query(
          'INSERT INTO produtos_extras (produto_id, nome, preco) VALUES ($1, $2, $3)',
          [pid, e.extra_nome, e.extra_preco]
        );
      }
    }
    console.log(`✅ ${extras.length} extras garantidos`);

    // Opções do prato (gratuitas) — grupos + escolhas por produto
    const opcoes = [
      { produto_nome: 'X-Burguer', grupo: 'Ponto da carne', tipo: 'unica', obrigatoria: true, opcoes: ['Mal passado', 'Ao ponto', 'Bem passado'] },
      { produto_nome: 'X-Burguer', grupo: 'Molhos grátis', tipo: 'multipla', obrigatoria: false, opcoes: ['Ketchup', 'Maionese', 'Mostarda'] },
      { produto_nome: 'X-Bacon', grupo: 'Ponto da carne', tipo: 'unica', obrigatoria: true, opcoes: ['Mal passado', 'Ao ponto', 'Bem passado'] },
      { produto_nome: 'Pizza Margherita', grupo: 'Espessura da borda', tipo: 'unica', obrigatoria: true, opcoes: ['Fina', 'Média', 'Grossa'] },
      { produto_nome: 'Pizza Calabresa', grupo: 'Espessura da borda', tipo: 'unica', obrigatoria: true, opcoes: ['Fina', 'Média', 'Grossa'] },
    ];
    for (const o of opcoes) {
      const pid = produtoIds[o.produto_nome];
      if (!pid) continue;
      let ordem = 0;
      for (const nome of o.opcoes) {
        const existente = await query(
          'SELECT id FROM produto_opcoes WHERE produto_id = $1 AND grupo = $2 AND nome = $3 LIMIT 1',
          [pid, o.grupo, nome]
        );
        if (!existente.rows[0]) {
          await query(
            `INSERT INTO produto_opcoes (produto_id, grupo, nome, tipo, obrigatoria, ordem)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [pid, o.grupo, nome, o.tipo, o.obrigatoria, ordem++]
          );
        }
      }
    }
    console.log(`✅ ${opcoes.length} grupos de opções garantidos`);

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
        [rid, sub.nome]
      );
      let subId;
      if (existente.rows[0]) {
        subId = existente.rows[0].id;
      } else {
        const criada = await query(
          'INSERT INTO extra_subcategorias (restaurant_id, nome, ordem) VALUES ($1, $2, $3) RETURNING id',
          [rid, sub.nome, Object.keys(subIds).length]
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
      const pid = produtoIds[p.nome];
      if (!pid) continue;
      for (const subNome of p.subs) {
        const sid = subIds[subNome];
        if (!sid) continue;
        await query(
          'INSERT INTO produto_extra_subcategorias (produto_id, subcategoria_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [pid, sid]
        );
      }
    }
    console.log(`✅ ${subcategorias.length} subcategorias de adicionais garantidas`);

    // ────────────────────────────────────────────────────────────────────────
    // CLIENTES (upsert por restaurant_id + email)
    // ────────────────────────────────────────────────────────────────────────
    const clientes = [
      { nome: 'Maria', sobrenome: 'Silva', apelido: 'cliente', email: 'cliente@email.com', telefone: '(11) 99999-8888', senha: 'cliente123', endereco: 'Av. Paulista, 1000', numero: '1000', bairro: 'Bela Vista', cep: '01310-100', cidade: 'São Paulo', estado: 'SP' },
      { nome: 'João', sobrenome: 'Pereira', apelido: 'joao', email: 'joao@email.com', telefone: '(11) 98888-1111', senha: 'cliente123', endereco: 'Rua Augusta, 500', numero: '500', bairro: 'Consolação', cep: '01304-000', cidade: 'São Paulo', estado: 'SP' },
      { nome: 'Ana', sobrenome: 'Costa', apelido: 'ana', email: 'ana@email.com', telefone: '(11) 97777-2222', senha: 'cliente123', endereco: 'Alameda Santos, 1200', numero: '1200', bairro: 'Cerqueira César', cep: '01418-100', cidade: 'São Paulo', estado: 'SP' },
    ];
    const clienteIds = {};
    for (const cli of clientes) {
      const hash = await bcrypt.hash(cli.senha, 12);
      const existente = await query(
        'SELECT id FROM clientes WHERE restaurant_id = $1 AND email = $2',
        [rid, cli.email]
      );
      if (existente.rows[0]) {
        await query(
          `UPDATE clientes
           SET nome = $2, sobrenome = $3, apelido = $4, telefone = $5, senha_hash = $6,
               endereco = $7, numero = $8, bairro = $9, cep = $10, cidade = $11, estado = $12, ativo = true
           WHERE id = $1`,
          [existente.rows[0].id, cli.nome, cli.sobrenome, cli.apelido, cli.telefone, hash,
           cli.endereco, cli.numero, cli.bairro, cli.cep, cli.cidade, cli.estado]
        );
        clienteIds[cli.apelido] = existente.rows[0].id;
      } else {
        const criado = await query(
          `INSERT INTO clientes (restaurant_id, nome, sobrenome, apelido, email, telefone, senha_hash, endereco, numero, bairro, cep, cidade, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id`,
          [rid, cli.nome, cli.sobrenome, cli.apelido, cli.email, cli.telefone, hash,
           cli.endereco, cli.numero, cli.bairro, cli.cep, cli.cidade, cli.estado]
        );
        clienteIds[cli.apelido] = criado.rows[0].id;
      }
    }
    console.log(`✅ ${clientes.length} clientes garantidos (cliente / cliente123 · joao · ana)`);

    // ────────────────────────────────────────────────────────────────────────
    // ENTREGADOR (upsert por restaurant_id + email)
    // ────────────────────────────────────────────────────────────────────────
    const entregadorHash = await bcrypt.hash('entregador123', 12);
    const entregadorExistente = await query(
      "SELECT id FROM entregadores WHERE restaurant_id = $1 AND email = 'entregador@kardapiodigital.com'",
      [rid]
    );
    let entregadorId;
    if (entregadorExistente.rows[0]) {
      await query(
        `UPDATE entregadores
         SET nome = 'Entregador', apelido = 'entregador', telefone = '(11) 98888-7777',
             senha_hash = $2, status = 'ativo'
         WHERE id = $1`,
        [entregadorExistente.rows[0].id, entregadorHash]
      );
      entregadorId = entregadorExistente.rows[0].id;
    } else {
      const criado = await query(
        `INSERT INTO entregadores (restaurant_id, nome, apelido, email, telefone, senha_hash, status)
         VALUES ($1, 'Entregador', 'entregador', 'entregador@kardapiodigital.com', '(11) 98888-7777', $2, 'ativo')
         RETURNING id`,
        [rid, entregadorHash]
      );
      entregadorId = criado.rows[0].id;
    }
    console.log('✅ Entregador garantido: entregador / entregador123');

    // ────────────────────────────────────────────────────────────────────────
    // RAIOS DE ENTREGA (idempotente por raio_km)
    // ────────────────────────────────────────────────────────────────────────
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
        [rid, r.km, r.min, r.max, r.custo]
      );
    }
    console.log(`✅ ${raios.length} raios de entrega garantidos`);

    // ────────────────────────────────────────────────────────────────────────
    // CONFIGURAÇÕES: coordenadas + endereço (fallback), retirada + horários
    // ────────────────────────────────────────────────────────────────────────
    // Coordenadas são OBRIGATÓRIAS para o cálculo de frete por distância
    // (services/frete.js). Sem elas, /calcular-frete cai no fallback de frete
    // fixo e nunca bloqueia entregas fora do raio (API-07). Padrão: Osasco/SP,
    // mesma região dos raios calibrados no seed.
    await query(
      `UPDATE restaurantes SET
        latitude = COALESCE(latitude, $1),
        longitude = COALESCE(longitude, $2),
        endereco = CASE WHEN endereco IS NULL OR endereco = '' THEN $3 ELSE endereco END,
        cidade = CASE WHEN cidade IS NULL OR cidade = '' THEN $4 ELSE cidade END,
        estado = CASE WHEN estado IS NULL OR estado = '' THEN $5 ELSE estado END,
        retirada_habilitada = true,
        horarios_funcionamento = $6
       WHERE id = $7`,
      [-23.5451884, -46.8149413, 'Avenida João Paulo II, 500', 'Osasco', 'SP', JSON.stringify([
        { aberto: false, abre: '', fecha: '' },         // domingo
        { aberto: true, abre: '08:00', fecha: '23:00' }, // segunda
        { aberto: true, abre: '08:00', fecha: '23:00' }, // terça
        { aberto: true, abre: '08:00', fecha: '23:00' }, // quarta
        { aberto: true, abre: '08:00', fecha: '23:00' }, // quinta
        { aberto: true, abre: '08:00', fecha: '23:59' }, // sexta
        { aberto: true, abre: '09:00', fecha: '23:00' }, // sábado
      ]), rid]
    );
    console.log('✅ Coordenadas/endereço garantidos + retirada habilitada com horários');

    // ────────────────────────────────────────────────────────────────────────
    // MESAS (só se o tenant não tiver nenhuma)
    // ────────────────────────────────────────────────────────────────────────
    const mesaCount = await query('SELECT COUNT(*) as total FROM mesas WHERE restaurant_id = $1', [rid]);
    if (parseInt(mesaCount.rows[0].total) === 0) {
      for (let i = 1; i <= 10; i++) {
        await query(
          `INSERT INTO mesas (restaurant_id, nome, capacidade, status)
           VALUES ($1, $2, $3, $4)`,
          [rid, `Mesa ${i}`, i === 1 ? 2 : (i <= 3 ? 6 : 4), 'livre']
        );
      }
      console.log('✅ 10 mesas criadas (2-6 lugares)');
    } else {
      console.log(`⏩ ${mesaCount.rows[0].total} mesas já existem, pulando`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // BANNERS (só se o tenant não tiver nenhum)
    // ────────────────────────────────────────────────────────────────────────
    const bannerCount = await query('SELECT COUNT(*) as total FROM banners WHERE restaurant_id = $1', [rid]);
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
          [rid, b.titulo, b.subtitulo, b.ordem]
        );
      }
      console.log(`✅ ${banners.length} banners criados`);
    } else {
      console.log(`⏩ ${bannerCount.rows[0].total} banners já existem, pulando`);
    }

    // ────────────────────────────────────────────────────────────────────────
    // PEDIDOS DE EXEMPLO (só se o tenant NÃO tiver nenhum pedido)
    // ────────────────────────────────────────────────────────────────────────
    const pedidoCount = await query('SELECT COUNT(*) as total FROM pedidos WHERE restaurant_id = $1', [rid]);
    if (parseInt(pedidoCount.rows[0].total) > 0) {
      console.log(`⏩ ${pedidoCount.rows[0].total} pedidos já existem, pulando seeds de pedidos`);
    } else {
      await seedPedidos(rid, clienteIds, entregadorId, produtoIds);
    }

    // ────────────────────────────────────────────────────────────────────────
    // RESUMO
    // ────────────────────────────────────────────────────────────────────────
    const resumo = await query(
      `SELECT
        (SELECT COUNT(*) FROM clientes WHERE restaurant_id = $1) AS clientes,
        (SELECT COUNT(*) FROM entregadores WHERE restaurant_id = $1) AS entregadores,
        (SELECT COUNT(*) FROM produtos WHERE restaurant_id = $1) AS produtos,
        (SELECT COUNT(*) FROM pedidos WHERE restaurant_id = $1) AS pedidos,
        (SELECT COUNT(*) FROM mesas WHERE restaurant_id = $1) AS mesas,
        (SELECT COUNT(*) FROM banners WHERE restaurant_id = $1) AS banners`,
      [rid]
    );
    const r = resumo.rows[0];
    console.log('\n📊 Resumo do tenant:', JSON.stringify(r));
    console.log('\n🌱 Seed completed successfully!\n');
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  }

  process.exit(0);
}

// ============================================================================
// PEDIDOS DE EXEMPLO — delivery + salão + retirada, com itens e timeline
// ============================================================================
async function seedPedidos(rid, clienteIds, entregadorId, produtoIds) {
  const criarItem = (produto, quantidade = 1, extras = [], opcoes = []) => {
    const somaExtras = extras.reduce((acc, e) => acc + e.preco, 0);
    const precoUnitario = produto.preco;
    return {
      produtoId: produtoIds[produto.nome],
      nome: produto.nome,
      quantidade,
      precoUnitario,
      extras,
      opcoes,
      subtotal: (precoUnitario + somaExtras) * quantidade,
    };
  };

  const criaTimeline = (marcos) =>
    marcos.map((m) => ({
      anterior: m.anterior ?? null,
      novo: m.novo,
      usuario: m.usuario || 'sistema',
      notas: m.notas || null,
      quando: m.quando || null,
    }));

  const pedidos = [
    // ── DELIVERY ────────────────────────────────────────────────────────────
    {
      origem: 'delivery', status: 'pendente', metodoPagamento: 'pix_online',
      clienteId: clienteIds.joao, nomeCliente: 'João Pereira', telefone: '(11) 98888-1111',
      endereco: 'Rua Augusta, 500', numero: '500', bairro: 'Consolação', cep: '01304-000', cidade: 'São Paulo', estado: 'SP',
      subtotal: 75.80, valorFrete: 8.00, observacoes: 'Sem cebola, por favor.',
      tempoPreparo: 20, tempoEntrega: 30,
      itens: [
        criarItem({ nome: 'X-Burguer', preco: 28.90 }, 2, [{ nome: 'Bacon Extra', preco: 4.00 }], [{ grupo: 'Ponto da carne', nome: 'Ao ponto' }]),
        criarItem({ nome: 'Coca-Cola 2L', preco: 10.00 }),
      ],
      timeline: criaTimeline([{ novo: 'pendente', usuario: 'cliente', quando: minAtras(8) }]),
    },
    {
      origem: 'delivery', status: 'preparando', metodoPagamento: 'dinheiro', detalhesPagamento: 'Troco para R$ 100',
      clienteId: clienteIds.cliente, nomeCliente: 'Maria Silva', telefone: '(11) 99999-8888',
      endereco: 'Av. Paulista, 1000', numero: '1000', bairro: 'Bela Vista', cep: '01310-100', cidade: 'São Paulo', estado: 'SP',
      subtotal: 33.90, valorFrete: 10.00,
      tempoPreparo: 15, tempoEntrega: 35,
      aceito: minAtras(20), preparo: minAtras(15),
      itens: [
        criarItem({ nome: 'X-Salada', preco: 25.90 }),
        criarItem({ nome: 'Suco de Laranja', preco: 8.00 }),
      ],
      timeline: criaTimeline([
        { novo: 'pendente', usuario: 'cliente', quando: minAtras(25) },
        { anterior: 'pendente', novo: 'preparando', usuario: 'restaurante', quando: minAtras(20) },
      ]),
    },
    {
      origem: 'delivery', status: 'pronto_entrega', metodoPagamento: 'pix',
      clienteId: clienteIds.ana, nomeCliente: 'Ana Costa', telefone: '(11) 97777-2222',
      endereco: 'Alameda Santos, 1200', numero: '1200', bairro: 'Cerqueira César', cep: '01418-100', cidade: 'São Paulo', estado: 'SP',
      subtotal: 57.00, valorFrete: 6.00,
      tempoPreparo: 25, tempoEntrega: 20,
      aceito: minAtras(50), preparo: minAtras(48), pronto: minAtras(25),
      itens: [
        criarItem({ nome: 'Pizza Calabresa', preco: 48.00 }, 1, [{ nome: 'Borda de Cheddar', preco: 5.00 }], [{ grupo: 'Espessura da borda', nome: 'Média' }]),
        criarItem({ nome: 'Água Mineral', preco: 4.00 }),
      ],
      timeline: criaTimeline([
        { novo: 'pendente', usuario: 'cliente', quando: minAtras(55) },
        { anterior: 'pendente', novo: 'preparando', usuario: 'restaurante', quando: minAtras(50) },
        { anterior: 'preparando', novo: 'pronto_entrega', usuario: 'restaurante', quando: minAtras(25) },
      ]),
    },
    {
      origem: 'delivery', status: 'em_transito', metodoPagamento: 'pix',
      clienteId: clienteIds.joao, nomeCliente: 'João Pereira', telefone: '(11) 98888-1111',
      endereco: 'Rua Augusta, 500', numero: '500', bairro: 'Consolação', cep: '01304-000', cidade: 'São Paulo', estado: 'SP',
      subtotal: 57.90, valorFrete: 10.00,
      tempoPreparo: 20, tempoEntrega: 30,
      aceito: minAtras(80), preparo: minAtras(78), pronto: minAtras(55), transito: minAtras(40),
      entregadorId,
      itens: [
        criarItem({ nome: 'X-Bacon', preco: 32.90 }, 1, [{ nome: 'Cheddar Extra', preco: 3.00 }], [{ grupo: 'Ponto da carne', nome: 'Bem passado' }]),
        criarItem({ nome: 'Batata Frita', preco: 22.00 }),
      ],
      timeline: criaTimeline([
        { novo: 'pendente', usuario: 'cliente', quando: minAtras(85) },
        { anterior: 'pendente', novo: 'preparando', usuario: 'restaurante', quando: minAtras(80) },
        { anterior: 'preparando', novo: 'pronto_entrega', usuario: 'restaurante', quando: minAtras(55) },
        { anterior: 'pronto_entrega', novo: 'em_transito', usuario: 'entregador', quando: minAtras(40) },
      ]),
    },
    {
      origem: 'delivery', status: 'entregue', metodoPagamento: 'debito',
      clienteId: clienteIds.cliente, nomeCliente: 'Maria Silva', telefone: '(11) 99999-8888',
      endereco: 'Av. Paulista, 1000', numero: '1000', bairro: 'Bela Vista', cep: '01310-100', cidade: 'São Paulo', estado: 'SP',
      subtotal: 61.00, valorFrete: 8.00,
      tempoPreparo: 20, tempoEntrega: 25,
      aceito: minAtras(200), preparo: minAtras(198), pronto: minAtras(175), transito: minAtras(160), destino: minAtras(148), entregue: minAtras(145),
      entregadorId,
      itens: [
        criarItem({ nome: 'Pizza Margherita', preco: 45.00 }, 1, [{ nome: 'Queijo Extra', preco: 6.00 }], [{ grupo: 'Espessura da borda', nome: 'Fina' }]),
        criarItem({ nome: 'Coca-Cola 2L', preco: 10.00 }),
      ],
      timeline: criaTimeline([
        { novo: 'pendente', usuario: 'cliente', quando: minAtras(205) },
        { anterior: 'pendente', novo: 'preparando', usuario: 'restaurante', quando: minAtras(200) },
        { anterior: 'preparando', novo: 'pronto_entrega', usuario: 'restaurante', quando: minAtras(175) },
        { anterior: 'pronto_entrega', novo: 'em_transito', usuario: 'entregador', quando: minAtras(160) },
        { anterior: 'em_transito', novo: 'cheguei_destino', usuario: 'entregador', quando: minAtras(148) },
        { anterior: 'cheguei_destino', novo: 'entregue', usuario: 'entregador', quando: minAtras(145) },
      ]),
    },
    {
      origem: 'delivery', status: 'cancelado', metodoPagamento: 'pix', motivoCancelamento: 'Cliente desistiu',
      clienteId: clienteIds.ana, nomeCliente: 'Ana Costa', telefone: '(11) 97777-2222',
      endereco: 'Alameda Santos, 1200', numero: '1200', bairro: 'Cerqueira César', cep: '01418-100', cidade: 'São Paulo', estado: 'SP',
      subtotal: 28.90, valorFrete: 10.00,
      tempoPreparo: 20, tempoEntrega: 30,
      cancelado: minAtras(120),
      itens: [criarItem({ nome: 'X-Burguer', preco: 28.90 })],
      timeline: criaTimeline([
        { novo: 'pendente', usuario: 'cliente', quando: minAtras(125) },
        { anterior: 'pendente', novo: 'cancelado', usuario: 'restaurante', notas: 'Cliente desistiu', quando: minAtras(120) },
      ]),
    },
    {
      origem: 'delivery', status: 'aguardando_pagamento', metodoPagamento: 'pix_online',
      clienteId: clienteIds.joao, nomeCliente: 'João Pereira', telefone: '(11) 98888-1111',
      endereco: 'Rua Augusta, 500', numero: '500', bairro: 'Consolação', cep: '01304-000', cidade: 'São Paulo', estado: 'SP',
      subtotal: 53.40, valorFrete: 8.00,
      tempoPreparo: 20, tempoEntrega: 30,
      itens: [
        criarItem({ nome: 'X-Burguer', preco: 28.90 }, 1, [{ nome: 'Ovo', preco: 2.50 }]),
        criarItem({ nome: 'Batata Frita', preco: 22.00 }),
      ],
      timeline: criaTimeline([{ novo: 'aguardando_pagamento', usuario: 'cliente', quando: minAtras(3) }]),
    },

    // ── SALÃO (PDV) ─────────────────────────────────────────────────────────
    {
      origem: 'salao', status: 'pendente', metodoPagamento: 'conta', mesa: 'Mesa 1',
      clienteId: null, nomeCliente: 'Cliente da mesa 1',
      subtotal: 38.90, valorFrete: 0,
      tempoPreparo: 15,
      itens: [
        criarItem({ nome: 'X-Burguer', preco: 28.90 }),
        criarItem({ nome: 'Coca-Cola 2L', preco: 10.00 }),
      ],
      timeline: criaTimeline([{ novo: 'pendente', usuario: 'restaurante', quando: minAtras(12) }]),
    },
    {
      origem: 'salao', status: 'preparando', metodoPagamento: 'conta', mesa: 'Mesa 3',
      clienteId: null, nomeCliente: 'Cliente da mesa 3',
      subtotal: 56.00, valorFrete: 0,
      tempoPreparo: 20,
      aceito: minAtras(18), preparo: minAtras(15),
      itens: [
        criarItem({ nome: 'Pizza Calabresa', preco: 48.00 }),
        criarItem({ nome: 'Suco de Laranja', preco: 8.00 }),
      ],
      timeline: criaTimeline([
        { novo: 'pendente', usuario: 'restaurante', quando: minAtras(20) },
        { anterior: 'pendente', novo: 'preparando', usuario: 'restaurante', quando: minAtras(15) },
      ]),
    },
    {
      origem: 'salao', status: 'finalizado', metodoPagamento: 'dinheiro', mesa: 'Mesa 5',
      clienteId: null, nomeCliente: 'Cliente da mesa 5',
      subtotal: 37.90, valorFrete: 0,
      tempoPreparo: 15,
      aceito: minAtras(90), preparo: minAtras(88), pronto: minAtras(70),
      itens: [
        criarItem({ nome: 'X-Salada', preco: 25.90 }),
        criarItem({ nome: 'Pudim', preco: 12.00 }),
      ],
      timeline: criaTimeline([
        { novo: 'pendente', usuario: 'restaurante', quando: minAtras(95) },
        { anterior: 'pendente', novo: 'preparando', usuario: 'restaurante', quando: minAtras(90) },
        { anterior: 'preparando', novo: 'pronto', usuario: 'restaurante', quando: minAtras(70) },
        { anterior: 'pronto', novo: 'finalizado', usuario: 'restaurante', quando: minAtras(45) },
      ]),
    },

    // ── RETIRADA ─────────────────────────────────────────────────────────────
    {
      origem: 'retirada', status: 'pronto_entrega', metodoPagamento: 'pix',
      clienteId: clienteIds.cliente, nomeCliente: 'Maria Silva', telefone: '(11) 99999-8888',
      subtotal: 43.90, valorFrete: 0,
      tempoPreparo: 15,
      aceito: minAtras(30), preparo: minAtras(28), pronto: minAtras(10),
      itens: [
        criarItem({ nome: 'X-Burguer', preco: 28.90 }),
        criarItem({ nome: 'Brownie', preco: 15.00 }),
      ],
      timeline: criaTimeline([
        { novo: 'pendente', usuario: 'cliente', quando: minAtras(35) },
        { anterior: 'pendente', novo: 'preparando', usuario: 'restaurante', quando: minAtras(30) },
        { anterior: 'preparando', novo: 'pronto_entrega', usuario: 'restaurante', quando: minAtras(10) },
      ]),
    },
  ];

  let criados = 0;
  for (const p of pedidos) {
    const pedido = await query(
      `INSERT INTO pedidos (
         restaurant_id, cliente_id, entregador_id,
         nome_cliente, telefone_cliente, endereco_cliente, numero_cliente, bairro_cliente,
         cep_cliente, cidade_cliente, estado_cliente,
         subtotal, valor_frete, total,
         metodo_pagamento, detalhes_pagamento, status, motivo_cancelamento,
         origem, mesa, observacoes,
         tempo_preparo_estimado, tempo_entrega_estimado,
         aceito_em, preparo_inicio_em, pronto_em, transito_inicio_em, destino_chegada_em, entregue_em, cancelado_em
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
         $12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,
         $24,$25,$26,$27,$28,$29,$30
       )
       RETURNING id, pedido_id`,
      [rid, p.clienteId, p.entregadorId || null,
       p.nomeCliente, p.telefone || null, p.endereco || null, p.numero || null, p.bairro || null,
       p.cep || null, p.cidade || null, p.estado || null,
       p.subtotal, p.valorFrete, p.subtotal + p.valorFrete,
       p.metodoPagamento, p.detalhesPagamento || null, p.status, p.motivoCancelamento || null,
       p.origem, p.mesa || null, p.observacoes || null,
       p.tempoPreparo || null, p.tempoEntrega || null,
       p.aceito || null, p.preparo || null, p.pronto || null, p.transito || null, p.destino || null, p.entregue || null, p.cancelado || null]
    );

    for (const item of p.itens) {
      await query(
        `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, extras, opcoes, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [pedido.rows[0].id, item.produtoId, item.nome, item.quantidade, item.precoUnitario,
         JSON.stringify(item.extras), JSON.stringify(item.opcoes), item.subtotal]
      );
    }

    for (const t of p.timeline) {
      await query(
        `INSERT INTO pedido_timeline (pedido_id, pedido_id_ref, status_anterior, status_novo, usuario_tipo, notas, mudado_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [pedido.rows[0].id, pedido.rows[0].pedido_id, t.anterior, t.novo, t.usuario, t.notas, t.quando]
      );
    }

    criados++;
  }

  console.log(`✅ ${criados} pedidos de exemplo criados (delivery + salão + retirada)`);
}

seed();
