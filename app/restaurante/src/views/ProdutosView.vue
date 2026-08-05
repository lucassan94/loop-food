<template>
  <div>
    <!-- Abas do Cardápio: Produtos | Categorias | Subcategorias | Opções Padrão -->
    <div class="cardapio-tabs">
      <button class="cardapio-tab" :class="{ active: mainTab === 'produtos' }" @click="mainTab = 'produtos'">
        <i-lucide-hamburger style="width:16px;height:16px" /> Produtos
      </button>
      <button class="cardapio-tab" :class="{ active: mainTab === 'categorias' }" @click="switchToCategorias">
        <i-lucide-tags style="width:16px;height:16px" /> Categorias
      </button>
      <button class="cardapio-tab" :class="{ active: mainTab === 'subcategorias' }" @click="switchToSubcategorias">
        <i-lucide-folder-tree style="width:16px;height:16px" /> Subcategorias Adicionais
      </button>
      <button class="cardapio-tab" :class="{ active: mainTab === 'opcoesPadrao' }" @click="switchToOpcoesPadrao">
        <i-lucide-list-checks style="width:16px;height:16px" /> Opções Padrão
      </button>
    </div>

    <!-- ─────────── Aba: PRODUTOS ─────────── -->
    <div v-show="mainTab === 'produtos'">
    <div style="display:flex;justify-content:space-between;margin-bottom:1rem;align-items:center;">
      <h2 style="font-size:1.2rem;">Gerenciar Produtos</h2>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" @click="novoProduto">+ Novo Produto</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="card" style="text-align:center;padding:3rem;">
      <div class="spinner" style="margin:0 auto;width:40px;height:40px;border:4px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;"></div>
      <p style="margin-top:1rem;color:var(--text-muted);">Carregando produtos...</p>
    </div>

    <!-- Error -->
    <div v-else-if="erroLoad" class="card" style="text-align:center;padding:2rem;">
      <i-lucide-triangle-alert style="width:32px;height:32px;color:var(--error);margin-bottom:0.75rem;" />
      <p style="color:var(--error);font-weight:600;">{{ erroLoad }}</p>
      <button class="btn btn-primary btn-sm" style="margin-top:1rem;" @click="load">
        <i-lucide-refresh-cw style="width:16px;height:16px" /> Tentar novamente
      </button>
    </div>

    <!-- Search / Filter -->
    <div v-else class="filter-bar">
      <input v-model="searchTerm" type="text" placeholder="Buscar produto..." style="flex:1;" @input="load" />
      <select v-model="filterCategoria" @change="load">
        <option value="">Todas as categorias</option>
        <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
      </select>
    </div>

    <div v-if="!loading && !erroLoad" class="card">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:50px;">Img</th>
            <th>Nome</th>
            <th>Categoria</th>
            <th>Preço</th>
            <th>Extras</th>
            <th>Ativo</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in filteredProdutos" :key="p.id">
            <td>
              <div class="table-img-thumb">
                <img :src="getImageSrc(p)" alt="" @error="onImageError(p.id)" />
              </div>
            </td>
            <td><strong>{{ p.nome }}</strong></td>
            <td><span class="cat-badge">{{ p.categoria_nome }}</span></td>
            <td><strong>{{ formatPrice(p.preco) }}</strong></td>
            <td><span class="extras-count">{{ p.extras_count || 0 }}</span></td>
            <td>
              <label class="toggle" @click.stop>
                <input type="checkbox" :checked="p.ativo" @change="toggleAtivo(p)" />
                <span class="slider"></span>
              </label>
            </td>
            <td>
              <button class="btn btn-sm btn-secondary" @click="editar(p)">Editar</button>
              <button class="btn btn-sm btn-danger" @click="excluir(p)">Excluir</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    </div> <!-- /aba produtos -->

    <!-- ─────────── Aba: CATEGORIAS ─────────── -->
    <div v-show="mainTab === 'categorias'" class="cardapio-section">
      <div class="cardapio-header">
        <div>
          <h2 style="font-size:1.2rem;">🏷️ Categorias do Cardápio</h2>
          <p class="cardapio-sub">Crie, edite ou remova as categorias usadas para organizar os produtos e também como subcategorias de adicionais (ex: usar a categoria "Bebidas" inteira como grupo de adicionais).</p>
        </div>
      </div>

      <div class="card" style="padding:1rem;">
        <div class="categoria-list">
          <div v-for="cat in categorias" :key="cat.id" class="categoria-row">
            <div class="categoria-info">
              <span class="cat-order">{{ cat.ordem }}</span>
              <strong>{{ cat.nome }}</strong>
              <code style="font-size:0.75rem;color:var(--text-muted);">{{ cat.slug }}</code>
              <span class="cat-prod-count" v-if="cat.produto_count > 0">{{ cat.produto_count }} produto(s)</span>
            </div>
            <div class="categoria-actions">
              <button class="btn btn-sm btn-secondary" @click="editarCategoria(cat)">
                <i-lucide-pencil style="width:14px;height:14px" />
              </button>
              <button class="btn btn-sm btn-danger" @click="excluirCategoria(cat)">
                <i-lucide-trash-2 style="width:14px;height:14px" />
              </button>
            </div>
          </div>
          <p v-if="categorias.length === 0" style="color:var(--text-muted);font-size:0.85rem;">Nenhuma categoria cadastrada.</p>
        </div>

        <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);">
          <h4 style="font-size:0.9rem;margin-bottom:0.5rem;">
            {{ editandoCategoria ? '✏️ Editar Categoria' : '➕ Nova Categoria' }}
          </h4>
          <div style="display:flex;gap:8px;">
            <input v-model="catForm.nome" placeholder="Nome da categoria" style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:6px;font-size:0.9rem;" @keyup.enter="salvarCategoria" />
            <button class="btn btn-primary btn-sm" @click="salvarCategoria" :disabled="!catForm.nome.trim() || salvandoCat">
              {{ salvandoCat ? '...' : editandoCategoria ? 'Atualizar' : 'Criar' }}
            </button>
            <button v-if="editandoCategoria" class="btn btn-secondary btn-sm" @click="cancelarEditCategoria">Cancelar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ─────────── Aba: SUBCATEGORIAS DE ADICIONAIS ─────────── -->
    <div v-show="mainTab === 'subcategorias'" class="cardapio-section">
      <div class="cardapio-header">
        <div>
          <h2 style="font-size:1.2rem;">📂 Subcategorias de Adicionais</h2>
          <p class="cardapio-sub">Grupos pré-cadastrados que aparecem no modal de cada produto. Cada item pode ter imagem e descrição próprias. Ou use uma categoria do cardápio inteira (ex: Bebidas) — os produtos ativos dela viram os itens, com o preço do próprio produto.</p>
        </div>
        <button class="btn btn-primary" @click="novaCatalogoSub">
          <i-lucide-plus style="width:16px;height:16px" /> Nova Subcategoria
        </button>
      </div>

      <div class="card" style="padding:1rem;">
        <div v-for="sub in subcategoriasCatalogo" :key="sub.id" class="cat-sub">
          <div class="cat-sub-header">
            <div style="display:flex;align-items:center;gap:8px;">
              <strong>{{ sub.nome }}</strong>
              <span v-if="sub.tipo === 'categoria'" class="badge badge-info" title="Usa produtos de uma categoria do cardápio">
                <i-lucide-tags style="width:12px;height:12px" /> {{ sub.categoria_nome || 'Categoria' }}
              </span>
              <span v-else class="badge">Manual</span>
            </div>
            <span style="font-size:0.75rem;color:var(--text-muted);">{{ sub.itens.length }} itens</span>
            <div style="display:flex;gap:4px;">
              <button class="btn btn-sm btn-secondary" @click="editarCatalogoSub(sub)">Editar</button>
              <button class="btn btn-sm btn-danger" @click="excluirCatalogoSub(sub)">Excluir</button>
            </div>
          </div>
          <div class="cat-sub-itens">
            <span v-for="item in sub.itens" :key="item.id" class="cat-item-chip" :title="item.descricao || ''">
              <img v-if="itemImgSrc(item)" :src="itemImgSrc(item)" class="cat-item-img" alt="" />
              {{ item.nome }} — {{ formatPrice(item.preco) }}
            </span>
            <span v-if="sub.itens.length === 0" style="font-size:0.8rem;color:var(--text-muted);">sem itens</span>
          </div>
        </div>
        <p v-if="subcategoriasCatalogo.length === 0" style="color:var(--text-muted);font-size:0.85rem;">
          Nenhuma subcategoria cadastrada.
        </p>
      </div>

      <!-- Form nova/edição -->
      <div v-if="catalogForm.nome !== '' || catalogEditId || novaCatAberta" class="card" style="padding:1rem;margin-top:1rem;">
        <h4 style="font-size:0.9rem;margin-bottom:0.75rem;">
          {{ catalogEditId ? '✏️ Editar subcategoria' : '➕ Nova subcategoria' }}
        </h4>
        <div class="form-row" style="margin-bottom:0.5rem;">
          <div class="form-group" style="flex:1;">
            <label>Nome (ex: Porções)</label>
            <input v-model="catalogForm.nome" placeholder="Nome da subcategoria" />
          </div>
          <div class="form-group" style="flex:1;">
            <label>Tipo</label>
            <select v-model="catalogForm.tipo">
              <option value="manual">Itens manuais</option>
              <option value="categoria">Categoria do cardápio inteira</option>
            </select>
          </div>
        </div>
        <div v-if="catalogForm.tipo === 'categoria'" class="form-group" style="margin-bottom:0.5rem;">
          <label>Categoria do cardápio (os produtos ativos dela viram os itens)</label>
          <select v-model="catalogForm.categoria_id">
            <option value="">Selecione...</option>
            <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
          </select>
        </div>

        <template v-if="catalogForm.tipo === 'manual'">
          <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.5rem;">
            Cada item pode ter <strong>imagem</strong> e <strong>descrição</strong> próprias (opcional).
          </p>
          <div v-for="(item, i) in catalogForm.itens" :key="i" class="cat-item-row" style="flex-wrap:wrap;">
            <input v-model="item.nome" placeholder="Item (ex: Arroz)" class="extra-name" />
            <input v-model.number="item.preco" type="number" step="0.50" min="0" placeholder="0,00" style="width:80px;" />
            <input v-model.number="item.maximo" type="number" min="0" placeholder="Máx" style="width:56px;" title="Máximo por item (1 = checkbox, >1 = quantidade)" />
            <div class="item-edit-actions">
              <label class="btn btn-sm btn-secondary" style="cursor:pointer;margin:0;">
                <i-lucide-image style="width:14px;height:14px" />
                {{ item.imagem_base64 || item.imagem_url ? 'Trocar img' : 'Imagem' }}
                <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" @change="onItemImageSelected($event, item)" />
              </label>
              <input v-model="item.descricao" placeholder="Descrição (opcional)" style="flex:1;min-width:140px;" />
              <button class="btn btn-sm btn-danger" @click="catalogForm.itens.splice(i, 1)">
                <i-lucide-x style="width:14px;height:14px" />
              </button>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="catalogForm.itens.push({ nome: '', preco: 0, maximo: 1, descricao: '', imagem_url: '', imagem_base64: '' })">
            <i-lucide-plus style="width:14px;height:14px" /> Item
          </button>
        </template>
        <p v-else style="font-size:0.8rem;color:var(--text-muted);">
          Os itens são os produtos <strong>ativos</strong> da categoria selecionada, com o preço de cada produto. Sempre sincronizado com o cardápio.
        </p>

        <div style="display:flex;gap:8px;margin-top:1rem;">
          <button class="btn btn-primary btn-sm" @click="salvarCatalogoSub" :disabled="!catalogForm.nome.trim() || (catalogForm.tipo === 'categoria' && !catalogForm.categoria_id)">
            {{ catalogEditId ? 'Atualizar' : 'Criar' }}
          </button>
          <button v-if="catalogEditId || novaCatAberta" class="btn btn-secondary btn-sm" @click="cancelarCatalogoEdit">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- ─────────── Aba: OPÇÕES PADRÃO DO PRATO ─────────── -->
    <div v-show="mainTab === 'opcoesPadrao'" class="cardapio-section">
      <div class="cardapio-header">
        <div>
          <h2 style="font-size:1.2rem;">✅ Opções Padrão do Prato</h2>
          <p class="cardapio-sub">Grupos de opções gratuitas reutilizáveis (ex: "Ponto da carne"). Cadastre uma vez e vincule a vários produtos — <strong>vínculo ao vivo</strong>: editar o grupo aqui atualiza todos os produtos que o usam.</p>
        </div>
        <button class="btn btn-primary" @click="novaOpcaoPadrao">
          <i-lucide-plus style="width:16px;height:16px" /> Novo Grupo Padrão
        </button>
      </div>

      <div class="card" style="padding:1rem;">
        <div v-for="grupo in opcoesPadraoCatalogo" :key="grupo.id" class="cat-sub">
          <div class="cat-sub-header">
            <div style="display:flex;align-items:center;gap:8px;">
              <strong>{{ grupo.grupo }}</strong>
              <span class="badge" :class="grupo.obrigatoria ? 'badge-danger' : 'badge-info'">{{ grupo.obrigatoria ? 'Obrigatória' : 'Opcional' }}</span>
              <span class="badge">{{ grupo.tipo === 'unica' ? 'Seleção única' : 'Seleção múltipla' }}</span>
            </div>
            <div style="display:flex;gap:4px;">
              <button class="btn btn-sm btn-secondary" @click="editarOpcaoPadrao(grupo)">Editar</button>
              <button class="btn btn-sm btn-danger" @click="excluirOpcaoPadrao(grupo)">Excluir</button>
            </div>
          </div>
          <div class="cat-sub-itens">
            <span v-for="op in grupo.opcoes" :key="op.id" class="cat-item-chip">{{ op.nome }}</span>
            <span v-if="grupo.opcoes.length === 0" style="font-size:0.8rem;color:var(--text-muted);">sem opções</span>
          </div>
        </div>
        <p v-if="opcoesPadraoCatalogo.length === 0" style="color:var(--text-muted);font-size:0.85rem;">
          Nenhum grupo padrão cadastrado.
        </p>
      </div>

      <!-- Form nova/edição -->
      <div v-if="opPadraoFormAberto" class="card" style="padding:1rem;margin-top:1rem;">
        <h4 style="font-size:0.9rem;margin-bottom:0.75rem;">
          {{ opPadraoEditId ? '✏️ Editar grupo padrão' : '➕ Novo grupo padrão' }}
        </h4>
        <div class="form-row" style="margin-bottom:0.5rem;">
          <div class="form-group" style="flex:1.5;">
            <label>Nome do grupo (ex: Ponto da carne)</label>
            <input v-model="opPadraoForm.grupo" placeholder="Ex: Ponto da carne" />
          </div>
          <div class="form-group" style="flex:1;">
            <label>Tipo de seleção</label>
            <select v-model="opPadraoForm.tipo">
              <option value="unica">Seleção única (radio)</option>
              <option value="multipla">Seleção múltipla (checkbox)</option>
            </select>
          </div>
          <div class="form-group" style="flex:1;">
            <label>Obrigatória</label>
            <label class="toggle" style="margin-top:8px;">
              <input type="checkbox" v-model="opPadraoForm.obrigatoria" />
              <span class="slider"></span>
            </label>
          </div>
        </div>
        <div v-for="(op, oi) in opPadraoForm.opcoes" :key="oi" class="cat-item-row">
          <input :value="op" @input="opPadraoForm.opcoes[oi] = $event.target.value" placeholder="Opção (ex: Ao ponto)" class="extra-name" />
          <button class="btn btn-sm btn-danger" @click="opPadraoForm.opcoes.splice(oi, 1)">
            <i-lucide-x style="width:14px;height:14px" />
          </button>
        </div>
        <button class="btn btn-secondary btn-sm" @click="opPadraoForm.opcoes.push('')">
          <i-lucide-plus style="width:14px;height:14px" /> Opção
        </button>
        <div style="display:flex;gap:8px;margin-top:1rem;">
          <button class="btn btn-primary btn-sm" @click="salvarOpcaoPadrao" :disabled="!opPadraoForm.grupo.trim() || !opPadraoForm.opcoes.some(o => o.trim())">
            {{ opPadraoEditId ? 'Atualizar' : 'Criar' }}
          </button>
          <button class="btn btn-secondary btn-sm" @click="fecharOpcaoPadrao">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- Product Form Modal -->
    <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
      <div class="modal-content modal-produto">
        <h3>{{ editingId ? '✏️ Editar' : '➕ Novo' }} Produto</h3>

        <!-- Tabs -->
        <div class="form-tabs">
          <button class="form-tab" :class="{ active: formTab === 'dados' }" @click="formTab = 'dados'">
            <i-lucide-info style="width:16px;height:16px" /> Dados
          </button>
          <button class="form-tab" :class="{ active: formTab === 'imagem' }" @click="formTab = 'imagem'">
            <i-lucide-image style="width:16px;height:16px" /> Imagem
          </button>
          <button class="form-tab" :class="{ active: formTab === 'extras' }" @click="formTab = 'extras'">
            <i-lucide-circle-plus style="width:16px;height:16px" /> Adicionais
          </button>
          <button class="form-tab" :class="{ active: formTab === 'opcoes' }" @click="formTab = 'opcoes'">
            <i-lucide-list-checks style="width:16px;height:16px" /> Opções
          </button>
          <button class="form-tab" :class="{ active: formTab === 'disponibilidade' }" @click="formTab = 'disponibilidade'">
            <i-lucide-calendar-clock style="width:16px;height:16px" /> Disponibilidade
          </button>
        </div>

        <!-- Tab: Dados Básicos -->
        <div v-show="formTab === 'dados'">
          <div class="form-row">
            <div class="form-group" style="flex:2;">
              <label>Nome do Produto</label>
              <input v-model="form.nome" placeholder="Ex: Burguer Clássico" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Categoria</label>
              <select v-model="form.categoria_id">
                <option value="">Selecione...</option>
                <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Preço (R$)</label>
              <input v-model.number="form.preco" type="number" step="0.01" min="0" placeholder="0,00" />
            </div>
            <div class="form-group">
              <label>Status</label>
              <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
                <label class="toggle">
                  <input type="checkbox" v-model="form.ativo" />
                  <span class="slider"></span>
                </label>
                <span style="font-size:0.9rem;font-weight:600;color:var(--success);" v-if="form.ativo">Ativo</span>
                <span style="font-size:0.9rem;font-weight:600;color:var(--error);" v-else>Inativo</span>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label>Descrição</label>
            <textarea v-model="form.descricao" rows="3" placeholder="Descreva o produto, ingredientes, modo de preparo..."></textarea>
          </div>
        </div>

        <!-- Tab: Imagem -->
        <div v-show="formTab === 'imagem'">
          <div class="image-upload-area">
            <div class="image-preview" v-if="previewImage">
              <img :src="previewImage" alt="Preview" />
              <button class="btn btn-sm btn-danger image-remove-btn" @click="removerImagem">
                <i-lucide-trash-2 style="width:14px;height:14px" /> Remover
              </button>
            </div>
            <div class="image-preview empty" v-else>
              <i-lucide-cloud-upload style="width:14px;height:14px" />
              <p>Clique para selecionar uma imagem</p>
            </div>
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="onImageSelected" ref="fileInput" style="display:none" />
            <button class="btn btn-secondary btn-block" @click="$refs.fileInput.click()">
              <i-lucide-folder-open style="width:14px;height:14px" /> Selecionar Imagem
            </button>
            <p class="image-hint">Formatos: PNG, JPG, WebP. Tamanho máximo: 2MB</p>
            <div class="form-group" style="margin-top:0.5rem;">
              <label>Ou cole uma URL externa</label>
              <input v-model="form.imagem_url" placeholder="https://..." @input="onUrlChange" />
            </div>
          </div>
        </div>

        <!-- Tab: Adicionais -->
        <div v-show="formTab === 'extras'">
          <div class="extras-header">
            <p style="color:var(--text-muted);font-size:0.85rem;">
              Marque as <strong>subcategorias do catálogo</strong> que aparecem para este produto.
              Os itens e preços vêm do catálogo compartilhado (mesmo preço em todos os produtos).
            </p>
          </div>
          <div v-if="subcategoriasCatalogo.length > 0" class="subcats-grid">
            <label
              v-for="sub in subcategoriasCatalogo"
              :key="sub.id"
              class="subcat-check"
              :class="{ ativa: form.subcategorias.includes(sub.id) }"
            >
              <input type="checkbox" :value="sub.id" v-model="form.subcategorias" />
              <span>
                <strong>{{ sub.nome }}</strong>
                <small>{{ sub.itens.length }} itens</small>
              </span>
            </label>
          </div>
          <p v-else style="color:var(--text-muted);font-size:0.85rem;">
            Nenhuma subcategoria cadastrada ainda — clique em "Gerenciar catálogo" para pré-cadastrar.
          </p>
          <button class="btn btn-secondary btn-sm" style="margin-top:0.5rem;" @click="gerenciarCatalogoDoForm">
            <i-lucide-list-checks style="width:14px;height:14px" /> Gerenciar catálogo de adicionais
          </button>

          <div class="extras-legado">
            <div class="extras-legado-titulo">Adicionais avulsos deste produto (legado — aparecem no grupo "Geral")</div>
            <div class="extras-header">
              <p style="color:var(--text-muted);font-size:0.85rem;">
                Configure os adicionais que o cliente pode escolher.
                O <strong>Máximo</strong> define quantas vezes o cliente pode pedir o mesmo adicional (ex: 2 carnes, 1 cebola).
              </p>
            </div>
            <div v-for="(extra, i) in form.extras" :key="i" class="extra-row">
            <div class="extra-fields">
              <input v-model="extra.nome" placeholder="Nome do adicional" class="extra-name" />
              <div class="extra-number-group">
                <span class="extra-currency">R$</span>
                <input v-model.number="extra.preco" type="number" step="0.50" min="0" placeholder="0,00" class="extra-price-input" />
              </div>
              <div class="extra-max-group">
                <label class="extra-max-label">Máx:</label>
                <input v-model.number="extra.maximo" type="number" min="0" max="99" placeholder="1" class="extra-max-input" />
              </div>
              <button class="btn btn-sm btn-danger" @click="form.extras.splice(i, 1)" title="Remover adicional">
                <i-lucide-x style="width:14px;height:14px" />
              </button>
            </div>
          </div>
            <button class="btn btn-secondary btn-block" @click="addExtra" style="margin-top:0.5rem;">
              <i-lucide-plus style="width:14px;height:14px" /> Adicionar Opcional
            </button>
          </div>
        </div>

        <!-- Tab: Opções do Prato (gratuitas) -->
        <div v-show="formTab === 'opcoes'">
          <div v-if="opcoesPadraoCatalogo.length > 0" class="card-inline" style="flex-direction:column;align-items:flex-start;gap:0.5rem;margin-bottom:1rem;">
            <div>
              <strong style="font-size:0.9rem;">📋 Grupos padrão do catálogo (vínculo ao vivo)</strong>
              <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">
                Marque os grupos padrão pré-cadastrados que este produto usa. Editar o grupo na aba "Opções Padrão" atualiza todos os produtos vinculados.
              </p>
            </div>
            <div class="subcats-grid">
              <label
                v-for="g in opcoesPadraoCatalogo"
                :key="g.id"
                class="subcat-check"
                :class="{ ativa: form.opcoes_padrao.includes(g.id) }"
              >
                <input type="checkbox" :value="g.id" v-model="form.opcoes_padrao" />
                <span>
                  <strong>{{ g.grupo }}</strong>
                  <small>{{ g.obrigatoria ? 'Obrigatória' : 'Opcional' }} · {{ g.opcoes.length }} opções</small>
                </span>
              </label>
            </div>
            <button class="btn btn-secondary btn-sm" @click="gerenciarOpcoesPadraoDoForm">
              <i-lucide-list-checks style="width:14px;height:14px" /> Gerenciar grupos padrão
            </button>
          </div>

          <div class="extras-header">
            <p style="color:var(--text-muted);font-size:0.85rem;">
              Ou crie opções <strong>avulsas deste produto</strong> (gratuitas, ex: ponto da carne, com/sem açúcar).
              Não alteram o preço. <strong>Seleção única</strong> = radio; <strong>Seleção múltipla</strong> = checkbox.
              Marque <strong>Obrigatória</strong> para exigir a escolha antes de adicionar ao carrinho.
            </p>
          </div>
          <div v-for="(g, gi) in form.opcoes" :key="gi" class="extra-row">
            <div class="extra-fields" style="flex-wrap:wrap;">
              <input v-model="g.grupo" placeholder="Nome do grupo (ex: Ponto da carne)" class="extra-name" />
              <select v-model="g.tipo" style="padding:6px 8px;border:1.5px solid var(--border);border-radius:4px;font-size:0.85rem;">
                <option value="unica">Seleção única</option>
                <option value="multipla">Seleção múltipla</option>
              </select>
              <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;font-weight:600;white-space:nowrap;cursor:pointer;">
                <input type="checkbox" v-model="g.obrigatoria" style="width:16px;height:16px;accent-color:var(--primary);" /> Obrigatória
              </label>
              <button class="btn btn-sm btn-danger" @click="form.opcoes.splice(gi, 1)" title="Remover grupo">
                <i-lucide-x style="width:14px;height:14px" />
              </button>
            </div>
            <div v-for="(opNome, oi) in g.opcoes" :key="oi" class="extra-fields" style="margin-top:6px;margin-left:1.75rem;">
              <input v-model="g.opcoes[oi]" placeholder="Ex: Ao ponto" class="extra-name" />
              <button class="btn btn-sm btn-danger" @click="g.opcoes.splice(oi, 1)" title="Remover opção">
                <i-lucide-x style="width:14px;height:14px" />
              </button>
            </div>
            <button class="btn btn-secondary btn-sm" style="margin-top:6px;margin-left:1.75rem;" @click="g.opcoes.push('')">
              <i-lucide-plus style="width:14px;height:14px" /> Opção
            </button>
          </div>
          <button class="btn btn-secondary btn-block" @click="addOpcaoGrupo" style="margin-top:0.5rem;">
            <i-lucide-plus style="width:14px;height:14px" /> Grupo de Opções
          </button>
        </div>

        <!-- Tab: Disponibilidade (talheres, modulos, dias e horarios) -->
        <div v-show="formTab === 'disponibilidade'">
          <div class="card-inline">
            <div style="flex:1;">
              <strong style="font-size:0.9rem;">🍴 Talheres obrigatório</strong>
              <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">
                Quando ativo, o cliente é obrigado a escolher entre "Sim" ou "Não" querer talheres antes de adicionar ao carrinho.
              </p>
            </div>
            <label class="toggle">
              <input type="checkbox" v-model="form.talheres_obrigatorio" />
              <span class="slider"></span>
            </label>
          </div>

          <div class="card-inline" style="flex-direction:column;align-items:flex-start;gap:0.5rem;">
            <div>
              <strong style="font-size:0.9rem;">🏪 Módulos onde o prato é vendido</strong>
              <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">
                Escolha em quais módulos o prato aparece. Ex: "Salão + Delivery", somente "Salão" ou somente "Delivery".
              </p>
            </div>
            <div class="modulos-chips">
              <label class="modulo-chip" :class="{ ativa: form.modulos.includes('salao') }">
                <input type="checkbox" value="salao" v-model="form.modulos" />
                <i-lucide-table-2 style="width:14px;height:14px" /> Salão
              </label>
              <label class="modulo-chip" :class="{ ativa: form.modulos.includes('delivery') }">
                <input type="checkbox" value="delivery" v-model="form.modulos" />
                <i-lucide-bike style="width:14px;height:14px" /> Delivery
              </label>
            </div>
          </div>

          <div class="card-inline" style="flex-direction:column;align-items:flex-start;gap:0.75rem;">
            <div>
              <strong style="font-size:0.9rem;">🕒 Dias e horários disponíveis</strong>
              <p style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">
                Fora do range selecionado, o prato fica automaticamente pausado no cardápio. Deixe todos os dias marcados e os horários vazios para ficar sempre disponível.
              </p>
            </div>
            <div class="dias-grid">
              <label v-for="(nome, idx) in diasSemana" :key="idx" class="dia-chip" :class="{ ativa: form.dias_semana.includes(idx) }">
                <input type="checkbox" :value="idx" v-model="form.dias_semana" />
                {{ nome }}
              </label>
            </div>
            <div class="form-row" style="max-width:420px;">
              <div class="form-group">
                <label>Disponível a partir de</label>
                <input v-model="form.horario_inicio" type="time" />
              </div>
              <div class="form-group">
                <label>Até</label>
                <input v-model="form.horario_fim" type="time" />
              </div>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border);">
          <button class="btn btn-primary" style="flex:1;" @click="salvar" :disabled="salvando">
            <i-lucide-loader v-if="salvando" class="spinning" style="width:16px;height:16px" />
            <i-lucide-save v-else style="width:16px;height:16px" />
            {{ salvando ? 'Salvando...' : 'Salvar' }}
          </button>
          <button class="btn btn-secondary" @click="showForm = false">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- Catalog Modal (subcategorias de adicionais) -->
    <div v-if="showCatalogoModal" class="modal-overlay" @click.self="showCatalogoModal = false">
      <div class="modal-content" style="max-width:640px;">
        <h3>📂 Catálogo de Adicionais</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin:0.5rem 0 1rem;">
          Subcategorias pré-cadastradas com seus itens e preços. Depois, em cada produto, basta marcar quais aparecem.
        </p>

        <div v-for="sub in subcategoriasCatalogo" :key="sub.id" class="cat-sub">
          <div class="cat-sub-header">
            <strong>{{ sub.nome }}</strong>
            <span style="font-size:0.75rem;color:var(--text-muted);">{{ sub.itens.length }} itens</span>
            <div style="display:flex;gap:4px;">
              <button class="btn btn-sm btn-secondary" @click="editarCatalogoSub(sub)">Editar</button>
              <button class="btn btn-sm btn-danger" @click="excluirCatalogoSub(sub)">Excluir</button>
            </div>
          </div>
          <div class="cat-sub-itens">
            <span v-for="item in sub.itens" :key="item.id" class="cat-item-chip">
              {{ item.nome }} — {{ formatPrice(item.preco) }}
            </span>
            <span v-if="sub.itens.length === 0" style="font-size:0.8rem;color:var(--text-muted);">sem itens</span>
          </div>
        </div>
        <p v-if="subcategoriasCatalogo.length === 0" style="color:var(--text-muted);font-size:0.85rem;">
          Nenhuma subcategoria cadastrada.
        </p>

        <!-- Form nova/edição -->
        <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);">
          <h4 style="font-size:0.9rem;margin-bottom:0.5rem;">
            {{ catalogEditId ? '✏️ Editar subcategoria' : '➕ Nova subcategoria' }}
          </h4>
          <input
            v-model="catalogForm.nome"
            placeholder="Nome (ex: Porções)"
            style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:6px;font-size:0.9rem;margin-bottom:0.5rem;"
          />
          <div v-for="(item, i) in catalogForm.itens" :key="i" class="cat-item-row">
            <input v-model="item.nome" placeholder="Item (ex: Arroz)" class="extra-name" />
            <input v-model.number="item.preco" type="number" step="0.50" min="0" placeholder="0,00" style="width:80px;" />
            <input v-model.number="item.maximo" type="number" min="0" placeholder="Máx" style="width:56px;" title="Máximo por item (1 = checkbox, >1 = quantidade)" />
            <button class="btn btn-sm btn-danger" @click="catalogForm.itens.splice(i, 1)">
              <i-lucide-x style="width:14px;height:14px" />
            </button>
          </div>
          <button class="btn btn-secondary btn-sm" @click="catalogForm.itens.push({ nome: '', preco: 0, maximo: 1 })">
            <i-lucide-plus style="width:14px;height:14px" /> Item
          </button>
          <div style="display:flex;gap:8px;margin-top:1rem;">
            <button class="btn btn-primary btn-sm" @click="salvarCatalogoSub" :disabled="!catalogForm.nome.trim()">
              {{ catalogEditId ? 'Atualizar' : 'Criar' }}
            </button>
            <button v-if="catalogEditId" class="btn btn-secondary btn-sm" @click="cancelarCatalogoEdit">Cancelar edição</button>
          </div>
        </div>

        <div style="margin-top:1rem;text-align:right;">
          <button class="btn btn-secondary" @click="showCatalogoModal = false">Fechar</button>
        </div>
      </div>
    </div>

    <!-- Categories Modal -->
    <div v-if="showCategoriasModal" class="modal-overlay" @click.self="showCategoriasModal = false">
      <div class="modal-content" style="max-width:500px;">
        <h3>🏷️ Gerenciar Categorias</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin:0.5rem 0 1rem;">
          Crie, edite ou remova categorias para organizar seus produtos.
        </p>

        <div class="categoria-list">
          <div v-for="cat in categorias" :key="cat.id" class="categoria-row">
            <div class="categoria-info">
              <span class="cat-order">{{ cat.ordem }}</span>
              <strong>{{ cat.nome }}</strong>
              <code style="font-size:0.75rem;color:var(--text-muted);">{{ cat.slug }}</code>
            </div>
            <div class="categoria-actions">
              <button class="btn btn-sm btn-secondary" @click="editarCategoria(cat)">
                <i-lucide-pencil style="width:14px;height:14px" />
              </button>
              <button class="btn btn-sm btn-danger" @click="excluirCategoria(cat)">
                <i-lucide-trash-2 style="width:14px;height:14px" />
              </button>
            </div>
          </div>
        </div>

        <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);">
          <h4 style="font-size:0.9rem;margin-bottom:0.5rem;">
            {{ editandoCategoria ? '✏️ Editar Categoria' : '➕ Nova Categoria' }}
          </h4>
          <div style="display:flex;gap:8px;">
            <input v-model="catForm.nome" placeholder="Nome da categoria" style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:6px;font-size:0.9rem;" @keyup.enter="salvarCategoria" />
            <button class="btn btn-primary btn-sm" @click="salvarCategoria" :disabled="!catForm.nome.trim() || salvandoCat">
              {{ salvandoCat ? '...' : editandoCategoria ? 'Atualizar' : 'Criar' }}
            </button>
            <button v-if="editandoCategoria" class="btn btn-secondary btn-sm" @click="cancelarEditCategoria">Cancelar</button>
          </div>
        </div>

        <div style="margin-top:1rem;text-align:right;">
          <button class="btn btn-secondary" @click="showCategoriasModal = false">Fechar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import api from '../services/api'
