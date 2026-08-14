import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../../config/database.js';
import { config } from '../../config/index.js';
import { authenticate, authorize, optionalAuth } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { emitPedidoAtualizado, emitNovoPedido, emitEntregaDisponivel, emitNovaMensagem, emitMensagemLida } from '../../services/realtime.js';
import { espelharStatusIfood } from '../ifood/orders.js';
import { orderLimiter } from '../../middleware/rateLimiter.js';
import { validarEntrega } from '../../services/frete.js';
import { validarItensPedido } from '../../services/itemValidation.js';
import { TZ_RESTAURANTE, lojaAbertaAgora, agoraNoFusoDoRestaurante } from '../../services/horarios.js';

const router = Router();

// Schema de criação de pedido
const createOrderSchema = z.object({
  cliente_id: z.number().optional(),
  origem: z.enum(['delivery', 'salao', 'retirada']).optional().default('delivery'),
  mesa: z.string().optional(),
  nome_cliente: z.string().min(1, 'Nome do cliente é obrigatório.'),
  telefone_cliente: z.string().optional().default(''),
  endereco_cliente: z.string().optional().default(''),
  numero_cliente: z.string().optional().default(''),
  bairro_cliente: z.string().optional().default(''),
  cep_cliente: z.string().optional().default(''),
  cidade_cliente: z.string().optional().default('São Paulo'),
  estado_cliente: z.string().optional().default('SP'),
  // Coordenadas podem chegar como string (ex.: fonte de CEP que devolve string) —
  // normaliza para número; null/vazio/NaN são tratados como ausentes (evita coords 0,0).
  latitude_cliente: z.preprocess((v) => { const n = v === null || v === undefined || String(v).trim() === '' ? NaN : Number(v); return Number.isFinite(n) ? n : undefined; }, z.number().optional()),
  longitude_cliente: z.preprocess((v) => { const n = v === null || v === undefined || String(v).trim() === '' ? NaN : Number(v); return Number.isFinite(n) ? n : undefined; }, z.number().optional()),
  subtotal: z.number().positive(),
  valor_frete: z.number().min(0).optional().default(0),
  total: z.number().positive(),
  metodo_pagamento: z.enum(['dinheiro', 'credito', 'debito', 'pix', 'pix_online', 'credito_online', 'debito_online', 'salao', 'conta']),
  detalhes_pagamento: z.string().optional().default(''),
  tempo_preparo_estimado: z.number().int().positive().optional(),
  tempo_entrega_estimado: z.number().int().positive().optional(),
  observacoes: z.string().optional().default(''),
  itens: z.array(z.object({
    produto_id: z.number(),
    nome_produto: z.string(),
    quantidade: z.number().int().positive(),
    preco_unitario: z.number().positive(),
    extras: z.array(z.object({
      nome: z.string(),
      preco: z.number(),
      qty: z.number().int().positive().optional(),
    })).optional().default([]),
    opcoes: z.array(z.object({
      grupo: z.string(),
      nome: z.string(),
    })).optional().default([]),
    talheres: z.boolean().optional(),
    observacao: z.string().optional().default(''),
    subtotal: z.number().positive(),
  })).min(1, 'Pedido deve ter pelo menos 1 item.'),
});

// Schema simplificado para PDV (salão)
const pdvOrderSchema = z.object({
  origem: z.enum(['delivery', 'salao']).optional().default('salao'),
  mesa: z.string().optional(),
  nome_cliente: z.string().min(1, 'Nome do cliente/mesa é obrigatório.'),
  metodo_pagamento: z.enum(['dinheiro', 'credito', 'debito', 'pix', 'salao', 'conta']),
  observacoes: z.string().optional().default(''),
  itens: z.array(z.object({
    produto_id: z.number(),
    nome_produto: z.string(),
    quantidade: z.number().int().positive(),
    preco_unitario: z.number().positive(),
    extras: z.array(z.object({
      nome: z.string(),
      preco: z.number(),
      qty: z.number().int().positive().optional(),
    })).optional().default([]),
    opcoes: z.array(z.object({
      grupo: z.string(),
      nome: z.string(),
    })).optional().default([]),
    talheres: z.boolean().optional(),
    observacao: z.string().optional().default(''),
    subtotal: z.number().positive(),
  })).min(1, 'Pedido deve ter pelo menos 1 item.'),
});

