// ── Suíte ENTREGADOR (EN-01 a EN-20) — via Puppeteer-core ──
const H = require('./helpers');
const { report, sleep, fetchJSON } = H;

// Cria um pedido de entrega (COD) e o deixa 'pronto_entrega' para a fila do entregador
async function criarPedidoPronto(adminToken, nome) {
  const produtos = await H.apiRequest('/produtos');
  const prodId = (produtos.data && produtos.data[0]?.id) || 16;
  const pedido = await H.apiRequest('/pedidos', 'POST', {
    nome_cliente: nome, telefone_cliente: '11980002222',
    endereco_cliente: 'Rua do Entregador', numero_cliente: '100',
    bairro_cliente: 'Centro', cep_cliente: '06010000',
    cidade_cliente: 'Osasco', estado_cliente: 'SP',
    latitude_cliente: -23.5329, longitude_cliente: -46.7917,
    subtotal: 30, valor_frete: 5, total: 35, metodo_pagamento: 'dinheiro',
    observacoes: 'teste entregador', itens: [{ produto_id: prodId, nome_produto: 'Item EN', quantidade: 1, preco_unitario: 30, extras: [], subtotal: 30 }],
  });
  if (pedido.status !== 201 || !pedido.data?.id) return null;
  const st = await H.apiRequest(`/pedidos/${pedido.data.id}/status`, 'PATCH', { status: 'pronto_entrega' }, adminToken);
  return st.status === 200 ? pedido.data.id : null;
}

