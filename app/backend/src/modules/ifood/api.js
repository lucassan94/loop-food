// ============================================================================
// iFood — Cliente HTTP das APIs de negócio (pedidos, catálogo)
// ============================================================================
// Injeta o access_token (Bearer) automaticamente e trata:
//   - 401: token expirado/revogado → limpa cache, renova e repete 1x
//   - 5xx/429: indisponibilidade temporária (AppError IFOOD_UNAVAILABLE)
//   - 4xx: erro de negócio com mensagem do iFood
//
// Uso (Fases 2–4):
//   import { callIfoodApi } from './api.js';
//   const pedido = await callIfoodApi('GET', `/order/v1.0/orders/${orderId}`);
//   await callIfoodApi('POST', `/order/v1.0/orders/${orderId}/confirmation`, {});
//
// O token é global (ISV); o merchantId é informado via PATH/BODY nas rotas de
// negócio, escopado por restaurante através de ifood_settings (Fases 2–4).
// ============================================================================

import { config } from '../../config/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { getAccessToken, clearTokenCache, ambienteAtual } from './auth.js';

export function getApiBaseUrl(env = ambienteAtual()) {
  return config.ifood.apiBaseUrls[env] || config.ifood.apiBaseUrls.sandbox;
}

function logRequest(method, path, status, durationMs, error) {
  const level = error ? 'error' : 'info';
  const msg = `[iFood] ${method} ${path} → ${status} (${durationMs}ms)`;
  if (error) {
    console.error(msg, String(error).substring(0, 200));
  } else {
    console.log(msg);
  }
}

async function execute(method, path, body, token, env = ambienteAtual()) {
  const baseUrl = getApiBaseUrl(env);
  const start = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body !== undefined && body !== null ? JSON.stringify(body) : null,
      signal: AbortSignal.timeout(config.ifood.requestTimeout),
    });
  } catch (err) {
    logRequest(method, path, 0, Date.now() - start, err.message);
    throw new AppError('iFood temporariamente indisponível. Tente novamente.', 503, 'IFOOD_UNAVAILABLE');
  }

  const durationMs = Date.now() - start;
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }

  if (response.status === 401) {
    // Token expirado/inválido — sinaliza renovação (tratado no callIfoodApi)
    logRequest(method, path, 401, durationMs, 'token expirado');
    throw new AppError('Token de acesso do iFood expirado.', 401, 'IFOOD_TOKEN_EXPIRED');
  }

  if (!response.ok) {
    const msg = data.message
      || data.errorDescription
      || data.code
      || `Erro na comunicação com o iFood (HTTP ${response.status}).`;
    logRequest(method, path, response.status, durationMs, msg);

    if (response.status >= 500 || response.status === 429) {
      throw new AppError('iFood temporariamente indisponível. Tente novamente.', 503, 'IFOOD_UNAVAILABLE');
    }
    throw new AppError(msg, 400, `IFOOD_HTTP_${response.status}`);
  }

  logRequest(method, path, response.status, durationMs);
  return data;
}

/**
 * Chama a API de negócio do iFood com Bearer token automático e retry 1x em 401.
 *
 * @param {string} method GET | POST | PUT | PATCH | DELETE
 * @param {string} path   Caminho da API (ex.: /order/v1.0/orders/{id})
 * @param {object|null} body Corpo da requisição (opcional)
 * @param {string} env   'sandbox' | 'production' (default: ambiente global) —
 *                        permite tenant em sandbox enquanto outro está em produção
 */
export async function callIfoodApi(method, path, body = null, env = ambienteAtual()) {
  let token = await getAccessToken(env);
  try {
    return await execute(method, path, body, token, env);
  } catch (err) {
    // 401 = token revogado/rotacionado → renova 1x e repete
    if (err.code === 'IFOOD_TOKEN_EXPIRED') {
      clearTokenCache(env);
      console.warn(`[iFood] Token expirado em ${method} ${path}, renovando e repetindo 1x.`);
      token = await getAccessToken(env);
      return execute(method, path, body, token, env);
    }
    throw err;
  }
}
