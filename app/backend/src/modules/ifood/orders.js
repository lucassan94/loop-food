// ============================================================================
// iFood — Pedidos (Fase 3: ingestão + Fase 4: espelho de status)
// ============================================================================
// 1. INGESTÃO: eventos consumidos no events:polling (polling.js) são processados
//    aqui com dedup por event_id (ifood_events):
//      PLACED          → buscar detalhes e criar pedido interno (origem='ifood')
//      CONFIRMED       → pedido interno 'pendente' → 'preparando'
//      READY_TO_PICKUP → 'pronto_entrega'
//      DISPATCHED      → 'em_transito'
//      DELIVERED       → 'entregue'
//      CONCLUDED       → 'entregue' (final)
//      CANCELLED       → 'cancelado' (com motivo)
//      REJECTED        → 'recusado'
//      INTEGRATION_ERROR/INVALID → registra erro operacional
//
// 2. ESPELHO: quando o painel muda o status de um pedido origem='ifood'
//    (PATCH /pedidos/:id/status), notifica o iFood com a ação correspondente:
//      preparando      → POST /orders/{orderId}/confirmation
//      recusado        → POST /orders/{orderId}/rejection
//      pronto_entrega  → POST /orders/{orderId}/readyToPickup
//      em_transito     → POST /orders/{orderId}/dispatch
//      entregue        → POST /orders/{orderId}/conclusion
//      cancelado       → POST /orders/{orderId}/cancellation
// ============================================================================

import { transactionForTenant, queryForTenant } from '../../config/database.js';
import { AppError } from '../../middleware/errorHandler.js';
import { emitNovoPedido, emitPedidoAtualizado } from '../../services/realtime.js';
import { callIfoodApi } from './api.js';
import { getSettings, registrarErroIfood } from './settings.js';

// Helper de conexão com contexto EXPLÍCITO de tenant (RLS) — estas funções
// rodam em background (polling) e em request, sempre com tenantId conhecido.
const dbForTenant = (tenantId) => (sql, params) => queryForTenant(tenantId, sql, params);

// ──────── HELPERS DE ACESSO ────────

/** Busca o mapeamento ifood_orders por pedido interno (ou orderId iFood). */
async function buscarIfoodOrder(tenantId, { pedidoId = null, orderId = null } = {}) {
  let sql = 'SELECT * FROM ifood_orders WHERE restaurant_id = $1';
  const params = [tenantId];
  if (pedidoId) { sql += ' AND pedido_id = $' + (params.length + 1); params.push(pedidoId); }
  if (orderId) { sql += ' AND ifood_order_id = $' + (params.length + 1); params.push(orderId); }
  sql += ' LIMIT 1';
  const result = await queryForTenant(tenantId, sql, params);
  return result.rows[0] || null;
}

/** Busca um pedido interno completo (com itens). */
async function buscarPedidoInterno(tenantId, pedidoId) {
  const result = await queryForTenant(
    tenantId,
    `SELECT p.*,
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
     FROM pedidos p WHERE p.id = $1`,
    [pedidoId]
  );
  return result.rows[0] || null;
}

/**
 * Atualiza o status de um pedido interno (com timeline + emit).
 * `motivo_cancelamento` SÓ é gravado em cancelado/recusado (campo é de
 * cancelamento — outros eventos não podem poluí-lo).
 */
async function atualizarStatusInterno(tenantId, pedidoId, novoStatus, notas = '') {
  const atual = await queryForTenant(tenantId, 'SELECT * FROM pedidos WHERE id = $1', [pedidoId]);
  if (atual.rows.length === 0) return null;
  const pedido = atual.rows[0];

  const timeFields = {
    'preparando': 'aceito_em',
    'pronto_entrega': 'pronto_em',
    'em_transito': 'transito_inicio_em',
    'entregue': 'entregue_em',
    'cancelado': 'cancelado_em',
  };
  const extra = timeFields[novoStatus] ? `, ${timeFields[novoStatus]} = NOW()` : '';
  const gravarMotivo = ['cancelado', 'recusado'].includes(novoStatus);

  await transactionForTenant(tenantId, async (conn) => {
    await conn.query(
      `UPDATE pedidos SET status = $2, atualizado_em = NOW(),
         motivo_cancelamento = ${gravarMotivo ? '$3' : 'motivo_cancelamento'}${extra}
       WHERE id = $1`,
      gravarMotivo ? [pedidoId, novoStatus, notas || pedido.motivo_cancelamento] : [pedidoId, novoStatus]
    );
    await conn.query(
      `INSERT INTO pedido_timeline (pedido_id, status_anterior, status_novo, usuario_tipo, notas)
       VALUES ($1, $2, $3, 'ifood', $4)`,
      [pedidoId, pedido.status, novoStatus, notas]
    );
  });

  const atualizado = await buscarPedidoInterno(tenantId, pedidoId);
  if (atualizado) emitPedidoAtualizado(atualizado);
  return atualizado;
}