import { PRODUCT_PLACEHOLDER } from '../utils/images'

const produtos = ref([])
const categorias = ref([])
const showForm = ref(false)
const editingId = ref(null)
const salvando = ref(false)
const loading = ref(false)
const erroLoad = ref('')
const searchTerm = ref('')
const filterCategoria = ref('')
const formTab = ref('dados')
const previewImage = ref('')
const fileInput = ref(null)

// Abas do cardápio
const mainTab = ref('produtos')
const novaCatAberta = ref(false)

// Categories (aba)
const editandoCategoria = ref(null)
const salvandoCat = ref(false)
const catForm = reactive({ nome: '' })

const brokenImages = ref(new Set())

function onImageError(prodId) {
  brokenImages.value = new Set([...brokenImages.value, prodId])
}

function getImageSrc(prod) {
  if (prod.imagem_base64) {
    const b64 = prod.imagem_base64
    if (b64.startsWith('/9j/')) return 'data:image/jpeg;base64,' + b64
    if (b64.startsWith('iVBORw0KGgo')) return 'data:image/png;base64,' + b64
    if (b64.startsWith('R0lGOD')) return 'data:image/gif;base64,' + b64
    if (b64.startsWith('UklGR')) return 'data:image/webp;base64,' + b64
    try { const decoded = atob(b64.substring(0, 20)); if (decoded.includes('<svg') || decoded.includes('<?xml')) return 'data:image/svg+xml;base64,' + b64 } catch {}
    return 'data:image/jpeg;base64,' + b64
  }
  if (prod.imagem_url && !brokenImages.value.has(prod.id)) return prod.imagem_url
  // Produto sem imagem (ou imagem quebrada) → placeholder SVG genérico
  return PRODUCT_PLACEHOLDER
}

