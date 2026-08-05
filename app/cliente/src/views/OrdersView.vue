<template>
  <div class="orders-view">
    <h2 class="section-title mb-4">
      <i-lucide-receipt style="width:20px;height:20px" /> Meus Pedidos
    </h2>

    <div v-if="loading" class="loading-wrapper">
      <div class="spinner spinner-center"></div>
    </div>

    <div v-else-if="orders.length === 0" class="empty-search p-4">
      <i-lucide-shopping-bag style="width:48px;height:48px" />
      <p>Você ainda não fez nenhum pedido.</p>
      <router-link to="/" class="btn btn-primary mt-3">
        Ver Cardápio
      </router-link>
    </div>

    <div v-else>
      <div v-for="order in orders" :key="order.id" class="order-card">
        <div class="order-header">
          <div>
            <div class="order-number">{{ order.pedido_id }}</div>
            <div class="order-date">{{ formatDate(order.criado_em) }}</div>
          </div>
          <div style="text-align:right;">
            <span v-if="order.origem === 'retirada'" class="retirada-badge">🏪 Retirada no local</span>
            <span class="status-badge" :class="order.status">
              {{ statusLabel(order.status, order.origem) }}
            </span>
          </div>
        </div>

        <!-- Kitchen Messages -->
        <div v-if="order.mensagens?.length" class="order-kitchen-msg">
          <i-lucide-message-circle style="width:16px;height:16px" />
          💬 Mensagem da Cozinha
        </div>

        <!-- Items Preview -->
        <div class="order-items-preview">
          {{ order.itens?.slice(0, 3).map(i => `${i.quantidade}x ${i.nome_produto}`).join(', ') }}
          <span v-if="order.itens?.length > 3">e mais {{ order.itens.length - 3 }} item(ns)</span>
        </div>
        <div v-if="order.itens?.some(i => i.observacao)" class="order-items-obs">
          📝 {{ order.itens.filter(i => i.observacao).map(i => `${i.nome_produto}: ${i.observacao}`).join(' | ') }}
        </div>

        <div class="order-info">
          <span>Total: <strong class="order-total">{{ formatPrice(order.total) }}</strong></span>
          <span>{{ pagamentoLabel(order.metodo_pagamento) }}</span>
          <span v-if="order.entregador_nome">🛵 {{ order.entregador_nome }}</span>
        </div>

        <div class="order-actions">
          <button
            v-if="isActiveOrder(order.status)"
            class="btn-track"
            @click="$router.push(`/pedidos/${order.id}`)"
          >
            <i-lucide-map-pin style="width:16px;height:16px" /> Acompanhar Pedido
          </button>
        </div>

        <!-- Motivo de Cancelamento/Recusa -->
        <div v-if="order.motivo_cancelamento" class="order-note" style="color:var(--error);border-color:var(--error);">
          <i-lucide-info style="width:16px;height:16px" />
          {{ order.status === 'recusado' ? 'Motivo da recusa:' : 'Motivo do cancelamento:' }}
          {{ order.motivo_cancelamento }}
        </div>
        <!-- Refund status (cliente) -->
        <div v-if="(order.status === 'cancelado' || order.status === 'recusado') && isOnlinePayment(order.metodo_pagamento)"
             class="refund-badge-cliente" :class="'refund-cliente-' + (refundStatus[order.id] || 'null')">
          <i-lucide-check-circle v-if="refundIcon(order.id) === 'check-circle'" style="width:14px;height:14px" />
          <i-lucide-x-circle v-else-if="refundIcon(order.id) === 'x-circle'" style="width:14px;height:14px" />
          <i-lucide-clock v-else style="width:14px;height:14px" />
          {{ refundLabel(order.id) }}
        </div>

        <!-- Observações -->
        <div v-if="order.observacoes" class="order-note">
          <i-lucide-pen style="width:16px;height:16px" /> {{ order.observacoes }}
        </div>
      </div>

      <div v-if="hasMore" class="text-center p-3">
        <button class="btn btn-secondary" @click="loadMore">Carregar Mais</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { connectRealtime, onEvent, offEvent } from '../services/realtime'
import api from '../services/api'

const authStore = useAuthStore()
const orders = ref([])
const loading = ref(true)
const hasMore = ref(true)
const page = ref(0)

// Refund status
const refundStatus = ref({})
let refundPollingInterval = null

function isOnlinePayment(metodo) {
  return ['pix_online', 'credito_online'].includes(metodo)
}

function refundIcon(orderId) {
  const s = refundStatus.value[orderId]
  if (s === 'DONE') return 'check-circle'
  if (s === 'CANCELLED') return 'x-circle'
  return 'clock'
}

