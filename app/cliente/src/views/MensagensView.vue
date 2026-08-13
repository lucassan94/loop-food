<template>
  <div class="mensagens-view">
    <!-- Não autenticado -->
    <div v-if="!authStore.isAuthenticated" class="empty-state">
      <i-lucide-message-circle style="width:52px;height:52px;opacity:.4" />
      <p>Faça login para conversar com o restaurante.</p>
      <router-link to="/auth" class="btn btn-primary mt-3">Entrar</router-link>
    </div>

    <template v-else>
      <div class="msg-header">
        <h2><i-lucide-message-circle style="width:20px;height:20px" /> Mensagens</h2>
      </div>

      <div v-if="carregando" class="loading-wrapper">
        <div class="spinner spinner-center"></div>
      </div>

      <div v-else-if="conversas.length === 0" class="empty-state">
        <i-lucide-message-circle style="width:52px;height:52px;opacity:.4" />
        <p>Nenhuma conversa ainda.<br />Quando o restaurante mandar uma mensagem sobre um pedido, ela aparece aqui.</p>
      </div>

      <div v-else class="conv-list">
        <button
          v-for="c in conversas"
          :key="c.pedido_id"
          class="conv-item"
          @click="abrirConversa(c)"
        >
          <div class="conv-avatar">{{ inicial(c.nome_cliente || 'R') }}</div>
          <div class="conv-body">
            <div class="conv-top">
              <span class="conv-ref">{{ c.ref }}</span>
              <span class="conv-time">{{ formatHora(c.ultima?.criado_em || c.criado_em) }}</span>
            </div>
            <div class="conv-mid">
              <span class="status-pill" :class="c.status">{{ statusLabel(c.status) }}</span>
              <span v-if="c.nao_lidas" class="conv-unread">{{ c.nao_lidas }}</span>
            </div>
            <div class="conv-preview">{{ preview(c.ultima) }}</div>
          </div>
        </button>
      </div>
    </template>

    <!-- Thread (conversa aberta) -->
    <div v-if="conversaAtiva" class="thread-overlay">
      <div class="thread">
        <div class="thread-header">
          <button class="thread-back" @click="fecharThread">
            <i-lucide-arrow-left style="width:20px;height:20px" />
          </button>
          <div class="thread-title">
            <strong>{{ conversaAtiva.ref }}</strong>
            <span :class="['status-pill', conversaAtiva.status]">{{ statusLabel(conversaAtiva.status) }}</span>
          </div>
          <router-link :to="`/pedidos/${conversaAtiva.pedido_id}`" class="thread-track">
            <i-lucide-map-pin style="width:20px;height:20px" />
          </router-link>
        </div>

        <div ref="threadScroll" class="thread-msgs">
          <div
            v-for="m in mensagens"
            :key="m.id"
            class="msg"
            :class="m.remetente === 'cliente' ? 'out' : 'in'"
          >
            <div class="bubble">{{ m.mensagem }}</div>
            <div class="msg-meta">
              {{ formatHora(m.criado_em) }}
              <span v-if="m.remetente === 'cliente'" class="receipt" :class="{ read: m.lida }">
                {{ m.lida ? '✓✓' : '✓' }}
              </span>
            </div>
          </div>
        </div>

        <div class="thread-input">
          <textarea
            v-model="texto"
            rows="1"
            placeholder="Digite sua mensagem..."
            @keydown.enter.exact.prevent="enviar"
            :disabled="enviando"
          ></textarea>
          <button class="btn-send" :disabled="!texto.trim() || enviando" @click="enviar">
            <i-lucide-send style="width:18px;height:18px" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { onEvent, offEvent } from '../services/realtime'
import api from '../services/api'

const authStore = useAuthStore()

const conversas = ref([])
const carregando = ref(true)
const conversaAtiva = ref(null)
const mensagens = ref([])
const texto = ref('')
const enviando = ref(false)
const threadScroll = ref(null)

function inicial(nome) {
  return (nome || 'R').trim().charAt(0).toUpperCase()
}

