<template>
  <div class="app">
    <!-- Store Closed Banner -->
    <div v-if="!storeOpen" class="store-closed-banner">
      <i-lucide-clock style="width:16px;height:16px" />
      Loja Fechada no momento — novos pedidos não podem ser realizados
    </div>

    <!-- Countdown Banner (5 min antes de fechar) -->
    <div v-if="mostrarContagemRegressiva" class="countdown-banner">
      <div class="countdown-pulse"></div>
      <i-lucide-alarm-clock style="width:18px;height:18px;flex-shrink:0;" />
      <span class="countdown-text">
        ⏰ A loja fecha em <strong>{{ tempoRestanteFormatado }}</strong>! Faça seu pedido agora.
      </span>
    </div>

    <!-- Main Content -->
    <main :class="{ 'main-cart-open': showCart }">
      <router-view
        @update:cart="updateCart"
        @show-cart="showCartDrawer = true"
      />
    </main>

    <!-- Bottom Navigation (esconde ao rolar para baixo) -->
    <nav class="bottom-nav" :class="{ hidden: navHidden }">
      <button
        class="bottom-nav-item"
        :class="{ active: $route.name === 'Home' }"
        @click="$router.push('/')"
      >
        <i-lucide-home style="width:20px;height:20px" />
        Início
      </button>
      <button
        class="bottom-nav-item"
        :class="{ active: $route.name === 'Orders' || $route.name === 'OrderTracking' }"
        @click="$router.push('/pedidos')"
      >
        <i-lucide-receipt style="width:20px;height:20px" />
        Pedidos
        <span v-if="unreadMessages" class="badge">{{ unreadMessages }}</span>
      </button>
      <button
        class="bottom-nav-item"
        :class="{ active: $route.name === 'Profile' }"
        @click="$router.push(authStore.isAuthenticated ? '/perfil' : '/auth')"
      >
        <i-lucide-user style="width:20px;height:20px" />
        Perfil
      </button>
    </nav>

    <!-- Cart Bar -->
    <div v-if="showCart" class="cart-bar" :class="{ bump: cartBump }">
      <div class="cart-bar-left" @click="openCart">
        <i-lucide-shopping-bag style="width:20px;height:20px" />
        <span>{{ cartTotalItens }} {{ cartTotalItens === 1 ? 'item' : 'itens' }}</span>
      </div>
      <div class="cart-bar-right">
        <button class="btn-cart-view" @click="openCart">
          <i-lucide-eye style="width:16px;height:16px" /> Ver
        </button>
        <button class="btn-cart-checkout" @click="checkoutCart">
          <i-lucide-arrow-right style="width:16px;height:16px" /> Checkout
        </button>
      </div>
    </div>

    <!-- Checkout Drawer -->
    <div class="drawer-overlay" :class="{ open: showCartDrawer }" @click="showCartDrawer = false"></div>
    <div class="checkout-drawer" :class="{ open: showCartDrawer }">
      <div class="drawer-handle"></div>
      <div class="drawer-header">
        <h3>Sua Sacola</h3>
        <button class="drawer-close" @click="showCartDrawer = false">&times;</button>
      </div>
      <CheckoutPanel @close="showCartDrawer = false" />
    </div>

    <!-- CEP Modal -->
    <CepOnboarding v-if="showCepModal" @close="showCepModal = false" />

    <!-- Toast Container -->
    <div class="toast-container">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
        :class="[toast.type, { clickable: toast.onClick || toastListeners.has('click') }]"
        @click="handleToastClick(toast)"
      >
        <component :is="toastIcons[toast.type] || toastIcons.info" style="width:16px;height:16px" />
        {{ toast.message }}
      </div>
    </div>

    <!-- Loading Overlay -->
    <div v-if="globalLoading" class="loading-overlay">
      <div class="spinner"></div>
      <span class="loading-text">{{ loadingMessage }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, provide, onMounted, onUnmounted, nextTick, markRaw } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { connectRealtime, onEvent, offEvent } from './services/realtime'
import CheckoutPanel from './components/CheckoutPanel.vue'
import CepOnboarding from './components/CepOnboarding.vue'
import * as pushService from './services/push.js'
import { Clock, Home, Receipt, User, ShoppingBag, Eye, ArrowRight, CheckCircle, XCircle, TriangleAlert, Info } from 'lucide-vue-next'
import api from './services/api'

const authStore = useAuthStore()
const $router = useRouter()

// Store state
// Estado EFETIVO = toggle manual (status_loja) E janela de horários.
// O toggle manual TEM PRIORIDADE: fechado manualmente → continua fechado mesmo
// dentro do horário (o intervalo de 30s não reabre). Os horários só podem fechar.
const statusLojaManual = ref(true)
const horariosAbertos = ref(true)
const storeOpen = computed(() => statusLojaManual.value && horariosAbertos.value)
const cartItems = ref([])
const showCartDrawer = ref(false)
const showCepModal = ref(false)
const unreadMessages = ref(0)

