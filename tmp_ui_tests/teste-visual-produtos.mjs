/* Teste visual do redesign de ProdutosView.vue (painel admin)
 * - Login admin/admin123
 * - Aba Subcategorias Adicionais → drawer lateral da direita + editor
 * - + Novo Produto → drawer amplo com abas Dados/Imagem/Adicionais/Opções/Disponibilidade
 * - Screenshots em tmp_ui_tests/screenshots/ + relatório de console errors
 */
import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'

const BASE = 'http://localhost:5174/admin/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOTS = path.resolve('screenshots')
fs.mkdirSync(SHOTS, { recursive: true })

const consoleErrors = []
const pageErrors = []
const failedRequests = []
const steps = []

function log(step, ok, extra = '') {
  steps.push({ step, ok, extra })
  console.log(`${ok ? '✅' : '❌'} ${step}${extra ? ' — ' + extra : ''}`)
}

async function waitFor(page, sel, timeout = 20000) {
  await page.waitForSelector(sel, { visible: true, timeout })
}

async function clickByText(page, selector, text, timeout = 15000) {
  await page.waitForFunction(
    (sel, txt) => {
      const els = [...document.querySelectorAll(sel)]
      return els.some(e => e.textContent.trim().includes(txt))
    },
    { timeout }, selector, text
  )
  const ok = await page.evaluate((sel, txt) => {
    const els = [...document.querySelectorAll(sel)]
    const el = els.find(e => e.textContent.trim().includes(txt))
    if (el) { el.click(); return true }
    return false
  }, selector, text)
  if (!ok) throw new Error(`clickByText falhou: ${selector} com "${text}"`)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

let browser
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => pageErrors.push(String(e)))
  page.on('response', r => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`)
  })

  // 1. Login
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 })
  await waitFor(page, '.login-card')
  await page.type('input[type="text"]', 'admin')
  await page.type('input[type="password"]', 'admin123')
  await page.evaluate(() => {
    const form = document.querySelector('.login-card form')
    const btn = form.querySelector('button[type="submit"], button.btn')
    if (btn) btn.click(); else form.requestSubmit()
  })
  await waitFor(page, '.sidebar', 25000)
  log('Login efetuado', true)
  await sleep(800)

  // 2. Abrir Produtos
  await clickByText(page, '.sidebar-item', 'Produtos')
  await waitFor(page, '.cardapio-tabs')
  log('Aba Produtos aberta', true)
  await sleep(600)
  await page.screenshot({ path: path.join(SHOTS, '01-produtos.png') })

  // 3. Subcategorias Adicionais → drawer
  await clickByText(page, '.cardapio-tab', 'Subcategorias Adicionais')
  await waitFor(page, '.drawer-panel')
  const drawerTitle = await page.$eval('.drawer-panel .drawer-header h3', el => el.textContent.trim())
  const overlayVisible = await page.$eval('.drawer-overlay', el => getComputedStyle(el).display !== 'none').catch(() => false)
  log('Drawer Subcategorias abriu', drawerTitle.includes('Subcategorias'), `título="${drawerTitle}" overlay=${overlayVisible}`)
  // Aguardar o axios popular a lista (a API é assíncrona). Se os cartões não
  // aparecerem em 10s, prossegue para reportar o estado vazio como falha real.
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('.catalog-card').length > 0,
      { timeout: 10000 }
    )
  } catch { /* pode ser estado vazio legítimo — checado abaixo */ }
  await sleep(400)
  const nCards = await page.$$eval('.catalog-card', els => els.length)
  const toolbarBtn = await page.$eval('.drawer-toolbar', el => el.textContent.trim().slice(0, 40)).catch(() => '')
  log('Lista do drawer renderizada', nCards > 0, `${nCards} cartão(ões) | toolbar: ${toolbarBtn}`)
  await page.screenshot({ path: path.join(SHOTS, '02-subcategorias-drawer.png') })

  // DIAGNÓSTICO: o que o navegador recebe do endpoint do catálogo?
  const diag = await page.evaluate(async () => {
    const res = await fetch('/api/produtos/extra-subcategorias')
    const txt = await res.text()
    return { status: res.status, len: txt.length, head: txt.slice(0, 220) }
  })
  console.log('DIAGNÓSTICO /extra-subcategorias no navegador:', JSON.stringify(diag))

  // 4. Editor "Nova Subcategoria"
  await clickByText(page, '.drawer-body .btn-primary', 'Nova Subcategoria')
  await waitFor(page, '.editor-card')
  const hasNome = await page.$$eval('.editor-card label', ls => ls.some(l => l.textContent.includes('Nome do grupo')))
  const hasSegmented = await page.$$eval('.editor-card .segmented button', bs => bs.length >= 2)
  const itemBtn = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.editor-card button')]
    const b = btns.find(x => x.textContent.includes('Adicionar item'))
    if (b) { b.click(); return true }
    return false
  })
  await sleep(400)
  const nItemCards = await page.$$eval('.catalog-item-card', els => els.length)
  log('Editor de subcategoria OK', hasNome && hasSegmented, `nome=${hasNome} segmented=${hasSegmented} itemCards=${nItemCards} (addItem ${itemBtn ? 'clicado' : 'falhou'})`)
  await page.screenshot({ path: path.join(SHOTS, '03-subcategoria-editor.png') })

  // 5. Voltar + fechar drawer
  await clickByText(page, '.editor-card button, .drawer-body .btn', 'Voltar para a lista')
  await sleep(400)
  await page.click('.drawer-close')
  await sleep(700)
  const drawerClosed = await page.$('.drawer-panel').then(el => !el || getComputedStyle(el).display === 'none').catch(() => true)
  log('Drawer fechado', drawerClosed)

  // 6. Form de produto (drawer amplo + abas)
  await clickByText(page, '.btn-primary', '+ Novo Produto')
  await waitFor(page, '.drawer-wide')
  await waitFor(page, '.form-tab')
  const tabLabels = await page.$$eval('.form-tab', ts => ts.map(t => t.textContent.trim()))
  const esperadas = ['Dados', 'Imagem', 'Adicionais', 'Opções', 'Disponibilidade']
  const todasAbas = esperadas.every(l => tabLabels.some(t => t.includes(l)))
  log('Form de produto abriu com abas', todasAbas, `abas=${JSON.stringify(tabLabels)}`)
  await page.screenshot({ path: path.join(SHOTS, '04-produto-dados.png') })

  // Clicar em cada aba e capturar
  for (const aba of esperadas.slice(1)) {
    await clickByText(page, '.form-tab', aba)
    await sleep(500)
    const nomeAba = aba.toLowerCase()
    await page.screenshot({ path: path.join(SHOTS, `05-aba-${nomeAba}.png`) })
    log(`Aba "${aba}" renderizada`, true)
  }

  // 7. Fechar form
  await page.click('.drawer-footer .btn-secondary')
  await sleep(600)

  // Relatório
  console.log('\n════════ RELATÓRIO ════════')
  const falhas = steps.filter(s => !s.ok)
  console.log(`Etapas: ${steps.length} | OK: ${steps.length - falhas.length} | Falhas: ${falhas.length}`)
  if (falhas.length) console.log('FALHAS:', JSON.stringify(falhas, null, 2))
  console.log(`Console errors: ${consoleErrors.length}`)
  consoleErrors.slice(0, 8).forEach(e => console.log('  •', e.slice(0, 200)))
  console.log(`Page errors: ${pageErrors.length}`)
  pageErrors.slice(0, 5).forEach(e => console.log('  •', e.slice(0, 200)))
  console.log(`Requisições falhas (>=400): ${failedRequests.length}`)
  failedRequests.slice(0, 10).forEach(u => console.log('  •', u.slice(0, 160)))
  console.log('Screenshots em:', SHOTS)
  process.exit(falhas.length ? 1 : 0)
} catch (err) {
  console.error('ERRO FATAL no teste:', err.message)
  console.log('\nEtapas até falhar:')
  steps.forEach(s => console.log(`${s.ok ? '✅' : '❌'} ${s.step}`))
  console.error('Console errors:', consoleErrors.slice(0, 8))
  console.error('Page errors:', pageErrors.slice(0, 5))
  process.exit(2)
} finally {
  if (browser) await browser.close().catch(() => {})
}
