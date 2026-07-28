<template>
  <div>
    <!-- Feedback Toast -->
    <div v-if="feedbackMsg" class="feedback-toast" :class="feedbackMsg.tipo" @click="feedbackMsg = null">
      <i-lucide-circle-check-big v-if="feedbackMsg.tipo === 'success'" style="width:20px;height:20px" />
      <i-lucide-triangle-alert v-else style="width:20px;height:20px" />
      {{ feedbackMsg.texto }}
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <select v-model="filtroStatus">
        <option value="ativos">Ativos</option>
        <option value="concluidos">Concluídos</option>
        <option value="cancelados">Cancelados</option>
        <option value="">Todos</option>
      </select>
      <div class="date-radio-group">
        <label class="date-radio" :class="{ active: filtroDataPeriodo === 'hoje' }">
          <input type="radio" name="dataFiltro" value="hoje" v-model="filtroDataPeriodo" @change="aplicarFiltroData()" />
          <span>Hoje</span>
        </label>
        <label class="date-radio" :class="{ active: filtroDataPeriodo === 'ontem' }">
          <input type="radio" name="dataFiltro" value="ontem" v-model="filtroDataPeriodo" @change="aplicarFiltroData()" />
          <span>Ontem</span>
        </label>
        <label class="date-radio" :class="{ active: filtroDataPeriodo === '7dias' }">
          <input type="radio" name="dataFiltro" value="7dias" v-model="filtroDataPeriodo" @change="aplicarFiltroData()" />
          <span>7 dias</span>
        </label>
        <label class="date-radio" :class="{ active: filtroDataPeriodo === '' }">
          <input type="radio" name="dataFiltro" value="" v-model="filtroDataPeriodo" @change="aplicarFiltroData()" />
          <span>Todos</span>
        </label>
      </div>
      <button class="btn btn-secondary btn-sm" @click="limparFiltros">Limpar</button>
    </div>

    <div v-if="resumo" class="stats-grid">
  <div class="stat-card"><div class="label">Pedidos Entregues (hoje)</div><div class="value success">{{ resumo?.pedidos_entregues || 0 }}</div></div>
  <div class="stat-card"><div class="label">Faturamento (hoje)</div><div class="value primary">{{ formatPrice(resumo?.faturamento_estimado || 0) }}</div></div>
  <div class="stat-card"><div class="label">Ativos na Fila</div><div class="value info">{{ resumo?.pedidos_ativos || 0 }}</div></div>
</div>

