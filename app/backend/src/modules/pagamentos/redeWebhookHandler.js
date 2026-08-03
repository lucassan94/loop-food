// ============================================================================
// Webhook Handler da Rede (e-Rede v2) — processa notificações de PIX
// ============================================================================
// Payload oficial:
// {
//   "id": "f526fd25-...",            // id top-level = chave de dedup
//   "merchantId": "90104480",        // PV (rede_client_id) → identifica tenant
//   "events": ["PV.UPDATE_TRANSACTION_PIX"],
//   "data": {
//     "txid": "RERO...",             // identificador da cobrança
//     "id": "40402508050758050105",  // TID da transação → pagamentos.payment_id
//     "endToEndId": "E00000000..."   // id da liquidação PIX (BACEN)
//   }
// }
//
// Eventos:
//   PV.UPDATE_TRANSACTION_PIX → PIX aprovado (pago) → ativa pedido
//   PV.REFUND_PIX             → devolução (total/parcial) via canais Itaú
//
// ⚠️ Devoluções feitas pela NOSSA API não geram evento (resposta síncrona).
// ============================================================================

import { transaction, transactionForTenant } from '../../config/database.js';
import { emitPedidoAtualizado, emitNovoPedido } from '../../services/realtime.js';

/**
 * Atualiza o pagamento local a partir do TID (data.id) do webhook.
 * Retorna o pagamento atualizado (ou null).
 */
async function buscarPagamentoPorTid(conn, tid) {
  const result = await conn.query(
    `SELECT pg.*, o.restaurant_id as pedido_restaurant_id, o.status as pedido_status
     FROM pagamentos pg
     JOIN pedidos o ON o.id = pg.pedido_id
     WHERE pg.payment_id = $1
     ORDER BY pg.criado_em DESC
     LIMIT 1`,
    [tid]
  );
  return result.rows[0] || null;
}

async function atualizarPagamento(conn, paymentId, status, extras = {}) {
  const params = [status, paymentId];
  let idx = 3;
  const sets = ['status = $1', 'atualizado_em = NOW()', "gateway = 'rede'"];

  if (extras.pago_em) { sets.push(`pago_em = $${idx++}`); params.push(extras.pago_em); }
  if (extras.end_to_end_id) { sets.push(`end_to_end_id = $${idx++}`); params.push(extras.end_to_end_id); }
  if (extras.return_code) { sets.push(`return_code = $${idx++}`); params.push(extras.return_code); }

  return conn.query(
    `UPDATE pagamentos SET ${sets.join(', ')} WHERE payment_id = $2`,
    params
  );
}

/**
 * Ativa o pedido que estava aguardando pagamento (após PIX aprovado).
 */
async function ativarPedido(conn, pedidoId) {
  const result = await conn.query(
    `UPDATE pedidos
     SET status = 'pendente', atualizado_em = NOW()
     WHERE id = $1 AND status = 'aguardando_pagamento'
     RETURNING *`,
    [pedidoId]
  );

  if (result.rows.length > 0) {
    const pedido = result.rows[0];
    emitNovoPedido(pedido);

    await conn.query(
      `INSERT INTO pedido_timeline (pedido_id, status_anterior, status_novo, usuario_tipo, notas)
       VALUES ($1, 'aguardando_pagamento', 'pendente', 'sistema', 'Pagamento PIX confirmado via Rede')`,
      [pedido.id]
    );
    return pedido;
  }
  return null;
}

function notificarAdmin(mensagem) {
  console.warn(`[Rede] ⚠️ Notificação admin: ${mensagem}`);
}

// ──────── HANDLERS ────────