function formatHora(d) {
  if (!d) return ''
  const date = new Date(d)
  const hoje = new Date()
  const mesmoDia = date.toDateString() === hoje.toDateString()
  const hora = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (mesmoDia) return hora
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora
}

function statusLabel(status) {
  const labels = {
    aguardando_pagamento: 'Aguardando pagamento',
    pendente: 'Pendente',
    preparando: 'Preparando',
    pronto_entrega: 'Saiu para entrega',
    pronto: 'Pronto para retirar',
    em_transito: 'Em trânsito',
    cheguei_destino: 'Entregador chegou',
    entregue: 'Entregue',
    finalizado: 'Finalizado',
    cancelado: 'Cancelado',
    recusado: 'Recusado',
  }
  return labels[status] || status
}

function preview(ultima) {
  if (!ultima) return ''
  const prefixo = ultima.remetente === 'restaurante' ? '🍳 ' : '👤 '
  const t = String(ultima.mensagem || '')
  return prefixo + (t.length > 58 ? t.slice(0, 58) + '…' : t)
}

async function carregarConversas() {
  carregando.value = true
  try {
    const { data } = await api.get('/pedidos/mensagens/conversas')
    conversas.value = data.conversas || []
  } catch {
    conversas.value = []
  } finally {
    carregando.value = false
  }
}

async function abrirConversa(conversa) {
  conversaAtiva.value = conversa
  mensagens.value = []
  texto.value = ''
  try {
    const { data } = await api.get(`/pedidos/${conversa.pedido_id}`)
    mensagens.value = (data.mensagens || []).slice().sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
  } catch {
    mensagens.value = []
  }
  // Zerar não lidas localmente e marcar como lidas no servidor
  const conv = conversas.value.find((c) => c.pedido_id === conversa.pedido_id)
  if (conv) conv.nao_lidas = 0
  try {
    await api.post(`/pedidos/${conversa.pedido_id}/mensagens/ler`)
  } catch {
    /* silencioso */
  }
  scrollChat()
}

function fecharThread() {
  conversaAtiva.value = null
  mensagens.value = []
  texto.value = ''
}

async function enviar() {
  const t = texto.value.trim()
  if (!t || !conversaAtiva.value || enviando.value) return
  enviando.value = true
  texto.value = ''
  try {
    const { data } = await api.post(`/pedidos/${conversaAtiva.value.pedido_id}/mensagens`, { mensagem: t })
    mensagens.value.push(data)
    const conv = conversas.value.find((c) => c.pedido_id === data.pedido_id)
    if (conv) conv.ultima = { id: data.id, mensagem: data.mensagem, remetente: data.remetente, criado_em: data.criado_em }
    scrollChat()
  } catch (err) {
    texto.value = t
    // Toast leve via elemento (mesmo padrão do TrackingView)
    const toast = document.createElement('div')
    toast.className = 'toast-notification error'
    toast.textContent = err.response?.data?.error || 'Não foi possível enviar. Tente novamente.'
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 3000)
  } finally {
    enviando.value = false
  }
}

function scrollChat() {
  setTimeout(() => {
    if (threadScroll.value) threadScroll.value.scrollTop = threadScroll.value.scrollHeight
  }, 60)
}

onMounted(() => {
  carregarConversas()

  onEvent('mensagem:novo', (m) => {
    if (conversaAtiva.value && conversaAtiva.value.pedido_id === m.pedido_id) {
      if (!mensagens.value.some((x) => x.id === m.id)) {
        mensagens.value.push(m)
        scrollChat()
      }
      // Cliente viu a mensagem do restaurante em tempo real → marca como lida
      if (m.remetente === 'restaurante') {
        try {
          api.post(`/pedidos/${conversaAtiva.value.pedido_id}/mensagens/ler`)
        } catch { /* silencioso */ }
      }
    } else {
      const conv = conversas.value.find((c) => c.pedido_id === m.pedido_id)
      if (conv) {
        if (m.remetente === 'restaurante') conv.nao_lidas = (conv.nao_lidas || 0) + 1
        conv.ultima = { id: m.id, mensagem: m.mensagem, remetente: m.remetente, criado_em: m.criado_em }
      } else {
        carregarConversas()
      }
    }
  })

  onEvent('mensagem:lida', (data) => {
    // Restaurante leu → mostra ✓✓ nas minhas mensagens
    if (data.pedido_id && data.lida) {
      mensagens.value.forEach((m) => {
        if (m.remetente === 'cliente') m.lida = true
      })
    }
  })
})

