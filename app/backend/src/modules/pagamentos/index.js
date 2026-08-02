// ============================================================================
// Módulo de Pagamentos — API da Rede (e-Rede v2 / OAuth2)
// ============================================================================
// Integração com a API da Rede (e-Rede v2). Fluxos:
//   - PIX: cobrança com QR dinâmico (kind: "pix"), ativado por webhook
//     (PV.UPDATE_TRANSACTION_PIX) ou polling de backup (/verificar-status).
//   - Cartão (crédito/débito): checkout transparente, aprovação síncrona
//     (returnCode "00"); 3DS 2.0 frictionless com redirect quando há desafio.
//   - Reembolso: manual (admin/gerente) via POST /:pedidoId/reembolsar.
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { query, transaction } from '../../config/database.js';
import { config } from '../../config/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { emitNovoPedido } from '../../services/realtime.js';
import * as rede from '../../services/rede.js';
import { processarEventoRede } from './redeWebhookHandler.js';

const router = Router();

// ──────── HELPERS ────────

/** Constrói a URL base do request (protocolo + host) para redirects 3DS. */
function urlBase3ds(req) {
  return `${req.protocol}://${req.get('host')}`;
}

/** Mapeia metodo_pagamento do pedido conforme o tipo online. */
function metodoPorTipo(tipo) {
  if (tipo === 'PIX') return 'pix_online';
  if (tipo === 'DEBIT_CARD') return 'debito_online';
  return 'credito_online';
}

/**
 * Registra timeline no pedido (helper).
 */
async function registrarTimeline(conn, pedidoId, statusAnterior, statusNovo, notas) {
  await conn.query(
    `INSERT INTO pedido_timeline (pedido_id, status_anterior, status_novo, usuario_tipo, notas)
     VALUES ($1, $2, $3, 'sistema', $4)`,
    [pedidoId, statusAnterior, statusNovo, notas]
  );
}

