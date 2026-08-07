// ============================================================================
// Validação compartilhada de itens de pedido
// ============================================================================
// Centraliza as regras aplicadas ANTES de criar um pedido (delivery, retirada
// e PDV/salão), usada pelos módulos de pedidos e pagamentos:
//
//   1. Módulo: o produto deve estar liberado para o módulo do pedido
//      (produtos.modulos — 'delivery' | 'salao').
//   2. Disponibilidade por dia/horário: fora da janela configurada o prato
//      fica pausado (apenas pedidos do cliente — delivery/retirada).
//   3. Talheres: se produtos.talheres_obrigatorio, o item precisa trazer
//      o campo booleano `talheres` (Sim/Não).
//   4. Opções do prato: grupos OBRIGATÓRIOS escolhidos + opções enviadas
//      realmente pertencem ao produto (anti-injeção de payload).
//
// Também exporta os helpers de disponibilidade usados para filtrar o cardápio
// público (/produtos/com-extras).
// ============================================================================

import { AppError } from '../middleware/errorHandler.js';
import { TZ_RESTAURANTE, agoraNoFusoDoRestaurante } from './horarios.js';

// Módulos de venda
export const MODULO_DELIVERY = 'delivery';
export const MODULO_SALAO = 'salao';

function parseHora(valor) {
  const hhmm = String(valor).slice(0, 5);
  const [hh, mm] = hhmm.split(':').map(Number);
  return hh * 60 + (mm || 0);
}

/**
 * Verifica se o produto está dentro da janela de disponibilidade
 * (dias da semana + horário) em um dado instante.
 * - dias_semana: JSONB [0..6] (0=Domingo). Vazio/NULL = todos os dias.
 * - horario_inicio/horario_fim: TIME 'HH:MM'. Ambos NULL = qualquer horário.
 * - Horário que vira o dia (fim <= início) é tratado como overnight.
 * - fim == início = disponível o dia todo.
 */
export function produtoDisponivelAgora(produto, agora = new Date(), timeZone = TZ_RESTAURANTE) {
  if (!produto) return true;

  // Dia/hora SEMPRE no fuso do restaurante (os dias cadastrados são locais)
  const { diaSemana, minutos: now } = agoraNoFusoDoRestaurante(agora, timeZone);

  const dias = produto.dias_semana;
  if (Array.isArray(dias) && dias.length > 0 && !dias.includes(diaSemana)) {
    return false;
  }

  const ini = produto.horario_inicio ? String(produto.horario_inicio).slice(0, 5) : null;
  const fim = produto.horario_fim ? String(produto.horario_fim).slice(0, 5) : null;

  if (!ini && !fim) return true;

  const inicio = ini ? parseHora(ini) : 0;
  const fimMin = fim ? parseHora(fim) : 1439;

  // 12:00-12:00 → dia inteiro
  if (ini && fim && fim === ini) return true;

  if (fimMin > inicio) {
    return now >= inicio && now <= fimMin;
  }
  // Vira o dia (ex.: 22:00 às 02:00)
  return now >= inicio || now <= fimMin;
}

/**
 * Verifica se o produto é vendido no módulo informado.
 * modulos vazio/ausente = disponível em todos os módulos.
 */
export function produtoNoModulo(produto, modulo) {
  const modulos = produto.modulos;
  if (!Array.isArray(modulos) || modulos.length === 0) return true;
  return modulos.includes(modulo);
}

/**
 * Valida todos os itens de um pedido contra as regras do produto.
 * `db` pode ser o helper `query` (módulo) ou um `client` de transação.
 */
export async function validarItensPedido(db, itens, origem, timeZone = TZ_RESTAURANTE) {
  const produtoIds = [...new Set(itens.map(i => i.produto_id))];
  const result = await db.query(
    `SELECT id, nome, talheres_obrigatorio, modulos, dias_semana, horario_inicio, horario_fim
     FROM produtos WHERE id = ANY($1)`,
    [produtoIds]
  );
  const produtos = new Map(result.rows.map(r => [r.id, r]));

  const moduloRequerido = origem === 'salao' ? MODULO_SALAO : MODULO_DELIVERY;
  const checarHorario = origem !== 'salao';

  for (const item of itens) {
    const produto = produtos.get(item.produto_id);
    if (!produto) {
      throw new AppError(`Produto "${item.nome_produto}" não encontrado.`, 400);
    }
    if (!produtoNoModulo(produto, moduloRequerido)) {
      throw new AppError(
        `"${item.nome_produto}" não está disponível para ${origem === 'salao' ? 'o salão' : 'entrega/retirada'} no momento.`,
        400
      );
    }
    if (checarHorario && !produtoDisponivelAgora(produto, new Date(), timeZone)) {
      throw new AppError(
        `"${item.nome_produto}" está fora do horário de disponibilidade agora.`,
        400
      );
    }
    if (produto.talheres_obrigatorio && typeof item.talheres !== 'boolean') {
      throw new AppError(`Escolha a opção de talheres para "${item.nome_produto}".`, 400);
    }
  }

  // ── Opções do prato (gratuitas): obrigatórias + pertencentes ao produto ──
  const opcoesResult = await db.query(
    'SELECT produto_id, grupo, nome, obrigatoria FROM produto_opcoes WHERE produto_id = ANY($1)',
    [produtoIds]
  );
  const porProduto = {};
  for (const o of opcoesResult.rows) {
    if (!porProduto[o.produto_id]) porProduto[o.produto_id] = { obrigatorias: new Set(), validas: new Set() };
    porProduto[o.produto_id].validas.add(`${o.grupo}|${o.nome}`);
    if (o.obrigatoria) porProduto[o.produto_id].obrigatorias.add(o.grupo);
  }
  for (const item of itens) {
    const info = porProduto[item.produto_id];
    if (!info) continue; // produto sem opções cadastradas
    const escolhidos = new Set();
    for (const op of item.opcoes || []) {
      const chave = `${op.grupo}|${op.nome}`;
      if (!info.validas.has(chave)) {
        throw new AppError(`Opção inválida "${op.grupo}: ${op.nome}" para "${item.nome_produto}".`, 400);
      }
      escolhidos.add(op.grupo);
    }
    for (const g of info.obrigatorias) {
      if (!escolhidos.has(g)) {
        throw new AppError(`Selecione "${g}" para "${item.nome_produto}" antes de finalizar o pedido.`, 400);
      }
    }
  }
}
