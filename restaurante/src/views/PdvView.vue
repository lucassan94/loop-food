<template>
  <div class="pdv-layout">
    <!-- Feedback Toast -->
    <div v-if="feedbackMsg" class="feedback-toast" :class="feedbackMsg.tipo" @click="feedbackMsg = null">
      <i-lucide-circle-check-big v-if="feedbackMsg.tipo === 'success'" style="width:20px;height:20px" />
      <i-lucide-triangle-alert v-else style="width:20px;height:20px" />
      {{ feedbackMsg.texto }}
    </div>

    <!-- Products Area -->
    <div class="pdv-products">
      <!-- Search & Category Filters -->
      <div class="pdv-toolbar">
        <div class="pdv-search">
          <i-lucide-search style="width:18px;height:18px" />
          <input v-model="searchQuery" type="text" placeholder="Buscar produto..." @input="filterProducts" />
          <button v-if="searchQuery" class="clear-btn" @click="searchQuery = ''">&times;</button>
        </div>
        <div class="pdv-categories">
          <button
            v-for="cat in categories"
            :key="cat.slug"
            class="pdv-cat-btn"
            :class="{ active: activeCategory === cat.slug }"
            @click="activeCategory = cat.slug"
          >
            {{ cat.nome }}
          </button>
        </div>
      </div>

      <!-- Products Grid -->
      <div class="pdv-grid">
        <div v-if="filteredProducts.length === 0 && !loading" class="pdv-empty">
          <i-lucide-search style="width:48px;height:48px" />
          <p>Nenhum produto encontrado</p>
        </div>
        <button
          v-for="product in filteredProducts"
          :key="product.id"
          class="pdv-product-btn"
          :class="{ 'has-extras': product.extras?.length }"
          @click="addToCart(product)"
        >
          <div class="pdv-product-img">
            <img :src="productImgSrc(product)" :alt="product.nome" @error="onImgError" />
          </div>
          <div class="pdv-product-info">
            <div class="pdv-product-name">{{ product.nome }}</div>
            <div class="pdv-product-price">{{ formatPrice(product.preco) }}</div>
          </div>
          <div class="pdv-product-add">
            <i-lucide-plus style="width:16px;height:16px" />
          </div>
          <div v-if="product.extras?.length" class="pdv-product-extras-badge">
            <i-lucide-plus-circle style="width:12px;height:12px" />
            {{ product.extras.length }}
          </div>
        </button>
      </div>
    </div>

    <!-- Cart Sidebar -->
    <div class="pdv-cart">
      <div class="pdv-cart-header">
        <i-lucide-shopping-cart style="width:20px;height:20px" />
        <span>Pedido Atual</span>
        <span class="pdv-cart-count">{{ cart.length }} itens</span>
      </div>

      <!-- Cart Items -->
      <div class="pdv-cart-items" v-if="cart.length > 0">
        <div v-for="(item, idx) in cart" :key="idx" class="pdv-cart-item">
          <div class="pdv-cart-item-info">
            <div class="pdv-cart-item-name">{{ item.nome_produto }}</div>
            <div class="pdv-cart-item-price">{{ formatPrice(item.subtotal) }}</div>
            <div v-if="item.extras?.length" class="pdv-cart-item-extras">
              <span v-for="e in item.extras" :key="e.nome">+ {{ e.nome }} ({{ formatPrice(e.preco * (e.qty || 1)) }})</span>
            </div>
          </div>
          <div class="pdv-cart-item-qty">
            <button class="qty-btn" @click="decrementQty(idx)">−</button>
            <span>{{ item.quantidade }}</span>
            <button class="qty-btn" @click="incrementQty(idx)">+</button>
          </div>
          <button class="pdv-cart-item-remove" @click="removeItem(idx)">&times;</button>
        </div>
      </div>

      <div v-else class="pdv-cart-empty">
        <i-lucide-shopping-bag style="width:48px;height:48px" />
        <p>Carrinho vazio</p>
        <small>Clique nos produtos ao lado</small>
      </div>

      <!-- Cart Footer -->
      <div class="pdv-cart-footer" v-if="cart.length > 0">
        <div class="pdv-cart-total">
          <span>Subtotal</span>
          <span>{{ formatPrice(subtotal) }}</span>
        </div>
        <div class="pdv-cart-total grand">
          <span>Total</span>
          <span>{{ formatPrice(subtotal) }}</span>
        </div>

        <!-- Customer Info -->
        <div class="pdv-customer-info">
          <div class="form-group">
            <label>Cliente / Mesa</label>
            <input v-model="orderForm.nome_cliente" placeholder="Ex: Mesa 5, João, etc" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Mesa</label>
              <select v-model="orderForm.mesa">
                <option value="">— Sem Mesa —</option>
                <option v-for="m in mesas" :key="m.id" :value="m.nome" :disabled="m.status === 'inativa'">
                  {{ m.nome }} ({{ mesaStatusLabel(m) }})
                </option>
              </select>
            </div>
            <div class="form-group">
              <label>Pagamento</label>
              <select v-model="orderForm.metodo_pagamento">
                <option value="conta">Conta</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="credito">Cartão Crédito</option>
                <option value="debito">Cartão Débito</option>
                <option value="pix">PIX</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Observações</label>
            <textarea v-model="orderForm.observacoes" rows="2" placeholder="Opicional"></textarea>
          </div>
        </div>

        <!-- Actions -->
        <div class="pdv-cart-actions">
          <button class="btn btn-success btn-lg btn-block" @click="createOrder" :disabled="sending || !orderForm.nome_cliente">
            <i-lucide-check style="width:18px;height:18px" />
            {{ sending ? 'Enviando...' : 'Finalizar Pedido (Salão)' }}
          </button>
          <button class="btn btn-secondary btn-block" @click="clearCart">
            <i-lucide-trash-2 style="width:16px;height:16px" />
            Limpar Carrinho
          </button>
        </div>
      </div>
    </div>

    <!-- ── Extras Modal ── -->
    <Teleport to="body">
      <div class="modal-backdrop" :class="{ open: extrasModalOpen }" @click.self="closeExtrasModal">
        <div class="extras-modal">
          <button class="modal-close-btn" @click="closeExtrasModal">&times;</button>

          <div class="extras-modal-header">
            <img
              :src="productImgSrc(extrasProduct)"
              :alt="extrasProduct?.nome"
              class="extras-modal-img"
              @error="onImgError"
            />
            <div class="extras-modal-title">
              <h3>{{ extrasProduct?.nome }}</h3>
              <p>{{ extrasProduct?.descricao || 'Sem descrição' }}</p>
            </div>
          </div>

          <div class="extras-modal-body" v-if="extrasList.length > 0">
            <h4 class="extras-section-title">
              <i-lucide-plus-circle style="width:16px;height:16px" />
              Adicionais (Opcional)
            </h4>
            <div class="extra-item" v-for="extra in extrasList" :key="extra.id">
              <div class="extra-item-left">
                <div class="extra-label">{{ extra.nome }}</div>
                <!-- Qty selector for max > 1 or unlimited -->
                <div v-if="!extra.maximo || extra.maximo > 1" class="extra-qty-selector">
                  <button
                    class="extra-qty-btn"
                    @click="decrementExtra(extra)"
                    :disabled="getExtraQty(extra) <= 0"
                  >−</button>
                  <span class="extra-qty-value">{{ getExtraQty(extra) }}</span>
                  <button
                    class="extra-qty-btn"
                    @click="incrementExtra(extra)"
                    :disabled="getExtraQty(extra) >= (extra.maximo || 99)"
                  >+</button>
                </div>
                <!-- Simple checkbox for max = 1 -->
                <label v-else class="extra-checkbox-label">
                  <input
                    type="checkbox"
                    :checked="hasExtra(extra)"
                    @change="toggleExtra(extra)"
                  />
                  <span>Adicionar</span>
                </label>
              </div>
              <span class="extra-price">{{ formatPrice(extra.preco) }}</span>
            </div>
          </div>

          <div class="extras-modal-footer">
            <div class="extras-total">
              <span>Total do item</span>
              <span class="extras-total-value">{{ formatPrice(extrasItemTotal) }}</span>
            </div>
            <button class="btn btn-success btn-lg" @click="confirmExtras">
              <i-lucide-shopping-bag style="width:18px;height:18px" />
              Adicionar ao Carrinho
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, inject } from 'vue'
import api from '../services/api'
import { connectRealtime, onEvent, offEvent } from '../services/realtime'

