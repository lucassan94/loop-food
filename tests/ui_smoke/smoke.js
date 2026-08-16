// ============================================================================
// SMOKE DE UI — tenant LOOP (slug 'loop')
// ============================================================================
// Cobre os fluxos principais dos 3 módulos contra os dev servers locais:
//   RS (restaurante)  → login admin + painel carrega com pedidos do Loop
//   CL (cliente)      → cardápio carrega + add ao carrinho + login cliente
//   EN (entregador)   → login entregador + fila de entregas disponíveis
//
// Requer: backend local (3001) + dev servers vite (5173/5174/5175) rodando.
// Uso: node smoke.js
// ============================================================================
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SLUG = 'loop'
const results = []

import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const shotsDir = path.join(__dirname, 'shots')

const check = (id, desc, ok, detail = '') => {
  results.push({ id, desc, ok, detail })
  console.log(`[${ok ? 'OK' : 'FALHA'}] ${id} ${desc} ${detail}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Espera um texto aparecer no DOM (case-insensitive, parcial)
async function waitText(page, text, timeout = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const found = await page.evaluate((t) => {
      return document.body && document.body.innerText.toLowerCase().includes(t.toLowerCase())
    }, text)
    if (found) return true
    await sleep(1000)
  }
  return false
}

// Espera uma condição no DOM ser verdadeira (polling)
async function waitFor(page, fn, timeout = 40000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await fn()) return true } catch { /* página ainda carregando */ }
    await sleep(1000)
  }
  return false
}

async function typeByPlaceholder(page, placeholder, value) {
  const sel = `input[placeholder="${placeholder}"]`
  await page.waitForSelector(sel, { timeout: 30000 })
  await page.click(sel, { clickCount: 3 })
  await page.type(sel, value, { delay: 15 })
}

async function screenshot(page, name) {
  try {
    await page.screenshot({ path: path.join(shotsDir, `${name}.png`) })
  } catch { /* ignora */ }
}

// ────────────────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})

// ════════════════════════════════════════════════════════════════════════════
// RS — MÓDULO RESTAURANTE (painel admin)
// ════════════════════════════════════════════════════════════════════════════
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  await page.goto(`http://localhost:5174/admin/?slug=${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const loginVisible = await page.waitForSelector('input[placeholder="maria.cozinha"]', { timeout: 45000 }).then(() => true).catch(() => false)
  check('RS-01', 'tela de login admin carrega', loginVisible)

  if (loginVisible) {
    await typeByPlaceholder(page, 'maria.cozinha', 'admin')
    await page.type('input[type="password"]', 'admin123', { delay: 15 })
    await page.click('form button[type="submit"]')

    const painel = await waitText(page, 'Fila de Pedidos')
    check('RS-02', 'painel carrega após login (sidebar)', painel)

    // A fila renderiza com os dados do Loop: o cartão "Ativos na Fila" vem do
    // /dashboard/resumo-dia do tenant (sempre retorna um número, mesmo 0). Não
    // checamos pedido fixo — dados de produção mudam (ex.: #1199 virou recusado
    // e hoje o tenant pode não ter pedidos ativos).
    const filaCarregou = await waitFor(page, async () => {
      return await page.evaluate(() => {
        // innerText reflete text-transform:uppercase do CSS — compara em maiúsculas
        const cards = [...document.querySelectorAll('.stat-card')]
        const ativos = cards.find((c) => c.innerText.toUpperCase().includes('ATIVOS NA FILA'))
        return !!ativos && /^\d+$/.test((ativos.querySelector('.value')?.textContent || '').trim())
      })
    })
    check('RS-03', 'fila renderiza com dados do Loop ("Ativos na Fila")', filaCarregou)
    const temConfig = await waitText(page, 'Configurações')
    check('RS-04', 'menu de Configurações visível', temConfig)
  }
  await screenshot(page, 'rs-painel')
  await page.close()
} catch (err) {
  check('RS', 'erro inesperado', false, String(err).slice(0, 160))
}

// ════════════════════════════════════════════════════════════════════════════
// CL — MÓDULO CLIENTE (cardápio + carrinho + login)
// ════════════════════════════════════════════════════════════════════════════
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 420, height: 900 })
  await page.goto(`http://localhost:5173/?slug=${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const cardapio = await waitText(page, 'X-Burguer')
  check('CL-01', 'cardápio carrega com produtos do Loop (X-Burguer)', cardapio)

  // Adicionar Coca-Cola 2L (produto simples — sem opções/subcategorias obrigatórias)
  const addCoca = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.product-card')]
    const card = cards.find((c) => c.innerText.includes('Coca-Cola 2L'))
    if (!card) return false
    const btn = card.querySelector('.btn-add-cart')
    if (!btn) return false
    btn.click()
    return true
  })
  check('CL-02', 'botão add-to-cart da Coca-Cola encontrado e clicado', addCoca)

  const toast = await waitText(page, 'adicionado ao carrinho')
  check('CL-03', 'toast de "adicionado ao carrinho"', toast)

  // Login (rota /auth) — o slug continua na URL
  await page.goto(`http://localhost:5173/auth?slug=${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const loginForm = await page.waitForSelector('input[placeholder="cliente ou (11) 99999-9999"]', { timeout: 30000 }).then(() => true).catch(() => false)
  check('CL-04', 'tela de login do cliente carrega', loginForm)

  if (loginForm) {
    // O campo é máscara de telefone (maskTelefone) — digitar os 11 dígitos
    await typeByPlaceholder(page, 'cliente ou (11) 99999-9999', '11999998888')
    await page.type('input[type="password"]', 'cliente123', { delay: 15 })
    await page.click('form button[type="submit"]')
    const logado = await waitText(page, 'Maria')
    check('CL-05', 'login cliente por telefone efetua (header mostra Maria)', logado)
  }
  await screenshot(page, 'cl-home')
  await page.close()
} catch (err) {
  check('CL', 'erro inesperado', false, String(err).slice(0, 160))
}

// ════════════════════════════════════════════════════════════════════════════
// EN — MÓDULO ENTREGADOR (login + fila de entregas)
// ════════════════════════════════════════════════════════════════════════════
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 420, height: 900 })
  await page.goto(`http://localhost:5175/entregador/?slug=${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const loginForm = await page.waitForSelector('input[placeholder="entregador ou (11) 99999-9999"]', { timeout: 45000 }).then(() => true).catch(() => false)
  check('EN-01', 'tela de login do entregador carrega', loginForm)

  if (loginForm) {
    await typeByPlaceholder(page, 'entregador ou (11) 99999-9999', 'entregador')
    await page.type('input[type="password"]', 'entregador123', { delay: 15 })
    await page.click('form button[type="submit"]')

    const fila = await waitText(page, 'entrega(s) disponível(is)')
    check('EN-02', 'fila de entregas disponíveis carrega', fila)
    const temPedido = await waitText(page, 'Pronto para Entrega')
    check('EN-03', 'há pedido(s) pronto_entrega do Loop', temPedido)
  }
  await screenshot(page, 'en-entregas')
  await page.close()
} catch (err) {
  check('EN', 'erro inesperado', false, String(err).slice(0, 160))
}

await browser.close()

// ── Resumo ──────────────────────────────────────────────────────────────────
console.log('\n=== RESUMO UI SMOKE ===')
const ok = results.filter((r) => r.ok).length
console.log(`${ok}/${results.length} testes passaram`)
const fails = results.filter((r) => !r.ok)
if (fails.length) {
  fails.forEach((f) => console.log(`FALHA: ${f.id} ${f.desc} ${f.detail}`))
  process.exit(1)
}
console.log('UI SMOKE OK')
