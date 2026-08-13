<template>
  <div class="kds-layout">
    <!-- Header Stats -->
    <div class="kds-header">
      <div class="kds-header-left">
        <h1><i-lucide-cooking-pot style="width:24px;height:24px" /> Cozinha</h1>
        <span class="kds-time">{{ currentTime }}</span>
      </div>
      <div class="kds-header-right">
        <div class="kds-stat pending">
          <span class="kds-stat-value">{{ pendingCount }}</span>
          <span class="kds-stat-label">Pendentes</span>
        </div>
        <div class="kds-stat prepping">
          <span class="kds-stat-value">{{ preppingCount }}</span>
          <span class="kds-stat-label">Preparando</span>
        </div>
        <div class="kds-stat ready">
          <span class="kds-stat-value">{{ readyCount }}</span>
          <span class="kds-stat-label">Prontos</span>
        </div>

        <!-- Sound toggle -->
        <button class="kds-sound-toggle" :class="{ muted: soundMuted }" @click="soundMuted = !soundMuted" :title="soundMuted ? 'Ativar som' : 'Desativar som'">
          <i-lucide-volume-2 v-if="!soundMuted" style="width:18px;height:18px" />
          <i-lucide-volume-x v-else style="width:18px;height:18px" />
        </button>
      </div>
    </div>

    <!-- Feedback Toast -->
    <div v-if="feedbackMsg" class="kds-toast" :class="feedbackMsg.tipo" @click="feedbackMsg = null">
      {{ feedbackMsg.texto }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="kds-loading">
      <div class="spinner" style="width:48px;height:48px;border:4px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;"></div>
      <p>Carregando pedidos...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="activeOrders.length === 0" class="kds-empty">
      <i-lucide-check-circle-2 style="width:64px;height:64px" />
      <h2>Todos os pedidos foram atendidos!</h2>
      <p>A cozinha está em dia. 🎉</p>
    </div>

    <!-- Orders Grid -->
    <div v-else class="kds-grid">
      <div
        v-for="order in activeOrders"
        :key="order.id"
        class="kds-card"
        :class="[order.status, { urgent: isUrgent(order) }]"
      >
        <!-- Card Header -->
        <div class="kds-card-header">
          <div class="kds-card-id">
            <span class="kds-card-num">{{ order.pedido_id }}</span>
            <span class="kds-card-origin" :class="order.origem">
              <i-lucide-store v-if="order.origem === 'salao'" style="width:14px;height:14px" />
              <i-lucide-store v-else-if="order.origem === 'retirada'" style="width:14px;height:14px" />
              <i-lucide-utensils v-else-if="order.origem === 'ifood'" style="width:14px;height:14px" />
              <i-lucide-truck v-else style="width:14px;height:14px" />
              {{ order.origem === 'salao' ? 'Salão' : (order.origem === 'retirada' ? 'Retirada' : (order.origem === 'ifood' ? 'iFood' : 'Delivery')) }}
            </span>
          </div>
          <div class="kds-card-timer" :class="{ urgent: isUrgent(order) }" :title="`Previsão que o cliente vê: ${timers[order.id]?.previsao}`">
            <i-lucide-clock style="width:16px;height:16px" />
            {{ timers[order.id]?.texto }} · prev. {{ timers[order.id]?.previsao }}
          </div>
        </div>

        <!-- Client Info -->
        <div class="kds-card-client">
          <span class="kds-card-client-name">{{ order.nome_cliente }}</span>
          <span v-if="order.mesa" class="kds-card-mesa">Mesa {{ order.mesa }}</span>
        </div>

        <!-- Items -->
        <div class="kds-card-items">
          <div v-for="item in order.itens" :key="item.id" class="kds-card-item">
            <span class="kds-item-qty">{{ item.quantidade }}x</span>
            <div class="kds-item-info">
              <span class="kds-item-name">{{ item.nome_produto }}</span>
              <div v-if="item.extras?.length" class="kds-item-extras">
                <span v-for="extra in item.extras" :key="extra.nome" class="kds-extra-tag">
                  + {{ extra.nome }}{{ extra.qty > 1 ? ` (${extra.qty})` : '' }}
                </span>
              </div>
              <div v-if="item.opcoes?.length" class="kds-item-extras">
                <span v-for="op in item.opcoes" :key="op.grupo + op.nome" class="kds-extra-tag kds-opcao-tag">
                  {{ op.grupo }}: {{ op.nome }}
                </span>
              </div>
              <div v-if="item.talheres != null" class="kds-item-extras">
                <span class="kds-extra-tag kds-talher-tag">🍴 {{ item.talheres ? 'Com talheres' : 'Sem talheres' }}</span>
              </div>
              <div v-if="item.observacao" class="kds-item-obs">📝 {{ item.observacao }}</div>
            </div>
          </div>
        </div>

        <!-- Observações -->
        <div v-if="order.observacoes" class="kds-card-obs">
          <i-lucide-pen-line style="width:14px;height:14px" />
          {{ order.observacoes }}
        </div>

        <!-- Actions -->
        <div class="kds-card-actions">
          <template v-if="order.status === 'pendente'">
            <button class="kds-btn kds-btn-accept" @click="aceitarPedido(order)">
              <i-lucide-check style="width:18px;height:18px" />
              Aceitar & Preparar
            </button>
          </template>
          <template v-if="order.status === 'preparando'">
            <button class="kds-btn kds-btn-ready" @click="finalizarPedido(order)">
              <i-lucide-circle-check-big style="width:18px;height:18px" />
              Pronto!
            </button>
          </template>

        </div>
      </div>
    <!-- New Order Toast (sound notification banner) -->
    <div v-if="newOrderToast" class="kds-new-order-overlay" @click="aceitarPedido(newOrderToast)" @mouseleave="dismissNewOrderToast">
      <button class="kds-new-order-close" @click.stop="dismissNewOrderToast">&times;</button>
      <div class="kds-new-order-header">
        <i-lucide-bell-ring style="width:20px;height:20px" />
        <strong>Novo Pedido!</strong>
        <span class="kds-card-origin" :class="newOrderToast.origem" style="margin-left:auto;">
          <i-lucide-store v-if="newOrderToast.origem === 'salao'" style="width:12px;height:12px" />
          <i-lucide-store v-else-if="newOrderToast.origem === 'retirada'" style="width:12px;height:12px" />
          <i-lucide-utensils v-else-if="newOrderToast.origem === 'ifood'" style="width:12px;height:12px" />
          <i-lucide-truck v-else style="width:12px;height:12px" />
          {{ newOrderToast.origem === 'salao' ? 'Salão' : (newOrderToast.origem === 'retirada' ? 'Retirada' : (newOrderToast.origem === 'ifood' ? 'iFood' : 'Delivery')) }}
        </span>
      </div>
      <div class="kds-new-order-id">{{ newOrderToast.pedido_id }}</div>
      <div class="kds-new-order-client">
        {{ newOrderToast.nome_cliente }}
        <span v-if="newOrderToast.mesa" style="font-weight:700;color:var(--purple);font-size:0.75rem;"> — Mesa {{ newOrderToast.mesa }}</span>
      </div>
      <div class="kds-new-order-items">
        {{ newOrderToast.itens?.slice(0, 3).map(i => `${i.quantidade}x ${i.nome_produto}`).join(', ') }}
        <span v-if="newOrderToast.itens?.length > 3"> e mais {{ newOrderToast.itens.length - 3 }} item(ns)</span>
      </div>
    </div>
  </div>
</div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'
import api from '../services/api'
import { onEvent } from '../services/realtime'
import { calcularTimerPedido, textoRestante } from '../utils/tempo'

const globalLoading = inject('globalLoading')
const loadingMessage = inject('loadingMessage')

const feedbackMsg = ref(null)
function showFeedback(texto, tipo = 'erro') {
  feedbackMsg.value = { texto, tipo }
  setTimeout(() => { feedbackMsg.value = null }, 3000)
}

const orders = ref([])
const loading = ref(true)
const currentTime = ref('')
const nowTick = ref(Date.now())
const soundMuted = ref(false)
const newOrderToast = ref(null)
let timeInterval = null
let pollingInterval = null
let newOrderTimer = null

// Computed
const pendingCount = computed(() => orders.value.filter(o => o.status === 'pendente').length)
const preppingCount = computed(() => orders.value.filter(o => o.status === 'preparando').length)
const readyCount = computed(() => orders.value.filter(o => o.status === 'pronto_entrega').length)

const activeOrders = computed(() => {
  // Show: pendente, preparando, pronto_entrega — ordered by time (oldest first)
  // Salão sai do KDS ao ficar pronto
  // Delivery: pendente → preparando → pronto_entrega
  return orders.value
    .filter(o => ['pendente', 'preparando', 'pronto_entrega'].includes(o.status))
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
})

function isUrgent(order) {
  const mins = (Date.now() - new Date(order.criado_em).getTime()) / 60000
  return mins > 15
}

// Timer no formato do cliente (countdown + previsão), tick a cada 1s
const timers = computed(() => {
  const map = {}
  const agora = nowTick.value
  for (const o of orders.value) {
    const t = calcularTimerPedido(o, agora)
    if (t) map[o.id] = { texto: textoRestante(t), previsao: t.previsao }
  }
  return map
})

// ─── Sound Alert System ───
function playNotificationSound() {
  if (soundMuted.value) return
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const now = audioCtx.currentTime

    // Três notas ascendentes: Dó, Mi, Sol — som agradável de notificação
    const notes = [523.25, 659.25, 783.99]
    const duration = 0.12
    const gap = 0.1

    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.3, now + i * (duration + gap))
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * (duration + gap) + duration)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start(now + i * (duration + gap))
      osc.stop(now + i * (duration + gap) + duration)
    })

    // Leve ruído percussivo para dar "presença" ao som
    const bufferSize = audioCtx.sampleRate * 0.05
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.1))
    }
    const noise = audioCtx.createBufferSource()
    noise.buffer = buffer
    const noiseGain = audioCtx.createGain()
    noiseGain.gain.setValueAtTime(0.08, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
    noise.connect(noiseGain)
    noiseGain.connect(audioCtx.destination)
    noise.start(now)
    noise.stop(now + 0.05)
  } catch (e) {
    // Web Audio API não disponível — ignora silenciosamente
  }
}