// ============================================================================
// POST /api/pagamentos/criar
// ============================================================================
// Cria pagamento online (PIX, Cartão Crédito ou Débito) + pedido.
// Checkout transparente: o backend envia os dados do cartão à Rede
// (dados NUNCA são armazenados; escopo PCI-DSS SAQ A-EP).
router.post('/criar', authenticate, async (req, res, next) => {
  // Pedido criado dentro do try; guardado aqui p/ cancelamento no catch em caso de falha
  let pedidoCriado = null;
  try {
    const { id: clienteId, email } = req.user;

    const schema = z.object({
      tipo: z.enum(['PIX', 'CREDIT_CARD', 'DEBIT_CARD']),
      cliente: z.object({
        cpfCnpj: z.string().min(11).max(14),
        nome: z.string().min(1),
        telefone: z.string().min(1),
      }),
      pedido: z.object({
        endereco: z.string().min(1),
        numero: z.string().min(1),
        bairro: z.string().min(1),
        cep: z.string(),
        cidade: z.string().default('São Paulo'),
        estado: z.string().default('SP'),
      }),
      subtotal: z.number().positive(),
      valor_frete: z.number().min(0),
      total: z.number().positive(),
      itens: z.array(z.object({
        produto_id: z.number(),
        nome_produto: z.string(),
        quantidade: z.number().int().positive(),
        preco_unitario: z.number().positive(),
        extras: z.array(z.object({
          nome: z.string(),
          preco: z.number(),
        })).optional().default([]),
        subtotal: z.number().positive(),
      })).min(1),
      // Checkout transparente (Rede): dados BRUTOS do cartão passam pelo backend
      creditCard: z.object({
        holderName: z.string().min(1),
        number: z.string().min(13).max(19),
        expiryMonth: z.string().min(1).max(2),
        expiryYear: z.string().min(2).max(4),
        ccv: z.string().min(3).max(4),
      }).optional(),
      // Info do titular usada no bloco 3DS (billing) e na transação
      creditCardHolderInfo: z.object({
        name: z.string(),
        email: z.string().email(),
        cpfCnpj: z.string(),
        postalCode: z.string(),
        addressNumber: z.string(),
        phone: z.string(),
      }).optional(),
      remoteIp: z.string().optional(),
      tempo_preparo_estimado: z.number().int().positive().optional(),
      tempo_entrega_estimado: z.number().int().positive().optional(),
    }).superRefine((data, ctx) => {
      if (data.tipo !== 'PIX' && !data.creditCard) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'creditCard é obrigatório para pagamento com cartão (crédito ou débito).',
          path: ['creditCard'],
        });
      }
    });

    const data = schema.parse(req.body);

    // Validar CPF obrigatório para pagamento online
    const cpfLimpo = data.cliente.cpfCnpj.replace(/\D/g, '');
    if (cpfLimpo.length < 11) {
      throw new AppError('CPF é obrigatório para pagamento online.', 400);
    }

    const restaurantId = req.restaurantId || config.restaurantId;

    // ─── 1. Criar pedido 'aguardando_pagamento' (transação BD) ───
    const result = await transaction(async (conn) => {
      const loja = await conn.query(
        'SELECT status_loja FROM restaurantes WHERE id = $1',
        [restaurantId]
      );
      if (!loja.rows[0]?.status_loja) {
        throw new AppError('A loja está fechada no momento.', 400);
      }

      const pedido = await conn.query(
        `INSERT INTO pedidos (
          restaurant_id, cliente_id, nome_cliente, telefone_cliente,
          endereco_cliente, numero_cliente, bairro_cliente, cep_cliente,
          cidade_cliente, estado_cliente,
          subtotal, valor_frete, total, metodo_pagamento,
          detalhes_pagamento, observacoes,
          tempo_preparo_estimado, tempo_entrega_estimado, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, '', '', $15, $16, 'aguardando_pagamento')
        RETURNING *`,
        [
          restaurantId, clienteId, data.cliente.nome, data.cliente.telefone,
          data.pedido.endereco, data.pedido.numero, data.pedido.bairro, data.pedido.cep,
          data.pedido.cidade, data.pedido.estado,
          data.subtotal, data.valor_frete, data.total,
          metodoPorTipo(data.tipo),
          data.tempo_preparo_estimado || null, data.tempo_entrega_estimado || null,
        ]
      );
      const pedidoCriado = pedido.rows[0];

      for (const item of data.itens) {
        await conn.query(
          `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, extras, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [pedidoCriado.id, item.produto_id, item.nome_produto,
           item.quantidade, item.preco_unitario,
           JSON.stringify(item.extras), item.subtotal]
        );
      }

      await registrarTimeline(conn, pedidoCriado.id, null, 'aguardando_pagamento', `Aguardando pagamento via ${data.tipo} (Rede)`);

      return pedidoCriado;
    });
    pedidoCriado = result;

    // ─── 2. Chamada à Rede (FORA da transação BD) ───
    const reference = String(result.id); // reference = ID interno do pedido (decisão)

    if (data.tipo === 'PIX') {
      const cobranca = await rede.criarCobrancaPix({
        valorCentavos: rede.reaisParaCentavos(data.total),
        reference,
        dataExpiracao: rede.gerarDataExpiracaoPix(config.rede.pixExpiryMinutes),
        tenantId: restaurantId,
      });

      if (cobranca.returnCode !== '00') {
        throw new AppError(
          cobranca.returnMessage || 'Falha ao gerar QR Code PIX.',
          400,
          `REDE_RETURN_${cobranca.returnCode || 'ERR'}`
        );
      }

      // Salvar pagamento (payment_id = tid)
      await query(
        `INSERT INTO pagamentos (pedido_id, customer_id, payment_id, billing_type, status,
          valor_bruto, encoded_image, payload, data_vencimento, return_code, gateway, restaurant_id)
         VALUES ($1, NULL, $2, 'PIX', 'PENDING', $3, $4, $5, NOW(), $6, 'rede', $7)`,
        [result.id, cobranca.tid, data.total, cobranca.encodedImage, cobranca.payload,
         cobranca.returnCode, restaurantId]
      );

      return res.status(201).json({
        sucesso: true,
        id: result.id,
        pedido_id: result.pedido_id || result.id,
        payment_id: cobranca.tid,
        status: 'aguardando_pagamento',
        pix: {
          encodedImage: cobranca.encodedImage,
          payload: cobranca.payload,
          expirationDate: cobranca.expirationDate,
        },
        valor: data.total,
        expira_em_segundos: config.rede.pixExpiryMinutes * 60,
      });
    }

    // ─── CARTÃO (CRÉDITO/DÉBITO) ───
    const isDebit = data.tipo === 'DEBIT_CARD';

    // Bloco 3DS: débito exige 3DS obrigatório (onFailure: 'decline')
    const urls3ds = {
      base: urlBase3ds(req),
    };
    const threeDSecure = rede.montarBlocoThreeDSecure({
      onFailure: isDebit ? 'decline' : 'continue',
      userAgent: req.headers['user-agent'] || '',
      ipAddress: data.remoteIp || req.ip,
      device: { javaEnabled: false, language: 'BR' },
      billing: {
        address: data.pedido.endereco,
        city: data.pedido.cidade,
        postalCode: (data.creditCardHolderInfo?.postalCode || data.pedido.cep).replace(/\D/g, ''),
        state: data.pedido.estado,
        country: 'Brasil',
        emailAddress: data.creditCardHolderInfo?.email || email,
        phoneNumber: data.cliente.telefone,
      },
      urls: [
        { kind: 'threeDSecureSuccess', url: `${urls3ds.base}/api/pagamentos/3ds/sucesso` },
        { kind: 'threeDSecureFailure', url: `${urls3ds.base}/api/pagamentos/3ds/erro` },
      ],
    });

    // Buscar nome do restaurante para softDescriptor (máx 18, alfanumérico)
    const restResult = await query('SELECT nome FROM restaurantes WHERE id = $1', [restaurantId]);
    const softDescriptor = (restResult.rows[0]?.nome || 'DELIVERY').replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'DELIVERY';

    const transacao = await rede.criarTransacaoCartao({
      valorCentavos: rede.reaisParaCentavos(data.total),
      reference,
      card: {
        cardholderName: data.creditCard.holderName,
        cardNumber: data.creditCard.number,
        expirationMonth: data.creditCard.expiryMonth,
        expirationYear: data.creditCard.expiryYear,
        securityCode: data.creditCard.ccv,
      },
      softDescriptor,
      capture: true,
      kind: isDebit ? 'debit' : 'credit',
      installments: null, // à vista (1x) — decisão
      threeDSecure,
      tenantId: restaurantId,
    });

    // Salvar pagamento (payment_id = tid)
    await query(
      `INSERT INTO pagamentos (pedido_id, customer_id, payment_id, billing_type, status,
        valor_bruto, data_vencimento, nsu, authorization_code, return_code, gateway, restaurant_id)
       VALUES ($1, NULL, $2, $3, $4, $5, NOW(), $6, $7, $8, 'rede', $9)`,
      [result.id, transacao.tid, isDebit ? 'DEBIT_CARD' : 'CREDIT_CARD',
       transacao.returnCode === '00' ? 'RECEIVED' : 'PENDING',
       data.total, transacao.nsu || null, transacao.authorizationCode || null, transacao.returnCode || null,
       restaurantId]
    );

    // ✅ Aprovado (returnCode "00") → ativar pedido imediatamente
    if (transacao.returnCode === '00') {
      const atualizado = await transaction(async (conn) => {
        const r = await conn.query(
          `UPDATE pedidos SET status = 'pendente', atualizado_em = NOW()
           WHERE id = $1 AND status = 'aguardando_pagamento' RETURNING *`,
          [result.id]
        );
        if (r.rows.length > 0) {
          await registrarTimeline(conn, result.id, 'aguardando_pagamento', 'pendente', 'Pagamento com cartão aprovado (Rede)');
        }
        return r.rows[0];
      });

      if (atualizado) {
        emitNovoPedido({ ...atualizado, restaurant_id: restaurantId });
      }

      return res.status(201).json({
        sucesso: true,
        id: result.id,
        pedido_id: result.pedido_id || result.id,
        payment_id: transacao.tid,
        status: 'pendente',
        cartao: {
          aprovado: true,
          tid: transacao.tid,
          nsu: transacao.nsu || null,
          authorizationCode: transacao.authorizationCode || null,
        },
      });
    }

    // 🔄 Desafio 3DS (returnCode "220") → cliente faz redirect para o banco
    if (transacao.returnCode === '220' || transacao.threeDSecure?.url) {
      return res.status(201).json({
        sucesso: true,
        id: result.id,
        pedido_id: result.pedido_id || result.id,
        payment_id: transacao.tid,
        status: 'aguardando_3ds',
        cartao: {
          aprovado: false,
          aguardando_3ds: true,
          tid: transacao.tid,
          url: transacao.threeDSecure?.url || null,
        },
      });
    }

    // ❌ Recusado → cancelar pedido com motivo
    const motivo = transacao.returnMessage || 'Cartão recusado pelo emissor.';
    await transaction(async (conn) => {
      await conn.query(
        `UPDATE pedidos SET status = 'cancelado', motivo_cancelamento = $2, atualizado_em = NOW()
         WHERE id = $1 AND status = 'aguardando_pagamento'`,
        [result.id, motivo]
      );
      await registrarTimeline(conn, result.id, 'aguardando_pagamento', 'cancelado', `Pagamento recusado: ${motivo}`);
    });

    throw new AppError('Transação não autorizada. Verifique os dados do cartão.', 400,
      transacao.returnCode ? `REDE_RETURN_${transacao.returnCode}` : 'CARD_REFUSED');

  } catch (err) {
    // Pedido já foi criado como 'aguardando_pagamento' e a chamada à Rede falhou:
    // cancelar o pedido para não deixar órfão (sem linha em pagamentos, o polling não limpa).
    if (pedidoCriado?.id) {
      try {
        await query(
          `UPDATE pedidos SET status = 'cancelado',
             motivo_cancelamento = 'Falha ao processar pagamento (gateway indisponível)', atualizado_em = NOW()
           WHERE id = $1 AND status = 'aguardando_pagamento'`,
          [pedidoCriado.id]
        );
      } catch { /* falha ao cancelar não deve mascarar o erro original */ }
    }

    if (err.code === 'GATEWAY_UNAVAILABLE') {
      return res.status(503).json({
        sucesso: false,
        erro: 'Gateway de pagamento temporariamente indisponível. Tente novamente ou escolha pagamento na entrega.',
        codigo: 'GATEWAY_UNAVAILABLE',
      });
    }
    if (err.code === 'REDE_MISCONFIG') {
      return res.status(503).json({
        sucesso: false,
        erro: 'Pagamento online indisponível no momento. Escolha pagamento na entrega.',
        codigo: 'REDE_MISCONFIG',
      });
    }
    next(err);
  }
});

// ============================================================================
// POST /api/pagamentos/webhook — notificações da Rede (PIX)
// ============================================================================
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body || {};

    // 1. Validar Authorization (Bearer) com rede_webhook_token
    const authHeader = req.headers['authorization'];
    const { valido } = await rede.validarTokenWebhook(authHeader);
    if (!valido) {
      console.warn('[Rede] Webhook rejeitado: Authorization inválido.');
      return res.status(200).json({ received: true });
    }

    const eventId = payload?.id;
    const merchantId = payload?.merchantId;
    const event = Array.isArray(payload?.events) ? payload.events[0] : payload?.events;

    if (!eventId || !event) {
      return res.status(200).json({ received: true });
    }

    // 2. Resolver tenant pelo merchantId (PV) — garante isolation
    const tenantId = await rede.resolverTenantPorWebhook(merchantId);
    if (tenantId) {
      req.restaurantId = tenantId;
    }

    const tid = payload?.data?.id || null;

    // 3. DEDUP (MELHORIA-004): id top-level do webhook + chave secundária
    // `rede:{tid}:{event}` — protege contra o mesmo evento chegando com `id`
    // diferente (Rede pode reentregar com novo id). A chave secundária garante
    // que só processamos UMA vez por (TID, evento).
    const dedupKeys = [eventId];
    if (tid) dedupKeys.push(`rede:${tid}:${event}`);

    const existente = await query(
      'SELECT id FROM webhook_events WHERE event_id = ANY($1::text[]) LIMIT 1',
      [dedupKeys]
    );
    if (existente.rows.length > 0) {
      return res.status(200).json({ received: true, dedup: true });
    }

    // Persistir a chave primária (id top-level) e a chave secundária composta
    // (event_id = rede:{tid}:{event}) em um único INSERT multi-row.
    const rows = [[eventId, event, tid]];
    if (tid) rows.push([`rede:${tid}:${event}`, event, tid]);
    await query(
      `INSERT INTO webhook_events (event_id, event_type, payment_id) VALUES ${rows.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ')}
       ON CONFLICT (event_id) DO NOTHING`,
      rows.flat()
    );

    // 4. Processar (async — responder 200 rápido)
    processarEventoRede(payload).catch(async (err) => {
      console.error(`[Rede] Erro processando evento ${eventId}:`, err.message);
      try {
        await query('UPDATE webhook_events SET error = $1, processed = FALSE WHERE event_id = $2', [err.message, eventId]);
      } catch { /* ignora */ }
    });

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Rede] Webhook error:', err.message);
    res.status(200).json({ received: true });
  }
});

// ============================================================================
// GET /api/pagamentos/3ds/sucesso e /3ds/erro
// ============================================================================
// Retorno do banco após desafio 3DS → redireciona o navegador de volta ao app.
// O app então consulta /verificar-status para saber o resultado final.
router.get('/3ds/sucesso', (req, res) => {
  res.redirect(`${urlBase3ds(req)}/?pagamento=3ds&resultado=sucesso`);
});

router.get('/3ds/erro', (req, res) => {
  res.redirect(`${urlBase3ds(req)}/?pagamento=3ds&resultado=erro`);
});

// ============================================================================
// GET /api/pagamentos/:pedidoId/pix-qrcode
// ============================================================================
router.get('/:pedidoId/pix-qrcode', authenticate, async (req, res, next) => {
  try {
    const { pedidoId } = req.params;

    const result = await query(
      `SELECT encoded_image, payload, status, billing_type, data_vencimento, criado_em
       FROM pagamentos WHERE pedido_id = $1 AND billing_type = 'PIX'
       ORDER BY criado_em DESC LIMIT 1`,
      [pedidoId]
    );

    if (result.rows.length === 0) {
      throw new AppError('QR Code não encontrado para este pedido.', 404);
    }

    const pagamento = result.rows[0];
    res.json({
      encodedImage: pagamento.encoded_image,
      payload: pagamento.payload,
      expirationDate: pagamento.data_vencimento,
      status: pagamento.status,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// GET /api/pagamentos/:pedidoId/verificar-status — polling (backup do webhook)
// ============================================================================
// Consulta o status REAL da transação na Rede e ativa o pedido se pago.
router.get('/:pedidoId/verificar-status', authenticate, async (req, res, next) => {
  try {
    const { pedidoId } = req.params;

    const result = await query(
      `SELECT p.*, o.status as pedido_status, o.pedido_id as display_id, o.restaurant_id as pedido_restaurant_id
       FROM pagamentos p
       JOIN pedidos o ON o.id = p.pedido_id
       WHERE p.pedido_id = $1
       ORDER BY p.criado_em DESC LIMIT 1`,
      [pedidoId]
    );

    if (result.rows.length === 0) {
      return res.json({
        pedido_id: pedidoId,
        pedido_status: 'sem_pagamento',
        pagamento_status: null,
        precisa_atualizar: false,
      });
    }

    const pagamento = result.rows[0];
    const tenantId = pagamento.pedido_restaurant_id || req.restaurantId || config.restaurantId;

    // Já finalizado localmente → retorna direto
    if (pagamento.status !== 'PENDING') {
      return res.json({
        pedido_id: pedidoId,
        pedido_status: pagamento.pedido_status,
        pagamento_status: pagamento.status,
        precisa_atualizar: false,
      });
    }

    let atualizou = false;
    let redeStatus = null;

    try {
      const consulta = await rede.consultarTransacao(pagamento.payment_id, tenantId);
      redeStatus = consulta.status; // Pending | Approved | Denied | Canceled

      // Pago → ativa pedido (mesmo processamento do webhook)
      if (consulta.status === 'Approved') {
        await processarEventoRede({
          id: `polling-${pagamento.payment_id}`,
          events: ['PV.UPDATE_TRANSACTION_PIX'],
          data: { id: pagamento.payment_id },
        });
        atualizou = true;

        const updated = await query('SELECT status FROM pedidos WHERE id = $1', [pedidoId]);
        pagamento.pedido_status = updated.rows[0]?.status || pagamento.pedido_status;
        pagamento.status = 'RECEIVED';
      }

      // Expirado (QR PIX vencido) → cancela pedido
      if (consulta.returnCode === '3036' || consulta.status === 'Canceled') {
        await query(
          `UPDATE pedidos SET status = 'cancelado', motivo_cancelamento = 'QR Code PIX expirado', atualizado_em = NOW()
           WHERE id = $1 AND status = 'aguardando_pagamento'`,
          [pedidoId]
        );
        await query(
          `UPDATE pagamentos SET status = 'OVERDUE', atualizado_em = NOW() WHERE payment_id = $1`,
          [pagamento.payment_id]
        );
        atualizou = true;
        pagamento.pedido_status = 'cancelado';
        pagamento.status = 'OVERDUE';
      }
    } catch (err) {
      console.warn(`[Rede] Erro ao verificar status do TID ${pagamento.payment_id}:`, err.message);
    }

    res.json({
      pedido_id: pedidoId,
      display_id: pagamento.display_id,
      pedido_status: pagamento.pedido_status,
      pagamento_status: pagamento.status,
      rede_status: redeStatus,
      precisa_atualizar: atualizou,
    });

  } catch (err) {
    next(err);
  }
});

// ============================================================================
// GET /api/pagamentos/:pedidoId/refund-status
// ============================================================================
// Consulta o status do estorno na Rede (campo refunds da transação).
router.get('/:pedidoId/refund-status', authenticate, async (req, res, next) => {
  try {
    const { pedidoId } = req.params;

    const result = await query(
      `SELECT payment_id, status, restaurant_id FROM pagamentos WHERE pedido_id = $1 ORDER BY criado_em DESC LIMIT 1`,
      [pedidoId]
    );

    if (result.rows.length === 0) {
      return res.json({ tem_pagamento: false, refund_status: null });
    }

    const pag = result.rows[0];

    if (['REFUNDED', 'REFUND_DENIED'].includes(pag.status)) {
      return res.json({
        tem_pagamento: true,
        payment_id: pag.payment_id,
        rede_status: pag.status,
        refund_status: pag.status === 'REFUNDED' ? 'DONE' : 'CANCELLED',
        fonte: 'local',
      });
    }

    let refundStatus = null;
    let redeStatus = null;

    try {
      const consulta = await rede.consultarTransacao(pag.payment_id, pag.restaurant_id || null);
      redeStatus = consulta.status;
      const refunds = consulta.refunds;

      if (Array.isArray(refunds) && refunds.length > 0) {
        const last = refunds[refunds.length - 1];
        refundStatus = last.status; // Done | Denied | Processing

        if (refundStatus === 'Done' && pag.status !== 'REFUNDED') {
          await query('UPDATE pagamentos SET status = $1, atualizado_em = NOW() WHERE payment_id = $2',
            ['REFUNDED', pag.payment_id]);
        } else if (refundStatus === 'Denied' && pag.status !== 'REFUND_DENIED') {
          await query('UPDATE pagamentos SET status = $1, atualizado_em = NOW() WHERE payment_id = $2',
            ['REFUND_DENIED', pag.payment_id]);
        }
      }
    } catch (err) {
      console.warn(`[Rede] Erro ao consultar status do refund TID ${pag.payment_id}:`, err.message);
    }

    res.json({
      tem_pagamento: true,
      payment_id: pag.payment_id,
      rede_status: redeStatus,
      refund_status: refundStatus,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// POST /api/pagamentos/:pedidoId/reembolsar — reembolso MANUAL (admin/gerente)
// ============================================================================
router.post('/:pedidoId/reembolsar', authenticate, authorize('admin', 'gerente'), async (req, res, next) => {
  try {
    const { pedidoId } = req.params;
    const { valor } = req.body;

    const result = await query(
      `SELECT * FROM pagamentos WHERE pedido_id = $1 ORDER BY criado_em DESC LIMIT 1`,
      [pedidoId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Pagamento não encontrado para este pedido.', 404);
    }

    const pagamento = result.rows[0];

    if (!['RECEIVED', 'CONFIRMED'].includes(pagamento.status)) {
      throw new AppError('Apenas pagamentos recebidos ou confirmados podem ser reembolsados.', 400);
    }

    const valorCentavos = valor !== undefined && valor !== null
      ? rede.reaisParaCentavos(valor)
      : rede.reaisParaCentavos(pagamento.valor_bruto);

    const refund = await rede.estornarTransacao(
      pagamento.payment_id,
      valorCentavos,
      pagamento.restaurant_id || null
    );

    if (!['359', '360'].includes(refund.returnCode)) {
      throw new AppError(
        refund.returnMessage || 'Falha ao solicitar reembolso na Rede.',
        400,
        `REDE_RETURN_${refund.returnCode || 'ERR'}`
      );
    }

    // 359 = devolução JÁ efetivada (síncrona) → REFUNDED
    // 360 = pedido de devolução recebido (processamento D+1) → REFUND_IN_PROGRESS
    await query(
      `UPDATE pagamentos SET status = $1, atualizado_em = NOW() WHERE id = $2`,
      [refund.returnCode === '359' ? 'REFUNDED' : 'REFUND_IN_PROGRESS', pagamento.id]
    );

    res.json({
      sucesso: true,
      mensagem: 'Reembolso solicitado. O valor pode levar alguns dias úteis para aparecer na fatura do cliente.',
      refund_id: refund.refundId,
      return_code: refund.returnCode,
    });

  } catch (err) {
    if (err.code === 'GATEWAY_UNAVAILABLE') {
      return res.status(503).json({
        sucesso: false,
        erro: 'Gateway de pagamento temporariamente indisponível. Tente novamente.',
        codigo: 'GATEWAY_UNAVAILABLE',
      });
    }
    next(err);
  }
});

export default router;