// ============================
// CRIAR PEDIDO (Cliente / Delivery) — com rate limiting
// ============================
router.post('/', orderLimiter, optionalAuth, async (req, res, next) => {
    try {
      const restaurantId = req.restaurantId || config.restaurantId;
      const data = createOrderSchema.parse(req.body);

      // IMPEDIR pedido fora do raio de entrega (validação server-side).
      // Salão (PDV) não tem endereço/frete — validação só para delivery.
      // Retirada: frete sempre zero e não exige endereço/raio.
      if (data.origem === 'retirada') {
        const restRetirada = await query(
          'SELECT retirada_habilitada FROM restaurantes WHERE id = $1',
          [restaurantId]
        );
        if (!restRetirada.rows[0]?.retirada_habilitada) {
          throw new AppError('A retirada no local está desabilitada. Escolha entrega.', 400);
        }
        data.valor_frete = 0;
        data.total = data.subtotal;
      } else if (data.origem !== 'salao') {
        await validarEntrega(restaurantId, {
          latitude: data.latitude_cliente,
          longitude: data.longitude_cliente,
          estado: data.estado_cliente,
          valorFrete: data.valor_frete,
        });
      }

      // SEGURANÇA: Se autenticado, usar cliente_id do JWT
      // Se não autenticado, permitir guest checkout com cliente_id do body
      const clienteId = req.user?.id || data.cliente_id;

      const result = await transaction(async (client) => {
        // Verificar se a loja está aberta (toggle manual)
        const loja = await client.query(
          'SELECT status_loja, horarios_funcionamento, timezone FROM restaurantes WHERE id = $1',
          [restaurantId]
        );
        if (!loja.rows[0]?.status_loja) {
          throw new AppError('A loja está fechada no momento. Pedidos não podem ser realizados.', 400);
        }
        // Verificar horários de funcionamento (se configurados) — sempre no
        // FUSO DO RESTAURANTE (coluna timezone, default America/Sao_Paulo),
        // nunca no UTC do servidor
        const horarios = loja.rows[0]?.horarios_funcionamento;
        const timezone = loja.rows[0]?.timezone || TZ_RESTAURANTE;
        if (Array.isArray(horarios) && horarios.length === 7) {
          const { diaSemana } = agoraNoFusoDoRestaurante(new Date(), timezone);
          const dia = horarios[diaSemana];
          if (!dia || !dia.aberto) {
            throw new AppError('A loja está fechada hoje. Confira os horários de funcionamento.', 400);
          }
          if (!lojaAbertaAgora(horarios, new Date(), timezone)) {
            const abre = dia.abre || '08:00';
            const fecha = dia.fecha || '23:00';
            throw new AppError(`A loja está fechada neste horário. Funcionamento: ${abre} às ${fecha}.`, 400);
          }
        }

        // Validar itens do pedido (módulos, disponibilidade, talheres, opções)
        await validarItensPedido(client, data.itens, data.origem, timezone);

        // Criar o pedido
        const pedido = await client.query(
          `INSERT INTO pedidos (
          restaurant_id, cliente_id, origem, nome_cliente, telefone_cliente,
          endereco_cliente, numero_cliente, bairro_cliente, cep_cliente,
          cidade_cliente, estado_cliente, latitude_cliente, longitude_cliente,
          subtotal, valor_frete, total, metodo_pagamento,
          detalhes_pagamento, observacoes,
          tempo_preparo_estimado, tempo_entrega_estimado, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, 'pendente')
        RETURNING *`,
          [
            restaurantId, clienteId, data.origem || 'delivery',
            data.nome_cliente, data.telefone_cliente,
            data.endereco_cliente, data.numero_cliente, data.bairro_cliente, data.cep_cliente,
            data.cidade_cliente, data.estado_cliente, data.latitude_cliente, data.longitude_cliente,
            data.subtotal, data.valor_frete, data.total, data.metodo_pagamento,
            data.detalhes_pagamento, data.observacoes,
            data.tempo_preparo_estimado || null, data.tempo_entrega_estimado || null,
          ]
        );

        const pedidoCriado = pedido.rows[0];

        // Inserir itens
        for (const item of data.itens) {
          await client.query(
          `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, extras, opcoes, observacao, talheres, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            pedidoCriado.id, item.produto_id, item.nome_produto,
            item.quantidade, item.preco_unitario,
            JSON.stringify(item.extras), JSON.stringify(item.opcoes || []),
            item.observacao || '', item.talheres ?? null, item.subtotal,
          ]
          );
        }

        // Registrar timeline
        await client.query(
          `INSERT INTO pedido_timeline (pedido_id, status_novo, usuario_tipo)
         VALUES ($1, 'pendente', 'cliente')`,
          [pedidoCriado.id]
        );

        // Atualizar total gasto do cliente (se tiver cliente real)
        if (clienteId) {
          await client.query(
            'UPDATE clientes SET total_gasto = total_gasto + $1, pedidos_total = pedidos_total + 1 WHERE id = $2',
            [data.total, clienteId]
          );
        }

        return pedidoCriado;
      });

    emitNovoPedido(result);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ============================
// CRIAR PEDIDO VIA PDV (Salão) — sem rate limiting, autenticado
// ============================
router.post('/pdv', authenticate, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const data = pdvOrderSchema.parse(req.body);

    const result = await transaction(async (client) => {
      // Buscar ou criar cliente genérico "Salão" para este restaurante
      let salaocliente = await client.query(
        `SELECT id FROM clientes WHERE restaurant_id = $1 AND email LIKE 'salao-placeholder-%' LIMIT 1`,
        [restaurantId]
      );

      let clienteId;
      if (salaocliente.rows.length > 0) {
        clienteId = salaocliente.rows[0].id;
      } else {
        // Criar cliente placeholder se não existir
        const novo = await client.query(
          `INSERT INTO clientes (restaurant_id, nome, email, senha_hash, ativo)
           VALUES ($1, 'Salão', $2, $3, true)
           RETURNING id`,
          [restaurantId, `salao-placeholder-${restaurantId}@internal.local`, '$2b$12$placeholder']
        );
        clienteId = novo.rows[0].id;
      }

      // Validar itens do pedido (módulos, disponibilidade, talheres, opções)
      await validarItensPedido(client, data.itens, 'salao');

      // Calcular subtotal e total dos itens
      let subtotalCalculado = 0;
      for (const item of data.itens) {
        let itemTotal = item.preco_unitario * item.quantidade;
        if (item.extras && item.extras.length > 0) {
          for (const extra of item.extras) {
            itemTotal += (extra.preco || 0) * (extra.qty || 1);
          }
        }
        subtotalCalculado += itemTotal;
      }

      const totalCalculado = subtotalCalculado; // Sem frete para salão

      // Criar o pedido
      const pedido = await client.query(
        `INSERT INTO pedidos (
          restaurant_id, cliente_id, origem, mesa, nome_cliente,
          subtotal, valor_frete, total, metodo_pagamento,
          observacoes, aceito_em, status
        ) VALUES ($1, $2, 'salao', $3, $4, $5, 0, $6, $7, $8, NOW(), 'preparando')
        RETURNING *`,
        [
          restaurantId, clienteId, data.mesa || null,
          data.nome_cliente,
          subtotalCalculado, totalCalculado,
          data.metodo_pagamento, data.observacoes,
        ]
      );

      const pedidoCriado = pedido.rows[0];

      // Inserir itens
      for (const item of data.itens) {
        await client.query(
          `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, extras, opcoes, observacao, talheres, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            pedidoCriado.id, item.produto_id, item.nome_produto,
            item.quantidade, item.preco_unitario,
            JSON.stringify(item.extras || []), JSON.stringify(item.opcoes || []),
            item.observacao || '', item.talheres ?? null,
            (item.preco_unitario * item.quantidade) + (item.extras || []).reduce((acc, e) => acc + (e.preco || 0) * (e.qty || 1), 0),
          ]
        );
      }

      // Registrar timeline (já vai direto para preparando)
      await client.query(
        `INSERT INTO pedido_timeline (pedido_id, status_novo, usuario_tipo, notas)
         VALUES ($1, 'preparando', 'restaurante', 'Pedido criado via PDV (Salão)')`,
        [pedidoCriado.id]
      );

      // Se o pedido tem uma mesa, marcar como ocupada
      if (data.mesa) {
        await client.query(
          `UPDATE mesas SET status = 'ocupada', atualizado_em = NOW()
           WHERE restaurant_id = $1 AND nome = $2`,
          [restaurantId, data.mesa]
        );
      }

      return pedidoCriado;
    });

    emitNovoPedido(result);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ============================
// CHAT RESTAURANTE ↔ CLIENTE (lado do cliente)
// ============================

// Lista as conversas do cliente (pedidos com mensagens) + total de não lidas
router.get('/mensagens/conversas', authenticate, async (req, res, next) => {
  try {
    const { id, role } = req.user;
    if (role !== 'cliente') {
      throw new AppError('Apenas clientes podem listar conversas.', 403);
    }
    const restaurantId = req.restaurantId || config.restaurantId;
    const result = await query(
      `SELECT p.id as pedido_id, p.pedido_id as ref, p.status, p.origem, p.nome_cliente, p.criado_em,
              (SELECT COUNT(*) FROM mensagens_pedido m
               WHERE m.pedido_id = p.id AND m.remetente = 'restaurante' AND NOT m.lida_cliente)::int as nao_lidas,
              (SELECT json_build_object('id', m2.id, 'mensagem', m2.mensagem,
                                        'remetente', m2.remetente, 'criado_em', m2.criado_em)
               FROM mensagens_pedido m2 WHERE m2.pedido_id = p.id
               ORDER BY m2.criado_em DESC LIMIT 1) as ultima
       FROM pedidos p
       WHERE p.cliente_id = $1 AND p.restaurant_id = $2
         AND EXISTS (SELECT 1 FROM mensagens_pedido m WHERE m.pedido_id = p.id)
       ORDER BY COALESCE((SELECT MAX(m3.criado_em) FROM mensagens_pedido m3 WHERE m3.pedido_id = p.id), p.criado_em) DESC`,
      [id, restaurantId]
    );

    const conversas = result.rows.map((c) => ({ ...c, nao_lidas: parseInt(c.nao_lidas || 0) }));
    const totalNaoLidas = conversas.reduce((acc, c) => acc + c.nao_lidas, 0);

    res.json({ conversas, total_nao_lidas: totalNaoLidas });
  } catch (err) {
    next(err);
  }
});

// Total de mensagens não lidas do cliente (badge da aba Mensagens)
router.get('/mensagens/nao-lidas', authenticate, async (req, res, next) => {
  try {
    const { id, role } = req.user;
    if (role !== 'cliente') {
      throw new AppError('Apenas clientes podem consultar mensagens.', 403);
    }
    const result = await query(
      `SELECT COUNT(*)::int as total
       FROM mensagens_pedido m
       JOIN pedidos p ON p.id = m.pedido_id
       WHERE p.cliente_id = $1 AND m.remetente = 'restaurante' AND NOT m.lida_cliente`,
      [id]
    );
    res.json({ total: result.rows[0]?.total || 0 });
  } catch (err) {
    next(err);
  }
});

// Cliente envia uma mensagem no chat do pedido
router.post('/:id/mensagens', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: clienteId, role } = req.user;
    if (role !== 'cliente') {
      throw new AppError('Apenas clientes podem enviar mensagens.', 403);
    }
    const { mensagem } = req.body;
    if (!mensagem || !String(mensagem).trim()) {
      throw new AppError('Mensagem vazia.', 400);
    }
    const texto = String(mensagem).trim().slice(0, 1000);

    // CWE-862: só permite mensagens em pedidos do próprio cliente
    const pedido = await query(
      'SELECT id, restaurant_id FROM pedidos WHERE id = $1 AND cliente_id = $2',
      [id, clienteId]
    );
    if (pedido.rows.length === 0) {
      throw new AppError('Pedido não encontrado.', 404);
    }

    const result = await query(
      `INSERT INTO mensagens_pedido (pedido_id, restaurante_id, mensagem, remetente)
       VALUES ($1, $2, $3, 'cliente') RETURNING *`,
      [id, pedido.rows[0].restaurant_id, texto]
    );
    const msg = result.rows[0];

    // Emite para a sala do restaurante E para o próprio cliente (outros dispositivos)
    emitNovaMensagem(msg, clienteId, pedido.rows[0].restaurant_id);

    res.status(201).json(msg);
  } catch (err) {
    next(err);
  }
});