const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const form = reactive({
  nome: '', categoria_id: '', preco: 0, descricao: '',
  imagem_url: '', imagem_base64: '', ativo: true, extras: [], opcoes: [], opcoes_padrao: [], subcategorias: [],
  talheres_obrigatorio: false,
  modulos: ['salao', 'delivery'],
  dias_semana: [0, 1, 2, 3, 4, 5, 6],
  horario_inicio: '',
  horario_fim: '',
})

// Catálogo compartilhado de subcategorias de adicionais
const subcategoriasCatalogo = ref([])
const catalogEditId = ref(null)
const catalogForm = reactive({ nome: '', tipo: 'manual', categoria_id: '', itens: [] })

// Catálogo de Opções Padrão do Prato (vínculo ao vivo)
const opcoesPadraoCatalogo = ref([])
const opPadraoEditId = ref(null)
const opPadraoFormAberto = ref(false)
const opPadraoForm = reactive({ grupo: '', tipo: 'unica', obrigatoria: false, opcoes: [''] })

function formatPrice(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) }

const filteredProdutos = computed(() => {
  let result = produtos.value
  if (searchTerm.value) {
    const q = searchTerm.value.toLowerCase()
    result = result.filter(p => p.nome.toLowerCase().includes(q) || p.descricao?.toLowerCase().includes(q))
  }
  if (filterCategoria.value) {
    result = result.filter(p => p.categoria_id === parseInt(filterCategoria.value))
  }
  return result
})

