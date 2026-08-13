// ============================================================================
// iFood — Rotas (Fases 1–6)
// ============================================================================
//   GET  /api/ifood/status        → estado (credenciais, token, polling, métricas)
//   POST /api/ifood/token         → força renovação do token (valida credenciais)
//   GET  /api/ifood/settings      → configurações do tenant
//   PUT  /api/ifood/settings      → upsert das configurações
//   POST /api/ifood/catalog/sync  → sincroniza cardápio → iFood (Fase 2)
//   GET  /api/ifood/metrics       → métricas operacionais (Fase 6)
//   POST /api/ifood/orders/:pedidoId/sync → redesync de um pedido (Fase 6)
// ============================================================================

import { Router } from 'express';
import { config } from '../../config/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { apiLimiter } from '../../middleware/rateLimiter.js';
import { AppError } from '../../middleware/errorHandler.js';
import { queryForTenant } from '../../config/database.js';
import {
  getAccessToken,
  getTokenCacheState,
  clearTokenCache,
  credenciaisConfiguradas,
  ambienteAtual,
} from './auth.js';
import { getSettings, upsertSettings, registrarErroIfood } from './settings.js';
import { sincronizarCatalogo } from './catalog.js';
import { getPollingState } from './polling.js';
import { callIfoodApi } from './api.js';

const router = Router();

// Restringe a integração iFood a cargos administrativos do restaurante
// (role 'restaurante' passa por cargo — chef/caixa ficam de fora).
const ifoodAdmin = authorize('admin', 'gerente');

// GET /api/ifood/status — diagnóstico (sem chamadas externas)
router.get('/status', authenticate, ifoodAdmin, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const settings = await getSettings(restaurantId).catch(() => null);
    res.json({
      configurado: credenciaisConfiguradas(),
      ambienteGlobal: ambienteAtual(), // env das credenciais (config global)
      ambienteTenant: settings?.ambiente || null, // env escolhido pelo tenant
      settings: settings ? {
        ativo: settings.ativo,
        ambiente: settings.ambiente,
        merchantId: settings.merchant_id,
        deliveryMode: settings.delivery_mode,
        syncCatalogo: settings.sync_catalogo,
        autoAceite: settings.auto_aceite,
        ultimaSync: settings.ultima_sync_em,
        ultimoErro: settings.ultimo_erro,
      } : null,
      token: getTokenCacheState(),
      polling: getPollingState(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/ifood/settings — configurações do tenant atual (cria padrão se não houver)
router.get('/settings', authenticate, ifoodAdmin, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    res.json(await getSettings(restaurantId));
  } catch (err) {
    next(err);
  }
});

// PUT /api/ifood/settings — upsert completo das configurações do tenant
router.put('/settings', authenticate, ifoodAdmin, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    res.json(await upsertSettings(restaurantId, req.body));
  } catch (err) {
    next(err);
  }
});

