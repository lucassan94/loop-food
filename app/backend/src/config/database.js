import pg from 'pg';
import { config } from './index.js';

// ============================================================================
// TIMESTAMPS: DEFESA EM PROFUNDIDADE (BUG-017 → migração 035)
// ============================================================================
// Histórico: as colunas eram `timestamp WITHOUT time zone` gravadas em UTC
// (sessão Etc/UTC, NOW()). O driver pg interpretava esses valores como hora
// LOCAL do processo Node → com TZ=America/Sao_Paulo (docker-compose/máquina
// local BR), toda data saía +3h deslocada (tempo de preparo/previsão errados)
// e writes com `new Date()` gravavam hora local. A migração 035 converteu
// TODAS as colunas para `timestamptz` (instante absoluto), que o driver lê e
// escreve corretamente em qualquer fuso — sem parser customizado.
//
// Este parser permanece como DEFESA: se alguma coluna `timestamp without
// time zone` voltar a existir (tabela nova, migration sem 035), ela é tratada
// como UTC em vez de hora local. O gate de regressão (test-horarios.js)
// valida que ele continua ativo.
//
// ⚠️ REGRA DE ESCRITA: prefira sempre `NOW()` do banco. Para `timestamptz`
// o `new Date()` do Node também grava o instante correto (serializado em
// UTC); para uma eventual coluna naive, NÃO usar `new Date()` (gravaria
// hora local). Ex.: o webhook da Rede usa `pago_em = NOW()`.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (value) => {
  if (value === null) return null;
  // "2026-08-08 22:15:07.544635" → "2026-08-08T22:15:07.544635Z"
  return new Date(value.replace(' ', 'T') + 'Z');
});

const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.max,
  idleTimeoutMillis: config.db.idleTimeoutMillis,
  connectionTimeoutMillis: config.db.connectionTimeoutMillis,
  query_timeout: config.db.query_timeout,
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

pool.on('connect', () => {
  console.log('[DB] New connection established');
});

// ============================================================================
// CONTEXTO POR REQUEST para RLS — AsyncLocalStorage
// ============================================================================
// ⚠️ NÃO usar estado em módulo-level (variável global): requests concorrentes
// compartilham o mesmo processo — o request A podia sobrescrever/limpar o
// contexto do request B antes da query rodar, fazendo o B executar com o
// `app.restaurant_id` de OUTRO tenant (bug real: signup no Loop falhava RLS
// porque o contexto caía no fallback RESTAURANT_ID=1 do Palazzo).
//
// O pgContext.js roda `requestContext.run(context, () => next())`, escopando
// o contexto à cadeia async do request. buildContextSQL() lê o store do
// request atual; fora de request (jobs de background) usa o fallback
// config.restaurantId (ou tenant explícito via queryForTenant/transactionForTenant).
import { AsyncLocalStorage } from 'async_hooks';

export const requestContext = new AsyncLocalStorage();

/** Merge de dados no contexto do request atual (usado por authenticate/optionalAuth). */
export function mergeRequestContext(dados) {
  const store = requestContext.getStore();
  if (store) {
    Object.assign(store, dados);
  } else {
    // Fora de um request HTTP (ex.: chamada direta em testes/jobs)
    requestContext.enterWith({ ...dados });
  }
}

function buildContextSQL(ctx) {
  // ctx: contexto explícito (ex: jobs de background por tenant) ou o store
  // do request atual (requestContext). restaurantId usa o valor dinâmico
  // (tenantResolver) ou fallback para config.restaurantId (dev/migrações).
  const user = ctx || requestContext.getStore();
  const restaurantId = user?.restaurantId || config.restaurantId;
  const settings = [`SET app.restaurant_id = ${restaurantId}`];

  if (user) {
    if (user.role) {
      settings.push(`SET app.user_role = '${user.role}'`);
    }
    if (user.id) {
      settings.push(`SET app.user_id = ${user.id}`);
    }
    if (user.cargo) {
      settings.push(`SET app.user_cargo = '${user.cargo}'`);
    }
  }
  return settings.join('; ');
}

function getContextSQL() {
  return buildContextSQL(null);
}

// ============================================================================
// HELPERS DE CONSULTA
// ============================================================================

// Helper: query com contexto (usa conexão ÚNICA para SET + query)
export async function query(text, params = []) {
  const client = await pool.connect();
  const start = Date.now();
  try {
    // Contexto de sessão na MESMA conexão que executará a query
    await client.query(getContextSQL());
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 100));
    }
  }
}

// Helper: transação (já usa conexão única — só adicionar contexto)
export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(getContextSQL());
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// HELPERS POR TENANT (jobs de background / webhooks — sem request)
// ============================================================================
// Com a role app_user (RLS ativo), uma query fora de request usa o contexto
// do config.restaurantId — o que limitaria jobs (ex: polling da Rede) a um
// único tenant. Estes helpers definem o contexto EXPLÍCITO de um tenant,
// permitindo iterar por tenant sem depender do estado do request.

/** Query com contexto explícito de tenant (conexão única: SET + query). */
export async function queryForTenant(tenantId, text, params = []) {
  const client = await pool.connect();
  const start = Date.now();
  try {
    await client.query(buildContextSQL({ restaurantId: tenantId }));
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 100));
    }
  }
}

/** Transação com contexto explícito de tenant. */
export async function transactionForTenant(tenantId, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(buildContextSQL({ restaurantId: tenantId }));
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Health check
export async function healthCheck() {
  try {
    const result = await pool.query('SELECT 1 as alive');
    return { alive: true, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
  } catch (error) {
    return { alive: false, error: error.message };
  }
}

export default pool;