async function load() {
  erroLoad.value = ''
  loading.value = true
  try {
    const [p, c] = await Promise.all([
      api.get('/produtos'), api.get('/produtos/categorias')
    ])
    const produtosData = p.data
    categorias.value = c.data
    if (!produtosData.length) { produtos.value = []; return }

    const extrasPromises = produtosData.map(prod =>
      api.get(`/produtos/${prod.id}`)
        .then(({ data }) => { prod.extras_count = data.extras?.length || 0 })
        .catch(() => { prod.extras_count = 0 })
    )
    await Promise.allSettled(extrasPromises)
    produtos.value = produtosData
  } catch (err) {
    erroLoad.value = 'Erro ao carregar produtos. Verifique se o servidor está rodando.'
    console.error('Erro ao carregar produtos:', err)
    produtos.value = []
  } finally { loading.value = false }
}

function resetForm() {
  editingId.value = null
  formTab.value = 'dados'
  previewImage.value = ''
  Object.assign(form, { nome: '', categoria_id: '', preco: 0, descricao: '', imagem_url: '', imagem_base64: '', ativo: true, extras: [], opcoes: [], opcoes_padrao: [], subcategorias: [], talheres_obrigatorio: false, modulos: ['salao', 'delivery'], dias_semana: [0, 1, 2, 3, 4, 5, 6], horario_inicio: '', horario_fim: '' })
}

