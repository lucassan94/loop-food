<template>
  <div>
    <!-- Feedback Toast -->
    <div v-if="feedbackMsg" class="feedback-toast" :class="feedbackMsg.tipo" @click="feedbackMsg = null">
      <i :class="feedbackMsg.tipo === 'success' ? 'fas fa-check-circle' : 'fas fa-exclamation-triangle'"></i>
      {{ feedbackMsg.texto }}
    </div>

    <div class="filter-bar">
      <input v-model="busca" placeholder="Buscar por nome, email ou telefone..." style="flex:1;" @keyup.enter="load" />
      <button class="btn btn-primary btn-sm" @click="load"><i class="fas fa-search"></i> Buscar</button>
    </div>

    <div class="card">
      <table class="data-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>E-mail</th>
            <th>Telefone</th>
            <th>Endereço</th>
            <th>Pedidos</th>
            <th>Total Gasto</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in clientes" :key="c.id">
            <td><strong>{{ c.nome }} {{ c.sobrenome }}</strong></td>
            <td>{{ c.email }}</td>
            <td>{{ c.telefone || '—' }}</td>
            <td style="font-size:0.8rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              {{ c.endereco || '—' }}
            </td>
            <td>{{ c.pedidos_total }}</td>
            <td><strong>{{ formatPrice(c.total_gasto) }}</strong></td>
            <td>
              <button class="btn btn-sm btn-outline" @click="editarCliente(c)" title="Editar cliente">
                <i class="fas fa-edit"></i>
              </button>
              <button class="btn btn-sm btn-secondary" @click="verDetalhes(c.id)" style="margin-left:4px;" title="Ver detalhes">
                <i class="fas fa-eye"></i>
              </button>
            </td>
          </tr>
          <tr v-if="clientes.length === 0">
            <td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">
              <i class="fas fa-users" style="font-size:1.5rem;display:block;margin-bottom:0.5rem;"></i>
              Nenhum cliente encontrado
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Edit Modal -->
    <div v-if="editModal" class="modal-overlay" @click.self="editModal = false">
      <div class="modal-content" style="max-width:550px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
          <h3 style="font-size:1.1rem;">
            <i class="fas fa-user-edit"></i> Editar Cliente
          </h3>
          <button class="drawer-close" @click="editModal = false">&times;</button>
        </div>

        <div v-if="formErro" class="form-error-banner">
          <i class="fas fa-exclamation-triangle"></i> {{ formErro }}
        </div>

        <!-- Dados Pessoais -->
        <div class="form-section-title">Dados Pessoais</div>
        <div class="form-row">
          <div class="form-group" style="flex:1;">
            <label>Nome</label>
            <input v-model="editForm.nome" placeholder="Nome" />
          </div>
          <div class="form-group" style="flex:1;">
            <label>Sobrenome</label>
            <input v-model="editForm.sobrenome" placeholder="Sobrenome" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group" style="flex:1.5;">
            <label>E-mail</label>
            <input v-model="editForm.email" type="email" placeholder="email@exemplo.com" />
          </div>
          <div class="form-group" style="flex:1;">
            <label>Telefone</label>
            <input v-model="editForm.telefone" placeholder="(11) 99999-9999" />
          </div>
        </div>

        <div class="form-group">
          <label>CPF</label>
          <input v-model="editForm.cpf_cnpj" placeholder="000.000.000-00" />
        </div>

        <!-- Endereço com CEP -->
        <div class="form-section-title">Endereço</div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;">
          <div class="form-group" style="margin-bottom:0;">
            <label>CEP</label>
            <input v-model="editForm.cep" maxlength="9" placeholder="00000-000" @input="formatCEP" />
          </div>
          <div style="display:flex;align-items:flex-end;">
            <button class="btn btn-secondary" style="width:100%;height:42px;" @click="buscarCEP" :disabled="buscandoCEP">
              {{ buscandoCEP ? 'Buscando...' : 'Buscar CEP' }}
            </button>
          </div>
        </div>

        <div v-if="cepMsg" class="cep-result" :class="cepMsg.tipo" style="margin:0.75rem 0;">
          <i :class="cepMsg.tipo === 'success' ? 'fas fa-check-circle' : 'fas fa-times-circle'"></i>
          {{ cepMsg.texto }}
        </div>

        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label>Endereço (Rua / Av.)</label>
            <input v-model="editForm.endereco" placeholder="Rua, número..." />
          </div>
          <div class="form-group" style="flex:0.5;">
            <label>Número</label>
            <input v-model="editForm.numero" placeholder="Nº" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Bairro</label>
            <input v-model="editForm.bairro" placeholder="Bairro" />
          </div>
          <div class="form-group">
            <label>Complemento</label>
            <input v-model="editForm.complemento" placeholder="Apto, Bloco..." />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group" style="flex:2;">
            <label>Cidade</label>
            <input v-model="editForm.cidade" placeholder="Cidade" />
          </div>
          <div class="form-group" style="flex:1;">
            <label>Estado</label>
            <input v-model="editForm.estado" maxlength="2" placeholder="SP" style="text-transform:uppercase;" />
          </div>
        </div>

        <!-- Ações -->
        <div style="display:flex;gap:8px;margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border);">
          <button class="btn btn-primary" style="flex:1;justify-content:center;" @click="salvarEdicao" :disabled="salvando">
            <i :class="salvando ? 'fas fa-spinner fa-spin' : 'fas fa-save'"></i>
            {{ salvando ? 'Salvando...' : 'Salvar Alterações' }}
          </button>
          <button class="btn btn-secondary" style="justify-content:center;" @click="editModal = false">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- Detail Modal -->
    <div v-if="selectedCliente" class="modal-overlay" @click.self="selectedCliente = null">
      <div class="modal-content" style="max-width:500px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h3>{{ selectedCliente.nome }} {{ selectedCliente.sobrenome }}</h3>
          <button class="drawer-close" @click="selectedCliente = null">&times;</button>
        </div>

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">
          <span class="info-chip"><i class="fas fa-envelope"></i> {{ selectedCliente.email }}</span>
          <span class="info-chip"><i class="fas fa-phone"></i> {{ selectedCliente.telefone || '—' }}</span>
        </div>

        <div class="profile-section">
          <div class="profile-section-title">Endereço</div>
          <p style="font-size:0.85rem;">
            {{ selectedCliente.endereco }}, {{ selectedCliente.numero || 'S/N' }}
            <template v-if="selectedCliente.bairro"> — {{ selectedCliente.bairro }}</template>
            <br />
            {{ selectedCliente.cidade || 'São Paulo' }}/{{ selectedCliente.estado || 'SP' }}
            <template v-if="selectedCliente.cep"> — CEP {{ selectedCliente.cep }}</template>
          </p>
        </div>

        <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin:1rem 0;">
          <div class="stat-card">
            <div class="label">Pedidos</div>
            <div class="value info">{{ selectedCliente.pedidos_total }}</div>
          </div>
          <div class="stat-card">
            <div class="label">Total Gasto</div>
            <div class="value primary">{{ formatPrice(selectedCliente.total_gasto) }}</div>
          </div>
          <div class="stat-card">
            <div class="label">Favorito</div>
            <div class="value" style="font-size:0.9rem;margin-top:8px;">{{ selectedCliente.produtoMaisComprado || '—' }}</div>
          </div>
        </div>

        <div v-if="selectedCliente.ultimosPedidos?.length" class="profile-section">
          <div class="profile-section-title">Últimos Pedidos</div>
          <div v-for="p in selectedCliente.ultimosPedidos" :key="p.id" class="pedido-row">
            <span><strong>{{ p.pedido_id }}</strong></span>
            <span>{{ formatPrice(p.total) }}</span>
            <span style="color:var(--text-muted);font-size:0.75rem;">{{ new Date(p.criado_em).toLocaleDateString('pt-BR') }}</span>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:1rem;">
          <button class="btn btn-secondary" style="flex:1;justify-content:center;" @click="selectedCliente = null">Fechar</button>
          <button class="btn btn-primary" style="flex:1;justify-content:center;" @click="editarDeDetalhes(selectedCliente)">
            <i class="fas fa-edit"></i> Editar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import api from '../services/api'

