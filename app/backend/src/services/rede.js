// ============================================================================
// Serviço de integração com a API da Rede (e-Rede v2 / OAuth2)
// ============================================================================
// Integração com a API da Rede (e-Rede v2 / OAuth2). Cobre, em UMA API unificada:
//   - Cartão de crédito/débito (checkout transparente) — POST /v2/transactions
//   - PIX (QR Code dinâmico) — mesmo endpoint com kind: "pix"
//   - Consulta de transação — GET /v2/transactions/{tid} ou ?reference=
//   - Estorno — POST /v2/transactions/{tid}/refunds
//   - Webhook PIX — validação Bearer + resolução de tenant por merchantId (PV)
//   - 3DS 2.0 (Rede MPI) — bloco threeDSecure (frictionless + redirect)
//
// Suporte multi-tenant: cada restaurante tem suas próprias credenciais
// (colunas rede_* em restaurantes, configuradas no módulo god):
//   rede_env, rede_client_id (PV = clientId), rede_client_secret (Chave de
//   Integração = clientSecret), rede_webhook_token (token que escolhemos).
//
// Fontes: Manual Oficial e-Rede (PDF 285 págs., 23/03/2026) — ver spec §3.
// ============================================================================

import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';

// ──────── CACHE DE CREDENCIAIS POR TENANT ────────
const tenantCredentialCache = new Map();
const CREDENTIAL_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// ──────── CACHE DE ACCESS TOKEN OAuth2 POR TENANT ────────
const tokenCache = new Map(); // tenantId -> { token, cachedAt }

/**
 * Busca as credenciais Rede de um tenant específico.
 * Usa cache em memória para evitar consultas repetidas ao banco.
 * Retorna null se o tenant não tiver credenciais próprias (rede_client_id).
 */
async function getTenantCredentials(tenantId) {
  if (!tenantId) return null;

  const cached = tenantCredentialCache.get(tenantId);
  if (cached && (Date.now() - cached.cachedAt) < CREDENTIAL_CACHE_TTL) {
    return cached;
  }

  try {
    const { query } = await import('../config/database.js');
    const result = await query(
      'SELECT rede_env, rede_client_id, rede_client_secret, rede_webhook_token FROM restaurantes WHERE id = $1',
      [tenantId]
    );

    if (result.rows.length > 0 && result.rows[0].rede_client_id) {
      const creds = { ...result.rows[0], cachedAt: Date.now() };
      tenantCredentialCache.set(tenantId, creds);
      return creds;
    }
  } catch (err) {
    console.warn(`[Rede] Erro ao buscar credenciais do tenant ${tenantId}:`, err.message);
  }
  return null;
}

/**
 * Limpa os caches (credenciais + token OAuth2) de um tenant ou de todos.
 */
export function clearRedeCache(tenantId) {
  if (tenantId) {
    tenantCredentialCache.delete(tenantId);
    tokenCache.delete(tenantId);
  } else {
    tenantCredentialCache.clear();
    tokenCache.clear();
  }
}

// ──────── CONVERSÃO DE VALORES ────────

/** R$ 62,90 → 6290 (centavos, formato exigido pela Rede). */
export function reaisParaCentavos(valor) {
  const n = Math.round((Number(valor) || 0) * 100);
  return n;
}

/** 6290 → 62.9 (reais, para exibição). */
export function centavosParaReais(centavos) {
  return (Number(centavos) || 0) / 100;
}

// ──────── LOGGING ────────
function logRequest(method, path, status, durationMs, error) {
  const level = error ? 'error' : 'info';
  const msg = `[Rede] ${method} ${path} → ${status} (${durationMs}ms)`;
  if (error) {
    console.error(msg, String(error).substring(0, 200));
  } else {
    console.log(msg);
  }
}

