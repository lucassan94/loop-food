<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="alert-overlay"
      :class="{ open: show }"
      @click.self="close"
    >
      <div class="alert-modal" role="alertdialog" aria-modal="true">
        <div class="alert-icon">
          <AlertCircle style="width:28px;height:28px" />
        </div>
        <h4 class="alert-title">{{ title }}</h4>
        <p class="alert-message">{{ message }}</p>
        <div class="alert-actions">
          <button class="btn btn-primary" @click="close">OK</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { AlertCircle } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: 'Atenção' },
  message: { type: String, default: '' },
})

const emit = defineEmits(['close', 'update:show'])

function close() { emit('close'); emit('update:show', false) }

function onKeydown(e) { if (e.key === 'Escape' && props.show) close() }

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.alert-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 600;
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
  opacity: 0; visibility: hidden;
  transition: all 0.2s ease;
}
.alert-overlay.open { opacity: 1; visibility: visible; }

.alert-modal {
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

.alert-icon {
  width: 56px; height: 56px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 1rem;
  background: var(--error-light); color: var(--error);
}

.alert-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--error); }
.alert-message { color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.5rem; }
.alert-actions .btn { width: 100%; justify-content: center; padding: 0.75rem 1rem; font-size: 0.9rem; }
</style>