const globalLoading = inject('globalLoading')
const loadingMessage = inject('loadingMessage')

const feedbackMsg = ref(null)
function showFeedback(texto, tipo = 'erro') {
  feedbackMsg.value = { texto, tipo }
  setTimeout(() => { feedbackMsg.value = null }, 4000)
}

// Products
const products = ref([])
const categories = ref([])
const loading = ref(true)
const searchQuery = ref('')
const activeCategory = ref('todos')

// Mesas para o dropdown
const mesas = ref([])

function mesaStatusLabel(m) {
  if (m.status === 'inativa') return '🔴 Inativa'
  if (mesaOcupada.value.has(m.nome)) return '🔴 Ocupada'
  if (m.status === 'reservada') return '🟡 Reservada'
  return '🟢 Livre'
}

const mesaOcupada = ref(new Set())

async function loadMesas() {
  try {
    const [mesasRes, pedidosRes] = await Promise.all([
      api.get('/restaurante/mesas'),
      api.get('/pedidos', { params: { status: 'ativos', origem: 'salao', limit: 200 } }),
    ])
    mesas.value = mesasRes.data
    // Descobrir quais mesas estão ocupadas por pedidos ativos
    const ocupadas = new Set(
      pedidosRes.data
        .filter(p => p.origem === 'salao' && p.mesa)
        .map(p => p.mesa)
    )
    mesaOcupada.value = ocupadas
  } catch { /* ignore */ }
}