// ─── Toast de novo pedido ───
function showNewOrderToast(order) {
  if (newOrderTimer) clearTimeout(newOrderTimer)
  newOrderToast.value = order
  newOrderTimer = setTimeout(() => { newOrderToast.value = null }, 5000)
}

function dismissNewOrderToast() {
  newOrderToast.value = null
  if (newOrderTimer) clearTimeout(newOrderTimer)
}

async function loadOrders() {
  try {
    const { data } = await api.get('/pedidos', {
      params: { limit: 100 }
    })
    orders.value = data
  } catch {
    // silent
  } finally {
    loading.value = false
  }
}

async function aceitarPedido(order) {
  globalLoading.value = true
  loadingMessage.value = 'Aceitando pedido...'
  try {
    await api.patch(`/pedidos/${order.id}/status`, { status: 'preparando' })
    showFeedback(`✅ Pedido ${order.pedido_id} em preparo!`, 'success')
    await loadOrders()
  } catch (err) {
    showFeedback(err.response?.data?.error || 'Erro ao aceitar pedido', 'erro')
  } finally {
    globalLoading.value = false
  }
}

async function finalizarPedido(order) {
  globalLoading.value = true
  loadingMessage.value = 'Finalizando pedido...'
  try {
    const newStatus = order.origem === 'salao' ? 'pronto' : 'pronto_entrega'
    await api.patch(`/pedidos/${order.id}/status`, { status: newStatus })
    showFeedback(`✅ Pedido ${order.pedido_id} pronto!`, 'success')
    await loadOrders()
  } catch (err) {
    showFeedback(err.response?.data?.error || 'Erro ao finalizar pedido', 'erro')
  } finally {
    globalLoading.value = false
  }
}

