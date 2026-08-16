import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import http from 'http';
import { config } from './config/index.js';
import { initRealtime } from './services/realtime.js';
import { iniciarPollingRede } from './services/pollingRede.js';
import { iniciarPollingIfood } from './modules/ifood/polling.js';
import { healthCheck } from './config/database.js';
import { buscarCEP } from './services/cep.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { pgContext } from './middleware/pgContext.js';
import { tenantResolver } from './middleware/tenantResolver.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { serveUploadFile } from './config/upload.js';

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
import ifoodRoutes from './modules/ifood/index.js';

const app = express();
const server = http.createServer(app);

// ============================
// TRUST PROXY (para IP real atrás do nginx)
// Necessário para:
//   - Logs corretos de IP do cliente (ipAddress no bloco 3DS da Rede)
//   - Rate limit por IP do cliente (BUG-014)
// ============================
// Em produção o tráfego da UI passa por 2 proxies (NPM externo → router
// nginx → backend). Um número fixo de hops (ex.: 1) era insuficiente e o
// req.ip virava o IP do NPM para todos os clientes — todos compartilhavam
// um único bucket do loginLimiter (um atacante bloqueava o login de todos).
// Confiar apenas em IPs privados (rede Docker/nginx) é robusto para vários
// proxies e não aceita spoofing de X-Forwarded-For vindo de IPs públicos.
app.set('trust proxy', (ip) => {
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  if (ip.startsWith('10.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // 172.16.0.0/12
  if (ip.startsWith('192.168.')) return true;
  return false;
});

// ============================
// SECURITY MIDDLEWARE
// ============================

// CSP dinâmica: em produção removemos unsafe-eval (Vue build não precisa)
// Em desenvolvimento, unsafe-eval é necessário para o hot-reload do Vite.
// Nota: NÃO incluímos 'unsafe-inline' na styleSrc porque este CSP é aplicado
// apenas às respostas JSON da API, não ao HTML da SPA servido pelo nginx.
// O CSP definitivo para o frontend (HTML, JS, CSS) deve ser configurado
// no nginx (Content-Security-Policy-Report-Only ou enforce).
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
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

// JSON body parsing (webhook da Rede usa o body normal do express.json)
// 50mb: uploads de imagens em base64 (arquivo de 5MB vira ~6.7MB; uma
// subcategoria pode conter vários itens com imagem no mesmo payload).
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================
// STATIC FILES (Uploads) — Protegido contra Path Traversal (CWE-22)
// ============================
// A estrutura de diretórios segue o padrão multi-tenant:
//   ./uploads/{tenantId}/cardapio/
//   ./uploads/{tenantId}/banners/
//   ./uploads/{tenantId}/entregadores/
//   ./uploads/{tenantId}/categorias/
//
// Em vez de express.static (que serve arquivos sem validação),
// usamos uma rota controlada que valida cada segmento do path
// contra whitelists e previne path traversal.
app.get('/uploads/:tenantId/:type/:filename', async (req, res, next) => {
  const { tenantId, type, filename } = req.params;
  try {
    await serveUploadFile(tenantId, type, filename, res);
  } catch (err) {
    // serveUploadFile já lida com a maioria dos erros; fallback para o errorHandler
    if (!res.headersSent) next(err);
  }
});

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
app.use('/api/ifood', ifoodRoutes);

// Rotas exclusivas do módulo Admin (restrição de módulo aplicada dentro de cada rota)
app.use('/api/dashboard', dashboardRoutes);

// ============================
// TENANT DIAGNOSTIC — mostra como o tenant está sendo resolvido
// ============================
// ⚠️ CWE-200: APENAS em desenvolvimento — expõe dados internos
// Acesse: GET /api/debug/tenant
// Mostra o Host header, o domínio extraído, o tenant resolvido e o cache.
app.get('/api/debug/tenant', (req, res) => {
  if (!config.isDev) {
    return res.status(404).json({ error: 'Rota não encontrada.', code: 'NOT_FOUND' });
  }
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

// Polling de backup do pagamento (Rede) — confirma PIX quando o webhook não chega
iniciarPollingRede();

// Polling de eventos do iFood — traz pedidos do iFood para a fila (Fases 3+)
iniciarPollingIfood();

server.listen(config.port, '0.0.0.0', () => {
  console.log(`\n🚀 Kardapio Digital Backend v2`);
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
