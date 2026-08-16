// ============================================================================
// CHECK TABS — título e favicon das abas dos 3 painéis (via stub local)
// ============================================================================
// Requer: node serve_tabs.mjs rodando na porta 8095 (mesma variável LOGO).
// Uso:   node check_tabs.mjs            (espera LOGO=1 → favicon = logo)
//        LOGO=0 node check_tabs.mjs     (espera LOGO=0 → favicon padrão)
// ============================================================================
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = `http://localhost:${process.env.PORT || 8095}`
const WITH_LOGO = process.env.LOGO !== '0'
const NOME = 'Pizzaria Teste'
const PNG_PREFIX = 'data:image/png;base64,iVBORw0KGgo'

const panels = [
  { id: 'CL', url: BASE + '/', suffix: 'Cardápio Digital', fallback: '/icons/icon.svg' },
  { id: 'RS', url: BASE + '/admin/', suffix: 'Administrativo', fallback: '/admin/favicon.svg' },
  { id: 'EN', url: BASE + '/entregador/', suffix: 'Entregador', fallback: '/entregador/favicon.svg' },
]

const results = []
const check = (id, desc, ok, detail = '') => {
  results.push({ id, desc, ok })
  console.log(`[${ok ? 'OK' : 'FALHA'}] ${id} ${desc} ${detail}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitTitle(page, suffix, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const t = await page.title()
    if (t.endsWith(' | ' + suffix)) return t
    await sleep(300)
  }
  return page.title()
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})

for (const p of panels) {
  try {
    const page = await browser.newPage()
    await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const title = await waitTitle(page, p.suffix)
    const expectedTitle = `${NOME} | ${p.suffix}`
    check(`${p.id}-T1`, `título da aba = "${expectedTitle}"`, title === expectedTitle, `(obtido: "${title}")`)

    await sleep(600)
    const favicon = await page.evaluate(() => document.querySelector("link[rel='icon']")?.href || '')
    if (WITH_LOGO) {
      check(`${p.id}-T2`, 'favicon = logo do restaurante (data:image/png)', favicon.startsWith(PNG_PREFIX), `(obtido: ${favicon.slice(0, 50)}...)`)
    } else {
      check(`${p.id}-T2`, `favicon = padrão (${p.fallback})`, favicon.endsWith(p.fallback), `(obtido: ${favicon})`)
    }

    // Manifest PWA (só o cliente tem <link rel=manifest>)
    const manifestName = await page.evaluate(async () => {
      const link = document.querySelector("link[rel='manifest']")
      if (!link || !link.href) return null
      try {
        const res = await fetch(link.href)
        const j = await res.json()
        return { name: j.name, short_name: j.short_name, hasLogoIcon: Array.isArray(j.icons) && j.icons.some(i => (i.src || '').startsWith('data:image')) }
      } catch { return null }
    })
    if (manifestName) {
      check(`${p.id}-T3`, `manifest PWA name = "${NOME}"`, manifestName.name === NOME, `(obtido: ${manifestName.name})`)
      if (WITH_LOGO) {
        check(`${p.id}-T4`, 'manifest PWA inclui ícone do logo', !!manifestName.hasLogoIcon)
      }
    }
    await page.close()
  } catch (err) {
    check(p.id, 'erro inesperado', false, String(err).slice(0, 160))
  }
}

await browser.close()

console.log('\n=== RESUMO CHECK TABS ===')
const ok = results.filter((r) => r.ok).length
console.log(`${ok}/${results.length} verificações passaram`)
if (results.some((r) => !r.ok)) process.exit(1)
console.log('CHECK TABS OK')