function novoProduto() { resetForm(); showForm.value = true }
function addExtra() { form.extras.push({ nome: '', preco: 0, maximo: 1 }) }
function addOpcaoGrupo() { form.opcoes.push({ grupo: '', tipo: 'unica', obrigatoria: false, opcoes: [''] }) }

// ── Navegação entre abas ──
function switchToCategorias() { mainTab.value = 'categorias'; carregarCategorias() }
function switchToSubcategorias() { mainTab.value = 'subcategorias'; carregarCatalogo() }
function switchToOpcoesPadrao() { mainTab.value = 'opcoesPadrao'; carregarOpcoesPadrao() }

async function carregarCategorias() {
  try {
    const { data } = await api.get('/produtos/categorias')
    categorias.value = data
  } catch { /* ignore */ }
}

// ── Catálogo de subcategorias de adicionais ──
async function carregarCatalogo() {
  try {
    const { data } = await api.get('/produtos/extra-subcategorias')
    subcategoriasCatalogo.value = data
  } catch { subcategoriasCatalogo.value = [] }
}

function novaCatalogoSub() {
  cancelarCatalogoEdit()
  novaCatAberta.value = true
}

function editarCatalogoSub(sub) {
  novaCatAberta.value = true
  catalogEditId.value = sub.id
  catalogForm.nome = sub.nome
  catalogForm.tipo = sub.tipo || 'manual'
  catalogForm.categoria_id = sub.categoria_id ? String(sub.categoria_id) : ''
  catalogForm.itens = (sub.itens || []).map(i => ({
    nome: i.nome, preco: Number(i.preco), maximo: i.maximo ?? 1,
    descricao: i.descricao || '', imagem_url: i.imagem_url || '', imagem_base64: i.imagem_base64 || '',
  }))
}

