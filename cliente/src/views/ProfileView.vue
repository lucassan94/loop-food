<template>
  <div class="profile-view">
    <!-- Header -->
    <div class="profile-header">
      <div class="profile-avatar">
        <i class="fas fa-user"></i>
      </div>
      <h2>{{ authStore.userName || 'Bem-vindo(a)' }}</h2>
      <p class="profile-email">{{ authStore.user?.email || 'Identifique-se para continuar' }}</p>
      <div v-if="authStore.isAuthenticated && authStore.user?.telefone" class="profile-phone">
        <i class="fas fa-phone-alt"></i> {{ authStore.user.telefone }}
      </div>
    </div>

    <!-- Logged In -->
    <div v-if="authStore.isAuthenticated" class="profile-form">
      <!-- Card: Dados Pessoais -->
      <div class="profile-card">
        <div class="profile-card-header">
          <i class="fas fa-id-card"></i>
          <span>Dados Pessoais</span>
        </div>
        <div class="profile-card-body">
          <div class="form-row">
            <div class="form-group">
              <label>Nome</label>
              <input v-model="form.nome" type="text" placeholder="Seu nome" />
            </div>
            <div class="form-group">
              <label>Sobrenome</label>
              <input v-model="form.sobrenome" type="text" placeholder="Seu sobrenome" />
            </div>
          </div>

          <div class="form-group">
            <label>Telefone / WhatsApp</label>
            <input v-model="form.telefone" type="tel" placeholder="(11) 99999-9999" />
          </div>

          <div class="form-group">
            <label>CPF</label>
            <input v-model="form.cpf_cnpj" type="text" maxlength="14" placeholder="000.000.000-00"
                   @input="formatCPF" />
          </div>
        </div>
      </div>

      <!-- Card: Endereço -->
      <div class="profile-card">
        <div class="profile-card-header">
          <i class="fas fa-map-marker-alt"></i>
          <span>Endereço</span>
        </div>
        <div class="profile-card-body">
          <div class="cep-search-row">
            <div class="form-group" style="flex:1;margin-bottom:0;">
              <label>CEP</label>
              <input v-model="form.cep" type="text" maxlength="9" placeholder="00000-000" @input="formatCEP" />
            </div>
            <button class="btn btn-secondary btn-cep-buscar" @click="buscarCEP" :disabled="buscandoCEP">
              <i class="fas fa-search"></i> {{ buscandoCEP ? '...' : 'Buscar' }}
            </button>
          </div>

          <div class="form-group">
            <label>Logradouro</label>
            <input v-model="form.endereco" type="text" placeholder="Rua, Avenida..." />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Número</label>
              <input v-model="form.numero" type="text" placeholder="Nº" />
            </div>
            <div class="form-group">
              <label>Bairro</label>
              <input v-model="form.bairro" type="text" placeholder="Bairro" />
            </div>
          </div>

          <div class="form-group">
            <label>Complemento</label>
            <input v-model="form.complemento" type="text" placeholder="Apto, Bloco..." />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Cidade</label>
              <input v-model="form.cidade" type="text" />
            </div>
            <div class="form-group">
              <label>Estado</label>
              <input v-model="form.estado" type="text" maxlength="2" placeholder="SP" />
            </div>
          </div>
        </div>
      </div>

      <!-- Salvar -->
      <button
        class="btn btn-primary btn-block btn-salvar"
        @click="salvar"
        :disabled="salvando"
      >
        <i class="fas fa-save"></i>
        {{ salvando ? 'Salvando...' : 'Salvar Alterações' }}
      </button>

      <!-- Mensagem -->
      <div v-if="mensagem" class="profile-msg" :class="mensagem.tipo">
        <i :class="mensagem.tipo === 'success' ? 'fas fa-check-circle' : 'fas fa-times-circle'"></i>
        {{ mensagem.texto }}
      </div>

      <!-- Sair -->
      <hr class="profile-divider" />

      <button
        class="btn btn-logout btn-block"
        @click="showLogoutConfirm = true"
      >
        <i class="fas fa-sign-out-alt"></i>
        Sair da Conta
      </button>
    </div>

    <!-- Not Logged In -->
    <div v-else class="profile-guest">
      <div class="profile-card text-center">
        <div class="profile-card-body">
          <i class="fas fa-lock" style="font-size:2rem;color:var(--text-muted);margin-bottom:1rem;"></i>
          <p class="text-muted">
            Faça login para acessar seu perfil e histórico de pedidos.
          </p>
          <router-link to="/auth" class="btn btn-primary btn-block mb-2">
            <i class="fas fa-sign-in-alt"></i> Fazer Login
          </router-link>
          <router-link to="/auth" class="btn btn-outline-primary btn-block">
            <i class="fas fa-user-plus"></i> Criar Conta
          </router-link>
        </div>
      </div>
    </div>

    <!-- Confirm Modal para Logout -->
    <ConfirmModal
      :show="showLogoutConfirm"
      title="Sair da Conta"
      message="Tem certeza que deseja sair? Você precisará fazer login novamente para fazer novos pedidos."
      variant="danger"
      confirmText="Sair"
      @confirm="authStore.logout()"
      @cancel="showLogoutConfirm = false"
    />
  </div>
</template>

