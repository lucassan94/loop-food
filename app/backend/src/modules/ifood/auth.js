// ============================================================================
// iFood — Autenticação OAuth 2.0 (client_credentials) com cache de token
// ============================================================================
// As credenciais são GLOBAIS da plataforma (parceiro de software/ISV):
//   IFOOD_CLIENT_ID / IFOOD_CLIENT_SECRET (env, stack.env)
//
// O access_token é válido ~6h (campo expires_in) e é CACHEADO em memória com
// margem de segurança (renovação antecipada em 5h — config.ifood.tokenCacheMs).
// Em 401 nas chamadas de negócio, o api.js limpa o cache, renova e repete 1x.
//
// Token único (ISV) não é por tenant: o merchantId é informado nas requests
// de negócio (catálogo/pedidos), escopado por restaurante via ifood_settings.
// ============================================================================

import { config } from '../../config/index.js';
import { AppError } from '../../middleware/errorHandler.js';

// Cache por ambiente: { sandbox, producao } -> { token, expiraEm (epoch ms) }
const tokenCache = new Map();

// ──────── HELPERS ────────

export function ambienteAtual() {
  return config.ifood.environment === 'production' ? 'production' : 'sandbox';
}

export function credenciaisConfiguradas() {
  return Boolean(config.ifood.clientId && config.ifood.clientSecret);
}

export function getTokenBaseUrl(env = ambienteAtual()) {
  return config.ifood.tokenBaseUrls[env] || config.ifood.tokenBaseUrls.sandbox;
}

function logAuth(method, path, status, durationMs, error) {
  const level = error ? 'error' : 'info';
  const msg = `[iFood] ${method} ${path} → ${status} (${durationMs}ms)`;
  if (error) {
    console.error(msg, String(error).substring(0, 200));
  } else {
    console.log(msg);
  }
}

/**
 * Estado do cache de token (para diagnóstico em /api/ifood/status).
 */
export function getTokenCacheState(env = ambienteAtual()) {
  const cached = tokenCache.get(env);
  if (!cached) return null;
  return {
    ambiente: env,
    expiraEm: new Date(cached.expiraEm).toISOString(),
    expiraEmMs: cached.expiraEm,
    ageMs: Date.now() - (cached.obtidoEm || 0),
    expirado: Date.now() >= cached.expiraEm,
  };
}

/**
 * Invalida o token em cache (força renovação na próxima chamada).
 * @param {string} env 'sandbox' | 'production' (default: ambiente global)
 */
export function clearTokenCache(env = ambienteAtual()) {
  tokenCache.delete(env);
}

/**
 * Obtém (ou retorna do cache) o access_token do iFood para um ambiente.
 * Renova antecipadamente antes de expirar. Dispara a chamada OAuth apenas
 * quando necessário — nunca faz chamada externa se houver token válido.
 *
 * @param {string} env 'sandbox' | 'production' (default: ambiente global IFOOD_ENV)
 * O cache é separado por ambiente — um tenant em sandbox e outro em produção
 * usam tokens independentes.
 */
export async function getAccessToken(env = ambienteAtual()) {
  const cached = tokenCache.get(env);
  if (cached && Date.now() < cached.expiraEm) {
    return cached.token;
  }

  if (!credenciaisConfiguradas()) {
    throw new AppError(
      'Credenciais iFood não configuradas. Defina IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET no ambiente.',
      503,
      'IFOOD_MISCONFIG'
    );
  }

  const body = new URLSearchParams({
    grantType: 'client_credentials',
    clientId: config.ifood.clientId,
    clientSecret: config.ifood.clientSecret,
  });

  const start = Date.now();
  let response;
  try {
    response = await fetch(`${getTokenBaseUrl(env)}/authentication/v1.0/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(config.ifood.requestTimeout),
    });
  } catch (err) {
    // Erro de rede/timeout — indisponibilidade temporária
    logAuth('POST', '/authentication/v1.0/oauth/token', 0, Date.now() - start, err.message);
    throw new AppError('iFood temporariamente indisponível. Tente novamente.', 503, 'IFOOD_UNAVAILABLE');
  }

  const data = await response.json().catch(() => ({}));
  const durationMs = Date.now() - start;

  if (!response.ok) {
    const msg = data.errorDescription || data.error_description || data.error || `HTTP ${response.status}`;
    logAuth('POST', '/authentication/v1.0/oauth/token', response.status, durationMs, msg);
    // 5xx/429 = transitório (gateway em manutenção / rate limit)
    if (response.status >= 500 || response.status === 429) {
      throw new AppError('iFood temporariamente indisponível. Tente novamente.', 503, 'IFOOD_UNAVAILABLE');
    }
    // 4xx = credenciais inválidas
    throw new AppError(
      'Falha de autenticação com o iFood. Verifique IFOOD_CLIENT_ID/IFOOD_CLIENT_SECRET.',
      400,
      'IFOOD_AUTH_ERROR'
    );
  }

  if (!data.access_token) {
    logAuth('POST', '/authentication/v1.0/oauth/token', response.status, durationMs, 'access_token ausente na resposta');
    throw new AppError('Resposta de autenticação inválida do iFood.', 503, 'IFOOD_AUTH_ERROR');
  }

  // TTL: menor entre expires_in (~6h) e a margem configurada (5h) — renova antes de expirar
  const expiresInSec = Number(data.expires_in || data.expiresIn || 21600);
  const ttlMs = Math.min(expiresInSec * 1000, config.ifood.tokenCacheMs);
  tokenCache.set(env, {
    token: data.access_token,
    expiraEm: Date.now() + ttlMs,
    obtidoEm: Date.now(),
  });

  logAuth('POST', '/authentication/v1.0/oauth/token', response.status, durationMs);
  return data.access_token;
}
