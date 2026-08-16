import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../../config/database.js';
import { config } from '../../config/index.js';
import { authenticate, authorize, optionalAuth } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { emitToRestaurant } from '../../services/realtime.js';
import { saveBase64AsFile, deleteUploadFile, gerarNomeArquivo } from '../../config/upload.js';
import { TZ_RESTAURANTE } from '../../services/horarios.js';
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
  // Grupos padrão vinculados (ids do catálogo opcoes_padrao — vínculo ao vivo)
  opcoes_padrao: z.array(z.number().int()).optional().default([]),
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
  // 'manual' = itens pré-cadastrados; 'categoria' = usa produtos ativos de uma
  // categoria do cardápio inteira (ex: Bebidas) com o preço do próprio produto
  tipo: z.enum(['manual', 'categoria']).optional().default('manual'),
  categoria_id: z.number().int().nullable().optional(),
  itens: z.array(z.object({
    nome: z.string().min(1, 'Nome do item é obrigatório.'),
    preco: z.number().min(0).optional().default(0),
    maximo: z.number().int().min(0).optional().default(1),
    descricao: z.string().optional().default(''),
    imagem_url: z.string().optional().default(''),
    imagem_base64: z.string().optional().default(''),
  })).optional().default([]),
});

// Schema do catálogo de Opções Padrão do Prato (compartilhado)
const opcaoPadraoSchema = z.object({
  grupo: z.string().min(1, 'Nome do grupo é obrigatório.'),
  tipo: z.enum(['unica', 'multipla']).optional().default('unica'),
  obrigatoria: z.boolean().optional().default(false),
  opcoes: z.array(z.string().min(1)).min(1, 'Cada grupo precisa de ao menos 1 opção.'),
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
// Helpers — Opções Padrão (catálogo compartilhado, vínculo ao vivo)
// ============================

// Insere os grupos/opções padrão (tabela própria) dentro de transação/query
async function inserirOpcoesPadrao(db, grupoId, opcoes) {
  let ordem = 0;
  for (const nome of opcoes) {
    try {
      await db.query(
        `INSERT INTO opcoes_padrao_itens (opcao_padrao_id, nome, ordem)
         VALUES ($1, $2, $3)`,
        [grupoId, nome, ordem++]
      );
    } catch (e) { /* tabela pode não existir ainda */ }
  }
}

// Agrupa linhas de opcoes_padrao_itens em [{id, grupo, tipo, obrigatoria, opcoes:[{id, nome}]}]
function agruparOpcoesPadrao(rows) {
  const map = {};
  const grupos = [];
  for (const o of rows) {
    if (!map[o.opcao_padrao_id]) {
      map[o.opcao_padrao_id] = { id: o.opcao_padrao_id, grupo: o.grupo, tipo: o.tipo, obrigatoria: o.obrigatoria, opcoes: [] };
      grupos.push(map[o.opcao_padrao_id]);
    }
    map[o.opcao_padrao_id].opcoes.push({ id: o.id, nome: o.nome });
  }
  return grupos;
}

// Busca grupos padrão (com itens) por ids — aceita `query` ou `client`
async function buscarOpcoesPadrao(db, ids) {
  const run = typeof db === 'function' ? db : (sql, params) => db.query(sql, params);
  if (!ids || ids.length === 0) return [];
  try {
    const result = await run(
      `SELECT op.id, op.grupo, op.tipo, op.obrigatoria, op.ordem, oi.id as item_id, oi.nome
       FROM opcoes_padrao op
       LEFT JOIN opcoes_padrao_itens oi ON oi.opcao_padrao_id = op.id
       WHERE op.id = ANY($1)
       ORDER BY op.ordem, oi.ordem, oi.id`,
      [ids]
    );
    return agruparOpcoesPadrao(result.rows);
  } catch (e) { return []; }
}

// Busca os grupos padrão VINCULADOS a um produto (produto_opcoes_padrao)
async function buscarOpcoesPadraoDoProduto(db, produtoId) {
  const run = typeof db === 'function' ? db : (sql, params) => db.query(sql, params);
  try {
    const link = await run(
      'SELECT opcao_padrao_id FROM produto_opcoes_padrao WHERE produto_id = $1 ORDER BY opcao_padrao_id',
      [produtoId]
    );
    const ids = link.rows.map(r => r.opcao_padrao_id);
    return buscarOpcoesPadrao(run, ids);
  } catch (e) { return []; }
}

// Substitui os vínculos de grupos padrão de um produto
async function substituirOpcoesPadraoDoProduto(db, produtoId, ids) {
  try {
    await db.query('DELETE FROM produto_opcoes_padrao WHERE produto_id = $1', [produtoId]);
    for (const gid of ids || []) {
      await db.query(
        'INSERT INTO produto_opcoes_padrao (produto_id, opcao_padrao_id) VALUES ($1, $2)',
        [produtoId, gid]
      );
    }
  } catch (e) { /* tabela pode não existir ainda */ }
}

// Valida que os ids de grupos padrão pertencem ao restaurante (anti cross-tenant)
async function validarOpcoesPadraoDoRestaurante(db, restaurantId, ids) {
  if (!ids || ids.length === 0) return;
  try {
    const result = await db.query(
      'SELECT id FROM opcoes_padrao WHERE restaurant_id = $1 AND id = ANY($2)',
      [restaurantId, ids]
    );
    if (result.rows.length !== ids.length) {
      throw new AppError('Um ou mais grupos padrão não pertencem ao restaurante.', 400);
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Tabela pode não existir ainda — ignorar validação
  }
}

// Mescla as opções de um produto: avulsas (produto_opcoes) + grupos padrão
// vinculados (vínculo ao vivo). Grupos padrão vêm DEPOIS dos avulsos.
async function buscarOpcoesComPadrao(db, produtoId) {
  const avulsas = await buscarOpcoes(db, produtoId);
  const padrao = await buscarOpcoesPadraoDoProduto(db, produtoId);
  return [...avulsas, ...padrao];
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

// Resolve os itens de um conjunto de subcategorias.
// Subcategorias 'manual' → itens pré-cadastrados (com imagem/descrição).
// Subcategorias 'categoria' → produtos ATIVOS da categoria do cardápio,
// com o preço do próprio produto (sincronizado com o cardápio).
// Retorna { [subcategoria_id]: {id, nome, tipo, categoria_id, itens:[...]} }
async function resolverSubcategorias(db, subIds) {
  const run = typeof db === 'function' ? db : (sql, params) => db.query(sql, params);
  if (!subIds || subIds.length === 0) return {};
  // Tentar buscar com colunas novas (tipo, categoria_id); se falhar, usar fallback
  let subResult;
  try {
    subResult = await run(
      'SELECT id, nome, tipo, categoria_id FROM extra_subcategorias WHERE id = ANY($1)',
      [subIds]
    );
  } catch (e) {
    // Colunas tipo/categoria_id não existem — buscar só id/nome
    subResult = await run(
      'SELECT id, nome FROM extra_subcategorias WHERE id = ANY($1)',
      [subIds]
    );
    // Adicionar campos default
    for (const r of subResult.rows) { r.tipo = 'manual'; r.categoria_id = null; }
  }
  const subMap = {};
  for (const s of subResult.rows) subMap[s.id] = { id: s.id, nome: s.nome, tipo: s.tipo || 'manual', categoria_id: s.categoria_id, itens: [] };

  const manualIds = subResult.rows.filter(s => (s.tipo || 'manual') === 'manual').map(s => s.id);
  if (manualIds.length > 0) {
    try {
      const itemResult = await run(
        'SELECT id, subcategoria_id, nome, preco, maximo, descricao, imagem_url, imagem_base64, ordem FROM extra_subcategoria_itens WHERE subcategoria_id = ANY($1) ORDER BY ordem, id',
        [manualIds]
      );
      for (const i of itemResult.rows) {
        subMap[i.subcategoria_id].itens.push({
          id: i.id, nome: i.nome, preco: i.preco, maximo: i.maximo,
          descricao: i.descricao || '', imagem_url: i.imagem_url || '', imagem_base64: i.imagem_base64 || '',
        });
      }
    } catch (e) {
      // Colunas descricao/imagem podem não existir — buscar só id/nome/preco/maximo
      const itemResult = await run(
        'SELECT id, subcategoria_id, nome, preco, maximo, ordem FROM extra_subcategoria_itens WHERE subcategoria_id = ANY($1) ORDER BY ordem, id',
        [manualIds]
      );
      for (const i of itemResult.rows) {
        subMap[i.subcategoria_id].itens.push({
          id: i.id, nome: i.nome, preco: i.preco, maximo: i.maximo,
          descricao: '', imagem_url: '', imagem_base64: '',
        });
      }
    }
  }

  // Subcategorias do tipo categoria: itens = produtos ATIVOS da categoria
  const catIds = [...new Set(subResult.rows.filter(s => (s.tipo || 'manual') === 'categoria' && s.categoria_id).map(s => s.categoria_id))];
  if (catIds.length > 0) {
    const produtos = await run(
      `SELECT id, categoria_id, nome, preco, descricao, imagem_url, imagem_base64
       FROM produtos WHERE categoria_id = ANY($1) AND ativo = true ORDER BY nome`,
      [catIds]
    );
    for (const sub of subResult.rows.filter(s => (s.tipo || 'manual') === 'categoria')) {
      subMap[sub.id].itens = produtos.rows
        .filter(p => p.categoria_id === sub.categoria_id)
        .map(p => ({
          id: p.id, nome: p.nome, preco: p.preco, maximo: 1,
          descricao: p.descricao || '', imagem_url: p.imagem_url || '', imagem_base64: p.imagem_base64 || '',
          produto_fonte: true,
        }));
    }
  }
  return subMap;
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
  const subMap = await resolverSubcategorias(run, [...subIds]);
  const result = {};
  for (const [pid, ids] of Object.entries(linkMap)) {
    result[pid] = ids.map(sid => subMap[sid]).filter(Boolean);
  }
  return result;
}

// ============================
// Helpers — Imagens de itens do catálogo (base64 → tabela imagens)
// ============================

// Converte o base64 de cada item para a tabela `imagens` (URL pública
// /uploads/...). O JSON do cardápio fica leve (sem base64 embutido) e o
// saveBase64AsFile já otimiza a imagem (sharp, ≤1200px). Itens sem base64
// (URL externa ou sem imagem) são mantidos como estão.
async function moverItensImagensParaUrl(restaurantId, itens) {
  for (const item of itens || []) {
    if (item.imagem_base64 && item.imagem_base64.length > 50) {
      const filename = gerarNomeArquivo(item.nome || 'item', item.imagem_base64);
      const saved = await saveBase64AsFile(restaurantId, 'cardapio', filename, item.imagem_base64);
      item.imagem_url = saved.publicUrl;
      item.imagem_base64 = '';
    }
  }
  return itens;
}

// Remove as imagens (banco + disco) dos itens de uma subcategoria.
// Usado ao substituir itens (PUT) ou excluir a subcategoria.
async function removerImagensDosItens(subcategoriaId) {
  const itens = await query(
    'SELECT imagem_url FROM extra_subcategoria_itens WHERE subcategoria_id = $1',
    [subcategoriaId]
  );
  for (const it of itens.rows) {
    if (it.imagem_url?.startsWith('/uploads/')) {
      try { await deleteUploadFile(it.imagem_url); } catch { /* imagem já inexistente */ }
    }
  }
}

// ============================
// LISTAR CATEGORIAS
// ============================
router.get('/categorias', async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    // Inclui produto_count (quantos produtos usam a categoria) para o painel
    const result = await query(
      `SELECT c.id, c.nome, c.slug, c.ordem,
              (SELECT COUNT(*) FROM produtos p WHERE p.categoria_id = c.id AND p.restaurant_id = c.restaurant_id)::int AS produto_count
       FROM categorias c
       WHERE c.restaurant_id = $1
       ORDER BY c.ordem ASC`,
      [restaurantId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// ============================
// REORDENAR CATEGORIAS (Admin)
// ============================
// Recebe a lista de ids na ordem desejada e renumera a coluna `ordem` numa
// transação. O cardápio exibe as seções de categoria por essa ordem.
// ⚠️ Registrada ANTES de PUT /categorias/:id (senão 'reordenar' cairia no :id).
router.put('/categorias/reordenar', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => !Number.isInteger(id))) {
      throw new AppError('Envie a lista de ids das categorias na ordem desejada.', 400);
    }

    // Anti cross-tenant: todos os ids devem pertencer ao restaurante
    const unicos = [...new Set(ids)];
    const valid = await query(
      'SELECT id FROM categorias WHERE restaurant_id = $1 AND id = ANY($2)',
      [restaurantId, unicos]
    );
    if (valid.rows.length !== unicos.length) {
      throw new AppError('Uma ou mais categorias não pertencem ao restaurante.', 400);
    }

    await transaction(async (client) => {
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          'UPDATE categorias SET ordem = $1 WHERE id = $2 AND restaurant_id = $3',
          [i + 1, ids[i], restaurantId]
        );
      }
    });

    const result = await query(
      'SELECT id, nome, slug, ordem FROM categorias WHERE restaurant_id = $1 ORDER BY ordem ASC',
      [restaurantId]
    );

    // Cardápio mudou — cliente recarrega categorias/produtos ao vivo
    emitToRestaurant('cardapio:atualizado', { tipo: 'categorias' }, restaurantId);

    res.json(result.rows);
  } catch (err) { next(err); }
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

    // Cardápio mudou — cliente recarrega categorias/produtos ao vivo
    emitToRestaurant('cardapio:atualizado', { tipo: 'categorias' }, restaurantId);

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

    // Cardápio mudou — cliente recarrega categorias/produtos ao vivo
    emitToRestaurant('cardapio:atualizado', { tipo: 'categorias' }, restaurantId);

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

    // Cardápio mudou — cliente recarrega categorias/produtos ao vivo
    emitToRestaurant('cardapio:atualizado', { tipo: 'categorias' }, restaurantId);

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
             p.talheres_obrigatorio, p.modulos, p.dias_semana, p.horario_inicio, p.horario_fim,
             (SELECT COUNT(*) FROM produtos_extras pe WHERE pe.produto_id = p.id)
               + (SELECT COUNT(*) FROM extra_subcategoria_itens esi
                  JOIN produto_extra_subcategorias pes ON pes.subcategoria_id = esi.subcategoria_id
                  WHERE pes.produto_id = p.id) as extras_count,
             (SELECT COUNT(*) FROM produto_opcoes po WHERE po.produto_id = p.id)
               + (SELECT COUNT(*) FROM produto_opcoes_padrao pop WHERE pop.produto_id = p.id) as opcoes_count
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

    // Ordem das seções do cardápio = ordem das categorias (ordem editável no
    // painel); dentro de cada categoria, destaque + nome.
    sql += ' ORDER BY c.ordem ASC NULLS LAST, p.destaque DESC, p.nome ASC';

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

    // Ordem das seções do cardápio = ordem das categorias (ordem editável no
    // painel); dentro de cada categoria, destaque + nome.
    sql += ' ORDER BY c.ordem ASC NULLS LAST, p.destaque DESC, p.nome ASC';

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

    // Query 3: Todas as opções do prato de uma vez (avulsas + grupos padrão vinculados)
    const opcoesResult = await query(
      'SELECT produto_id, id, grupo, nome, tipo, obrigatoria, ordem FROM produto_opcoes WHERE produto_id = ANY($1) ORDER BY ordem, id',
      [produtoIds]
    );
    const opcoesMap = agruparOpcoesPorProduto(opcoesResult.rows);

    // Grupos padrão vinculados (vínculo ao vivo) — adiciona após as avulsas
    try {
      const padraoLinkResult = await query(
        'SELECT produto_id, opcao_padrao_id FROM produto_opcoes_padrao WHERE produto_id = ANY($1) ORDER BY opcao_padrao_id',
        [produtoIds]
      );
      if (padraoLinkResult.rows.length > 0) {
        const padraoIds = [...new Set(padraoLinkResult.rows.map(r => r.opcao_padrao_id))];
        const padraoGrupos = await buscarOpcoesPadrao(query, padraoIds);
        const padraoById = {};
        for (const g of padraoGrupos) padraoById[g.id] = g;
        const padraoPorProduto = {};
        for (const r of padraoLinkResult.rows) {
          if (!padraoPorProduto[r.produto_id]) padraoPorProduto[r.produto_id] = [];
          padraoPorProduto[r.produto_id].push(padraoById[r.opcao_padrao_id]);
        }
        for (const [pid, grupos] of Object.entries(padraoPorProduto)) {
          opcoesMap[pid] = [...(opcoesMap[pid] || []), ...grupos.filter(Boolean)];
        }
      }
    } catch (e) { /* tabela produto_opcoes_padrao pode não existir ainda */ }

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
    // Avaliado no fuso do restaurante (coluna timezone, migration 034).
    if (!isStaff) {
      let timezone = TZ_RESTAURANTE;
      try {
        const tzResult = await query(
          'SELECT timezone FROM restaurantes WHERE id = $1',
          [restaurantId]
        );
        timezone = tzResult.rows[0]?.timezone || TZ_RESTAURANTE;
      } catch { /* coluna pode não existir ainda */ }
      result = result.filter(p => produtoDisponivelAgora(p, new Date(), timezone));
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
      'SELECT id, nome, tipo, categoria_id, ordem FROM extra_subcategorias WHERE restaurant_id = $1 ORDER BY ordem, id',
      [restaurantId]
    );
    if (subs.rows.length === 0) return res.json([]);
    const subIds = subs.rows.map(s => s.id);
    let resolvidas = {};
    try {
      resolvidas = await resolverSubcategorias(query, subIds);
    } catch (e) { /* colunas tipo/categoria_id podem não existir ainda */ }
    // Retornar também o nome da categoria vinculada (para sub do tipo categoria)
    const catResult = await query(
      'SELECT id, nome FROM categorias WHERE id = ANY($1)',
      [subs.rows.map(s => s.categoria_id).filter(Boolean)]
    );
    const catNome = {};
    for (const c of catResult.rows) catNome[c.id] = c.nome;
    res.json(subs.rows.map(s => {
      const r = resolvidas[s.id] || { id: s.id, nome: s.nome, tipo: s.tipo || 'manual', categoria_id: s.categoria_id, itens: [] };
      return { ...r, ordem: s.ordem, categoria_nome: catNome[s.categoria_id] || null };
    }));
  } catch (err) { next(err); }
});

