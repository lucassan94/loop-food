<template>
  <div>
    <!-- Hero Banner Carrossel -->
    <BannerCarousel :slides="bannerSlides" />

    <!-- Search Bar -->
    <div class="search-bar">
      <i-lucide-search style="width:20px;height:20px" class="search-icon" />
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Buscar por nome, categoria ou descrição..."
        @input="filterProducts"
      />
      <button v-if="searchQuery" class="clear-btn" @click="searchQuery = ''">
        <i-lucide-x style="width:16px;height:16px" />
      </button>
    </div>

    <!-- Categories Tabs -->
    <section class="categories-tabs" ref="categoriesRef">
      <button
        v-for="cat in categories"
        :key="cat.slug"
        class="category-tab"
        :class="{ active: activeCategory === cat.slug }"
        @click="selectCategory(cat.slug)"
      >
        {{ cat.nome }}
      </button>
    </section>

    <!-- Products Grid (agrupado por categoria com separadores) -->
    <section class="menu-section">
      <h2 class="section-title">
        <i-lucide-utensils-crossed style="width:20px;height:20px" />
        {{ sectionTitle }}
      </h2>

      <!-- Estado vazio -->
      <div v-if="filteredProducts.length === 0 && !loading" class="empty-search">
        <i-lucide-search style="width:48px;height:48px" />
        <p v-if="searchQuery">
          Nenhum prato encontrado para '{{ searchQuery }}'<br />
          <small>Tente buscar por outro nome ou categoria</small>
        </p>
        <p v-else>
          Nenhum produto disponível no momento.<br />
          <small>Volte mais tarde para conferir nosso cardápio.</small>
        </p>
      </div>

      <!-- Produtos agrupados por categoria -->
      <template v-else>
        <div
          v-for="(group, index) in filteredProductsByCategory"
          :key="group.categoria_slug"
        >
          <!-- Separador entre categorias -->
          <div v-if="index > 0" class="category-divider"></div>

          <!-- Título da categoria -->
          <h3 class="category-group-title">
            <i-lucide-tag style="width:16px;height:16px" />
            {{ group.categoria_nome }}
          </h3>

          <!-- Grid de produtos da categoria -->
          <div class="products-grid">
            <article
              v-for="product in group.products"
              :key="product.id"
              class="product-card"
              :class="{ featured: product.categoria_slug === 'destaques' }"
              @click="openProductModal(product)"
            >
              <div class="product-card-image">
                <img
                  :src="productImgSrc(product)"
                  :alt="product.nome"
                  loading="lazy"
                  @error="onImgError($event)"
                />
              </div>
              <div class="product-card-body">
                <h3>
                  <span v-if="product.categoria_slug === 'destaques'" class="featured-fire-badge-inline">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 23C15.5 23 18.5 20.5 18.5 16.5C18.5 12.5 14.5 9 13 7C12.5 6 12 4.5 12 2C10 4.5 5.5 9.5 5.5 16.5C5.5 20.5 8.5 23 12 23Z"
                        fill="url(#fire-grad)" stroke="url(#fire-stroke)" stroke-width="0.5" />
                      <path d="M12 20C14 20 15.5 18.5 15.5 16C15.5 13.5 13 11.5 12 10.5C11 11.5 8.5 13.5 8.5 16C8.5 18.5 10 20 12 20Z"
                        fill="#fef08a" opacity="0.7" />
                      <defs>
                        <linearGradient id="fire-grad" x1="12" y1="2" x2="12" y2="23" gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stop-color="#facc15" />
                          <stop offset="40%" stop-color="#f97316" />
                          <stop offset="100%" stop-color="#dc2626" />
                        </linearGradient>
                        <linearGradient id="fire-stroke" x1="12" y1="2" x2="12" y2="23" gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stop-color="#fef08a" />
                          <stop offset="50%" stop-color="#f97316" />
                          <stop offset="100%" stop-color="#b91c1c" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </span>
                  {{ product.nome }}
                </h3>
                <p>{{ product.descricao || 'Sem descrição' }}</p>
                <div class="product-card-footer">
                  <span class="product-price">{{ formatPrice(product.preco) }}</span>
                  <button class="btn-add-cart" @click.stop="quickAdd(product)">
                    <i-lucide-plus style="width:16px;height:16px" />
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </template>

      <div v-if="loading" class="loading-wrapper">
        <div class="spinner spinner-center"></div>
      </div>
    </section>

    <!-- Product Modal -->
    <div class="modal-backdrop" :class="{ open: productModalOpen }" @click.self="closeProductModal">
      <div class="product-modal pos-relative">
        <button class="modal-close" @click="closeProductModal">&times;</button>
        <img
          :src="productImgSrc(selectedProduct)"
          :alt="selectedProduct?.nome"
          class="modal-image"
          @error="onImgError"
        />
        <div class="modal-body">
          <h3>{{ selectedProduct?.nome }}</h3>
          <p class="desc">{{ selectedProduct?.descricao || 'Sem descrição' }}</p>

          <div v-if="selectedOpcoes.length > 0" class="modal-opcoes">
            <h4 class="modal-extras-title">
              <i-lucide-list-checks style="width:16px;height:16px" /> Opções do Prato
            </h4>
            <div v-for="grupo in selectedOpcoes" :key="grupo.grupo" class="opcao-grupo">
              <div class="opcao-grupo-titulo">
                {{ grupo.grupo }}
                <span v-if="grupo.obrigatoria" class="opcao-obrigatoria" title="Obrigatório escolher">*</span>
              </div>
              <label
                v-for="op in grupo.opcoes"
                :key="op.id"
                class="opcao-item"
                :class="{ selecionada: isOpcaoSelecionada(grupo, op) }"
              >
                <input
                  v-if="grupo.tipo === 'unica'"
                  type="radio"
                  :name="'opc-' + grupo.grupo"
                  :value="op.id"
                  v-model="chosenOpcoes[grupo.grupo]"
                />
                <input
                  v-else
                  type="checkbox"
                  :value="op.id"
                  v-model="chosenOpcoesMulti[grupo.grupo]"
                />
                <span>{{ op.nome }}</span>
              </label>
            </div>
          </div>

          <!-- Talheres obrigatório (Sim/Não) -->
          <div v-if="selectedProduct?.talheres_obrigatorio" class="opcao-grupo">
            <div class="opcao-grupo-titulo">
              Talheres
              <span class="opcao-obrigatoria" title="Obrigatório escolher">*</span>
            </div>
            <label class="opcao-item" :class="{ selecionada: chosenTalheres === true }">
              <input type="radio" name="talheres" :value="true" v-model="chosenTalheres" />
              <span>Sim, quero talheres 🍴</span>
            </label>
            <label class="opcao-item" :class="{ selecionada: chosenTalheres === false }">
              <input type="radio" name="talheres" :value="false" v-model="chosenTalheres" />
              <span>Não, obrigado</span>
            </label>
          </div>

          <!-- Observação individual do item -->
          <div class="form-group" style="margin-top:0.75rem;">
            <label style="font-size:0.8rem;font-weight:600;color:var(--text-muted);">Observação para este item</label>
            <textarea
              v-model="itemObservacao"
              rows="2"
              placeholder="Ex: Sem cebola, molho extra, ponto bem passado..."
              style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:0.85rem;outline:none;transition:var(--transition);"
              @focus="$event.target.style.borderColor = 'var(--primary)'"
              @blur="$event.target.style.borderColor = 'var(--border)'"
            ></textarea>
          </div>

          <div v-if="selectedExtras.length > 0">
            <h4 class="modal-extras-title">
              <i-lucide-plus-circle style="width:16px;height:16px" /> Adicionais (Opcional)
            </h4>
            <div v-for="grupo in extrasGrupos" :key="grupo.nome" class="extra-grupo">
              <div v-if="grupo.nome !== 'Geral'" class="extra-subcategoria-titulo">{{ grupo.nome }}</div>
              <div class="extra-item" v-for="extra in grupo.itens" :key="extra.key">
                <div class="extra-item-left">
                  <img
                    v-if="extraImgSrc(extra)"
                    :src="extraImgSrc(extra)"
                    :alt="extra.nome"
                    class="extra-item-img"
                    @error="$event.target.style.display = 'none'"
                  />
                  <div class="extra-item-info">
                    <span class="extra-label">{{ extra.nome }}</span>
                    <span v-if="extra.descricao" class="extra-item-desc">{{ extra.descricao }}</span>
                  </div>
                <!-- Qty selector for max > 1 or unlimited -->
                <div v-if="!extra.maximo || extra.maximo > 1" class="extra-qty">
                  <button class="extra-qty-btn" @click="decrementExtra(extra)" :disabled="getExtraQty(extra) <= 0">−</button>
                  <span class="extra-qty-value">{{ getExtraQty(extra) }}</span>
                  <button class="extra-qty-btn" @click="incrementExtra(extra)" :disabled="getExtraQty(extra) >= (extra.maximo || 99)">+</button>
                </div>
                <!-- Simple checkbox for max = 1 -->
                <label v-else class="extra-checkbox-label">
                  <input type="checkbox" :checked="hasExtra(extra)" @change="toggleExtra(extra)" />
                  <span>Adicionar</span>
                </label>
              </div>
                <span class="extra-price">{{ formatPrice(extra.preco) }}</span>
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <span class="price">{{ formatPrice(productTotal) }}</span>
            <button class="btn-add-modal" @click="addToCart">
              <i-lucide-shopping-bag style="width:16px;height:16px" /> Adicionar
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, inject } from 'vue'
import api from '../services/api'
import BannerCarousel from '../components/BannerCarousel.vue'
import { PRODUCT_PLACEHOLDER } from '../utils/images'