// Cliente marca as mensagens do restaurante como lidas
router.post('/:id/mensagens/ler', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: clienteId, role } = req.user;
    if (role !== 'cliente') {
      throw new AppError('Apenas clientes podem marcar mensagens como lidas.', 403);
    }
    const pedido = await query(
      'SELECT id, restaurant_id FROM pedidos WHERE id = $1 AND cliente_id = $2',
      [id, clienteId]
    );
    if (pedido.rows.length === 0) {
      throw new AppError('Pedido não encontrado.', 404);
    }

    await query(
      `UPDATE mensagens_pedido SET lida_cliente = TRUE
       WHERE pedido_id = $1 AND remetente = 'restaurante' AND NOT lida_cliente`,
      [id]
    );

    emitMensagemLida({ pedido_id: parseInt(id, 10), lida_cliente: true }, clienteId, pedido.rows[0].restaurant_id);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ============================
// LISTAR PEDIDOS
// ============================
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, data_inicio, data_fim, limit = 50, offset = 0, mesa, origem } = req.query;
    const { id, role } = req.user;

    let sql = `
      SELECT p.*,
             e.nome as entregador_nome,
             COALESCE(
               (SELECT json_agg(json_build_object(
                 'id', pi.id, 'produto_id', pi.produto_id,
                 'nome_produto', pi.nome_produto, 'quantidade', pi.quantidade,
                 'preco_unitario', pi.preco_unitario, 'extras', pi.extras, 'opcoes', pi.opcoes,
                 'observacao', pi.observacao, 'talheres', pi.talheres,
                 'subtotal', pi.subtotal
               )) FROM pedido_itens pi WHERE pi.pedido_id = p.id),
               '[]'::json
             ) as itens
      FROM pedidos p
      LEFT JOIN entregadores e ON p.entregador_id = e.id
      WHERE 1=1
    `;
    const params = [];

    // Filtro por role
    if (role === 'cliente') {
      sql += ' AND p.cliente_id = $' + (params.length + 1);
      params.push(id);
    } else if (role === 'entregador') {
      // Entregadores só veem ENTREGAS — retirada não entra na fila de entregas.
      // Pedidos iFood (entrega própria) também aparecem na fila de entregas.
      sql += " AND p.origem IN ('delivery', 'ifood') AND (p.entregador_id = $" + (params.length + 1) + ' OR (p.entregador_id IS NULL AND p.status = $' + (params.length + 2) + '))';
      params.push(id, 'pronto_entrega');
    }

    // Filtro por restaurante (admin vê todos do restaurante)
    if (role === 'restaurante') {
      const restaurantId = req.restaurantId || config.restaurantId;
      sql += ' AND p.restaurant_id = $' + (params.length + 1);
      params.push(restaurantId);
    }

    // Filtro por status
    if (status) {
      if (status === 'ativos') {
        sql += " AND p.status NOT IN ('entregue', 'finalizado', 'cancelado', 'recusado')";
      } else if (status === 'concluidos') {
        sql += " AND p.status IN ('entregue', 'finalizado')";
      } else if (status === 'cancelados') {
        sql += " AND p.status IN ('cancelado', 'recusado')";
      } else {
        sql += ' AND p.status = $' + (params.length + 1);
        params.push(status);
      }
    }

    // Filtro por nome da mesa (salão) — p.mesa armazena o nome, ex: 'Mesa 5'
    if (mesa) {
      sql += ' AND p.mesa = $' + (params.length + 1);
      params.push(String(mesa));
    }

    // Filtro por origem (salao/delivery)
    if (origem) {
      sql += ' AND p.origem = $' + (params.length + 1);
      params.push(origem);
    }

    // Filtro por data
    if (data_inicio) {
      sql += ' AND p.criado_em >= $' + (params.length + 1);
      params.push(data_inicio);
    }
    if (data_fim) {
      sql += ' AND p.criado_em <= $' + (params.length + 1);
      params.push(data_fim + 'T23:59:59');
    }

    sql += ' ORDER BY p.criado_em DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ============================