router.post('/extra-subcategorias', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const data = subcategoriaSchema.parse(req.body);
    const tipo = data.tipo || 'manual';      if (tipo === 'categoria') {
        if (!data.categoria_id) throw new AppError('Selecione a categoria do cardápio para a subcategoria.', 400);
        const cat = await query('SELECT id FROM categorias WHERE id = $1 AND restaurant_id = $2', [data.categoria_id, restaurantId]);
        if (cat.rows.length === 0) throw new AppError('Categoria não pertence ao restaurante.', 400);
      }
    // Itens com imagem base64 → salvar na tabela imagens (URL no JSON do
    // cardápio, sem base64 embutido). O saveBase64AsFile já otimiza (sharp).
    if (tipo === 'manual') {
      await moverItensImagensParaUrl(restaurantId, data.itens);
    }
    const result = await transaction(async (client) => {
      const ordemRes = await client.query(
        'SELECT COALESCE(MAX(ordem), 0) + 1 as o FROM extra_subcategorias WHERE restaurant_id = $1',
        [restaurantId]
      );
      let sub;
      // SAVEPOINT: se o INSERT com colunas novas falhar (coluna ausente), o
      // fallback roda sem abortar a transação inteira.
      try {
        await client.query('SAVEPOINT sub_insert');
        sub = await client.query(
          'INSERT INTO extra_subcategorias (restaurant_id, nome, tipo, categoria_id, ordem) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [restaurantId, data.nome.trim(), tipo, tipo === 'categoria' ? data.categoria_id : null, ordemRes.rows[0].o]
        );
        await client.query('RELEASE SAVEPOINT sub_insert');
      } catch (e) {
        try { await client.query('ROLLBACK TO SAVEPOINT sub_insert'); } catch {}
        // Colunas tipo/categoria_id podem não existir — inserir sem elas
        sub = await client.query(
          'INSERT INTO extra_subcategorias (restaurant_id, nome, ordem) VALUES ($1, $2, $3) RETURNING *',
          [restaurantId, data.nome.trim(), ordemRes.rows[0].o]
        );
      }
      if (tipo === 'manual') {
        let ordem = 0;
        for (const item of data.itens) {
          try {
            await client.query('SAVEPOINT item_insert');
            await client.query(
              `INSERT INTO extra_subcategoria_itens (subcategoria_id, nome, preco, maximo, descricao, imagem_url, imagem_base64, ordem)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [sub.rows[0].id, item.nome, item.preco, item.maximo, item.descricao || '', item.imagem_url || '', item.imagem_base64 || '', ordem++]
            );
            await client.query('RELEASE SAVEPOINT item_insert');
          } catch (e) {
            try { await client.query('ROLLBACK TO SAVEPOINT item_insert'); } catch {}
            await client.query(
              `INSERT INTO extra_subcategoria_itens (subcategoria_id, nome, preco, maximo, ordem)
               VALUES ($1, $2, $3, $4, $5)`,
              [sub.rows[0].id, item.nome, item.preco, item.maximo, ordem++]
            );
          }
        }
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

    // Antes da transação: remover imagens antigas dos itens e converter o
    // base64 dos novos itens para a tabela imagens (URLs).
    if ('itens' in req.body && (data.tipo || 'manual') !== 'categoria') {
      await removerImagensDosItens(id);
      await moverItensImagensParaUrl(restaurantId, data.itens);
    }

    await transaction(async (client) => {
      const existing = await client.query(
        'SELECT id FROM extra_subcategorias WHERE id = $1 AND restaurant_id = $2',
        [id, restaurantId]
      );
      if (existing.rows.length === 0) throw new AppError('Subcategoria não encontrada.', 404);
      if (data.nome) {
        await client.query('UPDATE extra_subcategorias SET nome = $1 WHERE id = $2', [data.nome.trim(), id]);
      }
      // Tipo / categoria vinculada (só se colunas existirem)
      if ('tipo' in req.body || 'categoria_id' in req.body) {
        const tipo = data.tipo || 'manual';
        const catId = data.categoria_id !== undefined ? data.categoria_id : null;
        if (tipo === 'categoria') {
          if (!catId) throw new AppError('Selecione a categoria do cardápio para a subcategoria.', 400);
          const cat = await client.query('SELECT id FROM categorias WHERE id = $1 AND restaurant_id = $2', [catId, restaurantId]);
          if (cat.rows.length === 0) throw new AppError('Categoria não pertence ao restaurante.', 400);
        }
        try {
          await client.query('SAVEPOINT sub_tipo_update');
          await client.query('UPDATE extra_subcategorias SET tipo = $1, categoria_id = $2 WHERE id = $3', [tipo, tipo === 'categoria' ? catId : null, id]);
          if (tipo === 'categoria') {
            // Itens manuais deixam de existir — limpar as imagens (banco + disco)
            await removerImagensDosItens(id);
            await client.query('DELETE FROM extra_subcategoria_itens WHERE subcategoria_id = $1', [id]);
          }
          await client.query('RELEASE SAVEPOINT sub_tipo_update');
        } catch (e) { try { await client.query('ROLLBACK TO SAVEPOINT sub_tipo_update'); } catch {} /* colunas tipo/categoria_id podem não existir */ }
      }
      if ('itens' in req.body && (data.tipo || 'manual') !== 'categoria') {
        await client.query('DELETE FROM extra_subcategoria_itens WHERE subcategoria_id = $1', [id]);
        let ordem = 0;
        for (const item of data.itens) {
          try {
            await client.query('SAVEPOINT item_insert');
            await client.query(
              `INSERT INTO extra_subcategoria_itens (subcategoria_id, nome, preco, maximo, descricao, imagem_url, imagem_base64, ordem)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [id, item.nome, item.preco, item.maximo, item.descricao || '', item.imagem_url || '', item.imagem_base64 || '', ordem++]
            );
            await client.query('RELEASE SAVEPOINT item_insert');
          } catch (e) {
            try { await client.query('ROLLBACK TO SAVEPOINT item_insert'); } catch {}
            await client.query(
              `INSERT INTO extra_subcategoria_itens (subcategoria_id, nome, preco, maximo, ordem)
               VALUES ($1, $2, $3, $4, $5)`,
              [id, item.nome, item.preco, item.maximo, ordem++]
            );
          }
        }
      }
    });
    res.json({ message: 'Subcategoria atualizada.', id: parseInt(id) });
  } catch (err) { next(err); }
});

