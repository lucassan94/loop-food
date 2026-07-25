<template>
  <div>
    <!-- Table Selector -->
    <div class="filter-bar" style="display:flex;gap:0.75rem;align-items:flex-end;flex-wrap:wrap;">
      <div class="form-group" style="margin:0;flex:1;min-width:200px;">
        <label style="font-size:0.8rem;font-weight:600;color:var(--text-secondary);margin-bottom:4px;display:block;">
          <i class="fas fa-database"></i> Tabela
        </label>
        <select v-model="selectedTable" @change="loadData" style="width:100%;padding:0.6rem 0.75rem;border:1.5px solid var(--border);border-radius:6px;font-size:0.9rem;">
          <option value="">Selecione uma tabela...</option>
          <option v-for="t in tables" :key="t.slug" :value="t.slug">{{ t.label }}</option>
        </select>
      </div>
      <button class="btn btn-primary btn-sm" @click="loadData" :disabled="!selectedTable || loading">
        <i :class="loading ? 'fas fa-spinner fa-spin' : 'fas fa-sync'"></i>
        {{ loading ? 'Carregando...' : 'Carregar' }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" style="text-align:center;padding:3rem;">
      <div class="spinner" style="margin:0 auto;width:40px;height:40px;border:4px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;"></div>
    </div>

    <!-- Empty State -->
    <div v-else-if="selectedTable && registros.length === 0 && !loading" class="card" style="text-align:center;padding:2rem;margin-top:1rem;">
      <i class="fas fa-inbox" style="font-size:2rem;color:var(--text-muted);margin-bottom:0.75rem;"></i>
      <p style="color:var(--text-muted);">Nenhum registro encontrado.</p>
    </div>

    <!-- Data Table -->
    <div v-else-if="selectedTable && registros.length > 0" class="card" style="margin-top:1rem;overflow-x:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
        <span style="font-size:0.85rem;color:var(--text-muted);">
          {{ total }} registro(s) — exibindo {{ registros.length }}
        </span>
      </div>

      <table class="data-table" style="font-size:0.8rem;">
        <thead>
          <tr>
            <th v-for="col in visibleColumns" :key="col" style="white-space:nowrap;">
              {{ columnLabel(col) }}
            </th>
            <th style="width:80px;">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in registros" :key="row.id">
            <td v-for="col in visibleColumns" :key="col" style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              <!-- Edit mode -->
              <template v-if="editingId === row.id && editColumns.includes(col)">
                <input
                  v-model="editForm[col]"
                  :type="isNumericColumn(col) ? 'number' : 'text'"
                  step="any"
                  style="width:100%;padding:4px 6px;border:1.5px solid var(--primary);border-radius:4px;font-size:0.8rem;"
                  @keydown.enter="salvarEdicao(row)"
                  @keydown.escape="cancelarEdicao"
                />
              </template>
              <!-- View mode -->
              <template v-else>
                <span v-if="col.endsWith('_base64') || (typeof row[col] === 'string' && row[col]?.startsWith('data:image'))" style="display:flex;align-items:center;gap:6px;">
                  <img v-if="row[col]" :src="row[col].startsWith('data:') ? row[col] : 'data:image/jpeg;base64,' + row[col]" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" />
                  <span style="font-size:0.7rem;color:var(--text-muted);">[imagem]</span>
                </span>
                <span v-else-if="row[col] === null || row[col] === undefined" style="color:var(--text-muted);font-style:italic;">—</span>
                <span v-else-if="col === 'senha_hash'" style="color:var(--text-muted);">••••••••</span>
                <span v-else-if="isLongText(row[col])" :title="row[col]">
                  {{ truncate(row[col], 60) }}
                </span>
                <span v-else>{{ formatValue(row[col]) }}</span>
              </template>
            </td>
            <td>
              <div style="display:flex;gap:4px;">
                <button
                  v-if="editingId !== row.id"
                  class="btn btn-sm btn-primary"
                  style="font-size:0.7rem;padding:4px 8px;"
                  @click="iniciarEdicao(row)"
                  :title="'Editar ' + t.colunaChave + '=' + row.id"
                >
                  <i class="fas fa-edit"></i>
                </button>
                <button
                  v-if="editingId === row.id"
                  class="btn btn-sm btn-success"
                  style="font-size:0.7rem;padding:4px 8px;"
                  @click="salvarEdicao(row)"
                >
                  <i class="fas fa-check"></i>
                </button>
                <button
                  v-if="editingId === row.id"
                  class="btn btn-sm btn-secondary"
                  style="font-size:0.7rem;padding:4px 8px;"
                  @click="cancelarEdicao"
                >
                  <i class="fas fa-times"></i>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Feedback -->
    <div v-if="feedback" class="feedback-toast" :class="feedback.tipo" @click="feedback = null" style="position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:9999;padding:0.75rem 1.5rem;border-radius:8px;font-size:0.85rem;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.15);cursor:pointer;">
      <i :class="feedback.tipo === 'success' ? 'fas fa-check-circle' : 'fas fa-exclamation-triangle'"></i>
      {{ feedback.msg }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, inject } from 'vue'
import api from '../services/api'

const globalLoading = inject('globalLoading')
const loadingMessage = inject('loadingMessage')

const tables = ref([])
const selectedTable = ref('')
const registros = ref([])
const total = ref(0)
const colunas = ref([])
const loading = ref(false)
const feedback = ref(null)

// Edit state
const editingId = ref(null)
const editForm = ref({})
const editColumns = ref([])

// Colunas que não devem aparecer na tabela
const colunasOcultas = ['senha_hash', 'imagem_base64']

const visibleColumns = computed(() => {
  return colunas.value.filter(c => !colunasOcultas.includes(c))
})

// Colunas numéricas (para input type number)
function isNumericColumn(col) {
  return ['preco', 'subtotal', 'total', 'valor_frete', 'custo', 'latitude', 'longitude', 'preco_unitario', 'quantidade', 'pedidos_total', 'total_gasto', 'entregas_total', 'frete_total_recebido', 'tempo_min', 'tempo_max', 'raio_km'].includes(col)
}

function isLongText(val) {
  return typeof val === 'string' && val.length > 80
}

function truncate(text, max) {
  if (!text) return ''
  return text.length > max ? text.substring(0, max) + '...' : text
}

function formatValue(val) {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'boolean') return val ? 'Sim' : 'Não'
  if (typeof val === 'number') {
    // Formatar como moeda se parecer preço
    if (String(val).includes('.') && val < 100000) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)
    }
    return val.toLocaleString('pt-BR')
  }
  if (val instanceof Date || (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}T/))) {
    return new Date(val).toLocaleString('pt-BR')
  }
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function columnLabel(col) {
  const labels = {
    id: 'ID',
    pedido_id: 'Pedido #',
    nome: 'Nome',
    sobrenome: 'Sobrenome',
    email: 'E-mail',
    telefone: 'Telefone',
    senha_hash: 'Senha',
    cargo: 'Cargo',
    status: 'Status',
    ativo: 'Ativo',
    preco: 'Preço',
    descricao: 'Descrição',
    categoria_slug: 'Cat. Slug',
    categoria_nome: 'Categoria',
    criado_em: 'Criado em',
    atualizado_em: 'Atualizado em',
    endereco: 'Endereço',
    numero: 'Número',
    bairro: 'Bairro',
    complemento: 'Complemento',
    cidade: 'Cidade',
    estado: 'Estado',
    cep: 'CEP',
    cpf_cnpj: 'CPF/CNPJ',
    subtotal: 'Subtotal',
    total: 'Total',
    valor_frete: 'Frete',
    metodo_pagamento: 'Pagamento',
    observacoes: 'Observações',
    motivo_cancelamento: 'Motivo Cancel.',
    cliente_id: 'Cliente ID',
    entregador_id: 'Entregador ID',
    restaurant_id: 'Rest. ID',
    imagem_url: 'Imagem URL',
    imagem_base64: 'Imagem',
    raio_km: 'Raio (KM)',
    tempo_min: 'Tempo Mín',
    tempo_max: 'Tempo Máx',
    custo: 'Custo (R$)',
    quantidade: 'Qtd',
    preco_unitario: 'Preço Unit.',
    produto_id: 'Produto ID',
    nome_produto: 'Produto',
  }
  return labels[col] || col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

function showFeedback(msg, tipo = 'success') {
  feedback.value = { msg, tipo }
  setTimeout(() => { feedback.value = null }, 4000)
}

async function carregarTabelas() {
  try {
    const { data } = await api.get('/admin-data/tables')
    tables.value = data
  } catch (err) {
    showFeedback('Erro ao carregar lista de tabelas: ' + (err.response?.data?.error || err.message), 'erro')
  }
}

async function loadData() {
  if (!selectedTable.value) return
  loading.value = true
  try {
    const { data } = await api.get(`/admin-data/${selectedTable.value}`, {
      params: { limit: 200 }
    })
    registros.value = data.registros
    total.value = data.total
    colunas.value = data.colunas.filter(c => !colunasOcultas.includes(c))
  } catch (err) {
    showFeedback('Erro ao carregar dados: ' + (err.response?.data?.error || err.message), 'erro')
  } finally {
    loading.value = false
  }
}

function iniciarEdicao(row) {
  editingId.value = row.id
  const tableMeta = tables.value.find(t => t.slug === selectedTable.value)
  editColumns.value = tableMeta?.colunasAtualizaveis || []
  editForm.value = {}
  for (const col of editColumns.value) {
    editForm.value[col] = row[col]
  }
}

function cancelarEdicao() {
  editingId.value = null
  editForm.value = {}
}

async function salvarEdicao(row) {
  globalLoading.value = true
  loadingMessage.value = 'Salvando alterações...'
  try {
    await api.put(`/admin-data/${selectedTable.value}/${row.id}`, editForm.value)
    showFeedback('Registro atualizado com sucesso!', 'success')
    await loadData()
    cancelarEdicao()
  } catch (err) {
    showFeedback('Erro ao atualizar: ' + (err.response?.data?.error || err.message), 'erro')
  } finally {
    globalLoading.value = false
  }
}

onMounted(() => {
  carregarTabelas()
})
</script>

<style scoped>
.spinner {
  border: 4px solid #e2e8f0;
  border-top-color: #dc2626;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
