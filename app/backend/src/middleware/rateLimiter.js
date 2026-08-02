// ============================================================================
// Rate Limiter — protege endpoints contra brute force e abuso
// ============================================================================
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

// Helper: verifica se está em desenvolvimento (pular rate limit)
const isDev = () => config.isDev;

// Limiter de login: 5 tentativas por IP a cada 15 minutos (mais restrito)
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 5,                     // 5 tentativas por janela
  standardHeaders: true,      // Retorna headers RateLimit-*
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  skip: isDev,
});

// Limiter mais restrito para criação de conta
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hora
  max: 5,                     // 5 cadastros por IP por hora
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas de cadastro. Tente novamente em 1 hora.',
    code: 'SIGNUP_RATE_LIMIT_EXCEEDED',
  },
  skip: isDev,
});

// Limiter para refresh token: 10 tentativas por IP a cada 15 minutos
// Previne brute force no refresh de token
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas. Tente novamente em 15 minutos.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  skip: isDev,
});

// Limiter genérico para APIs sensíveis: 30 requisições por IP a cada 1 minuto
// Protege contra scraping e abuso em endpoints como CEP, criação de pedido, etc.
export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,   // 1 minuto
  max: 30,                    // 30 requisições por minuto
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas requisições. Aguarde um momento antes de tentar novamente.',
    code: 'API_RATE_LIMIT_EXCEEDED',
  },
  skip: isDev,
});

// Limiter mais restrito para pedidos: 10 criações por IP a cada 1 hora
// Previne criação massiva de pedidos
export const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hora
  max: 10,                    // 10 pedidos por hora
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitos pedidos criados. Tente novamente em 1 hora.',
    code: 'ORDER_RATE_LIMIT_EXCEEDED',
  },
  skip: isDev,
});