// ============================
// OPÇÕES PADRÃO DO PRATO (catálogo compartilhado — vínculo ao vivo)
// ============================
router.get('/opcoes-padrao', async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    try {
      const grupos = await query(
        'SELECT id, grupo, tipo, obrigatoria, ordem FROM opcoes_padrao WHERE restaurant_id = $1 ORDER BY ordem, id',
        [restaurantId]
      );
      if (grupos.rows.length === 0) return res.json([]);
      const ids = grupos.rows.map(g => g.id);
      const comItens = await buscarOpcoesPadrao(query, ids);
      const byId = {};
      for (const g of comItens) byId[g.id] = g;
      res.json(grupos.rows.map(g => byId[g.id] || { ...g, opcoes: [] }));
    } catch (e) { res.json([]); }
  } catch (err) { next(err); }
});

router.post('/opcoes-padrao', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const data = opcaoPadraoSchema.parse(req.body);
    const result = await transaction(async (client) => {
      const ordemRes = await client.query(
        'SELECT COALESCE(MAX(ordem), 0) + 1 as o FROM opcoes_padrao WHERE restaurant_id = $1',
        [restaurantId]
      );
      const grupo = await client.query(
        'INSERT INTO opcoes_padrao (restaurant_id, grupo, tipo, obrigatoria, ordem) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [restaurantId, data.grupo.trim(), data.tipo, data.obrigatoria, ordemRes.rows[0].o]
      );
      await inserirOpcoesPadrao(client, grupo.rows[0].id, data.opcoes);
      return grupo.rows[0];
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === '42P01') {
      return next(new AppError('Tabela de Opções Padrão não existe. Execute a migration 033_catalogo_cardapio.sql primeiro.', 500));
    }
    next(err);
  }
});