// Cart
const cart = ref([])

// Order form
const orderForm = ref({
  nome_cliente: '',
  mesa: '',
  metodo_pagamento: 'conta',
  observacoes: '',
})

const sending = ref(false)

// ── Extras Modal State ──
const extrasModalOpen = ref(false)
const extrasProduct = ref(null)
const extrasList = ref([])
const chosenExtras = ref([])          // [{extra, qty}] for qty-based extras
const chosenExtraSet = ref(new Set()) // Set of extra IDs (simple checkbox mode)

// Computed
const filteredProducts = computed(() => {
  let result = products.value
  if (activeCategory.value !== 'todos') {
    result = result.filter(p => p.categoria_slug === activeCategory.value)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(p =>
      p.nome.toLowerCase().includes(q) ||
      p.descricao?.toLowerCase().includes(q)
    )
  }
  return result
})

const subtotal = computed(() => {
  return cart.value.reduce((acc, item) => acc + item.subtotal, 0)
})

const extrasItemTotal = computed(() => {
  if (!extrasProduct.value) return 0
  // Qty-based extras
  const qtyExtrasTotal = chosenExtras.value.reduce((acc, e) => acc + (e.extra.preco * e.qty), 0)
  // Checkbox extras (max = 1)
  const setExtrasTotal = extrasList.value
    .filter(e => chosenExtraSet.value.has(e.id))
    .reduce((acc, e) => acc + e.preco, 0)
  return Number(extrasProduct.value.preco) + qtyExtrasTotal + setExtrasTotal
})