const addToast = inject('addToast')

// Carrossel de Banner — carregado dinamicamente do backend
const bannerSlides = ref([
  // Fallback enquanto carrega
  {
    image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1000&q=80',
    title: 'Cardápio Digital',
    subtitle: 'Carregando...',
  },
])

// Data
const products = ref([])
const categories = ref([
  { nome: 'Todos', slug: 'todos' },
  { nome: 'Em Destaque', slug: 'destaques' },
  { nome: 'Pratos', slug: 'principais' },
  { nome: 'Executivos', slug: 'executivos' },
  { nome: 'Saladas', slug: 'saladas' },
  { nome: 'Monte Seu', slug: 'monte-seu' },
  { nome: 'Para 2', slug: 'para-2' },
  { nome: 'Sobremesas', slug: 'sobremesas' },
  { nome: 'Bebidas', slug: 'bebidas' },
])
const loading = ref(true)
const searchQuery = ref('')
const activeCategory = ref('todos')

// Product modal
const productModalOpen = ref(false)
const selectedProduct = ref(null)
const selectedExtras = ref([])
const chosenExtras = ref([])          // [{extra, qty}] for extras with max > 1
const chosenExtraSet = ref(new Set()) // Set of extra IDs (simple checkbox mode)

// Opções do prato (gratuitas)
const selectedOpcoes = ref([])
const chosenOpcoes = ref({})        // grupo -> op.id (seleção única)
const chosenOpcoesMulti = ref({})   // grupo -> [op.id, ...] (seleção múltipla)