router.put('/opcoes-padrao/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;
    const data = opcaoPadraoSchema.partial().parse(req.body);
    await transaction(async (client) => {
      const existing = await client.query(
        'SELECT id FROM opcoes_padrao WHERE id = $1 AND restaurant_id = $2',
        [id, restaurantId]
      );
      if (existing.rows.length === 0) throw new AppError('Grupo padrão não encontrado.', 404);
      if (data.grupo) {
        await client.query('UPDATE opcoes_padrao SET grupo = $1 WHERE id = $2', [data.grupo.trim(), id]);
      }
      if ('tipo' in req.body) await client.query('UPDATE opcoes_padrao SET tipo = $1 WHERE id = $2', [data.tipo, id]);
      if ('obrigatoria' in req.body) await client.query('UPDATE opcoes_padrao SET obrigatoria = $1 WHERE id = $2', [data.obrigatoria, id]);
      if ('opcoes' in req.body) {
        await client.query('DELETE FROM opcoes_padrao_itens WHERE opcao_padrao_id = $1', [id]);
        await inserirOpcoesPadrao(client, id, data.opcoes);
      }
    });
    res.json({ message: 'Grupo padrão atualizado.', id: parseInt(id) });
  } catch (err) {
    if (err.code === '42P01') {
      return next(new AppError('Tabela de Opções Padrão não existe. Execute a migration 033_catalogo_cardapio.sql primeiro.', 500));
    }
    next(err);
  }
});