// ──────── CRIAÇÃO DE PEDIDO INTERNO (PLACED) ────────

/** Busca ou cria o cliente placeholder "iFood" do restaurante. */
async function clientePlaceholderIfood(conn, restaurantId) {
  const email = `ifood-placeholder-${restaurantId}@internal.local`;
  const existente = await conn.query(
    `SELECT id FROM clientes WHERE restaurant_id = $1 AND email = $2 LIMIT 1`,
    [restaurantId, email]
  );
  if (existente.rows.length > 0) return existente.rows[0].id;
  const criado = await conn.query(
    `INSERT INTO clientes (restaurant_id, nome, email, senha_hash, ativo)
     VALUES ($1, 'iFood', $2, '$2b$12$placeholder', true)
     RETURNING id`,
    [restaurantId, email]
  );
  return criado.rows[0].id;
}

/**
 * Cria o pedido interno a partir do payload do iFood (origem='ifood').
 * Itens viram avulsos (produto_id NULL) — sem validação de produto interno.
 */
async function criarPedidoInterno(tenantId, payload, settings) {
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new AppError('Payload iFood sem orderId.', 400, 'IFOOD_PAYLOAD_INVALID');

  // Mapeamento defensivo do payload (variações entre versões da API)
  const items = Array.isArray(payload.items) ? payload.items : [];
  const customer = payload.customer || {};
  const endereco = payload.deliveryAddress || payload.delivery_address || {};
  const coords = endereco.coordinates || {};
  const subTotal = Number(payload.subTotal ?? payload.subtotal ?? 0);
  const deliveryFee = Number(payload.deliveryFee ?? payload.delivery_fee ?? 0);
  const total = Number(payload.total ?? (subTotal + deliveryFee));

  const pedido = await transactionForTenant(tenantId, async (conn) => {
    const clienteId = await clientePlaceholderIfood(conn, tenantId);

    const result = await conn.query(
      `INSERT INTO pedidos (
         restaurant_id, cliente_id, origem, nome_cliente, telefone_cliente,
         endereco_cliente, numero_cliente, bairro_cliente, cep_cliente,
         cidade_cliente, estado_cliente, latitude_cliente, longitude_cliente,
         subtotal, valor_frete, total, metodo_pagamento,
         detalhes_pagamento, observacoes, status
       ) VALUES ($1, $2, 'ifood', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, 'ifood', $16, $17, $18)
       RETURNING *`,
      [
        tenantId, clienteId,
        String(customer.name || 'Cliente iFood').substring(0, 200),
        String(customer.phone?.localFormat || customer.phone?.number || '').substring(0, 20),
        String(endereco.formattedAddress || endereco.address || '').substring(0, 500),
        String(endereco.number || '').substring(0, 20),
        String(endereco.district || endereco.bairro || '').substring(0, 100),
        String(endereco.postalCode || endereco.zipCode || '').substring(0, 9),
        String(endereco.city || '').substring(0, 100),
        String(endereco.state || '').substring(0, 2),
        coords.latitude ?? null,
        coords.longitude ?? null,
        subTotal, deliveryFee, total,
        String(payload.observations || '').substring(0, 500),
        `Pedido via iFood ${payload.displayId ? `#${payload.displayId}` : ''}`.trim(),
        'pendente',
      ]
    );
    const pedidoCriado = result.rows[0];

    // Itens avulsos (produto_id NULL — o iFood não mapeia para produtos internos)
    for (const item of items) {
      const extras = (item.options || []).map(o => ({
        nome: String(o.name || ''),
        preco: Number(o.unitPrice ?? o.price ?? 0),
        qty: Number(o.quantity ?? 1),
      })).filter(e => e.nome);
      const precoUnit = Number(item.unitPrice ?? item.price ?? 0);
      const qty = Number(item.quantity ?? 1);
      await conn.query(
        `INSERT INTO pedido_itens
           (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, extras, opcoes, observacao, talheres, subtotal)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, NULL, $8)`,
        [
          pedidoCriado.id,
          String(item.name || 'Item').substring(0, 255),
          qty,
          precoUnit,
          JSON.stringify(extras),
          JSON.stringify([]),
          String(item.observations || '').substring(0, 500),
          (precoUnit * qty) + extras.reduce((acc, e) => acc + (e.preco * (e.qty || 1)), 0),
        ]
      );
    }

    // Timeline do pedido
    await conn.query(
      `INSERT INTO pedido_timeline (pedido_id, status_novo, usuario_tipo, notas)
       VALUES ($1, 'pendente', 'ifood', 'Pedido recebido do iFood')`,
      [pedidoCriado.id]
    );

    // Mapeamento ifood_orders
    await conn.query(
      `INSERT INTO ifood_orders
         (restaurant_id, ifood_order_id, pedido_id, display_id, status_ifood, ultimo_evento, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (restaurant_id, ifood_order_id) DO UPDATE SET
         pedido_id = EXCLUDED.pedido_id,
         display_id = EXCLUDED.display_id,
         status_ifood = EXCLUDED.status_ifood,
         ultimo_evento = EXCLUDED.ultimo_evento,
         raw_payload = EXCLUDED.raw_payload,
         atualizado_em = NOW()`,
      [tenantId, orderId, pedidoCriado.id, String(payload.displayId || ''), 'PLACED', 'PLACED', JSON.stringify(payload)]
    );

    return pedidoCriado;
  });

  const completo = await buscarPedidoInterno(tenantId, pedido.id);
  if (completo) emitNovoPedido(completo);
  return completo;
}