// Talheres
const chosenTalheres = ref(null)
const itemObservacao = ref('')

// Adicionais agrupados por subcategoria (catálogo compartilhado + legado 'Geral')
const extrasGrupos = computed(() => {
  const grupos = []
  const seen = new Map()
  for (const extra of selectedExtras.value) {
    const nome = extra.subcategoria || 'Geral'
    if (!seen.has(nome)) {
      seen.set(nome, { nome, itens: [] })
      grupos.push(seen.get(nome))
    }
    seen.get(nome).itens.push(extra)
  }
  return grupos
})

// Cart
const cartItems = inject('cartItems')
const updateCart = inject('updateCart')
const triggerCartBump = inject('triggerCartBump')

// Filtragem normal (plana)
const filteredProducts = computed(() => {
  let result = products.value

  if (activeCategory.value !== 'todos') {
    result = result.filter(p => p.categoria_slug === activeCategory.value)
  }

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(p =>
      p.nome.toLowerCase().includes(q) ||
      p.descricao?.toLowerCase().includes(q) ||
      p.categoria_nome?.toLowerCase().includes(q)
    )
  }

  return result
})

// Produtos agrupados por categoria (com separação visual)
const filteredProductsByCategory = computed(() => {
  const groups = {}
  for (const product of filteredProducts.value) {
    const key = product.categoria_slug || 'outros'
    if (!groups[key]) {
      groups[key] = {
        categoria_slug: key,
        categoria_nome: product.categoria_nome || 'Outros',
        products: [],
      }
    }
    groups[key].products.push(product)
  }
  return Object.values(groups)
})