const feedbackMsg = ref(null)
function showFeedback(texto, tipo = 'success') {
  feedbackMsg.value = { texto, tipo }
  setTimeout(() => { feedbackMsg.value = null }, 4000)
}

const clientes = ref([])
const busca = ref('')
const selectedCliente = ref(null)
const editModal = ref(false)
const editForm = reactive({
  id: null, nome: '', sobrenome: '', email: '', telefone: '',
  cep: '', endereco: '', numero: '', bairro: '', complemento: '',
  cidade: '', estado: '', cpf_cnpj: ''
})
const formErro = ref('')
const salvando = ref(false)
const buscandoCEP = ref(false)
const cepMsg = ref(null)

function formatPrice(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

async function load() {
  try {
    const { data } = await api.get('/clientes', {
      params: {
        busca: busca.value || undefined,
        ordenar_por: 'total_gasto',
        ordem: 'desc'
      }
    })
    clientes.value = data
  } catch { /* ignore */ }
}

async function verDetalhes(id) {
  try {
    const { data } = await api.get(`/clientes/${id}`)
    selectedCliente.value = data
  } catch { /* ignore */ }
}

// ── Editar ──
function editarCliente(c) {
  editForm.id = c.id
  editForm.nome = c.nome || ''
  editForm.sobrenome = c.sobrenome || ''
  editForm.email = c.email || ''
  editForm.telefone = c.telefone || ''
  editForm.cep = c.cep || ''
  editForm.endereco = c.endereco || ''
  editForm.numero = c.numero || ''
  editForm.bairro = c.bairro || ''
  editForm.complemento = c.complemento || ''
  editForm.cidade = c.cidade || ''
  editForm.estado = c.estado || ''
  editForm.cpf_cnpj = c.cpf_cnpj || ''
  formErro.value = ''
  cepMsg.value = null
  editModal.value = true
}

function editarDeDetalhes(cliente) {
  selectedCliente.value = null
  editarCliente(cliente)
}

// ── CEP ──
function formatCEP() {
  editForm.cep = editForm.cep.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substring(0, 9)
}

async function buscarCEP() {
  const cep = editForm.cep.replace(/\D/g, '')
  if (cep.length !== 8) {
    cepMsg.value = { tipo: 'error', texto: 'CEP deve ter 8 dígitos.' }
    return
  }

  buscandoCEP.value = true
  cepMsg.value = null

  try {
    const { data } = await api.post('/cep', { cep })
    if (data.logradouro) editForm.endereco = data.logradouro
    if (data.bairro) editForm.bairro = data.bairro
    if (data.cidade) editForm.cidade = data.cidade
    if (data.estado) editForm.estado = data.estado

    cepMsg.value = {
      tipo: 'success',
      texto: `Endereço preenchido: ${data.logradouro || ''}, ${data.bairro || ''}, ${data.cidade || ''}/${data.estado || ''}`,
    }
  } catch (err) {
    cepMsg.value = { tipo: 'error', texto: err.response?.data?.error || 'CEP não encontrado.' }
  } finally {
    buscandoCEP.value = false
  }
}

// ── Salvar Edição ──
async function salvarEdicao() {
  salvando.value = true
  formErro.value = ''
  try {
    await api.put(`/clientes/${editForm.id}`, {
      nome: editForm.nome,
      sobrenome: editForm.sobrenome,
      email: editForm.email,
      telefone: editForm.telefone,
      cpf_cnpj: editForm.cpf_cnpj,
      cep: editForm.cep,
      endereco: editForm.endereco,
      numero: editForm.numero,
      bairro: editForm.bairro,
      complemento: editForm.complemento,
      cidade: editForm.cidade,
      estado: editForm.estado,
    })
    editModal.value = false
    showFeedback('✅ Cliente atualizado com sucesso!', 'success')
    await load()
  } catch (err) {
    formErro.value = err.response?.data?.error || 'Erro ao atualizar cliente.'
  } finally {
    salvando.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(15,23,42,0.5);
  backdrop-filter: blur(4px);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  animation: fadeIn 0.2s ease;
}
.modal-content {
  background: white;
  border-radius: 16px;
  padding: 1.5rem;
  width: 100%;
  max-width: 550px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
  animation: slideUp 0.25s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

.drawer-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  line-height: 1;
}

.form-section-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 1rem 0 0.75rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--border);
}

.form-error-banner {
  background: #fee2e2;
  color: #991b1b;
  padding: 0.75rem;
  border-radius: 8px;
  font-size: 0.85rem;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cep-result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-size: 0.85rem;
}
.cep-result.success { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; }
.cep-result.error { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }

.info-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--border-light);
  border-radius: 999px;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.profile-section { margin-bottom: 1rem; }
.profile-section-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 0.5rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--border);
}

.pedido-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-light);
  font-size: 0.85rem;
}

.stats-grid { display: grid; gap: 0.75rem; }
.stat-card { background: var(--border-light); padding: 0.75rem; border-radius: 8px; text-align: center; }
.stat-card .label { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; }
.stat-card .value { font-size: 1.2rem; font-weight: 700; }
.stat-card .value.info { color: #2563eb; }
.stat-card .value.primary { color: var(--primary); }

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
.feedback-toast.success { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; }
.feedback-toast.erro { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }
@keyframes slideDown {
  from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
</style>