function formatPrice(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function productImgSrc(product) {
  if (!product) return ''
  if (product.imagem_base64) {
    const b64 = product.imagem_base64
    if (b64.startsWith('/9j/')) return 'data:image/jpeg;base64,' + b64
    if (b64.startsWith('iVBORw0KGgo')) return 'data:image/png;base64,' + b64
    return 'data:image/jpeg;base64,' + b64
  }
  if (product.imagem_url) return product.imagem_url
  return ''
}

function onImgError(event) {
  event.target.src = 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=300&q=80'
}

function filterProducts() {
  // Just triggers computed property reactivity
}

// ── Cart operations ──

function addToCart(product) {
  // If product has extras, open modal to choose them
  if (product.extras && product.extras.length > 0) {
    openExtrasModal(product)
    return
  }

  // Quick add for products without extras
  const existing = cart.value.findIndex(
    item => item.produto_id === product.id && item.extras.length === 0
  )
  if (existing >= 0) {
    cart.value[existing].quantidade++
    cart.value[existing].subtotal = cart.value[existing].preco_unitario * cart.value[existing].quantidade
    cart.value = [...cart.value]
  } else {
    cart.value.push({
      produto_id: product.id,
      nome_produto: product.nome,
      quantidade: 1,
      preco_unitario: Number(product.preco),
      extras: [],
      subtotal: Number(product.preco),
    })
  }
}

function removeItem(idx) {
  cart.value.splice(idx, 1)
  cart.value = [...cart.value]
}

function incrementQty(idx) {
  cart.value[idx].quantidade++
  const basePrice = cart.value[idx].preco_unitario
  const extrasTotal = cart.value[idx].extras.reduce((acc, e) => acc + (e.preco || 0) * (e.qty || 1), 0)
  cart.value[idx].subtotal = (basePrice + extrasTotal) * cart.value[idx].quantidade
  cart.value = [...cart.value]
}

function decrementQty(idx) {
  if (cart.value[idx].quantidade <= 1) {
    removeItem(idx)
    return
  }
  cart.value[idx].quantidade--
  const basePrice = cart.value[idx].preco_unitario
  const extrasTotal = cart.value[idx].extras.reduce((acc, e) => acc + (e.preco || 0) * (e.qty || 1), 0)
  cart.value[idx].subtotal = (basePrice + extrasTotal) * cart.value[idx].quantidade
  cart.value = [...cart.value]
}

function clearCart() {
  cart.value = []
  orderForm.value = { nome_cliente: '', mesa: '', metodo_pagamento: 'conta', observacoes: '' }
}

// ── Extras Modal ──

function openExtrasModal(product) {
  extrasProduct.value = product
  extrasList.value = product.extras || []
  chosenExtras.value = []
  chosenExtraSet.value = new Set()
  extrasModalOpen.value = true
}

function closeExtrasModal() {
  extrasModalOpen.value = false
  // Don't clear product immediately so animation can finish
  setTimeout(() => {
    extrasProduct.value = null
  }, 200)
}

// Qty-based extras (max > 1 or unlimited)
function getExtraQty(extra) {
  const found = chosenExtras.value.find(e => e.extra.id === extra.id)
  return found ? found.qty : 0
}

function incrementExtra(extra) {
  const max = extra.maximo || 99
  const found = chosenExtras.value.find(e => e.extra.id === extra.id)
  if (found) {
    if (found.qty < max) found.qty++
  } else {
    chosenExtras.value.push({ extra, qty: 1 })
  }
}

function decrementExtra(extra) {
  const idx = chosenExtras.value.findIndex(e => e.extra.id === extra.id)
  if (idx >= 0) {
    if (chosenExtras.value[idx].qty <= 1) {
      chosenExtras.value.splice(idx, 1)
    } else {
      chosenExtras.value[idx].qty--
    }
  }
}

// Checkbox extras (max = 1)
function hasExtra(extra) {
  return chosenExtraSet.value.has(extra.id)
}

function toggleExtra(extra) {
  if (chosenExtraSet.value.has(extra.id)) {
    chosenExtraSet.value.delete(extra.id)
  } else {
    chosenExtraSet.value.add(extra.id)
  }
  chosenExtraSet.value = new Set(chosenExtraSet.value)
}

function buildChosenExtrasArray() {
  const result = []
  // Qty-based extras
  for (const { extra, qty } of chosenExtras.value) {
    if (qty > 0) {
      result.push({ id: extra.id, nome: extra.nome, preco: extra.preco, qty })
    }
  }
  // Checkbox extras
  for (const extra of extrasList.value) {
    if (chosenExtraSet.value.has(extra.id)) {
      result.push({ id: extra.id, nome: extra.nome, preco: extra.preco, qty: 1 })
    }
  }
  return result
}

function confirmExtras() {
  if (!extrasProduct.value) return

  const chosenExtrasArray = buildChosenExtrasArray()
  let extrasTotal = 0
  for (const e of chosenExtrasArray) {
    extrasTotal += e.preco * e.qty
  }

  const itemTotal = Number(extrasProduct.value.preco) + extrasTotal

  const extrasLegacy = chosenExtrasArray.map(e => ({
    nome: e.nome,
    preco: e.preco,
    qty: e.qty,
  }))

  const product = extrasProduct.value
  const existingIndex = cart.value.findIndex(
    item => item.produto_id === product.id &&
      JSON.stringify(item.extras) === JSON.stringify(extrasLegacy)
  )

  if (existingIndex >= 0) {
    cart.value[existingIndex].quantidade++
    cart.value[existingIndex].subtotal += itemTotal
  } else {
    cart.value.push({
      produto_id: product.id,
      nome_produto: product.nome,
      quantidade: 1,
      preco_unitario: Number(product.preco),
      extras: extrasLegacy,
      subtotal: itemTotal,
    })
  }

  cart.value = [...cart.value]
  closeExtrasModal()
  showFeedback(`${product.nome} adicionado ao carrinho!`, 'success')
}

// ── Create order ──

async function createOrder() {
  if (!orderForm.value.nome_cliente) {
    showFeedback('Informe o nome do cliente ou mesa.', 'erro')
    return
  }
  if (cart.value.length === 0) {
    showFeedback('Adicione produtos ao carrinho.', 'erro')
    return
  }

  sending.value = true
  globalLoading.value = true
  loadingMessage.value = 'Enviando pedido...'

  try {
    const payload = {
      origem: 'salao',
      nome_cliente: orderForm.value.nome_cliente,
      mesa: orderForm.value.mesa || undefined,
      metodo_pagamento: orderForm.value.metodo_pagamento,
      observacoes: orderForm.value.observacoes,
      itens: cart.value.map(item => ({
        produto_id: item.produto_id,
        nome_produto: item.nome_produto,
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        extras: item.extras.map(e => ({ nome: e.nome, preco: e.preco, qty: e.qty || 1 })),
        subtotal: item.subtotal,
      })),
    }

    const { data } = await api.post('/pedidos/pdv', payload)
    showFeedback(`✅ Pedido ${data.pedido_id} enviado para a cozinha!`, 'success')
    clearCart()
  } catch (err) {
    showFeedback(err.response?.data?.error || 'Erro ao criar pedido.', 'erro')
  } finally {
    sending.value = false
    globalLoading.value = false
  }
}

onMounted(async () => {
  // Conectar WebSocket para atualizações em tempo real
  connectRealtime()

  // Load categories
  try {
    const { data: cats } = await api.get('/produtos/categorias')
    categories.value = [{ nome: 'Todos', slug: 'todos' }, ...cats]
  } catch { /* ignore */ }

  // Load mesas for dropdown
  await loadMesas()

  // Recarregar mesas quando pedidos mudarem
  onEvent('pedido:novo', () => { loadMesas() })
  onEvent('pedido:atualizado', () => { loadMesas() })

  // Load products with extras
  try {
    const { data } = await api.get('/produtos/com-extras')
    products.value = data
  } catch (err) {
    showFeedback('Erro ao carregar produtos.', 'erro')
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  offEvent('pedido:novo')
  offEvent('pedido:atualizado')
})
</script>

<style scoped>
.pdv-layout {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 1.5rem;
  height: calc(100vh - 120px);
  overflow: hidden;
}

/* ── Products Area ── */
.pdv-products {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow: hidden;
}

.pdv-toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  flex-shrink: 0;
}

.pdv-search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.75rem;
  transition: var(--transition);
}
.pdv-search:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(220,38,38,0.1);
}
.pdv-search input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 0.9rem;
  font-family: inherit;
  background: transparent;
}
.pdv-search .clear-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: var(--text-muted);
  padding: 0 4px;
}

