// ============================================================================
// CHECK TABS — REMOÇÃO DO LOGO AO VIVO
// ============================================================================
// Abre os 3 painéis, confere que o favicon começa com o logo, dispara o evento
// 'restaurante:atualizado' com logo_base64:null (como o botão "Remover" do
// painel faz via realtime) e confere que CADA ABA volta ao favicon padrão SEM
// recarregar a página.
//
// Requer: node serve_tabs.mjs rodando na porta 8095 (LOGO=1, padrão).
// Uso:   node check_tabs_remocao.mjs
// ============================================================================
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = `http://localhost:${process.env.PORT || 8095}`
const NOME = 'Pizzaria Teste'
const PNG_PREFIX = 'data:image/png;base64,iVBORw0KGgo'

const panels = [
  { id: 'CL', url: BASE + '/', fallback: '/icons/icon.svg' },
  { id: 'RS', url: BASE + '/admin/', fallback: '/admin/favicon.svg' },
  { id: 'EN', url: BASE + '/entregador/', fallback: '/entregador/favicon.svg' },
]

const results = []
const check = (id, desc, ok, detail = '') => {
  results.push({ id, desc, ok })
  console.log(`[${ok ? 'OK' : 'FALHA'}] ${id} ${desc} ${detail}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(page, fn, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await fn()) return true } catch { /* página ainda carregando */ }
    await sleep(300)
  }
  return false
}

const favicon = (page) => page.evaluate(() => document.querySelector("link[rel='icon']")?.href || '')

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})

const pages = []
for (const p of panels) {
  const page = await browser.newPage()
  await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  pages.push({ ...p, page })
}

// ── Estado inicial: favicon = logo em todas as abas ────────────────────────
for (const { id, page } of pages) {
  const ok = await waitFor(page, async () => (await favicon(page)).startsWith(PNG_PREFIX))
  check(`${id}-1`, 'início: favicon = logo do restaurante', ok, ok ? '' : `(href: ${await favicon(page)})`)
}

// Dá tempo de todos os sockets conectarem (EN conecta após sessão/loadData)
await sleep(3000)

// ── Remover o logo (como o botão "Remover" do painel: emite o evento) ──────
const rem = await fetch(BASE + '/__api/remover-logo', { method: 'POST' })
check('CTRL', 'endpoint __api/remover-logo respondeu', rem.ok)

// ── Cada aba deve voltar ao favicon padrão AO VIVO (sem reload) ────────────
for (const { id, page, fallback } of pages) {
  const ok = await waitFor(page, async () => (await favicon(page)).endsWith(fallback))
  check(`${id}-2`, `ao vivo: favicon voltou ao padrão (${fallback})`, ok, ok ? '' : `(href: ${await favicon(page)})`)
}

// ── O título da aba deve continuar com o nome do restaurante ───────────────
for (const { id, page } of pages) {
  const t = await page.title()
  check(`${id}-3`, `título mantém o nome "${NOME}"`, t.startsWith(NOME), `(obtido: "${t}")`)
}

await browser.close()

console.log('\n=== RESUMO REMOÇÃO AO VIVO ===')
const ok = results.filter((r) => r.ok).length
console.log(`${ok}/${results.length} verificações passaram`)
if (results.some((r) => !r.ok)) process.exit(1)
console.log('REMOÇÃO AO VIVO OK')