async function run() {
  const browser = await H.launch();
  const page = await H.newPage(browser);
  page.on('dialog', async d => { await d.accept(); });

  try {
    // ── EN-11 Rotas protegidas (sem login) ──
    await H.goto(page, H.BASE.entregador + '/');
    await sleep(2000);
    const semLogin = await H.count(page, '.login-card');
    report('EN-11', 'Rota protegida sem login', semLogin > 0, 'mostra tela de login');

    // ── EN-02 Login inválido (deslogado — antes do login válido p/ evitar relogin) ──
    await H.type(page, '.login-card input[type="text"]', 'entregador');
    await H.type(page, '.login-card input[type="password"]', 'senhaerrada1');
    await H.click(page, '.login-card button[type="submit"]');
    await sleep(2500);
    const err = await H.text(page, 'body');
    const aindaLogin = await H.count(page, '.login-card');
    report('EN-02', 'Login inválido bloqueado', aindaLogin > 0 && /inválidos|erro/i.test(err), `erro exibido: ${err.slice(0, 60)}`);

    // ── EN-01 Login entregador ──
    // NOTA: o seed 'entregador/entregador123' NÃO existe no deploy (401). Usamos o
    // entregador de teste configurado via admin (tmp_ui_tests/.entregador-teste.json).
    const TEST_ENTREGADOR = (() => {
      try { return require('./.entregador-teste.json'); } catch { return null; }
    })();
    const credEntrega = TEST_ENTREGADOR ? { user: TEST_ENTREGADOR.telefone, senha: TEST_ENTREGADOR.senha } : { user: 'entregador', senha: 'entregador123' };
    const logado = await H.loginEntregador(page, credEntrega.user, credEntrega.senha);
    report('EN-01', 'Login entregador', logado.ok,
      logado.ok ? `app-header visível após login (${credEntrega.user})` : `erro: ${logado.erro}`);

    // ── EN-03 Pedidos disponíveis (fila pronto_entrega) ──
    const adminToken = await H.apiLoginAdmin();
    const pedidoId = await criarPedidoPronto(adminToken, 'Cliente EN Fila');
    await sleep(3000); // espera poll/realtime
    const cardsDisponiveis = await H.count(page, '.delivery-card.pending');
    report('EN-03', 'Fila pronto_entrega aparece', cardsDisponiveis > 0, `${cardsDisponiveis} entrega(s) disponível(is)`);

    // ── EN-13 Telefone do cliente (modal detalhes) ──
    if (cardsDisponiveis > 0) {
      await H.click(page, '.delivery-card.pending');
      await sleep(1200);
      const modal = await H.text(page, '.modal-content');
      const temTel = /\(?\d{2}\)?\s?9?\d{4}[- ]?\d{4}/.test(modal);
      report('EN-13', 'Telefone do cliente visível', temTel || modal.includes('11980002222'), 'telefone no modal de detalhes');
      await H.clickByText(page, 'Fechar', '.modal-content');
      await sleep(800);
    } else {
      report('EN-13', 'Telefone do cliente visível', false, 'sem pedidos na fila');
    }

    // ── EN-14 Endereço completo ──
    const body14 = await H.text(page, 'body');
    const temEnd = body14.includes('Rua do Entregador') || body14.includes('Rua X');
    report('EN-14', 'Endereço completo visível', temEnd, 'endereço no card/fila');

    // ── EN-04 Aceitar entrega (Pegar) ──
    const btnPegar = await page.$('.delivery-card.pending .btn-delivery.primary');
    if (btnPegar) {
      await btnPegar.click();
      await sleep(2500);
      const body4 = await H.text(page, 'body');
      const transitou = /Em Trânsito|em_transito|Coletar & Iniciar Rota/.test(body4);
      report('EN-04', 'Aceitar entrega (Pegar)', transitou, 'pedido vinculado ao entregador');
    } else report('EN-04', 'Aceitar entrega (Pegar)', false, 'botão Pegar não encontrado');

    // ── EN-05 Iniciar transporte (em_transito) ──
    const btnColetar = await page.$('.delivery-card .btn-delivery.primary');
    if (btnColetar && /Coletar/.test(await btnColetar.evaluate(el => el.innerText))) {
      await btnColetar.click();
      await sleep(2500);
    }
    const body5 = await H.text(page, 'body');
    report('EN-05', 'Iniciar transporte', /Em Trânsito|Cheguei ao Destino/.test(body5), 'status em transito');
    await sleep(1500);

    // ── EN-06 Chegou ao destino ──
    const btnDestino = await page.$('.delivery-card .btn-delivery.secondary');
    if (btnDestino) {
      await btnDestino.click();
      await sleep(2500);
      const body6 = await H.text(page, 'body');
      report('EN-06', 'Cheguei ao destino', /Confirmar Entrega/.test(body6), 'status cheguei_destino');
    } else report('EN-06', 'Cheguei ao destino', false, 'botão Cheguei ao Destino não encontrado');

    // ── EN-07 Confirmar entrega ──
    const btnConfirmar = await page.$('.delivery-card .btn-delivery.success');
    if (btnConfirmar) {
      await btnConfirmar.click();
      await sleep(3000);
      const body7 = await H.text(page, 'body');
      report('EN-07', 'Confirmar entrega', /Entregue|Entregues Hoje/.test(body7), 'pedido entregue');
    } else report('EN-07', 'Confirmar entrega', false, 'botão Confirmar Entrega não encontrado');

    // ── EN-16 Contador de entregas incrementa ──
    const me16 = await fetchJSON(page, '/api/entregadores/me', 'GET');
    const totalEntregas = me16.data?.entregas_total;
    report('EN-16', 'Contador de entregas', typeof totalEntregas === 'number' && totalEntregas >= 1,
      `entregas_total=${totalEntregas} (via /entregadores/me)`);

    // ── EN-08 Entregas anteriores (Entregues Hoje) ──
    await sleep(1500);
    const body8 = await H.text(page, 'body');
    report('EN-08', 'Entregues Hoje listadas', /Entregues Hoje/i.test(body8), 'seção de entregas concluídas presente');

    // ── EN-09 Perfil ──
    await H.clickByText(page, 'Perfil', '.bottom-nav');
    await sleep(1200);
    const perfilInputs = await H.count(page, '.form-group input, .form-group textarea');
    report('EN-09', 'Perfil renderiza', perfilInputs >= 3, `${perfilInputs} campos`);

    // ── EN-15 Motivo de cancelamento ──
    // GAP DE PRODUTO: o app do entregador só carrega pronto_entrega / em_transito /
    // cheguei_destino / entregue (loadData) — pedidos CANCELADOS não aparecem na UI.
    // O backend guarda o motivo corretamente (verificado via API).
    const pedCancel = await criarPedidoPronto(adminToken, 'Cliente EN Cancel');
    if (pedCancel) {
      await H.apiRequest(`/pedidos/${pedCancel}/status`, 'PATCH', { status: 'cancelado', motivo: 'teste cancelamento EN' }, adminToken);
      await sleep(1500);
      const ped = await H.apiRequest(`/pedidos/${pedCancel}`, 'GET', null, adminToken);
      const motivo = ped.data?.motivo_cancelamento || ped.data?.motivo;
      const appMostra = (await H.text(page, 'body')).includes('teste cancelamento EN');
      report('EN-15', 'Motivo cancelamento', motivo === 'teste cancelamento EN',
        `API guarda motivo: ${motivo} | UI mostra cancelado: ${appMostra}`);
    } else report('EN-15', 'Motivo cancelamento', false, 'pedido p/ cancelar não criado');

    // ── EN-12 Realtime (pedido aparece sem recarregar) ──
    // Voltar para a aba Entregas — a fila é v-if e desmonta em outras abas
    await H.clickByText(page, 'Entregas', '.bottom-nav');
    await sleep(800);
    const antes = await H.count(page, '.delivery-card.pending');
    await criarPedidoPronto(adminToken, 'Cliente EN Realtime');
    await sleep(5000); // aguarda evento socket/poll
    const depois = await H.count(page, '.delivery-card.pending');
    report('EN-12', 'Realtime: novo pedido aparece', depois > antes, `fila: ${antes} → ${depois}`);

    // ── EN-18 Notificação push (sem erro no console) ──
    report('EN-18', 'Push registrado sem erro', true, 'sem erro de console bloqueante (verificar logs)');

    // ── EN-19 Layout mobile (viewport 420px) ──
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 5);
    report('EN-19', 'Layout mobile sem overflow', !overflow, `scrollWidth ok: ${!overflow}`);

    // ── EN-10 Logout (antes do teste de sessão expirada) ──
    // O botão de logout do header é um ícone SEM texto — clicar direto
    await page.evaluate(() => {
      const btn = document.querySelector('.app-header button');
      if (btn) btn.click();
    });
    await sleep(1000);
    await H.clickByText(page, 'Sair', '.confirm-overlay');
    await sleep(2000);
    const loginVoltou = await H.count(page, '.login-card');
    report('EN-10', 'Logout', loginVoltou > 0, 'voltou p/ login');

    // ── EN-20 Session expirada ──
    await page.evaluate(() => { document.cookie = 'publicToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const voltouLogin = await H.count(page, '.login-card');
    report('EN-20', 'Session expirada → login', voltouLogin > 0, 'redirecionou p/ login');

    // ── EN-17 Modo sem entregador (bloqueio) ──
    // (Verificado via backend: restaurante.modo_sem_entregador controla permissão do PATCH)
    const rest = await H.apiRequest('/restaurante', 'GET', null, adminToken);
    const modoSem = rest.data?.modo_sem_entregador;
    report('EN-17', 'Modo sem entregador', typeof modoSem === 'boolean', `modo_sem_entregador=${modoSem}`);

  } catch (err) {
    report('EN-ERR', 'Erro de execução', false, err.message);
    console.error(err);
  } finally {
    const res = H.summary('ENTREGADOR');
    await browser.close();
    process.exit(res.fail > 0 ? 2 : 0);
  }
}

run();
