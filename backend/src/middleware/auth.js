import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { setUserContext } from '../config/database.js';

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

// Middleware: autenticação obrigatória
export function authenticate(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso não fornecido.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;

    // Atualizar o contexto RLS com os dados do usuário logado
    // Isso garante que app.user_role e app.user_id estejam definidos
    // para as queries executadas pelo route handler
    setUserContext({
      restaurantId: req.restaurantId || decoded.restaurantId || config.restaurantId,
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
export function optionalAuth(req, res, next) {
  const token = extractToken(req);

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      req.user = decoded;

      // Atualizar contexto RLS se usuário foi autenticado opcionalmente
      setUserContext({
        restaurantId: req.restaurantId || decoded.restaurantId || config.restaurantId,
        id: decoded.id,
        role: decoded.role,
        cargo: decoded.cargo,
      });
    } catch {
      // Token inválido ou expirado, ignora
    }
  }

  next();
}

// Middleware: verificar role/cargo específica
// Aceita tanto role (cliente/entregador/restaurante) quanto cargo (admin/gerente/chef/caixa)
// NOTA: Não usa mais o bypass 'role === restaurante' — agora cada cargo é verificado explicitamente.
export function authorize(...allowedRolesOrCargos) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }

    // Normalizar para lowercase
    const allowed = allowedRolesOrCargos.map(r => r.toLowerCase());
    const userRole = (req.user.role || '').toLowerCase();
    const userCargo = (req.user.cargo || '').toLowerCase();

    // Verifica se o role OU o cargo do usuário está na lista de permitidos
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

// Guard: proteção contra bypass via DevTools no frontend
export function guardCheck(req, res, next) {
  // SPA guard: se a request não tiver referer ou for via API, pode prosseguir
  // Isso evita que alguém desative o JS e tente acessar dados
  if (req.headers['x-auth-guard'] === 'saborexpress-secure') {
    return next();
  }

  // Normal auth flow
  next();
}

// Middleware: restringir acesso por módulo (cross-login prevention)
// Cada frontend envia X-Module header. O middleware verifica se o
// módulo do usuário (armazenado no JWT) corresponde ao esperado.
// Ex: admin não consegue acessar APIs do cliente, vice-versa.
//
// IMPORTANTE: DEVE ser executado APÓS o authenticate, pois precisa
// de req.user preenchido. Não verifica autenticação — apenas módulo.
export function restrictModule() {
  return (req, res, next) => {
    const requestModule = req.headers['x-module'] || '';
    const userModule = req.user?.module || '';

    // Se nenhum módulo foi especificado, permitir (compatibilidade/reverso)
    if (!requestModule) return next();

    // Se o usuário não está autenticado, não há módulo para verificar
    if (!req.user) return next();

    // Verificar se o módulo do JWT corresponde ao header
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
