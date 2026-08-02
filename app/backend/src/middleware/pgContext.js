import { setUserContext, clearUserContext } from '../config/database.js';
import { config } from '../config/index.js';

/**
 * Middleware: Armazena o contexto do tenant e usuário para o RLS.
 * 
 * O database.js lê _userContext a cada query() e define as variáveis
 * de sessão (app.restaurant_id, app.user_role, app.user_id) na MESMA
 * conexão que executará a query.
 * 
 * Fluxo:
 * 1. tenantResolver (executado antes) define req.restaurantId
 * 2. pgContext define ao menos o restaurant_id no contexto
 * 3. authenticate (executado depois, nas rotas protegidas)
 *    complementa o contexto com user_role e user_id
 *
 * Isto garante que mesmo requisições não autenticadas tenham
 * o app.restaurant_id definido para o RLS.
 */
export function pgContext(req, res, next) {
  // Sempre define ao menos o restaurant_id no contexto
  // Usa req.restaurantId (definido pelo tenantResolver) ou fallback do config
  const context = {
    restaurantId: req.restaurantId || config.restaurantId,
  };

  // Se o usuário já foi autenticado por middleware anterior, incluir dados
  if (req.user) {
    context.id = req.user.id;
    context.role = req.user.role;
    context.cargo = req.user.cargo;
  }

  setUserContext(context);
  res.on('finish', clearUserContext);
  next();
}
