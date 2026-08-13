// ============================================================================
// iFood — Polling de eventos (Fase 3) + watchdog (Fase 6)
// ============================================================================
// Consome a fila oficial de eventos do iFood (events:polling) por tenant ativo:
//   1. GET  /order/v1.0/events:polling?types=PLACED,...  → lista de eventos
//   2. processarEventoIfood() para cada evento (dedup + dispatch, orders.js)
//   3. DELETE /order/v1.0/events/acknowledgment          → confirma os processados
//
// Regras de robustez (espelho do pollingRede.js):
//   - Sem concorrência: se o ciclo anterior ainda roda, pula
//   - Rate limit por ciclo: MAX_POR_CICLO eventos por tenant
//   - Falha em um tenant não derruba o ciclo dos demais
//   - Watchdog: falhas consecutivas geram alerta (log + estado exposto no /status)
// ============================================================================

import { config } from '../../config/index.js';
import { queryForTenant } from '../../config/database.js';
import { callIfoodApi } from './api.js';
import { processarEventoIfood } from './orders.js';

const MAX_POR_CICLO = 20;

// Códigos de evento de pedido que consumimos (filtrando ruído de catálogo etc.)
const TYPES_FILTRO = [
  'PLACED', 'CONFIRMED', 'READY_TO_PICKUP', 'DISPATCHED',
  'DELIVERED', 'CONCLUDED', 'CANCELLED', 'REJECTED',
  'INTEGRATION_ERROR', 'INVALID',
].join(',');

let intervalHandle = null;
let running = false;

// ── Estado do watchdog (exposto no GET /api/ifood/status) ──
const estado = {
  rodando: false,
  ultimoCiclo: null,        // ISO
  ultimoCicloOk: null,      // ISO (último sem falha fatal)
  ultimoErro: null,
  falhasConsecutivas: 0,
  ciclos: 0,
  eventosProcessados: 0,
  tenants: [],
};

/** Estado público do polling (diagnóstico / Fase 6). */
export function getPollingState() {
  return { ...estado, tenants: [...estado.tenants] };
}

/**
 * Lista os tenants com integração ativa. A tabela restaurantes NÃO tem RLS
 * (tenantResolver por design), então a leitura global funciona em background.
 * Em seguida, lê ifood_settings POR TENANT (contexto explícito — RLS ativo).
 */
async function buscarTenantsAtivos() {
  const tenants = await queryForTenant(
    config.restaurantId,
    'SELECT id FROM restaurantes ORDER BY id'
  );
  const ids = tenants.rows.map(r => r.id);

  const ativos = [];
  for (const id of ids) {
    try {
      const res = await queryForTenant(
        id,
        'SELECT ativo, merchant_id, ambiente, auto_aceite FROM ifood_settings WHERE restaurant_id = $1',
        [id]
      );
      const s = res.rows[0];
      if (s?.ativo && s.merchant_id) {
        ativos.push({ id, merchantId: s.merchant_id, ambiente: s.ambiente || 'sandbox', autoAceite: s.auto_aceite });
      }
    } catch (err) {
      // Linha/tabela ausente para este tenant — ignora silenciosamente
    }
  }
  return ativos;
}

/** Consome e processa os eventos de UM tenant. */
async function processarTenant(tenant) {
  const env = tenant.ambiente === 'producao' ? 'production' : 'sandbox';
  const resp = await callIfoodApi('GET', `/order/v1.0/events:polling?types=${TYPES_FILTRO}`, null, env);
  const events = Array.isArray(resp?.events) ? resp.events : [];
  const alvo = events.slice(0, MAX_POR_CICLO);

  // Só eventos com processamento BEM-SUCEDIDO recebem ack — falha transitória
  // fica na fila do iFood e volta no próximo ciclo (retry natural).
  const ackIds = [];
  for (const evento of alvo) {
    const ok = await processarEventoIfood(tenant.id, evento);
    if (ok) {
      ackIds.push(evento.id);
      estado.eventosProcessados++;
    }
  }

  const ids = ackIds.filter(Boolean);
  if (ids.length > 0) {
    await callIfoodApi('DELETE', '/order/v1.0/events/acknowledgment', ids.map(id => ({ id })), env);
  }

  const naoAck = alvo.length - ids.length;
  if (alvo.length > 0) {
    console.log(`[iFood] 🔄 Tenant ${tenant.id}: ${alvo.length} evento(s), ${ids.length} ack'd${naoAck ? `, ${naoAck} pendente(s) de re-try` : ''}.`);
  }
  return alvo.length;
}

/** Executa um ciclo completo do polling (todos os tenants ativos). */
async function executarCiclo() {
  if (running) return; // sem concorrência
  running = true;
  estado.rodando = true;
  try {
    const tenants = await buscarTenantsAtivos();
    estado.tenants = tenants.map(t => ({ id: t.id, ambiente: t.ambiente }));
    let total = 0;

    for (const tenant of tenants) {
      try {
        total += await processarTenant(tenant);
      } catch (err) {
        console.error(`[iFood] ❌ Falha no polling do tenant ${tenant.id}:`, err.message);
      }
    }

    estado.ultimoCiclo = new Date().toISOString();
    estado.ultimoCicloOk = new Date().toISOString();
    estado.falhasConsecutivas = 0;
    estado.ultimoErro = null;
    if (total > 0) console.log(`[iFood] 🔄 ${total} evento(s) no ciclo (${tenants.length} tenant(s) ativos).`);
  } catch (err) {
    estado.ultimoCiclo = new Date().toISOString();
    estado.ultimoErro = err.message;
    estado.falhasConsecutivas++;
    console.error(`[iFood] ❌ Erro no ciclo de polling: ${err.message}`);
    if (estado.falhasConsecutivas >= 5) {
      console.error(`[iFood] 🚨 ALERTA: polling falhou ${estado.falhasConsecutivas} ciclos seguidos — pedidos podem não chegar à fila!`);
    }
  } finally {
    estado.ciclos++;
    running = false;
    estado.rodando = false;
  }
}

/** Inicia o polling de eventos. Idempotente. */
export function iniciarPollingIfood() {
  if (intervalHandle) return intervalHandle;
  console.log(`[iFood] 🚀 Iniciando polling de eventos (a cada ${config.ifood.pollingIntervalMs / 1000}s).`);
  intervalHandle = setInterval(executarCiclo, config.ifood.pollingIntervalMs);
  intervalHandle.unref();
  return intervalHandle;
}

/** Para o polling (testes / graceful shutdown). */
export function pararPollingIfood() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
