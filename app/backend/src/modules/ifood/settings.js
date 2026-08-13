// ============================================================================
// iFood — Configurações por tenant (ifood_settings)
// ============================================================================
// Cada restaurante ativa/desativa a integração iFood de forma independente.
// As credenciais OAuth são GLOBAIS (env) — aqui ficam apenas merchantId,
// ambiente, modo de entrega e flags de operação do tenant.
// ============================================================================

import { query } from '../../config/database.js';
import { AppError } from '../../middleware/errorHandler.js';
import { z } from 'zod';

const DEFAULTS = {
  ativo: false,
  ambiente: 'sandbox',
  merchant_id: null,
  delivery_mode: 'own', // own = entrega própria (frota da plataforma) | ifood
  sync_catalogo: false,
  auto_aceite: false, // aceitar automaticamente pedidos PLACED (SLA iFood)
};

const settingsSchema = z.object({
  ativo: z.boolean().optional(),
  ambiente: z.enum(['sandbox', 'producao']).optional(),
  merchant_id: z.string().max(50).nullable().optional(),
  delivery_mode: z.enum(['own', 'ifood']).optional(),
  sync_catalogo: z.boolean().optional(),
  auto_aceite: z.boolean().optional(),
});

/** Normaliza o body (PUT completo) aplicando defaults e limpeza de merchant_id. */
export function parseSettings(body) {
  const parsed = settingsSchema.parse(body || {});
  return {
    ativo: parsed.ativo ?? DEFAULTS.ativo,
    ambiente: parsed.ambiente ?? DEFAULTS.ambiente,
    merchant_id: typeof parsed.merchant_id === 'string'
      ? (parsed.merchant_id.trim() || null)
      : (parsed.merchant_id ?? null),
    delivery_mode: parsed.delivery_mode ?? DEFAULTS.delivery_mode,
    sync_catalogo: parsed.sync_catalogo ?? DEFAULTS.sync_catalogo,
    auto_aceite: parsed.auto_aceite ?? DEFAULTS.auto_aceite,
  };
}

// RLS: ifood_settings tem policy por restaurant_id. Em chamadas de BACKGROUND
// (polling/espelho — sem request), o contexto do query() seria o tenant default,
// quebrando tenants diferentes. Por isso todas as funções aceitam um helper
// opcional `db` (ex.: (sql, params) => queryForTenant(tenantId, sql, params)).

/**
 * Retorna as configurações iFood do tenant. Cria a linha padrão (lazy) se
 * ainda não existir — o row só existe quando o restaurante visita a tela.
 * @param {Function} [db] helper de conexão (default: query com contexto do request)
 */
export async function getSettings(restaurantId, db = query) {
  const result = await db(
    'SELECT * FROM ifood_settings WHERE restaurant_id = $1',
    [restaurantId]
  );
  if (result.rows.length > 0) return result.rows[0];

  const created = await db(
    `INSERT INTO ifood_settings (restaurant_id) VALUES ($1)
     ON CONFLICT (restaurant_id) DO NOTHING
     RETURNING *`,
    [restaurantId]
  );
  if (created.rows.length > 0) return created.rows[0];

  // Corrida: outro processo criou entre a SELECT e o INSERT
  const again = await db(
    'SELECT * FROM ifood_settings WHERE restaurant_id = $1',
    [restaurantId]
  );
  return again.rows[0] || null;
}

/** Upsert completo (semântica de PUT): substitui todos os campos editáveis. */
export async function upsertSettings(restaurantId, body, db = query) {
  const s = parseSettings(body);
  // Defense-in-depth: ativação exige Merchant ID (o frontend já valida, mas a
  // API deve recusar ativação sem merchant — quebraria catálogo/pedidos).
  if (s.ativo && !s.merchant_id) {
    throw new AppError('Informe o Merchant ID do iFood para ativar a integração.', 400, 'IFOOD_MERCHANT_REQUIRED');
  }
  const result = await db(
    `INSERT INTO ifood_settings
       (restaurant_id, ativo, ambiente, merchant_id, delivery_mode, sync_catalogo, auto_aceite)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (restaurant_id) DO UPDATE SET
       ativo = EXCLUDED.ativo,
       ambiente = EXCLUDED.ambiente,
       merchant_id = EXCLUDED.merchant_id,
       delivery_mode = EXCLUDED.delivery_mode,
       sync_catalogo = EXCLUDED.sync_catalogo,
       auto_aceite = EXCLUDED.auto_aceite,
       atualizado_em = NOW()
     RETURNING *`,
    [restaurantId, s.ativo, s.ambiente, s.merchant_id, s.delivery_mode, s.sync_catalogo, s.auto_aceite]
  );
  return result.rows[0];
}

/** Marca a última sincronização de catálogo (sucesso) e limpa o último erro. */
export async function marcarSyncCatalogo(restaurantId, db = query) {
  const result = await db(
    `UPDATE ifood_settings SET ultima_sync_em = NOW(), ultimo_erro = NULL, atualizado_em = NOW()
     WHERE restaurant_id = $1 RETURNING *`,
    [restaurantId]
  );
  return result.rows[0] || null;
}

/** Registra um erro operacional (sync falho, evento não processado etc.). */
export async function registrarErroIfood(restaurantId, erro, db = query) {
  const mensagem = String(erro?.message || erro).substring(0, 500);
  const result = await db(
    `UPDATE ifood_settings SET ultimo_erro = $2, atualizado_em = NOW()
     WHERE restaurant_id = $1 RETURNING *`,
    [restaurantId, mensagem]
  );
  return result.rows[0] || null;
}