const EVENT_HANDLERS = {
  // ⭐ PIX aprovado (pago)
  'PV.UPDATE_TRANSACTION_PIX': async (payload, conn) => {
    const tid = payload?.data?.id;
    if (!tid) {
      console.warn('[Rede] Webhook UPDATE_TRANSACTION_PIX sem data.id (TID).');
      return;
    }

    const pagamento = await buscarPagamentoPorTid(conn, tid);
    if (!pagamento) {
      console.warn(`[Rede] Webhook PIX recebido mas nenhum pagamento local com TID ${tid}.`);
      return;
    }

    await atualizarPagamento(conn, tid, 'RECEIVED', {
      pago_em: new Date(),
      end_to_end_id: payload?.data?.endToEndId || null,
      return_code: '00',
    });

    const pedidoAtivado = await ativarPedido(conn, pagamento.pedido_id);
    console.log(`[Rede] PIX aprovado: TID ${tid} → pedido ${pagamento.pedido_id}${pedidoAtivado ? ' ativado' : ' (já ativo/finalizado)'}`);
  },

  // 💰 Devolução (PIX) — via canais Itaú (bankline etc.)
  'PV.REFUND_PIX': async (payload, conn) => {
    const tid = payload?.data?.id;
    if (!tid) {
      console.warn('[Rede] Webhook REFUND_PIX sem data.id (TID).');
      return;
    }

    const pagamento = await buscarPagamentoPorTid(conn, tid);
    if (!pagamento) {
      console.warn(`[Rede] Webhook REFUND_PIX recebido mas nenhum pagamento local com TID ${tid}.`);
      return;
    }

    await atualizarPagamento(conn, tid, 'REFUNDED');

    if (pagamento.pedido_status !== 'cancelado') {
      const cancelado = await conn.query(
        `UPDATE pedidos
         SET status = 'cancelado', motivo_cancelamento = 'Reembolso PIX (devolução via Rede)', atualizado_em = NOW()
         WHERE id = $1
         RETURNING *`,
        [pagamento.pedido_id]
      );
      if (cancelado.rows.length > 0) {
        emitPedidoAtualizado(cancelado.rows[0]);
        await conn.query(
          `INSERT INTO pedido_timeline (pedido_id, status_anterior, status_novo, usuario_tipo, notas)
           VALUES ($1, $2, 'cancelado', 'sistema', 'Reembolso PIX (devolução via Rede)')`,
          [pagamento.pedido_id, pagamento.pedido_status]
        );
      }
    }

    notificarAdmin(`PIX devolvido: TID ${tid} (pedido ${pagamento.pedido_id}).`);
    console.log(`[Rede] Devolução PIX processada: TID ${tid} → pedido ${pagamento.pedido_id}`);
  },
};

// ──────── PROCESSADOR PRINCIPAL ────────

/**
 * Processa o payload do webhook da Rede.
 *
 * @param {object} payload - corpo do webhook ({ id, merchantId, events, data })
 * @param {number|null} tenantId - ID do restaurante (obrigatório quando não há
 *   request em andamento — ex: polling de backup, webhook fire-and-forget).
 *   Com a role app_user (RLS ativo), sem esse contexto o processamento ficaria
 *   restrito ao tenant do config.restaurantId e quebraria tenants 2/3.
 */
export async function processarEventoRede(payload, tenantId = null) {
  const event = Array.isArray(payload?.events) ? payload.events[0] : payload?.events;
  if (!event) {
    console.warn('[Rede] Webhook sem eventos. Ignorando.');
    return;
  }

  const handler = EVENT_HANDLERS[event];
  if (!handler) {
    console.warn(`[Rede] Evento desconhecido: ${event}`);
    return;
  }

  if (tenantId) {
    await transactionForTenant(tenantId, async (conn) => {
      await handler(payload, conn);
    });
  } else {
    // Sem tenant explícito: usa o contexto do request atual (quando houver)
    await transaction(async (conn) => {
      await handler(payload, conn);
    });
  }

  console.log(`[Rede] Evento ${event} processado (webhook id ${payload?.id}${tenantId ? `, tenant ${tenantId}` : ''})`);
}