onUnmounted(() => {
  offEvent('mensagem:novo')
  offEvent('mensagem:lida')
})
</script>

<style scoped>
.mensagens-view {
  padding: 1rem 1rem calc(80px + env(safe-area-inset-bottom, 0px));
  min-height: 100vh;
}
.msg-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.25rem;
  margin-bottom: 1rem;
  color: var(--text);
}
.empty-state {
  text-align: center;
  padding: 3rem 1.5rem;
  color: var(--text-muted);
  font-size: 0.9rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

/* ── Lista de conversas ── */
.conv-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.conv-item {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  cursor: pointer;
  transition: var(--transition);
  font-family: inherit;
}
.conv-item:hover, .conv-item:active {
  border-color: var(--primary);
  box-shadow: 0 4px 14px rgba(0,0,0,0.08);
}
.conv-avatar {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--primary-light);
  color: var(--primary-dark);
  font-weight: 800;
  font-size: 1.05rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.conv-body { flex: 1; min-width: 0; }
.conv-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.conv-ref { font-weight: 700; color: var(--text); }
.conv-time { font-size: 0.7rem; color: var(--text-muted); white-space: nowrap; }
.conv-mid {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
}
.status-pill {
  display: inline-flex;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 700;
  background: var(--info-light);
  color: var(--primary-dark);
}
.status-pill.entregue, .status-pill.finalizado {
  background: #dcfce7;
  color: #166534;
}
.status-pill.cancelado, .status-pill.recusado {
  background: #fee2e2;
  color: #991b1b;
}
.conv-unread {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.conv-preview {
  font-size: 0.8rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Thread ── */
.thread-overlay {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: var(--background);
  display: flex;
  flex-direction: column;
}
.thread {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}
.thread-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0.9rem 1rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 2;
}
.thread-back {
  border: none;
  background: none;
  color: var(--primary);
  cursor: pointer;
  padding: 4px;
  display: flex;
}
.thread-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.thread-title strong { font-size: 1rem; }
.thread-track {
  color: var(--primary);
  display: flex;
  padding: 6px;
}
.thread-msgs {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.msg {
  display: flex;
  flex-direction: column;
  max-width: 82%;
}
.msg.in { align-self: flex-start; align-items: flex-start; }
.msg.out { align-self: flex-end; align-items: flex-end; }
.bubble {
  padding: 10px 14px;
  border-radius: 18px;
  font-size: 0.9rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.in .bubble {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  border-bottom-left-radius: 6px;
}
.msg.out .bubble {
  background: var(--primary);
  color: #fff;
  border-bottom-right-radius: 6px;
}
.msg-meta {
  font-size: 0.65rem;
  color: var(--text-muted);
  margin-top: 3px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.receipt { color: var(--text-muted); font-weight: 700; }
.receipt.read { color: var(--primary); }
.thread-input {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 0.7rem 1rem calc(0.7rem + env(safe-area-inset-bottom, 0px));
  background: var(--surface);
  border-top: 1px solid var(--border);
}
.thread-input textarea {
  flex: 1;
  resize: none;
  border: 1.5px solid var(--border);
  border-radius: 20px;
  padding: 10px 14px;
  font-family: inherit;
  font-size: 0.9rem;
  outline: none;
  max-height: 110px;
  background: var(--background);
  color: var(--text);
  transition: border-color var(--transition);
}
.thread-input textarea:focus { border-color: var(--primary); }
.btn-send {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: var(--transition);
}
.btn-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn-send:not(:disabled):active { transform: scale(0.94); }
</style>
