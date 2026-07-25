import { Router } from 'express';
import { query } from '../../config/database.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';

const router = Router();

// 🔒 Tabelas permitidas (WHITELIST) — apenas estas podem ser acessadas via CRUD
const TABELAS_PERMITIDAS = {
  clientes: { label: 'Clientes', colunaChave: 'id' },
  produtos: { label: 'Produtos', colunaChave: 'id' },
  pedidos: { label: 'Pedidos', colunaChave: 'id' },
  entregadores: { label: 'Entregadores', colunaChave: 'id' },
  restaurante_users: { label: 'Usuários Admin', colunaChave: 'id' },
  raios_entrega: { label: 'Raios de Entrega', colunaChave: 'id' },
};

// 🔒 Colunas atualizáveis por tabela (WHITELIST)
const COLUNAS_ATUALIZAVEIS = {
  clientes: ['nome', 'sobrenome', 'email', 'telefone', 'endereco', 'numero', 'bairro', 'complemento', 'cidade', 'estado', 'cep', 'cpf_cnpj', 'ativo'],
  produtos: ['nome', 'descricao', 'preco', 'categoria_slug', 'categoria_nome', 'ativo', 'imagem_url'],
  pedidos: ['observacoes', 'motivo_cancelamento'],
  entregadores: ['nome', 'email', 'telefone', 'status', 'endereco'],
  restaurante_users: ['nome', 'email', 'cargo', 'ativo'],
  raios_entrega: ['raio_km', 'tempo_min', 'tempo_max', 'custo'],
};

// ============================
// LISTAR TABELAS DISPONÍVEIS
// ============================
router.get('/tables', authenticate, authorize('admin'), async (req, res) => {
  const tables = Object.entries(TABELAS_PERMITIDAS).map(([slug, meta]) => ({
    slug,
    label: meta.label,
    colunaChave: meta.colunaChave,
    colunasAtualizaveis: COLUNAS_ATUALIZAVEIS[slug] || [],
  }));
  res.json(tables);
});

// ============================
// LER REGISTROS DE UMA TABELA
// ============================
router.get('/:table', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { table } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    if (!TABELAS_PERMITIDAS[table]) {
      throw new AppError(`Tabela '${table}' não disponível para consulta.`, 403);
    }

    // Buscar registros com parameterized query
    const result = await query(
      `SELECT * FROM ${table} ORDER BY id DESC LIMIT $1 OFFSET $2`,
      [parseInt(limit), parseInt(offset)]
    );

    // Contar total (para paginação)
    const countResult = await query(
      `SELECT COUNT(*) as total FROM ${table}`,
      []
    );

    res.json({
      registros: result.rows,
      total: parseInt(countResult.rows[0].total),
      colunas: result.fields ? result.fields.map(f => f.name) : (result.rows.length > 0 ? Object.keys(result.rows[0]) : []),
    });
  } catch (err) {
    next(err);
  }
});

// ============================
// ATUALIZAR UM REGISTRO
// ============================
router.put('/:table/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { table, id } = req.params;
    const data = req.body;

    if (!TABELAS_PERMITIDAS[table]) {
      throw new AppError(`Tabela '${table}' não disponível para atualização.`, 403);
    }

    const colunasPermitidas = COLUNAS_ATUALIZAVEIS[table] || [];
    const colunaChave = TABELAS_PERMITIDAS[table].colunaChave;

    // Filtrar apenas colunas permitidas e com valor não-undefined
    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const [col, val] of Object.entries(data)) {
      if (colunasPermitidas.includes(col) && val !== undefined) {
        updates.push(`${col} = $${paramIdx}`);
        params.push(val);
        paramIdx++;
      }
    }

    if (updates.length === 0) {
      throw new AppError('Nenhuma coluna válida para atualizar.', 400);
    }

    // Adicionar ID como último parâmetro
    params.push(id);

    const result = await query(
      `UPDATE ${table} SET ${updates.join(', ')} WHERE ${colunaChave} = $${paramIdx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      throw new AppError('Registro não encontrado.', 404);
    }

    res.json({
      message: 'Registro atualizado com sucesso!',
      registro: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

export default router;