<!-- View Mode Tabs -->
    <div class="tabs">
      <button class="tab" :class="{ active: viewMode === 'cards' }" @click="viewMode = 'cards'">Cartões</button>
      <button class="tab" :class="{ active: viewMode === 'kanban' }" @click="viewMode = 'kanban'">Kanban</button>
      <button class="tab" :class="{ active: viewMode === 'lista' }" @click="viewMode = 'lista'">Lista</button>
    </div>

    <!-- Kanban View -->
    <div v-if="viewMode === 'kanban'" class="kanban-board">
      <div v-for="col in kanbanColumns" :key="col.status" class="kanban-column">
        <h3>{{ col.label }} <span class="count">{{ orders.filter(o => o.status === col.status).length }}</span></h3>
        <div v-for="order in orders.filter(o => o.status === col.status)" :key="order.id"
          class="order-card" :class="order.status" draggable="true"
          :draggable="podeArrastarKanban"
          @dragstart="dragOrder = order" @dragover.prevent
          @drop="podeArrastarKanban && changeStatus(order.id, col.status)"
          @click="abrirDetalhes(order)"
          style="cursor:pointer;"
        >
          <strong>{{ order.pedido_id }}</strong>
          <div style="font-size:0.8rem;color:var(--text-muted);">{{ order.nome_cliente }}</div>
          <!-- Preview dos pratos (Kanban) -->
          <div v-if="order.itens?.length" style="font-size:0.72rem;color:var(--text-secondary);margin-top:4px;line-height:1.3;">
            {{ order.itens.slice(0, 3).map(i => i.nome_produto).join(', ') }}<span v-if="order.itens.length > 3">...</span>
          </div>
          <div style="font-size:0.8rem;margin-top:4px;">R$ {{ parseFloat(order.total).toFixed(2) }}</div>
          <!-- Badge de refund (Kanban) -->
          <div v-if="(order.status === 'cancelado' || order.status === 'recusado') && isOnlinePayment(order.metodo_pagamento)"
               class="refund-status" :class="refundClass(order.id)" style="margin-top:6px;font-size:0.7rem;">
            <i-lucide-clock v-if="refundIcon(order.id) === 'clock'" style="width:16px;height:16px" />
            <i-lucide-circle-check-big v-else-if="refundIcon(order.id) === 'check-circle'" style="width:16px;height:16px" />
            <i-lucide-circle-x v-else-if="refundIcon(order.id) === 'x-circle'" style="width:16px;height:16px" />
            <i-lucide-loader v-else class="spinning" style="width:16px;height:16px" />
            {{ refundLabel(order.id) }}
          </div>
      </div>
    </div>
    </div>

    <!-- Cards View -->
    <div v-if="viewMode === 'cards'">
      <div v-for="order in orders" :key="order.id" class="order-card" :class="order.status">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <strong>{{ order.pedido_id }}</strong> — {{ order.nome_cliente }}
            <div style="font-size:0.8rem;color:var(--text-muted);">{{ formatDate(order.criado_em) }}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
            <span class="status-badge" :class="order.status">{{ statusLabel(order.status) }}</span>
            <!-- Badge de refund (restaurante) -->
            <div v-if="(order.status === 'cancelado' || order.status === 'recusado') && isOnlinePayment(order.metodo_pagamento)"
                 class="refund-status" :class="refundClass(order.id)" style="margin-top:4px;">
              <i-lucide-clock v-if="refundIcon(order.id) === 'clock'" style="width:16px;height:16px" />
            <i-lucide-circle-check-big v-else-if="refundIcon(order.id) === 'check-circle'" style="width:16px;height:16px" />
            <i-lucide-circle-x v-else-if="refundIcon(order.id) === 'x-circle'" style="width:16px;height:16px" />
            <i-lucide-loader v-else class="spinning" style="width:16px;height:16px" />
              {{ refundLabel(order.id) }}
            </div>
        </div>
        </div>

        <div v-if="order.entregador_nome" style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">
          🛵 {{ order.entregador_nome }}
        </div>

        <!-- Timer -->
        <div v-if="isActiveOrder(order.status)" style="margin-top:8px;font-size:0.85rem;">
          <span :style="{ color: getTimerColor(order) }">
            <i-lucide-clock style="width:14px;height:14px" />
            {{ getTimerText(order) }}
          </span>
        </div>

        <div style="font-size:0.85rem;margin-top:8px;">
          <strong>{{ order.itens?.length }} item(ns)</strong> — {{ formatPrice(order.total) }}
          <br />{{ paymentLabel(order.metodo_pagamento) }}
        </div>

        <div v-if="order.observacoes" style="background:var(--warning-light);padding:6px 8px;border-radius:4px;font-size:0.85rem;margin-top:8px;">
          📝 {{ order.observacoes }}
        </div>

        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">
          <!-- Aguardando Pagamento: Verificar (consulta API Asaas) ou Confirmar manualmente -->
          <template v-if="order.status === 'aguardando_pagamento'">
            <button
              class="btn btn-info btn-sm"
              @click="verificarPagamento(order)"
              :disabled="verificandoIds.has(order.id)"
            >
              <i-lucide-loader v-if="verificandoIds.has(order.id)" class="spinning" style="width:14px;height:14px" />
              <i-lucide-search v-else style="width:14px;height:14px" />
              {{ verificandoIds.has(order.id) ? 'Verificando...' : '🔍 Verificar Pagamento' }}
            </button>
            <button v-if="isAdmin" class="btn btn-success btn-sm" @click="confirmarPagamento(order)">
              <i-lucide-check style="width:14px;height:14px" /> ✅ Confirmar Pagamento
            </button>
          </template>

          <!-- Pendente: Aceitar (admin/gerente/chef), Recusar (admin/gerente) -->
          <template v-if="order.status === 'pendente'">
            <button v-if="podeAceitar" class="btn btn-success btn-sm" @click="changeStatus(order.id, 'preparando')">Aceitar</button>
            <button v-if="podeRecusar" class="btn btn-danger btn-sm" @click="abrirModalCancelamento(order, 'recusado')">Recusar</button>
          </template>

          <!-- Preparando: Pronto (admin/gerente/chef) -->
          <template v-if="order.status === 'preparando'">
            <button v-if="podeMarcarPronto" class="btn btn-primary btn-sm" @click="changeStatus(order.id, 'pronto_entrega')">Pronto para Entrega</button>
          </template>

          <!-- Pronto para entrega -->
          <template v-if="order.status === 'pronto_entrega'">
            <template v-if="modoSemEntregador">
              <button v-if="podeMarcarPronto" class="btn btn-success btn-sm" @click="changeStatus(order.id, 'entregue')">✅ Confirmar Entrega</button>
            </template>
            <template v-else>
              <span style="font-size:0.85rem;color:var(--text-muted);">Aguardando Entregador...</span>
            </template>
          </template>

          <!-- Em trânsito / Chegou destino -->
          <template v-if="order.status === 'em_transito'">
            <span style="font-size:0.85rem;">Pedido em Rota de Entrega</span>
          </template>
          <template v-if="order.status === 'cheguei_destino'">
            <span style="font-size:0.85rem;color:var(--primary);">Entregador no Local</span>
          </template>

          <!-- Entregue -->
          <template v-if="order.status === 'entregue'">
            <span style="font-size:0.85rem;color:var(--success);">✓ Entrega Concluída</span>
          </template>

          <!-- Cancelado / Recusado -->
          <template v-if="order.status === 'cancelado' || order.status === 'recusado'">
            <span style="font-size:0.85rem;color:var(--error);">✕ {{ order.motivo_cancelamento || 'Sem motivo' }}</span>
          </template>

          <button class="btn btn-secondary btn-sm" @click="abrirDetalhes(order)">Detalhes</button>
          <button v-if="podeEnviarMensagem && !['entregue','cancelado','recusado'].includes(order.status)" class="btn btn-secondary btn-sm" @click="abrirMensagem(order)">💬 Mensagem</button>
          <!-- Cancelar disponível durante toda jornada do pedido (antes de entregue/cancelado) -->
          <button v-if="podeCancelar && isActiveOrder(order.status) && order.status !== 'aguardando_pagamento'" class="btn btn-danger btn-sm" @click="abrirModalCancelamento(order, 'cancelado')">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- List View -->
    <div v-if="viewMode === 'lista'" class="card">
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th><th>Cliente</th><th>Status</th><th>Data/Hora</th><th>Itens</th><th>Total</th><th>Tempo</th><th>Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in orders" :key="order.id">
            <td><strong>{{ order.pedido_id }}</strong></td>
            <td>{{ order.nome_cliente }}</td>
            <td>
              <span class="status-badge" :class="order.status">{{ statusLabel(order.status) }}</span>
              <!-- Badge de refund (Lista) -->
              <div v-if="(order.status === 'cancelado' || order.status === 'recusado') && isOnlinePayment(order.metodo_pagamento)"
                   class="refund-status" :class="refundClass(order.id)" style="margin-top:4px;font-size:0.7rem;">
                <i-lucide-clock v-if="refundIcon(order.id) === 'clock'" style="width:16px;height:16px" />
            <i-lucide-circle-check-big v-else-if="refundIcon(order.id) === 'check-circle'" style="width:16px;height:16px" />
            <i-lucide-circle-x v-else-if="refundIcon(order.id) === 'x-circle'" style="width:16px;height:16px" />
            <i-lucide-loader v-else class="spinning" style="width:16px;height:16px" />
                {{ refundLabel(order.id) }}
              </div>
            </td>
            <td style="white-space:nowrap;font-size:0.85rem;">{{ formatDate(order.criado_em) }}</td>
            <td>{{ order.itens?.length }}</td>
            <td><strong>{{ formatPrice(order.total) }}</strong></td>
            <td>{{ getTimerText(order) }}</td>
            <td>
              <button class="btn btn-sm btn-primary" @click="abrirDetalhes(order)">Ver</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Detail Modal -->
    <div v-if="selectedOrder" class="modal-overlay" @click.self="selectedOrder = null">
      <div class="modal-content">
        <h3>{{ selectedOrder.pedido_id }} — {{ selectedOrder.nome_cliente }}</h3>
        <p style="color:var(--text-muted);margin-bottom:1rem;">{{ formatDate(selectedOrder.criado_em) }}</p>

        <div class="profile-section"><div class="profile-section-title">Itens</div>
          <div v-for="item in selectedOrder.itens" :key="item.id" style="font-size:0.9rem;margin-bottom:4px;">
            {{ item.quantidade }}x {{ item.nome_produto }} — {{ formatPrice(item.subtotal) }}
          </div>
        </div>

        <div class="profile-section"><div class="profile-section-title">Cliente</div>
          <p style="font-size:0.85rem;">{{ selectedOrder.nome_cliente }}<br/>{{ selectedOrder.telefone_cliente }}<br/>{{ selectedOrder.endereco_cliente }}, {{ selectedOrder.numero_cliente }}<br/>{{ selectedOrder.bairro_cliente }}</p>
        </div>

        <div class="profile-section"><div class="profile-section-title">Pagamento</div>
          <p style="font-size:0.85rem;">{{ paymentLabel(selectedOrder.metodo_pagamento) }}</p>
          <!-- Badge de refund (Modal) -->
          <div v-if="(selectedOrder.status === 'cancelado' || selectedOrder.status === 'recusado') && isOnlinePayment(selectedOrder.metodo_pagamento)"
               class="refund-status" :class="refundClass(selectedOrder.id)" style="margin-top:6px;">
            <i :class="refundIcon(selectedOrder.id)"></i>
            {{ refundLabel(selectedOrder.id) }}
          </div>
        </div>

        <div class="order-summary">
          <div class="order-summary-row"><span>Subtotal:</span><span>{{ formatPrice(selectedOrder.subtotal) }}</span></div>
          <div class="order-summary-row"><span>Frete:</span><span>{{ formatPrice(selectedOrder.valor_frete) }}</span></div>
          <div class="order-summary-total"><span>Total:</span><span>{{ formatPrice(selectedOrder.total) }}</span></div>
        </div>

        <div style="display:flex;gap:8px;margin-top:1rem;">
          <button class="btn btn-primary" style="flex:1;" @click="imprimirPedido(selectedOrder)">
            <i-lucide-printer style="width:16px;height:16px" /> Imprimir
          </button>
          <button class="btn btn-secondary" style="flex:1;" @click="selectedOrder = null">Fechar</button>
        </div>
      </div>
    </div>

    <!-- Cancel/Recuse Modal (customizado, substitui prompt()) -->
    <div v-if="cancelModalOrder" class="modal-overlay" @click.self="fecharModalCancelamento">
      <div class="modal-content" style="max-width:420px;">
        <div style="text-align:center;margin-bottom:1rem;">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--error-light);display:flex;align-items:center;justify-content:center;margin:0 auto 0.75rem;">
            <i-lucide-triangle-alert style="width:24px;height:24px;color:var(--error)" />
          </div>
          <h3 style="font-size:1.1rem;font-weight:700;">
            {{ cancelModalAction === 'cancelado' ? 'Cancelar Pedido' : 'Recusar Pedido' }}
          </h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:0.25rem;">
            {{ cancelModalOrder?.pedido_id }} — {{ cancelModalOrder?.nome_cliente }}
          </p>
        </div>

        <div class="form-group">
          <label>Motivo do {{ cancelModalAction === 'cancelado' ? 'cancelamento' : 'recusa' }}:</label>
          <textarea
            v-model="cancelModalMotivo"
            rows="3"
            placeholder="Descreva o motivo..."
            style="width:100%;padding:0.75rem;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:0.9rem;outline:none;"
            @focus="$event.target.style.borderColor = 'var(--primary)'"
            @blur="$event.target.style.borderColor = 'var(--border)'"
          ></textarea>
        </div>

        <div style="display:flex;gap:0.75rem;margin-top:1.25rem;">
          <button class="btn btn-secondary" style="flex:1;justify-content:center;" @click="fecharModalCancelamento">
            Voltar
          </button>
          <button
            class="btn btn-danger"
            style="flex:1;justify-content:center;"
            @click="confirmarCancelamento"
            :disabled="!cancelModalMotivo.trim()"
          >
            <i-lucide-check style="width:16px;height:16px" />
            {{ cancelModalAction === 'cancelado' ? 'Cancelar Pedido' : 'Recusar Pedido' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Message Modal -->
    <div v-if="msgOrder" class="modal-overlay" @click.self="msgOrder = null">
      <div class="modal-content" style="max-width:400px;">
        <h3>💬 Mensagem para {{ msgOrder.nome_cliente }}</h3>
        <div class="form-group" style="margin-top:1rem;">
          <textarea v-model="mensagemTexto" rows="3" placeholder="Digite sua mensagem..." style="width:100%;padding:0.75rem;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;"></textarea>
        </div>
        <button class="btn btn-primary btn-block" @click="enviarMensagem" :disabled="!mensagemTexto.trim()">Enviar</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, onUnmounted } from 'vue'
import api from '../services/api'
import { onEvent } from '../services/realtime'
import { useAuthStore } from '../stores/auth'

const emit = defineEmits(['changeView'])
const authStore = useAuthStore()
const globalLoading = inject('globalLoading')
const loadingMessage = inject('loadingMessage')

const cargo = computed(() => authStore.user?.cargo)

const feedbackMsg = ref(null)
function showFeedback(texto, tipo = 'erro') {
  feedbackMsg.value = { texto, tipo }
  setTimeout(() => { feedbackMsg.value = null }, 4000)
}

const viewMode = ref('cards')
const orders = ref([])
const resumo = ref(null)
const selectedOrder = ref(null)
const msgOrder = ref(null)
const mensagemTexto = ref('')
const dragOrder = ref(null)
const verificandoIds = ref(new Set())
const cancelModalOrder = ref(null)     // pedido alvo do cancelamento/recusa
const cancelModalAction = ref('cancelado') // 'cancelado' | 'recusado'
const cancelModalMotivo = ref('')      // motivo digitado
let pollingPaymentInterval = null

// Estado dos estornos (refund) por pedido
const refundStatus = ref({})
let pollingRefundInterval = null

function isOnlinePayment(metodo) {
  return ['pix_online', 'credito_online'].includes(metodo)
}

function refundClass(orderId) {
  const s = refundStatus.value[orderId]
  if (!s || s === 'PENDING') return 'refund-pending'
  if (s === 'DONE') return 'refund-done'
  if (s === 'CANCELLED') return 'refund-error'
  return 'refund-pending'
}

function refundIcon(orderId) {
  const s = refundStatus.value[orderId]
  if (!s || s === 'PENDING') return 'clock'
  if (s === 'DONE') return 'check-circle'
  if (s === 'CANCELLED') return 'x-circle'
  return 'loader'
}

function refundLabel(orderId) {
  const s = refundStatus.value[orderId]
  if (!s || s === 'PENDING') return '⏳ Estorno solicitado'
  if (s === 'DONE') return '✅ Estorno concluído'
  if (s === 'CANCELLED') return '❌ Estorno cancelado'
  if (s === 'AWAITING_CRITICAL_ACTION_AUTHORIZATION') return '🔐 Aguardando autorização (código SMS enviado)'
  return '⏳ Estorno em processamento...'
}

async function checkRefundStatus(orderId) {
  try {
    const { data } = await api.get(`/pagamentos/${orderId}/refund-status`)
    console.log(`[Refund] Pedido ${orderId}:`, data)
    if (data.refund_status) {
      refundStatus.value = { ...refundStatus.value, [orderId]: data.refund_status }
    } else if (data.deleted) {
      refundStatus.value = { ...refundStatus.value, [orderId]: 'DONE' }
    }
  } catch { /* silent */ }
}

const hoje = new Date().toISOString().split('T')[0]
const filtroStatus = ref('')
const filtroDataPeriodo = ref('hoje')
const filtroDataInicio = ref(hoje)
const filtroDataFim = ref('')
const modoSemEntregador = ref(false)

function aplicarFiltroData() {
  const hojeStr = new Date().toISOString().split('T')[0]
  if (filtroDataPeriodo.value === 'hoje') {
    filtroDataInicio.value = hojeStr
    filtroDataFim.value = ''
  } else if (filtroDataPeriodo.value === 'ontem') {
    const ontem = new Date(); ontem.setDate(ontem.getDate() - 1)
    filtroDataInicio.value = ontem.toISOString().split('T')[0]
    filtroDataFim.value = ''
  } else if (filtroDataPeriodo.value === '7dias') {
    const seteDias = new Date(); seteDias.setDate(seteDias.getDate() - 7)
    filtroDataInicio.value = seteDias.toISOString().split('T')[0]
    filtroDataFim.value = ''
  } else {
    filtroDataInicio.value = ''
    filtroDataFim.value = ''
  }
  loadOrders()
}

const kanbanColumns = computed(() => {
  const cols = [
    { status: 'aguardando_pagamento', label: '⏳ Pagamento' },
    { status: 'pendente', label: 'Aguardando' },
    { status: 'preparando', label: 'Preparando' },
    { status: 'pronto_entrega', label: 'Pronto' },
  ]
  // Se modo sem entregador, esconder colunas de entrega (a menos que existam pedidos lá)
  if (modoSemEntregador.value) {
    const hasTransito = orders.value.some(o => o.status === 'em_transito')
    const hasDestino = orders.value.some(o => o.status === 'cheguei_destino')
    if (hasTransito) cols.push({ status: 'em_transito', label: '📦 Em Rota' })
    if (hasDestino) cols.push({ status: 'cheguei_destino', label: '📍 No Local' })
  } else {
    cols.push({ status: 'em_transito', label: 'Em Rota' })
    cols.push({ status: 'cheguei_destino', label: 'No Local' })
  }
  cols.push({ status: 'entregue', label: 'Entregue' })
  return cols
})

function formatPrice(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) }

