// ── Diagnóstico: CEP fora do raio no checkout ──
const H = require('./helpers');

async function run() {
  const browser = await H.launch();
  const page = await H.newPage(browser);
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('saborexpress_cep', '06010000');
  });
  try {
    // Signup UI para ter sessão
    await H.goto(page, H.BASE.cliente + '/auth');
    await H.clickByText(page, 'Criar uma conta', '.auth-card');
    await sleep(1000);
    const telefone = '1195090' + String(Math.floor(1000 + Math.random() * 9000));
    const inputs = await page.$$('.auth-card input');
    await inputs[0].click({ clickCount: 3 }); await inputs[0].type('Diag CEP');
    await inputs[1].click({ clickCount: 3 }); await inputs[1].type('T');
    await inputs[2].click({ clickCount: 3 }); await inputs[2].type(telefone);
    await inputs[3].click({ clickCount: 3 }); await inputs[3].type('diagcep@test.com');
    await inputs[4].click({ clickCount: 3 }); await inputs[4].type('cliente123');
    await H.click(page, '.auth-card button[type="submit"]');
    await sleep(3000);

    // Adicionar produto e abrir checkout
    await H.goto(page, H.BASE.cliente + '/');
    await sleep(1500);
    await H.click(page, '.product-card:first-child .btn-add-cart');
    await sleep(800);
    await H.click(page, '.btn-cart-checkout');
    await sleep(1200);

    // Vai direto para Endereço (logado sem endereço)
    console.log('STEP:', JSON.stringify(await H.text(page, '.checkout-drawer.open h4')));

    // CEP fora do raio: 22000-000 (Rio)
    const cepInput = await page.$('.checkout-drawer.open input[maxlength="9"]');
    await cepInput.click({ clickCount: 3 });
    await cepInput.type('22000000');
    await sleep(300);
    await H.clickByText(page, 'Buscar', '.checkout-drawer.open');
    await sleep(4000);

    const drawerHtml = await page.$eval('.checkout-drawer.open', el => el.innerText).catch(() => '');
    console.log('DRAWER após CEP RJ:\n' + drawerHtml.slice(0, 1200));
    console.log('---');
    console.log('erro count:', await H.count(page, '.checkout-drawer.open .cep-result.error'));
    console.log('success count:', await H.count(page, '.checkout-drawer.open .cep-result.success'));

    // Tenta Continuar
    await H.clickByText(page, 'Continuar', '.checkout-drawer.open').catch(e => console.log('Continuar err:', e.message));
    await sleep(1500);
    console.log('STEP após Continuar:', JSON.stringify(await H.text(page, '.checkout-drawer.open h4')));

    // CEP válido de novo: 06010-000
    await H.clickByText(page, 'Voltar', '.checkout-drawer.open').catch(() => {});
    await sleep(800);
    const cep2 = await page.$('.checkout-drawer.open input[maxlength="9"]');
    await cep2.click({ clickCount: 3 });
    await cep2.type('06010000');
    await sleep(300);
    await H.clickByText(page, 'Buscar', '.checkout-drawer.open');
    await sleep(4000);
    console.log('STEP após CEP válido:', JSON.stringify(await H.text(page, '.checkout-drawer.open h4')));
    const drawer2 = await page.$eval('.checkout-drawer.open', el => el.innerText).catch(() => '');
    console.log('DRAWER após CEP válido:\n' + drawer2.slice(0, 800));

    // CEP inválido formato: 99999-999 (API-05 via UI)
    const cep3 = await page.$('.checkout-drawer.open input[maxlength="9"]');
    await cep3.click({ clickCount: 3 });
    await cep3.type('99999999');
    await sleep(300);
    await H.clickByText(page, 'Buscar', '.checkout-drawer.open');
    await sleep(4000);
    const drawer3 = await page.$eval('.checkout-drawer.open', el => el.innerText).catch(() => '');
    console.log('DRAWER após CEP inválido:\n' + drawer3.slice(0, 600));

  } catch (err) {
    console.error('ERRO:', err.message);
  } finally {
    await browser.close();
    process.exit(0);
  }
}

const { sleep } = H;
run();
