// ── Harness de testes UI (Puppeteer-core + Chrome local) ──
const puppeteer = require('puppeteer-core');

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

// Ambiente — instância deployada.
// NOTA: o acesso UI usa HTTPS via domínio (a CSP do router tem
// `upgrade-insecure-requests`, que força o navegador a HTTPS — o IP:8091/8094
// não fala TLS, então os testes UI devem usar o domínio). A API pode ser
// acessada direto por IP (backend sem nginx).
const BASE = {
  cliente: 'https://palazzomooca.loopautomacoes.com.br',
  painel: 'https://palazzomooca.loopautomacoes.com.br/admin',
  entregador: 'https://palazzomooca.loopautomacoes.com.br/entregador',
  api: 'http://86.48.18.22:8090/api',
};

const results = [];
let consoleErrors = [];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function report(id, nome, pass, evidencia = '') {
  results.push({ id, nome, pass, evidencia });
  const status = pass ? 'PASS' : 'FAIL';
  console.log(`${status}\t${id}\t${nome}\t${evidencia}`);
}

async function launch() {
  const executablePath = CHROME_PATHS.find(p => require('fs').existsSync(p));
  if (!executablePath) throw new Error('Chrome não encontrado');
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=420,900',
    ],
    defaultViewport: { width: 420, height: 900 },
  });
  return browser;
}

async function newPage(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));
  return page;
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(1500);
}

// Espera um seletor visível
async function waitFor(page, selector, timeout = 20000) {
  await page.waitForSelector(selector, { visible: true, timeout });
}

async function text(page, selector) {
  try {
    return await page.$eval(selector, el => (el.innerText || '').trim());
  } catch { return ''; }
}

async function count(page, selector) {
  try { return await page.$$eval(selector, els => els.length); } catch { return 0; }
}

async function click(page, selector) {
  await waitFor(page, selector);
  await page.click(selector);
}

async function type(page, selector, value) {
  await waitFor(page, selector);
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value, { delay: 20 });
}

// Clica um botão pelo texto (dentro de um contêiner opcional)
async function clickByText(page, textMatch, container = 'body') {
  const handle = await page.evaluateHandle(({ container, textMatch }) => {
    const root = document.querySelector(container) || document.body;
    const all = root.querySelectorAll('button, .btn, a, label, [role="button"]');
    for (const el of all) {
      if ((el.innerText || '').trim().toLowerCase().includes(textMatch.toLowerCase())) {
        return el;
      }
    }
    return null;
  }, { container, textMatch });
  const el = handle.asElement();
  if (!el) throw new Error(`Botão "${textMatch}" não encontrado em ${container}`);
  await el.click();
  await handle.dispose();
}

// Verifica se texto aparece na página
async function hasText(page, textMatch) {
  const body = await text(page, 'body');
  return body.toLowerCase().includes(textMatch.toLowerCase());
}

// Espera até que a condição avaliada na página retorne true (polling)
// ATENÇÃO: page.evaluate NÃO serializa closures — passe variáveis como args.
async function waitForEval(page, fn, timeout = 15000, interval = 400, ...args) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await page.evaluate(fn, ...args)) return true;
    } catch {}
    await sleep(interval);
  }
  return false;
}

// ── Logins ──
async function loginPainel(page, apelido, senha) {
  await goto(page, BASE.painel);
  await type(page, '.login-card input[type="text"]', apelido);
  await type(page, '.login-card input[type="password"]', senha);
  await click(page, '.login-card button[type="submit"]');
  await sleep(3000);
  const ok = (await page.$$eval('.sidebar', els => els.length)) > 0;
  let erro = '';
  if (!ok) erro = (await text(page, '.login-card')).slice(0, 90);
  return { ok, erro };
}

async function loginEntregador(page, telefone, senha) {
  await goto(page, BASE.entregador);
  await type(page, '.login-card input[type="text"]', telefone);
  await type(page, '.login-card input[type="password"]', senha);
  await click(page, '.login-card button[type="submit"]');
  await sleep(3000);
  const ok = (await page.$$eval('.app-header', els => els.length)) > 0;
  let erro = '';
  if (!ok) erro = (await text(page, '.login-card')).slice(0, 90);
  return { ok, erro };
}

async function loginCliente(page, usuario, senha) {
  await goto(page, BASE.cliente + '/auth');
  await type(page, '.auth-card input[type="text"]', usuario);
  await type(page, '.auth-card input[type="password"]', senha);
  await click(page, '.auth-card button[type="submit"]');
  await sleep(2500);
  // Após login vai para / e mostra a bottom-nav
  return await page.$$eval('.bottom-nav', els => els.length > 0);
}

// ── Fetch same-origin (usa cookies da sessão da página) ──
async function fetchJSON(page, path, method = 'GET', body = null) {
  return page.evaluate(async ({ path, method, body }) => {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }, { path, method, body });
}

async function logoutCliente(page) {
  try { await fetchJSON(page, '/api/auth/logout', 'POST'); } catch {}
  await goto(page, BASE.cliente + '/');
  await sleep(1200);
}

// ── API helpers (fetch nativo do Node, sem cookies) ──
async function apiRequest(path, method = 'GET', body = null, token = null) {
  const res = await fetch(BASE.api + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function apiLoginAdmin() {
  const r = await apiRequest('/auth/restaurante/login', 'POST', { apelido: 'admin', password: 'admin123' });
  return r.data?.token || null;
}

async function apiLoginCliente() {
  // Login por apelido; se falhar (usuário seed ausente), tenta signup com telefone único
  const r = await apiRequest('/auth/cliente/login', 'POST', { apelido: 'cliente', password: 'cliente123' });
  if (r.status === 200 && r.data?.token) return { token: r.data.token, viaSignup: false };
  const telefone = '1196000' + String(Math.floor(1000 + Math.random() * 9000));
  const s = await apiRequest('/auth/cliente/signup', 'POST', {
    nome: 'Cliente Teste', sobrenome: 'UI', telefone, password: 'cliente123',
  });
  if (s.status === 201 && s.data?.token) return { token: s.data.token, viaSignup: true };
  return { token: null, viaSignup: false };
}

function summary(moduleName) {
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  console.log(`\n===== ${moduleName}: ${pass} PASS / ${fail} FAIL =====`);
  if (consoleErrors.length) {
    console.log('--- Erros de console (última página): ---');
    console.log([...new Set(consoleErrors)].slice(0, 10).join('\n'));
  }
  return { pass, fail };
}

module.exports = {
  BASE, sleep, launch, newPage, goto, waitFor, text, count, click, type,
  clickByText, hasText, waitForEval, report, fetchJSON, loginPainel,
  loginEntregador, loginCliente, logoutCliente, apiRequest, apiLoginAdmin,
  apiLoginCliente, summary, results,
};
