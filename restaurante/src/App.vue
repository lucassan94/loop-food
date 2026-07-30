<template>
  <div v-if="!authStore.isAuthenticated" class="login-page">
    <div class="login-card">
      <div class="logo"><i-lucide-utensils-crossed style="width:24px;height:24px" /></div>
      <h2>⚙️ Painel Administrativo</h2>
      <p>Entre com suas credenciais de administrador</p>

      <div v-if="errorMsg" style="background:var(--error-light);color:var(--error);padding:0.75rem;border-radius:6px;font-size:0.85rem;margin-bottom:1rem;">
        {{ errorMsg }}
      </div>

      <form @submit.prevent="login">
        <div class="form-group"><label>E-mail</label><input v-model="email" type="email" required /></div>
        <div class="form-group"><label>Senha</label><input v-model="password" type="password" required minlength="8" /></div>
        <button type="submit" class="btn btn-primary btn-block" style="justify-content:center;width:100%;" :disabled="loading">
          {{ loading ? 'Entrando...' : 'Entrar' }}
        </button>
      </form>
    </div>
  </div>

  <div v-else class="admin-layout">      <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-brand" @click="sidebarCollapsed = false" style="cursor:pointer;">
        <div class="logo">
          <img v-if="logoUrl" :src="logoUrl" alt="Logo" class="sidebar-logo-img" />
          <i-lucide-crown v-else style="width:24px;height:24px" />
        </div>
        <h2>🏰 Palazzo</h2>
        <button class="sidebar-toggle" @click.stop="sidebarCollapsed = !sidebarCollapsed" :title="sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'">
          <i-lucide-chevron-right v-if="sidebarCollapsed" />
          <i-lucide-chevron-left v-else />
        </button>
      </div>
      <nav class="sidebar-nav">
        <template v-for="group in sidebarGroups" :key="group.label">
          <div class="sidebar-group-label" :class="{ collapsed: sidebarCollapsed }">{{ group.label }}</div>
          <button v-for="item in filterMenuItems(group.items)" :key="item.id"
            class="sidebar-item"
            :class="{ active: currentView === item.id }"
            @click="currentView = item.id"
          >
            <component :is="item.icon" />
            <span>{{ item.label }}</span>
          </button>
        </template>
      </nav>
      <div class="sidebar-footer" style="margin-top:auto;border-top:1px solid rgba(255,255,255,0.1);padding:1rem;">
        <button class="sidebar-item" @click="showLogoutConfirm = true">
          <i-lucide-log-out />
          <span>Sair</span>
        </button>
      </div>
    </aside>

    <main class="admin-content">
      <div class="admin-header">
        <h1>{{ currentViewTitle }}</h1>
        <div class="admin-header-right">
          <div class="store-status" :class="storeOpen ? 'open' : 'closed'">
            <i-lucide-circle class="status-dot-indicator" />
            {{ storeOpen ? 'Loja Aberta' : 'Loja Fechada' }}
          </div>
          <span class="cargo-badge" :class="authStore.user?.cargo">
            {{ cargoLabel }}
          </span>
          <span style="color:var(--text-muted);font-size:0.85rem;">
            <i-lucide-user style="width:16px;height:16px" /> {{ authStore.user?.nome }}
          </span>
        </div>
      </div>

      <!-- Views -->
      <PdvView v-if="currentView === 'pdv'" />
      <KdsView v-if="currentView === 'kds'" />
      <OrdersView v-if="currentView === 'pedidos'" @change-view="currentView = $event" />
      <ProdutosView v-if="currentView === 'produtos'" />
      <MesasView v-if="currentView === 'mesas'" @navigate="handleMesaNavigate" />
      <ClientesView v-if="currentView === 'clientes'" />
      <EntregadoresView v-if="currentView === 'entregadores'" />
      <RelatoriosView v-if="currentView === 'relatorios'" />
      <DashboardView v-if="currentView === 'dashboard'" />
      <ConfigView v-if="currentView === 'config'" />

    </main>

    <!-- Confirm Modal -->
    <ConfirmModal
      :show="showLogoutConfirm"
      title="Sair da Conta"
      message="Tem certeza que deseja sair? Você precisará fazer login novamente para acessar o painel."
      confirmText="Sair"
      cancelText="Cancelar"
      variant="danger"
      @confirm="confirmarLogout"
      @update:show="showLogoutConfirm = $event"
    />

    <!-- Loading Overlay -->
    <div v-if="globalLoading" class="loading-overlay">
      <div class="spinner"></div>
      <span class="loading-text">{{ loadingMessage }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, provide, markRaw } from 'vue'
