import axios from 'axios'

// Lê slug da URL (ex: ?slug=saborexpress) para fallback de tenant
// O método principal de resolução é por subdomínio (Host header),
// mas o slug na URL permite testes sem DNS configurado.
let _urlSlug = null
try {
  const params = new URLSearchParams(window.location.search)
  _urlSlug = params.get('slug')
} catch { /* ignora */ }

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json', 'X-Auth-Guard': 'saborexpress-secure' },
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const token = document.cookie.match(/(^| )publicToken=([^;]+)/)?.[2]
  if (token) config.headers.Authorization = `Bearer ${token}`
  // Cross-login prevention: identificar módulo para o backend
  config.headers['X-Module'] = 'admin'
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
      const hadToken = !!document.cookie.match(/(^| )publicToken=([^;]+)/)?.[2]
      if (!hadToken) return Promise.reject(error)

      error.config._retry = true
      try {
        await axios.post('/api/auth/refresh', {}, { withCredentials: true })
        return api(error.config)
      } catch {
        // Refresh falhou — limpa cookies e redireciona sem reload completo
        document.cookie.split(';').forEach(c => {
          document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/')
        })
        window.location.href = '/'
      }
    }
    return Promise.reject(error)
  }
)

export default api