// BUSCAR PEDIDO POR ID
// ============================
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, id: userId } = req.user;

    // CWE-862: Clientes só podem ver seus próprios pedidos
    let sql = `
      SELECT p.*,
              e.nome as entregador_nome, e.telefone as entregador_telefone,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', pi.id, 'produto_id', pi.produto_id,
                  'nome_produto', pi.nome_produto, 'quantidade', pi.quantidade,
                  'preco_unitario', pi.preco_unitario, 'extras', pi.extras, 'opcoes', pi.opcoes,
                  'observacao', pi.observacao, 'talheres', pi.talheres,
                  'subtotal', pi.subtotal
                )) FROM pedido_itens pi WHERE pi.pedido_id = p.id),
                '[]'::json
              ) as itens,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', tl.id, 'status_anterior', tl.status_anterior,
                  'status_novo', tl.status_novo, 'usuario_tipo', tl.usuario_tipo,
                  'notas', tl.notas, 'mudado_em', tl.mudado_em
                ) ORDER BY tl.mudado_em ASC)
                FROM pedido_timeline tl WHERE tl.pedido_id = p.id),
                '[]'::json
              ) as timeline,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', mp.id, 'mensagem', mp.mensagem,
                  'lida', mp.lida, 'lida_cliente', mp.lida_cliente,
                  'remetente', mp.remetente, 'criado_em', mp.criado_em
                ) ORDER BY mp.criado_em DESC)
                FROM mensagens_pedido mp WHERE mp.pedido_id = p.id),
                '[]'::json
              ) as mensagens
       FROM pedidos p
       LEFT JOIN entregadores e ON p.entregador_id = e.id
       WHERE p.id = $1
    `;
    const params = [id];

    // Clientes só acessam seus próprios pedidos
    if (role === 'cliente') {
      sql += ' AND p.cliente_id = $2';
      params.push(userId);
    }

    const result = await query(sql, params);

    if (result.rows.length === 0) {
      throw new AppError('Pedido não encontrado.', 404);
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ============================
// ATUALIZAR STATUS DO PEDIDO
// ============================
router.patch('/:id/status', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, motivo, entregador_id, metodo_pagamento } = req.body;
    const { role, id: userId, cargo } = req.user;

    const statusSchema = z.object({
      status: z.enum(['aguardando_pagamento', 'pendente', 'preparando', 'pronto_entrega', 'pronto', 'em_transito', 'cheguei_destino', 'entregue', 'finalizado', 'cancelado', 'recusado']),
      metodo_pagamento: z.string().optional(),
      motivo: z.string().optional(),
      entregador_id: z.number().optional(),
    });

    const data = statusSchema.parse({ status, metodo_pagamento, motivo, entregador_id });

    // ─── PERMISSÕES POR CARGO ───
    // Cada cargo/role só pode fazer as transições permitidas
    const userRole = (role || '').toLowerCase();
    const userCargo = (cargo || '').toLowerCase();

    if (userRole === 'cliente') {
      // CWE-862: Cliente só pode cancelar pedidos próprios
      if (data.status !== 'cancelado') {
        throw new AppError('Clientes só podem cancelar pedidos.', 403);
      }
    } else if (userRole === 'entregador') {
      // Verificar se o restaurante permite entregadores
      const restResult = await query(
        'SELECT modo_sem_entregador FROM restaurantes WHERE id = $1',
        [req.restaurantId || config.restaurantId]
      );
      const modoSemEntregador = restResult.rows[0]?.modo_sem_entregador || false;
      if (modoSemEntregador) {
        throw new AppError('Restaurante está em modo sem entregador. Gerencie a entrega pelo painel.', 403);
      }
      // Entregador: só transições de entrega (em seus pedidos)
      if (!['em_transito', 'cheguei_destino', 'entregue'].includes(data.status)) {
        throw new AppError('Entregadores só podem gerenciar transporte/entrega.', 403);
      }
    } else if (userRole === 'restaurante') {
      // Staff do restaurante: verificar cargo
      // Fallback 'admin' para tokens antigos sem campo cargo
      const effectiveCargo = userCargo || 'admin';

      // Verificar se o restaurante está em modo sem entregador
      // Nesse modo, o restaurante pode mover de pronto_entrega → entregue
      const restResult = await query(
        'SELECT modo_sem_entregador FROM restaurantes WHERE id = $1',
        [req.restaurantId || config.restaurantId]
      );
      const modoSemEntregador = restResult.rows[0]?.modo_sem_entregador || false;

      // Origem do pedido: retirada não envolve entregador — dar baixa (→ entregue)
      // é permitido para chef/caixa mesmo fora do modo sem entregador
      const pedidoOrigemResult = await query('SELECT origem FROM pedidos WHERE id = $1', [id]);
      const isRetirada = pedidoOrigemResult.rows[0]?.origem === 'retirada';

      if (['admin', 'gerente'].includes(effectiveCargo)) {
        // Admin/gerente: qualquer transição
        // Se modo_sem_entregador, permitir pronto_entrega → entregue
      } else if (effectiveCargo === 'chef') {
        // Chef: transições de cozinha + cancelar
        // Salão: pendente→preparando→pronto→finalizado
        // Delivery: pendente→preparando→pronto_entrega, cancelado
        const allowedChef = ['preparando', 'pronto_entrega', 'cancelado', 'pronto', 'finalizado'];
        // Retirada: dar baixa (→ entregue) mesmo com entregadores ativos
        if (isRetirada && data.status === 'entregue') allowedChef.push('entregue');
        if (modoSemEntregador) allowedChef.push('entregue');
        if (!allowedChef.includes(data.status)) {
          throw new AppError('Chef só pode preparar, finalizar ou cancelar pedidos.', 403);
        }
      } else if (effectiveCargo === 'caixa') {
        // Caixa: checkout (finalizado), cancelar/recusar
        // Retirada: caixa pode dar baixa (→ entregue)
        const allowedCaixa = ['finalizado', 'cancelado', 'recusado'];
        if (isRetirada && data.status === 'entregue') allowedCaixa.push('entregue');
        if (!allowedCaixa.includes(data.status)) {
          throw new AppError('Caixa só pode finalizar conta, cancelar ou recusar pedidos.', 403);
        }
      } else {
        throw new AppError('Cargo sem permissão para alterar status.', 403);
      }
    } else {
      throw new AppError('Tipo de usuário sem permissão.', 403);
    }

    const result = await transaction(async (client) => {
      // CWE-862: Ownership check unificado — cliente só acessa pedidos próprios
      const pedidoQuery = userRole === 'cliente'
        ? 'SELECT * FROM pedidos WHERE id = $1 AND cliente_id = $2'
        : 'SELECT * FROM pedidos WHERE id = $1';
      const pedidoParams = userRole === 'cliente' ? [id, userId] : [id];

      const pedido = await client.query(pedidoQuery, pedidoParams);
      if (pedido.rows.length === 0) throw new AppError('Pedido não encontrado.', 404);

      const pedidoAtual = pedido.rows[0];

      // Validar transições de status
      // Atualizar campos de tempo
      const timeFields = {
        'preparando': 'aceito_em',
        'pronto_entrega': 'pronto_em',
        'pronto': 'pronto_em',
        'em_transito': 'transito_inicio_em',
        'cheguei_destino': 'destino_chegada_em',
        'entregue': 'entregue_em',
        'finalizado': 'entregue_em',
        'cancelado': 'cancelado_em',
      };

      const updates = ['status = $2', 'atualizado_em = NOW()'];
      const params = [id, data.status];
      let paramIdx = 3;

      if (timeFields[data.status]) {
        updates.push(`${timeFields[data.status]} = NOW()`);
      }

      if (data.motivo) {
        updates.push(`motivo_cancelamento = $${paramIdx}`);
        params.push(data.motivo);
        paramIdx++;
      }

      if (data.metodo_pagamento) {
        updates.push(`metodo_pagamento = $${paramIdx}`);
        params.push(data.metodo_pagamento);
        paramIdx++;
      }

      if (data.entregador_id) {
        updates.push(`entregador_id = $${paramIdx}`);
        params.push(data.entregador_id);
        paramIdx++;
      }

      await client.query(
        `UPDATE pedidos SET ${updates.join(', ')} WHERE id = $1`,
        params
      );

      // Registrar timeline
      // usuarioTipo é o tipo geral (cliente/entregador/restaurante),
      // não o cargo específico (admin/gerente/chef/caixa).
      // O campo NOTAS da timeline pode registrar o cargo específico.
      let usuarioTipo = role;
      if (role === 'restaurante') usuarioTipo = 'restaurante';

      await client.query(
        `INSERT INTO pedido_timeline (pedido_id, pedido_id_ref, status_anterior, status_novo, usuario_id, usuario_tipo, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, pedidoAtual.pedido_id, pedidoAtual.status, data.status, userId, usuarioTipo, data.motivo || '']
      );

      // Se entregue, atualizar contadores do entregador
      if (data.status === 'entregue' && pedidoAtual.entregador_id) {
        await client.query(
          `UPDATE entregadores SET
            entregas_total = entregas_total + 1,
            frete_total_recebido = frete_total_recebido + $1,
            ultima_entrega_em = NOW()
           WHERE id = $2`,
          [pedidoAtual.valor_frete, pedidoAtual.entregador_id]
        );
      }

      // Se o pedido for de salão com mesa, atualizar status da mesa
      const isSalaoStatusFinal = ['finalizado', 'cancelado', 'recusado'].includes(data.status);
      if (isSalaoStatusFinal && pedidoAtual.origem === 'salao' && pedidoAtual.mesa) {
        // Verificar se ainda existem outros pedidos ATIVOS na mesma mesa
        const outrosAtivos = await client.query(
          `SELECT COUNT(*) as count FROM pedidos
           WHERE restaurant_id = $1 AND mesa = $2 AND origem = 'salao'
             AND id != $3
             AND status NOT IN ('entregue', 'finalizado', 'cancelado', 'recusado')`,
          [pedidoAtual.restaurant_id, pedidoAtual.mesa, id]
        );

        // Se não houver outros pedidos ativos, liberar a mesa
        if (parseInt(outrosAtivos.rows[0].count) === 0) {
          await client.query(
            `UPDATE mesas SET status = 'livre', atualizado_em = NOW()
             WHERE restaurant_id = $1 AND nome = $2`,
            [pedidoAtual.restaurant_id, pedidoAtual.mesa]
          );
        }
      }

      // Buscar pedido atualizado
      const updated = await client.query('SELECT * FROM pedidos WHERE id = $1', [id]);
      return updated.rows[0];
    });

    emitPedidoAtualizado(result);

    // Fase 4: pedidos do iFood espelham o novo status no iFood (fire-and-forget;
    // nunca bloqueia a resposta — falha é logada e registrada em ultimo_erro).
    if (result.origem === 'ifood') {
      espelharStatusIfood(result, data.status, data.motivo).catch((err) => {
        console.error(`[iFood] Espelho de status do pedido ${result.id} falhou:`, err.message);
      });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================
// CALCULAR FRETE
// ============================
router.post('/calcular-frete', async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { latitude, longitude, estado } = req.body;

    // Delega a validarEntrega: MESMO critério usado na criação do pedido
    // (raio real com coordenadas; state check + fallback sem coordenadas).
    // Garante que o frete mostrado no checkout é o mesmo validado no pedido.
    const frete = await validarEntrega(restaurantId, { latitude, longitude, estado });
    return res.json(frete);
  } catch (err) {
    next(err);
  }
});

export default router;