function cancelarCatalogoEdit() {
  catalogEditId.value = null
  novaCatAberta.value = false
  catalogForm.nome = ''
  catalogForm.tipo = 'manual'
  catalogForm.categoria_id = ''
  catalogForm.itens = []
}

// Imagem de item do catálogo (base64 — sem upload de arquivo)
function onItemImageSelected(event, item) {
  const file = event.target.files[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) { alert('Imagem muito grande! Máximo 2MB.'); return }
  const reader = new FileReader()
  reader.onload = (e) => {
    item.imagem_base64 = e.target.result.split(',')[1]
    item.imagem_url = ''
  }
  reader.readAsDataURL(file)
  event.target.value = ''
}

function itemImgSrc(item) {
  if (item?.imagem_base64) {
    const b64 = item.imagem_base64
    if (b64.startsWith('/9j/')) return 'data:image/jpeg;base64,' + b64
    if (b64.startsWith('iVBORw0KGgo')) return 'data:image/png;base64,' + b64
    if (b64.startsWith('R0lGOD')) return 'data:image/gif;base64,' + b64
    if (b64.startsWith('UklGR')) return 'data:image/webp;base64,' + b64
    try { const d = atob(b64.substring(0, 20)); if (d.startsWith('<svg')) return 'data:image/svg+xml;base64,' + b64 } catch {}
    return 'data:image/jpeg;base64,' + b64
  }
  return item?.imagem_url || ''
}

async function salvarCatalogoSub() {
  const nome = catalogForm.nome.trim()
  if (!nome) return
  const tipo = catalogForm.tipo || 'manual'
  const categoria_id = tipo === 'categoria' ? (catalogForm.categoria_id ? Number(catalogForm.categoria_id) : null) : null
  const itens = catalogForm.itens
    .filter(i => i.nome.trim())
    .map(i => ({
      nome: i.nome.trim(), preco: i.preco || 0, maximo: i.maximo ?? 1,
      descricao: i.descricao || '', imagem_url: i.imagem_url || '', imagem_base64: i.imagem_base64 || '',
    }))
  try {
    if (catalogEditId.value) await api.put(`/produtos/extra-subcategorias/${catalogEditId.value}`, { nome, tipo, categoria_id, itens })
    else await api.post('/produtos/extra-subcategorias', { nome, tipo, categoria_id, itens })
    cancelarCatalogoEdit()
    await carregarCatalogo()
    await load()
  } catch (err) { alert(err.response?.data?.error || 'Erro ao salvar subcategoria.') }
}

