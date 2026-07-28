<template>
  <div>
    <!-- Summary Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">Total de Tenants</div>
        <div class="value info">{{ tenants.length }}</div>
      </div>
      <div class="stat-card">
        <div class="label">Com Asaas Configurado</div>
        <div class="value success">{{ tenants.filter(t => t.tem_asaas).length }}</div>
      </div>
      <div class="stat-card">
        <div class="label">Com JWT Próprio</div>
        <div class="value primary">{{ tenants.filter(t => t.tem_jwt).length }}</div>
      </div>
      <div class="stat-card">
        <div class="label">Lojas Abertas</div>
        <div class="value" style="color:#16a34a;">{{ tenants.filter(t => t.status_loja).length }}</div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <button class="btn btn-primary" @click="abrirEditor(null)">
        <i class="fas fa-plus"></i> Novo Tenant
      </button>
      <button class="btn btn-secondary" @click="carregar" :disabled="loading">
        <i class="fas fa-sync" :class="{ spinning: loading }"></i> Atualizar
      </button>
    </div>

    <!-- Tenants Table -->
    <div class="card">
      <div class="card-body" style="padding:0;">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nome</th>
              <th>Slug / Domínio</th>
              <th>Status</th>
              <th>Asaas</th>
              <th>JWT</th>
              <th>Preparo</th>
              <th>Criado em</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in tenants" :key="t.id">
              <td><span class="badge badge-id">#{{ t.id }}</span></td>
              <td><strong>{{ t.nome }}</strong></td>
              <td>
                <code class="slug-badge">{{ t.slug }}</code>
                <span style="color:var(--text-muted);font-size:0.75rem;"> / {{ t.dominio }}</span>
              </td>
              <td>
                <span class="store-badge" :class="t.status_loja ? 'open' : 'closed'">
                  {{ t.status_loja ? 'Aberto' : 'Fechado' }}
                </span>
              </td>
              <td>
                <span class="status-dot" :class="t.tem_asaas ? 'ok' : 'no'"></span>
                {{ t.tem_asaas ? t.asaas_env : '—' }}
              </td>
              <td>
                <span class="status-dot" :class="t.tem_jwt ? 'ok' : 'no'"></span>
                {{ t.tem_jwt ? 'Próprio' : 'Global' }}
              </td>
              <td>{{ t.tempo_preparo_min }} min</td>
              <td style="font-size:0.8rem;color:var(--text-muted);">
                {{ formatDate(t.criado_em) }}
              </td>
              <td>
                <div class="action-group">
                  <button class="btn btn-sm btn-secondary" @click="abrirEditor(t)" title="Editar">
                    <i class="fas fa-edit"></i>
                  </button>
                  <button class="btn btn-sm btn-secondary" @click="regenerarJwt(t)" title="Regenerar JWT">
                    <i class="fas fa-key"></i>
                  </button>
                  <button class="btn btn-sm btn-danger" @click="confirmarExcluir(t)" title="Excluir">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="tenants.length === 0">
              <td colspan="9" style="text-align:center;padding:3rem;color:var(--text-muted);">
                <i class="fas fa-store" style="font-size:2rem;display:block;margin-bottom:0.75rem;"></i>
                Nenhum tenant encontrado
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Create/Edit Modal -->
    <div v-if="showEditor" class="modal-backdrop" @click.self="showEditor = false">
      <div class="modal-card wide">
        <div class="modal-header">
          <h3><i class="fas" :class="editando ? 'fa-edit' : 'fa-plus-circle'"></i>
            {{ editando ? 'Editar Tenant' : 'Novo Tenant' }}</h3>
          <button class="drawer-close" @click="showEditor = false">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="erroForm" class="alert alert-error">{{ erroForm }}</div>

          <div class="form-row">
            <div class="form-group">
              <label>Nome do Restaurante *</label>
              <input v-model="form.nome" placeholder="Ex: Palazzo" required />
            </div>
            <div class="form-group">
              <label>Slug *</label>
              <input v-model="form.slug" placeholder="Ex: palazzomooca" @input="slugChanged" required />
              <small style="color:var(--text-muted);font-size:0.7rem;">
                Subdomínio: <code>{{ form.slug || 'slug' }}.cliente.loopautomacoes.com.br</code>
              </small>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Domínio *</label>
              <input v-model="form.dominio" placeholder="Igual ao slug" />
              <small style="color:var(--text-muted);font-size:0.7rem;">
                Normalmente igual ao slug. Valor usado pelo servidor para identificar o tenant pelo subdomínio.
              </small>
            </div>
            <div class="form-group">
              <label>CEP</label>
              <input v-model="form.cep" placeholder="00000-000" maxlength="9" />
            </div>
          </div>

          <div class="form-group">
            <label>Endereço</label>
            <input v-model="form.endereco" placeholder="Endereço completo" />
          </div>

          <div class="form-row">
            <div class="form-group"><label>Cidade</label><input v-model="form.cidade" /></div>
            <div class="form-group"><label>Estado</label><input v-model="form.estado" maxlength="2" /></div>
            <div class="form-group"><label>Tempo Preparo (min)</label><input v-model.number="form.tempo_preparo_min" type="number" min="5" /></div>
          </div>

          <div class="form-divider">
            <i class="fas fa-credit-card"></i> Configuração Asaas
          </div>

          <div class="form-row">
            <div class="form-group" style="flex:2">
              <label>API Key</label>
              <input v-model="form.asaas_api_key" type="password" placeholder="Deixe vazio para não configurar" />
            </div>
            <div class="form-group">
              <label>Ambiente</label>
              <select v-model="form.asaas_env">
                <option value="sandbox">Sandbox</option>
                <option value="production">Produção</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Webhook Token</label>
              <input v-model="form.asaas_webhook_token" type="password" placeholder="Token do webhook Asaas" />
            </div>
            <div class="form-group">
              <label>Webhook Secret (HMAC)</label>
              <input v-model="form.asaas_webhook_secret" type="password" placeholder="HMAC secret" />
            </div>
          </div>

          <div v-if="!editando" class="form-divider">
            <i class="fas fa-user-shield"></i> Admin do Tenant
          </div>
          <p v-if="!editando" style="font-size:0.8rem;color:var(--text-muted);margin:-0.5rem 0 1rem;">
            Será criado automaticamente um admin com email <code>admin@{{ form.slug || 'slug' }}.com</code> e senha <code>admin123</code>
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showEditor = false">Cancelar</button>
          <button class="btn btn-primary" @click="salvar" :disabled="salvando">
            <i class="fas fa-spinner fa-spin" v-if="salvando"></i>
            {{ salvando ? 'Salvando...' : editando ? 'Atualizar' : 'Criar Tenant' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div v-if="excluindo" class="modal-backdrop" @click.self="excluindo = null">
      <div class="modal-card" style="max-width:400px;">
        <div class="modal-header">
          <h3 style="color:var(--error);"><i class="fas fa-exclamation-triangle"></i> Excluir Tenant</h3>
          <button class="drawer-close" @click="excluindo = null">&times;</button>
        </div>
        <div class="modal-body">
          <p>Tem certeza que deseja excluir <strong>{{ excluindo.nome }}</strong>?</p>
          <p style="font-size:0.85rem;color:var(--error);margin-top:0.75rem;">
            <i class="fas fa-exclamation-circle"></i>
            Todos os dados relacionados (pedidos, produtos, clientes, etc.) serão <strong>excluídos permanentemente</strong>.
          </p>
          <div class="form-group" style="margin-top:1rem;">
            <label>Digite <strong>EXCLUIR</strong> para confirmar:</label>
            <input v-model="confirmText" placeholder="EXCLUIR" style="border-color:var(--error);" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="excluindo = null">Cancelar</button>
          <button class="btn btn-danger" @click="excluirTenant" :disabled="confirmText !== 'EXCLUIR' || excluindoLoading">
            {{ excluindoLoading ? 'Excluindo...' : 'Excluir Permanentemente' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Toast notification -->
    <transition name="toast">
      <div v-if="toast" class="toast" :class="toast.tipo">
        <i :class="toast.tipo === 'success' ? 'fas fa-check-circle' : 'fas fa-times-circle'"></i>
        {{ toast.mensagem }}
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue'
import api from '../services/api'

const tenants = ref([])
const loading = ref(false)
const showEditor = ref(false)
const editando = ref(null)
const salvando = ref(false)
const erroForm = ref('')
const excluindo = ref(null)
const excluindoLoading = ref(false)
const confirmText = ref('')
const toast = ref(null)

const form = reactive({
  nome: '', slug: '', dominio: '', endereco: '', cep: '', cidade: '', estado: '',
  latitude: null, longitude: null, status_loja: true, tempo_preparo_min: 20,
  asaas_api_key: '', asaas_env: 'sandbox', asaas_webhook_token: '', asaas_webhook_secret: '',
})

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Quando o slug muda, auto-preenche o domínio (a menos que já tenha sido editado manualmente)
let dominioEditadoManualmente = false
function slugChanged(event) {
  const val = event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')
  form.slug = val
  if (!dominioEditadoManualmente) {
    form.dominio = val
  }
}
// Se o usuário editar o domínio manualmente, não sobrescrever mais
watch(() => form.dominio, () => {
  if (form.dominio && form.dominio !== form.slug) {
    dominioEditadoManualmente = true
  }
})

function mostrarToast(tipo, mensagem) {
  toast.value = { tipo, mensagem }
  setTimeout(() => { toast.value = null }, 4000)
}

function resetForm() {
  Object.assign(form, {
    nome: '', slug: '', dominio: '', endereco: '', cep: '', cidade: '', estado: '',
    latitude: null, longitude: null, status_loja: true, tempo_preparo_min: 20,
    asaas_api_key: '', asaas_env: 'sandbox', asaas_webhook_token: '', asaas_webhook_secret: '',
  })
  erroForm.value = ''
}

function abrirEditor(tenant) {
  resetForm()
  editando.value = tenant
  if (tenant) {
    form.nome = tenant.nome || ''
    form.slug = tenant.slug || ''
    form.dominio = tenant.dominio || ''
    form.status_loja = tenant.status_loja ?? true
    form.tempo_preparo_min = tenant.tempo_preparo_min || 20
    // Carregar dados completos do tenant para edição
    carregarDadosTenant(tenant.id)
  }
  showEditor.value = true
}

async function carregarDadosTenant(id) {
  try {
    const { data } = await api.get(`/restaurante/tenants/${id}`)
    // Completar form com dados detalhados
    form.nome = data.nome || form.nome
    form.slug = data.slug || form.slug
    form.dominio = data.dominio || form.dominio
    form.endereco = data.endereco || ''
    form.cep = data.cep || ''
    form.cidade = data.cidade || ''
    form.estado = data.estado || ''
    form.latitude = data.latitude || null
    form.longitude = data.longitude || null
    form.status_loja = data.status_loja ?? form.status_loja
    form.tempo_preparo_min = data.tempo_preparo_min || 20
    form.asaas_api_key = data.asaas_api_key || ''
    form.asaas_env = data.asaas_env || 'sandbox'
    form.asaas_webhook_token = data.asaas_webhook_token || ''
    form.asaas_webhook_secret = data.asaas_webhook_secret || ''
  } catch (err) { console.warn('[Tenants] Erro ao carregar dados do tenant:', err) }
}

async function carregar() {
  loading.value = true
  try {
    const { data } = await api.get('/restaurante/tenants')
    tenants.value = data
  } catch (err) {
    mostrarToast('error', err.response?.data?.error || 'Erro ao carregar tenants')
  } finally {
    loading.value = false
  }
}

async function salvar() {
  // Validar campos obrigatórios
  if (!form.nome || !form.slug || !form.dominio) {
    erroForm.value = 'Preencha nome, slug e domínio.'
    return
  }

  salvando.value = true
  erroForm.value = ''

  try {
    const payload = { ...form }
    // Remover campos vazios que não devem ser enviados como string vazia
    if (!payload.asaas_api_key) payload.asaas_api_key = null
    if (!payload.asaas_webhook_token) payload.asaas_webhook_token = null
    if (!payload.asaas_webhook_secret) payload.asaas_webhook_secret = null

    if (editando.value) {
      await api.put(`/restaurante/tenants/${editando.value.id}`, payload)
      mostrarToast('success', 'Tenant atualizado com sucesso!')
    } else {
      const { data } = await api.post('/restaurante/tenants', payload)
      const t = data.tenant
      mostrarToast('success', `Tenant "${t.nome}" criado! Admin: admin@${t.slug}.com / admin123`)
    }

    showEditor.value = false
    await carregar()
  } catch (err) {
    erroForm.value = err.response?.data?.error || 'Erro ao salvar tenant.'
  } finally {
    salvando.value = false
  }
}

function confirmarExcluir(tenant) {
  // Não permite excluir tenant 1 (padrão)
  if (tenant.id === 1) {
    mostrarToast('error', 'Não é possível excluir o tenant padrão (ID 1).')
    return
  }
  excluindo.value = tenant
  confirmText.value = ''
}

async function excluirTenant() {
  if (confirmText.value !== 'EXCLUIR') return
  excluindoLoading.value = true
  try {
    await api.delete(`/restaurante/tenants/${excluindo.value.id}`)
    mostrarToast('success', `Tenant "${excluindo.value.nome}" excluído.`)
    excluindo.value = null
    await carregar()
  } catch (err) {
    mostrarToast('error', err.response?.data?.error || 'Erro ao excluir tenant.')
  } finally {
    excluindoLoading.value = false
  }
}

async function regenerarJwt(tenant) {
  if (!confirm(`Isso vai invalidar TODOS os tokens de "${tenant.nome}". Os usuários precisarão fazer login novamente. Continuar?`)) return
  try {
    const { data } = await api.post(`/restaurante/tenants/${tenant.id}/regenerate-jwt`)
    mostrarToast('success', data.message)
    await carregar()
  } catch (err) {
    mostrarToast('error', err.response?.data?.error || 'Erro ao regenerar JWT.')
  }
}

onMounted(carregar)
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.stat-card {
  background: var(--surface);
  border-radius: var(--radius);
  padding: 1.25rem;
  box-shadow: var(--shadow);
  border: 1px solid var(--border);
}
.stat-card .label {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.stat-card .value {
  font-size: 1.5rem;
  font-weight: 800;
}
.stat-card .value.info { color: var(--info); }
.stat-card .value.success { color: var(--success); }
.stat-card .value.primary { color: var(--primary); }

.toolbar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.spinning { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge-id {
  background: var(--border-light);
  color: var(--text-muted);
  font-family: monospace;
}
.slug-badge {
  background: var(--info-light);
  color: var(--info);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-family: monospace;
}
.store-badge {
  display: inline-flex;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}
.store-badge.open {
  background: var(--success-light);
  color: #166534;
}
.store-badge.closed {
  background: var(--error-light);
  color: #991b1b;
}
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
}
.status-dot.ok { background: var(--success); }
.status-dot.no { background: var(--border); }

.action-group {
  display: flex;
  gap: 4px;
}
.action-group .btn {
  width: 30px;
  height: 30px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}
.modal-card {
  background: white;
  border-radius: 12px;
  max-width: 500px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.modal-card.wide {
  max-width: 680px;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border);
}
.modal-header h3 {
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.modal-body {
  padding: 1.5rem;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border);
}
.drawer-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  line-height: 1;
}
.form-divider {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: 1.25rem 0 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
}
.form-divider i {
  color: var(--text-muted);
}

.alert {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  margin-bottom: 1rem;
}
.alert-error {
  background: var(--error-light);
  color: #991b1b;
  border: 1px solid #fecaca;
}

/* Toast */
.toast {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  padding: 1rem 1.5rem;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  box-shadow: 0 10px 30px rgba(0,0,0,0.15);
  z-index: 2000;
  min-width: 300px;
}
.toast.success {
  background: #166534;
  color: white;
}
.toast.error {
  background: #991b1b;
  color: white;
}
.toast-enter-active { transition: all 0.3s ease; }
.toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from { transform: translateX(100px); opacity: 0; }
.toast-leave-to { transform: translateX(100px); opacity: 0; }
</style>
