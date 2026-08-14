import { requestContext } from '../config/database.js';
import { config } from '../config/index.js';

/**
 * Middleware: escopa o contexto do tenant e usuário ao request (RLS).
 *
 * O database.js lê requestContext.getStore() a cada query() e define as
 * variáveis de sessão (app.restaurant_id, app.user_role, app.user_id) na
 * MESMA conexão que executará a query.
 *
 * Fluxo:
 * 1. tenantResolver (executado antes) define req.restaurantId
 * 2. pgContext escopa ao request o restaurant_id (no mínimo)
 * 3. authenticate (executado depois, nas rotas protegidas)
 *    complementa o contexto com user_role e user_id via mergeRequestContext
 *
 * ⚠️ Antes usava estado global (setUserContext + clear no finish): requests
 * concorrentes sobrescreviam/limpavam o contexto uns dos outros, fazendo
 * queries rodarem com o app.restaurant_id de OUTRO tenant (ex.: signup no
 * Loop falhava RLS com o contexto do Palazzo). AsyncLocalStorage garante
 * que cada request só enxerga o PRÓPRIO contexto.
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

  requestContext.run(context, () => next());
}