function refundLabel(orderId) {
  const s = refundStatus.value[orderId]
  if (s === 'DONE') return '✅ Estorno realizado'
  if (s === 'CANCELLED') return '❌ Estorno cancelado'
  return '⏳ Aguardando estorno'
}

async function checkRefundStatus(orderId) {
  try {
    const { data } = await api.get(`/pagamentos/${orderId}/refund-status`)
    if (data.refund_status) {
      refundStatus.value = { ...refundStatus.value, [orderId]: data.refund_status }
    } else if (data.deleted) {
      refundStatus.value = { ...refundStatus.value, [orderId]: 'DONE' }
    }
  } catch { /* silent */ }
}

function formatPrice(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function statusLabel(status, origem = 'delivery') {
  const isRet = origem === 'retirada'
  const labels = {
    aguardando_pagamento: 'Aguardando Pagamento ⏳',
    pendente: 'Pendente',
    preparando: 'Preparando',
    pronto_entrega: isRet ? 'Pronto para Retirada' : 'Saiu para Entrega',
    em_transito: 'Em Trânsito',
    cheguei_destino: 'Entregador no Local',
    entregue: isRet ? 'Retirado' : 'Entregue',
    cancelado: 'Cancelado',
    recusado: 'Recusado',
  }
  return labels[status] || status
}

function pagamentoLabel(metodo) {
  const labels = { credito: 'Cartão Crédito', debito: 'Cartão Débito', dinheiro: 'Dinheiro', pix: 'PIX', pix_online: 'PIX Online', credito_online: 'Cartão Online' }
  return labels[metodo] || metodo
}

function isActiveOrder(status) {
  return !['entregue', 'cancelado', 'recusado'].includes(status)
}

async function loadOrders() {
  if (!authStore.isAuthenticated) {
    loading.value = false
    return
  }

  try {
    const { data } = await api.get('/pedidos', {
      params: { limit: 20, offset: page.value * 20 },
    })
    orders.value = [...orders.value, ...data]
    hasMore.value = data.length === 20
    page.value++
  } catch {
    // Silent fail
  } finally {
    loading.value = false
  }
}

function loadMore() {
  loadOrders()
}

onMounted(() => {
  loadOrders()

  // Real-time updates
  onEvent('pedido:atualizado', (pedido) => {
    const index = orders.value.findIndex(o => o.id === pedido.id)
    if (index >= 0) {
      orders.value[index] = { ...orders.value[index], ...pedido }
    } else {
      orders.value.unshift(pedido)
    }
  })

  // Polling de refund a cada 10s para pedidos recusados/cancelados com pagamento online
  refundPollingInterval = setInterval(async () => {
    const recusados = orders.value.filter(o =>
      (o.status === 'cancelado' || o.status === 'recusado') &&
      isOnlinePayment(o.metodo_pagamento)
    )
    if (recusados.length === 0) return
    for (const order of recusados) {
      const s = refundStatus.value[order.id]
      if (s === 'DONE' || s === 'CANCELLED') continue
      await checkRefundStatus(order.id)
      await new Promise(r => setTimeout(r, 300))
    }
  }, 10000)

  // Verificação inicial
  setTimeout(() => {
    const recusados = orders.value.filter(o =>
      (o.status === 'cancelado' || o.status === 'recusado') &&
      isOnlinePayment(o.metodo_pagamento)
    )
    recusados.forEach(o => checkRefundStatus(o.id))
  }, 500)
})

onUnmounted(() => {
  offEvent('pedido:atualizado')
  if (refundPollingInterval) clearInterval(refundPollingInterval)
})
</script>

<style scoped>
/* Retirada badge */
.retirada-badge {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--info-light);
  color: #1e40af;
  font-size: 0.72rem;
  font-weight: 700;
  margin-bottom: 4px;
}

.order-items-obs {
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-style: italic;
  margin-bottom: 0.5rem;
  background: var(--warning-light);
  border-radius: 6px;
  padding: 4px 8px;
}

/* Refund badge no cliente */
.refund-badge-cliente {
  font-size: 0.8rem;
  margin-top: 8px;
  padding: 4px 10px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
}
.refund-badge-cliente svg { width: 14px; height: 14px; }

/* Variações de status */
.refund-badge-cliente.refund-cliente-null {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}
.refund-badge-cliente.refund-cliente-DONE {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}
.refund-badge-cliente.refund-cliente-CANCELLED {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}
.refund-badge-cliente.refund-cliente-AWAITING_CRITICAL_ACTION_AUTHORIZATION {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}
</style>
