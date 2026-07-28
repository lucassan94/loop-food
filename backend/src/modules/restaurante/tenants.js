// ============================================================================
// Tenants (Multi-Tenant Management) — Super Admin apenas
// ============================================================================
// Estes endpoints operam SEM filtro de tenant (acessam todos os restaurantes)
// e são protegidos por authorize('admin') — apenas super admins.
//
// Montado em: /api/restaurante/tenants
// ============================================================================

import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { query, transaction } from '../../config/database.js';
import { config } from '../../config/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { ensureTenantJwtSecret, clearJwtSecretCache } from '../../middleware/auth.js';
import { clearAsaasTenantCache } from '../../services/asaas.js';

const router = Router();

// Schema for creating/updating tenants
const tenantSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório.'),
  slug: z.string().min(1, 'Slug é obrigatório.').regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minúsculas, números e hífens.'),
  dominio: z.string().min(1, 'Domínio é obrigatório.'),
  endereco: z.string().optional().default(''),
  cep: z.string().optional().default(''),
  cidade: z.string().optional().default(''),
  estado: z.string().optional().default(''),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  status_loja: z.boolean().optional().default(true),
  tempo_preparo_min: z.number().int().positive().optional().default(20),
  asaas_api_key: z.string().optional().nullable(),
  asaas_env: z.string().optional().default('sandbox'),
  asaas_webhook_token: z.string().optional().nullable(),
  asaas_webhook_secret: z.string().optional().nullable(),
});

// ──────── GET /api/restaurante/tenants ────────
// Lista TODOS os tenants (sem filtro de tenant)
// Auth já garantido pelo router.use('/tenants', authenticate, authorize('admin')) em index.js
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, nome, slug, dominio, asaas_env,
              status_loja, tempo_preparo_min, latitude, longitude,
              criado_em, atualizado_em,
              CASE WHEN jwt_secret IS NOT NULL THEN true ELSE false END as tem_jwt,
              CASE WHEN asaas_api_key IS NOT NULL THEN true ELSE false END as tem_asaas
       FROM restaurantes
       ORDER BY id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ──────── GET /api/restaurante/tenants/:id ────────
// Retorna dados completos de um tenant (para edição)
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT id, nome, slug, dominio, endereco, cep, cidade, estado,
              latitude, longitude, status_loja, tempo_preparo_min,
              asaas_api_key, asaas_env, asaas_webhook_token, asaas_webhook_secret,
              criado_em, atualizado_em
       FROM restaurantes WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      throw new AppError('Tenant não encontrado.', 404);
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ──────── POST /api/restaurante/tenants ────────
// Cria um novo tenant
router.post('/', async (req, res, next) => {
  try {
    const data = tenantSchema.parse(req.body);

    // Verificar se slug ou dominio já existem
    const existing = await query(
      'SELECT id FROM restaurantes WHERE slug = $1 OR dominio = $2',
      [data.slug, data.dominio]
    );
    if (existing.rows.length > 0) {
      throw new AppError('Já existe um tenant com este slug ou domínio.', 409);
    }

    const result = await transaction(async (client) => {
      // Inserir tenant
      const r = await client.query(
        `INSERT INTO restaurantes (nome, slug, dominio, endereco, cep, cidade, estado,
          latitude, longitude, status_loja, tempo_preparo_min,
          asaas_api_key, asaas_env, asaas_webhook_token, asaas_webhook_secret)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, nome, slug, dominio, criado_em`,
        [data.nome, data.slug, data.dominio, data.endereco, data.cep, data.cidade, data.estado,
         data.latitude || null, data.longitude || null, data.status_loja, data.tempo_preparo_min,
         data.asaas_api_key || null, data.asaas_env, data.asaas_webhook_token || null, data.asaas_webhook_secret || null]
      );
      const tenant = r.rows[0];

      // Gerar JWT secret automaticamente
      await ensureTenantJwtSecret(tenant.id);

      // Criar admin user padrão
      const senhaPadrao = 'admin123';
      const hash = await bcrypt.hash(senhaPadrao, 12);
      await client.query(
        `INSERT INTO restaurante_users (restaurant_id, nome, email, senha_hash, cargo)
         VALUES ($1, $2, $3, $4, 'admin')`,
        [tenant.id, `Admin ${data.nome}`, `admin@${data.slug}.com`, hash]
      );

      return { ...tenant, adminEmail: `admin@${data.slug}.com`, adminSenha: senhaPadrao };
    });

    res.status(201).json({
      message: 'Tenant criado com sucesso!',
      tenant: result,
    });
  } catch (err) {
    next(err);
  }
});

// ──────── PUT /api/restaurante/tenants/:id ────────
// Atualiza dados de um tenant
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = tenantSchema.partial().parse(req.body);

    // Slug soh pode ser atualizado se nao houver conflito
    if (data.slug || data.dominio) {
      const existing = await query(
        'SELECT id FROM restaurantes WHERE (slug = $1 OR dominio = $2) AND id != $3',
        [data.slug || '', data.dominio || '', id]
      );
      if (existing.rows.length > 0) {
        throw new AppError('Ja existe outro tenant com este slug ou dominio.', 409);
      }
    }

    const fields = [];
    const params = [id];
    let idx = 2;

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        fields.push(`${key} = $${idx++}`);
        params.push(value);
      }
    }

    if (fields.length === 0) {
      throw new AppError('Nenhum campo para atualizar.', 400);
    }

    fields.push('atualizado_em = NOW()');

    const result = await query(
      `UPDATE restaurantes SET ${fields.join(', ')} WHERE id = $1 RETURNING id, nome, slug, dominio`,
      params
    );

    if (result.rows.length === 0) {
      throw new AppError('Tenant não encontrado.', 404);
    }

    // Se asaas_api_key foi alterada, limpar cache de credenciais
    if (data.asaas_api_key) {
      clearAsaasTenantCache(parseInt(id));
    }

    res.json({
      message: 'Tenant atualizado com sucesso!',
      tenant: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// ──────── DELETE /api/restaurante/tenants/:id ────────
// Remove um tenant (exclui todos os dados relacionados via CASCADE)
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === config.restaurantId) {
      throw new AppError('Não é possível excluir o tenant padrão.', 400);
    }

    const result = await query(
      'DELETE FROM restaurantes WHERE id = $1 RETURNING id, nome',
      [id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Tenant não encontrado.', 404);
    }

    // Limpar caches relacionados
    clearJwtSecretCache(parseInt(id));
    clearAsaasTenantCache(parseInt(id));

    res.json({
      message: `Tenant "${result.rows[0].nome}" excluído.`,
    });
  } catch (err) {
    next(err);
  }
});

// ──────── POST /api/restaurante/tenants/:id/regenerate-jwt ────────
// Regenera o JWT secret de um tenant (invalida tokens existentes)
router.post('/:id/regenerate-jwt', async (req, res, next) => {
  try {
    const { id } = req.params;
    const secret = crypto.randomBytes(32).toString('hex');

    const result = await query(
      'UPDATE restaurantes SET jwt_secret = $1, atualizado_em = NOW() WHERE id = $2 RETURNING id, nome',
      [secret, id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Tenant não encontrado.', 404);
    }

    // Limpar cache para forçar recarregamento
    clearJwtSecretCache(parseInt(id));

    res.json({
      message: `JWT Secret do tenant "${result.rows[0].nome}" foi regenerado. Todos os usuários precisarão fazer login novamente.`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
