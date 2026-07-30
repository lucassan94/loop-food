import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
})

// Lê slug da URL (ex: ?slug=saborexpress) uma vez e armazena
let _urlSlug = null
try {
  const params = new URLSearchParams(window.location.search)
  _urlSlug = params.get('slug')
} catch { /* ignora */ }

// Interceptor para adicionar token público lido dos cookies + slug
api.interceptors.request.use((config) => {
  // Pular endpoints que não precisam de autenticação
  const publicEndpoints = ['/auth/cliente/login', '/auth/cliente/signup', '/auth/refresh']
  const isPublic = publicEndpoints.some(e => config.url.includes(e))
  if (!isPublic) {
    const token = getCookie('publicToken')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  // Cross-login prevention: identificar módulo para o backend
  config.headers['X-Module'] = 'cliente'
  // Se houver slug na URL, passar para o tenantResolver
  if (_urlSlug) {
    config.headers['X-Tenant-Slug'] = _urlSlug
  }
  return config
})

// Interceptor para renovar token expirado
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !originalRequest._retry) {
      originalRequest._retry = true
      try {
        await axios.post('/api/auth/refresh', {}, { withCredentials: true })
        return api(originalRequest)
      } catch {
        window.location.href = '/'
        return Promise.reject(error)
      }
    }

    return Promise.reject(error)
  }
)

function getCookie(name) {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`))
  return match ? decodeURIComponent(match[2]) : null
}

// ============================
// Asaas Payment Methods
// ============================

export async function criarPagamento(data) {
  const response = await api.post('/pagamentos/criar', data)
  return response
}

export async function getPixQrCode(pedidoId) {
  const response = await api.get(`/pagamentos/${pedidoId}/pix-qrcode`)
  return response
}

export default api
