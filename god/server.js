// ============================================================================
// LoopFood Admin — Tenant Management (LOCAL ONLY)
// ============================================================================
// Este servidor roda APENAS localmente e gerencia tenants diretamente
// no banco de dados de produção, sem necessidade de autenticação.
//
// Uso: node server.js
// Acessar: http://localhost:3002
// ============================================================================

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import pg from 'pg';

const PORT = process.env.ADMIN_PORT || 3002;
const DB_HOST = process.env.DB_HOST || '86.48.18.22';
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const DB_NAME = process.env.DB_NAME || 'delivery';
const DB_USER = process.env.DB_USER || 'default';
const DB_PASS = process.env.DB_PASS || 'default';

const pool = new pg.Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASS,
  max: 5,
});

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

// ─── Health ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', server: 'loopfood-admin-local' });
});

// ============================================================================
// TENANTS CRUD
// ============================================================================

app.get('/api/tenants', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nome, slug, dominio, asaas_env, status_loja,
              tempo_preparo_min, latitude, longitude, criado_em,
              CASE WHEN jwt_secret IS NOT NULL THEN true ELSE false END as tem_jwt,
              CASE WHEN asaas_api_key IS NOT NULL THEN true ELSE false END as tem_asaas
       FROM restaurantes ORDER BY id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tenants/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM restaurantes WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tenants', async (req, res) => {
  const client = await pool.connect();
  try {
    const data = req.body;
    await client.query('BEGIN');
    const tenant = await client.query(
      `INSERT INTO restaurantes (nome, slug, dominio, endereco, cep, cidade, estado,
        latitude, longitude, status_loja, tempo_preparo_min,
        asaas_api_key, asaas_env, asaas_webhook_token, asaas_webhook_secret)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, nome, slug, dominio, criado_em`,
      [data.nome, data.slug, data.dominio, data.endereco||'', data.cep||'', data.cidade||'', data.estado||'',
       data.latitude||null, data.longitude||null, data.status_loja??true, data.tempo_preparo_min||20,
       data.asaas_api_key||null, data.asaas_env||'sandbox', data.asaas_webhook_token||null, data.asaas_webhook_secret||null]
    );
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    await client.query('UPDATE restaurantes SET jwt_secret = $1 WHERE id = $2', [jwtSecret, tenant.rows[0].id]);
    const bcrypt = (await import('bcrypt')).default;
    const hash = await bcrypt.hash('admin123', 12);
    await client.query(
      `INSERT INTO restaurante_users (restaurant_id, nome, email, senha_hash, cargo)
       VALUES ($1, $2, $3, $4, 'admin')`,
      [tenant.rows[0].id, `Admin ${data.nome}`, `admin@${data.slug}.com`, hash]
    );
    await client.query('COMMIT');
    res.status(201).json({ ...tenant.rows[0], adminEmail: `admin@${data.slug}.com`, adminSenha: 'admin123' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    if (err.code === '23505') return res.status(409).json({ error: 'Slug ou domínio já existe.' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// FEATURES (Salão / Delivery)
// ============================================================================

app.get('/api/tenants/:tid/features', async (req, res) => {
  try {
    const result = await pool.query('SELECT features FROM restaurantes WHERE id = $1', [req.params.tid]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant não encontrado' });
    const features = result.rows[0].features || { salao: true, delivery: true };
    res.json(features);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tenants/:tid/features', async (req, res) => {
  try {
    const { tid } = req.params;
    const { features } = req.body;
    if (!features || typeof features !== 'object') {
      return res.status(400).json({ error: 'features deve ser um objeto JSON com salao/delivery.' });
    }
    const result = await pool.query(
      'UPDATE restaurantes SET features = $1, atualizado_em = NOW() WHERE id = $2 RETURNING id, nome, features',
      [JSON.stringify(features), tid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tenants/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const fields = [];
    const params = [id];
    let idx = 2;
    for (const key of ['nome','slug','dominio','endereco','cep','cidade','estado',
                       'latitude','longitude','status_loja','tempo_preparo_min',
                       'asaas_api_key','asaas_env','asaas_webhook_token','asaas_webhook_secret']) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        params.push(data[key]);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
    fields.push('atualizado_em = NOW()');
    const result = await pool.query(
      `UPDATE restaurantes SET ${fields.join(', ')} WHERE id = $1 RETURNING id, nome, slug, dominio`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tenants/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === 1) return res.status(400).json({ error: 'Não pode excluir o tenant padrão.' });
    const result = await pool.query('DELETE FROM restaurantes WHERE id = $1 RETURNING id, nome', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant não encontrado' });
    res.json({ message: `"${result.rows[0].nome}" excluído.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tenants/:id/regenerate-jwt', async (req, res) => {
  try {
    const secret = crypto.randomBytes(32).toString('hex');
    const result = await pool.query(
      'UPDATE restaurantes SET jwt_secret = $1, atualizado_em = NOW() WHERE id = $2 RETURNING id, nome',
      [secret, req.params.id]
    );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant não encontrado' });
    res.json({ message: `JWT do "${result.rows[0].nome}" regenerado.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// USUÁRIOS (Staff do tenant)
// ============================================================================

app.get('/api/tenants/:tid/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nome, email, cargo, ativo, ultimo_acesso, criado_em FROM restaurante_users WHERE restaurant_id = $1 ORDER BY nome',
      [req.params.tid]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tenants/:tid/users', async (req, res) => {
  try {
    const { tid } = req.params;
    const { nome, email, cargo, password } = req.body;
    if (!nome || !email || !password) return res.status(400).json({ error: 'nome, email e password são obrigatórios.' });
    const bcrypt = (await import('bcrypt')).default;
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO restaurante_users (restaurant_id, nome, email, senha_hash, cargo)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nome, email, cargo`,
      [tid, nome, email, hash, cargo || 'caixa']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email já existe para este tenant.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tenants/:tid/users/:uid', async (req, res) => {
  try {
    const { tid, uid } = req.params;
    const { nome, email, cargo, password } = req.body;
    const fields = [];
    const params = [uid, tid];
    let idx = 3;
    if (nome !== undefined) { fields.push(`nome = $${idx++}`); params.push(nome); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); params.push(email); }
    if (cargo !== undefined) { fields.push(`cargo = $${idx++}`); params.push(cargo); }
    if (password) {
      const bcrypt = (await import('bcrypt')).default;
      const hash = await bcrypt.hash(password, 12);
      fields.push(`senha_hash = $${idx++}`);
      params.push(hash);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
    const result = await pool.query(
      `UPDATE restaurante_users SET ${fields.join(', ')} WHERE id = $1 AND restaurant_id = $2 RETURNING id, nome, email, cargo`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tenants/:tid/users/:uid', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM restaurante_users WHERE id = $1 AND restaurant_id = $2 RETURNING id, nome',
      [req.params.uid, req.params.tid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ message: `"${result.rows[0].nome}" removido.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// CARDÁPIO (Categorias + Produtos + Extras)
// ============================================================================

app.get('/api/tenants/:tid/cardapio', async (req, res) => {
  try {
    const { tid } = req.params;
    const categorias = await pool.query(
      'SELECT * FROM categorias WHERE restaurant_id = $1 ORDER BY ordem ASC, nome ASC',
      [tid]
    );
    const produtos = await pool.query(
      `SELECT p.*, c.nome as categoria_nome, c.slug as categoria_slug
       FROM produtos p LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.restaurant_id = $1 ORDER BY p.destaque DESC, p.nome ASC`,
      [tid]
    );
    const extras = await pool.query(
      `SELECT pe.*, p.nome as produto_nome
       FROM produtos_extras pe
       JOIN produtos p ON pe.produto_id = p.id
       WHERE p.restaurant_id = $1 ORDER BY p.nome, pe.nome`,
      [tid]
    );
    res.json({ categorias: categorias.rows, produtos: produtos.rows, extras: extras.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Categorias
app.post('/api/tenants/:tid/categorias', async (req, res) => {
  try {
    const { tid } = req.params;
    const { nome, slug, ordem } = req.body;
    if (!nome || !slug) return res.status(400).json({ error: 'nome e slug são obrigatórios.' });
    const result = await pool.query(
      `INSERT INTO categorias (restaurant_id, nome, slug, ordem)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tid, nome, slug, ordem ?? 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug já existe para este tenant.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tenants/:tid/categorias/:cid', async (req, res) => {
  try {
    const { tid, cid } = req.params;
    const { nome, slug, ordem } = req.body;
    const fields = []; const params = [cid, tid]; let idx = 3;
    if (nome !== undefined) { fields.push(`nome = $${idx++}`); params.push(nome); }
    if (slug !== undefined) { fields.push(`slug = $${idx++}`); params.push(slug); }
    if (ordem !== undefined) { fields.push(`ordem = $${idx++}`); params.push(ordem); }
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo.' });
    const result = await pool.query(
      `UPDATE categorias SET ${fields.join(', ')} WHERE id = $1 AND restaurant_id = $2 RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Categoria não encontrada.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tenants/:tid/categorias/:cid', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM categorias WHERE id = $1 AND restaurant_id = $2 RETURNING id, nome',
      [req.params.cid, req.params.tid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Categoria não encontrada.' });
    res.json({ message: `"${result.rows[0].nome}" excluída.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Produtos
app.post('/api/tenants/:tid/produtos', async (req, res) => {
  try {
    const { tid } = req.params;
    const { nome, descricao, preco, categoria_id, ativo, destaque, imagem_base64 } = req.body;
    if (!nome || preco === undefined) return res.status(400).json({ error: 'nome e preco são obrigatórios.' });
    const result = await pool.query(
      `INSERT INTO produtos (restaurant_id, categoria_id, nome, descricao, preco, ativo, destaque, imagem_base64)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tid, categoria_id||null, nome, descricao||'', preco, ativo??true, destaque??false, imagem_base64||null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tenants/:tid/produtos/:pid', async (req, res) => {
  try {
    const { tid, pid } = req.params;
    const allowed = ['nome','descricao','preco','categoria_id','ativo','destaque','imagem_url','imagem_base64'];
    const fields = []; const params = [pid, tid]; let idx = 3;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${idx++}`); params.push(req.body[key]); }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo.' });
    const result = await pool.query(
      `UPDATE produtos SET ${fields.join(', ')} WHERE id = $1 AND restaurant_id = $2 RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tenants/:tid/produtos/:pid', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM produtos WHERE id = $1 AND restaurant_id = $2 RETURNING id, nome',
      [req.params.pid, req.params.tid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    res.json({ message: `"${result.rows[0].nome}" excluído.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extras de produtos
app.post('/api/tenants/:tid/extras', async (req, res) => {
  try {
    const { produto_id, nome, preco } = req.body;
    if (!produto_id || !nome) return res.status(400).json({ error: 'produto_id e nome são obrigatórios.' });
    const result = await pool.query(
      `INSERT INTO produtos_extras (produto_id, nome, preco) VALUES ($1, $2, $3) RETURNING *`,
      [produto_id, nome, preco||0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tenants/:tid/extras/:eid', async (req, res) => {
  try {
    const { eid } = req.params;
    const { nome, preco } = req.body;
    if (!nome) return res.status(400).json({ error: 'nome é obrigatório.' });
    const result = await pool.query(
      `UPDATE produtos_extras SET nome = $1, preco = $2 WHERE id = $3 RETURNING *`,
      [nome, preco||0, eid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Extra não encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tenants/:tid/extras/:eid', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM produtos_extras WHERE id = $1 RETURNING id, nome', [req.params.eid]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Extra não encontrado.' });
    res.json({ message: `"${result.rows[0].nome}" excluído.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// FORMAS DE PAGAMENTO (armazenadas em restaurantes.config)
// ============================================================================

app.get('/api/tenants/:tid/pagamentos', async (req, res) => {
  try {
    const result = await pool.query('SELECT config FROM restaurantes WHERE id = $1', [req.params.tid]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant não encontrado.' });
    const config = result.rows[0].config || {};
    res.json(config.formas_pagamento || ['dinheiro', 'credito', 'debito', 'pix']);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tenants/:tid/pagamentos', async (req, res) => {
  try {
    const { tid } = req.params;
    const { formas_pagamento } = req.body;
    if (!Array.isArray(formas_pagamento)) return res.status(400).json({ error: 'formas_pagamento deve ser um array.' });
    // Merge com config existente
    const curr = await pool.query('SELECT config FROM restaurantes WHERE id = $1', [tid]);
    if (curr.rows.length === 0) return res.status(404).json({ error: 'Tenant não encontrado.' });
    const config = curr.rows[0].config || {};
    config.formas_pagamento = formas_pagamento;
    await pool.query('UPDATE restaurantes SET config = $1 WHERE id = $2', [JSON.stringify(config), tid]);
    res.json({ formas_pagamento });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ENTREGADORES
// ============================================================================

app.get('/api/tenants/:tid/drivers', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nome, email, telefone, cpf, status, entregas_total,
              frete_total_recebido, criado_em
       FROM entregadores WHERE restaurant_id = $1 ORDER BY nome`,
      [req.params.tid]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tenants/:tid/drivers', async (req, res) => {
  try {
    const { tid } = req.params;
    const { nome, email, telefone, cpf, password, status } = req.body;
    if (!nome || !email || !password) return res.status(400).json({ error: 'nome, email e password são obrigatórios.' });
    const bcrypt = (await import('bcrypt')).default;
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO entregadores (restaurant_id, nome, email, telefone, cpf, senha_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nome, email, status`,
      [tid, nome, email, telefone||'', cpf||'', hash, status||'ativo']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email ou CPF já existe para este tenant.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tenants/:tid/drivers/:did', async (req, res) => {
  try {
    const { tid, did } = req.params;
    const allowed = ['nome','email','telefone','cpf','status'];
    const fields = []; const params = [did, tid]; let idx = 3;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${idx++}`); params.push(req.body[key]); }
    }
    if (req.body.password) {
      const bcrypt = (await import('bcrypt')).default;
      const hash = await bcrypt.hash(req.body.password, 12);
      fields.push(`senha_hash = $${idx++}`);
      params.push(hash);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo.' });
    const result = await pool.query(
      `UPDATE entregadores SET ${fields.join(', ')} WHERE id = $1 AND restaurant_id = $2 RETURNING id, nome, email, status`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entregador não encontrado.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tenants/:tid/drivers/:did', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM entregadores WHERE id = $1 AND restaurant_id = $2 RETURNING id, nome',
      [req.params.did, req.params.tid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entregador não encontrado.' });
    res.json({ message: `"${result.rows[0].nome}" excluído.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// CEP (ViaCEP)
// ============================================================================

app.get('/api/cep/:cep', async (req, res) => {
  try {
    const cep = req.params.cep.replace(/\D/g, '');
    if (cep.length !== 8) return res.status(400).json({ error: 'CEP deve ter 8 dígitos.' });
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await response.json();
    if (data.erro) return res.status(404).json({ error: 'CEP não encontrado.' });
    res.json({
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      estado: data.uf || '',
      cep: data.cep || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏪 LoopFood Admin — Local Tenant Manager`);
  console.log(`📡 http://localhost:${PORT}`);
  console.log(`📦 DB: ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
  console.log(`⚠️  LOCAL ONLY — Não use em produção!\n`);
});
