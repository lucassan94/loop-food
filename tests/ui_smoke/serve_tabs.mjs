// ============================================================================
// STUB SERVER para testar título/favicon/manifest das abas (sem tocar em produção)
// ============================================================================
// Sobe um servidor que espelha as rotas do router de produção (8094):
//   /           → app/cliente/dist
//   /admin/     → app/restaurante/dist
//   /entregador/→ app/entregador/dist
//   /api/restaurante → fixture (nome + logo, ou sem logo via LOGO=0)
//   /api/auth/me → usuário entregador (cookie entregador_publicToken=testtoken)
//   POST /__api/remover-logo → emite 'restaurante:atualizado' com logo_base64:null
//   POST /__api/restaurar-logo → emite 'restaurante:atualizado' com o logo
//   /socket.io → engine.io real (socket.io Server) p/ eventos ao vivo
//
// Uso: node serve_tabs.mjs            (com logo)
//      LOGO=0 node serve_tabs.mjs     (sem logo → favicon padrão)
// ============================================================================
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Server as SocketIOServer } from 'socket.io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../app')
const PORT = process.env.PORT || 8095
const WITH_LOGO = process.env.LOGO !== '0'

const NOME = 'Pizzaria Teste'
// 1x1 PNG vermelho — prefixo iVBORw0KGgo (detectado como PNG pelo front)
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// Estado mutável do "restaurante" (a remoção do logo troca isto + emite evento)
let logoBase64 = WITH_LOGO ? PNG_B64 : null

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function serveStatic(res, filePath, extraHeaders = {}) {
  if (!fs.existsSync(filePath)) return false
  const ext = path.extname(filePath)
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ...extraHeaders,
  })
  fs.createReadStream(filePath).pipe(res)
  return true
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  let p = decodeURIComponent(url.pathname)

  // ── Socket.IO: o engine.io (Server criado abaixo) cuida destas rotas ─────
  if (p.startsWith('/socket.io/')) return

  // ── Controle do stub (não existe em produção) ────────────────────────────
  if (req.method === 'POST' && p === '/__api/remover-logo') {
    logoBase64 = null
    io.emit('restaurante:atualizado', { nome: NOME, logo_base64: null })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, logo_base64: null }))
    return
  }
  if (req.method === 'POST' && p === '/__api/restaurar-logo') {
    logoBase64 = PNG_B64
    io.emit('restaurante:atualizado', { nome: NOME, logo_base64: PNG_B64 })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, logo_base64: PNG_B64 }))
    return
  }

  // ── API stub ───────────────────────────────────────────────────────────
  if (p.startsWith('/api/')) {
    if (p === '/api/restaurante' || p === '/api/restaurante/') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify({
        id: 1,
        nome: NOME,
        endereco: 'Av. Teste, 100',
        cidade: 'São Paulo',
        estado: 'SP',
        status_loja: true,
        logo_base64: logoBase64,
        cor_primaria: '#dc2626',
        cor_secundaria: '#f97316',
        cor_terciaria: '#3b82f6',
        features: { salao: true, delivery: true },
        horarios_funcionamento: [],
        timezone: 'America/Sao_Paulo',
      }))
      return
    }
    if (p === '/api/auth/me') {
      // Sessão do entregador (cookie entregador_publicToken=testtoken)
      const auth = req.headers.authorization || ''
      if (auth.startsWith('Bearer testtoken')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          user: { id: 1, nome: 'Entregador Teste', module: 'entregador', telefone: '11999998888', entregasTotal: 0, freteTotal: 0 },
        }))
        return
      }
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'nao autenticado (stub)' }))
      return
    }
    if (p.startsWith('/api/auth/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'nao autenticado (stub)' }))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'endpoint nao stubado' }))
    return
  }

  // ── Rotas estáticas (espelha o router de produção) ─────────────────────
  let appKey = 'cliente'
  let dist = path.join(ROOT, 'cliente', 'dist')
  if (p.startsWith('/admin/')) {
    appKey = 'restaurante'
    dist = path.join(ROOT, 'restaurante', 'dist')
    p = p.slice('/admin'.length)
  } else if (p.startsWith('/entregador/')) {
    appKey = 'entregador'
    dist = path.join(ROOT, 'entregador', 'dist')
    p = p.slice('/entregador'.length)
  }

  if (p === '/' || p === '') p = '/index.html'
  const filePath = path.join(dist, p)

  // Sessão fake do entregador: cookie para o app reconectar o socket pós-login
  const extraHeaders = appKey === 'entregador' && p === '/index.html'
    ? { 'Set-Cookie': ['entregador_publicToken=testtoken; Path=/', 'tenantId=1; Path=/'] }
    : {}

  if (!serveStatic(res, filePath, extraHeaders)) {
    // SPA fallback (try_files $uri $uri/ /index.html)
    if (serveStatic(res, path.join(dist, 'index.html'), extraHeaders)) return
    res.writeHead(404)
    res.end('not found')
  }
})

// ── Socket.IO realtime (mesma origem; aceita qualquer conexão de teste) ────
const io = new SocketIOServer(server, { path: '/socket.io', cors: { origin: true, credentials: true } })
io.on('connection', () => {
  console.log('[stub] socket conectado')
})

server.listen(PORT, () => {
  console.log(`[stub] http://localhost:${PORT} | logo=${logoBase64 ? 'SIM' : 'NAO'} | nome="${NOME}"`)
})