// Restaurant data for pickup (retirada)
const restaurantData = ref({ endereco: '', cidade: '', estado: '', retirada_habilitada: false, horarios_funcionamento: [], timezone: 'America/Sao_Paulo' })

// ── Hora local do restaurante (os horários cadastrados são no fuso dele) ──
// Usa Intl.DateTimeFormat com timeZone explícita — não depende do relógio do
// navegador nem do servidor (que roda em UTC).
function agoraNoFusoRestaurante(timeZone = 'America/Sao_Paulo') {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const partes = fmt.formatToParts(new Date())
  const get = (t) => partes.find(p => p.type === t)?.value
  const diaMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  let hora = parseInt(get('hour') || '0', 10)
  if (hora === 24) hora = 0 // Intl pode retornar "24" para meia-noite
  return {
    diaSemana: diaMap[get('weekday')] ?? new Date().getDay(),
    minutos: hora * 60 + parseInt(get('minute') || '0', 10),
  }
}

// ── Verificação automática de horários de funcionamento ──
function restauranteAbertoAgora(horarios, timeZone = 'America/Sao_Paulo') {
  if (!Array.isArray(horarios) || horarios.length !== 7) return true // sem dados = aberto
  const { diaSemana, minutos: minutosAgora } = agoraNoFusoRestaurante(timeZone)
  const dia = horarios[diaSemana]
  if (!dia || !dia.aberto) return false
  const [ah, am] = (dia.abre || '08:00').split(':').map(Number)
  const [fh, fm] = (dia.fecha || '23:00').split(':').map(Number)
  const minutosAbre = (ah || 0) * 60 + (am || 0)
  const minutosFecha = (fh || 0) * 60 + (fm || 0)
  // Se fecha <= abre (ex: 22:00 às 02:00), considera overnight
  if (minutosFecha <= minutosAbre) {
    return minutosAgora >= minutosAbre || minutosAgora <= minutosFecha
  }
  return minutosAgora >= minutosAbre && minutosAgora <= minutosFecha
}

// ── Contagem regressiva para fechar ──
const minutosRestantes = ref(null)
const mostrarContagemRegressiva = computed(() => {
  return storeOpen.value && minutosRestantes.value !== null && minutosRestantes.value <= 5 && minutosRestantes.value > 0
})
const tempoRestanteFormatado = computed(() => {
  if (minutosRestantes.value === null || minutosRestantes.value <= 0) return ''
  const mins = minutosRestantes.value
  if (mins <= 1) return 'menos de 1 minuto'
  return `${mins} minuto${mins > 1 ? 's' : ''}`
})

function calcularMinutosAteFechar(horarios, timeZone = 'America/Sao_Paulo') {
  if (!Array.isArray(horarios) || horarios.length !== 7) return null
  const { diaSemana, minutos: minutosAgora } = agoraNoFusoRestaurante(timeZone)
  const dia = horarios[diaSemana]
  if (!dia || !dia.aberto) return 0
  const [ah, am] = (dia.abre || '08:00').split(':').map(Number)
  const [fh, fm] = (dia.fecha || '23:00').split(':').map(Number)
  const minutosAbre = (ah || 0) * 60 + (am || 0)
  const minutosFecha = (fh || 0) * 60 + (fm || 0)
  // Overnight: se agora > fecha, loja já fechou
  if (minutosFecha <= minutosAbre) {
    // Fecha amanhã → calcular a partir de agora até meia-noite + fecha
    if (minutosAgora > minutosFecha) {
      return (1440 - minutosAgora) + minutosFecha // até meia-noite + hora de fechar
    }
    return minutosFecha - minutosAgora
  }
  return minutosFecha - minutosAgora
}

let horariosInterval = null
function iniciarVerificacaoHorarios() {
  if (horariosInterval) clearInterval(horariosInterval)
  horariosInterval = setInterval(() => {
    if (restaurantData.value.horarios_funcionamento.length === 7) {
      // Só recalcula a JANELA DE HORÁRIOS — nunca sobrescreve o toggle manual
      horariosAbertos.value = restauranteAbertoAgora(restaurantData.value.horarios_funcionamento, restaurantData.value.timezone)
      minutosRestantes.value = calcularMinutosAteFechar(restaurantData.value.horarios_funcionamento, restaurantData.value.timezone)
    }
  }, 30000) // Verifica a cada 30 segundos (precisão para contagem regressiva)
}

// Navbar scroll hide
const navHidden = ref(false)
let lastScrollY = 0
let scrollTick = false

