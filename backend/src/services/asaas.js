// Serviço de integração com a API Asaas (v3)
// Suporte multi-tenant: cada restaurante pode ter sua própria chave Asaas
import crypto from 'crypto';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';

// ──────── CACHE DE CREDENCIAIS POR TENANT ────────
const tenantCredentialCache = new Map();
const CREDENTIAL_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Busca as credenciais Asaas de um tenant específico.
 * Usa cache em memória para evitar consultas repetidas ao banco.
 * Retorna null se o tenant não tiver credenciais próprias.
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
      'SELECT asaas_api_key, asaas_env, asaas_webhook_token, asaas_webhook_secret FROM restaurantes WHERE id = $1',
      [tenantId]
    );

    if (result.rows.length > 0 && result.rows[0].asaas_api_key) {
      const creds = { ...result.rows[0], cachedAt: Date.now() };
      tenantCredentialCache.set(tenantId, creds);
      return creds;
    }
  } catch (err) {
    console.warn(`[Asaas] Erro ao buscar credenciais do tenant ${tenantId}:`, err.message);
  }
  return null;
}

/**
 * Limpa o cache de credenciais de um tenant específico ou de todos.
 */
export function clearAsaasTenantCache(tenantId) {
  if (tenantId) {
    tenantCredentialCache.delete(tenantId);
  } else {
    tenantCredentialCache.clear();
  }
}

// ──────── HEADERS ────────
async function getHeaders(tenantId) {
  let apiKey = config.asaas.apiKey;
  let environment = config.asaas.environment;

  // Se tenantId foi fornecido, tentar usar credenciais do tenant
  if (tenantId) {
    const creds = await getTenantCredentials(tenantId);
    if (creds?.asaas_api_key) {
      apiKey = creds.asaas_api_key;
      if (creds.asaas_env) {
        environment = creds.asaas_env;
      }
    }
  }

  if (!apiKey) {
    throw new AppError(
      tenantId
        ? `ASAAS_API_KEY não configurada para o tenant ${tenantId}.`
        : 'ASAAS_API_KEY não configurada.',
      500,
      'ASAAS_MISCONFIG'
    );
  }

  return {
    'Content-Type': 'application/json',
    'access_token': apiKey,
  };
}

// ──────── ENVIRONMENT HELPER ────────
function getBaseUrl(tenantId) {
  // O cache DEVE estar populado por getHeaders() ou getTenantCredentials()
  // ANTES de chamar esta função.
  // Chame getHeaders(tenantId) ou await getTenantCredentials(tenantId) primeiro.
  const env = tenantId
    ? (tenantCredentialCache.get(tenantId)?.asaas_env || config.asaas.environment)
    : config.asaas.environment;

  return env === 'production'
    ? 'https://api.asaas.com'
    : 'https://api-sandbox.asaas.com';
}

// ──────── LOGGING ────────
function logRequest(method, path, status, durationMs, error) {
  const level = error ? 'error' : 'info';
  const msg = `[Asaas] ${method} ${path} → ${status} (${durationMs}ms)`;
  if (error) {
    console.error(msg, error.substring(0, 200));
  } else {
    console.log(msg);
  }
}

