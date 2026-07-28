<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="confirm-overlay"
      :class="{ open: show }"
      @click.self="handleCancel"
    >
      <div class="confirm-modal" :class="'variant-' + variant">
        <div class="confirm-icon" :class="'icon-' + variant">
          <i :class="iconClass"></i>
        </div>
        <h4 class="confirm-title">{{ title }}</h4>
        <p class="confirm-message">{{ message }}</p>
        <div v-if="$slots.default" class="confirm-body">
          <slot />
        </div>
        <div class="confirm-actions">
          <button class="btn btn-secondary" @click="handleCancel">{{ cancelText }}</button>
          <button class="btn" :class="confirmButtonClass" @click="handleConfirm" :disabled="confirmDisabled">
            <i :class="confirmIconClass"></i> {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: 'Confirmação' },
  message: { type: String, default: 'Tem certeza que deseja continuar?' },
  confirmText: { type: String, default: 'Confirmar' },
  cancelText: { type: String, default: 'Cancelar' },
  variant: { type: String, default: 'primary' },
  confirmDisabled: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel', 'update:show'])

const iconClass = computed(() => {
  const icons = { danger: 'fas fa-exclamation-triangle', primary: 'fas fa-question-circle', warning: 'fas fa-exclamation-circle' }
  return icons[props.variant] || icons.primary
})

const confirmButtonClass = computed(() => {
  const classes = { danger: 'btn-danger', primary: 'btn-primary', warning: 'btn-warning' }
  return classes[props.variant] || 'btn-primary'
})

const confirmIconClass = computed(() => 'fas fa-check')

function handleConfirm() { emit('confirm'); emit('update:show', false) }
function handleCancel() { emit('cancel'); emit('update:show', false) }

function onKeydown(e) { if (e.key === 'Escape' && props.show) handleCancel() }

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 600;
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
  opacity: 0; visibility: hidden;
  transition: all 0.2s ease;
}
.confirm-overlay.open { opacity: 1; visibility: visible; }

.confirm-modal {
  background: var(--surface);
  border-radius: var(--radius-xl);
  padding: 2rem;
  width: 100%; max-width: 380px;
  text-align: center;
  animation: modalIn 0.25s cubic-bezier(0.4,0,0.2,1);
  box-shadow: var(--shadow-xl);
}

@keyframes modalIn {
  from { opacity: 0; transform: scale(0.92) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.confirm-icon {
  width: 56px; height: 56px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 1rem;
  font-size: 1.5rem;
}
.icon-danger { background: var(--error-light); color: var(--error); }
.icon-primary { background: var(--info-light); color: var(--info); }
.icon-warning { background: var(--warning-light); color: var(--warning); }

.confirm-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text); }
.confirm-message { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.5rem; }
.confirm-body { margin-bottom: 1.5rem; }
.confirm-actions { display: flex; gap: 0.75rem; }
.confirm-actions .btn { flex: 1; justify-content: center; padding: 0.75rem 1rem; font-size: 0.9rem; }

.btn-danger { background: var(--error); color: white; }
.btn-danger:hover { background: #b91c1c; }
.btn-warning { background: var(--warning); color: white; }
.btn-warning:hover { background: #d97706; }
.variant-danger .confirm-title { color: var(--error); }
</style>