// POST /api/ifood/token — força renovação do token (valida credenciais reais)
// Rate limited: dispara chamada OAuth real ao iFood a cada request.
// Usa o AMBIENTE do tenant (ifood_settings) ou o informado no body — o token
// do sandbox e o da produção são cacheados separadamente no auth.js.
router.post('/token', apiLimiter, authenticate, ifoodAdmin, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const settings = await getSettings(restaurantId).catch(() => null);
    const ambienteBody = req.body?.ambiente;
    const env = (ambienteBody || settings?.ambiente || 'sandbox') === 'producao' ? 'production' : 'sandbox';
    clearTokenCache(env);
    const token = await getAccessToken(env);
    res.json({
      ok: Boolean(token),
      ambiente: env,
      token: getTokenCacheState(env),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ifood/catalog/sync — sincroniza o cardápio com o iFood (Fase 2)
router.post('/catalog/sync', apiLimiter, authenticate, ifoodAdmin, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const resumo = await sincronizarCatalogo(restaurantId, req.body?.ambiente || null);
    res.json(resumo);
  } catch (err) {
    next(err);
  }
});

// GET /api/ifood/metrics — métricas operacionais da integração (Fase 6)
router.get('/metrics', authenticate, ifoodAdmin, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const settings = await getSettings(restaurantId).catch(() => null);

    // Pedidos iFood por status interno
    const porStatus = await queryForTenant(
      restaurantId,
      `SELECT status, COUNT(*)::int as total
       FROM pedidos WHERE restaurant_id = $1 AND origem = 'ifood'
       GROUP BY status ORDER BY status`,
      [restaurantId]
    ).catch(() => ({ rows: [] }));

    // Últimos eventos processados (dedup) — ifood_events NÃO tem RLS (dedup
    // cross-tenant, como webhook_events): o JOIN com ifood_orders garante que
    // só eventos DESTE tenant vazem para a métrica (anti vazamento cross-tenant).
    const ultimosEventos = await queryForTenant(
      restaurantId,
      `SELECT e.event_code, e.ifood_order_id, e.processed, e.criado_em
       FROM ifood_events e
       JOIN ifood_orders io ON io.ifood_order_id = e.ifood_order_id
       WHERE io.restaurant_id = $1
       ORDER BY e.criado_em DESC LIMIT 10`,
      [restaurantId]
    ).catch(() => ({ rows: [] }));

    // Últimos pedidos iFood
    const ultimosPedidos = await queryForTenant(
      restaurantId,
      `SELECT io.ifood_order_id, io.display_id, io.status_ifood, p.status as status_interno,
              io.criado_em, p.total
       FROM ifood_orders io
       LEFT JOIN pedidos p ON p.id = io.pedido_id
       WHERE io.restaurant_id = $1
       ORDER BY io.criado_em DESC LIMIT 10`,
      [restaurantId]
    ).catch(() => ({ rows: [] }));

    res.json({
      ambiente: settings?.ambiente || 'sandbox',
      ativo: settings?.ativo || false,
      ultimaSync: settings?.ultima_sync_em || null,
      ultimoErro: settings?.ultimo_erro || null,
      porStatus: porStatus.rows,
      ultimosEventos: ultimosEventos.rows,
      ultimosPedidos: ultimosPedidos.rows,
      polling: getPollingState(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ifood/orders/:pedidoId/sync — redesync de um pedido (Fase 6)
// Consulta o status REAL do pedido no iFood e atualiza o interno se divergente.
router.post('/orders/:pedidoId/sync', apiLimiter, authenticate, ifoodAdmin, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const pedidoId = parseInt(req.params.pedidoId, 10);
    const settings = await getSettings(restaurantId);
    if (!settings?.ativo) throw new AppError('Integração iFood inativa para este restaurante.', 400, 'IFOOD_INACTIVE');
    const env = settings.ambiente === 'producao' ? 'production' : 'sandbox';

    const link = await queryForTenant(
      restaurantId,
      'SELECT * FROM ifood_orders WHERE restaurant_id = $1 AND pedido_id = $2 LIMIT 1',
      [restaurantId, pedidoId]
    ).catch(() => ({ rows: [] }));
    if (link.rows.length === 0) {
      throw new AppError('Pedido interno não vinculado a um pedido iFood.', 404, 'IFOOD_ORDER_NOT_LINKED');
    }

    const ordem = link.rows[0];
    const payload = await callIfoodApi('GET', `/order/v1.0/orders/${ordem.ifood_order_id}`, null, env);

    // Atualiza o raw_payload + status_ifood mapeado
    const statusIfood = payload?.status || ordem.status_ifood;
    await queryForTenant(
      restaurantId,
      `UPDATE ifood_orders
       SET raw_payload = $3, status_ifood = $4, ultimo_evento = 'SYNC_MANUAL', atualizado_em = NOW()
       WHERE restaurant_id = $1 AND ifood_order_id = $2`,
      [restaurantId, ordem.ifood_order_id, JSON.stringify(payload || {}), statusIfood]
    ).catch(() => {});

    console.log(`[iFood] 🔁 Redesync manual do pedido interno ${pedidoId} (orderId ${ordem.ifood_order_id}) → ${statusIfood}`);
    res.json({
      ok: true,
      pedidoId,
      ifoodOrderId: ordem.ifood_order_id,
      statusIfood,
      displayId: payload?.displayId || ordem.display_id,
    });
  } catch (err) {
    registrarErroIfood(req.restaurantId || config.restaurantId, err).catch(() => {});
    next(err);
  }
});

export default router;
