import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { query } from '../../config/database.js';
import { config } from '../../config/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { emitToRestaurant } from '../../services/realtime.js';

const router = Router();

// ============================
// DADOS DO RESTAURANTE
// ============================
router.get('/', async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const result = await query(
      'SELECT id, nome, endereco, cep, cidade, estado, latitude, longitude, status_loja, tempo_preparo_min, modo_sem_entregador, formas_pagamento_aceitas, cor_primaria, cor_secundaria, cor_terciaria, features, logo_base64 FROM restaurantes WHERE id = $1',
      [restaurantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Restaurante não encontrado.', 404);
    }

    // Buscar categorias e produtos para cardápio público
    const categorias = await query(
      'SELECT id, nome, slug, ordem FROM categorias WHERE restaurant_id = $1 ORDER BY ordem ASC',
      [restaurantId]
    );

    const produtos = await query(
      `SELECT p.id, p.nome, p.descricao, p.preco, p.imagem_url, p.imagem_base64, p.categoria_id,
              c.slug as categoria_slug, c.nome as categoria_nome
       FROM produtos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.restaurant_id = $1 AND p.ativo = true
       ORDER BY p.destaque DESC, p.nome ASC`,
      [restaurantId]
    );

    // Buscar raios de entrega
    const raios = await query(
      'SELECT * FROM raios_entrega WHERE restaurant_id = $1 ORDER BY raio_km ASC',
      [restaurantId]
    );

    res.json({
      ...result.rows[0],
      categorias: categorias.rows,
      produtos: produtos.rows,
      raiosEntrega: raios.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ============================
// ATUALIZAR DADOS DO RESTAURANTE (Admin)
// ============================
router.put('/', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { nome, endereco, cep, cidade, estado, latitude, longitude, tempo_preparo_min, modo_sem_entregador, formas_pagamento_aceitas, cor_primaria, cor_secundaria, cor_terciaria, features, logo_base64 } = req.body;

    const fields = [];
    const params = [];
    let idx = 1;

    if (nome !== undefined) { fields.push(`nome = $${idx++}`); params.push(nome); }
    if (endereco !== undefined) { fields.push(`endereco = $${idx++}`); params.push(endereco); }
    if (cep !== undefined) { fields.push(`cep = $${idx++}`); params.push(cep); }
    if (cidade !== undefined) { fields.push(`cidade = $${idx++}`); params.push(cidade); }
    if (estado !== undefined) { fields.push(`estado = $${idx++}`); params.push(estado); }
    if (latitude !== undefined) { fields.push(`latitude = $${idx++}`); params.push(latitude); }
    if (longitude !== undefined) { fields.push(`longitude = $${idx++}`); params.push(longitude); }
    if (tempo_preparo_min !== undefined) { fields.push(`tempo_preparo_min = $${idx++}`); params.push(tempo_preparo_min); }
    if (modo_sem_entregador !== undefined) { fields.push(`modo_sem_entregador = $${idx++}`); params.push(modo_sem_entregador); }
    if (formas_pagamento_aceitas !== undefined) {
      fields.push(`formas_pagamento_aceitas = $${idx++}`);
      params.push(JSON.stringify(formas_pagamento_aceitas));
    }
    if (cor_primaria !== undefined) { fields.push(`cor_primaria = $${idx++}`); params.push(cor_primaria); }
    if (cor_secundaria !== undefined) { fields.push(`cor_secundaria = $${idx++}`); params.push(cor_secundaria); }
    if (cor_terciaria !== undefined) { fields.push(`cor_terciaria = $${idx++}`); params.push(cor_terciaria); }
    if (features !== undefined) {
      fields.push(`features = $${idx++}`);
      params.push(JSON.stringify(features));
    }
    if (logo_base64 !== undefined) { fields.push(`logo_base64 = $${idx++}`); params.push(logo_base64); }

    if (fields.length === 0) {
      throw new AppError('Nenhum campo para atualizar.', 400);
    }

    params.push(restaurantId);

    const result = await query(
      `UPDATE restaurantes SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING *`,
      params
    );

    emitToRestaurant('restaurante:atualizado', result.rows[0], restaurantId);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ============================
// TOGGLE STATUS DA LOJA (Admin)
// ============================
router.post('/toggle-loja', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const result = await query(
      `UPDATE restaurantes SET status_loja = NOT status_loja WHERE id = $1
       RETURNING id, status_loja`,
      [restaurantId]
    );

    emitToRestaurant('restaurante:status_loja', result.rows[0], restaurantId);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ============================
// RAIOS DE ENTREGA (Admin)
// ============================
router.get('/raios-entrega', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const result = await query(
      'SELECT * FROM raios_entrega WHERE restaurant_id = $1 ORDER BY raio_km ASC',
      [restaurantId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/raios-entrega', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { raio_km, tempo_min, tempo_max, custo } = req.body;
    const result = await query(
      `INSERT INTO raios_entrega (restaurant_id, raio_km, tempo_min, tempo_max, custo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [restaurantId, raio_km, tempo_min, tempo_max, custo]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/raios-entrega/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    await query('DELETE FROM raios_entrega WHERE id = $1 AND restaurant_id = $2', [req.params.id, restaurantId]);
    res.json({ message: 'Raio de entrega excluído.' });
  } catch (err) {
    next(err);
  }
});

// ============================
// MENSAGENS DO PEDIDO (Admin -> Cliente)
// ============================
router.post('/mensagens', authenticate, authorize('admin', 'gerente', 'chef'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { pedido_id, mensagem } = req.body;
    const result = await query(
      `INSERT INTO mensagens_pedido (pedido_id, restaurante_id, mensagem)
       VALUES ($1, $2, $3) RETURNING *`,
      [pedido_id, restaurantId, mensagem]
    );

    // Buscar o cliente_id do pedido para notificar
    const pedido = await query('SELECT cliente_id FROM pedidos WHERE id = $1', [pedido_id]);

    emitToRestaurant('mensagem:novo', result.rows[0], restaurantId);
    if (pedido.rows[0]?.cliente_id) {
      const { emitNovaMensagem } = await import('../../services/realtime.js');
      emitNovaMensagem(result.rows[0], pedido.rows[0].cliente_id, restaurantId);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// ============================
// GESTÃO DE EQUIPE (Admin)
// ============================
router.get('/equipe', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const result = await query(
      'SELECT id, nome, email, cargo, ativo, ultimo_acesso, criado_em FROM restaurante_users WHERE restaurant_id = $1',
      [restaurantId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/equipe', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { nome, email, password, cargo } = req.body;
    const senhaHash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO restaurante_users (restaurant_id, nome, email, senha_hash, cargo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nome, email, cargo`,
      [restaurantId, nome, email, senhaHash, cargo || 'caixa']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/equipe/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;
    const { nome, email, password, cargo, ativo } = req.body;

    const fields = [];
    const params = [id, restaurantId];
    let paramIdx = 3;

    if (nome !== undefined) {
      fields.push(`nome = $${paramIdx++}`);
      params.push(nome);
    }
    if (email !== undefined) {
      fields.push(`email = $${paramIdx++}`);
      params.push(email);
    }
    if (cargo !== undefined) {
      fields.push(`cargo = $${paramIdx++}`);
      params.push(cargo);
    }
    if (ativo !== undefined) {
      fields.push(`ativo = $${paramIdx++}`);
      params.push(ativo);
    }
    if (password) {
      const senhaHash = await bcrypt.hash(password, 12);
      fields.push(`senha_hash = $${paramIdx++}`);
      params.push(senhaHash);
    }

    if (fields.length === 0) {
      throw new AppError('Nenhum campo para atualizar.', 400);
    }

    const result = await query(
      `UPDATE restaurante_users SET ${fields.join(', ')} WHERE id = $1 AND restaurant_id = $2
       RETURNING id, nome, email, cargo, ativo`,
      params
    );

    if (result.rows.length === 0) {
      throw new AppError('Usuário não encontrado.', 404);
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/equipe/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    await query('DELETE FROM restaurante_users WHERE id = $1 AND restaurant_id = $2', [req.params.id, restaurantId]);
    res.json({ message: 'Usuário removido.' });
  } catch (err) {
    next(err);
  }
});

// ============================
// SEGURANÇA (Admin)
// ============================
router.put('/seguranca', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { email, senha_atual, nova_senha } = req.body;
    const { id } = req.user;

    if (nova_senha) {
      const user = await query('SELECT senha_hash FROM restaurante_users WHERE id = $1', [id]);
      const valida = await bcrypt.compare(senha_atual, user.rows[0].senha_hash);
      if (!valida) throw new AppError('Senha atual incorreta.', 400);

      const novaHash = await bcrypt.hash(nova_senha, 12);
      await query('UPDATE restaurante_users SET senha_hash = $1 WHERE id = $2', [novaHash, id]);
    }

    if (email) {
      await query('UPDATE restaurante_users SET email = $1 WHERE id = $2', [email, id]);
    }

    res.json({ message: 'Configurações de segurança atualizadas.' });
  } catch (err) {
    next(err);
  }
});

import bannersRouter from './banners.js';

router.use('/banners', bannersRouter);

// ============================
// MESAS (Salão) — CRUD
// ============================
router.get('/mesas', authenticate, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const result = await query(
      'SELECT * FROM mesas WHERE restaurant_id = $1 ORDER BY nome ASC',
      [restaurantId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/mesas', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { nome, capacidade } = req.body;
    if (!nome || !nome.trim()) throw new AppError('Nome da mesa é obrigatório.', 400);

    const result = await query(
      `INSERT INTO mesas (restaurant_id, nome, capacidade)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [restaurantId, nome.trim(), capacidade || 4]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/mesas/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;
    const { nome, capacidade, status } = req.body;

    const fields = [];
    const params = [id, restaurantId];
    let paramIdx = 3;

    if (nome !== undefined) { fields.push(`nome = $${paramIdx++}`); params.push(nome.trim()); }
    if (capacidade !== undefined) { fields.push(`capacidade = $${paramIdx++}`); params.push(capacidade); }
    if (status !== undefined) { fields.push(`status = $${paramIdx++}`); params.push(status); }

    if (fields.length === 0) throw new AppError('Nenhum campo para atualizar.', 400);

    const result = await query(
      `UPDATE mesas SET ${fields.join(', ')} WHERE id = $1 AND restaurant_id = $2
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) throw new AppError('Mesa não encontrada.', 404);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/mesas/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;
    await query('DELETE FROM mesas WHERE id = $1 AND restaurant_id = $2', [id, restaurantId]);
    res.json({ message: 'Mesa excluída.' });
  } catch (err) {
    next(err);
  }
});

export default router;