function handleScroll() {
  if (scrollTick) return
  scrollTick = true
  requestAnimationFrame(() => {
    const currentScrollY = window.scrollY
    if (currentScrollY > lastScrollY && currentScrollY > 60) {
      navHidden.value = true
    } else {
      navHidden.value = false
    }
    lastScrollY = currentScrollY
    scrollTick = false
  })
}

// Global loading
const globalLoading = ref(false)
const loadingMessage = ref('Carregando...')

// Toast notifications
const toasts = ref([])
let toastId = 0

const toastListeners = new Map()

function addToastListener(event, callback) {
  const id = Date.now() + Math.random()
  toastListeners.set(id, { event, callback })
  return () => toastListeners.delete(id)
}

function addToast(message, type = 'info', onClick) {
  const id = ++toastId
  toasts.value.push({ id, message, type, onClick })
  setTimeout(() => removeToast(id), 4000)
  return id
}

function handleToastClick(toast) {
  if (toast.onClick) toast.onClick()
  if (toastListeners.has('click')) {
    toastListeners.get('click').callback()
  }
  removeToast(toast.id)
}

function removeToast(id) {
  toasts.value = toasts.value.filter(t => t.id !== id)
}

const toastIcons = {
  success: markRaw(CheckCircle),
  error: markRaw(XCircle),
  warning: markRaw(TriangleAlert),
  info: markRaw(Info),
}

// Cart
const showCart = computed(() => cartItems.value.length > 0)
const cartTotalItens = computed(() =>
  cartItems.value.reduce((acc, item) => acc + item.quantidade, 0)
)
const cartBump = ref(false)
let bumpTimer = null

async function triggerCartBump() {
  if (bumpTimer) clearTimeout(bumpTimer)
  cartBump.value = false
  await nextTick()
  cartBump.value = true
  bumpTimer = setTimeout(() => {
    cartBump.value = false
  }, 350)
}
const cartTotal = computed(() =>
  cartItems.value.reduce((acc, item) => acc + (parseFloat(item.subtotal) || 0), 0)
)

function formatPrice(value) {
  const num = parseFloat(value) || 0
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(num)
}

function updateCart(items) {
  // Garantir que subtotais sejam números
  const normalized = items.map(item => ({
    ...item,
    subtotal: parseFloat(item.subtotal) || 0,
    preco_unitario: parseFloat(item.preco_unitario) || 0,
  }))
  cartItems.value = normalized
  // Save to localStorage
  localStorage.setItem('saborexpress_cart', JSON.stringify(normalized))
}

function restoreCart() {
  const saved = localStorage.getItem('saborexpress_cart')
  if (saved) {
    try {
      const items = JSON.parse(saved)
      cartItems.value = items.map(item => ({
        ...item,
        subtotal: parseFloat(item.subtotal) || 0,
        preco_unitario: parseFloat(item.preco_unitario) || 0,
      }))
    } catch { /* Ignore */ }
  }
}

// Abrir carrinho: mostra os itens mesmo sem login
function openCart() {
  showCartDrawer.value = true
}

// Checkout: força login se não estiver autenticado
function checkoutCart() {
  if (!authStore.isAuthenticated) {
    addToast('Faça login para finalizar seu pedido.', 'info')
    $router.push('/auth')
    return
  }
  showCartDrawer.value = true
}

// Provide to children
provide('cartItems', cartItems)
provide('updateCart', updateCart)
provide('cartTotal', cartTotal)
provide('addToast', addToast)
provide('triggerCartBump', triggerCartBump)
provide('globalLoading', globalLoading)
provide('loadingMessage', loadingMessage)
provide('showCepModal', showCepModal)
provide('storeOpen', storeOpen)
provide('restaurantData', restaurantData)