.pdv-categories {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  flex-shrink: 0;
}
.pdv-cat-btn {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: var(--transition);
  font-family: inherit;
}
.pdv-cat-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.pdv-cat-btn.active {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
}

.pdv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
  overflow-y: auto;
  padding: 4px;
  flex: 1;
  align-content: start;
}

.pdv-product-btn {
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: var(--radius);
  padding: 0;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
  overflow: hidden;
  position: relative;
}
.pdv-product-btn:hover {
  border-color: var(--primary);
  box-shadow: 0 4px 12px rgba(220,38,38,0.15);
  transform: translateY(-2px);
}
.pdv-product-btn:active {
  transform: translateY(0);
}
.pdv-product-btn.has-extras {
  border-color: #f59e0b;
}
.pdv-product-btn.has-extras:hover {
  border-color: var(--primary);
  box-shadow: 0 4px 12px rgba(220,38,38,0.15);
}

.pdv-product-img {
  width: 100%;
  height: 100px;
  overflow: hidden;
  background: var(--border-light);
}
.pdv-product-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pdv-product-info {
  padding: 0.5rem 0.65rem;
  flex: 1;
}
.pdv-product-name {
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 2px;
  line-height: 1.2;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pdv-product-price {
  font-size: 0.9rem;
  font-weight: 800;
  color: var(--primary);
}

.pdv-product-add {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.8);
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(220,38,38,0.3);
}
.pdv-product-btn:hover .pdv-product-add {
  opacity: 1;
  transform: scale(1);
}

.pdv-product-extras-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: #f59e0b;
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  gap: 3px;
}

.pdv-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: var(--text-muted);
  gap: 0.5rem;
}

/* ── Cart Sidebar ── */
.pdv-cart {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.pdv-cart-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
  font-weight: 700;
  font-size: 0.95rem;
  flex-shrink: 0;
}
.pdv-cart-count {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}

.pdv-cart-items {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0;
}

.pdv-cart-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border-light);
  transition: background 0.15s;
}
.pdv-cart-item:hover {
  background: var(--border-light);
}

