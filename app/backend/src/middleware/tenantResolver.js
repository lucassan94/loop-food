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

// Cache: dominio → { id, slug, config, cachedAt }
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
 * Tenta primeiro pela coluna dominio, depois pela coluna slug como fallback.
 * Usado para resolução por subdomínio (Host header).
 */
async function resolveTenant(domain) {
  // Verificar cache
  const cached = tenantCache.get(domain);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached;
  }

  // Buscar no banco — TENTATIVA 1: pela coluna dominio
  try {
    const result = await query(
      'SELECT id, slug, config FROM restaurantes WHERE LOWER(dominio) = $1',
      [domain]
    );

    if (result.rows.length > 0) {
      const tenant = { ...result.rows[0], cachedAt: Date.now() };
      tenantCache.set(domain, tenant);
      return tenant;
    }
  } catch (err) {
    console.error('[TenantResolver] Erro ao buscar tenant por dominio:', err.message);
  }

  // TENTATIVA 2: pela coluna slug (muitos usuários só preenchem o slug)
  try {
    const result = await query(
      'SELECT id, slug, config FROM restaurantes WHERE LOWER(slug) = $1',
      [domain]
    );

    if (result.rows.length > 0) {
      const tenant = { ...result.rows[0], cachedAt: Date.now() };
      tenantCache.set(domain, tenant);
      console.log(`[TenantResolver] ✅ Resolvido por slug (dominio vazio): "${domain}" → tenant #${tenant.id} "${tenant.slug}"`);
      return tenant;
    }
  } catch (err) {
    console.error('[TenantResolver] Erro ao buscar tenant por slug:', err.message);
  }

  return null;
}

/**
 * Busca tenant pelo slug (coluna slug).
 * Usado para resolução via query param (?slug=xxx) e header (X-Tenant-Slug).
 */
async function resolveTenantBySlug(slug) {
  // Verificar cache
  const cached = tenantCache.get(slug);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached;
  }

  // Buscar no banco
  try {
    const result = await query(
      'SELECT id, slug, config FROM restaurantes WHERE LOWER(slug) = $1',
      [slug]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const tenant = {
      ...result.rows[0],
      cachedAt: Date.now(),
    };

    // Atualizar cache (pelo slug)
    tenantCache.set(slug, tenant);

    return tenant;
  } catch (err) {
    console.error('[TenantResolver] Erro ao buscar tenant por slug:', err.message);
    return null;
  }
}

/**
 * Middleware: resolve o tenant a partir do subdomínio, header ou query param.
 *
 * Ordem de precedência (maior primeiro):
 *   1. Query param: ?slug=xxx ou ?tenant_id=N
 *   2. Header: X-Tenant-Slug
 *   3. Subdomínio (primeiro segmento do Host)
 *   4. Fallback: config.restaurantId (IP direto, localhost, etc.)
 *
 * Adiciona ao req:
 *   - req.restaurantId: ID do restaurante (inteiro)
 *   - req.tenant: dados completos do tenant (slug, config, etc.)
 *
 * Isto permite navegar pelo cardápio de diferentes tenants sem configurar
 * DNS ou arquivo hosts, usando apenas URLs como:
 *   http://IP:8091/?slug=saborexpress
 *   http://IP:8090/api/restaurante/?slug=palazzomooca
 */
