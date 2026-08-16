// Valida BUG-013: app do entregador exibe pedidos cancelados com motivo.
// Intercepta a API (page.route) — nada é escrito em produção.
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://localhost:5175/?slug=loop'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 420, height: 900 })

// Intercepta a listagem de cancelados e devolve um pedido fictício do entregador
let interceptou = false
let entregadorId = null
const urlsVistas = []
// Captura o id do entregador na resposta do login (sem interferir na interceptação)
page.on('response', (res) => {
  if (res.url().includes('/api/auth/entregador/login')) {
    res.text().then((corpo) => {
      try {
        const obj = JSON.parse(corpo)
        entregadorId = obj.user?.id ?? obj.entregador?.id ?? null
        console.log('DEBUG: resposta do login -> id =', entregadorId)
      } catch (e) { console.log('DEBUG: resposta do login nao é JSON:', e.message) }
    }).catch(() => {})
  }
})
await page.setRequestInterception(true)
page.on('request', (req) => {
  const url = req.url()
  if (url.includes('/api/pedidos')) urlsVistas.push(url)
  if (url.includes('/api/pedidos?status=cancelados')) {
    interceptou = true
    req.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 999001, pedido_id: 999001, status: 'cancelado', origem: 'delivery',
          entregador_id: entregadorId || 999, nome_cliente: 'Cliente Teste Cancelado',
          motivo_cancelamento: 'Cliente desistiu da compra',
          cancelado_em: new Date().toISOString(), valor_frete: '8.00',
        },
      ]),
    })
    return
  }
  req.continue()
})

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise((r) => setTimeout(r, 2000))

// Login do entregador (usuário persistente de teste)
await page.type('input[placeholder*="entregador ou"]', 'entregador')
await page.type('input[type="password"]', 'entregador123')
await new Promise((r) => setTimeout(r, 300))
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /entrar/i.test(b.innerText))
  if (!btn) console.log('DEBUG: botao Entrar nao encontrado; botoes =', [...document.querySelectorAll('button')].map((b) => b.innerText.slice(0, 20)))
  btn?.click()
})
await page.waitForFunction(() => document.body.innerText.includes('Entregues Hoje') || document.body.innerText.includes('Cancelados Hoje') || document.body.innerText.includes('Nenhuma entrega'), { timeout: 30000 }).catch(() => {})
await new Promise((r) => setTimeout(r, 3000))

console.log('urls de /api/pedidos vistas:', JSON.stringify(urlsVistas, null, 1))
const texto = await page.evaluate(() => document.body.innerText)
console.log('secao de cancelados no texto:', texto.includes('Cancelados Hoje') ? texto.slice(texto.indexOf('Cancelados Hoje'), texto.indexOf('Cancelados Hoje') + 160).replace(/\n+/g, ' | ') : '(ausente)')
const ok = interceptou
  && texto.includes('Cancelados Hoje')
  && texto.includes('999001')
  && texto.includes('Cliente desistiu da compra')
console.log('interceptou /pedidos?status=cancelados:', interceptou)
console.log(ok ? 'BUG-013 OK' : 'BUG-013 FALHOU')

await browser.close()
process.exit(ok ? 0 : 1)
