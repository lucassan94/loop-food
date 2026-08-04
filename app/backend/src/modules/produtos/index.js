import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../../config/database.js';
import { config } from '../../config/index.js';
import { authenticate, authorize, optionalAuth } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { emitToRestaurant } from '../../services/realtime.js';
import { saveBase64AsFile, deleteUploadFile, gerarNomeArquivo } from '../../config/upload.js';
import { produtoDisponivelAgora, produtoNoModulo } from '../../services/itemValidation.js';

const router = Router();

// Schema de validação
const productSchema = z.object({
  nome: z.string().min(1, 'Nome é obrigatório.'),
  descricao: z.string().optional().default(''),
  categoria_id: z.number().optional(),
  preco: z.number().positive('Preço deve ser positivo.'),
  imagem_url: z.string().optional().default(''),
  imagem_base64: z.string().optional().default(''),
  ativo: z.boolean().optional().default(true),
  destaque: z.boolean().optional().default(false),
  extras: z.array(z.object({
    nome: z.string().min(1),
    preco: z.number().min(0),
    maximo: z.number().int().min(0).optional().default(1),
  })).optional().default([]),
  opcoes: z.array(z.object({
    grupo: z.string().min(1, 'Grupo da opção é obrigatório.'),
    tipo: z.enum(['unica', 'multipla']).optional().default('unica'),
    obrigatoria: z.boolean().optional().default(false),
    opcoes: z.array(z.string().min(1)).min(1, 'Cada grupo precisa de ao menos 1 opção.'),
  })).optional().default([]),
  subcategorias: z.array(z.number().int()).optional().default([]),
  // Talheres obrigatório: o cliente deve escolher Sim/Não antes de adicionar
  talheres_obrigatorio: z.boolean().optional().default(false),
  // Módulos de venda: ['delivery', 'salao'] — vazio = todos
  modulos: z.array(z.enum(['delivery', 'salao'])).optional(),
  // Disponibilidade por dia/horário (NULL = sempre disponível)
  dias_semana: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  horario_inicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  horario_fim: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
});

// Schema do catálogo de subcategorias de adicionais (compartilhado)
const subcategoriaSchema = z.object({
  nome: z.string().min(1, 'Nome da subcategoria é obrigatório.'),
  itens: z.array(z.object({
    nome: z.string().min(1, 'Nome do item é obrigatório.'),
    preco: z.number().min(0).optional().default(0),
    maximo: z.number().int().min(0).optional().default(1),
  })).optional().default([]),
});

// ============================
// Helpers — Opções do Prato (gratuitas)
// ============================