async function excluirCatalogoSub(sub) {
  if (!confirm(`Excluir a subcategoria "${sub.nome}"? Produtos que a usam deixarão de exibi-la.`)) return
  try {
    await api.delete(`/produtos/extra-subcategorias/${sub.id}`)
    form.subcategorias = form.subcategorias.filter(id => id !== sub.id)
    await carregarCatalogo()
  } catch (err) { alert(err.response?.data?.error || 'Erro ao excluir subcategoria.') }
}

// ── Opções Padrão do Prato (catálogo compartilhado) ──
async function carregarOpcoesPadrao() {
  try {
    const { data } = await api.get('/produtos/opcoes-padrao')
    opcoesPadraoCatalogo.value = data
  } catch { opcoesPadraoCatalogo.value = [] }
}

function novaOpcaoPadrao() {
  opPadraoEditId.value = null
  opPadraoForm.grupo = ''
  opPadraoForm.tipo = 'unica'
  opPadraoForm.obrigatoria = false
  opPadraoForm.opcoes = ['']
  opPadraoFormAberto.value = true
}

function editarOpcaoPadrao(grupo) {
  opPadraoEditId.value = grupo.id
  opPadraoForm.grupo = grupo.grupo
  opPadraoForm.tipo = grupo.tipo || 'unica'
  opPadraoForm.obrigatoria = !!grupo.obrigatoria
  opPadraoForm.opcoes = grupo.opcoes.map(o => o.nome)
  opPadraoFormAberto.value = true
}

function fecharOpcaoPadrao() {
  opPadraoFormAberto.value = false
  opPadraoEditId.value = null
}

async function salvarOpcaoPadrao() {
  const grupo = opPadraoForm.grupo.trim()
  if (!grupo) return
  const payload = {
    grupo,
    tipo: opPadraoForm.tipo,
    obrigatoria: !!opPadraoForm.obrigatoria,
    opcoes: opPadraoForm.opcoes.map(o => o.trim()).filter(Boolean),
  }
  try {
    if (opPadraoEditId.value) await api.put(`/produtos/opcoes-padrao/${opPadraoEditId.value}`, payload)
    else await api.post('/produtos/opcoes-padrao', payload)
    fecharOpcaoPadrao()
    await carregarOpcoesPadrao()
  } catch (err) { alert(err.response?.data?.error || 'Erro ao salvar grupo padrão.') }
}

async function excluirOpcaoPadrao(grupo) {
  if (!confirm(`Excluir o grupo padrão "${grupo.grupo}"? Produtos vinculados deixarão de exibir estas opções.`)) return
  try {
    await api.delete(`/produtos/opcoes-padrao/${grupo.id}`)
    await carregarOpcoesPadrao()
  } catch (err) { alert(err.response?.data?.error || 'Erro ao excluir grupo padrão.') }
}

async function editar(p) {
  resetForm()
  editingId.value = p.id
  form.nome = p.nome; form.categoria_id = p.categoria_id || ''; form.preco = parseFloat(p.preco)
  form.descricao = p.descricao || ''; form.imagem_url = p.imagem_url || ''; form.imagem_base64 = p.imagem_base64 || ''; form.ativo = p.ativo
  if (p.imagem_base64) previewImage.value = 'data:image/png;base64,' + p.imagem_base64
  else if (p.imagem_url) previewImage.value = p.imagem_url
  try {
    const { data } = await api.get(`/produtos/${p.id}`)
    form.extras = (data.extras || []).map(e => ({ nome: e.nome, preco: e.preco, maximo: e.maximo ?? 1 }))
    form.opcoes = (data.opcoes || []).map(g => ({
      grupo: g.grupo,
      tipo: g.tipo,
      obrigatoria: !!g.obrigatoria,
      opcoes: g.opcoes.map(o => o.nome),
    }))
    // Grupos padrão vinculados (separar dos avulsos para não duplicar na edição)
    const padraoIds = new Set(data.opcoes_padrao || [])
    form.opcoes_padrao = [...padraoIds]
    form.opcoes = form.opcoes.filter(g => !padraoIds.has(g.id))
    form.subcategorias = (data.subcategorias || []).map(s => s.id)
    form.talheres_obrigatorio = !!data.talheres_obrigatorio
    form.modulos = Array.isArray(data.modulos) && data.modulos.length ? data.modulos : ['salao', 'delivery']
    form.dias_semana = Array.isArray(data.dias_semana) && data.dias_semana.length ? data.dias_semana : [0, 1, 2, 3, 4, 5, 6]
    form.horario_inicio = data.horario_inicio ? String(data.horario_inicio).substring(0, 5) : ''
    form.horario_fim = data.horario_fim ? String(data.horario_fim).substring(0, 5) : ''
  } catch { form.extras = [] }
  showForm.value = true
}

function onImageSelected(event) {
  const file = event.target.files[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) { alert('Imagem muito grande! Máximo 2MB.'); return }
  const reader = new FileReader()
  reader.onload = (e) => { form.imagem_base64 = e.target.result.split(',')[1]; previewImage.value = e.target.result; form.imagem_url = '' }
  reader.readAsDataURL(file)
}

function onUrlChange() { if (form.imagem_url) { previewImage.value = form.imagem_url; form.imagem_base64 = '' } }
function removerImagem() { previewImage.value = ''; form.imagem_base64 = ''; form.imagem_url = '' }

async function salvar() {
  salvando.value = true
  try {
    const payload = {
      nome: form.nome, categoria_id: form.categoria_id || undefined, preco: form.preco,
      descricao: form.descricao, imagem_url: form.imagem_url, imagem_base64: form.imagem_base64,
      ativo: form.ativo, extras: form.extras.filter(e => e.nome.trim()),
      opcoes: form.opcoes
        .filter(g => g.grupo.trim() && g.opcoes.some(o => o.trim()))
        .map(g => ({
          grupo: g.grupo.trim(),
          tipo: g.tipo,
          obrigatoria: !!g.obrigatoria,
          opcoes: g.opcoes.map(o => o.trim()).filter(Boolean),
        })),
      opcoes_padrao: form.opcoes_padrao,
      subcategorias: form.subcategorias,
      talheres_obrigatorio: form.talheres_obrigatorio,
      modulos: form.modulos.length ? form.modulos : ['salao', 'delivery'],
      dias_semana: form.dias_semana.length ? form.dias_semana : null,
      horario_inicio: form.horario_inicio || null,
      horario_fim: form.horario_fim || null,
    }
    if (editingId.value) await api.put(`/produtos/${editingId.value}`, payload)
    else await api.post('/produtos', payload)
    showForm.value = false; await load()
  } catch (err) { alert(err.response?.data?.error || 'Erro ao salvar produto') }
  finally { salvando.value = false }
}

async function toggleAtivo(p) {
  try { await api.put(`/produtos/${p.id}`, { ativo: !p.ativo }); p.ativo = !p.ativo }
  catch { alert('Erro ao alterar status') }
}

async function excluir(p) {
  if (!confirm(`Excluir "${p.nome}" permanentemente?`)) return
  await api.delete(`/produtos/${p.id}`)
  await load()
}

// ── Category CRUD ──
function editarCategoria(cat) {
  editandoCategoria.value = cat
  catForm.nome = cat.nome
}

function cancelarEditCategoria() {
  editandoCategoria.value = null
  catForm.nome = ''
}

