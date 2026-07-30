<template>
  <div class="cep-modal-overlay">
    <div class="cep-modal">
      <i-lucide-map-pin style="width:32px;height:32px" class="cep-icon" />
      <h3>Qual seu endereço?</h3>
      <p>Informe seu CEP para verificar se entregamos na sua região</p>

      <div class="form-group text-left">
        <input
          v-model="cep"
          type="text"
          maxlength="9"
          placeholder="00000-000"
          @input="formatCEP"
          @keyup.enter="buscarCEP"
          class="cep-input-center"
        />
      </div>

      <button
        class="btn btn-primary btn-block mb-2"
        @click="buscarCEP"
        :disabled="buscando"
      >
        {{ buscando ? 'Verificando...' : 'Verificar Endereço' }}
      </button>

      <div v-if="resultado" class="cep-result" :class="resultado.tipo">
        <i-lucide-check-circle v-if="resultado.tipo === 'success'" style="width:16px;height:16px" />
        <i-lucide-x-circle v-else style="width:16px;height:16px" />
        {{ resultado.mensagem }}
      </div>

      <div class="cep-actions">
        <button class="btn btn-primary btn-block" @click="$router.push('/auth')">
          <i-lucide-log-in style="width:16px;height:16px" /> Fazer Login
        </button>
        <button class="btn btn-outline-primary btn-block" @click="$router.push('/auth')">
          <i-lucide-user-plus style="width:16px;height:16px" /> Criar uma conta
        </button>
        <button class="btn-link-muted" @click="$emit('close')">
          Continuar navegando sem CEP
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject } from 'vue'
import api from '../services/api'

const emit = defineEmits(['close'])
const addToast = inject('addToast')

const cep = ref('')
const buscando = ref(false)
const resultado = ref(null)

function formatCEP() {
  cep.value = cep.value.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substring(0, 9)
}

async function buscarCEP() {
  const cepLimpo = cep.value.replace(/\D/g, '')
  if (cepLimpo.length !== 8) {
    resultado.value = { tipo: 'error', mensagem: 'CEP inválido. Digite 8 dígitos.' }
    return
  }

  buscando.value = true
  resultado.value = null

  try {
    const { data: cepData } = await api.post('/cep', { cep: cepLimpo })

    // Sempre calcular o frete, com ou sem coordenadas
    // O backend valida o estado mesmo sem coordenadas
    let frete
    try {
      const { data: freteData } = await api.post('/pedidos/calcular-frete', {
        latitude: cepData.latitude,
        longitude: cepData.longitude,
        cidade: cepData.cidade,
        estado: cepData.estado,
      })
      frete = freteData
    } catch (freteErr) {
      // Frete rejeitou — região não atendida
      const msgFrete = freteErr.response?.data?.error || 'Não entregamos nesta região.'
      resultado.value = { tipo: 'error', mensagem: msgFrete }
      addToast(msgFrete, 'error')
      return
    }

    // Frete calculado com sucesso — região atendida!
    const freteMsg = frete.distancia_km
      ? ` ~${frete.distancia_km}km, ${frete.tempo_min}-${frete.tempo_max}min, Frete R$ ${parseFloat(frete.custo).toFixed(2)}`
      : ` ${frete.tempo_min}-${frete.tempo_max}min, Frete R$ ${parseFloat(frete.custo).toFixed(2)}`

    addToast(`Entregamos na sua região!${freteMsg}`, 'success')

    // Salvar CEP no localStorage
    localStorage.setItem('saborexpress_cep', cepLimpo)

    resultado.value = {
      tipo: 'success',
      mensagem: `✅ Entregamos na sua região!${freteMsg}`,
    }

    setTimeout(() => emit('close'), 2000)
  } catch (err) {
    resultado.value = {
      tipo: 'error',
      mensagem: err.response?.data?.error || 'CEP não encontrado ou região não atendida.',
    }
  } finally {
    buscando.value = false
  }
}
</script>