function updateTime() {
  currentTime.value = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  nowTick.value = Date.now()
}

onMounted(() => {
  loadOrders()
  updateTime()
  timeInterval = setInterval(updateTime, 1000)

  // Real-time updates
  onEvent('pedido:novo', (novoPedido) => {
    playNotificationSound()
    showNewOrderToast(novoPedido)
    loadOrders()
  })

  onEvent('pedido:atualizado', () => {
    loadOrders()
  })

  // Polling fallback every 8s
  pollingInterval = setInterval(loadOrders, 8000)
})

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval)
  if (pollingInterval) clearInterval(pollingInterval)
  if (newOrderTimer) clearTimeout(newOrderTimer)
})
</script>

<style scoped>
.kds-layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: calc(100vh - 120px);
  overflow: hidden;
}

/* ── Header ── */
.kds-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem 1.5rem;
  flex-shrink: 0;
}

.kds-header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.kds-header-left h1 {
  font-size: 1.3rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  letter-spacing: -0.3px;
}
.kds-time {
  font-size: 1.5rem;
  font-weight: 300;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.kds-header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.kds-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  min-width: 80px;
}
.kds-stat.pending {
  background: var(--warning-light);
}
.kds-stat.prepping {
  background: var(--info-light);
}
.kds-stat.ready {
  background: var(--success-light);
}
.kds-stat-value {
  font-size: 1.5rem;
  font-weight: 800;
  line-height: 1;
}
.kds-stat.pending .kds-stat-value { color: #92400e; }
.kds-stat.prepping .kds-stat-value { color: #1e40af; }
.kds-stat.ready .kds-stat-value { color: #166534; }

.kds-stat-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-top: 2px;
}

/* ── Sound Toggle ── */
.kds-sound-toggle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: var(--transition);
  color: var(--text-muted);
}
.kds-sound-toggle:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--error-light);
}
.kds-sound-toggle.muted {
  background: var(--border-light);
  color: var(--text-muted);
  opacity: 0.6;
}