// Insere os grupos/opções de um produto dentro de uma transação (ou query)
async function inserirOpcoes(db, produtoId, opcoes) {
  let ordem = 0;
  for (const grupo of opcoes) {
    for (const nome of grupo.opcoes) {
      await db.query(
        `INSERT INTO produto_opcoes (produto_id, grupo, nome, tipo, obrigatoria, ordem)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [produtoId, grupo.grupo, nome, grupo.tipo, grupo.obrigatoria, ordem++]
      );
    }
  }
}

// Agrupa linhas de produto_opcoes em [{grupo, tipo, obrigatoria, opcoes: [{id, nome}]}]
// chaveado por produto_id
function agruparOpcoesPorProduto(rows) {
  const map = {};
  for (const o of rows) {
    if (!map[o.produto_id]) map[o.produto_id] = [];
    const list = map[o.produto_id];
    let g = list.find(x => x.grupo === o.grupo);
    if (!g) {
      g = { grupo: o.grupo, tipo: o.tipo, obrigatoria: o.obrigatoria, opcoes: [] };
      list.push(g);
    }
    g.opcoes.push({ id: o.id, nome: o.nome });
  }
  return map;
}

// Busca as opções (agrupadas) de um produto — aceita a função `query`
// (módulo) ou um `client` de transação (que tem .query)
async function buscarOpcoes(db, produtoId) {
  const run = typeof db === 'function' ? db : (sql, params) => db.query(sql, params);
  const result = await run(
    'SELECT produto_id, id, grupo, nome, tipo, obrigatoria, ordem FROM produto_opcoes WHERE produto_id = $1 ORDER BY ordem, id',
    [produtoId]
  );
  return agruparOpcoesPorProduto(result.rows)[produtoId] || [];
}

// ============================
// Helpers — Subcategorias de adicionais (catálogo compartilhado)
// ============================

// Valida que os ids de subcategoria pertencem ao restaurante (anti cross-tenant)
async function validarSubcategoriasDoRestaurante(db, restaurantId, subcategoriaIds) {
  if (!subcategoriaIds || subcategoriaIds.length === 0) return;
  const result = await db.query(
    'SELECT id FROM extra_subcategorias WHERE restaurant_id = $1 AND id = ANY($2)',
    [restaurantId, subcategoriaIds]
  );
  if (result.rows.length !== subcategoriaIds.length) {
    throw new AppError('Uma ou mais subcategorias não pertencem ao restaurante.', 400);
  }
}

// Vincula as subcategorias ativas de um produto (substitui a lista atual)
async function substituirSubcategoriasDoProduto(db, produtoId, subcategoriaIds) {
  await db.query('DELETE FROM produto_extra_subcategorias WHERE produto_id = $1', [produtoId]);
  for (const sid of subcategoriaIds || []) {
    await db.query(
      'INSERT INTO produto_extra_subcategorias (produto_id, subcategoria_id) VALUES ($1, $2)',
      [produtoId, sid]
    );
  }
}

// Resolve as subcategorias ATIVAS de produtos → { [produto_id]: [{id, nome, itens:[...]}] }
async function buscarSubcategoriasDeProdutos(db, produtoIds) {
  const run = typeof db === 'function' ? db : (sql, params) => db.query(sql, params);
  if (produtoIds.length === 0) return {};
  const linkResult = await run(
    'SELECT produto_id, subcategoria_id FROM produto_extra_subcategorias WHERE produto_id = ANY($1)',
    [produtoIds]
  );
  const linkMap = {};
  const subIds = new Set();
  for (const l of linkResult.rows) {
    if (!linkMap[l.produto_id]) linkMap[l.produto_id] = [];
    linkMap[l.produto_id].push(l.subcategoria_id);
    subIds.add(l.subcategoria_id);
  }
  if (subIds.size === 0) return {};
  const subResult = await run(
    'SELECT id, nome FROM extra_subcategorias WHERE id = ANY($1)',
    [[...subIds]]
  );
  const itemResult = await run(
    'SELECT id, subcategoria_id, nome, preco, maximo, ordem FROM extra_subcategoria_itens WHERE subcategoria_id = ANY($1) ORDER BY ordem, id',
    [[...subIds]]
  );
  const itemMap = {};
  for (const i of itemResult.rows) {
    if (!itemMap[i.subcategoria_id]) itemMap[i.subcategoria_id] = [];
    itemMap[i.subcategoria_id].push({ id: i.id, nome: i.nome, preco: i.preco, maximo: i.maximo });
  }
  const subMap = {};
  for (const s of subResult.rows) subMap[s.id] = { id: s.id, nome: s.nome, itens: itemMap[s.id] || [] };
  const result = {};
  for (const [pid, ids] of Object.entries(linkMap)) {
    result[pid] = ids.map(sid => subMap[sid]).filter(Boolean);
  }
  return result;
}

// ============================
// LISTAR CATEGORIAS
// ============================
router.get('/categorias', async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const result = await query(
      'SELECT id, nome, slug, ordem FROM categorias WHERE restaurant_id = $1 ORDER BY ordem ASC',
      [restaurantId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ============================
// CRIAR CATEGORIA (Admin)
// ============================
router.post('/categorias', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { nome } = req.body;
    if (!nome || !nome.trim()) throw new AppError('Nome da categoria é obrigatório.', 400);

    const slug = nome.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

    // Buscar próxima ordem
    const ordemResult = await query(
      'SELECT COALESCE(MAX(ordem), 0) + 1 as next_ordem FROM categorias WHERE restaurant_id = $1',
      [restaurantId]
    );
    const ordem = ordemResult.rows[0]?.next_ordem || 1;

    const result = await query(
      `INSERT INTO categorias (restaurant_id, nome, slug, ordem)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [restaurantId, nome.trim(), slug, ordem]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return next(new AppError('Já existe uma categoria com este nome.', 409));
    }
    next(err);
  }
});

// ============================
// ATUALIZAR CATEGORIA (Admin)
// ============================
router.put('/categorias/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;
    const { nome } = req.body;
    if (!nome || !nome.trim()) throw new AppError('Nome da categoria é obrigatório.', 400);

    const slug = nome.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

    const result = await query(
      `UPDATE categorias SET nome = $1, slug = $2 WHERE id = $3 AND restaurant_id = $4
       RETURNING *`,
      [nome.trim(), slug, id, restaurantId]
    );

    if (result.rows.length === 0) throw new AppError('Categoria não encontrada.', 404);
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return next(new AppError('Já existe uma categoria com este nome.', 409));
    }
    next(err);
  }
});