onMounted(async () => {
  window.addEventListener('scroll', handleScroll, { passive: true })
  await authStore.checkSession()
  restoreCart()

  // CEP Onboarding: perguntar CEP na primeira visita
  const cepSalvo = localStorage.getItem('saborexpress_cep')
  if (!cepSalvo) {
    // Mostrar modal após um breve delay para não atrapalhar renderização
    setTimeout(() => {
      showCepModal.value = true
    }, 800)
  }

  // Conectar WebSocket
  const socket = connectRealtime()

  // Listeners
  onEvent('restaurante:status_loja', (data) => {
    statusLojaManual.value = data.status_loja
  })

  onEvent('pedido:atualizado', (data) => {
    if (data.cliente_id === authStore.user?.id) {
      addToast(`Pedido ${data.pedido_id}: ${statusLabel(data.status)}`, 'info')
    }
  })

  onEvent('mensagem:novo', () => {
    unreadMessages.value++
    addToast('💬 Nova mensagem da cozinha!', 'warning')
  })    // Check store status & apply theme colors
    try {
      const { data } = await api.get('/restaurante')
      restaurantData.value = {
        endereco: data.endereco || '',
        cidade: data.cidade || '',
        estado: data.estado || '',
        retirada_habilitada: data.retirada_habilitada || false,
        horarios_funcionamento: data.horarios_funcionamento || [],
        timezone: data.timezone || 'America/Sao_Paulo',
      }
      // Toggle manual (status_loja) é a fonte primária; os horários de
      // funcionamento (quando configurados) só podem fechar a loja.
      statusLojaManual.value = data.status_loja
      if (Array.isArray(data.horarios_funcionamento) && data.horarios_funcionamento.length === 7) {
        horariosAbertos.value = restauranteAbertoAgora(data.horarios_funcionamento, restaurantData.value.timezone)
        minutosRestantes.value = calcularMinutosAteFechar(data.horarios_funcionamento, restaurantData.value.timezone)
        iniciarVerificacaoHorarios()
      } else {
        horariosAbertos.value = true
      }

    // Aplicar cores do tema dinamicamente (CWE-79: validar formato hex antes de injetar no CSS)
    const root = document.documentElement
    const corPrimaria = validarCorHex(data.cor_primaria)
    const corSecundaria = validarCorHex(data.cor_secundaria)
    const corTerciaria = validarCorHex(data.cor_terciaria)
    if (corPrimaria) {
      root.style.setProperty('--primary', corPrimaria)
      root.style.setProperty('--primary-dark', adjustColor(corPrimaria, -20))
      root.style.setProperty('--primary-light', hexToRgba(corPrimaria, 0.12))
    }
    if (corSecundaria) {
      root.style.setProperty('--secondary', corSecundaria)
    }
    if (corTerciaria) {
      root.style.setProperty('--info', corTerciaria)
      root.style.setProperty('--info-light', hexToRgba(corTerciaria, 0.12))
    }
  } catch { /* Ignore */ }

    // PWA: Solicitar permissão de notificações após login
  if (authStore.isAuthenticated) {
    setTimeout(() => pedirPermissaoNotificacao(), 3000)
  }
})

// PWA: Pedir permissão de notificação push (não-bloqueante)
async function pedirPermissaoNotificacao() {
  if (!pushService.pushSupported()) return
  if (pushService.permissionStatus() === 'granted') return
  if (pushService.permissionStatus() === 'denied') return
  if (localStorage.getItem('saborexpress_push_declined')) return

  // Mostrar toast convidativo para ativar notificações
  addToast('🔔 Ative notificações para saber quando seu pedido ficar pronto! Toque aqui.', 'info')

  // Escuta o próximo toast click para ativar (fire once)
  let subscribed = false
  const unsubscribe = addToastListener('click', async () => {
    if (subscribed) return
    subscribed = true
    unsubscribe()
    const result = await pushService.subscribeToPush()
    if (result.sucesso) {
      addToast('🔔 Notificações ativadas com sucesso!', 'success')
    } else if (result.erro !== 'Permissão de notificação negada.') {
      addToast('Não foi possível ativar notificações.', 'warning')
    }
  })

  // Remove listener após 15s se não clicar
  setTimeout(unsubscribe, 15000)
}

function statusLabel(status) {
  const labels = {
    pendente: 'Aguardando confirmação',
    preparando: 'Sendo preparado',
    pronto_entrega: 'Saiu para entrega',
    em_transito: 'Entregador a caminho',
    cheguei_destino: 'Entregador chegou',
    entregue: 'Entregue',
    cancelado: 'Cancelado',
  }
  return labels[status] || status
}

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
  if (horariosInterval) clearInterval(horariosInterval)
})

// ── Helpers de cor (CWE-79: validar formato hex antes de usar) ──
function validarCorHex(value) {
  // Aceita hex de 3, 6 ou 8 dígitos (#RGB, #RRGGBB, #RRGGBBAA)
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^#[0-9a-fA-F]{8}$/.test(trimmed) &&
      !/^#[0-9a-fA-F]{6}$/.test(trimmed) &&
      !/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    console.warn('[Tema] Cor inválida ignorada:', value)
    return null
  }
  return trimmed
}

function adjustColor(hex, percent) {
  // Escurece (percent negativo) ou clareia (percent positivo) uma cor hex
  // Descarta canal alpha (#RRGGBBAA -> #RRGGBB) se presente
  const cleanHex = hex.replace('#', '').slice(0, 6)
  const num = parseInt(cleanHex, 16)
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xFF) + percent))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xFF) + percent))
  const b = Math.min(255, Math.max(0, (num & 0xFF) + percent))
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

function hexToRgba(hex, alpha) {
  // Descarta canal alpha (#RRGGBBAA -> #RRGGBB) se presente
  const cleanHex = hex.replace('#', '').slice(0, 6)
  const num = parseInt(cleanHex, 16)
  const r = (num >> 16) & 0xFF
  const g = (num >> 8) & 0xFF
  const b = num & 0xFF
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
</script>