// ──────── PROCESSAMENTO DE EVENTOS ────────

/**
 * Processa um evento do polling do iFood para um tenant.
 * Faz dedup por event_id (ifood_events) e despacha pelo code.
 * Não lança para a fila de erro — registra e segue (robustez do polling).
 */
export async function processarEventoIfood(tenantId, evento, settings = null) {
  const code = evento.code || evento.event_type;
  const eventId = String(evento.id || '');
  if (!code || !eventId) {
    console.warn('[iFood] Evento sem code/id ignorado:', JSON.stringify(evento).substring(0, 200));
    return false;
  }
  if (!settings) settings = await getSettings(tenantId, dbForTenant(tenantId)).catch(() => null);
  if (!settings?.ativo) return false; // tenant desativou no meio do ciclo

  const env = settings.ambiente === 'producao' ? 'production' : 'sandbox';
  const orderId = evento.metadata?.orderId || evento.orderId || null;

  const db = dbForTenant(tenantId);
  const logErro = (nota) => {
    registrarErroIfood(tenantId, nota, db).catch(() => {});
    console.error(`[iFood] Erro processando ${code} (${eventId}):`, nota);
  };

  // ── DEDUP com recuperação de falha transitória ──
  // Evento novo → linha criada (processed=false). Reprocessamento de evento que
  // falhou antes → linha existe com processed=false → reprocessa. Só eventos
  // com processed=true são pulados. processed=true é gravado APENAS após o
  // processamento bem-sucedido (fim do try abaixo) — falha NÃO marca processed,
  // e o iFood NÃO recebe ack, então o evento volta no próximo ciclo.
  let inseriu = false;
  try {
    const dedup = await queryForTenant(
      tenantId,
      `INSERT INTO ifood_events (event_id, event_code, ifood_order_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [eventId, code, orderId]
    );
    inseriu = dedup.rows.length > 0;
  } catch (err) {
    console.error(`[iFood] Erro no dedup do evento ${eventId}:`, err.message);
    return false;
  }

  if (!inseriu) {
    try {
      const existente = await queryForTenant(
        tenantId,
        'SELECT processed FROM ifood_events WHERE event_id = $1',
        [eventId]
      );
      if (existente.rows[0]?.processed) {
        console.log(`[iFood] Evento ${code} (${eventId}) já processado. Ignorando.`);
        return true; // já processado com sucesso — pode dar ack
      }
      console.log(`[iFood] 🔁 Re-processando evento ${code} (${eventId}) que falhou antes.`);
    } catch (err) {
      console.error(`[iFood] Erro ao consultar dedup do evento ${eventId}:`, err.message);
      return false;
    }
  }

  try {
    switch (code) {
      case 'PLACED': {
        // Buscar detalhes do pedido no iFood — falha AQUI LANÇA (o catch externo
        // não marca processed; o evento volta no próximo ciclo para re-tentar).
        const payload = await callIfoodApi('GET', `/order/v1.0/orders/${orderId}`, null, env);
        const criado = await criarPedidoInterno(tenantId, payload || {}, settings);
        if (!criado) { logErro(`PLACED: pedido ${orderId} não pôde ser criado.`); return; }

        // Auto-aceite (SLA ~5-7min): confirma imediatamente se habilitado
        if (settings.auto_aceite) {
          try {
            await callIfoodApi('POST', `/order/v1.0/orders/${orderId}/confirmation`, {}, env);
            await atualizarStatusInterno(tenantId, criado.id, 'preparando', 'Aceito automaticamente (auto-aceite iFood)');
            await queryForTenant(tenantId,
              `UPDATE ifood_orders SET status_ifood = 'CONFIRMED', ultimo_evento = 'CONFIRMED', atualizado_em = NOW()
               WHERE restaurant_id = $1 AND ifood_order_id = $2`,
              [tenantId, orderId]
            ).catch(() => {});
            console.log(`[iFood] ✅ Pedido ${orderId} aceito automaticamente (auto-aceite).`);
          } catch (err) {
            logErro(`Auto-aceite do pedido ${orderId} falhou: ${err.message}`);
          }
        } else {
          console.log(`[iFood] 🆕 Pedido ${orderId} na fila (aguardando aceite).`);
        }
        break;
      }

      case 'CONFIRMED': {
        const link = await buscarIfoodOrder(tenantId, { orderId });
        if (link?.pedido_id) {
          await atualizarStatusInterno(tenantId, link.pedido_id, 'preparando', 'Aceito (evento iFood CONFIRMED)');
          await queryForTenant(tenantId,
            `UPDATE ifood_orders SET status_ifood = $3, ultimo_evento = $3, atualizado_em = NOW()
             WHERE restaurant_id = $1 AND ifood_order_id = $2`,
            [tenantId, orderId, code]
          ).catch(() => {});
        }
        break;
      }

      case 'READY_TO_PICKUP': {
        const link = await buscarIfoodOrder(tenantId, { orderId });
        if (link?.pedido_id) {
          await atualizarStatusInterno(tenantId, link.pedido_id, 'pronto_entrega', 'Pronto (evento iFood READY_TO_PICKUP)');
          await queryForTenant(tenantId,
            `UPDATE ifood_orders SET status_ifood = $3, ultimo_evento = $3, atualizado_em = NOW()
             WHERE restaurant_id = $1 AND ifood_order_id = $2`,
            [tenantId, orderId, code]
          ).catch(() => {});
        }
        break;
      }

      case 'DISPATCHED': {
        const link = await buscarIfoodOrder(tenantId, { orderId });
        if (link?.pedido_id) {
          await atualizarStatusInterno(tenantId, link.pedido_id, 'em_transito', 'Em trânsito (evento iFood DISPATCHED)');
          await queryForTenant(tenantId,
            `UPDATE ifood_orders SET status_ifood = $3, ultimo_evento = $3, atualizado_em = NOW()
             WHERE restaurant_id = $1 AND ifood_order_id = $2`,
            [tenantId, orderId, code]
          ).catch(() => {});
        }
        break;
      }

      case 'DELIVERED':
      case 'CONCLUDED': {
        const link = await buscarIfoodOrder(tenantId, { orderId });
        if (link?.pedido_id) {
          const notas = code === 'CONCLUDED'
            ? 'Concluído (evento iFood CONCLUDED)'
            : 'Entregue (evento iFood DELIVERED)';
          await atualizarStatusInterno(tenantId, link.pedido_id, 'entregue', notas);
          await queryForTenant(tenantId,
            `UPDATE ifood_orders SET status_ifood = $3, ultimo_evento = $3, atualizado_em = NOW()
             WHERE restaurant_id = $1 AND ifood_order_id = $2`,
            [tenantId, orderId, code]
          ).catch(() => {});
        }
        break;
      }

      case 'CANCELLED': {
        const link = await buscarIfoodOrder(tenantId, { orderId });
        if (link?.pedido_id) {
          const motivo = String(evento.metadata?.reason || 'Cancelado pelo iFood/cliente').substring(0, 300);
          await atualizarStatusInterno(tenantId, link.pedido_id, 'cancelado', `Cancelado (iFood): ${motivo}`);
          await queryForTenant(tenantId,
            `UPDATE ifood_orders SET status_ifood = $3, ultimo_evento = $3, atualizado_em = NOW()
             WHERE restaurant_id = $1 AND ifood_order_id = $2`,
            [tenantId, orderId, code]
          ).catch(() => {});
        }
        break;
      }

      case 'REJECTED': {
        const link = await buscarIfoodOrder(tenantId, { orderId });
        if (link?.pedido_id) {
          await atualizarStatusInterno(tenantId, link.pedido_id, 'recusado', 'Recusado (evento iFood REJECTED)');
          await queryForTenant(tenantId,
            `UPDATE ifood_orders SET status_ifood = $3, ultimo_evento = $3, atualizado_em = NOW()
             WHERE restaurant_id = $1 AND ifood_order_id = $2`,
            [tenantId, orderId, code]
          ).catch(() => {});
        }
        break;
      }

      case 'INTEGRATION_ERROR':
      case 'INVALID': {
        const motivo = String(evento.metadata?.reason || `Evento iFood ${code}`).substring(0, 500);
        logErro(`Pedido ${orderId || '?'}: ${motivo}`);
        break;
      }

      default:
        console.log(`[iFood] Evento ${code} (${eventId}) sem handler — ignorado.`);
    }

    // ✅ Sucesso: marca como processado (permite dedup definitivo) e sinaliza
    // ao polling que pode dar ack no iFood (remoção da fila).
    await queryForTenant(
      tenantId,
      `UPDATE ifood_events SET processed = true WHERE event_id = $1`,
      [eventId]
    ).catch(() => {});
    return true;
  } catch (err) {
    logErro(`Erro processando ${code}: ${err.message}`);
    return false; // falhou — NÃO recebe ack, volta no próximo ciclo
  }
}

// ──────── ESPELHO DE STATUS (painel → iFood) ────────

/**
 * Notifica o iFood quando o status interno de um pedido origem='ifood' muda.
 * Fire-and-forget a partir do PATCH /pedidos/:id/status — nunca bloqueia a
 * resposta do painel. Em falha, registra ultimo_erro e loga.
 */
export async function espelharStatusIfood(pedido, novoStatus, motivo = '') {
  if (!pedido || pedido.origem !== 'ifood') return;
  const tenantId = pedido.restaurant_id;
  const db = dbForTenant(tenantId);
  const settings = await getSettings(tenantId, db).catch(() => null);
  if (!settings?.ativo) return;

  const env = settings.ambiente === 'producao' ? 'production' : 'sandbox';
  const link = await buscarIfoodOrder(tenantId, { pedidoId: pedido.id });
  if (!link?.ifood_order_id) return;
  const orderId = link.ifood_order_id;

  // Mapa status interno → ação iFood + status_ifood esperado (anti duplo clique:
  // se o iFood já reflete o estado, não dispara a ação de novo).
  const acoes = {
    'preparando': { method: 'POST', path: `/order/v1.0/orders/${orderId}/confirmation`, body: {}, statusIfood: 'CONFIRMED' },
    'recusado': { method: 'POST', path: `/order/v1.0/orders/${orderId}/rejection`, body: { reason: String(motivo || 'Pedido recusado pelo restaurante').substring(0, 300) }, statusIfood: 'REJECTED' },
    'pronto_entrega': { method: 'POST', path: `/order/v1.0/orders/${orderId}/readyToPickup`, body: {}, statusIfood: 'READY_TO_PICKUP' },
    'em_transito': { method: 'POST', path: `/order/v1.0/orders/${orderId}/dispatch`, body: {}, statusIfood: 'DISPATCHED' },
    'entregue': { method: 'POST', path: `/order/v1.0/orders/${orderId}/conclusion`, body: {}, statusIfood: 'CONCLUDED' },
    'cancelado': { method: 'POST', path: `/order/v1.0/orders/${orderId}/cancellation`, body: { reason: String(motivo || 'Cancelado pelo restaurante').substring(0, 300) }, statusIfood: 'CANCELLED' },
  };
  const acao = acoes[novoStatus];
  if (!acao) return;

  // Guard de idempotência: o espelho roda fire-and-forget a cada PATCH; se o
  // iFood já confirmou este status, pula (evita double-confirmation no clique 2x).
  if (link.status_ifood === acao.statusIfood) {
    console.log(`[iFood] ↪️ ${novoStatus} já espelhado (status_ifood=${acao.statusIfood}). Pulando.`);
    return;
  }

  try {
    await callIfoodApi(acao.method, acao.path, acao.body, env);
    await queryForTenant(tenantId,
      `UPDATE ifood_orders SET status_ifood = $3, ultimo_evento = $3, atualizado_em = NOW()
       WHERE restaurant_id = $1 AND ifood_order_id = $2`,
      [tenantId, orderId, acao.statusIfood]
    ).catch(() => {});
    console.log(`[iFood] ↩️ Espelhado ${novoStatus} → ${acao.path} (pedido interno ${pedido.id}).`);
  } catch (err) {
    registrarErroIfood(tenantId, `Espelho ${novoStatus} pedido ${pedido.id} falhou: ${err.message}`, db).catch(() => {});
    console.error(`[iFood] ❌ Falha ao espelhar ${novoStatus} do pedido interno ${pedido.id}:`, err.message);
  }
}
