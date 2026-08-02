<template>
  <div>
    <div style="display:flex;justify-content:space-between;margin-bottom:0.75rem;align-items:center;">
      <h2 style="font-size:1.2rem;">🪑 Mesas do Salão</h2>
      <span style="font-size:0.85rem;color:var(--text-muted);">
        {{ mesas.filter(m => estaOcupada(m)).length }} ocupadas de {{ mesas.length }}
      </span>
    </div>

    <!-- Legend & Config Link -->
    <div class="mesa-legend">
      <span class="legend-item"><span class="legend-dot ocupada"></span> Ocupada</span>
      <span class="legend-item"><span class="legend-dot livre"></span> Livre</span>
      <span class="legend-item"><span class="legend-dot reservada"></span> Reservada</span>
      <span class="legend-item"><span class="legend-dot inativa"></span> Inativa</span>
      <!-- Timer tick oculto para forçar re-render do contador a cada 30s -->
      <span style="display:none">{{ timerTick }}</span>
      <a class="config-link" @click="irParaConfig" style="margin-left:auto;font-size:0.8rem;cursor:pointer;">
        <i-lucide-settings style="width:14px;height:14px" /> Gerenciar Mesas
      </a>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card" style="text-align:center;padding:3rem;">
      <div class="spinner" style="margin:0 auto;width:40px;height:40px;border:4px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;"></div>
      <p style="margin-top:1rem;color:var(--text-muted);">Carregando mesas...</p>
    </div>

    <!-- Error -->
    <div v-else-if="erro" class="card" style="text-align:center;padding:2rem;">
      <p style="color:var(--error);font-weight:600;">{{ erro }}</p>
      <button class="btn btn-primary btn-sm" style="margin-top:1rem;" @click="load">Tentar novamente</button>
    </div>

    <!-- Mesas Grid -->
    <div v-else class="mesas-grid">
      <div
        v-for="mesa in mesas"
        :key="mesa.id"
        class="mesa-card"
        :class="statusReal(mesa)"
        @click="abrirDetalhes(mesa)"
      >
        <div class="mesa-status-bar" :class="statusReal(mesa)"></div>
        <div class="mesa-body">
          <div class="mesa-nome">{{ mesa.nome }}</div>
          <div class="mesa-capacidade">
            <i-lucide-users style="width:14px;height:14px" /> até {{ mesa.capacidade }} pessoas
          </div>
          <div class="mesa-status-label" :class="statusReal(mesa)">
            {{ statusLabel(statusReal(mesa)) }}
          </div>
          <!-- Timer para mesas ocupadas -->
          <div v-if="statusReal(mesa) === 'ocupada'" class="mesa-timer">
            <i-lucide-clock style="width:12px;height:12px" />
            {{ calcularTempoMesa(mesa) }}
          </div>
          <!-- Botão de finalizar direto no card para mesas ocupadas -->
          <button v-if="statusReal(mesa) === 'ocupada'" class="mesa-card-checkout" @click.stop="abrirDetalhesECheckout(mesa)">
            <i-lucide-wallet style="width:14px;height:14px" /> Finalizar
          </button>
        </div>
      </div>
    </div>

    <!-- Mesa Detail Modal -->
    <div v-if="detalhesMesa" class="modal-overlay" @click.self="detalhesMesa = null">
      <div class="modal-content" style="max-width:420px;text-align:center;">
        <div class="mesa-detail-icon" :class="statusReal(detalhesMesa)">
          <i-lucide-utensils-crossed style="width:32px;height:32px" />
        </div>
        <h3 style="font-size:1.3rem;margin-top:0.5rem;">{{ detalhesMesa.nome }}</h3>
        <p style="color:var(--text-muted);">
          <i-lucide-users style="width:14px;height:14px" /> Capacidade: {{ detalhesMesa.capacidade }} pessoas
        </p>
        <div class="mesa-detail-status" :class="statusReal(detalhesMesa)">
          {{ statusLabel(statusReal(detalhesMesa)) }}
        </div>
        <div v-if="pedidosMesa.length && statusReal(detalhesMesa) === 'ocupada'" style="font-size:0.85rem;color:var(--text-muted);margin-top:4px;">
          <i-lucide-clock style="width:14px;height:14px" />
          {{ calcularTempoMesa(detalhesMesa) }} — {{ pedidosMesa.length }} pedido(s)
        </div>

        <!-- Pedidos ativos nesta mesa -->
        <div v-if="pedidosMesa.length" class="mesa-pedidos" style="margin-top:1rem;text-align:left;">
          <div class="profile-section-title">Pedidos na Mesa</div>
          <div v-for="pedido in pedidosMesa" :key="pedido.id" class="pedido-mini-card" @click="irParaPedido(pedido)">
            <strong>{{ pedido.pedido_id }}</strong>
            <span class="status-badge" :class="pedido.status">{{ statusLabel2(pedido.status) }}</span>
            <span style="margin-left:auto;font-weight:700;color:var(--primary);">{{ formatPrice(pedido.total) }}</span>
          </div>
          <!-- Total da Mesa -->
          <div class="mesa-total" style="margin-top:0.75rem;padding-top:0.75rem;border-top:2px solid var(--border);display:flex;justify-content:space-between;font-size:1rem;">
            <span style="font-weight:600;">💰 Total da Mesa</span>
            <span style="font-weight:800;color:var(--primary);">{{ formatPrice(totalMesa) }}</span>
          </div>
        </div>
        <div v-else style="margin-top:1rem;color:var(--text-muted);font-size:0.9rem;">
          Nenhum pedido ativo nesta mesa.
        </div>

        <div style="display:flex;gap:8px;margin-top:1.5rem;justify-content:center;flex-wrap:wrap;">
          <button v-if="pedidosMesa.length && statusReal(detalhesMesa) === 'ocupada'" class="btn btn-success" @click="abrirCheckout">
            <i-lucide-wallet style="width:16px;height:16px" /> 💰 Finalizar Conta
          </button>
          <button class="btn btn-primary" @click="irParaPedido(null)" :disabled="!pedidosMesa.length">
            🪑 Ver na Fila
          </button>
          <button class="btn btn-secondary" @click="detalhesMesa = null">Fechar</button>
        </div>
      </div>
    </div>

    <!-- Checkout Modal -->
    <div v-if="showCheckout" class="modal-overlay" @click.self="showCheckout = false">
      <div class="modal-content" style="max-width:480px;">
        <div style="text-align:center;margin-bottom:1rem;">
          <div style="width:56px;height:56px;border-radius:50%;background:#dcfce7;display:flex;align-items:center;justify-content:center;margin:0 auto 0.5rem;">
            <i-lucide-wallet style="width:28px;height:28px;color:#16a34a" />
          </div>
          <h3 style="font-size:1.2rem;">💰 Finalizar {{ mesaCheckout?.nome }}</h3>
          <p v-if="pedidosMesa.length" style="font-size:0.8rem;color:var(--text-muted);">
            {{ calcularTempoMesa(mesaCheckout) }} — {{ pedidosMesa.length }} pedido(s)
          </p>
        </div>

        <!-- Itens agrupados -->
        <div class="checkout-itens" style="margin-bottom:1rem;">
          <div class="profile-section-title" style="margin-bottom:0.5rem;">Itens Consumidos</div>
          <div v-for="pedido in pedidosMesa" :key="pedido.id" style="margin-bottom:0.75rem;">
            <div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);margin-bottom:4px;">
              {{ pedido.pedido_id }}
            </div>
            <div v-for="item in pedido.itens" :key="item.id" class="checkout-item-row">
              <span class="checkout-item-qty">{{ item.quantidade }}x</span>
              <span class="checkout-item-name">{{ item.nome_produto }}</span>
              <span v-if="item.extras?.length" class="checkout-item-extras">
                <span v-for="e in item.extras" :key="e.nome">+ {{ e.nome }}</span>
              </span>
              <span class="checkout-item-price">{{ formatPrice(item.subtotal) }}</span>
            </div>
          </div>
        </div>

        <!-- Total -->
        <div class="checkout-total" style="margin-bottom:1.25rem;padding-top:0.75rem;border-top:2px solid var(--border);display:flex;justify-content:space-between;font-size:1.15rem;">
          <span style="font-weight:700;">Total</span>
          <span style="font-weight:800;color:var(--primary);">{{ formatPrice(totalMesa) }}</span>
        </div>

        <!-- Payment Method -->
        <div class="form-group" style="margin-bottom:1.25rem;">
          <label style="font-weight:700;font-size:0.85rem;">Forma de Pagamento</label>
          <select v-model="checkoutPagamento" style="margin-top:6px;">
            <option value="conta">Conta</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="credito">Cartão de Crédito</option>
            <option value="debito">Cartão de Débito</option>
            <option value="pix">PIX</option>
          </select>
        </div>

        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" style="flex:1;justify-content:center;" @click="showCheckout = false">Voltar</button>
          <button class="btn btn-success" style="flex:1;justify-content:center;" @click="confirmarCheckout" :disabled="finalizando">
            {{ finalizando ? 'Finalizando...' : '✅ Confirmar Pagamento' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import api from '../services/api'
import { connectRealtime, onEvent, offEvent } from '../services/realtime'

const emit = defineEmits(['navigate'])

const mesas = ref([])
const pedidosAtivos = ref([])
const loading = ref(false)
const erro = ref('')
const detalhesMesa = ref(null)
const pedidosMesa = ref([])
const finalizando = ref(false)

// Checkout state
const showCheckout = ref(false)
const mesaCheckout = ref(null)
const checkoutPagamento = ref('conta')

// Timer tick (força re-render)
const timerTick = ref(0)
let timerInterval = null

const totalMesa = computed(() => {
  return pedidosMesa.value.reduce((acc, p) => acc + parseFloat(p.total || 0), 0)
})

function statusLabel(s) {
  const labels = { livre: 'Livre', ocupada: 'Ocupada', reservada: 'Reservada', inativa: 'Inativa' }
  return labels[s] || s
}

function statusLabel2(s) {
  const labels = { pendente: 'Pendente', preparando: 'Preparando', pronto: 'Pronto (Salão)', pronto_entrega: 'Pronto (Delivery)', finalizado: 'Finalizado', entregue: 'Entregue', cancelado: 'Cancelado', recusado: 'Recusado' }
  return labels[s] || s
}

function formatPrice(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) }

// Determina o status real da mesa baseado em pedidos ativos e status do banco
function estaOcupada(mesa) {
  if (!pedidosAtivos.value.length) return false
  return pedidosAtivos.value.some(p => p.mesa === mesa.nome)
}

function statusReal(mesa) {
  // Se o banco marcou como inativa, respeitar
  if (mesa.status === 'inativa') return 'inativa'
  if (mesa.status === 'reservada') return 'reservada'
  // Se tem pedidos ativos, está ocupada (independente do status no banco)
  if (estaOcupada(mesa)) return 'ocupada'
  // Caso contrário, livre
  return 'livre'
}

async function loadPedidosAtivos() {
  try {
    const { data } = await api.get('/pedidos', { params: { status: 'ativos', limit: 200 } })
    pedidosAtivos.value = data.filter(p => p.origem === 'salao' && p.mesa) || []
  } catch {
    pedidosAtivos.value = []
  }
}

async function loadPedidosMesa(mesa) {
  try {
    const { data } = await api.get('/pedidos', { params: { mesa: mesa.nome, limit: 20 } })
    pedidosMesa.value = data || []
  } catch {
    pedidosMesa.value = []
  }
}

async function load() {
  erro.value = ''
  loading.value = true
  try {
    const [mesasRes] = await Promise.all([
      api.get('/restaurante/mesas'),
      loadPedidosAtivos(),
    ])
    mesas.value = mesasRes.data
  } catch (err) {
    erro.value = 'Erro ao carregar mesas.'
    console.error(err)
  } finally { loading.value = false }
}

function abrirDetalhes(mesa) {
  detalhesMesa.value = mesa
  loadPedidosMesa(mesa)
}

function irParaPedido(/* pedido */) {
  const mesaNome = detalhesMesa.value?.nome
  if (!mesaNome) return
  detalhesMesa.value = null
  emit('navigate', { view: 'pedidos', mesa: mesaNome })
}

function abrirDetalhesECheckout(mesa) {
  abrirDetalhes(mesa)
}

function irParaConfig() {
  detalhesMesa.value = null
  emit('navigate', { view: 'config' })
}

// Timer: calcular tempo desde o pedido mais antigo da mesa
function calcularTempoMesa(mesa) {
  const pedidos = pedidosAtivos.value.filter(p => p.mesa === mesa.nome)
  if (!pedidos.length) return '—'
  // Pega o criado_em mais antigo
  const datas = pedidos.map(p => new Date(p.criado_em).getTime())
  const inicio = Math.min(...datas)
  const diff = Date.now() - inicio
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Agora'
  const horas = Math.floor(mins / 60)
  if (horas > 0) return `${horas}h ${mins % 60}min`
  return `${mins} min`
}

function abrirCheckout() {
  mesaCheckout.value = detalhesMesa.value
  checkoutPagamento.value = 'conta'
  showCheckout.value = true
}

async function confirmarCheckout() {
  if (!mesaCheckout.value || !pedidosMesa.value.length) return

  const nomeMesa = mesaCheckout.value.nome
  finalizando.value = true
  let ok = 0
  let falha = 0

  for (const pedido of pedidosMesa.value) {
    try {
      await api.patch(`/pedidos/${pedido.id}/status`, {
        status: 'finalizado',
        metodo_pagamento: checkoutPagamento.value,
      })
      ok++
    } catch {
      falha++
    }
  }

  showCheckout.value = false
  detalhesMesa.value = null
  mesaCheckout.value = null
  await load()
  finalizando.value = false

  if (falha === 0) {
    alert(`✅ ${nomeMesa} finalizada! ${ok} pedido(s) concluído(s).`)
  } else {
    alert(`⚠️ ${ok} finalizado(s), ${falha} falha(s).`)
  }
}

onMounted(async () => {
  // Conectar WebSocket para atualizações em tempo real
  connectRealtime()

  await load()

  // Timer: atualiza a cada 30s para refrescar o contador
  timerInterval = setInterval(() => {
    timerTick.value++
  }, 30000)

  // Recarregar quando um pedido for criado ou atualizado
  onEvent('pedido:novo', () => { load() })
  onEvent('pedido:atualizado', () => { load() })
})

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval)
  offEvent('pedido:novo')
  offEvent('pedido:atualizado')
})
</script>

