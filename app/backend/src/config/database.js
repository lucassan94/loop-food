import pg from 'pg';
import { config } from './index.js';

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
// USER CONTEXT para RLS
// ============================================================================
// Armazenado em módulo-level (seguro pois Node.js é single-thread)
// Middleware pgContext.js chama setUserContext() antes de cada request
let _userContext = null;

export function setUserContext(user) {
  _userContext = user;
}

export function clearUserContext() {
  _userContext = null;
}

function buildContextSQL(ctx) {
  // ctx: contexto explícito (ex: jobs de background por tenant) ou o contexto
  // do request atual (_userContext). restaurantId usa o valor dinâmico
  // (tenantResolver) ou fallback para config.restaurantId (dev/migrações).
  const user = ctx || _userContext;
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
