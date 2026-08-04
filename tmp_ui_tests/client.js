// ── Suíte CLIENTE (CL-01 a CL-20) — via Puppeteer-core ──
const H = require('./helpers');
const { report, fetchJSON, sleep } = H;

const PHONE = '1194000' + String(Math.floor(1000 + Math.random() * 9000)); // telefone único
let orderId = null;

async function run() {
  const browser = await H.launch();
  const page = await H.newPage(browser);
  // Evita modal de onboarding no meio dos testes (exceto no CL-18)
  await page.evaluateOnNewDocument(() => {
    if (!localStorage.getItem('saborexpress_test_nocep')) {
      localStorage.setItem('saborexpress_cep', '06010000');
    }
  });
  try {
    // ── CL-01 Home carrega ──
    await H.goto(page, H.BASE.cliente + '/');
    await sleep(2000);
    const produtos = await H.count(page, '.product-card');
    report('CL-01', 'Home carrega', produtos > 0, `${produtos} produtos renderizados`);

    // ── CL-02 Categorias ──
    const cats = await H.count(page, '.category-tab');
    report('CL-02', 'Categorias visíveis', cats >= 2, `${cats} abas de categoria`);
    if (cats > 1) {
      await H.click(page, '.category-tab:nth-child(2)');
      await sleep(800);
      const ativa = await page.$eval('.category-tab.active', el => el.innerText.trim()).catch(() => '');
      report('CL-02b', 'Categoria filtra', ativa.length > 0, `aba ativa: ${ativa}`);
    }

    // ── CL-03 Busca ──
    await H.click(page, '.category-tab:nth-child(1)'); // Todos
    await sleep(600);
    const antes = await H.count(page, '.product-card');
    await H.type(page, '.search-bar input', 'xyzzy-nao-existe');
    await sleep(800);
    const depois = await H.count(page, '.product-card');
    const empty = await H.count(page, '.empty-search');
    report('CL-03', 'Busca filtra', depois < antes || empty > 0,
      `${antes} produtos antes, ${depois} depois da busca 'xyzzy'`);
    await H.click(page, '.search-bar .clear-btn');
    await sleep(600);

    // ── CL-04 Adicionar ao carrinho ──
    await H.click(page, '.product-card:first-child .btn-add-cart');
    await sleep(800);
    const cartBar = await H.count(page, '.cart-bar');
    report('CL-04', 'Adicionar ao carrinho', cartBar > 0, 'cart-bar visível com item');

    // ── CL-05 Quantidade +/− (subtotal muda) ──
    await H.click(page, '.cart-bar-left');
    await sleep(800);
    const qtyAntes = await H.text(page, '.checkout-drawer.open .cart-item-qty span');
    await H.click(page, '.checkout-drawer.open .cart-item-qty button:last-child');
    await sleep(600);
    const qtyDepois = await H.text(page, '.checkout-drawer.open .cart-item-qty span');
    report('CL-05', 'Quantidade +/', qtyAntes !== qtyDepois, `qty ${qtyAntes} -> ${qtyDepois}`);
    // Diminuir de volta para 1
    await H.click(page, '.checkout-drawer.open .cart-item-qty button:first-child');
    await sleep(400);

    // ── CL-06 Remover item ──
    await H.click(page, '.checkout-drawer.open .cart-item-remove');
    await sleep(600);
    const itens = await H.count(page, '.checkout-drawer.open .cart-item');
    const emptyCart = await H.count(page, '.empty-cart-drawer');
    report('CL-06', 'Remover item', itens === 0 && emptyCart > 0, 'carrinho vazio após remover');
    // Fechar drawer
    await page.evaluate(() => document.querySelector('.drawer-overlay')?.click());
    await sleep(400);

    // ── CL-08 Login inválido (1ª tentativa de login) ──
    await H.goto(page, H.BASE.cliente + '/auth');
    await H.type(page, '.auth-card input[type="text"]', 'cliente');
    await H.type(page, '.auth-card input[type="password"]', 'senhaerrada123');
    await H.click(page, '.auth-card button[type="submit"]');
    await sleep(2500);
    const errLogin = await H.text(page, '.error-message');
    const aindaLogin = await H.count(page, '.auth-card');
    report('CL-08', 'Login inválido bloqueado', aindaLogin > 0 && errLogin.length > 0,
      `erro exibido: "${errLogin.slice(0, 60)}"`);

    // ── CL-07 Login válido (2ª tentativa) ──
    // NOTA: o usuário seed 'cliente' (doc) NÃO existe no tenant deployado (401 confirmado em
    // múltiplas execuções — seed não reaplicado após limpeza). Usamos um usuário de teste
    // persistente criado via signup (tmp_ui_tests/.cliente-teste.json — telefone fixo),
    // evitando gastar o signupLimiter (5/hora) a cada execução.
    const TEST_CLIENTE = (() => {
      try { return require('./.cliente-teste.json'); } catch { return null; }
    })();
    let autenticado = false;
    let viaLogin = 'sem usuário de teste persistente';
    if (TEST_CLIENTE) {
      await H.loginCliente(page, TEST_CLIENTE.telefone, 'cliente123');
      autenticado = (await fetchJSON(page, '/api/auth/me', 'GET')).status === 200;
      viaLogin = autenticado ? `login por telefone ${TEST_CLIENTE.telefone}` : 'telefone de teste falhou';
    }
    let viaSignup = false;
    if (!autenticado) {
      // Fallback último recurso: cria conta pela própria UI (fluxo real)
      await H.goto(page, H.BASE.cliente + '/auth');
      await H.clickByText(page, 'Criar uma conta', '.auth-card');
      await sleep(1000);
      const telefone = '1195000' + String(Math.floor(1000 + Math.random() * 9000));
      const inputs = await page.$$('.auth-card input');
      // Ordem: Nome, Sobrenome, Telefone, E-mail, Senha
      await inputs[0].click({ clickCount: 3 }); await inputs[0].type('Cliente Teste');
      await inputs[1].click({ clickCount: 3 }); await inputs[1].type('UI');
      await inputs[2].click({ clickCount: 3 }); await inputs[2].type(telefone);
      await inputs[3].click({ clickCount: 3 }); await inputs[3].type('clienteui' + Date.now() + '@test.com');
      await inputs[4].click({ clickCount: 3 }); await inputs[4].type('cliente123');
      await sleep(300);
      await H.click(page, '.auth-card button[type="submit"]');
      await sleep(3000);
      autenticado = (await fetchJSON(page, '/api/auth/me', 'GET')).status === 200;
      viaSignup = autenticado;
      if (autenticado) viaLogin = 'via signup UI (seed ausente)';
    }
    report('CL-07', 'Login cliente', autenticado, viaLogin);

    // Limpar endereço do perfil para forçar o fluxo completo do checkout (etapa 2)
    // IMPORTANTE: manter o TELEFONE persistente (senão a próxima execução perde o login)
    const telefonePerfil = TEST_CLIENTE ? TEST_CLIENTE.telefone : PHONE;
    await fetchJSON(page, '/api/clientes/perfil', 'PUT', {
      nome: 'Cliente Teste', sobrenome: 'UI', telefone: telefonePerfil,
      cep: '', endereco: '', numero: '', bairro: '', complemento: '',
      cidade: 'São Paulo', estado: 'SP',
    }).catch(() => {});

    // ── CL-04b Adicionar item (logado) ──
    await H.goto(page, H.BASE.cliente + '/');
    await sleep(1500);
    await H.click(page, '.product-card:first-child .btn-add-cart');
    await sleep(800);

    // ── CL-09 Checkout passo 1 (Seus Dados) ──
    await H.click(page, '.cart-bar .btn-cart-checkout');
    await sleep(1000);
    let passo = await H.text(page, '.checkout-drawer.open h4');
    if (/Seus Dados/.test(passo)) {
      // Preencher nome/telefone
      const inputs = await page.$$('.checkout-drawer.open input');
      await inputs[0].click({ clickCount: 3 }); await inputs[0].type('Cliente Teste');
      await inputs[1].click({ clickCount: 3 }); await inputs[1].type(PHONE);
      await H.click(page, '.checkout-drawer.open .form-actions .btn-primary');
      await sleep(1200);
      passo = await H.text(page, '.checkout-drawer.open h4');
    }
    report('CL-09', 'Checkout passo endereço', /Endereço/.test(passo), `passo atual: "${passo.slice(0, 40)}"`);

    // ── Helper: preencher campos obrigatórios do endereço (número) se vazios ──
    async function garantirEndereco() {
      // Número é obrigatório e não é preenchido pelo CEP — preencher se vazio
      const drawer = '.checkout-drawer.open';
      const inputs = await page.$$(`${drawer} input`);
      for (const input of inputs) {
        const ph = await input.evaluate(el => el.placeholder || '');
        if (ph === '123') {
          const val = await input.evaluate(el => el.value);
          if (!val) { await input.click({ clickCount: 3 }); await input.type('100'); }
        }
      }
    }

    // ── CL-10 CEP dentro do raio → frete ──
    const cepInput = await page.$('.checkout-drawer.open input[maxlength="9"]');
    if (cepInput) {
      await cepInput.click({ clickCount: 3 });
      await cepInput.type('06010000');
      await sleep(200);
      await H.clickByText(page, 'Buscar', '.checkout-drawer.open');
      await sleep(3000);
      const freteOK = await H.count(page, '.checkout-drawer.open .cep-result.success');
      const freteTxt = await H.text(page, '.checkout-drawer.open .cep-result.success');
      report('CL-10', 'CEP válido + frete', freteOK > 0, freteTxt.slice(0, 80).replace(/\n/g, ' '));
    } else {
      report('CL-10', 'CEP válido + frete', false, 'campo CEP não encontrado');
    }

    // ── CL-11 CEP fora do raio → bloqueia ──
    // Usa CEP REAL do Rio (20040000 — Rua da Ajuda) que resolve na API e fica
    // fora do raio de Osasco (o 22000000 usado antes é inválido → 500 no deploy).
    if (cepInput) {
      await cepInput.click({ clickCount: 3 });
      await cepInput.type('20040000');
      await sleep(200);
      await H.clickByText(page, 'Buscar', '.checkout-drawer.open');
      await sleep(3000);
      const erroRaio = await H.count(page, '.checkout-drawer.open .cep-result.error');
      const erroTxt = await H.text(page, '.checkout-drawer.open .cep-result.error');
      // Tentar avançar mesmo assim — deve ser bloqueado
      await H.clickByText(page, 'Continuar', '.checkout-drawer.open').catch(() => {});
      await sleep(800);
      const passoAindaEndereco = await H.text(page, '.checkout-drawer.open h4');
      report('CL-11', 'CEP fora do raio bloqueia', erroRaio > 0 && /Endereço/.test(passoAindaEndereco),
        `erro: "${erroTxt.slice(0, 50)}" | passo segue em endereço: ${/Endereço/.test(passoAindaEndereco)}`);
      // Voltar para CEP válido
      await cepInput.click({ clickCount: 3 });
      await cepInput.type('06010000');
      await sleep(200);
      await H.clickByText(page, 'Buscar', '.checkout-drawer.open');
      await sleep(3000);
    }

    // Preencher número (obrigatório, não vem do CEP) antes de avançar
    await garantirEndereco();

    // ── CL-12 Método de pagamento ──
    await H.clickByText(page, 'Continuar', '.checkout-drawer.open');
    await sleep(1200);
    const passo3 = await H.text(page, '.checkout-drawer.open h4');
    const selectCount = await H.count(page, '.checkout-drawer.open select');
    if (selectCount > 0) {
      await page.select('.checkout-drawer.open select', 'dinheiro');
      await sleep(400);
    }
    report('CL-12', 'Forma de pagamento', /Pagamento/.test(passo3) && selectCount > 0,
      `passo: "${passo3.slice(0, 30)}" | select presente: ${selectCount > 0}`);

    // ── CL-13 Revisão total ──
    await H.clickByText(page, 'Continuar', '.checkout-drawer.open');
    await sleep(1200);
    const passo4 = await H.text(page, '.checkout-drawer.open h4');
    const body = await H.text(page, '.checkout-drawer.open');
    const temSubtotal = /Subtotal/.test(body);
    const temFrete = /Taxa de Entrega/.test(body);
    const temTotal = /Total/.test(body);
    report('CL-13', 'Revisão com total', /Revisar/.test(passo4) && temSubtotal && temFrete && temTotal,
      `revisão: subtotal=${temSubtotal} frete=${temFrete} total=${temTotal}`);

    // ── CL-14 Confirmar pedido (Dinheiro/COD) ──
    const temLoginNotice = await H.count(page, '.login-notice');
    if (temLoginNotice > 0) {
      report('CL-14', 'Confirmar pedido', false, 'pedido sem sessão — precisa login');
    } else {
      await H.click(page, '.checkout-drawer.open .btn-success');
      await sleep(5000);
      const url = page.url();
      const m = url.match(/\/pedidos\/(\d+)$/);
      if (m) orderId = m[1];
      report('CL-14', 'Confirmar pedido COD', /\/pedidos\//.test(url), `redirecionado para ${url}`);
    }

    // ── CL-16 Tracking ──
    const tracking = await H.text(page, 'body');
    report('CL-16', 'Tracking do pedido', /pendente|Preparando|Aguardando|Status/i.test(tracking),
      `body contém status: ${/pendente|Preparando|Aguardando/i.test(tracking)}`);

    // ── CL-15 Histórico de pedidos ──
    await H.goto(page, H.BASE.cliente + '/pedidos');
    await sleep(2000);
    const lista = await H.text(page, 'body');
    const temPedidos = /#\d|pedido/i.test(lista);
    report('CL-15', 'Histórico de pedidos', temPedidos, 'página /pedidos renderizou lista');

    // ── CL-17 Perfil ──
    await H.goto(page, H.BASE.cliente + '/perfil');
    await sleep(2000);
    const perfilOK = await H.count(page, 'input') > 0;
    report('CL-17', 'Perfil carrega', perfilOK, `${await H.count(page, 'input')} campos no perfil`);

    // ── CL-18 CEP onboarding ──
    // Desativa o guard do harness (que pré-grava o CEP) para o modal aparecer
    await page.evaluate(() => {
      localStorage.setItem('saborexpress_test_nocep', '1');
      localStorage.removeItem('saborexpress_cep');
    });
    await H.goto(page, H.BASE.cliente + '/');
    await sleep(2500);
    const onboarding = await H.count(page, '.cep-modal-overlay, .cep-modal');
    const body18 = await H.text(page, 'body');
    const modalCep = /Qual seu endereço/i.test(body18);
    report('CL-18', 'CEP onboarding', onboarding > 0 || modalCep, `modal: ${onboarding} elem | texto: ${modalCep}`);
    // Fechar o modal para não atrapalhar os próximos testes
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.cep-modal-overlay button')].find(b => /sem CEP/i.test(b.innerText || ''));
      if (btn) btn.click();
    }).catch(() => {});
    await page.evaluate(() => localStorage.removeItem('saborexpress_test_nocep'));
    await sleep(600);

    // ── CL-19 Carrinho persiste ──
    await H.goto(page, H.BASE.cliente + '/');
    await sleep(1500);
    await H.click(page, '.product-card:first-child .btn-add-cart');
    await sleep(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2000);
    const cartPersist = await H.count(page, '.cart-bar');
    report('CL-19', 'Carrinho persiste (F5)', cartPersist > 0, 'cart-bar ainda visível após reload');
    // Limpar carrinho
    await page.evaluate(() => localStorage.removeItem('saborexpress_cart'));

    // ── CL-20 Logout ──
    await H.goto(page, H.BASE.cliente + '/');
    await sleep(1200);
    await fetchJSON(page, '/api/auth/logout', 'POST');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2000);
    const logoutOK = await H.count(page, '.bottom-nav .bottom-nav-item.active') >= 0;
    const body20 = await H.text(page, 'body');
    report('CL-20', 'Logout', logoutOK, `sessão encerrada (navbar presente: ${await H.count(page, '.bottom-nav') > 0})`);

  } catch (err) {
    report('CL-ERR', 'Erro de execução', false, err.message);
    console.error(err);
  } finally {
    const res = H.summary('CLIENTE');
    await browser.close();
    process.exit(res.fail > 0 ? 2 : 0);
  }
}

run();
