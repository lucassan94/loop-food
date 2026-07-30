import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query, transaction } from '../../config/database.js';
import { config } from '../../config/index.js';
import { authenticate, ensureTenantJwtSecret } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { validarTelefone, validarCPF } from '../../utils/validators.js';
import { loginLimiter, signupLimiter, refreshLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

// Schemas de validação
const loginSchema = z.object({
  email: z.string().optional(),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres.'),
});

const loginClienteSchema = z.object({
  telefone: z.string().min(1, 'Telefone é obrigatório.'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres.'),
});

const loginEntregadorSchema = z.object({
  telefone: z.string().min(1, 'Telefone é obrigatório.'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres.'),
});

const loginStaffSchema = z.object({
  apelido: z.string().min(2, 'Apelido deve ter no mínimo 2 caracteres.'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres.'),
});

const signupClienteSchema = z.object({
  nome: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres.'),
  sobrenome: z.string().optional(),
  email: z.string().email('E-mail inválido.').optional().or(z.literal('')),
  telefone: z.string().refine((v) => validarTelefone(v).valido, { message: 'Telefone inválido. Use (XX) XXXXX-XXXX.' }),
  cpf: z.string().refine((v) => !v || validarCPF(v).valido, { message: 'CPF inválido.' }).optional(),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres.'),
});

// Gerar tokens JWT — sessão de longa duração (365 dias)
// Usa JWT secret per-tenant (ou global como fallback)
async function gerarTokens(usuario, restaurantId) {
  // Determinar o módulo com base na role
  const roleMap = {
    'cliente': 'cliente',
    'entregador': 'entregador',
    'restaurante': 'admin',
  };
  const modulo = roleMap[usuario.role] || 'cliente';

  const payload = {
    id: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    role: usuario.role,
    module: modulo,
    cargo: usuario.cargo || usuario.role,
    restaurantId: restaurantId || config.restaurantId,
  };

  // Garantir que o tenant tenha um JWT secret (auto-gera se não existir)
  const secret = await ensureTenantJwtSecret(restaurantId);

  const accessToken = jwt.sign(payload, secret, {
    expiresIn: config.jwt.expiresIn,
  });

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    secret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );

  return { accessToken, refreshToken };
}

// Definir cookie httpOnly
function setTokenCookies(req, res, tokens) {
  // Detecta se a conexão é segura (HTTPS) de forma confiável
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  
  // Duração alinhada com a expiração dos JWTs em config/index.js
  const ACCESS_MAX_AGE = 24 * 60 * 60 * 1000;     // 24h (access token)
  const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7d (refresh token)

  const cookieOptions = {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
  };

  res.cookie('token', tokens.accessToken, {
    ...cookieOptions,
    maxAge: ACCESS_MAX_AGE,
  });

  res.cookie('refreshToken', tokens.refreshToken, {
    ...cookieOptions,
    maxAge: REFRESH_MAX_AGE,
  });

  // Token legível para o frontend (útil para Socket.IO auth e interceptor API)
  res.cookie('publicToken', tokens.accessToken, {
    httpOnly: false,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_MAX_AGE,
  });
}

// ============================
// CLIENTE - Login (por telefone)
// ============================
router.post('/cliente/login', loginLimiter, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { telefone, password } = loginClienteSchema.parse(req.body);

    // Normalizar telefone: remover máscara
    const digits = telefone.replace(/\D/g, '');

    const result = await query(
      `SELECT id, nome, sobrenome, email, telefone, endereco, numero, bairro, complemento, cidade, estado, cep, cpf_cnpj, senha_hash
       FROM clientes
       WHERE restaurant_id = $1 AND REPLACE(REPLACE(REPLACE(telefone, '(', ''), ')', ''), ' ', '') LIKE $2 AND ativo = true`,
      [restaurantId, `%${digits}`]
    );

    const user = result.rows[0];
    if (!user) throw new AppError('Telefone ou senha inválidos.', 401);

    const senhaValida = await bcrypt.compare(password, user.senha_hash);
    if (!senhaValida) throw new AppError('Telefone ou senha inválidos.', 401);

    const tokens = await gerarTokens({ ...user, role: 'cliente' }, restaurantId);
    setTokenCookies(req, res, tokens);

    res.json({
      message: 'Login realizado com sucesso!',
      user: {
        id: user.id,
        nome: user.nome,
        sobrenome: user.sobrenome,
        email: user.email,
        telefone: user.telefone,
        endereco: user.endereco,
        numero: user.numero,
        bairro: user.bairro,
        complemento: user.complemento,
        cidade: user.cidade,
        estado: user.estado,
        cep: user.cep,
        cpf_cnpj: user.cpf_cnpj,
        role: 'cliente',
        module: 'cliente',
      },
      token: tokens.accessToken,
    });
  } catch (err) {
    next(err);
  }
});

// ============================
// CLIENTE - Cadastro
// ============================
router.post('/cliente/signup', signupLimiter, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const data = signupClienteSchema.parse(req.body);

    // Verificar se telefone já existe
    const digits = data.telefone.replace(/\D/g, '');
    const existing = await query(
      'SELECT id FROM clientes WHERE restaurant_id = $1 AND REPLACE(REPLACE(REPLACE(telefone, $$($$), $$)$$), $$ $$, $$\'$$) = $2',
      [restaurantId, `%${digits}`]
    );
    if (existing.rows.length > 0) {
      throw new AppError('Este telefone já está cadastrado.', 409);
    }

    // Verificar se email já existe (se fornecido)
    if (data.email) {
      const existingEmail = await query(
        'SELECT id FROM clientes WHERE email = $1 AND restaurant_id = $2',
        [data.email, restaurantId]
      );
      if (existingEmail.rows.length > 0) {
        throw new AppError('Este e-mail já está cadastrado.', 409);
      }
    }

    const senhaHash = await bcrypt.hash(data.password, 12);

    const result = await transaction(async (client) => {
      const r = await client.query(
        `INSERT INTO clientes (restaurant_id, nome, sobrenome, email, telefone, cpf_cnpj, senha_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, nome, sobrenome, email, telefone, cpf_cnpj`,
        [restaurantId, data.nome, data.sobrenome || '', data.email || '', data.telefone, data.cpf?.replace(/\D/g, '') || '', senhaHash]
      );
      return r.rows[0];
    });

    const tokens = await gerarTokens({ ...result, role: 'cliente' }, restaurantId);
    setTokenCookies(req, res, tokens);

    res.status(201).json({
      message: 'Conta criada com sucesso!',
      user: { ...result, role: 'cliente' },
      token: tokens.accessToken,
    });
  } catch (err) {
    next(err);
  }
});

