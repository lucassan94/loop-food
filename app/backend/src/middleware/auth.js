import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { mergeRequestContext } from '../config/database.js';

// ============================================================================
// CACHE DE JWT SECRET POR TENANT
// ============================================================================
// Cada tenant pode ter seu próprio JWT secret armazenado no banco
// (restaurantes.jwt_secret). Isso garante isolamento: tokens do Tenant A
// não funcionam no Tenant B.
//
// O secret é auto-gerado no primeiro login de cada tenant.
// Fallback: usa o JWT_SECRET global do .env quando jwt_secret é NULL.
// ============================================================================

const jwtSecretCache = new Map();
const JWT_SECRET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Busca o JWT secret de um tenant específico.
 * Usa cache em memória para evitar consultas repetidas ao banco.
 * Retorna null se o tenant não tiver secret próprio (usa fallback global).
 */
export async function getTenantJwtSecret(restaurantId) {
  if (!restaurantId) return null;

  const cached = jwtSecretCache.get(restaurantId);
  if (cached && (Date.now() - cached.cachedAt) < JWT_SECRET_CACHE_TTL_MS) {
    return cached.secret;
  }

  try {
    const { query } = await import('../config/database.js');
    const result = await query(
      'SELECT jwt_secret FROM restaurantes WHERE id = $1',
      [restaurantId]
    );
    if (result.rows.length > 0 && result.rows[0].jwt_secret) {
      const secret = result.rows[0].jwt_secret;
      jwtSecretCache.set(restaurantId, { secret, cachedAt: Date.now() });
      return secret;
    }
  } catch (err) {
    console.warn(`[Auth] Erro ao buscar jwt_secret do tenant ${restaurantId}:`, err.message);
  }
  return null;
}

/**
 * Gera um JWT secret para o tenant (se não existir) e retorna o secret ativo.
 * Usa crypto.randomBytes para gerar um secret de 256 bits (32 bytes hex).
 */
export async function ensureTenantJwtSecret(restaurantId) {
  if (!restaurantId) return config.jwt.secret;

  // Tentar cache primeiro
  let secret = await getTenantJwtSecret(restaurantId);
  if (secret) return secret;

  // Gerar novo secret
  secret = crypto.randomBytes(32).toString('hex');

  try {
    const { query } = await import('../config/database.js');
    await query(
      'UPDATE restaurantes SET jwt_secret = $1 WHERE id = $2 AND jwt_secret IS NULL',
      [secret, restaurantId]
    );
    // Atualizar cache
    jwtSecretCache.set(restaurantId, { secret, cachedAt: Date.now() });
    return secret;
  } catch (err) {
    console.warn(`[Auth] Erro ao gerar jwt_secret para tenant ${restaurantId}:`, err.message);
    return config.jwt.secret;
  }
}

// ============================================================================
// UTILITÁRIOS
// ============================================================================

/**
 * Limpa o cache de JWT secrets. Útil após alterar o secret de um tenant.
 */
export function clearJwtSecretCache(restaurantId) {
  if (restaurantId) {
    jwtSecretCache.delete(restaurantId);
  } else {
    jwtSecretCache.clear();
  }
}

// Extrair token do cookie ou header Authorization
function extractToken(req) {
  // Tenta cookie first (httpOnly cookie)
  if (req.cookies?.token) return req.cookies.token;

  // Fallback: Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

// Middleware: autenticação obrigatória (suporta JWT per-tenant)
export async function authenticate(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso não fornecido.' });
  }

  try {
    // 1. Decodificar sem verificar para extrair o restaurantId do payload
    const payload = jwt.decode(token);
    if (!payload) throw new Error('Token inválido');

    // 2. Resolver o rid e tentar verificar com per-tenant ou global
    const rid = payload.restaurantId || req.restaurantId || config.restaurantId;
    const tenantSecret = await getTenantJwtSecret(rid);

    // 3. Verificar o token: tenta per-tenant primeiro, fallback global
    //    (o fallback permite transição suave de tokens antigos)
    let decoded;
    if (tenantSecret) {
      try {
        decoded = jwt.verify(token, tenantSecret);
      } catch {
        // Fallback: token pode ter sido assinado com o secret global (migração)
        decoded = jwt.verify(token, config.jwt.secret);
      }
    } else {
      decoded = jwt.verify(token, config.jwt.secret);
    }
    req.user = decoded;

    // Atualizar o contexto RLS do request com os dados do usuário logado
    mergeRequestContext({
      restaurantId: rid,
      id: decoded.id,
      role: decoded.role,
      cargo: decoded.cargo,
      email: decoded.email,
      nome: decoded.nome,
      module: decoded.module,
    });

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sessão expirada.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token inválido.' });
  }
}

// Middleware: autenticação opcional (não bloqueia)
export async function optionalAuth(req, res, next) {
  const token = extractToken(req);

  if (token) {
    try {
      // Decodificar sem verificar para extrair o restaurantId
      const payload = jwt.decode(token);
      if (payload) {
        const rid = payload.restaurantId || req.restaurantId || config.restaurantId;
        const tenantSecret = await getTenantJwtSecret(rid);
        let decoded;
        if (tenantSecret) {
          try {
            decoded = jwt.verify(token, tenantSecret);
          } catch {
            decoded = jwt.verify(token, config.jwt.secret);
          }
        } else {
          decoded = jwt.verify(token, config.jwt.secret);
        }
        req.user = decoded;

        // Atualizar contexto RLS do request
        mergeRequestContext({
          restaurantId: rid,
          id: decoded.id,
          role: decoded.role,
          cargo: decoded.cargo,
        });
      }
    } catch {
      // Token inválido ou expirado, ignora
    }
  }

  next();
}

// Middleware: verificar role/cargo específica
export function authorize(...allowedRolesOrCargos) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }

    const allowed = allowedRolesOrCargos.map(r => r.toLowerCase());
    const userRole = (req.user.role || '').toLowerCase();
    const userCargo = (req.user.cargo || '').toLowerCase();

    if (allowed.includes(userRole) || allowed.includes(userCargo)) {
      return next();
    }

    return res.status(403).json({
      error: 'Acesso não autorizado para esta função.',
      required: allowedRolesOrCargos,
      userCargo,
    });
  };
}


export function restrictModule() {
  return (req, res, next) => {
    const requestModule = req.headers['x-module'] || '';
    const userModule = req.user?.module || '';

    if (!requestModule) return next();
    if (!req.user) return next();

    if (userModule !== requestModule) {
      return res.status(403).json({
        error: 'Acesso negado: módulo incorreto.',
        code: 'WRONG_MODULE',
        expected: userModule,
        received: requestModule,
      });
    }

    next();
  };
}