.pdv-cart-item-info {
  flex: 1;
  min-width: 0;
}
.pdv-cart-item-name {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pdv-cart-item-price {
  font-size: 0.8rem;
  color: var(--primary);
  font-weight: 700;
}
.pdv-cart-item-extras {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 2px;
}
.pdv-cart-item-extras span {
  display: block;
}

.pdv-cart-item-qty {
  display: flex;
  align-items: center;
  gap: 4px;
}
.qty-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-secondary);
  transition: var(--transition);
  font-family: inherit;
}
.qty-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--error-light);
}
.pdv-cart-item-qty span {
  min-width: 20px;
  text-align: center;
  font-weight: 700;
  font-size: 0.9rem;
}

.pdv-cart-item-remove {
  background: none;
  border: none;
  font-size: 1.1rem;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  transition: color 0.15s;
}
.pdv-cart-item-remove:hover {
  color: var(--error);
}

.pdv-cart-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  gap: 0.5rem;
  padding: 2rem;
}
.pdv-cart-empty small {
  font-size: 0.8rem;
}

.pdv-cart-footer {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  flex-shrink: 0;
}

.pdv-cart-total {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  font-weight: 600;
}
.pdv-cart-total.grand {
  font-size: 1.1rem;
  font-weight: 800;
  padding-top: 0.5rem;
  border-top: 2px solid var(--border);
  margin-bottom: 0.5rem;
}

.pdv-customer-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.pdv-customer-info .form-group {
  margin-bottom: 0;
}
.pdv-customer-info .form-group label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.25rem;
  display: block;
}
.pdv-customer-info .form-group input,
.pdv-customer-info .form-group select,
.pdv-customer-info .form-group textarea {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-xs);
  font-size: 0.85rem;
  font-family: inherit;
  outline: none;
  background: var(--surface);
  transition: var(--transition);
}
.pdv-customer-info .form-group input:focus,
.pdv-customer-info .form-group select:focus,
.pdv-customer-info .form-group textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(220,38,38,0.1);
}
.pdv-customer-info .form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.pdv-cart-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* ── Extras Modal ── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}
.modal-backdrop.open {
  opacity: 1;
  pointer-events: auto;
}

.extras-modal {
  background: var(--surface);
  border-radius: var(--radius);
  width: 480px;
  max-width: 92vw;
  max-height: 85vh;
  overflow-y: auto;
  position: relative;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  animation: modalIn 0.25s ease;
}
@keyframes modalIn {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.modal-close-btn {
  position: absolute;
  top: 10px;
  right: 12px;
  background: rgba(0,0,0,0.5);
  border: none;
  color: white;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: 1.3rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  z-index: 2;
  transition: background 0.15s;
}
.modal-close-btn:hover {
  background: rgba(0,0,0,0.7);
}

.extras-modal-header {
  display: flex;
  gap: 1rem;
  padding: 1.25rem;
  border-bottom: 1px solid var(--border-light);
}
.extras-modal-img {
  width: 80px;
  height: 80px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  flex-shrink: 0;
}
.extras-modal-title h3 {
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 4px;
}
.extras-modal-title p {
  font-size: 0.8rem;
  color: var(--text-muted);
  line-height: 1.4;
  margin: 0;
}

.extras-modal-body {
  padding: 1rem 1.25rem;
}

.extras-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-secondary);
  margin: 0 0 0.75rem;
}

.extra-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--border-light);
}
.extra-item:last-child {
  border-bottom: none;
}

.extra-item-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.extra-label {
  font-size: 0.85rem;
  font-weight: 600;
}

.extra-qty-selector {
  display: flex;
  align-items: center;
  gap: 4px;
}
.extra-qty-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text-secondary);
  transition: var(--transition);
  font-family: inherit;
  line-height: 1;
}
.extra-qty-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}
.extra-qty-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.extra-qty-value {
  min-width: 18px;
  text-align: center;
  font-weight: 700;
  font-size: 0.85rem;
}

.extra-checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.extra-checkbox-label input[type="checkbox"] {
  accent-color: var(--primary);
  width: 16px;
  height: 16px;
}

.extra-price {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--primary);
  white-space: nowrap;
}

.extras-modal-footer {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.extras-total {
  display: flex;
  flex-direction: column;
}
.extras-total span:first-child {
  font-size: 0.75rem;
  color: var(--text-muted);
}
.extras-total-value {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--primary);
}

.extras-modal-footer .btn {
  padding: 0.65rem 1.25rem;
  font-size: 0.85rem;
  white-space: nowrap;
}

/* Feedback toast */
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
.feedback-toast.success {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}
.feedback-toast.erro {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}
@keyframes slideDown {
  from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
</style>