// ──────── RETRY HELPER (apenas erros de rede/timeout) ────────
async function withRetry(fn, retries = 3, baseDelay = 500) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable = err.name === 'TypeError'
        || err.message?.includes('fetch')
        || err.code === 'ABORT_ERR'
        || err.message?.includes('ECONNRESET');
      if (!isRetryable || attempt === retries) break;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(`[Rede] Tentativa ${attempt}/${retries} falhou, retry em ${delay}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ──────── URL HELPERS ────────
function getEnv(creds) {
  return creds?.rede_env || config.rede.environment;
}

function getTokenBaseUrl(env) {
  return env === 'production'
    ? config.rede.tokenBaseUrls.production
    : config.rede.tokenBaseUrls.sandbox;
}

function getBusinessBaseUrl(env) {
  return env === 'production'
    ? config.rede.businessBaseUrls.production
    : config.rede.businessBaseUrls.sandbox;
}

// ──────── OAuth2 — ACCESS TOKEN ────────
// Token válido por 24 minutos. Cache de 20 min com renovação antecipada.
// Em HTTP 401 de negócio → limpar cache, renovar e repetir 1x (feito no call()).
async function getAccessToken(tenantId) {
  const creds = await getTenantCredentials(tenantId);
  if (!creds?.rede_client_id || !creds?.rede_client_secret) {
    throw new AppError(
      `Credenciais Rede não configuradas para o tenant ${tenantId}. Configure no módulo god.`,
      503,
      'REDE_MISCONFIG'
    );
  }

  // Cache
  const cached = tokenCache.get(tenantId);
  if (cached && (Date.now() - cached.cachedAt) < config.rede.tokenCacheMs) {
    return cached.token;
  }

  const env = getEnv(creds);
  const basic = Buffer.from(`${creds.rede_client_id}:${creds.rede_client_secret}`).toString('base64');

  const start = Date.now();
  let response;
  try {
    // withRetry retenta erros de rede/timeout (relançamos o erro bruto no catch abaixo)
    response = await withRetry(async () => {
      try {
        return await fetch(`${getTokenBaseUrl(env)}/oauth2/token`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
          signal: AbortSignal.timeout(config.rede.requestTimeout),
        });
      } catch (fetchErr) {
        // Relança o erro BRUTO para o withRetry detectar (TypeError/ABORT_ERR/ECONNRESET)
        logRequest('POST', '/oauth2/token', 0, Date.now() - start, fetchErr.message);
        throw fetchErr;
      }
    });
  } catch (err) {
    // Esgotou as tentativas de rede → indisponibilidade temporária
    throw new AppError(
      'Gateway de pagamento temporariamente indisponível. Tente novamente.',
      503,
      'GATEWAY_UNAVAILABLE'
    );
  }

  const data = await response.json().catch(() => ({}));
  const durationMs = Date.now() - start;

  if (!response.ok) {
    logRequest('POST', '/oauth2/token', response.status, durationMs, data.error_description || data.error || 'OAuth error');
    // MELHORIA-005: HTTP 5xx/429 no endpoint de token é TRANSITÓRIO (gateway em
    // manutenção/limite) — não é erro de credencial. Vira GATEWAY_UNAVAILABLE
    // amigável (o frontend sugere pagamento na entrega). O retry de rede já foi
    // feito pelo withRetry no fetch; não retentamos aqui para não bloquear o request.
    if (response.status >= 500 || response.status === 429) {
      throw new AppError(
        'Gateway de pagamento temporariamente indisponível. Tente novamente.',
        503,
        'GATEWAY_UNAVAILABLE'
      );
    }
    // 4xx = configuração inválida (PV/secret errados), não indisponibilidade
    throw new AppError(
      'Falha de autenticação com o gateway de pagamento. Verifique as credenciais Rede no módulo god.',
      400,
      'REDE_AUTH_ERROR'
    );
  }

  if (!data.access_token) {
    logRequest('POST', '/oauth2/token', response.status, durationMs, 'access_token ausente na resposta');
    throw new AppError('Resposta de autenticação inválida do gateway de pagamento.', 503, 'REDE_AUTH_ERROR');
  }

  logRequest('POST', '/oauth2/token', response.status, durationMs);
  tokenCache.set(tenantId, { token: data.access_token, cachedAt: Date.now() });
  return data.access_token;
}

// ──────── API CALL (negócio) com retry em 401 ────────
// 401 = token expirado → limpa cache, renova e repete 1x.
// Converte erro de rede esgotado (após retries) em GATEWAY_UNAVAILABLE amigável.
function comFallbackRede(fn) {
  return fn().catch((err) => {
    const isNetwork = err.name === 'TypeError'
      || err.code === 'ABORT_ERR'
      || err.message?.includes('fetch')
      || err.message?.includes('ECONNRESET');
    if (isNetwork) {
      throw new AppError(
        'Gateway de pagamento temporariamente indisponível. Tente novamente ou escolha pagamento na entrega.',
        503,
        'GATEWAY_UNAVAILABLE'
      );
    }
    throw err;
  });
}

async function call(method, path, body = null, tenantId = null) {
  const execute = async (token) => {
    const creds = await getTenantCredentials(tenantId);
    const env = getEnv(creds);
    const baseUrl = getBusinessBaseUrl(env);

    return withRetry(async () => {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };

      const start = Date.now();
      let response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : null,
          signal: AbortSignal.timeout(config.rede.requestTimeout),
        });
      } catch (fetchErr) {
        // Relança o erro BRUTO para o withRetry detectar (TypeError/ABORT_ERR/ECONNRESET)
        logRequest(method, path, 0, Date.now() - start, fetchErr.message);
        throw fetchErr;
      }

      const durationMs = Date.now() - start;
      const text = await response.text();
      let data = {};
      if (text) {
        try { data = JSON.parse(text); } catch { data = {}; }
      }

      if (response.status === 401) {
        // Token expirado/inválido — sinaliza renovação
        logRequest(method, path, 401, durationMs, 'token expirado');
        throw new AppError('Token de acesso expirado.', 401, 'REDE_TOKEN_EXPIRED');
      }

      if (!response.ok) {
        const msg = data.returnMessage
          || data.errors?.[0]?.description
          || `Erro na comunicação com a Rede (HTTP ${response.status}).`;
        const code = data.returnCode ? `REDE_RETURN_${data.returnCode}` : 'REDE_ERROR';
        logRequest(method, path, response.status, durationMs, msg);
        throw new AppError(msg, 400, code);
      }

      logRequest(method, path, response.status, durationMs);
      return data;
    });
  };

  // Obter token na emissão com renovação 1x em REDE_AUTH_ERROR quando havia
  // token em cache (token revogado/rotacionado pela Rede antes do TTL).
  // MELHORIA-005: sem isso, chamadas seguintes falhariam até expirar o cache.
  let token;
  try {
    token = await getAccessToken(tenantId);
  } catch (err) {
    if (err.code === 'REDE_AUTH_ERROR' && tokenCache.has(tenantId)) {
      tokenCache.delete(tenantId);
      tenantCredentialCache.delete(tenantId);
      console.warn(`[Rede] REDE_AUTH_ERROR ao obter token para ${method} ${path} com token em cache, relendo credenciais e renovando 1x.`);
      token = await getAccessToken(tenantId);
    } else {
      throw err;
    }
  }

  try {
    // withRetry retenta erros de rede; se esgotar, comFallbackRede converte p/ 503
    return await comFallbackRede(() => execute(token));
  } catch (err) {
    // Renovar 1x em caso de token expirado (401 de negócio)
    if (err.code === 'REDE_TOKEN_EXPIRED' || err.statusCode === 401) {
      tokenCache.delete(tenantId);
      console.warn(`[Rede] Token expirado em ${method} ${path}, renovando e repetindo 1x.`);
      token = await getAccessToken(tenantId);
      return comFallbackRede(() => execute(token));
    }
    throw err;
  }
}

// ============================================================================
// CARTÃO DE CRÉDITO / DÉBITO (checkout transparente)
// ============================================================================
// POST /v2/transactions — aprovação síncrona (returnCode "00" = aprovado).
// installments omitido = à vista (1x). softDescriptor máx. 18 chars.
export async function criarTransacaoCartao({
  valorCentavos,
  reference,
  card,
  softDescriptor,
  capture = true,
  kind = 'credit',
  installments = null,
  threeDSecure = null,
  tenantId = null,
}) {
  const body = {
    capture,
    kind, // 'credit' | 'debit'
    reference: String(reference),
    amount: valorCentavos,
    cardNumber: card.cardNumber,
    expirationMonth: card.expirationMonth,
    expirationYear: card.expirationYear,
    subscription: false,
    origin: 1,
  };

  if (card.cardholderName) body.cardholderName = card.cardholderName;
  if (card.securityCode) body.securityCode = card.securityCode;
  if (installments) body.installments = installments;
  if (softDescriptor) body.softDescriptor = String(softDescriptor).substring(0, 18).toUpperCase();
  if (threeDSecure) body.threeDSecure = threeDSecure;

  const data = await call('POST', '/v2/transactions', body, tenantId);

  return {
    tid: data.tid,
    nsu: data.nsu,
    authorizationCode: data.authorizationCode,
    returnCode: data.returnCode,
    returnMessage: data.returnMessage,
    status: data.status,
    brand: data.brand,
    threeDSecure: data.threeDSecure, // contém .url quando há desafio (returnCode "220")
    raw: data,
  };
}

// ============================================================================
// PIX — QR Code dinâmico
// ============================================================================
// POST /v2/transactions com kind: "pix". Retorna qrCodeResponse com
// qrCodeImage (base64 PNG) e qrCodeData (EMV copia-e-cola).
// Normalizamos para o formato do frontend atual: encodedImage / payload / expirationDate.
export async function criarCobrancaPix({
  valorCentavos,
  reference,
  dataExpiracao, // formato YYYY-MM-DDThh:mm:ss
  tenantId = null,
}) {
  const body = {
    kind: 'pix',
    reference: String(reference),
    amount: valorCentavos,
    qrCode: { dateTimeExpiration: dataExpiracao },
  };

  const data = await call('POST', '/v2/transactions', body, tenantId);
  const qr = data.qrCodeResponse || {};

  return {
    tid: data.tid,
    returnCode: data.returnCode,
    returnMessage: data.returnMessage,
    // Normalizado para o frontend (TrackingView.vue)
    encodedImage: qr.qrCodeImage || null,
    payload: qr.qrCodeData || null,
    expirationDate: qr.dateTimeExpiration || null,
    raw: data,
  };
}

// ============================================================================
// CONSULTA DE TRANSAÇÃO
// ============================================================================
// GET /v2/transactions/{tid} (até 400 dias) ou ?reference={codigo} (até 60 dias).
export async function consultarTransacao(tid, tenantId = null, reference = null) {
  const path = reference
    ? `/v2/transactions?reference=${encodeURIComponent(reference)}`
    : `/v2/transactions/${tid}`;

  const data = await call('GET', path, null, tenantId);

  // A consulta por reference pode retornar { transactions: [...] }
  const item = Array.isArray(data.transactions) && data.transactions.length > 0
    ? data.transactions[0]
    : data;

  const auth = item.authorization || item;
  return {
    tid: auth.tid || item.tid || tid,
    nsu: auth.nsu,
    authorizationCode: auth.authorizationCode,
    returnCode: auth.returnCode,
    returnMessage: auth.returnMessage,
    status: auth.status || item.status, // Approved | Denied | Canceled | Pending
    amount: auth.amount,
    kind: auth.kind,
    refunds: item.refunds || null,
    brand: auth.brand || null,
    raw: item,
  };
}

// ============================================================================
// ESTORNO / REEMBOLSO
// ============================================================================
// POST /v2/transactions/{tid}/refunds — total ou parcial, síncrono.
// Códigos: 359 (ok) · 360 (recebido, reconsultar) · 373/374/370 (falhas).
export async function estornarTransacao(tid, valorCentavos, tenantId = null, callbackUrl = null) {
  const body = { amount: valorCentavos };
  if (callbackUrl) {
    body.urls = [{ kind: 'callback', url: callbackUrl }];
  }

  const data = await call('POST', `/v2/transactions/${tid}/refunds`, body, tenantId);

  return {
    returnCode: data.returnCode,
    returnMessage: data.returnMessage,
    refundId: data.refundId,
    tid: data.tid || tid,
    nsu: data.nsu,
    cancelId: data.cancelId,
    refundDateTime: data.refundDateTime,
    raw: data,
  };
}

// ============================================================================
// WEBHOOK — validação + resolução de tenant
// ============================================================================

/**
 * Valida o header Authorization (Bearer token) do webhook.
 * O token é o `rede_webhook_token` do tenant (escolhido por nós no cadastro
 * da URL de notificação) ou o global config.rede.webhookToken (fallback).
 */
export async function validarTokenWebhook(authorizationHeader) {
  if (!authorizationHeader) return { valido: false, tenantId: null };

  const token = String(authorizationHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return { valido: false, tenantId: null };

  // 1. Token global (fallback)
  if (config.rede.webhookToken && token === config.rede.webhookToken) {
    return { valido: true, tenantId: null };
  }

  // 2. Tokens de tenants cacheados
  for (const [tenantId, creds] of tenantCredentialCache.entries()) {
    if (creds.rede_webhook_token && creds.rede_webhook_token === token) {
      return { valido: true, tenantId };
    }
  }

  // 3. Buscar no banco (todos os tenants)
  try {
    const { query } = await import('../config/database.js');
    const result = await query(
      'SELECT id FROM restaurantes WHERE rede_webhook_token = $1 AND rede_webhook_token IS NOT NULL',
      [token]
    );
    if (result.rows.length > 0) {
      return { valido: true, tenantId: result.rows[0].id };
    }
  } catch (err) {
    console.warn('[Rede] Erro ao buscar tenant por webhook token:', err.message);
  }

  return { valido: false, tenantId: null };
}

/**
 * Resolve o tenant a partir do merchantId (PV) do payload do webhook.
 * Ex: { "merchantId": "90104480" } → restaurantes.rede_client_id = "90104480".
 */
export async function resolverTenantPorWebhook(merchantId) {
  if (!merchantId) return null;

  // 1. Cache
  for (const [tenantId, creds] of tenantCredentialCache.entries()) {
    if (String(creds.rede_client_id) === String(merchantId)) {
      return tenantId;
    }
  }

  // 2. Banco
  try {
    const { query } = await import('../config/database.js');
    const result = await query(
      'SELECT id FROM restaurantes WHERE rede_client_id = $1',
      [String(merchantId)]
    );
    if (result.rows.length > 0) return result.rows[0].id;
  } catch (err) {
    console.warn('[Rede] Erro ao resolver tenant por merchantId:', err.message);
  }
  return null;
}

// ============================================================================
// 3-D SECURE 2.0 (Rede MPI)
// ============================================================================
// Monta o bloco threeDSecure da transação.
//   embedded: true → MPI da Rede embutido (frictionless na maioria dos casos)
//   onFailure: 'continue' (crédito) | 'decline' (débito — obrigatório p/ débito)
//   responseMode: 'event' + urls (nossas, pós-desafio) — o banco redireciona
//   o navegador para threeDSecureSuccess/Failure e nós reconsultamos o status.
export function montarBlocoThreeDSecure({
  onFailure = 'continue',
  userAgent = '',
  ipAddress = '',
  device = {},
  billing = {},
  urls = [],
}) {
  return {
    embedded: true,
    onFailure,
    userAgent,
    ipAddress,
    responseMode: 'event',
    device: {
      colorDepth: device.colorDepth ?? 1,
      deviceType3ds: 'BROWSER',
      javaEnabled: device.javaEnabled ?? false,
      language: device.language || 'BR',
      screenHeight: device.screenHeight || 500,
      screenWidth: device.screenWidth || 500,
      timeZoneOffset: device.timeZoneOffset ?? 3,
    },
    billing: {
      address: billing.address || '',
      city: billing.city || '',
      postalCode: billing.postalCode || '',
      state: billing.state || '',
      country: billing.country || 'Brasil',
      emailAddress: billing.emailAddress || '',
      phoneNumber: billing.phoneNumber || '',
    },
    urls,
  };
}

// ============================================================================
// CADASTRO DE URL DE NOTIFICAÇÃO (SANDBOX)
// ============================================================================
// Em produção o cadastro é feito via call center (Rede); no sandbox, por API:
// POST /v1/transactions/notification-URL
export async function cadastrarUrlNotificacao({ url, token, tenantId = null }) {
  const body = {
    URL: url,
    authorization: { type: 'bearer', token },
  };
  return call('POST', '/v1/transactions/notification-URL', body, tenantId);
}

// ============================================================================
// HELPERS DE DATA (expiração PIX)
// ============================================================================
/** Gera YYYY-MM-DDThh:mm:ss para expiração do QR PIX (padrão: 15min). */
export function gerarDataExpiracaoPix(minutos = config.rede.pixExpiryMinutes) {
  const d = new Date(Date.now() + minutos * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