// ============================
// EXCLUIR CATEGORIA (Admin)
// ============================
router.delete('/categorias/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;

    // Verificar se há produtos usando esta categoria
    const prodCount = await query(
      'SELECT COUNT(*) as count FROM produtos WHERE categoria_id = $1 AND restaurant_id = $2',
      [id, restaurantId]
    );
    if (parseInt(prodCount.rows[0].count) > 0) {
      throw new AppError('Não é possível excluir: existem produtos vinculados a esta categoria. Remova ou altere a categoria dos produtos primeiro.', 400);
    }

    await query('DELETE FROM categorias WHERE id = $1 AND restaurant_id = $2', [id, restaurantId]);
    res.json({ message: 'Categoria excluída.' });
  } catch (err) {
    next(err);
  }
});

// ============================
// LISTAR PRODUTOS
// ============================
router.get('/', async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { categoria, ativo, busca } = req.query;

    let sql = `
      SELECT p.id, p.nome, p.descricao, p.preco, p.imagem_url, p.imagem_base64, p.ativo, p.destaque,
             p.categoria_id, c.nome as categoria_nome, c.slug as categoria_slug,
             (SELECT COUNT(*) FROM produtos_extras pe WHERE pe.produto_id = p.id)
               + (SELECT COUNT(*) FROM extra_subcategoria_itens esi
                  JOIN produto_extra_subcategorias pes ON pes.subcategoria_id = esi.subcategoria_id
                  WHERE pes.produto_id = p.id) as extras_count
      FROM produtos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.restaurant_id = $1
    `;
    const params = [restaurantId];

    if (categoria && categoria !== 'Todos') {
      sql += ' AND c.slug = $' + (params.length + 1);
      params.push(categoria.toLowerCase());
    }

    if (ativo !== undefined) {
      sql += ' AND p.ativo = $' + (params.length + 1);
      params.push(ativo === 'true');
    }

    if (busca) {
      // Escapar wildcards LIKE (% e _) para evitar buscas não intencionais
      const buscaSegura = busca.replace(/[%_]/g, '\\$&');
      sql += ' AND (LOWER(p.nome) LIKE $' + (params.length + 1) + ' OR LOWER(p.descricao) LIKE $' + (params.length + 1) + ')';
      params.push(`%${buscaSegura.toLowerCase()}%`);
    }

    sql += ' ORDER BY p.destaque DESC, p.nome ASC';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ============================
// LISTAR PRODUTOS COM EXTRAS (Otimizado - 2 queries)
// ============================
// Parâmetros:
//   modulo=delivery|salao — filtra produtos vendidos no módulo (default delivery)
//   Public (cardápio do cliente): também filtra pela disponibilidade por
//   dia/horário (produtos fora da janela ficam pausados).
//   Staff (PDV etc.): autenticado como restaurante → filtra apenas por módulo.
router.get('/com-extras', optionalAuth, async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { categoria, busca } = req.query;
    const modulo = req.query.modulo || 'delivery';
    const isStaff = req.user?.role === 'restaurante';

    let sql = `
      SELECT p.id, p.nome, p.descricao, p.preco, p.imagem_url, p.imagem_base64, p.ativo, p.destaque,
             p.categoria_id, c.nome as categoria_nome, c.slug as categoria_slug,
             p.talheres_obrigatorio, p.modulos, p.dias_semana, p.horario_inicio, p.horario_fim
      FROM produtos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.restaurant_id = $1 AND p.ativo = true
    `;
    const params = [restaurantId];

    if (categoria && categoria !== 'Todos') {
      sql += ' AND c.slug = $' + (params.length + 1);
      params.push(categoria.toLowerCase());
    }

    if (busca) {
      // Escapar wildcards LIKE (% e _) para evitar buscas não intencionais
      const buscaSegura = busca.replace(/[%_]/g, '\\$&');
      sql += ' AND (LOWER(p.nome) LIKE $' + (params.length + 1) + ' OR LOWER(p.descricao) LIKE $' + (params.length + 1) + ')';
      params.push(`%${buscaSegura.toLowerCase()}%`);
    }

    sql += ' ORDER BY p.destaque DESC, p.nome ASC';

    const produtosResult = await query(sql, params);
    const produtos = produtosResult.rows;

    if (produtos.length === 0) return res.json([]);

    // Query 2: Todos os extras de uma vez
    const produtoIds = produtos.map(p => p.id);
    const extrasResult = await query(
      'SELECT produto_id, id, nome, preco, maximo FROM produtos_extras WHERE produto_id = ANY($1) ORDER BY nome',
      [produtoIds]
    );

    // Mapear extras para seus produtos
    const extrasMap = {};
    for (const extra of extrasResult.rows) {
      if (!extrasMap[extra.produto_id]) extrasMap[extra.produto_id] = [];
      extrasMap[extra.produto_id].push({ id: extra.id, nome: extra.nome, preco: extra.preco, maximo: extra.maximo });
    }

    // Query 3: Todas as opções do prato de uma vez
    const opcoesResult = await query(
      'SELECT produto_id, id, grupo, nome, tipo, obrigatoria, ordem FROM produto_opcoes WHERE produto_id = ANY($1) ORDER BY ordem, id',
      [produtoIds]
    );
    const opcoesMap = agruparOpcoesPorProduto(opcoesResult.rows);

    // Query 4: Subcategorias de adicionais ativas (catálogo compartilhado)
    const subcategoriasMap = await buscarSubcategoriasDeProdutos(query, produtoIds);

    let result = produtos.map(p => ({
      ...p,
      extras: extrasMap[p.id] || [],
      opcoes: opcoesMap[p.id] || [],
      subcategorias: subcategoriasMap[p.id] || [],
    }));

    // Filtro por MÓDULO: produto só aparece se estiver liberado no módulo
    result = result.filter(p => produtoNoModulo(p, modulo));

    // Filtro de DISPONIBILIDADE (dias/horários): aplicado apenas no cardápio
    // público (cliente). Staff (PDV) continua vendo todos os pratos do módulo.
    if (!isStaff) {
      result = result.filter(p => produtoDisponivelAgora(p));
    }

    res.json(result);
  } catch (err) { next(err); }
});