import { useAuthStore } from './stores/auth'
import { connectRealtime, onEvent, offEvent } from './services/realtime'
import api from './services/api'

import { ClipboardList, Hamburger, Users, Bike, BarChart3, PieChart, ShoppingCart, CookingPot, Settings, Table2 } from 'lucide-vue-next'

import ConfirmModal from './components/ConfirmModal.vue'
import OrdersView from './views/OrdersView.vue'
import ProdutosView from './views/ProdutosView.vue'
import ClientesView from './views/ClientesView.vue'
import EntregadoresView from './views/EntregadoresView.vue'
import RelatoriosView from './views/RelatoriosView.vue'
import DashboardView from './views/DashboardView.vue'
import PdvView from './views/PdvView.vue'
import KdsView from './views/KdsView.vue'
import ConfigView from './views/ConfigView.vue'
import MesasView from './views/MesasView.vue'

const authStore = useAuthStore()
const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')
const currentView = ref('pedidos')
const storeOpen = ref(true)
const showLogoutConfirm = ref(false)

// Filtro compartilhado: mesa vindo do MesasView
const filtroMesa = ref('')
provide('filtroMesa', filtroMesa)

// Global loading
const globalLoading = ref(false)
const loadingMessage = ref('Carregando...')

// Sidebar toggle
const sidebarCollapsed = ref(false)
const features = ref({ salao: true, delivery: true })
const logoUrl = ref('')

// Menu completo com cargos permitidos para cada seção
const sidebarGroups = computed(() => [
  ...(features.value.salao ? [{
    label: 'Salão',
    items: [
      { id: 'mesas', label: 'Mesas', icon: markRaw(Table2), cargos: ['admin', 'gerente', 'caixa'] },
      { id: 'pdv', label: 'PDV', icon: markRaw(ShoppingCart), cargos: ['admin', 'gerente', 'caixa'] },
      { id: 'kds', label: 'Cozinha (KDS)', icon: markRaw(CookingPot), cargos: ['admin', 'gerente', 'chef', 'caixa'] },
    ]
  }] : []),
  ...(features.value.delivery ? [{
    label: 'Delivery',
    items: [
      { id: 'pedidos', label: 'Fila de Pedidos', icon: markRaw(ClipboardList), cargos: ['admin', 'gerente', 'chef', 'caixa'] },
      { id: 'entregadores', label: 'Entregadores', icon: markRaw(Bike), cargos: ['admin', 'gerente'] },
      { id: 'relatorios', label: 'Rel. Entregas', icon: markRaw(BarChart3), cargos: ['admin', 'gerente'] },
    ]
  }] : []),
  {
    label: 'Geral',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: markRaw(PieChart), cargos: ['admin', 'gerente', 'caixa'] },
      { id: 'produtos', label: 'Produtos', icon: markRaw(Hamburger), cargos: ['admin', 'gerente', 'chef'] },
      { id: 'clientes', label: 'Clientes', icon: markRaw(Users), cargos: ['admin', 'gerente', 'caixa'] },
      { id: 'config', label: 'Configurações', icon: markRaw(Settings), cargos: ['admin', 'gerente'] },
    ]
  },
])

// Menu completo achatado para compatibilidade
const allMenuItems = computed(() => sidebarGroups.value.flatMap(g => g.items))

// Sidebar filtrada pelo cargo do usuário logado
// Filtro de itens por cargo do usuário
function filterMenuItems(items) {
  const cargo = authStore.user?.cargo
  if (!cargo) return items
  return items.filter(item => item.cargos.includes(cargo))
}

// Menu completo achatado e filtrado (para redirecionamento seguro)
const menuItems = computed(() => {
  const cargo = authStore.user?.cargo
  if (!cargo) return allMenuItems.value
  return allMenuItems.value.filter(item => item.cargos.includes(cargo))
})

// Título da view atual
const currentViewTitle = computed(() => {
  const item = allMenuItems.value.find(i => i.id === currentView.value)
  return item?.label || ''
})

// Label do cargo
const cargoLabel = computed(() => {
  const labels = { admin: 'Admin', gerente: 'Gerente', chef: 'Chef', caixa: 'Caixa' }
  return labels[authStore.user?.cargo] || authStore.user?.cargo || ''
})