// ──────── RETRY HELPER ────────
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
      console.warn(`[Asaas] Tentativa ${attempt}/${retries} falhou, retry em ${delay}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ──────── API CALL ────────
// tenantId: opcional, usado para usar credenciais específicas do tenant
async function call(method, path, body = null, idempotencyKey = null, tenantId = null) {
  return withRetry(async () => {
    // getHeaders() DEVE vir antes de getBaseUrl() para garantir
    // que o cache de credenciais do tenant seja populado primeiro
    const headers = await getHeaders(tenantId);
    const baseUrl = getBaseUrl(tenantId);
    if (idempotencyKey) headers['idempotency_key'] = idempotencyKey;

    const start = Date.now();

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
      signal: AbortSignal.timeout(config.asaas.requestTimeout),
    });

    const durationMs = Date.now() - start;
    const data = await response.json();

    if (!response.ok) {
      const msg = data.errors?.[0]?.description || 'Erro na comunicação com Asaas';
      const code = data.errors?.[0]?.code || 'ASAAS_ERROR';
      logRequest(method, path, response.status, durationMs, msg);
      throw new AppError(msg, 400, code);
    }

    logRequest(method, path, response.status, durationMs);
    return data;
  });
}

// ──────── CUSTOMER ────────

export async function findCustomer(cpfCnpj, externalRef, tenantId = null) {
  return call('GET', `/v3/customers?cpfCnpj=${cpfCnpj}&externalReference=${externalRef}`, null, null, tenantId);
}

export async function createCustomer({
  name, cpfCnpj, email, phone, externalReference,
  address, addressNumber, complement, province, postalCode, city, state
}, tenantId = null) {
  // Garantir que o cache de credenciais seja populado antes de resolver a base URL
  const creds = tenantId ? await getTenantCredentials(tenantId) : null;
  const env = creds?.asaas_env || config.asaas.environment;
  const baseUrl = env === 'production' ? 'https://api.asaas.com' : 'https://api-sandbox.asaas.com';

  const body = {
    name,
    cpfCnpj,
    email,
    externalReference: String(externalReference),
    notificationDisabled: false,
  };

  if (env === 'production' && phone) {
    body.mobilePhone = phone;
  }
  if (address) body.address = address;
  if (addressNumber) body.addressNumber = addressNumber;
  if (complement) body.complement = complement;
  if (province) body.province = province;
  if (postalCode) body.postalCode = postalCode.replace(/\D/g, '');
  if (city) body.city = city;
  if (state) body.state = state;

  return call('POST', '/v3/customers', body, null, tenantId);
}

export async function updateCustomer(
  asaasCustomerId,
  { name, email, phone, address, addressNumber, complement, province, postalCode, city, state },
  tenantId = null
) {
  // Garantir que o cache de credenciais seja populado
  const creds = tenantId ? await getTenantCredentials(tenantId) : null;
  const env = creds?.asaas_env || config.asaas.environment;

  const body = {};
  if (name) body.name = name;
  if (email) body.email = email;

  if (env === 'production' && phone) {
    body.mobilePhone = phone;
  }
  if (address) body.address = address;
  if (addressNumber) body.addressNumber = addressNumber;
  if (complement) body.complement = complement;
  if (province) body.province = province;
  if (postalCode) body.postalCode = postalCode.replace(/\D/g, '');
  if (city) body.city = city;
  if (state) body.state = state;

  return call('PUT', `/v3/customers/${asaasCustomerId}`, body, null, tenantId);
}

export async function findOrCreateCustomer(clienteData, tenantId = null) {
  const { data } = await findCustomer(clienteData.cpfCnpj, String(clienteData.id), tenantId);

  if (data?.length > 0) {
    const existing = data[0];
    try {
      await updateCustomer(existing.id, clienteData, tenantId);
    } catch (err) {
      console.warn(`[Asaas] Erro ao atualizar customer ${existing.id}: ${err.message}`);
    }
    return existing;
  }

  return createCustomer(clienteData, tenantId);
}

// ──────── PAYMENT ────────

export async function createPayment({
  customer, billingType, value, dueDate,
  description, externalReference,
  creditCard, creditCardHolderInfo, remoteIp,
}, idempotencyKey = null, tenantId = null) {
  const body = {
    customer,
    billingType,
    value,
    dueDate,
    description,
    externalReference: String(externalReference),
  };

  if (billingType === 'CREDIT_CARD' && creditCard) {
    body.creditCard = {
      holderName: creditCard.holderName,
      number: creditCard.number,
      expiryMonth: creditCard.expiryMonth,
      expiryYear: creditCard.expiryYear,
      ccv: creditCard.ccv,
    };
    body.creditCardHolderInfo = {
      name: creditCardHolderInfo.name,
      email: creditCardHolderInfo.email,
      cpfCnpj: creditCardHolderInfo.cpfCnpj,
      postalCode: creditCardHolderInfo.postalCode,
      addressNumber: creditCardHolderInfo.addressNumber,
      phone: creditCardHolderInfo.phone,
    };
    body.remoteIp = remoteIp;
  }

  return call('POST', '/v3/payments', body, idempotencyKey, tenantId);
}

export async function getPayment(paymentId, tenantId = null) {
  return call('GET', `/v3/payments/${paymentId}`, null, null, tenantId);
}

export async function getPixQrCode(paymentId, tenantId = null) {
  return call('GET', `/v3/payments/${paymentId}/pixQrCode`, null, null, tenantId);
}

export async function deletePayment(paymentId, tenantId = null) {
  return call('DELETE', `/v3/payments/${paymentId}`, null, null, tenantId);
}

export async function refundPayment(paymentId, value = null, tenantId = null) {
  const body = {};
  if (value !== null) body.value = value;
  return call('POST', `/v3/payments/${paymentId}/refund`, body, null, tenantId);
}

export async function tokenizeCard(cardData, tenantId = null) {
  return call('POST', '/v3/creditCard/tokenize', cardData, null, tenantId);
}

// ──────── WEBHOOK HMAC ────────

export function gerarHmacPayLoad(body, secret) {
  if (!secret) return null;
  return crypto
    .createHmac('sha256', secret)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
}

export function verificarAssinaturaWebhook(body, signature, secret) {
  if (!signature || !secret) return false;
  const expected = gerarHmacPayLoad(body, secret);
  if (!expected) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ──────── WEBHOOK TOKEN VALIDATION (multi-tenant) ────────

/**
 * Valida o token do webhook Asaas.
 * Suporta multi-tenant: aceita tanto o token global quanto tokens específicos de tenant.
 *
 * 1. Tenta matching com o token global (config.asaas.webhookToken) — backward compatible
 * 2. Se não match, busca no cache de credenciais se algum tenant tem este token
 * 3. Se encontrar, retorna o tenantId correspondente
 *
 * Retorna: { valido: boolean, tenantId: number|null }
 */
export async function validarTokenWebhook(token) {
  if (!token) return { valido: false, tenantId: null };

  // 1. Verificar token global
  if (token === config.asaas.webhookToken) {
    return { valido: true, tenantId: null };
  }

  // 2. Verificar tokens de tenants cacheados
  for (const [tenantId, creds] of tenantCredentialCache.entries()) {
    if (creds.asaas_webhook_token === token) {
      return { valido: true, tenantId };
    }
  }

  // 3. Se não achou no cache, buscar no banco (todos os tenants)
  try {
    const { query } = await import('../config/database.js');
    const result = await query(
      'SELECT id FROM restaurantes WHERE asaas_webhook_token = $1 AND asaas_webhook_token IS NOT NULL',
      [token]
    );
    if (result.rows.length > 0) {
      return { valido: true, tenantId: result.rows[0].id };
    }
  } catch (err) {
    console.warn('[Asaas] Erro ao buscar tenant por webhook token:', err.message);
  }

  return { valido: false, tenantId: null };
}