// ============================
// SUB CATEGORIAS DE ADICIONAIS (catálogo compartilhado)
// ============================
router.get('/extra-subcategorias', async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const subs = await query(
      'SELECT id, nome, ordem FROM extra_subcategorias WHERE restaurant_id = $1 ORDER BY ordem, id',
      [restaurantId]
    );
    if (subs.rows.length === 0) return res.json([]);
    const subIds = subs.rows.map(s => s.id);
    const itens = await query(
      'SELECT id, subcategoria_id, nome, preco, maximo, ordem FROM extra_subcategoria_itens WHERE subcategoria_id = ANY($1) ORDER BY ordem, id',
      [subIds]
    );
    const map = {};
    for (const i of itens.rows) {
      if (!map[i.subcategoria_id]) map[i.subcategoria_id] = [];
      map[i.subcategoria_id].push({ id: i.id, nome: i.nome, preco: i.preco, maximo: i.maximo });
    }
    res.json(subs.rows.map(s => ({ ...s, itens: map[s.id] || [] })));
  } catch (err) { next(err); }
});

router.post('/extra-subcategorias', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const data = subcategoriaSchema.parse(req.body);
    const result = await transaction(async (client) => {
      const ordemRes = await client.query(
        'SELECT COALESCE(MAX(ordem), 0) + 1 as o FROM extra_subcategorias WHERE restaurant_id = $1',
        [restaurantId]
      );
      const sub = await client.query(
        'INSERT INTO extra_subcategorias (restaurant_id, nome, ordem) VALUES ($1, $2, $3) RETURNING *',
        [restaurantId, data.nome.trim(), ordemRes.rows[0].o]
      );
      let ordem = 0;
      for (const item of data.itens) {
        await client.query(
          `INSERT INTO extra_subcategoria_itens (subcategoria_id, nome, preco, maximo, ordem)
           VALUES ($1, $2, $3, $4, $5)`,
          [sub.rows[0].id, item.nome, item.preco, item.maximo, ordem++]
        );
      }
      return sub.rows[0];
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.put('/extra-subcategorias/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;
    const data = subcategoriaSchema.partial().parse(req.body);
    await transaction(async (client) => {
      const existing = await client.query(
        'SELECT id FROM extra_subcategorias WHERE id = $1 AND restaurant_id = $2',
        [id, restaurantId]
      );
      if (existing.rows.length === 0) throw new AppError('Subcategoria não encontrada.', 404);
      if (data.nome) {
        await client.query('UPDATE extra_subcategorias SET nome = $1 WHERE id = $2', [data.nome.trim(), id]);
      }
      if (data.itens !== undefined) {
        await client.query('DELETE FROM extra_subcategoria_itens WHERE subcategoria_id = $1', [id]);
        let ordem = 0;
        for (const item of data.itens) {
          await client.query(
            `INSERT INTO extra_subcategoria_itens (subcategoria_id, nome, preco, maximo, ordem)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, item.nome, item.preco, item.maximo, ordem++]
          );
        }
      }
    });
    res.json({ message: 'Subcategoria atualizada.', id: parseInt(id) });
  } catch (err) { next(err); }
});

router.delete('/extra-subcategorias/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;
    const result = await query(
      'DELETE FROM extra_subcategorias WHERE id = $1 AND restaurant_id = $2 RETURNING id',
      [id, restaurantId]
    );
    if (result.rows.length === 0) throw new AppError('Subcategoria não encontrada.', 404);
    res.json({ message: 'Subcategoria excluída.', id: parseInt(id) });
  } catch (err) { next(err); }
});

// ============================
// BUSCAR PRODUTO POR ID (com extras)
// ============================
router.get('/:id', async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;

    const productResult = await query(
      `SELECT p.*, c.nome as categoria_nome, c.slug as categoria_slug
       FROM produtos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.id = $1 AND p.restaurant_id = $2`,
      [id, restaurantId]
    );

    if (productResult.rows.length === 0) {
      throw new AppError('Produto não encontrado.', 404);
    }

    const extrasResult = await query(
      'SELECT id, nome, preco, maximo FROM produtos_extras WHERE produto_id = $1 ORDER BY nome',
      [id]
    );

    const opcoes = await buscarOpcoes(query, id);
    const subcategorias = (await buscarSubcategoriasDeProdutos(query, [id]))[id] || [];

    res.json({
      ...productResult.rows[0],
      extras: extrasResult.rows,
      opcoes,
      subcategorias,
    });
  } catch (err) {
    next(err);
  }
});

// ============================
// CRIAR PRODUTO (Admin)
// ============================
router.post('/', authenticate, authorize('admin', 'gerente', 'chef'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const data = productSchema.parse(req.body);

    // Imagem em base64 → salvar na tabela imagens (banco) e usar a URL pública
    let imagemUrl = data.imagem_url || '';
    let imagemBase64 = data.imagem_base64 || '';
    if (imagemBase64 && imagemBase64.length > 50) {
      const filename = gerarNomeArquivo(data.nome, imagemBase64);
      const saved = await saveBase64AsFile(restaurantId, 'cardapio', filename, imagemBase64);
      imagemUrl = saved.publicUrl;
      imagemBase64 = ''; // imagem agora vive na tabela imagens
    }

    const result = await transaction(async (client) => {
      const product = await client.query(
        `INSERT INTO produtos (restaurant_id, nome, descricao, categoria_id, preco, imagem_url, imagem_base64, ativo, destaque,
         talheres_obrigatorio, modulos, dias_semana, horario_inicio, horario_fim)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [restaurantId, data.nome, data.descricao, data.categoria_id || null,
         data.preco, imagemUrl, imagemBase64, data.ativo, data.destaque,
         data.talheres_obrigatorio,
         JSON.stringify(data.modulos || ['delivery', 'salao']),
         data.dias_semana ? JSON.stringify(data.dias_semana) : null,
         data.horario_inicio || null,
         data.horario_fim || null]
      );

      const produto = product.rows[0];

      // Inserir extras se houver (usando parâmetros seguros)
      for (const extra of data.extras) {
        await client.query(
          `INSERT INTO produtos_extras (produto_id, nome, preco, maximo) VALUES ($1, $2, $3, $4)`,
          [produto.id, extra.nome, extra.preco, extra.maximo ?? 1]
        );
      }

      // Inserir opções do prato (gratuitas)
      await inserirOpcoes(client, produto.id, data.opcoes);

      // Vincular subcategorias de adicionais (catálogo compartilhado)
      await validarSubcategoriasDoRestaurante(client, restaurantId, data.subcategorias);
      await substituirSubcategoriasDoProduto(client, produto.id, data.subcategorias);

      return produto;
    });

    emitToRestaurant('produto:novo', result, restaurantId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ============================
// ATUALIZAR PRODUTO (Admin)
// ============================
router.put('/:id', authenticate, authorize('admin', 'gerente', 'chef'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;
    const data = productSchema.partial().parse(req.body);

    // Imagem em base64 → salvar na tabela imagens (banco) e usar a URL pública
    if (data.imagem_base64 && data.imagem_base64.length > 50) {
      // Remover imagem anterior (banco + disco) antes de substituir
      const anterior = await query(
        'SELECT imagem_url FROM produtos WHERE id = $1 AND restaurant_id = $2',
        [id, restaurantId]
      );
      if (anterior.rows[0]?.imagem_url?.startsWith('/uploads/')) {
        await deleteUploadFile(anterior.rows[0].imagem_url);
      }
      const filename = gerarNomeArquivo(data.nome || 'imagem', data.imagem_base64);
      const saved = await saveBase64AsFile(restaurantId, 'cardapio', filename, data.imagem_base64);
      data.imagem_url = saved.publicUrl;
      data.imagem_base64 = ''; // imagem agora vive na tabela imagens
    }

    const result = await transaction(async (client) => {
      // Verificar se o produto existe
      const existing = await client.query(
        'SELECT id FROM produtos WHERE id = $1 AND restaurant_id = $2',
        [id, restaurantId]
      );
      if (existing.rows.length === 0) {
        throw new AppError('Produto não encontrado.', 404);
      }

      // Atualizar campos
      const fields = [];
      const params = [id];
      let paramIndex = 2;

      // Campos JSONB precisam ser serializados (pg serializa arrays JS como
      // arrays do Postgres, não como JSONB)
      if (data.modulos !== undefined) data.modulos = JSON.stringify(data.modulos);
      if (data.dias_semana !== undefined) data.dias_semana = JSON.stringify(data.dias_semana);

      for (const [key, value] of Object.entries(data)) {
        // extras/opcoes/subcategorias são relacionamentos — tratados abaixo
        if (key === 'extras' || key === 'opcoes' || key === 'subcategorias') continue;
        if (value !== undefined) {
          fields.push(`${key} = $${paramIndex}`);
          params.push(value);
          paramIndex++;
        }
      }

      if (fields.length > 0) {
        await client.query(
          `UPDATE produtos SET ${fields.join(', ')} WHERE id = $1`,
          params
        );
      }

      // Atualizar extras se fornecido (usando parâmetros seguros)
      if (data.extras !== undefined) {
        await client.query('DELETE FROM produtos_extras WHERE produto_id = $1', [id]);

        for (const extra of data.extras) {
          await client.query(
            `INSERT INTO produtos_extras (produto_id, nome, preco, maximo) VALUES ($1, $2, $3, $4)`,
            [id, extra.nome, extra.preco, extra.maximo ?? 1]
          );
        }
      }

      // Atualizar opções do prato se fornecido
      if (data.opcoes !== undefined) {
        await client.query('DELETE FROM produto_opcoes WHERE produto_id = $1', [id]);
        await inserirOpcoes(client, id, data.opcoes);
      }

      // Atualizar subcategorias de adicionais se fornecido
      if (data.subcategorias !== undefined) {
        await validarSubcategoriasDoRestaurante(client, restaurantId, data.subcategorias);
        await substituirSubcategoriasDoProduto(client, id, data.subcategorias);
      }

      // Retornar produto atualizado
      const updated = await client.query(
        `SELECT p.*, c.nome as categoria_nome, c.slug as categoria_slug
         FROM produtos p LEFT JOIN categorias c ON p.categoria_id = c.id
         WHERE p.id = $1`,
        [id]
      );

      const extras = await client.query(
        'SELECT id, nome, preco, maximo FROM produtos_extras WHERE produto_id = $1 ORDER BY nome',
        [id]
      );

      const opcoes = await buscarOpcoes(client, id);
      const subcategorias = (await buscarSubcategoriasDeProdutos(client, [id]))[id] || [];

      return { ...updated.rows[0], extras: extras.rows, opcoes, subcategorias };
    });

    emitToRestaurant('produto:atualizado', result, restaurantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================
// EXCLUIR PRODUTO (Admin)
// ============================
router.delete('/:id', authenticate, authorize('admin', 'gerente', 'chef'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;

    const result = await query(
      'DELETE FROM produtos WHERE id = $1 AND restaurant_id = $2 RETURNING id',
      [id, restaurantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Produto não encontrado.', 404);
    }

    emitToRestaurant('produto:deletado', { id: parseInt(id) }, restaurantId);
    res.json({ message: 'Produto excluído com sucesso.', id: parseInt(id) });
  } catch (err) {
    next(err);
  }
});

export default router;