const sectionTitle = computed(() => {
  if (activeCategory.value === 'todos') return 'Nossos Pratos'
  const cat = categories.value.find(c => c.slug === activeCategory.value)
  return cat?.nome || 'Cardápio'
})

const productTotal = computed(() => {
  if (!selectedProduct.value) return 0
  // Extras com quantidade (max > 1)
  const qtyExtrasTotal = chosenExtras.value.reduce((acc, e) => acc + (e.extra.preco * e.qty), 0)
  // Extras checkbox (max = 1)
  // ATENÇÃO: chosenExtraSet guarda extra.key (ex: 's123'), não o id — comparar com .key
  const setExtrasTotal = selectedExtras.value
    .filter(e => chosenExtraSet.value.has(e.key))
    .reduce((acc, e) => acc + e.preco, 0)
  return selectedProduct.value.preco + qtyExtrasTotal + setExtrasTotal
})

function playPopSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.connect(gain)
    gain.connect(ctx.destination)
    // Quick descending tone = pop!
    osc.frequency.setValueAtTime(800, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.12)
  } catch { /* Audio not available */ }
}

function formatPrice(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
  }).format(value)
}

function productImgSrc(product) {
  if (!product) return PRODUCT_PLACEHOLDER
  if (product.imagem_base64) {
    const b64 = product.imagem_base64
    // Detectar formato pela assinatura base64
    if (b64.startsWith('/9j/')) return 'data:image/jpeg;base64,' + b64
    if (b64.startsWith('iVBORw0KGgo')) return 'data:image/png;base64,' + b64
    if (b64.startsWith('R0lGOD')) return 'data:image/gif;base64,' + b64
    if (b64.startsWith('UklGR')) return 'data:image/webp;base64,' + b64
    // SVG: detectar por decoding
    try {
      const decoded = atob(b64.substring(0, 20))
      if (decoded.startsWith('<svg')) {
        return 'data:image/svg+xml;base64,' + b64
      }
    } catch {}
    // Fallback: tenta PNG, depois JPEG
    return 'data:image/jpeg;base64,' + b64
  }
  if (product.imagem_url) return product.imagem_url
  return PRODUCT_PLACEHOLDER
}

function onImgError(event) {
  // Evita loop infinito se o próprio placeholder falhar
  if (event.target.src.startsWith('data:image/svg+xml')) return
  event.target.src = PRODUCT_PLACEHOLDER
}

function selectCategory(slug) {
  activeCategory.value = slug
}

function buildExtrasList(product) {
  const list = []
  // Itens do catálogo (subcategorias ativas) — key prefixada para não colidir com legado
  for (const sub of product.subcategorias || []) {
    for (const item of sub.itens || []) {
      list.push({
        key: 's' + item.id, subcategoria: sub.nome, id: item.id, nome: item.nome,
        preco: Number(item.preco), maximo: item.maximo,
        descricao: item.descricao || '',
        imagem_base64: item.imagem_base64 || '',
        imagem_url: item.imagem_url || '',
      })
    }
  }
  // Adicionais avulsos (legado) — grupo 'Geral'
  for (const extra of product.extras || []) {
    list.push({ key: 'e' + extra.id, subcategoria: 'Geral', id: extra.id, nome: extra.nome, preco: Number(extra.preco), maximo: extra.maximo })
  }
  return list
}

// Imagem do item adicional (subcategoria) — base64 ou URL
function extraImgSrc(extra) {
  if (!extra) return ''
  const b64 = extra.imagem_base64
  if (b64) {
    if (b64.startsWith('/9j/')) return 'data:image/jpeg;base64,' + b64
    if (b64.startsWith('iVBORw0KGgo')) return 'data:image/png;base64,' + b64
    if (b64.startsWith('R0lGOD')) return 'data:image/gif;base64,' + b64
    if (b64.startsWith('UklGR')) return 'data:image/webp;base64,' + b64
    try {
      if (atob(b64.substring(0, 20)).startsWith('<svg')) return 'data:image/svg+xml;base64,' + b64
    } catch {}
    return 'data:image/jpeg;base64,' + b64
  }
  return extra.imagem_url || ''
}

