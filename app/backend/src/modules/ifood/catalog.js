// ============================================================================
// iFood — Catálogo (Fase 2: sync de cardápio)
// ============================================================================
// Sincroniza o cardápio interno (categorias + produtos ATIVOS) para o iFood
// via PUT /merchant/v1.0/merchants/{merchantId}/catalogs.
//
// Regras:
//   - Envia apenas produtos ATIVOS (p.ativo = true) com módulo delivery.
//   - Produtos sem categoria vão para a categoria "Sem categoria" (order alto).
//   - Campos depreciados no changelog 2026 (quantity, itemGeneralTags) NÃO
//     são enviados — validar versões exatas na homologação (Fase 5).
//   - Imagens relativas (/uploads/...) são transformadas em URL pública
//     usando config.ifood.publicBaseUrl (IFOOD_PUBLIC_BASE_URL) se definida;
//     caso contrário o campo vai vazio.
// ============================================================================

import { queryForTenant } from '../../config/database.js';
import { config } from '../../config/index.js';
import { AppError } from '../../middleware/errorHandler.js';
import { callIfoodApi } from './api.js';
import { getSettings, marcarSyncCatalogo, registrarErroIfood } from './settings.js';

// Helper de conexão com contexto EXPLÍCITO de tenant (RLS) para uso em rota
// ou background — ifood_settings tem policy por restaurant_id.
const dbForTenant = (tenantId) => (sql, params) => queryForTenant(tenantId, sql, params);

/** Resolve a URL pública de uma imagem relativa. */
function urlPublica(imagemUrl) {
  if (!imagemUrl) return '';
  if (/^https?:\/\//.test(imagemUrl)) return imagemUrl;
  if (config.ifood.publicBaseUrl && imagemUrl.startsWith('/')) {
    return `${config.ifood.publicBaseUrl}${imagemUrl}`;
  }
  return '';
}

/**
 * Monta o DTO do catálogo iFood a partir das linhas do banco.
 * @param {Array} categorias - linhas de categorias
 * @param {Array} produtos - linhas de produtos (com categoria_id)
 * @returns {object} corpo do PUT /catalogs
 */
export function montarCatalogoIfood(categorias, produtos) {
  const cats = categorias.map(c => ({
    id: `c${c.id}`,
    name: c.nome,
    order: c.ordem ?? 0,
    items: [],
  }));
  const catsById = new Map(cats.map(c => [c.id, c]));

  // Produtos sem categoria → categoria sintética no final
  const semCategoria = {
    id: 'c-sem-categoria',
    name: 'Outros',
    order: 999,
    items: [],
  };

  for (const p of produtos) {
    const item = {
      id: `p${p.id}`,
      name: p.nome,
      description: p.descricao || '',
      unitPrice: Number(p.preco),
      imagePath: urlPublica(p.imagem_url),
      order: p.destaque ? 0 : 1,
      available: p.ativo,
    };
    const catId = p.categoria_id ? `c${p.categoria_id}` : null;
    const alvo = (catId && catsById.get(catId)) || semCategoria;
    alvo.items.push(item);
  }

  const categories = [...cats, ...(semCategoria.items.length ? [semCategoria] : [])];
  return { categories };
}

/**
 * Busca categorias + produtos ativos de um tenant.
 * Usa contexto explícito de tenant (job de background / rota sem RLS de request).
 */
async function buscarCardapio(tenantId) {
  const categorias = await queryForTenant(
    tenantId,
    'SELECT id, nome, ordem FROM categorias WHERE restaurant_id = $1 ORDER BY ordem, id',
    [tenantId]
  );
  const produtos = await queryForTenant(
    tenantId,
    `SELECT id, nome, descricao, preco, imagem_url, ativo, destaque, categoria_id, modulos
     FROM produtos
     WHERE restaurant_id = $1 AND ativo = true
     ORDER BY destaque DESC, nome`,
    [tenantId]
  );
  // Filtra produtos com módulo delivery (quando modulos definido e não contém delivery)
  const filtrados = produtos.rows.filter(p => {
    const modulos = p.modulos;
    if (!Array.isArray(modulos) || modulos.length === 0) return true;
    return modulos.includes('delivery');
  });
  return { categorias: categorias.rows, produtos: filtrados };
}

/**
 * Sincroniza o cardápio de um tenant com o iFood.
 * Atualiza ifood_settings.ultima_sync_em (sucesso) ou ultimo_erro (falha).
 *
 * @param {number} tenantId - id do restaurante
 * @param {string|null} envOverride - 'sandbox' | 'production' (default: do settings)
 * @returns {Promise<object>} resumo { ok, ambiente, categorias, itens, totalItens }
 */
export async function sincronizarCatalogo(tenantId, envOverride = null) {
  const db = dbForTenant(tenantId);
  const settings = await getSettings(tenantId, db);
  if (!settings.ativo || !settings.merchant_id) {
    throw new AppError('Integração iFood inativa ou sem Merchant ID para este restaurante.', 400, 'IFOOD_INACTIVE');
  }

  const env = envOverride || (settings.ambiente === 'producao' ? 'production' : 'sandbox');
  const { categorias, produtos } = await buscarCardapio(tenantId);
  const dto = montarCatalogoIfood(categorias, produtos);

  try {
    await callIfoodApi(
      'PUT',
      `/merchant/v1.0/merchants/${settings.merchant_id}/catalogs`,
      dto,
      env
    );
    await marcarSyncCatalogo(tenantId, db);
    return {
      ok: true,
      ambiente: env,
      categorias: dto.categories.length,
      itens: dto.categories.reduce((acc, c) => acc + c.items.length, 0),
      sincronizadoEm: new Date().toISOString(),
    };
  } catch (err) {
    await registrarErroIfood(tenantId, err, db);
    throw err;
  }
}
