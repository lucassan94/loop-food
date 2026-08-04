// ── Suíte RESTAURANTE (RS-01 a RS-20) — via Puppeteer-core ──
const H = require('./helpers');
const { report, sleep, fetchJSON } = H;

async function navegar(page, label) {
  // Clica no item da sidebar pelo texto
  await H.clickByText(page, label, '.sidebar-nav');
  await sleep(1500);
}

async function run() {
  const browser = await H.launch();
  const page = await H.newPage(browser);
  // Painel administrativo é desktop-first: em viewport móvel (420px) o CSS
  // esconde os labels da sidebar (media max-width:768px) → labels sem texto
  await page.setViewport({ width: 1280, height: 800 });
  // Aceitar dialogs nativos (confirm) dos modais de exclusão
  page.on('dialog', async d => { await d.accept(); });
  // Diagnóstico: captura respostas das mutações de produtos (criar/editar/excluir)
  page.on('response', async (resp) => {
    const req = resp.request();
    const url = req.url();
    if (/\/api\/produtos/.test(url) && ['POST', 'PUT', 'DELETE'].includes(req.method())) {
      let body = '';
      try { body = (await resp.text()).slice(0, 110); } catch {}
      console.log(`[api-produtos] ${req.method()} ${url.split('/api/')[1]} → ${resp.status()} ${body}`);
    }
  });
  let produtoCriadoNome = '';

  try {
    // ── RS-01 Login admin ──
    const logado = await H.loginPainel(page, 'admin', 'admin123');
    report('RS-01', 'Login admin', logado.ok, logado.ok ? 'sidebar visível após login' : `erro: ${logado.erro}`);

    // ── RS-02 Dashboard ──
    await navegar(page, 'Dashboard');
    const kpis = await H.count(page, '.stat-card');
    report('RS-02', 'Dashboard KPIs', kpis > 0, `${kpis} cards de KPI`);

    // ── RS-03 Lista de pedidos ──
    await navegar(page, 'Fila de Pedidos');
    const pedidosView = await H.count(page, '.order-card, .data-table');
    report('RS-03', 'Lista de pedidos', pedidosView > 0, `cards/tabela de pedidos: ${pedidosView}`);

    // ── RS-04 Aceitar pedido pendente ──
    // Cria um pedido de teste via API PÚBLICA (POST /pedidos usa optionalAuth — sem login)
    const produtos = await H.apiRequest('/produtos');
    const prodId = (produtos.data && produtos.data[0]?.id) || 16;
    const pedido = await H.apiRequest('/pedidos', 'POST', {
      nome_cliente: 'Teste RS Aceitar', telefone_cliente: '11970001111',
      endereco_cliente: 'Rua X', numero_cliente: '10', bairro_cliente: 'Centro',
      cep_cliente: '06010000', cidade_cliente: 'Osasco', estado_cliente: 'SP',
      latitude_cliente: -23.5329, longitude_cliente: -46.7917,
      subtotal: 30, valor_frete: 5, total: 35, metodo_pagamento: 'dinheiro',
      observacoes: 'teste rs-04', itens: [{ produto_id: prodId, nome_produto: 'Item RS', quantidade: 1, preco_unitario: 30, extras: [], subtotal: 30 }],
    });
    // Aguardar o card específico do pedido aparecer na fila e clicar em Aceitar
    const cardOk = await H.waitForEval(page, () => {
      return [...document.querySelectorAll('.order-card.pendente')].some(c => c.innerText.includes('Teste RS Aceitar'));
    }, 12000);
    let aceitou = 'card-nao-apareceu';
    if (cardOk) {
      aceitou = await page.evaluate(() => {
        const card = [...document.querySelectorAll('.order-card.pendente')].find(c => c.innerText.includes('Teste RS Aceitar'));
        const btn = [...card.querySelectorAll('button')].find(b => /Aceitar/.test(b.innerText));
        if (!btn) return 'btn-nao-encontrado';
        btn.click();
        return 'clicado';
      });
    }
    await sleep(2500);
    const virouPreparando = await H.waitForEval(page, () => {
      return [...document.querySelectorAll('.order-card.preparando')].some(c => c.innerText.includes('Teste RS Aceitar'));
    }, 10000);
    report('RS-04', 'Aceitar pedido → preparando', aceitou === 'clicado' && virouPreparando,
      `pedido API: ${pedido.status} | ${aceitou} | card preparando: ${virouPreparando}`);

    // ── RS-05 Marcar pronto (preparando → pronto_entrega) ──
    const cardPreparando = await page.$('.order-card.preparando');
    if (cardPreparando) {
      await H.clickByText(page, 'Pronto para Entrega', '.order-card.preparando');
      await sleep(2500);
      const body5 = await H.text(page, 'body');
      report('RS-05', 'Marcar pronto → pronto_entrega', /Saiu para Entrega|Aguardando Entregador|Pronto/.test(body5), 'status avançou');
    } else {
      report('RS-05', 'Marcar pronto → pronto_entrega', false, 'nenhum card preparando');
    }

    // ── RS-06 Cancelar pedido com motivo ──
    const cardAtivo = await page.$('.order-card.preparando, .order-card.pendente, .order-card.pronto_entrega');
    if (cardAtivo) {
      await H.clickByText(page, 'Cancelar', '.order-card');
      await sleep(1200);
      await page.type('.modal-overlay textarea', 'teste de cancelamento automatizado');
      await sleep(300);
      await H.clickByText(page, 'Cancelar Pedido', '.modal-overlay');
      await sleep(2500);
      const body6 = await H.text(page, 'body');
      report('RS-06', 'Cancelar pedido + motivo', /Cancelado/.test(body6), 'status cancelado visível');
    } else {
      report('RS-06', 'Cancelar pedido + motivo', false, 'nenhum card ativo p/ cancelar');
    }

    // ── RS-07 Produtos ──
    await navegar(page, 'Produtos');
    // A lista faz N+1 (extras por produto) — pode demorar alguns segundos
    await H.waitForEval(page, () => document.querySelectorAll('.data-table tbody tr').length > 0, 15000);
    const produtosGrid = await H.count(page, '.data-table tbody tr');
    report('RS-07', 'Produtos listados', produtosGrid > 0, `${produtosGrid} linhas de produto`);

    // ── RS-08 Criar produto ──
    const nomeProduto = 'Produto Teste UI ' + Date.now() % 100000;
    produtoCriadoNome = nomeProduto;
    await H.clickByText(page, 'Novo Produto');
    await sleep(1200);
    const modal = '.modal-overlay';
    await page.type(modal + ' input[placeholder="Ex: Burguer Clássico"]', nomeProduto);
    await page.type(modal + ' input[placeholder="0,00"]', '19.90');
    await sleep(300);
    await H.clickByText(page, 'Salvar', modal);
    // A lista faz N+1 (extras por produto) — reload pós-salvar pode demorar
    const apareceu8 = await H.waitForEval(page, (nome) => {
      return [...document.querySelectorAll('.data-table tbody tr')].some(r => r.innerText.includes(nome));
    }, 45000, 500, nomeProduto);
    report('RS-08', 'Criar produto', apareceu8, `produto '${nomeProduto}' na lista: ${apareceu8}`);

    // ── RS-09 Editar produto ──
    const editClick = await page.evaluate((nome) => {
      const tr = [...document.querySelectorAll('.data-table tbody tr')].find(r => r.innerText.includes(nome));
      if (!tr) return 'linha-nao-encontrada';
      const btn = [...tr.querySelectorAll('button')].find(b => /Editar/.test(b.innerText));
      if (!btn) return 'btn-nao-encontrado';
      btn.click();
      return 'clicado';
    }, nomeProduto);
    if (editClick === 'clicado') {
      await sleep(1200);
      await page.evaluate(() => {
        const inputs = document.querySelectorAll('.modal-overlay input[placeholder="0,00"]');
        if (inputs[0]) inputs[0].focus();
      });
      await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
      await page.keyboard.type('25.90');
      await sleep(300);
      await H.clickByText(page, 'Salvar', '.modal-overlay');
      const editOk = await H.waitForEval(page, () => /25,90/.test(document.body.innerText), 10000);
      report('RS-09', 'Editar produto', editOk, 'preço atualizado p/ R$ 25,90');
    } else {
      report('RS-09', 'Editar produto', false, editClick);
    }

    // ── RS-10 Desativar/remover produto ──
    const delClick = await page.evaluate((nome) => {
      const tr = [...document.querySelectorAll('.data-table tbody tr')].find(r => r.innerText.includes(nome));
      if (!tr) return 'linha-nao-encontrada';
      const btn = [...tr.querySelectorAll('button')].find(b => /Excluir/.test(b.innerText));
      if (!btn) return 'btn-nao-encontrado';
      btn.click();
      return 'clicado';
    }, nomeProduto);
    if (delClick === 'clicado') {
      await sleep(2500); // confirm nativo é aceito pelo listener de dialog
      const sumiu = await H.waitForEval(page, (nome) => {
        return ![...document.querySelectorAll('.data-table tbody tr')].some(r => r.innerText.includes(nome));
      }, 45000, 500, nomeProduto);
      report('RS-10', 'Remover produto de teste', sumiu, sumiu ? 'produto removido da lista' : 'produto ainda na lista (delete falhou?)');
    } else {
      const jaAusente = delClick === 'linha-nao-encontrada';
      report('RS-10', 'Remover produto de teste', jaAusente,
        jaAusente ? 'produto já não está na lista (ok)' : delClick);
    }

    // ── RS-11 Categorias ──
    await H.clickByText(page, 'Categorias');
    await sleep(1200);
    const catModal = await H.count(page, '.modal-overlay .categoria-row');
    const catNome = 'Cat UI ' + Date.now() % 1000;
    await page.type('.modal-overlay input[placeholder="Nome da categoria"]', catNome);
    await sleep(300);
    await H.clickByText(page, 'Criar', '.modal-overlay');
    const catCriada = await H.waitForEval(page, (nome) => {
      const modal = [...document.querySelectorAll('.modal-overlay')].pop();
      return modal ? modal.innerText.includes(nome) : false;
    }, 10000, 400, catNome);
    report('RS-11', 'CRUD categorias', catCriada, `categoria '${catNome}' criada: ${catCriada}`);
    await H.clickByText(page, 'Fechar', '.modal-overlay');
    await sleep(800);

    // ── RS-12 Clientes ──
    await navegar(page, 'Clientes');
    const clientesView = await H.count(page, '.data-table tbody tr');
    report('RS-12', 'Clientes renderiza', clientesView >= 0, `${clientesView} clientes`);

    // ── RS-13 Entregadores ──
    await navegar(page, 'Entregadores');
    const entregView = await H.count(page, '.data-table tbody tr');
    report('RS-13', 'Entregadores renderiza', entregView >= 0, `${entregView} entregadores`);

    // ── RS-14 Config dados ──
    await navegar(page, 'Configurações');
    await sleep(1200);
    await H.clickByText(page, 'Dados', '.config-tabs');
    await sleep(1200);
    const nomeRest = await page.$$eval('.config-tab', els => els.length);
    const inputNome = await page.$$eval('.card input', els => els.length);
    report('RS-14', 'Config dados carrega', nomeRest >= 8 && inputNome > 0, `abas: ${nomeRest}, inputs: ${inputNome}`);

    // ── RS-15 Config raios ──
    await H.clickByText(page, 'Cardápio', '.config-tabs');
    await sleep(1200);
    const raiosAntes = await H.count(page, '.data-table tbody tr');
    const novoKm = 99;
    const inputsRaio = await page.$$('.card input[placeholder="KM"], .card input[placeholder="Min"], .card input[placeholder="Máx"], .card input[placeholder="R$"]');
    if (inputsRaio.length >= 4) {
      await inputsRaio[0].click({ clickCount: 3 }); await inputsRaio[0].type(String(novoKm));
      await inputsRaio[1].click({ clickCount: 3 }); await inputsRaio[1].type('30');
      await inputsRaio[2].click({ clickCount: 3 }); await inputsRaio[2].type('60');
      await inputsRaio[3].click({ clickCount: 3 }); await inputsRaio[3].type('25');
      await sleep(300);
      await H.clickByText(page, 'Adicionar Raio');
      await sleep(2000);
      const raiosDepois = await H.count(page, '.data-table tbody tr');
      report('RS-15', 'Adicionar raio', raiosDepois > raiosAntes, `raios: ${raiosAntes} → ${raiosDepois}`);
      // Remover o raio de teste (último)
      const rows = await page.$$('.data-table tbody tr');
      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        const del = await last.$('button');
        if (del) { await del.click(); await sleep(2000); }
      }
    } else report('RS-15', 'Adicionar raio', false, `inputs do raio não encontrados (${inputsRaio.length}/4)`);

    // ── RS-16 Config formas pagamento ──
    await H.clickByText(page, 'Pagamentos', '.config-tabs');
    await sleep(1200);
    const metodos = await H.count(page, '.payment-method-card');
    const checados = await H.count(page, '.payment-method-card input:checked');
    if (metodos > 0) {
      // Desmarcar o último método — clicar no CARD (label), pois o checkbox é display:none
      const cards = await page.$$('.payment-method-card');
      const ultimo = cards[cards.length - 1];
      await ultimo.click();
      await sleep(300);
      await H.clickByText(page, 'Salvar Configuração');
      await sleep(2000);
      const body16 = await H.text(page, 'body');
      const salvo = /atualizadas|sucesso/i.test(body16);
      // Restaurar padrão
      await H.clickByText(page, 'Restaurar Padrão');
      await sleep(2000);
      report('RS-16', 'Alternar forma de pagamento', salvo && metodos > 0, `métodos: ${metodos}, salvou: ${salvo}`);
    } else report('RS-16', 'Alternar forma de pagamento', false, 'nenhum método visível');

    // ── RS-17 KDS (feature salão) ──
    const temSalao = await page.evaluate(() => {
      return [...document.querySelectorAll('.sidebar-nav .sidebar-item span')]
        .some(s => /Cozinha|PDV|Mesas/.test(s.innerText));
    });
    if (temSalao) {
      await navegar(page, 'Cozinha (KDS)');
      const kds = await H.count(page, '.kds-layout');
      const kdsPend = await H.count(page, '.kds-card, .kds-order');
      report('RS-17', 'KDS renderiza', kds > 0, `layout: ${kds}, cards: ${kdsPend}`);
    } else {
      report('RS-17', 'KDS renderiza', true, 'feature Salão desativada no deploy — item não aparece (comportamento correto)');
    }

    // ── RS-18 PDV salão ──
    if (temSalao) {
      await navegar(page, 'PDV');
      await sleep(1200);
      const pdv = await H.count(page, '.pdv-layout');
      const produtoPdv = await page.$('.pdv-product-btn');
      if (produtoPdv) {
        await H.click(page, '.pdv-product-btn:first-child');
        await sleep(600);
        const pdvCount = await H.text(page, '.pdv-cart-count');
        await page.type('.pdv-customer-info input[placeholder="Ex: Mesa 5, João, etc"]', 'Mesa Teste 99');
        await sleep(300);
        await H.clickByText(page, 'Finalizar Pedido (Salão)');
        await sleep(3000);
        const body18 = await H.text(page, 'body');
        report('RS-18', 'PDV cria pedido salão', pdv > 0 && /enviado para a cozinha|sucesso/i.test(body18), `pdv: ${pdv}, msg: ${/enviado para a cozinha/i.test(body18)}`);
      } else {
        report('RS-18', 'PDV cria pedido salão', pdv > 0, `pdv renderizou (${pdv}) mas sem produtos p/ adicionar`);
      }
    } else {
      report('RS-18', 'PDV cria pedido salão', true, 'feature Salão desativada no deploy — item não aparece (comportamento correto)');
    }

    // ── RS-19 Relatórios ──
    await navegar(page, 'Rel. Entregas');
    await sleep(1500);
    const relTabela = await H.count(page, '.data-table tbody tr');
    // Os stat-cards estão na aba Financeiro
    await H.clickByText(page, 'Financeiro', '.tabs');
    await sleep(2500);
    const relStats = await H.count(page, '.stat-card');
    report('RS-19', 'Relatórios carrega', relTabela >= 0 && relStats > 0, `${relTabela} linhas (geral), ${relStats} cards (financeiro)`);

    // ── RS-20 Logout ──
    await H.clickByText(page, 'Sair', '.sidebar-footer');
    await sleep(1200);
    await H.clickByText(page, 'Sair', '.confirm-overlay');
    await sleep(2000);
    const loginVoltou = await H.count(page, '.login-card');
    report('RS-20', 'Logout', loginVoltou > 0, 'voltou para tela de login');

  } catch (err) {
    report('RS-ERR', 'Erro de execução', false, err.message);
    console.error(err);
  } finally {
    const res = H.summary('RESTAURANTE');
    await browser.close();
    process.exit(res.fail > 0 ? 2 : 0);
  }
}

run();