function openProductModal(product) {
  selectedProduct.value = product
  selectedExtras.value = buildExtrasList(product)
  selectedOpcoes.value = product.opcoes || []
  chosenExtras.value = []
  chosenExtraSet.value = new Set()
  chosenOpcoes.value = {}
  chosenOpcoesMulti.value = {}
  chosenTalheres.value = null
  itemObservacao.value = ''
  productModalOpen.value = true
}

function closeProductModal() {
  productModalOpen.value = false
  selectedProduct.value = null
}

// ── Extra selection (qty-based) ──
function getExtraQty(extra) {
  const found = chosenExtras.value.find(e => e.extra.key === extra.key)
  return found ? found.qty : 0
}

function incrementExtra(extra) {
  const max = extra.maximo || 99
  const found = chosenExtras.value.find(e => e.extra.key === extra.key)
  if (found) {
    if (found.qty < max) found.qty++
  } else {
    chosenExtras.value.push({ extra, qty: 1 })
  }
}

function decrementExtra(extra) {
  const idx = chosenExtras.value.findIndex(e => e.extra.key === extra.key)
  if (idx >= 0) {
    if (chosenExtras.value[idx].qty <= 1) {
      chosenExtras.value.splice(idx, 1)
    } else {
      chosenExtras.value[idx].qty--
    }
  }
}

// ── Extra selection (checkbox-based, max=1) ──
function hasExtra(extra) {
  return chosenExtraSet.value.has(extra.key)
}

function toggleExtra(extra) {
  if (chosenExtraSet.value.has(extra.key)) {
    chosenExtraSet.value.delete(extra.key)
  } else {
    chosenExtraSet.value.add(extra.key)
  }
  // Force reactivity
  chosenExtraSet.value = new Set(chosenExtraSet.value)
}

// ── Opções do prato (gratuitas) ──
function isOpcaoSelecionada(grupo, op) {
  if (grupo.tipo === 'unica') return chosenOpcoes.value[grupo.grupo] === op.id
  return (chosenOpcoesMulti.value[grupo.grupo] || []).includes(op.id)
}

function validarOpcoesObrigatorias() {
  for (const grupo of selectedOpcoes.value) {
    if (!grupo.obrigatoria) continue
    const escolhida = grupo.tipo === 'unica'
      ? chosenOpcoes.value[grupo.grupo]
      : (chosenOpcoesMulti.value[grupo.grupo] || []).length
    if (!escolhida) {
      addToast(`Selecione "${grupo.grupo}" antes de adicionar.`, 'error')
      return false
    }
  }
  return true
}

function buildChosenOpcoesArray() {
  const result = []
  for (const grupo of selectedOpcoes.value) {
    if (grupo.tipo === 'unica') {
      const op = grupo.opcoes.find(o => o.id === chosenOpcoes.value[grupo.grupo])
      if (op) result.push({ grupo: grupo.grupo, nome: op.nome })
    } else {
      for (const id of (chosenOpcoesMulti.value[grupo.grupo] || [])) {
        const op = grupo.opcoes.find(o => o.id === id)
        if (op) result.push({ grupo: grupo.grupo, nome: op.nome })
      }
    }
  }
  return result
}

// ── Build extra array for cart item ──
function buildChosenExtrasArray() {
  const result = []
  // Qty-based extras
  for (const { extra, qty } of chosenExtras.value) {
    if (qty > 0) {
      result.push({ id: extra.id, nome: extra.nome, preco: extra.preco, qty })
    }
  }
  // Checkbox extras
  for (const extra of selectedExtras.value) {
    if (chosenExtraSet.value.has(extra.key)) {
      result.push({ id: extra.id, nome: extra.nome, preco: extra.preco, qty: 1 })
    }
  }
  return result
}

