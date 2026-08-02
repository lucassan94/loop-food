import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',

  // Database
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'delivery',
    user: process.env.DB_USER || 'default',
    password: process.env.DB_PASS || 'default',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  },

  // JWT
  jwt: {
    secret: (() => {
      const s = process.env.JWT_SECRET;
      if (process.env.NODE_ENV === 'production') {
        if (s === 'dev-secret-change-in-production' || !s) {
          console.warn('╔══════════════════════════════════════════════════════════╗');
          console.warn('║  ⚠️  AVISO: JWT_SECRET está usando o valor PADRÃO!     ║');
          console.warn('║  Crie um arquivo .env com um secret seguro:            ║');
          console.warn('║  JWT_SECRET=suachaveaqui                               ║');
          console.warn('║  Gere com: node -e "console.log(require(\'crypto\')    ║');
          console.warn('║    .randomBytes(32).toString(\'hex\'))"               ║');
          console.warn('╚══════════════════════════════════════════════════════════╝');
        }
      }
      return s || 'dev-secret-change-in-production';
    })(),
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  // Multi-tenant: Restaurant ID (fallback para desenvolvimento local)
  // Em produção, o tenantResolver extrai o restaurant_id do subdomínio.
  // Este valor é usado apenas quando o tenantResolver não consegue resolver
  // (ex: localhost, chamadas diretas por IP, scripts de migração/seed).
  restaurantId: parseInt(process.env.RESTAURANT_ID || '1', 10),

  // CORS
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),

  // Upload
  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10),
  },

  // Rede Payment Gateway (e-Rede v2 / OAuth2)
  // Credenciais são PER-TENANT (colunas rede_* em restaurantes, configuradas no módulo god).
  // Este bloco contém apenas defaults globais + URLs por ambiente.
  rede: {
    environment: process.env.REDE_ENV || 'sandbox',
    // URLs do endpoint OAuth2 (token)
    tokenBaseUrls: {
      sandbox: 'https://rl7-sandbox-api.useredecloud.com.br',
      production: 'https://api.userede.com.br/redelabs',
    },
    // URLs base dos serviços de negócio (v2)
    businessBaseUrls: {
      sandbox: 'https://sandbox-erede.useredecloud.com.br',
      production: 'https://api.userede.com.br/erede',
    },
    // Token global de fallback para validação de webhook (opcional; por padrão usa o token do tenant)
    webhookToken: process.env.REDE_WEBHOOK_TOKEN || '',
    // Expiração do QR Code PIX em minutos (decisão: 15min; máximo permitido pela Rede: 15 dias)
    pixExpiryMinutes: parseInt(process.env.REDE_PIX_EXPIRY || '15', 10),
    // Timeout de cada chamada HTTP à Rede
    requestTimeout: parseInt(process.env.REDE_REQUEST_TIMEOUT || '30000', 10),
    // Cache do access_token OAuth2 (token válido por 24 min; renovamos com margem)
    tokenCacheMs: 20 * 60 * 1000,
  },
};