// Se a view atual não estiver disponível para o cargo, redireciona para a primeira disponível
function safeRedirect() {
  const items = menuItems.value
  if (items.length > 0 && !items.find(i => i.id === currentView.value)) {
    currentView.value = items[0].id
  }
}

async function login() {
  loading.value = true; errorMsg.value = ''
  try {
    const apiAuth = (await import('./services/api')).default
    const { data } = await apiAuth.post('/auth/restaurante/login', { email: email.value, password: password.value })
    // Cross-login prevention: verificar se o módulo confere
    if (data.user?.module !== 'admin') {
      errorMsg.value = 'Acesso negado: você não tem permissão para este módulo.'
      authStore.user = null
      return
    }
    authStore.user = data.user
  } catch (err) { errorMsg.value = err.response?.data?.error || 'Erro ao fazer login.' }
  finally { loading.value = false }
}

function confirmarLogout() {
  api.post('/auth/logout').catch(() => {})
  authStore.user = null
  // Navegação suave: o template reage a authStore.user = null
  // e mostra automaticamente a tela de login (v-if="!authStore.isAuthenticated")
  // sem necessidade de location.reload() ou router.push()
}

// Provide global loading state
provide('globalLoading', globalLoading)
provide('loadingMessage', loadingMessage)

onMounted(async () => {
  await authStore.checkSession()
  safeRedirect()
  const socket = connectRealtime()
  
  onEvent('restaurante:status_loja', (data) => { storeOpen.value = data.status_loja })
  onEvent('restaurante:atualizado', async (data) => {
    // Recarregar features e logo quando ConfigView salvar
    if (data.features) {
      features.value = data.features
    }
    if (data.logo_base64) {
      logoUrl.value = data.logo_base64.startsWith('data:') ? data.logo_base64 : 'data:image/png;base64,' + data.logo_base64
    }
  })

  try {
    const { data } = await api.get('/restaurante')
    storeOpen.value = data.status_loja
    features.value = data.features || { salao: true, delivery: true }
    // Carregar logo
    if (data.logo_base64) {
      logoUrl.value = detectImgSrc(data.logo_base64)
    }
  } catch { /* ignore */ }

})

// Handler de navegação vindo de MesasView (irParaPedido)
function validarBase64Imagem(b64) {
  // CWE-79: validar que o base64 contém apenas caracteres válidos
  if (!b64 || typeof b64 !== 'string') return ''
  const trimmed = b64.trim()
  // Aceita apenas base64 padrão (com padding = ou ==) ou base64url (sem padding, com -_)
  const isValidBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)
  const isValidBase64Url = /^[A-Za-z0-9_-]+$/.test(trimmed)
  if (!isValidBase64 && !isValidBase64Url) {
    console.warn('[Logo] base64 inválido ignorado')
    return ''
  }
  return trimmed
}

function detectImgSrc(b64) {
  const limpo = validarBase64Imagem(b64)
  if (!limpo) return ''
  if (limpo.startsWith('/9j/')) return 'data:image/jpeg;base64,' + limpo
  if (limpo.startsWith('iVBORw0KGgo')) return 'data:image/png;base64,' + limpo
  if (limpo.startsWith('UklGR')) return 'data:image/webp;base64,' + limpo
  return 'data:image/png;base64,' + limpo
}

function handleMesaNavigate({ view, mesa }) {
  currentView = view
  filtroMesa.value = mesa
}

// Watch para recalcular rota se o cargo mudar
watch(() => authStore.user?.cargo, () => {
  safeRedirect()
})

// Watch para recalcular rota se features mudarem
watch(features, () => {
  safeRedirect()
}, { deep: true })
</script>

<style scoped>
.sidebar-group-label {
  padding: 0.5rem 1.25rem 0.25rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: rgba(255,255,255,0.35);
}

.sidebar-group-label.collapsed {
  opacity: 0;
  width: 0;
  height: 0;
  padding: 0;
  margin: 0;
  overflow: hidden;
  border: none;
}

.sidebar-logo-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 8px;
}

.cargo-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.cargo-badge.admin {
  background: #fef3c7;
  color: #92400e;
}

.cargo-badge.gerente {
  background: #dbeafe;
  color: #1e40af;
}

.cargo-badge.chef {
  background: #ede9fe;
  color: #5b21b6;
}

.cargo-badge.caixa {
  background: #dcfce7;
  color: #166534;
}

.status-dot-indicator {
  width: 8px;
  height: 8px;
}
</style>