function addToCart() {
  if (!selectedProduct.value) return

  const chosenExtrasArray = buildChosenExtrasArray()
  let extrasTotal = 0
  for (const e of chosenExtrasArray) {
    extrasTotal += e.preco * e.qty
  }

  const itemTotal = selectedProduct.value.preco + extrasTotal

  // Normalizar extras para o formato antigo (compatibilidade)
  const extrasLegacy = chosenExtrasArray.map(e => ({
    nome: e.nome,
    preco: e.preco,
    qty: e.qty
  }))

  // Opções do prato (gratuitas) — grupos obrigatórios bloqueiam a adição
  if (!validarOpcoesObrigatorias()) return
  const opcoesArray = buildChosenOpcoesArray()

  // Talheres obrigatório
  if (selectedProduct.value.talheres_obrigatorio && typeof chosenTalheres.value !== 'boolean') {
    addToast('Escolha se quer ou não talheres antes de adicionar.', 'error')
    return
  }

  const existingIndex = cartItems.value.findIndex(
    item => item.produto_id === selectedProduct.value.id &&
      JSON.stringify(item.extras) === JSON.stringify(extrasLegacy) &&
      JSON.stringify(item.opcoes || []) === JSON.stringify(opcoesArray) &&
      item.talheres === chosenTalheres.value &&
      item.observacao === itemObservacao.value
  )

  if (existingIndex >= 0) {
    const items = [...cartItems.value]
    items[existingIndex].quantidade++
    items[existingIndex].subtotal += itemTotal
    updateCart(items)
  } else {
    const newItem = {
      produto_id: selectedProduct.value.id,
      nome_produto: selectedProduct.value.nome,
      quantidade: 1,
      preco_unitario: selectedProduct.value.preco,
      extras: extrasLegacy,
      opcoes: opcoesArray,
      talheres: chosenTalheres.value,
      observacao: itemObservacao.value,
      subtotal: itemTotal,
    }
    updateCart([...cartItems.value, newItem])
  }

  playPopSound()
  triggerCartBump()
  addToast(`${selectedProduct.value.nome} adicionado ao carrinho!`, 'success')
  closeProductModal()
}

function quickAdd(product) {
  // Produtos com subcategorias de adicionais ou opções abrem o modal para escolher
  if ((product.subcategorias && product.subcategorias.length > 0) ||
      (product.opcoes && product.opcoes.length > 0)) {
    openProductModal(product)
    return
  }
  const extrasTotal = 0
  const existingIndex = cartItems.value.findIndex(
    item => item.produto_id === product.id && item.extras.length === 0
  )

  if (existingIndex >= 0) {
    const items = [...cartItems.value]
    items[existingIndex].quantidade++
    items[existingIndex].subtotal += product.preco
    updateCart(items)
  } else {
    const newItem = {
      produto_id: product.id,
      nome_produto: product.nome,
      quantidade: 1,
      preco_unitario: product.preco,
      extras: [],
      opcoes: [],
      talheres: null,
      observacao: '',
      subtotal: product.preco,
    }
    updateCart([...cartItems.value, newItem])
  }

  playPopSound()
  triggerCartBump()
  addToast(`${product.nome} adicionado ao carrinho!`, 'success')
}

function bannerImg(banner) {
  if (banner.imagem_base64) {
    const b64 = banner.imagem_base64
    if (b64.startsWith('/9j/')) return 'data:image/jpeg;base64,' + b64
    if (b64.startsWith('iVBORw0KGgo')) return 'data:image/png;base64,' + b64
    if (b64.startsWith('R0lGOD')) return 'data:image/gif;base64,' + b64
    if (b64.startsWith('UklGR')) return 'data:image/webp;base64,' + b64
    try {
      if (atob(b64.substring(0, 20)).startsWith('<svg')) return 'data:image/svg+xml;base64,' + b64
    } catch {}
    return 'data:image/jpeg;base64,' + b64
  }
  return banner.imagem_url || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1000&q=80'
}

async function carregarBanners() {
  try {
    const { data } = await api.get('/restaurante/banners')
    if (data.length > 0) {
      bannerSlides.value = data.map(b => ({
        image: bannerImg(b),
        title: b.titulo || 'Palazzo Mooca',
        subtitle: b.subtitulo || '',
        link: b.link_url || null,
      }))
    }
  } catch { /* usa fallback */ }
}

onMounted(async () => {
  // Carregar banners dinâmicos
  carregarBanners()

  try {
    // Endpoint otimizado: retorna produtos com extras em 2 queries
    const { data } = await api.get('/produtos/com-extras')
    products.value = data
  } catch (err) {
    addToast('Erro ao carregar cardápio.', 'error')
  } finally {
    loading.value = false
  }
})
</script>
