import { config } from '../config/index.js';
import { query } from '../config/database.js';

// ============================================================================
// TENANT RESOLVER — identifica qual restaurante está sendo acessado
// ============================================================================
//
// Estratégia: subdomínio
//   O tenant é identificado pelo primeiro segmento do header Host.
//   Ex: "palazzomooca.cliente.app.com" → dominio = "palazzomooca"
//   Ex: "saborexpress.admin.app.com" → dominio = "saborexpress"
//
// Cache:
//   Os dados do tenant são cacheados em memória por 5 minutos para
//   evitar uma query no banco a cada requisição.
//
// Fallback:
//   Se o subdomínio não corresponder a nenhum tenant conhecido
//   (ex: localhost, IP direto), usa o config.restaurantId como fallback.
//   Isso mantém compatibilidade com desenvolvimento local e migrações.
//
// ============================================================================

// Domínios/prefixos que NÃO são tenants (infraestrutura própria)
const NON_TENANT_PREFIXES = [
  'www', 'api', 'admin', 'cliente', 'entregador',
  'app', 'web', 'mail', 'test', 'dev', 'staging',
  'localhost',
];

// Cache: dominio → { id, slug, asaas_api_key, asaas_env, cachedAt }
const tenantCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Regex para detectar IPv4: 4 octetos separados por ponto.
 * Ex: 86.48.18.22, 192.168.1.1, 127.0.0.1
 */
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Verifica se o hostname é um endereço IPv4.
 */
function isIPAddress(hostname) {
  if (!hostname) return false;
  if (!IPV4_RE.test(hostname)) return false;
  // Validar que cada octeto está entre 0-255
  return hostname.split('.').every(octet => {
    const n = parseInt(octet, 10);
    return n >= 0 && n <= 255;
  });
}

/**
 * Extrai o hostname do header Host (remove porta).
 * Ex: "palazzomooca.cliente.app.com:3001" → "palazzomooca.cliente.app.com"
 * Ex: "86.48.18.22:8090" → "86.48.18.22"
 */
function getHostname(host) {
  if (!host) return null;
  return host.split(':')[0].toLowerCase();
}

/**
 * Extrai o domínio (primeiro segmento) do hostname.
 * Ex: "palazzomooca.cliente.app.com" → "palazzomooca"
 * Ex: "localhost" → "localhost"
 */
function extractDomain(hostname) {
  return hostname.split('.')[0];
}

/**
 * Busca tenant no cache ou no banco de dados.
 */
async function resolveTenant(domain) {
  // Verificar cache
  const cached = tenantCache.get(domain);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached;
  }

  // Buscar no banco
  try {
    const result = await query(
      'SELECT id, slug, asaas_api_key, asaas_env, config FROM restaurantes WHERE LOWER(dominio) = $1',
      [domain]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const tenant = {
      ...result.rows[0],
      cachedAt: Date.now(),
    };

    // Atualizar cache
    tenantCache.set(domain, tenant);

    return tenant;
  } catch (err) {
    console.error('[TenantResolver] Erro ao buscar tenant:', err.message);
    return null;
  }
}

/**
 * Middleware: resolve o tenant a partir do subdomínio ou IP da requisição.
 *
 * Adiciona ao req:
 *   - req.restaurantId: ID do restaurante (inteiro)
 *   - req.tenant: dados completos do tenant (slug, asaas_api_key, etc.)
 *
 * Comportamento:
 *   - Se o host for um endereço IP → fallback (health check, webhooks, monitoramento)
 *   - Se o domínio for um prefixo conhecido (localhost, api, etc.) → fallback
 *   - Se o domínio corresponder a um tenant → usa o tenant encontrado
 *   - Se o domínio não for encontrado → 404 em produção, fallback em dev
 *   - Em caso de erro → fallback para não quebrar a request
 */
export async function tenantResolver(req, res, next) {
  try {
    const host = req.headers.host;
    const hostname = getHostname(host);

    // Sem host? Fallback
    if (!hostname) {
      req.restaurantId = config.restaurantId;
      req.tenant = null;
      return next();
    }

    // ─── IP ADDRESS? Usar fallback ───
    // Acesso direto por IP (ex: health check do Docker, webhook Asaas,
    // monitoramento) não passa por subdomínio. Sempre usa fallback.
    if (isIPAddress(hostname)) {
      req.restaurantId = config.restaurantId;
      req.tenant = null;
      return next();
    }

    const domain = extractDomain(hostname);

    // Domínio vazio? Fallback
    if (!domain) {
      req.restaurantId = config.restaurantId;
      req.tenant = null;
      return next();
    }

    // ─── PREFIXO DE INFRAESTRUTURA? Fallback ───
    if (NON_TENANT_PREFIXES.includes(domain)) {
      req.restaurantId = config.restaurantId;
      req.tenant = null;
      return next();
    }

    // ─── RESOLVER TENANT ───
    const tenant = await resolveTenant(domain);

    if (!tenant) {
      // Em produção, retorna 404 amigável
      // Em desenvolvimento, usa fallback
      if (config.nodeEnv === 'production') {
        return res.status(404).json({
          error: 'Restaurante não encontrado. Verifique o endereço acessado.',
          code: 'TENANT_NOT_FOUND',
        });
      }

      console.warn(`[TenantResolver] ⚠️ Domínio "${domain}" não encontrado. Usando fallback RESTAURANT_ID=${config.restaurantId}`);
      req.restaurantId = config.restaurantId;
      req.tenant = null;
      return next();
    }

    req.restaurantId = tenant.id;
    req.tenant = tenant;

    // Setar cookie tenantId para o frontend usar no WebSocket handshake
    res.cookie('tenantId', String(tenant.id), {
      httpOnly: false,   // JS precisa ler
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24h
      path: '/',
    });

    next();

  } catch (err) {
    // Em caso de erro inesperado, usar fallback para não quebrar a request
    console.error('[TenantResolver] Erro inesperado:', err.message);
    req.restaurantId = config.restaurantId;
    req.tenant = null;
    next();
  }
}

// ============================================================================
// UTILITÁRIOS
// ============================================================================

/**
 * Limpa o cache de tenants. Útil após criar/atualizar um tenant.
 */
export function clearTenantCache(domain) {
  if (domain) {
    tenantCache.delete(domain);
  } else {
    tenantCache.clear();
  }
}

/**
 * Retorna estatísticas do cache (para debug/monitoramento).
 */
export function getTenantCacheStats() {
  return {
    size: tenantCache.size,
    entries: Array.from(tenantCache.entries()).map(([domain, tenant]) => ({
      domain,
      id: tenant.id,
      slug: tenant.slug,
      cachedAt: new Date(tenant.cachedAt).toISOString(),
      age: Math.round((Date.now() - tenant.cachedAt) / 1000) + 's',
    })),
  };
}