export async function tenantResolver(req, res, next) {
  try {
    // ─── 1. QUERY PARAM: ?slug=xxx ou ?tenant_id=N ───
    // Maior precedência. Permite navegar entre tenants sem DNS.
    const qSlug = req.query.slug;
    const qTenantId = req.query.tenant_id;

    if (qSlug) {
      const tenant = await resolveTenantBySlug(qSlug.toLowerCase());
      if (!tenant) {
        return res.status(404).json({
          error: `Restaurante com slug "${qSlug}" não encontrado.`,
          code: 'TENANT_NOT_FOUND',
        });
      }
      req.restaurantId = tenant.id;
      req.tenant = tenant;
      setTenantCookie(req, res, tenant);
      return next();
    }

    if (qTenantId) {
      const id = parseInt(qTenantId, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'tenant_id deve ser um número.', code: 'INVALID_TENANT_ID' });
      }
      // Buscar no cache primeiro
      const tenant = await findTenantById(id);
      if (!tenant) {
        return res.status(404).json({
          error: `Restaurante com ID ${id} não encontrado.`,
          code: 'TENANT_NOT_FOUND',
        });
      }
      req.restaurantId = tenant.id;
      req.tenant = tenant;
      setTenantCookie(req, res, tenant);
      return next();
    }

    // ─── 2. HEADER: X-Tenant-Slug ───
    // Usado pelo frontend para enviar o slug lido da URL
    const hSlug = req.headers['x-tenant-slug'];
    if (hSlug) {
      const tenant = await resolveTenantBySlug(hSlug.toLowerCase());
      if (tenant) {
        req.restaurantId = tenant.id;
        req.tenant = tenant;
        setTenantCookie(req, res, tenant);
        return next();
      }
    }

    // ─── 3. SUBDOMÍNIO (Host header) ───
    const host = req.headers.host;
    const hostname = getHostname(host);

    console.log(`[TenantResolver] 🔍 Host header recebido: "${host}" → hostname: "${hostname}"`);

    // Sem host? Fallback
    if (!hostname) {
      console.log('[TenantResolver] ⚠️ Nenhum hostname. Usando fallback.');
      req.restaurantId = config.restaurantId;
      req.tenant = null;
      return next();
    }

    // IP ADDRESS? Usar fallback
    if (isIPAddress(hostname)) {
      console.log(`[TenantResolver] ⚠️ IP address: "${hostname}". Usando fallback.`);
      req.restaurantId = config.restaurantId;
      req.tenant = null;
      return next();
    }

    const domain = extractDomain(hostname);
    console.log(`[TenantResolver] 🔍 Domínio extraído: "${domain}" (de "${hostname}")`);

    if (!domain) {
      req.restaurantId = config.restaurantId;
      req.tenant = null;
      return next();
    }

    // PREFIXO DE INFRAESTRUTURA? Fallback
    if (NON_TENANT_PREFIXES.includes(domain)) {
      console.log(`[TenantResolver] ⚠️ Prefixo de infraestrutura: "${domain}". Usando fallback.`);
      req.restaurantId = config.restaurantId;
      req.tenant = null;
      return next();
    }

    // RESOLVER TENANT POR DOMÍNIO (ou slug como fallback)
    const tenant = await resolveTenant(domain);

    if (!tenant) {
      const msg = `Restaurante "${domain}" não encontrado (nem por dominio, nem por slug).`;
      console.log(`[TenantResolver] ❌ ${msg}`);

      if (config.nodeEnv === 'production') {
        return res.status(404).json({
          error: msg,
          code: 'TENANT_NOT_FOUND',
          debug: { host, hostname, domain },
        });
      }

      console.warn(`[TenantResolver] ⚠️ Usando fallback RESTAURANT_ID=${config.restaurantId}`);
      req.restaurantId = config.restaurantId;
      req.tenant = null;
      return next();
    }

    console.log(`[TenantResolver] ✅ Resolvido: "${domain}" → tenant #${tenant.id} "${tenant.slug}"`);
    req.restaurantId = tenant.id;
    req.tenant = tenant;
    setTenantCookie(req, res, tenant);
    next();

  } catch (err) {
    // Em caso de erro inesperado, usar fallback para não quebrar a request
    console.error('[TenantResolver] Erro inesperado:', err.message);
    req.restaurantId = config.restaurantId;
    req.tenant = null;
    next();
  }
}

/**
 * Define o cookie tenantId para o frontend usar no WebSocket handshake.
 */
function setTenantCookie(req, res, tenant) {
  res.cookie('tenantId', String(tenant.id), {
    httpOnly: false,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/**
 * Busca tenant pelo ID (primeiro no cache, depois no banco).
 */
async function findTenantById(id) {
  // Procurar no cache por ID
  for (const [, tenant] of tenantCache) {
    if (tenant.id === id && (Date.now() - tenant.cachedAt) < CACHE_TTL_MS) {
      return tenant;
    }
  }
  // Buscar no banco
  try {
    const result = await query(
      'SELECT id, slug, config FROM restaurantes WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return null;
    const tenant = { ...result.rows[0], cachedAt: Date.now() };
    // Salvar no cache pelo slug
    if (tenant.slug) tenantCache.set(tenant.slug, tenant);
    return tenant;
  } catch {
    return null;
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