// ============================
// ENTREGADOR - Login (por telefone)
// ============================
router.post('/entregador/login', loginLimiter, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { telefone, password } = loginEntregadorSchema.parse(req.body);

    const digits = telefone.replace(/\D/g, '');

    const result = await query(
      `SELECT id, nome, email, telefone, senha_hash, status, entregas_total, frete_total_recebido
       FROM entregadores
       WHERE restaurant_id = $1 AND REPLACE(REPLACE(REPLACE(telefone, '(', ''), ')', ''), ' ', '') LIKE $2`,
      [restaurantId, `%${digits}`]
    );

    const user = result.rows[0];
    if (!user) throw new AppError('Telefone ou senha inválidos.', 401);

    if (user.status === 'bloqueado') {
      throw new AppError('Seu acesso foi bloqueado. Entre em contato com o restaurante.', 403);
    }

    const senhaValida = await bcrypt.compare(password, user.senha_hash);
    if (!senhaValida) throw new AppError('Telefone ou senha inválidos.', 401);

    const tokens = await gerarTokens({ ...user, role: 'entregador' }, restaurantId);
    setTokenCookies(req, res, tokens);

    res.json({
      message: 'Login realizado com sucesso!',
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        telefone: user.telefone,
        status: user.status,
        entregasTotal: user.entregas_total,
        freteTotal: user.frete_total_recebido,
        role: 'entregador',
        module: 'entregador',
      },
      token: tokens.accessToken,
    });
  } catch (err) {
    next(err);
  }
});

