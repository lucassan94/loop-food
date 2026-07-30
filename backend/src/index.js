import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import http from 'http';
import { config } from './config/index.js';
import { initRealtime } from './services/realtime.js';
import { healthCheck } from './config/database.js';
import { buscarCEP } from './services/cep.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { pgContext } from './middleware/pgContext.js';
import { tenantResolver } from './middleware/tenantResolver.js';
import { apiLimiter } from './middleware/rateLimiter.js';

// Import routes
import authRoutes from './modules/auth/index.js';
import produtosRoutes from './modules/produtos/index.js';
import pedidosRoutes from './modules/pedidos/index.js';
import clientesRoutes from './modules/clientes/index.js';
import entregadoresRoutes from './modules/entregadores/index.js';
import restauranteRoutes from './modules/restaurante/index.js';
import dashboardRoutes from './modules/dashboard/index.js';
import pagamentosRoutes from './modules/pagamentos/index.js';
import pushRoutes from './modules/push/index.js';

const app = express();
const server = http.createServer(app);

// ============================
// TRUST PROXY (para IP real atrás do nginx)
// Necessário para:
//   - IP allowlist do webhook Asaas
//   - Logs corretos de IP do cliente
// ============================
app.set('trust proxy', 1);

// ============================
// SECURITY MIDDLEWARE
// ============================

// CSP dinâmica: em produção removemos unsafe-eval (Vue build não precisa)
// Em desenvolvimento, unsafe-eval é necessário para o hot-reload do Vite
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https://images.unsplash.com', 'https://viacep.com.br', 'https://brasilapi.com.br'],
  connectSrc: ["'self'", 'https://viacep.com.br', 'https://brasilapi.com.br'],
};

// Em dev, adicionar unsafe-eval (necessário para Vue hot-reload)
if (config.isDev) {
  cspDirectives.scriptSrc.push("'unsafe-eval'");
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: cspDirectives,
  },
  // Outras proteções do helmet ativadas
  crossOriginEmbedderPolicy: false, // Necessário para carregar recursos de terceiros
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    // 1. Exact match
    if (config.corsOrigins.includes(origin)) {
      return callback(null, true);
    }

    // 2. Wildcard subdomain match (ex: *.loopautomacoes.com.br)
    //    matches https://palazzomooca.cliente.loopautomacoes.com.br:8091
    for (const allowed of config.corsOrigins) {
      if (allowed.startsWith('*.')) {
        const wildcardDomain = allowed.substring(1); // ".loopautomacoes.com.br"
        try {
          const originUrl = new URL(origin);
          if (originUrl.hostname.endsWith(wildcardDomain)) {
            return callback(null, true);
          }
        } catch { /* ignore invalid URLs */ }
      }
    }

    // 3. Dev mode: allow all
    if (config.isDev) {
      return callback(null, true);
    }

    callback(new Error(`Origin ${origin} não permitida por CORS.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Guard', 'X-Module', 'X-Tenant-Slug'],
}));

app.use(cookieParser());

// RAW BODY CAPTURE (via verify callback — NÃO consome o stream)
// Necessário para verificação HMAC dos webhooks do Asaas
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString();
  },
}));
app.use(express.urlencoded({ extended: true }));

// ============================
// STATIC FILES (Uploads)
// ============================
// A estrutura de diretórios segue o padrão multi-tenant:
//   ./uploads/{tenantId}/cardapio/
//   ./uploads/{tenantId}/banners/
//   ./uploads/{tenantId}/entregadores/
//   ./uploads/{tenantId}/categorias/
//
// O express.static serve a partir do diretório base,
// e o tenant é resolvido pelo path da URL (/uploads/{tenantId}/...).
app.use('/uploads', express.static(config.upload.dir));

// ============================
// TENANT RESOLVER (identifica o restaurante pelo subdomínio)
// ============================
// Extrai o subdomínio do header Host e busca o tenant no banco.
// Define req.restaurantId para uso nas queries com RLS.
// Deve executar ANTES do pgContext para que req.restaurantId esteja disponível.
app.use('/api', tenantResolver);

// ============================
// PG CONTEXT (define variáveis de sessão para RLS)
// ============================
// Define as variáveis de sessão PostgreSQL (app.restaurant_id, app.user_role, etc.)
// na conexão que executará a query, garantindo isolamento por tenant via RLS.
app.use('/api', pgContext);

// ============================
// API ROUTES
// ============================
// Auth routes: sem restrição de módulo (login público)
app.use('/api/auth', authRoutes);

// Rotas compartilhadas entre módulos (sem restrição de módulo no grupo,
// cada endpoint usa authenticate internamente para verificar permissões)
app.use('/api/produtos', produtosRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/entregadores', entregadoresRoutes);
app.use('/api/restaurante', restauranteRoutes);
app.use('/api/pagamentos', pagamentosRoutes);
app.use('/api/push', pushRoutes);

// Rotas exclusivas do módulo Admin (restrição de módulo aplicada dentro de cada rota)
app.use('/api/dashboard', dashboardRoutes);

// ============================
// TENANT DIAGNOSTIC — mostra como o tenant está sendo resolvido
// ============================
// Acesse: GET /api/debug/tenant
// Mostra o Host header, o domínio extraído, o tenant resolvido e o cache.
app.get('/api/debug/tenant', async (req, res) => {
  res.json({
    host: req.headers.host,
    hostname: req.headers.host?.split(':')[0]?.toLowerCase() || null,
    restaurantId: req.restaurantId || null,
    tenant: req.tenant || null,
  });
});

// ============================
// CEP SEARCH
// ============================
app.post('/api/cep', apiLimiter, async (req, res, next) => {
  try {
    const { cep } = req.body;
    const result = await buscarCEP(cep);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================
// HEALTH CHECK
// ============================
app.get('/api/health', async (req, res) => {
  const db = await healthCheck();
  res.json({
    status: db.alive ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    database: db,
    restaurantId: req.restaurantId || config.restaurantId,
    tenant: req.tenant ? { id: req.tenant.id, slug: req.tenant.slug } : null,
  });
});

// ============================
// ERROR HANDLING
// ============================
app.use(notFound);
app.use(errorHandler);

// ============================
// INIT WEBSOCKETS + START
// ============================
initRealtime(server);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`\n🚀 SaborExpress Backend v2`);
  console.log(`📡 Server: http://localhost:${config.port}`);
  console.log(`🏪 Restaurante ID: ${config.restaurantId}`);
  console.log(`📦 Database: ${config.db.host}:${config.db.port}/${config.db.database}`);
  console.log(`🔧 Mode: ${config.nodeEnv}\n`);
});

// ============================
// GRACEFUL SHUTDOWN
// ============================
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    import('./config/database.js').then(pool => {
      pool.default.end(() => {
        console.log('Database pool closed.');
        process.exit(0);
      });
    });
  });

  // Force close after 10s
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
