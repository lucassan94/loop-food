import axios from 'axios'

// Lê slug da URL (ex: ?slug=kardapio) para fallback de tenant
let _urlSlug = null
try {
  const params = new URLSearchParams(window.location.search)
  _urlSlug = params.get('slug')
} catch { /* ignora */ }

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  // Cookie própria do app entregador — sessões individuais por módulo
  const token = document.cookie.match(/(^| )entregador_publicToken=([^;]+)/)?.[2]
  if (token) config.headers.Authorization = `Bearer ${token}`
  // Cross-login prevention: identificar módulo para o backend
  config.headers['X-Module'] = 'entregador'
  // Se houver slug na URL, passar para o tenantResolver (fallback)
  if (_urlSlug) {
    config.headers['X-Tenant-Slug'] = _urlSlug
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      // Só tenta refresh se havia um token — evita loop infinito quando
      // o usuário nunca fez login (primeiro carregamento da página)
      const hadToken = !!document.cookie.match(/(^| )entregador_publicToken=([^;]+)/)?.[2]
      if (!hadToken) return Promise.reject(error)

      error.config._retry = true
      try {
        await axios.post('/api/auth/refresh', {}, { withCredentials: true, headers: { 'X-Module': 'entregador' } })
        return api(error.config)
      } catch {
        // Refresh falhou — limpa cookies e redireciona sem reload completo
        document.cookie.split(';').forEach(c => {
          document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/')
        })
        window.location.href = window.location.pathname.startsWith('/entregador') ? '/entregador' : '/'
      }
    }
    return Promise.reject(error)
  }
)

export default api