<style scoped>
.mesas-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}

.mesa-card {
  background: var(--surface);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
  cursor: pointer;
  transition: all 0.2s ease;
}
.mesa-card:hover {
  box-shadow: var(--shadow);
  transform: translateY(-2px);
}

.mesa-status-bar {
  height: 4px;
}
.mesa-status-bar.livre { background: #22c55e; }
.mesa-status-bar.ocupada { background: #ef4444; }
.mesa-status-bar.reservada { background: #f59e0b; }
.mesa-status-bar.inativa { background: #94a3b8; }

.mesa-body {
  padding: 1rem;
}

.mesa-nome {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 0.25rem;
}

.mesa-capacidade {
  font-size: 0.8rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 0.5rem;
}

.mesa-status-label {
  display: inline-flex;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
}
.mesa-status-label.livre { background: #dcfce7; color: #166534; }
.mesa-status-label.ocupada { background: #fee2e2; color: #991b1b; }
.mesa-status-label.reservada { background: #fef3c7; color: #92400e; }
.mesa-status-label.inativa { background: #f1f5f9; color: #64748b; }

.mesa-legend {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  background: var(--surface);
  border-radius: 8px;
  border: 1px solid var(--border-light);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.legend-dot.livre { background: #22c55e; }
.legend-dot.ocupada { background: #ef4444; }
.legend-dot.reservada { background: #f59e0b; }
.legend-dot.inativa { background: #94a3b8; }

.config-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--primary);
  font-weight: 600;
  text-decoration: none;
  padding: 4px 10px;
  border-radius: 6px;
  transition: var(--transition);
}
.config-link:hover {
  background: var(--primary-light);
}

/* Detail Modal */
.mesa-detail-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
}
.mesa-detail-icon.livre { background: #dcfce7; color: #16a34a; }
.mesa-detail-icon.ocupada { background: #fee2e2; color: #dc2626; }
.mesa-detail-icon.reservada { background: #fef3c7; color: #d97706; }
.mesa-detail-icon.inativa { background: #f1f5f9; color: #94a3b8; }

.mesa-detail-status {
  display: inline-flex;
  padding: 4px 16px;
  border-radius: 999px;
  font-size: 0.9rem;
  font-weight: 700;
  margin-top: 0.75rem;
}
.mesa-detail-status.livre { background: #dcfce7; color: #166534; }
.mesa-detail-status.ocupada { background: #fee2e2; color: #991b1b; }
.mesa-detail-status.reservada { background: #fef3c7; color: #92400e; }
.mesa-detail-status.inativa { background: #f1f5f9; color: #64748b; }

.mesa-timer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
}

/* Checkout itens */
.checkout-item-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 4px 0;
  font-size: 0.82rem;
  border-bottom: 1px solid var(--border-light);
}
.checkout-item-row:last-child {
  border-bottom: none;
}
.checkout-item-qty {
  font-weight: 700;
  color: var(--text-secondary);
  min-width: 24px;
}
.checkout-item-name {
  flex: 1;
  font-weight: 600;
}
.checkout-item-extras {
  display: block;
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 400;
  margin-top: 1px;
}
.checkout-item-extras span {
  display: block;
}
.checkout-item-price {
  font-weight: 700;
  color: var(--primary);
  white-space: nowrap;
}

.mesa-card-checkout {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  padding: 6px 10px;
  margin-top: 0.75rem;
  border: none;
  border-radius: 6px;
  background: #16a34a;
  color: white;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: var(--transition);
  font-family: inherit;
}
.mesa-card-checkout:hover {
  background: #15803d;
  transform: translateY(-1px);
}

.pedido-mini-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--border-light);
  margin-bottom: 6px;
  cursor: pointer;
  transition: var(--transition);
}
.pedido-mini-card:hover {
  background: var(--border);
}
.pedido-mini-card .status-badge {
  font-size: 0.7rem;
}

.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200;
  display: flex; align-items: center; justify-content: center; padding: 1rem;
}
.modal-content {
  background: white; border-radius: 16px; padding: 1.5rem;
  width: 100%; max-width: 500px; max-height: 85vh; overflow-y: auto;
}
</style>
