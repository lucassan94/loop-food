// ============================================================================
// POLLING DE BACKUP (15s) — confirmação de pagamento da Rede
// ============================================================================
// Fallback do webhook: se a notificação PIX não chegar (ex: URL não cadastrada
// no call center, rede do servidor, etc.), este serviço consulta o status REAL
// da transação na Rede e:
//   - Ativa o pedido quando o pagamento está Approved (mesmo processamento do webhook)
//   - Cancela o pedido quando o QR PIX expirou (returnCode 3036 / status Canceled)
//   - Desiste (cancela) após a expiração do PIX + margem, mesmo sem resposta da Rede
//
// Regras de segurança:
//   - Rate limit: no máximo MAX_POR_CICLO pedidos consultados por ciclo
//   - Sem concorrência: se o ciclo anterior ainda está rodando, pula
//   - Timeout por chamada herdado do serviço rede.js (30s)
//   - Guarda de bloqueio por pedido via pedido_criado_em (evita reprocessar)
// ============================================================================

import { query } from '../config/database.js';
import { config } from '../config/index.js';
import * as rede from './rede.js';
import { processarEventoRede } from '../modules/pagamentos/redeWebhookHandler.js';

const POLLING_INTERVAL_MS = 15 * 1000; // 15s (decisão do usuário)
const MAX_POR_CICLO = 20;              // limite de taxa (evita HTTP 429)
const EXPIRY_MARGEM_MS = 5 * 60 * 1000; // margem extra além da expiração do PIX

let running = false;
let intervalHandle = null;

/**
 * Busca pedidos aguardando pagamento com pagamento PENDING (não finalizado).
 * Ordena pelos mais antigos primeiro (FIFO) e limita por ciclo.
 */
async function buscarPedidosPendentes() {
  const result = await query(
    `     SELECT o.id, o.restaurant_id, o.criado_em,
            pg.id as pagamento_id, pg.payment_id as tid, pg.valor_bruto,
            pg.billing_type, pg.restaurant_id as pagamento_restaurant_id
     FROM pedidos o
     JOIN pagamentos pg ON pg.pedido_id = o.id
     WHERE o.status = 'aguardando_pagamento'
       AND pg.status = 'PENDING'
     ORDER BY o.criado_em ASC
     LIMIT $1`,
    [MAX_POR_CICLO]
  );
  return result.rows;
}

/**
 * Cancela um pedido que estava aguardando pagamento (motivo de expiração).
 */
async function cancelarPedidoExpirado(pedidoId, tid, motivo) {
  await query(
    `UPDATE pedidos
     SET status = 'cancelado', motivo_cancelamento = $2, atualizado_em = NOW()
     WHERE id = $1 AND status = 'aguardando_pagamento'`,
    [pedidoId, motivo]
  );
  await query(
    `UPDATE pagamentos SET status = 'OVERDUE', atualizado_em = NOW() WHERE payment_id = $1`,
    [tid]
  ).catch(() => {});
  console.warn(`[PollingRede] ⏰ Pedido ${pedidoId} cancelado: ${motivo} (TID ${tid})`);
}

/**
 * Processa um único pedido pendente.
 */
async function processarPedido(pedido) {
  const tenantId = pedido.pagamento_restaurant_id || pedido.restaurant_id || null;
  const tid = pedido.tid;

  // Idade do pedido: expiração do PIX + margem → desiste mesmo sem resposta da Rede.
  // ⚠️ Aplicado APENAS para PIX: cartão em desafio 3DS pode levar mais de 20min
  // (cliente autenticando no banco) — não deve ser cancelado por tempo.
  if (pedido.billing_type === 'PIX') {
    const expiracaoPrevista = new Date(pedido.criado_em).getTime()
      + config.rede.pixExpiryMinutes * 60 * 1000
      + EXPIRY_MARGEM_MS;

    if (Date.now() > expiracaoPrevista) {
      await cancelarPedidoExpirado(
        pedido.id, tid,
        'Pagamento não confirmado no prazo (QR Code PIX expirado)'
      );
      return;
    }
  }

  let consulta;
  try {
    consulta = await rede.consultarTransacao(tid, tenantId);
  } catch (err) {
    // Erro de rede/configuração → tentar no próximo ciclo
    console.warn(`[PollingRede] ⚠️ Falha ao consultar TID ${tid} (pedido ${pedido.id}): ${err.message}`);
    return;
  }

  // ✅ Pago → mesmo processamento do webhook (ativa pedido)
  if (consulta.status === 'Approved') {
    await processarEventoRede({
      id: `polling-${tid}-${Date.now()}`,
      events: ['PV.UPDATE_TRANSACTION_PIX'],
      data: { id: tid },
    });
    console.log(`[PollingRede] ✅ Pedido ${pedido.id} ativado (TID ${tid} Approved).`);
    return;
  }

  // ⏰ Expirado → cancela pedido
  if (consulta.returnCode === '3036' || consulta.status === 'Canceled') {
    await cancelarPedidoExpirado(pedido.id, tid, 'QR Code PIX expirado (Rede)');
    return;
  }

  // ❌ Cartão negado (pós-3DS) → cancela pedido com motivo
  if (consulta.status === 'Denied') {
    await query(
      `UPDATE pedidos
       SET status = 'cancelado', motivo_cancelamento = 'Cartão recusado pelo emissor', atualizado_em = NOW()
       WHERE id = $1 AND status = 'aguardando_pagamento'`,
      [pedido.id]
    );
    await query(
      `UPDATE pagamentos SET status = 'REFUSED', atualizado_em = NOW() WHERE payment_id = $1`,
      [tid]
    ).catch(() => {});
    console.warn(`[PollingRede] ❌ Pedido ${pedido.id} cancelado: cartão recusado (TID ${tid}).`);
    return;
  }

  // Demais status (ex: Pending): manter pendente para o próximo ciclo
}

/**
 * Executa um ciclo do polling.
 */
async function executarCiclo() {
  if (running) return; // sem concorrência
  running = true;
  try {
    const pedidos = await buscarPedidosPendentes();
    if (pedidos.length > 0) {
      console.log(`[PollingRede] 🔄 ${pedidos.length} pedido(s) aguardando pagamento (ciclo).`);
    }
    for (const pedido of pedidos) {
      try {
        await processarPedido(pedido);
      } catch (err) {
        console.error(`[PollingRede] ❌ Erro processando pedido ${pedido.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[PollingRede] ❌ Erro no ciclo de polling:', err.message);
  } finally {
    running = false;
  }
}

/**
 * Inicia o polling de backup. Idempotente.
 */
export function iniciarPollingRede() {
  if (intervalHandle) return intervalHandle;

  console.log(`[PollingRede] 🚀 Iniciando polling de backup (a cada ${POLLING_INTERVAL_MS / 1000}s).`);
  // Primeiro ciclo após 15s (evita corrida com o boot)
  intervalHandle = setInterval(executarCiclo, POLLING_INTERVAL_MS);
  intervalHandle.unref(); // não impede o processo de encerrar
  return intervalHandle;
}

/**
 * Para o polling (usado em testes/graceful shutdown).
 */
export function pararPollingRede() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