function formatDate(d) {
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function statusLabel(s) {
  const l = { pendente: 'Pendente', preparando: 'Preparando', pronto_entrega: 'Pronto', em_transito: 'Em Rota', cheguei_destino: 'No Local', entregue: 'Entregue', cancelado: 'Cancelado', recusado: 'Recusado', aguardando_pagamento: 'Aguardando Pagamento' }
  return l[s] || s
}

function paymentLabel(m) {
  const l = { credito: 'Cartão Crédito', debito: 'Cartão Débito', dinheiro: 'Dinheiro', pix: 'PIX', pix_online: 'PIX Online', credito_online: 'Cartão Online' }
  return l[m] || m
}

function isActiveOrder(s) { return !['entregue', 'cancelado', 'recusado'].includes(s) }

// ============================================
// Helper functions de permissão por cargo
// ============================================
const isAdmin = computed(() => cargo.value === 'admin' || cargo.value === 'gerente')
const isChef = computed(() => cargo.value === 'chef')
const isCaixa = computed(() => cargo.value === 'caixa')

// Admin/Gerente: podem fazer tudo
const podeAceitar = computed(() => isAdmin.value || isChef.value)
const podeRecusar = computed(() => isAdmin.value)
const podeMarcarPronto = computed(() => isAdmin.value || isChef.value)
const podeCancelar = computed(() => isAdmin.value || isCaixa.value)
const podeEnviarMensagem = computed(() => isAdmin.value || isChef.value)
const podeArrastarKanban = computed(() => isAdmin.value || isChef.value)

function getTimerText(order) {
  const created = new Date(order.criado_em)
  const mins = Math.floor((Date.now() - created.getTime()) / 60000)
  if (mins < 1) return 'Agora'
  return `${mins} min`
}

function getTimerColor(order) {
  const created = new Date(order.criado_em)
  const mins = (Date.now() - created.getTime()) / 60000
  if (mins > 20) return 'var(--error)'
  if (mins > 10) return 'var(--warning)'
  return 'var(--text-secondary)'
}

async function loadOrders() {
  try {
    const { data } = await api.get('/pedidos', {
      params: {
        status: filtroStatus.value || undefined,
        data_inicio: filtroDataInicio.value || undefined,
        data_fim: filtroDataFim.value || undefined,
        limit: 200,
      }
    })
    orders.value = data
  } catch { /* ignore */ }
}

async function loadResumo() {
  try {
    const { data } = await api.get('/dashboard/resumo-dia')
    resumo.value = data
  } catch { /* ignore */ }
}

async function changeStatus(orderId, newStatus) {
  globalLoading.value = true
  loadingMessage.value = 'Atualizando status...'
  try {
    await api.patch(`/pedidos/${orderId}/status`, { status: newStatus })
    await loadOrders()
    await loadResumo()
  } catch (err) {
    showFeedback(err.response?.data?.error || 'Erro ao atualizar status', 'erro')
  } finally {
    globalLoading.value = false
  }
}

// ── Modal customizado de cancelamento/recusa (substitui prompt()) ──
function abrirModalCancelamento(order, action) {
  cancelModalOrder.value = order
  cancelModalAction.value = action
  cancelModalMotivo.value = ''
}

function fecharModalCancelamento() {
  cancelModalOrder.value = null
  cancelModalMotivo.value = ''
}

async function confirmarCancelamento() {
  const order = cancelModalOrder.value
  const action = cancelModalAction.value
  const motivo = cancelModalMotivo.value.trim()
  if (!order || !motivo) return

  fecharModalCancelamento()

  globalLoading.value = true
  loadingMessage.value = action === 'cancelado' ? 'Cancelando pedido...' : 'Recusando pedido...'
  try {
    await api.patch(`/pedidos/${order.id}/status`, { status: action, motivo })
    await loadOrders()
    await loadResumo()
    if (isOnlinePayment(order.metodo_pagamento)) {
      setTimeout(() => checkRefundStatus(order.id), 3000)
    }
    showFeedback(`✅ Pedido ${order.pedido_id} ${action === 'cancelado' ? 'cancelado' : 'recusado'} com sucesso!`, 'success')
  } catch (err) {
    showFeedback(err.response?.data?.error || `Erro ao ${action === 'cancelado' ? 'cancelar' : 'recusar'}`, 'erro')
  } finally {
    globalLoading.value = false
  }
}

function abrirDetalhes(order) { selectedOrder.value = order }
function abrirMensagem(order) { msgOrder.value = order; mensagemTexto.value = '' }

function imprimirPedido(order) {
  const printWindow = window.open('', '_blank', 'width=400,height=600')
  if (!printWindow) { showFeedback('Permita pop-ups para imprimir.', 'erro'); return }

  const itensHTML = order.itens?.map(item =>
    `<tr><td style="padding:4px 0;">${item.quantidade}x ${item.nome_produto}</td><td style="text-align:right;padding:4px 0;">R$ ${parseFloat(item.subtotal).toFixed(2)}</td></tr>`
  ).join('') || ''

  printWindow.document.write(`
    <html><head>
      <title>Pedido ${order.pedido_id}</title>
      <style>
        @page { margin: 0; size: 80mm auto; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          width: 80mm;
          padding: 8mm 5mm;
          color: #000;
        }
        .header { text-align: center; margin-bottom: 8px; }
        .header h2 { font-size: 16px; font-weight: 800; }
        .header .info { font-size: 10px; color: #333; margin-top: 2px; }
        .divider { border-top: 1px dashed #000; margin: 8px 0; }
        .cliente { font-size: 11px; margin-bottom: 8px; }
        .cliente strong { font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 10px; border-bottom: 1px solid #000; padding: 4px 0; }
        .total { font-size: 14px; font-weight: 800; text-align: right; margin-top: 8px; }
        .footer { text-align: center; font-size: 10px; margin-top: 12px; border-top: 1px dashed #000; padding-top: 8px; }
        .obs { font-size: 10px; margin-top: 6px; font-style: italic; }
        @media print { body { width: 80mm; } }
      </style>
    </head><body>
      <div class="header">
        <h2>PALAZZO</h2>
        <div class="info">Mooca - São Paulo/SP</div>
        <div class="info">${order.pedido_id} | ${new Date(order.criado_em).toLocaleString('pt-BR')}</div>
      </div>
      <div class="divider"></div>
      <div class="cliente">
        <strong>${order.nome_cliente}</strong><br />
        ${order.endereco_cliente}, ${order.numero_cliente}<br />
        ${order.bairro_cliente}<br />
        Tel: ${order.telefone_cliente || '—'}
      </div>
      <div class="divider"></div>
      <table><tr><th>Item</th><th style="text-align:right;">Valor</th></tr>${itensHTML}</table>
      <div class="total">
        <div>Subtotal: R$ ${parseFloat(order.subtotal).toFixed(2)}</div>
        <div>Frete: R$ ${parseFloat(order.valor_frete).toFixed(2)}</div>
        <div style="font-size:16px;">TOTAL: R$ ${parseFloat(order.total).toFixed(2)}</div>
      </div>
      <div style="margin-top:6px;font-size:11px;">
        <strong>Pagamento:</strong> ${paymentLabel(order.metodo_pagamento)}
      </div>
      ${order.observacoes ? `<div class="obs">📝 ${order.observacoes}</div>` : ''}
      <div class="footer">
        Obrigado pela preferência! 🍕<br />
        Palazzo Mooca
      </div>
    </body></html>
  `)
  printWindow.document.close()

  // Aguardar carregamento das fontes e imprimir
  setTimeout(() => {
    printWindow.focus()
    printWindow.print()
  }, 500)
}

async function enviarMensagem() {
  globalLoading.value = true
  loadingMessage.value = 'Enviando mensagem...'
  try {
    await api.post('/restaurante/mensagens', { pedido_id: msgOrder.value.id, mensagem: mensagemTexto.value })
    msgOrder.value = null
    showFeedback('Mensagem enviada!', 'success')
  } catch { showFeedback('Erro ao enviar mensagem', 'erro') }
  finally { globalLoading.value = false }
}

async function loadConfig() {
  try {
    const { data } = await api.get('/restaurante')
    modoSemEntregador.value = data.modo_sem_entregador || false
  } catch { /* ignore */ }
}

function limparFiltros() {
  filtroStatus.value = ''
  filtroDataPeriodo.value = 'hoje'
  filtroDataInicio.value = hoje
  filtroDataFim.value = ''
  loadOrders()
}

// Verificar pagamento consultando Asaas diretamente
async function verificarPagamento(order) {
  globalLoading.value = true
  loadingMessage.value = 'Verificando pagamento...'
  const newSet = new Set(verificandoIds.value)
  newSet.add(order.id)
  verificandoIds.value = newSet
  try {
    const { data } = await api.get(`/pagamentos/${order.id}/verificar-status`)
    if (data.precisa_atualizar) {
      showFeedback(`✅ Pagamento do ${order.pedido_id} foi confirmado!`, 'success')
      await loadOrders()
      await loadResumo()
    } else if (data.pagamento_status !== 'PENDING') {
      showFeedback(`ℹ️ Status do pagamento: ${data.pagamento_status}`, 'erro')
      await loadOrders()
    } else {
      showFeedback('⏳ Pagamento ainda não detectado.', 'erro')
    }
  } catch (err) {
    showFeedback('Erro ao verificar pagamento: ' + (err.response?.data?.error || err.message), 'erro')
  } finally {
    const cleanSet = new Set(verificandoIds.value)
    cleanSet.delete(order.id)
    verificandoIds.value = cleanSet
    globalLoading.value = false
  }
}

// Confirmar pagamento manualmente (admin apenas)
// Chama o verificar-status que consulta o Asaas e ativa o pedido se pago
async function confirmarPagamento(order) {
  if (!confirm(`Confirmar pagamento do ${order.pedido_id} manualmente?\nIsso consultará o Asaas e ativará o pedido para a fila de preparo.`)) return
  globalLoading.value = true
  loadingMessage.value = 'Verificando pagamento...'
  try {
    const { data } = await api.get(`/pagamentos/${order.id}/verificar-status`)
    if (data.precisa_atualizar) {
      showFeedback(`✅ Pagamento do ${order.pedido_id} confirmado! O pedido foi para a fila.`, 'success')
    } else if (data.pagamento_status !== 'PENDING') {
      showFeedback(`ℹ️ Status do pagamento: ${data.pagamento_status}`, 'info')
    } else {
      showFeedback('⚠️ Pagamento ainda não detectado no Asaas.', 'erro')
    }
    await loadOrders()
    await loadResumo()
  } catch (err) {
    showFeedback('Erro: ' + (err.response?.data?.error || err.message), 'erro')
  } finally {
    globalLoading.value = false
  }
}

onMounted(async () => {
  await loadOrders()
  await loadResumo()
  await loadConfig()
  onEvent('pedido:novo', () => { loadOrders(); loadResumo() })
  onEvent('pedido:atualizado', () => { loadOrders(); loadResumo() })

  // Auto-polling LOCAL: recarrega lista de pedidos a cada 10s
  // NÃO consulta Asaas — apenas o banco local
  // O webhook do Asaas é o mecanismo principal de atualização
  pollingPaymentInterval = setInterval(async () => {
    await loadOrders()
    await loadResumo()
  }, 10000)

  // Polling de refund LOCAL: verifica status no BD local a cada 10s
  // O webhook PAYMENT_REFUNDED já atualiza o BD
  // Este polling só serve como fallback para quando o status é inconclusivo
  pollingRefundInterval = setInterval(async () => {
    const recusados = orders.value.filter(o =>
      (o.status === 'cancelado' || o.status === 'recusado') &&
      isOnlinePayment(o.metodo_pagamento)
    )
    if (recusados.length === 0) return
    for (const order of recusados) {
      const currentStatus = refundStatus.value[order.id]
      if (currentStatus === 'DONE' || currentStatus === 'CANCELLED') continue
      await checkRefundStatus(order.id)
      await new Promise(r => setTimeout(r, 300))
    }
  }, 10000)

  // Verificar estorno inicial dos pedidos já carregados
  setTimeout(() => {
    const recusados = orders.value.filter(o =>
      (o.status === 'cancelado' || o.status === 'recusado') &&
      isOnlinePayment(o.metodo_pagamento)
    )
    recusados.forEach(o => checkRefundStatus(o.id))
  }, 1000)
})

// Limpar intervalos ao desmontar
onUnmounted(() => {
  if (pollingPaymentInterval) clearInterval(pollingPaymentInterval)
  if (pollingRefundInterval) clearInterval(pollingRefundInterval)
})
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200;
  display: flex; align-items: center; justify-content: center; padding: 1rem;
}
.modal-content {
  background: white; border-radius: 12px; padding: 1.5rem;
  width: 100%; max-width: 500px; max-height: 80vh; overflow-y: auto;
}
.profile-section { margin-bottom: 1rem; }
.profile-section-title {
  font-size: 0.8rem; font-weight: 700; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.5rem;
  padding-bottom: 0.3rem; border-bottom: 1px solid var(--border);
}
.order-summary { background: var(--background); padding: 1rem; border-radius: 8px; margin-top: 1rem; }
.order-summary-row { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 4px; }
.order-summary-total { display: flex; justify-content: space-between; font-weight: 800; font-size: 1.1rem; padding-top: 8px; margin-top: 8px; border-top: 2px solid var(--border); }
.status-badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; }
.feedback-toast {
  position: fixed;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  animation: slideDown 0.3s ease;
  cursor: pointer;
  max-width: 90%;
}
.feedback-toast.success {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}
.date-radio-group {
  display: flex;
  gap: 4px;
  background: var(--background);
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.date-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition);
  color: var(--text-muted);
  user-select: none;
}
.date-radio:hover {
  color: var(--text);
}
.date-radio.active {
  background: var(--surface);
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.date-radio input[type="radio"] {
  display: none;
}

.feedback-toast.erro {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}
@keyframes slideDown {
  from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* Refund status indicator */
.refund-status {
  font-size: 0.8rem;
  margin-top: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.refund-status svg { width: 14px; height: 14px; }
.refund-pending {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}
.refund-done {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}
.refund-error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}
</style>