<script setup>
import { reactive, ref, onMounted, watch, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import api from '../services/api'
import ConfirmModal from '../components/ConfirmModal.vue'

const authStore = useAuthStore()
const salvando = ref(false)
const buscandoCEP = ref(false)
const mensagem = ref(null)
const showLogoutConfirm = ref(false)

const form = reactive({
  nome: '',
  sobrenome: '',
  telefone: '',
  cpf_cnpj: '',
  cep: '',
  endereco: '',
  numero: '',
  bairro: '',
  complemento: '',
  cidade: 'São Paulo',
  estado: 'SP',
})

onMounted(() => {
  if (authStore.user) {
    form.nome = authStore.user.nome || ''
    form.sobrenome = authStore.user.sobrenome || ''
    form.telefone = authStore.user.telefone || ''
    form.cpf_cnpj = authStore.user.cpf_cnpj || ''
    form.cep = authStore.user.cep || ''
    form.endereco = authStore.user.endereco || ''
    form.numero = authStore.user.numero || ''
    form.bairro = authStore.user.bairro || ''
    form.complemento = authStore.user.complemento || ''
    form.cidade = authStore.user.cidade || 'São Paulo'
    form.estado = authStore.user.estado || 'SP'
  }
})

function formatCPF() {
  form.cpf_cnpj = form.cpf_cnpj.replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4').substring(0, 14)
}

function formatCEP() {
  form.cep = form.cep.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substring(0, 9)
}

// Auto-buscar CEP ao digitar 8 dígitos (com debounce)
let cepTimeout = null
watch(() => form.cep, (val) => {
  if (cepTimeout) clearTimeout(cepTimeout)
  const cep = val.replace(/\D/g, '')
  if (cep.length === 8) {
    cepTimeout = setTimeout(() => {
      buscarCEP()
    }, 400)
  }
})

onUnmounted(() => {
  if (cepTimeout) clearTimeout(cepTimeout)
})

async function buscarCEP() {
  const cep = form.cep.replace(/\D/g, '')
  if (cep.length !== 8) return

  buscandoCEP.value = true
  try {
    const { data } = await api.post('/cep', { cep })
    form.endereco = data.logradouro || form.endereco
    form.bairro = data.bairro || form.bairro
    form.cidade = data.cidade || form.cidade
    form.estado = data.estado || form.estado
  } catch {
    mensagem.value = { tipo: 'error', texto: 'CEP não encontrado.' }
  } finally {
    buscandoCEP.value = false
  }
}

async function salvar() {
  salvando.value = true
  mensagem.value = null
  try {
    await authStore.updateProfile({
      ...form,
      cpf_cnpj: form.cpf_cnpj.replace(/\D/g, ''),
    })
    mensagem.value = { tipo: 'success', texto: 'Perfil atualizado com sucesso!' }
  } catch (err) {
    mensagem.value = { tipo: 'error', texto: err.response?.data?.error || 'Erro ao atualizar perfil.' }
  } finally {
    salvando.value = false
  }
}
</script>

<style scoped>
.profile-view {
  padding: 1.5rem 5%;
  padding-bottom: 6rem;
  max-width: 560px;
  margin: 0 auto;
}

/* ── Header ── */
.profile-header {
  text-align: center;
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  border-radius: var(--radius-lg);
  color: white;
  position: relative;
  overflow: hidden;
}

.profile-header::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -50%;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%);
  pointer-events: none;
}

.profile-avatar {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-full);
  background: rgba(255,255,255,0.2);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1rem;
  font-size: 1.8rem;
  border: 3px solid rgba(255,255,255,0.3);
}

.profile-header h2 {
  font-size: 1.3rem;
  font-weight: 700;
  margin-bottom: 0.25rem;
}

.profile-email {
  font-size: 0.85rem;
  opacity: 0.85;
}

.profile-phone {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  opacity: 0.9;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

/* ── Cards ── */
.profile-card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
  margin-bottom: 1.25rem;
  overflow: hidden;
  transition: var(--transition);
}

.profile-card:hover {
  box-shadow: var(--shadow);
}

.profile-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 1rem 1.25rem;
  background: var(--background);
  border-bottom: 1px solid var(--border-light);
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text);
}

.profile-card-header i {
  color: var(--primary);
  font-size: 1rem;
  width: 20px;
  text-align: center;
}

.profile-card-body {
  padding: 1.25rem;
}

/* ── CEP row ── */
.cep-search-row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-end;
  margin-bottom: 1rem;
}

.btn-cep-buscar {
  height: 44px;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Buttons ── */
.btn-salvar {
  padding: 0.85rem;
  font-size: 1rem;
  border-radius: var(--radius);
}

.btn-logout {
  padding: 0.85rem;
  font-size: 1rem;
  border-radius: var(--radius);
  background: transparent;
  color: var(--error);
  border: 2px solid var(--error);
  transition: var(--transition);
}

.btn-logout:hover {
  background: var(--error);
  color: white;
}

/* ── Message ── */
.profile-msg {
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius);
  font-size: 0.85rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.profile-msg.success {
  background: var(--success-light);
  color: #166534;
}
.profile-msg.error {
  background: var(--error-light);
  color: #991b1b;
}

/* ── Divider ── */
.profile-divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5rem 0;
}

/* ── Guest ── */
.profile-guest {
  padding-top: 1rem;
}
</style>