router.delete('/opcoes-padrao/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;
    try {
      const result = await query(
        'DELETE FROM opcoes_padrao WHERE id = $1 AND restaurant_id = $2 RETURNING id',
        [id, restaurantId]
      );
      if (result.rows.length === 0) throw new AppError('Grupo padrão não encontrado.', 404);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('Grupo padrão não encontrado.', 404);
    }
    res.json({ message: 'Grupo padrão excluído.', id: parseInt(id) });
  } catch (err) { next(err); }
});

router.delete('/extra-subcategorias/:id', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const restaurantId = req.restaurantId || config.restaurantId;
    const { id } = req.params;
    // Remover as imagens dos itens (banco + disco) antes de excluir
    await removerImagensDosItens(id);
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

    const opcoes = await buscarOpcoesComPadrao(query, id);
    const subcategorias = (await buscarSubcategoriasDeProdutos(query, [id]))[id] || [];
    let padraoVinculados = [];
    try {
      padraoVinculados = (await query(
        'SELECT opcao_padrao_id FROM produto_opcoes_padrao WHERE produto_id = $1 ORDER BY opcao_padrao_id',
        [id]
      )).rows.map(r => r.opcao_padrao_id);
    } catch (e) { /* tabela pode não existir ainda */ }
    // Garantir que opcoes não tenha undefined/erros
    const opcoesSeguro = Array.isArray(opcoes) ? opcoes : [];

    res.json({
      ...productResult.rows[0],
      extras: extrasResult.rows,
      opcoes: opcoesSeguro,
      opcoes_padrao: padraoVinculados,
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

      // Vincular grupos padrão de opções (catálogo compartilhado — vínculo ao vivo)
      // SAVEPOINT: erro defensivo (tabela/coluna ausente) não pode abortar a
      // transação inteira — rollback só do trecho e segue.
      try {
        await client.query('SAVEPOINT opcoes_padrao_write');
        await validarOpcoesPadraoDoRestaurante(client, restaurantId, data.opcoes_padrao);
        await substituirOpcoesPadraoDoProduto(client, produto.id, data.opcoes_padrao);
        await client.query('RELEASE SAVEPOINT opcoes_padrao_write');
      } catch (e) {
        try { await client.query('ROLLBACK TO SAVEPOINT opcoes_padrao_write'); } catch {}
      }

      // Vincular subcategorias de adicionais (catálogo compartilhado)
      await validarSubcategoriasDoRestaurante(client, restaurantId, data.subcategorias);
      await substituirSubcategoriasDoProduto(client, produto.id, data.subcategorias);

      return produto;
    });

    emitToRestaurant('produto:novo', result, restaurantId);
    emitToRestaurant('cardapio:atualizado', { tipo: 'produtos' }, restaurantId);
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

    // Remover campos NÃO enviados: o Zod .partial() mantém os defaults do schema
    // (ex.: talheres_obrigatorio=false, ativo=true), o que sobrescreveria dados
    // existentes em updates parciais. Só aplicamos o que veio no corpo.
    for (const key of Object.keys(data)) {
      if (!(key in req.body)) delete data[key];
    }

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
      if ('modulos' in req.body) data.modulos = JSON.stringify(data.modulos);
      if ('dias_semana' in req.body) data.dias_semana = JSON.stringify(data.dias_semana);

      for (const [key, value] of Object.entries(data)) {
        // extras/opcoes/opcoes_padrao/subcategorias são relacionamentos — tratados abaixo
        if (key === 'extras' || key === 'opcoes' || key === 'opcoes_padrao' || key === 'subcategorias') continue;
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

      // Atualizar extras somente se enviado explicitamente
      if ('extras' in req.body) {
        await client.query('DELETE FROM produtos_extras WHERE produto_id = $1', [id]);

        for (const extra of data.extras) {
          await client.query(
            `INSERT INTO produtos_extras (produto_id, nome, preco, maximo) VALUES ($1, $2, $3, $4)`,
            [id, extra.nome, extra.preco, extra.maximo ?? 1]
          );
        }
      }

      // Atualizar opções do prato somente se enviado explicitamente
      if ('opcoes' in req.body) {
        await client.query('DELETE FROM produto_opcoes WHERE produto_id = $1', [id]);
        await inserirOpcoes(client, id, data.opcoes);
      }

      // Atualizar grupos padrão vinculados somente se enviado explicitamente.
      // SAVEPOINT: erro defensivo (tabela/coluna ausente) não pode abortar a
      // transação inteira — rollback só do trecho e segue.
      if ('opcoes_padrao' in req.body) {
        try {
          await client.query('SAVEPOINT opcoes_padrao_write');
          await validarOpcoesPadraoDoRestaurante(client, restaurantId, data.opcoes_padrao);
          await substituirOpcoesPadraoDoProduto(client, id, data.opcoes_padrao);
          await client.query('RELEASE SAVEPOINT opcoes_padrao_write');
        } catch (e) {
          try { await client.query('ROLLBACK TO SAVEPOINT opcoes_padrao_write'); } catch {}
        }
      }

      // Atualizar subcategorias de adicionais somente se enviado explicitamente
      if ('subcategorias' in req.body) {
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

      // Leituras de tabelas novas (opcoes_padrao) são defensivas — qualquer erro
      // (coluna/relação ausente) não pode abortar a transação inteira.
      let opcoes = [];
      let padraoVinculados = [];
      try {
        await client.query('SAVEPOINT leituras_opcoes');
        opcoes = await buscarOpcoesComPadrao(client, id);
        try {
          padraoVinculados = (await client.query(
            'SELECT opcao_padrao_id FROM produto_opcoes_padrao WHERE produto_id = $1 ORDER BY opcao_padrao_id',
            [id]
          )).rows.map(r => r.opcao_padrao_id);
        } catch (e) { /* tabela pode não existir ainda */ }
        await client.query('RELEASE SAVEPOINT leituras_opcoes');
      } catch (e) {
        try { await client.query('ROLLBACK TO SAVEPOINT leituras_opcoes'); } catch {}
      }
      const subcategorias = (await buscarSubcategoriasDeProdutos(client, [id]))[id] || [];
      const opcoesSeguro = Array.isArray(opcoes) ? opcoes : [];

      return { ...updated.rows[0], extras: extras.rows, opcoes: opcoesSeguro, opcoes_padrao: padraoVinculados, subcategorias };
    });

    emitToRestaurant('produto:atualizado', result, restaurantId);
    emitToRestaurant('cardapio:atualizado', { tipo: 'produtos' }, restaurantId);
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
    emitToRestaurant('cardapio:atualizado', { tipo: 'produtos' }, restaurantId);
    res.json({ message: 'Produto excluído com sucesso.', id: parseInt(id) });
  } catch (err) {
    next(err);
  }
});

export default router;