async function salvarCategoria() {
  const nome = catForm.nome.trim()
  if (!nome) return
  salvandoCat.value = true
  try {
    if (editandoCategoria.value) {
      await api.put(`/produtos/categorias/${editandoCategoria.value.id}`, { nome })
    } else {
      await api.post('/produtos/categorias', { nome })
    }
    catForm.nome = ''
    editandoCategoria.value = null
    const { data } = await api.get('/produtos/categorias')
    categorias.value = data
  } catch (err) {
    alert(err.response?.data?.error || 'Erro ao salvar categoria')
  } finally { salvandoCat.value = false }
}

async function excluirCategoria(cat) {
  if (!confirm(`Excluir categoria "${cat.nome}"?`)) return
  try {
    await api.delete(`/produtos/categorias/${cat.id}`)
    const { data } = await api.get('/produtos/categorias')
    categorias.value = data
  } catch (err) {
    alert(err.response?.data?.error || 'Erro ao excluir categoria')
  }
}

onMounted(() => { load(); carregarCatalogo() })
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200;
  display: flex; align-items: center; justify-content: center; padding: 1rem;
}
.modal-content {
  background: white; border-radius: 16px; padding: 1.5rem;
  width: 100%; max-height: 85vh; overflow-y: auto;
}
.modal-produto { max-width: 680px; }

.form-tabs {
  display: flex; gap: 4px; margin: 1rem 0;
  border-bottom: 2px solid var(--border);
}
.form-tab {
  padding: 0.6rem 1rem; border: none; background: transparent;
  font-size: 0.85rem; font-weight: 600; cursor: pointer;
  color: var(--text-muted); border-bottom: 2px solid transparent;
  margin-bottom: -2px; transition: var(--transition);
  display: flex; align-items: center; gap: 6px;
}
.form-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
.form-tab:hover { color: var(--text-secondary); }

.image-upload-area { text-align: center; padding: 0.5rem 0; }
.image-preview {
  width: 100%; max-width: 320px; height: 200px;
  margin: 0 auto 1rem; border-radius: var(--radius);
  overflow: hidden; position: relative;
  border: 2px dashed var(--border);
  display: flex; align-items: center; justify-content: center;
  background: var(--background);
}
.image-preview img { width: 100%; height: 100%; object-fit: cover; }
.image-preview.empty { flex-direction: column; gap: 8px; cursor: pointer; }
.image-preview.empty svg { width: 40px; height: 40px; color: var(--text-muted); }
.image-preview.empty p { font-size: 0.85rem; color: var(--text-muted); }
.image-remove-btn { position: absolute; top: 8px; right: 8px; background: rgba(239,68,68,0.9); color: white; border: none; font-size: 0.75rem; }
.image-hint { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem; }

.table-img-thumb {
  width: 42px; height: 42px; border-radius: var(--radius-xs);
  overflow: hidden; background: var(--border-light);
  display: flex; align-items: center; justify-content: center;
}
.table-img-thumb img { width: 100%; height: 100%; object-fit: cover; }

.cat-badge {
  display: inline-flex; padding: 2px 10px; border-radius: 999px;
  font-size: 0.75rem; font-weight: 600;
  background: var(--info-light); color: #1e40af;
}
.extras-count {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--purple-light); color: var(--purple);
  font-size: 0.8rem; font-weight: 700;
}

.toggle { position: relative; width: 44px; height: 24px; display: inline-block; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle .slider { position: absolute; inset: 0; background: #e2e8f0; border-radius: 999px; cursor: pointer; transition: 0.2s; }
.toggle .slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
.toggle input:checked + .slider { background: #16a34a; }
.toggle input:checked + .slider::before { transform: translateX(20px); }

.extra-row { margin-bottom: 8px; }
.extra-fields {
  display: flex; gap: 8px; align-items: center;
  padding: 8px 10px; border-radius: var(--radius-xs);
  background: var(--border-light); border: 1px solid var(--border);
}
.extra-name { flex: 1; }
.extra-number-group { display: flex; align-items: center; gap: 4px; width: 100px; }
.extra-currency { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); }
.extra-price-input { width: 80px; }
.extra-max-group { display: flex; align-items: center; gap: 4px; }
.extra-max-label { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
.extra-max-input { width: 50px; text-align: center; }
.extra-fields input { padding: 6px 8px; border: 1.5px solid var(--border); border-radius: 4px; font-size: 0.85rem; outline: none; transition: var(--transition); }
.extra-fields input:focus { border-color: var(--primary); }
.extras-header { margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }

/* ── Disponibilidade ── */
.card-inline {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 0.85rem 1rem; border-radius: var(--radius-xs);
  background: var(--border-light); border: 1px solid var(--border);
  margin-bottom: 0.75rem;
}
.modulos-chips, .dias-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.modulo-chip, .dia-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 999px; cursor: pointer;
  border: 1.5px solid var(--border); background: var(--surface);
  font-size: 0.82rem; font-weight: 600; transition: var(--transition);
}
.modulo-chip:hover, .dia-chip:hover { border-color: var(--primary); }
.modulo-chip.ativa, .dia-chip.ativa { border-color: var(--primary); background: var(--primary-light); color: var(--primary-dark); }
.modulo-chip input, .dia-chip input { width: 15px; height: 15px; accent-color: var(--primary); margin: 0; }

/* Categoria List */
.categoria-list { margin-bottom: 1rem; }
.categoria-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; border-radius: 8px;
  background: var(--border-light); margin-bottom: 6px;
  border: 1px solid var(--border);
}
.categoria-info { display: flex; align-items: center; gap: 10px; flex: 1; }
.cat-order {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--primary-light); color: var(--primary-dark);
  font-size: 0.75rem; font-weight: 700;
}
.categoria-actions { display: flex; gap: 4px; }

/* Subcategorias de adicionais (catálogo) */
.subcats-grid {
  display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 0.5rem;
}
.subcat-check {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px; cursor: pointer;
  background: var(--border-light); border: 1.5px solid transparent;
  transition: var(--transition);
}
.subcat-check:hover { border-color: var(--primary); }
.subcat-check.ativa { border-color: var(--primary); background: var(--primary-light); }
.subcat-check input { width: 16px; height: 16px; accent-color: var(--primary); }
.subcat-check span { display: flex; flex-direction: column; line-height: 1.2; }
.subcat-check small { color: var(--text-muted); font-size: 0.75rem; }
.extras-legado {
  margin-top: 1rem; padding-top: 0.75rem;
  border-top: 1px dashed var(--border);
}
.extras-legado-titulo {
  font-size: 0.8rem; font-weight: 700;
  color: var(--text-muted); margin-bottom: 0.5rem;
}
.cat-sub {
  padding: 10px 12px; border-radius: 8px; margin-bottom: 8px;
  background: var(--border-light); border: 1px solid var(--border);
}
.cat-sub-header {
  display: flex; align-items: center; gap: 10px;
  justify-content: space-between; margin-bottom: 6px;
}
.cat-sub-itens { display: flex; flex-wrap: wrap; gap: 6px; }
.cat-item-chip {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 999px; padding: 2px 10px;
  font-size: 0.78rem;
}
.cat-item-row {
  display: flex; gap: 6px; margin-bottom: 6px; align-items: center;
}
.cat-item-row .extra-name { flex: 1; }
</style>
