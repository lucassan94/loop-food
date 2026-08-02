<template>
  <div>
    <div class="filter-bar">
      <div class="date-radio-group">
        <label class="date-radio" :class="{ active: dataPeriodo === 'hoje' }">
          <input type="radio" name="dataDashboard" value="hoje" v-model="dataPeriodo" @change="aplicarData()" />
          <span>Hoje</span>
        </label>
        <label class="date-radio" :class="{ active: dataPeriodo === 'ontem' }">
          <input type="radio" name="dataDashboard" value="ontem" v-model="dataPeriodo" @change="aplicarData()" />
          <span>Ontem</span>
        </label>
        <label class="date-radio" :class="{ active: dataPeriodo === '7dias' }">
          <input type="radio" name="dataDashboard" value="7dias" v-model="dataPeriodo" @change="aplicarData()" />
          <span>7 dias</span>
        </label>
        <label class="date-radio" :class="{ active: dataPeriodo === '30dias' }">
          <input type="radio" name="dataDashboard" value="30dias" v-model="dataPeriodo" @change="aplicarData()" />
          <span>30 dias</span>
        </label>
      </div>
    </div>

    <div v-if="loading" style="text-align:center;padding:3rem;">
      <div class="spinner" style="margin:0 auto;width:40px;height:40px;border:4px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;"></div>
    </div>

    <div v-else-if="erroCarregamento" class="card" style="text-align:center;padding:2rem;">
      <i-lucide-triangle-alert style="width:32px;height:32px;color:var(--error);margin-bottom:0.75rem;" />
      <p style="color:var(--error);font-weight:600;">{{ erroCarregamento }}</p>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-top:0.5rem;">Verifique sua sessão ou tente recarregar a página.</p>
      <button class="btn btn-primary btn-sm" style="margin-top:1rem;" @click="load">
        <i-lucide-refresh-cw class="h-4 w-4" /> Tentar novamente
      </button>
    </div>

    <template v-else-if="dados">
      <!-- KPIs -->
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Faturamento Total</div><div class="value primary">{{ formatPrice(dados.resumo?.faturamento_total || 0) }}</div></div>
        <div class="stat-card"><div class="label">Total de Pedidos</div><div class="value info">{{ dados.totais?.total_pedidos || 0 }}</div></div>
        <div class="stat-card"><div class="label">Ticket Médio</div><div class="value warning">{{ formatPrice(dados.resumo?.ticket_medio || 0) }}</div></div>
        <div class="stat-card"><div class="label">Pedidos Entregues</div><div class="value success">{{ dados.resumo?.pedidos_entregues || 0 }}</div></div>
        <div class="stat-card"><div class="label">Cancelados</div><div class="value" style="color:var(--error);">{{ dados.totais?.total_cancelados || 0 }}</div></div>
        <div class="stat-card"><div class="label">Taxa Cancelamento</div><div class="value" style="color:var(--error);">{{ dados.totais?.taxa_cancelamento || 0 }}%</div></div>
      </div>

      <!-- Tempos Médios -->
      <div class="card" style="margin-bottom:1.5rem;">
        <div class="card-header">Tempos Médios (últimos 30 dias)</div>
        <div class="card-body">
          <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);">
            <div class="stat-card"><div class="label">Até Aceite</div><div class="value info">{{ Math.round(dados.temposMedios?.tempo_ate_aceite || 0) }} min</div></div>
            <div class="stat-card"><div class="label">Preparo</div><div class="value warning">{{ Math.round(dados.temposMedios?.tempo_preparo || 0) }} min</div></div>
            <div class="stat-card"><div class="label">Entrega</div><div class="value primary">{{ Math.round(dados.temposMedios?.tempo_entrega || 0) }} min</div></div>
          </div>
        </div>
      </div>

      <!-- Status Distribution & Top Products -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
        <!-- Status Distribution -->
        <div class="card">
          <div class="card-header">Status dos Pedidos</div>
          <div class="card-body">
            <div v-for="s in dados.statusDistribuicao" :key="s.status" class="chart-bar">
              <span class="bar-label">{{ statusLabel(s.status) }}</span>
              <div class="bar-track">
                <div class="bar-fill" :style="{ width: percent(s.quantidade, totalOrders) + '%', background: statusColor(s.status) }">
                  {{ s.quantidade }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Top Products -->
        <div class="card">
          <div class="card-header">Produtos Mais Vendidos</div>
          <div class="card-body">
            <div v-for="(p, i) in dados.topProdutos" :key="i" style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-light);font-size:0.9rem;">
              <span><strong>{{ i + 1 }}.</strong> {{ p.nome_produto }} <span style="color:var(--text-muted);font-size:0.8rem;">({{ p.quantidade_vendida }} vendidos)</span></span>
              <strong>{{ formatPrice(p.receita_gerada) }}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- Payment Methods -->
      <div class="card" style="margin-top:1.5rem;">
        <div class="card-header">Meios de Pagamento</div>
        <div class="card-body">
          <div v-for="p in dados.pagamentos" :key="p.metodo_pagamento" class="chart-bar">
            <span class="bar-label">{{ paymentLabel(p.metodo_pagamento) }}</span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: percent(p.quantidade, totalOrders) + '%', background: '#3b82f6' }">
                {{ p.quantidade }} pedidos
              </div>
            </div>
            <span class="bar-value">{{ formatPrice(p.receita) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../services/api'

const dados = ref(null)
const loading = ref(true)
const erroCarregamento = ref('')
const hoje = new Date().toISOString().split('T')[0]
const dataPeriodo = ref('hoje')
const dataInicio = ref(hoje)
const dataFim = ref('')

function aplicarData() {
  const hojeStr = new Date().toISOString().split('T')[0]
  if (dataPeriodo.value === 'hoje') {
    dataInicio.value = hojeStr; dataFim.value = ''
  } else if (dataPeriodo.value === 'ontem') {
    const d = new Date(); d.setDate(d.getDate() - 1)
    dataInicio.value = d.toISOString().split('T')[0]; dataFim.value = ''
  } else if (dataPeriodo.value === '7dias') {
    const d = new Date(); d.setDate(d.getDate() - 7)
    dataInicio.value = d.toISOString().split('T')[0]; dataFim.value = ''
  } else if (dataPeriodo.value === '30dias') {
    const d = new Date(); d.setDate(d.getDate() - 30)
    dataInicio.value = d.toISOString().split('T')[0]; dataFim.value = ''
  }
  load()
}

function formatPrice(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) }

const totalOrders = computed(() => dados.value?.statusDistribuicao?.reduce((a, s) => a + parseInt(s.quantidade), 0) || 1)

function percent(qty, total) { return total > 0 ? (parseInt(qty) / total) * 100 : 0 }

function statusLabel(s) {
  const l = { pendente: 'Pendente', preparando: 'Preparando', pronto_entrega: 'Pronto', em_transito: 'Em Rota', cheguei_destino: 'No Local', entregue: 'Entregue', cancelado: 'Cancelado', recusado: 'Recusado' }
  return l[s] || s
}

function statusColor(s) {
  const c = { pendente: '#f59e0b', preparando: '#3b82f6', pronto_entrega: '#8b5cf6', em_transito: '#f59e0b', cheguei_destino: '#dc2626', entregue: '#16a34a', cancelado: '#ef4444', recusado: '#ef4444' }
  return c[s] || '#94a3b8'
}

function paymentLabel(m) {
  const l = { credito: 'Cartão Crédito', debito: 'Cartão Débito', dinheiro: 'Dinheiro', pix: 'PIX' }
  return l[m] || m
}

async function load() {
  loading.value = true
  erroCarregamento.value = ''
  try {
    const { data } = await api.get('/dashboard', {
      params: { data_inicio: dataInicio.value || undefined, data_fim: dataFim.value || undefined }
    })
    dados.value = data
  } catch (err) {
    erroCarregamento.value = err.response?.data?.error || 'Erro ao carregar dados do dashboard.'
    console.error('[Dashboard] Erro ao carregar:', err?.response?.data || err.message)
  }
  finally { loading.value = false }
}

onMounted(load)
</script>
<style scoped>
.spinner { border: 4px solid #e2e8f0; border-top-color: #dc2626; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto; }
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
.date-radio:hover { color: var(--text); }
.date-radio.active {
  background: var(--surface);
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.date-radio input[type="radio"] { display: none; }

@keyframes spin { to { transform: rotate(360deg); } }
</style>