/* ── Toast ── */
.kds-toast {
  position: fixed;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-sm);
  font-size: 1rem;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  animation: slideDown 0.3s ease;
  cursor: pointer;
}
.kds-toast.success {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}
.kds-toast.erro {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}
@keyframes slideDown {
  from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ── New Order Toast ── */
.kds-new-order-overlay {
  position: fixed;
  top: 4rem;
  right: 1.5rem;
  z-index: 9998;
  background: white;
  border: 2px solid var(--primary);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(220,38,38,0.25);
  padding: 1rem 1.25rem;
  max-width: 360px;
  animation: slideInRight 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55);
  cursor: pointer;
}
@keyframes slideInRight {
  from { opacity: 0; transform: translateX(100px); }
  to { opacity: 1; transform: translateX(0); }
}
.kds-new-order-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.kds-new-order-header svg {
  color: var(--primary);
}
.kds-new-order-header strong {
  font-size: 0.9rem;
}
.kds-new-order-id {
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--primary);
}

.kds-new-order-client {
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 0.35rem;
}
.kds-new-order-items {
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.kds-new-order-close {
  position: absolute;
  top: 6px;
  right: 8px;
  background: none;
  border: none;
  font-size: 1.1rem;
  cursor: pointer;
  color: var(--text-muted);
  line-height: 1;
  padding: 2px;
}

/* ── Loading & Empty ── */
.kds-loading,
.kds-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-muted);
}
.kds-empty h2 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--success);
}
.kds-empty p {
  font-size: 1rem;
}
.kds-empty svg {
  color: var(--success);
}

/* ── Orders Grid ── */
.kds-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
  overflow-y: auto;
  padding: 2px;
  flex: 1;
  align-content: start;
}

/* ── Card ── */
.kds-card {
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}
.kds-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
}
.kds-card.pendente::before {
  background: var(--warning);
}
.kds-card.preparando::before {
  background: var(--info);
}
.kds-card.pronto_entrega::before {
  background: var(--success);
}
.kds-card.urgent::before {
  background: var(--error);
  animation: pulseBar 1.5s ease-in-out infinite;
}
@keyframes pulseBar {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.kds-card.urgent {
  border-color: var(--error);
  box-shadow: 0 0 0 2px rgba(239,68,68,0.15);
}
.kds-card.pendente {
  border-left-color: var(--warning);
}
.kds-card.preparando {
  border-left-color: var(--info);
}
.kds-card.pronto_entrega {
  border-left-color: var(--success);
  opacity: 0.85;
}

/* Card Header */
.kds-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.kds-card-id {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.kds-card-num {
  font-size: 1.3rem;
  font-weight: 800;
  letter-spacing: -0.3px;
}
.kds-card-origin {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.kds-card-origin.salao {
  background: #ede9fe;
  color: #5b21b6;
}
.kds-card-origin.delivery {
  background: #dbeafe;
  color: #1e40af;
}
.kds-card-origin.ifood {
  background: #ffedd5;
  color: #c2410c;
}
.kds-card-timer {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 1.1rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
.kds-card-timer.urgent {
  color: var(--error);
  animation: pulseText 1.5s ease-in-out infinite;
}
@keyframes pulseText {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Client */
.kds-card-client {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.kds-card-client-name {
  font-size: 1rem;
  font-weight: 700;
}
.kds-card-mesa {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--purple-light);
  color: #5b21b6;
}

/* Items */
.kds-card-items {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.kds-card-item {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}
.kds-item-qty {
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--primary);
  min-width: 32px;
  flex-shrink: 0;
}
.kds-item-info {
  flex: 1;
  min-width: 0;
}
.kds-item-name {
  font-size: 0.95rem;
  font-weight: 600;
}
.kds-item-extras {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}
.kds-extra-tag {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--border-light);
  color: var(--text-secondary);
}

.kds-talher-tag {
  background: #fef3c7;
  color: #92400e;
}
.kds-item-obs {
  font-size: 0.78rem;
  font-style: italic;
  color: #92400e;
  background: var(--warning-light);
  border-radius: 3px;
  padding: 2px 6px;
  margin-top: 3px;
}

/* Observações */
.kds-card-obs {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.85rem;
  padding: 0.5rem 0.65rem;
  background: var(--warning-light);
  border-radius: var(--radius-xs);
  color: #92400e;
  font-weight: 500;
  line-height: 1.3;
}

/* Actions */
.kds-card-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: auto;
}
.kds-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
  font-size: 0.95rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.kds-btn:active {
  transform: scale(0.97);
}
.kds-btn-accept {
  background: var(--info);
  color: white;
}
.kds-btn-accept:hover {
  background: #2563eb;
  box-shadow: 0 4px 12px rgba(59,130,246,0.35);
}
.kds-btn-ready {
  background: var(--success);
  color: white;
}
.kds-btn-ready:hover {
  background: #15803d;
  box-shadow: 0 4px 12px rgba(22,163,74,0.35);
}

</style>