// ============================
// RESTAURANTE (Staff) - Login (por apelido)
// ============================
router.post('/restaurante/login', loginLimiter, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { apelido, password } = loginStaffSchema.parse(req.body);

    const result = await query(
      `SELECT id, nome, email, apelido, senha_hash, cargo, ativo
       FROM restaurante_users
       WHERE apelido = $1 AND restaurant_id = $2 AND ativo = true`,
      [apelido.toLowerCase(), restaurantId]
    );

    const user = result.rows[0];
    if (!user) throw new AppError('Apelido ou senha inválidos.', 401);
    const senhaValida = await bcrypt.compare(password, user.senha_hash);
    if (!senhaValida) throw new AppError('E-mail ou senha inválidos.', 401);

    // Atualizar último acesso
    await query('UPDATE restaurante_users SET ultimo_acesso = NOW() WHERE id = $1', [user.id]);

    const tokens = await gerarTokens({ ...user, role: 'restaurante' }, restaurantId);
    setTokenCookies(req, res, tokens);

    res.json({
      message: 'Login realizado com sucesso!',
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        apelido: user.apelido,
        cargo: user.cargo,
        role: 'restaurante',
        module: 'admin',
      },
      token: tokens.accessToken,
    });
  } catch (err) {
    next(err);
  }
});

// ============================
// REFRESH TOKEN
// ============================
router.post('/refresh', refreshLimiter, async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!refreshToken) throw new AppError('Refresh token não fornecido.', 401);

    // Decodificar sem verificar primeiro para extrair o restaurantId
    const payload = jwt.decode(refreshToken);
    if (!payload || payload.type !== 'refresh') throw new AppError('Token inválido.', 401);

    // Resolver o secret do tenant
    const rid = payload.restaurantId || req.restaurantId || config.restaurantId;
    const tenantSecret = await ensureTenantJwtSecret(rid);

    // Verificar o refresh token com o secret correto (per-tenant ou global)
    let decoded;
    if (tenantSecret) {
      try {
        decoded = jwt.verify(refreshToken, tenantSecret);
      } catch {
        // Fallback: token pode ter sido assinado com o secret global (migração)
        decoded = jwt.verify(refreshToken, config.jwt.secret);
      }
    } else {
      decoded = jwt.verify(refreshToken, config.jwt.secret);
    }

    const user = {
      id: decoded.id,
      email: decoded.email,
      nome: decoded.nome,
      role: decoded.role,
    };

    const tokens = await gerarTokens(user, rid);
    setTokenCookies(req, res, tokens);

    res.json({
      message: 'Token renovado.',
      token: tokens.accessToken,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.', code: 'SESSION_EXPIRED' });
    }
    next(err);
  }
});

// ============================
// LOGOUT
// ============================
router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.clearCookie('refreshToken', { path: '/' });
  res.clearCookie('publicToken', { path: '/' });
  res.json({ message: 'Logout realizado com sucesso.' });
});

// ============================
// VERIFICAR SESSÃO
// ============================
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { id, role } = req.user;

    if (role === 'cliente') {
      const result = await query(
        'SELECT id, nome, sobrenome, email, telefone, endereco, cep, numero, bairro, complemento, cidade, estado, cpf_cnpj FROM clientes WHERE id = $1',
        [id]
      );
      if (!result.rows[0]) throw new AppError('Usuário não encontrado.', 404);
      return res.json({ user: { ...result.rows[0], role: 'cliente', module: 'cliente' } });
    }

    if (role === 'entregador') {
      const result = await query(
        'SELECT id, nome, email, telefone, status, foto_url, entregas_total, frete_total_recebido, endereco FROM entregadores WHERE id = $1',
        [id]
      );
      if (!result.rows[0]) throw new AppError('Usuário não encontrado.', 404);
      return res.json({ user: { ...result.rows[0], role: 'entregador', module: 'entregador' } });
    }

    if (role === 'restaurante') {
      const result = await query(
        'SELECT id, nome, email, apelido, cargo FROM restaurante_users WHERE id = $1',
        [id]
      );
      if (!result.rows[0]) throw new AppError('Usuário não encontrado.', 404);
      return res.json({ user: { ...result.rows[0], role: 'restaurante', module: 'admin' } });
    }

    throw new AppError('Tipo de usuário inválido.', 400);
  } catch (err) {
    next(err);
  }
});

export default router;
