<template>
  <div>
    <!-- Abas do Cardápio: Produtos | Categorias | Subcategorias | Opções Padrão -->
    <div class="cardapio-tabs">
      <button class="cardapio-tab" :class="{ active: mainTab === 'produtos' }" @click="tabProdutos">
        <i-lucide-hamburger style="width:16px;height:16px" /> Produtos
      </button>
      <button class="cardapio-tab" :class="{ active: mainTab === 'categorias' }" @click="tabCategorias">
        <i-lucide-tags style="width:16px;height:16px" /> Categorias
      </button>
      <button class="cardapio-tab" :class="{ active: mainTab === 'subcategorias' }" @click="openCatalogDrawer">
        <i-lucide-folder-tree style="width:16px;height:16px" /> Subcategorias Adicionais
      </button>
      <button class="cardapio-tab" :class="{ active: mainTab === 'opcoesPadrao' }" @click="openOpcoesDrawer">
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

    <!-- ════════════════ DRAWER: CATEGORIAS ════════════════ -->
    <Transition name="drawer-fade">
      <div v-if="categoriasDrawerOpen" class="drawer-overlay" @click.self="fecharCategoriasDrawer"></div>
    </Transition>
    <Transition name="drawer-slide">
      <aside v-if="categoriasDrawerOpen" class="drawer-panel">
        <!-- Header -->
        <div class="drawer-header">
          <div class="drawer-icon"><i-lucide-tags style="width:22px;height:22px" /></div>
          <div class="drawer-header-text">
            <h3>Categorias do Cardápio</h3>
            <p>Organize os produtos por categoria. Uma categoria inteira pode ser usada como subcategoria de adicionais (ex: usar "Bebidas" como grupo de extras).</p>
          </div>
          <button class="drawer-close" @click="fecharCategoriasDrawer"><i-lucide-x style="width:18px;height:18px" /></button>
        </div>

        <!-- ── VIEW: Lista ── -->
        <div v-if="!categoriasEditorOpen" class="drawer-body">
          <div class="drawer-toolbar">
            <button class="btn btn-primary" @click="novaCategoria">
              <i-lucide-plus style="width:16px;height:16px" /> Nova Categoria
            </button>
            <span class="drawer-toolbar-count">{{ categorias.length }} categoria(s)</span>
          </div>

          <div v-if="categorias.length" class="catalog-list">
            <div v-for="cat in categorias" :key="cat.id" class="catalog-card">
              <div class="catalog-card-head">
                <div class="catalog-card-title">
                  <span class="catalog-card-icon"><i-lucide-tags style="width:16px;height:16px" /></span>
                  <div class="catalog-card-name">
                    <strong>{{ cat.nome }}</strong>
                    <span v-if="cat.produto_count > 0" class="badge badge-info">{{ cat.produto_count }} produto(s)</span>
                  </div>
                </div>
                <div class="catalog-card-actions">
                  <button class="btn-icon" title="Editar" @click="editarCategoria(cat)"><i-lucide-pencil style="width:15px;height:15px" /></button>
                  <button class="btn-icon danger" title="Excluir" @click="excluirCategoria(cat)"><i-lucide-trash-2 style="width:15px;height:15px" /></button>
                </div>
              </div>
              <p class="catalog-card-sub">
                <code style="font-size:0.74rem;color:var(--text-muted);">{{ cat.slug }}</code>
              </p>
            </div>
          </div>

          <div v-else class="drawer-empty">
            <i-lucide-tags style="width:44px;height:44px" />
            <p>Nenhuma categoria cadastrada ainda.</p>
            <button class="btn btn-primary btn-sm" @click="novaCategoria">Criar a primeira</button>
          </div>
        </div>

        <!-- ── VIEW: Editor ── -->
        <div v-else class="drawer-body">
          <button class="btn btn-secondary btn-sm" @click="cancelarEditCategoria">
            <i-lucide-arrow-left style="width:15px;height:15px" /> Voltar para a lista
          </button>

          <div class="editor-card">
            <h4>{{ editandoCategoria ? '✏️ Editar categoria' : '➕ Nova categoria' }}</h4>

            <div class="form-group">
              <label>Nome da categoria</label>
              <input v-model="catForm.nome" placeholder="Ex: Lanches, Bebidas, Sobremesas..." @keyup.enter="salvarCategoria" />
              <p class="field-hint">O slug (endereço amigável) é gerado automaticamente a partir do nome.</p>
            </div>

            <div class="editor-footer">
              <button class="btn btn-primary" @click="salvarCategoria" :disabled="!catForm.nome.trim() || salvandoCat">
                <i-lucide-save style="width:15px;height:15px" /> {{ salvandoCat ? 'Salvando...' : (editandoCategoria ? 'Salvar alterações' : 'Criar categoria') }}
              </button>
              <button class="btn btn-secondary" @click="cancelarEditCategoria">Cancelar</button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>

    <!-- ════════════════ DRAWER: SUBCATEGORIAS DE ADICIONAIS ════════════════ -->
    <Transition name="drawer-fade">
      <div v-if="catalogDrawerOpen" class="drawer-overlay" @click.self="closeCatalogDrawer"></div>
    </Transition>
    <Transition name="drawer-slide">
      <aside v-if="catalogDrawerOpen" class="drawer-panel">
        <!-- Header -->
        <div class="drawer-header">
          <div class="drawer-icon"><i-lucide-folder-tree style="width:22px;height:22px" /></div>
          <div class="drawer-header-text">
            <h3>Subcategorias de Adicionais</h3>
            <p>Grupos pré-cadastrados que aparecem no modal de cada produto. Cada item pode ter imagem e descrição próprias — ou use uma categoria do cardápio inteira.</p>
          </div>
          <button class="drawer-close" @click="closeCatalogDrawer"><i-lucide-x style="width:18px;height:18px" /></button>
        </div>

        <!-- ── VIEW: Lista ── -->
        <div v-if="!catalogEditorOpen" class="drawer-body">
          <div class="drawer-toolbar">
            <button class="btn btn-primary" @click="novaCatalogoSub">
              <i-lucide-plus style="width:16px;height:16px" /> Nova Subcategoria
            </button>
            <span class="drawer-toolbar-count">{{ subcategoriasCatalogo.length }} cadastrada(s)</span>
          </div>

          <div v-if="subcategoriasCatalogo.length" class="catalog-list">
            <div v-for="sub in subcategoriasCatalogo" :key="sub.id" class="catalog-card">
              <div class="catalog-card-head">
                <div class="catalog-card-title">
                  <span class="catalog-card-icon"><i-lucide-folder style="width:16px;height:16px" /></span>
                  <div class="catalog-card-name">
                    <strong>{{ sub.nome }}</strong>
                    <span class="badge" :class="sub.tipo === 'categoria' ? 'badge-info' : 'badge-soft'">
                      <i-lucide-tags v-if="sub.tipo === 'categoria'" style="width:11px;height:11px" />
                      {{ sub.tipo === 'categoria' ? (sub.categoria_nome || 'Categoria') : 'Manual' }}
                    </span>
                  </div>
                </div>
                <div class="catalog-card-actions">
                  <button class="btn-icon" title="Editar" @click="editarCatalogoSub(sub)"><i-lucide-pencil style="width:15px;height:15px" /></button>
                  <button class="btn-icon danger" title="Excluir" @click="excluirCatalogoSub(sub)"><i-lucide-trash-2 style="width:15px;height:15px" /></button>
                </div>
              </div>

              <p class="catalog-card-sub">
                <template v-if="sub.tipo === 'categoria'">
                  Usa os produtos <strong>ativos</strong> da categoria como itens (preço do próprio produto).
                </template>
                <template v-else>{{ sub.itens.length }} item(ns)</template>
              </p>

              <div v-if="sub.itens.length" class="catalog-chips">
                <span v-for="item in sub.itens" :key="item.id || item.nome" class="catalog-chip" :title="item.descricao || item.nome">
                  <img v-if="itemImgSrc(item)" :src="itemImgSrc(item)" alt="" />
                  {{ item.nome }} <em>· {{ formatPrice(item.preco) }}</em>
                </span>
              </div>
              <span v-else class="catalog-empty-hint">sem itens</span>
            </div>
          </div>

          <div v-else class="drawer-empty">
            <i-lucide-folder-open style="width:44px;height:44px" />
            <p>Nenhuma subcategoria cadastrada ainda.</p>
            <button class="btn btn-primary btn-sm" @click="novaCatalogoSub">Criar a primeira</button>
          </div>
        </div>

        <!-- ── VIEW: Editor ── -->
        <div v-else class="drawer-body">
          <button class="btn btn-secondary btn-sm" @click="cancelarCatalogoEdit">
            <i-lucide-arrow-left style="width:15px;height:15px" /> Voltar para a lista
          </button>

          <div class="editor-card">
            <h4>{{ catalogEditId ? '✏️ Editar subcategoria' : '➕ Nova subcategoria' }}</h4>

            <div class="form-group">
              <label>Nome do grupo</label>
              <input v-model="catalogForm.nome" placeholder="Ex: Porções, Bebidas, Extra..." />
            </div>

            <div class="form-group">
              <label>Tipo de grupo</label>
              <div class="segmented">
                <button :class="{ ativo: catalogForm.tipo === 'manual' }" @click="catalogForm.tipo = 'manual'">
                  <i-lucide-list style="width:14px;height:14px" /> Itens manuais
                </button>
                <button :class="{ ativo: catalogForm.tipo === 'categoria' }" @click="catalogForm.tipo = 'categoria'">
                  <i-lucide-tags style="width:14px;height:14px" /> Categoria do cardápio
                </button>
              </div>
            </div>

            <div v-if="catalogForm.tipo === 'categoria'" class="form-group">
              <label>Categoria do cardápio</label>
              <select v-model="catalogForm.categoria_id">
                <option value="">Selecione...</option>
                <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
              </select>
              <p class="field-hint">Os produtos <strong>ativos</strong> da categoria viram os itens, sempre sincronizado com o cardápio e com o preço do próprio produto.</p>
            </div>

            <template v-if="catalogForm.tipo === 'manual'">
              <div class="editor-subtitle">Itens do grupo <span>imagem e descrição são opcionais · imagens até 5MB</span></div>

              <div v-for="(item, i) in catalogForm.itens" :key="i" class="catalog-item-card">
                <label class="catalog-item-thumb" title="Enviar imagem do item (máx. 5MB)">
                  <img v-if="itemImgSrc(item)" :src="itemImgSrc(item)" alt="" />
                  <i-lucide-image v-else style="width:18px;height:18px" />
                  <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" @change="onItemImageSelected($event, item)" />
                </label>

                <div class="catalog-item-fields">
                  <div class="catalog-item-row">
                    <input v-model="item.nome" placeholder="Nome do item (ex: Arroz)" />
                    <div class="field-price">
                      <span>R$</span>
                      <input v-model.number="item.preco" type="number" step="0.50" min="0" placeholder="0,00" />
                    </div>
                    <div class="field-max">
                      <input v-model.number="item.maximo" type="number" min="0" placeholder="1" title="Máximo por item (1 = checkbox, >1 = quantidade)" />
                      <span>máx</span>
                    </div>
                    <button class="btn-icon danger" title="Remover item" @click="catalogForm.itens.splice(i, 1)">
                      <i-lucide-x style="width:15px;height:15px" />
                    </button>
                  </div>
                  <input v-model="item.descricao" class="catalog-item-desc" placeholder="Descrição (opcional)" />
                </div>
              </div>

              <button class="btn btn-secondary btn-block" @click="catalogForm.itens.push({ nome: '', preco: 0, maximo: 1, descricao: '', imagem_url: '', imagem_base64: '' })">
                <i-lucide-plus style="width:15px;height:15px" /> Adicionar item
              </button>
            </template>

            <div class="editor-footer">
              <button class="btn btn-primary" @click="salvarCatalogoSub" :disabled="!catalogForm.nome.trim() || (catalogForm.tipo === 'categoria' && !catalogForm.categoria_id)">
                <i-lucide-save style="width:15px;height:15px" /> {{ catalogEditId ? 'Salvar alterações' : 'Criar subcategoria' }}
              </button>
              <button class="btn btn-secondary" @click="cancelarCatalogoEdit">Cancelar</button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>

    <!-- ════════════════ DRAWER: OPÇÕES PADRÃO DO PRATO ════════════════ -->
    <Transition name="drawer-fade">
      <div v-if="opcoesDrawerOpen" class="drawer-overlay" @click.self="closeOpcoesDrawer"></div>
    </Transition>
    <Transition name="drawer-slide">
      <aside v-if="opcoesDrawerOpen" class="drawer-panel">
        <div class="drawer-header">
          <div class="drawer-icon"><i-lucide-list-checks style="width:22px;height:22px" /></div>
          <div class="drawer-header-text">
            <h3>Opções Padrão do Prato</h3>
            <p>Grupos de opções gratuitas reutilizáveis (ex: "Ponto da carne"). Cadastre uma vez e vincule a vários produtos — vínculo ao vivo.</p>
          </div>
          <button class="drawer-close" @click="closeOpcoesDrawer"><i-lucide-x style="width:18px;height:18px" /></button>
        </div>

        <!-- ── VIEW: Lista ── -->
        <div v-if="!opcoesEditorOpen" class="drawer-body">
          <div class="drawer-toolbar">
            <button class="btn btn-primary" @click="novaOpcaoPadrao">
              <i-lucide-plus style="width:16px;height:16px" /> Novo Grupo Padrão
            </button>
            <span class="drawer-toolbar-count">{{ opcoesPadraoCatalogo.length }} grupo(s)</span>
          </div>

          <div v-if="opcoesPadraoCatalogo.length" class="catalog-list">
            <div v-for="grupo in opcoesPadraoCatalogo" :key="grupo.id" class="catalog-card">
              <div class="catalog-card-head">
                <div class="catalog-card-title">
                  <span class="catalog-card-icon"><i-lucide-list-checks style="width:16px;height:16px" /></span>
                  <div class="catalog-card-name">
                    <strong>{{ grupo.grupo }}</strong>
                    <span class="badge" :class="grupo.obrigatoria ? 'badge-danger' : 'badge-info'">
                      {{ grupo.obrigatoria ? 'Obrigatória' : 'Opcional' }}
                    </span>
                    <span class="badge badge-soft">{{ grupo.tipo === 'unica' ? 'Seleção única' : 'Seleção múltipla' }}</span>
                  </div>
                </div>
                <div class="catalog-card-actions">
                  <button class="btn-icon" title="Editar" @click="editarOpcaoPadrao(grupo)"><i-lucide-pencil style="width:15px;height:15px" /></button>
                  <button class="btn-icon danger" title="Excluir" @click="excluirOpcaoPadrao(grupo)"><i-lucide-trash-2 style="width:15px;height:15px" /></button>
                </div>
              </div>

              <div v-if="grupo.opcoes.length" class="catalog-chips">
                <span v-for="op in grupo.opcoes" :key="op.id" class="catalog-chip">{{ op.nome }}</span>
              </div>
              <span v-else class="catalog-empty-hint">sem opções</span>
            </div>
          </div>

          <div v-else class="drawer-empty">
            <i-lucide-list-checks style="width:44px;height:44px" />
            <p>Nenhum grupo padrão cadastrado ainda.</p>
            <button class="btn btn-primary btn-sm" @click="novaOpcaoPadrao">Criar o primeiro</button>
          </div>
        </div>

        <!-- ── VIEW: Editor ── -->
        <div v-else class="drawer-body">
          <button class="btn btn-secondary btn-sm" @click="fecharOpcaoPadrao">
            <i-lucide-arrow-left style="width:15px;height:15px" /> Voltar para a lista
          </button>

          <div class="editor-card">
            <h4>{{ opPadraoEditId ? '✏️ Editar grupo padrão' : '➕ Novo grupo padrão' }}</h4>

            <div class="form-row">
              <div class="form-group" style="flex:1.6;">
                <label>Nome do grupo</label>
                <input v-model="opPadraoForm.grupo" placeholder="Ex: Ponto da carne" />
              </div>
              <div class="form-group" style="flex:1;">
                <label>Tipo de seleção</label>
                <div class="segmented">
                  <button :class="{ ativo: opPadraoForm.tipo === 'unica' }" @click="opPadraoForm.tipo = 'unica'">Única</button>
                  <button :class="{ ativo: opPadraoForm.tipo === 'multipla' }" @click="opPadraoForm.tipo = 'multipla'">Múltipla</button>
                </div>
              </div>
              <div class="form-group" style="flex:0.6;">
                <label>Obrigatória</label>
                <label class="toggle" style="margin-top:10px;">
                  <input type="checkbox" v-model="opPadraoForm.obrigatoria" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <div class="editor-subtitle">Opções do grupo</div>
            <div v-for="(op, oi) in opPadraoForm.opcoes" :key="oi" class="extra-fields" style="margin-bottom:8px;">
              <input :value="op" @input="opPadraoForm.opcoes[oi] = $event.target.value" placeholder="Opção (ex: Ao ponto)" class="extra-name" />
              <button class="btn-icon danger" @click="opPadraoForm.opcoes.splice(oi, 1)">
                <i-lucide-x style="width:15px;height:15px" />
              </button>
            </div>
            <button class="btn btn-secondary btn-block" @click="opPadraoForm.opcoes.push('')">
              <i-lucide-plus style="width:15px;height:15px" /> Adicionar opção
            </button>

            <div class="editor-footer">
              <button class="btn btn-primary" @click="salvarOpcaoPadrao" :disabled="!opPadraoForm.grupo.trim() || !opPadraoForm.opcoes.some(o => o.trim())">
                <i-lucide-save style="width:15px;height:15px" /> {{ opPadraoEditId ? 'Salvar alterações' : 'Criar grupo' }}
              </button>
              <button class="btn btn-secondary" @click="fecharOpcaoPadrao">Cancelar</button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>

    <!-- ════════════════ DRAWER: FORMULÁRIO DE PRODUTO ════════════════ -->
    <Transition name="drawer-fade">
      <div v-if="showForm" class="drawer-overlay" @click.self="showForm = false"></div>
    </Transition>
    <Transition name="drawer-slide">
      <aside v-if="showForm" class="drawer-panel drawer-wide">
        <!-- Header -->
        <div class="drawer-header">
          <div class="drawer-icon"><i-lucide-hamburger style="width:22px;height:22px" /></div>
          <div class="drawer-header-text">
            <h3>{{ editingId ? '✏️ Editar' : '➕ Novo' }} Produto</h3>
            <p>Preencha os dados e navegue pelas abas para configurar tudo.</p>
          </div>
          <button class="drawer-close" @click="showForm = false"><i-lucide-x style="width:18px;height:18px" /></button>
        </div>

        <!-- Tabs -->
        <div class="form-tabs">
          <button v-for="tab in formTabs" :key="tab.id" class="form-tab" :class="{ active: formTab === tab.id }" @click="formTab = tab.id">
            <component :is="tab.icon" style="width:16px;height:16px" />
            {{ tab.label }}
          </button>
        </div>

        <!-- Body -->
        <div class="drawer-body form-body">
          <!-- Tab: Dados Básicos -->
          <div v-show="formTab === 'dados'">
            <div class="form-section">
              <div class="form-section-title"><i-lucide-info style="width:16px;height:16px" /> Informações básicas</div>
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
                  <div class="status-toggle">
                    <label class="toggle">
                      <input type="checkbox" v-model="form.ativo" />
                      <span class="slider"></span>
                    </label>
                    <span :class="form.ativo ? 'text-ok' : 'text-no'">
                      <i-lucide-circle-check v-if="form.ativo" style="width:15px;height:15px" />
                      <i-lucide-circle-x v-else style="width:15px;height:15px" />
                      {{ form.ativo ? 'Ativo' : 'Inativo' }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="form-group" style="margin-bottom:0;">
                <label>Descrição</label>
                <textarea v-model="form.descricao" rows="3" placeholder="Descreva o produto, ingredientes, modo de preparo..."></textarea>
              </div>
            </div>
          </div>

          <!-- Tab: Imagem -->
          <div v-show="formTab === 'imagem'">
            <div class="form-section">
              <div class="form-section-title"><i-lucide-image style="width:16px;height:16px" /> Imagem do produto</div>
              <div class="image-upload-area">
                <div class="image-preview" :class="{ empty: !previewImage }">
                  <img v-if="previewImage" :src="previewImage" alt="Preview" />
                  <template v-else>
                    <i-lucide-cloud-upload />
                    <p>Sem imagem selecionada</p>
                  </template>
                  <button v-if="previewImage" class="image-remove-btn" @click="removerImagem">
                    <i-lucide-trash-2 style="width:14px;height:14px" /> Remover
                  </button>
                </div>

                <div class="image-actions">
                  <button class="btn btn-secondary" @click="$refs.fileInput.click()">
                    <i-lucide-folder-open style="width:14px;height:14px" /> Selecionar imagem
                  </button>
                </div>
                <input type="file" accept="image/png,image/jpeg,image/webp" @change="onImageSelected" ref="fileInput" style="display:none" />

                <div class="form-group" style="max-width:420px;margin:1rem auto 0;text-align:left;">
                  <label>Ou cole uma URL externa</label>
                  <input v-model="form.imagem_url" placeholder="https://..." @input="onUrlChange" />
                </div>
                <p class="image-hint">Formatos: PNG, JPG, WebP · Tamanho máximo: 5MB</p>
              </div>
            </div>
          </div>

          <!-- Tab: Adicionais -->
          <div v-show="formTab === 'extras'">
            <div class="form-section">
              <div class="form-section-title"><i-lucide-layers style="width:16px;height:16px" /> Subcategorias do catálogo</div>
              <p class="section-hint">Marque as subcategorias que aparecem para este produto. Os itens e preços vêm do catálogo compartilhado.</p>

              <div v-if="subcategoriasCatalogo.length" class="subcats-grid">
                <label
                  v-for="sub in subcategoriasCatalogo"
                  :key="sub.id"
                  class="subcat-check"
                  :class="{ ativa: form.subcategorias.includes(sub.id) }"
                >
                  <input type="checkbox" :value="sub.id" v-model="form.subcategorias" />
                  <span>
                    <strong>{{ sub.nome }}</strong>
                    <small>{{ sub.itens.length }} itens · {{ sub.tipo === 'categoria' ? 'categoria do cardápio' : 'manual' }}</small>
                  </span>
                </label>
              </div>
              <div v-else class="drawer-empty small">
                <p>Nenhuma subcategoria cadastrada ainda.</p>
              </div>
              <button class="btn btn-secondary btn-sm" style="margin-top:0.5rem;" @click="gerenciarCatalogoDoForm">
                <i-lucide-folder-tree style="width:14px;height:14px" /> Gerenciar catálogo de adicionais
              </button>
            </div>

            <div class="form-section">
              <div class="form-section-title"><i-lucide-circle-plus style="width:16px;height:16px" /> Adicionais avulsos <span class="title-tag">legado</span></div>
              <p class="section-hint">Específicos deste produto, aparecem no grupo "Geral" do pedido. O <strong>Máximo</strong> define quantas vezes o cliente pode pedir o mesmo adicional (ex: 2 carnes, 1 cebola).</p>

              <div v-if="form.extras.length" class="mini-list">
                <div v-for="(extra, i) in form.extras" :key="i" class="mini-list-item">
                  <span class="mini-list-icon"><i-lucide-circle-plus style="width:15px;height:15px" /></span>
                  <div class="mini-list-main">
                    <strong>{{ extra.nome }}</strong>
                    <small>{{ formatPrice(extra.preco) }} · máx {{ extra.maximo ?? 1 }}</small>
                  </div>
                  <button class="btn-icon" title="Editar" @click="editarExtra(i)"><i-lucide-pencil style="width:14px;height:14px" /></button>
                  <button class="btn-icon danger" title="Remover" @click="form.extras.splice(i, 1)"><i-lucide-trash-2 style="width:14px;height:14px" /></button>
                </div>
              </div>

              <button class="btn btn-secondary btn-block" @click="abrirExtraDrawer">
                <i-lucide-settings-2 style="width:15px;height:15px" /> {{ form.extras.length ? 'Gerenciar adicionais avulsos' : 'Adicionar adicionais avulsos' }}
              </button>
            </div>
          </div>

          <!-- Tab: Opções do Prato -->
          <div v-show="formTab === 'opcoes'">
            <div v-if="opcoesPadraoCatalogo.length" class="form-section">
              <div class="form-section-title"><i-lucide-list-checks style="width:16px;height:16px" /> Grupos padrão do catálogo <span class="title-tag">vínculo ao vivo</span></div>
              <p class="section-hint">Marque os grupos padrão pré-cadastrados que este produto usa. Editar o grupo na aba "Opções Padrão" atualiza todos os produtos vinculados.</p>
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

            <div class="form-section">
              <div class="form-section-title"><i-lucide-circle-plus style="width:16px;height:16px" /> Opções avulsas deste produto</div>
              <p class="section-hint">Gratuitas (ex: ponto da carne, com/sem açúcar). <strong>Única</strong> = radio; <strong>Múltipla</strong> = checkbox. Marque <strong>Obrigatória</strong> para exigir a escolha antes de adicionar ao carrinho.</p>

              <div v-if="form.opcoes.length" class="mini-list">
                <div v-for="(g, gi) in form.opcoes" :key="gi" class="mini-list-item">
                  <span class="mini-list-icon"><i-lucide-list-checks style="width:15px;height:15px" /></span>
                  <div class="mini-list-main">
                    <strong>{{ g.grupo }}</strong>
                    <small>{{ g.tipo === 'unica' ? 'Seleção única' : 'Seleção múltipla' }}{{ g.obrigatoria ? ' · Obrigatória' : '' }} · {{ g.opcoes.filter(o => o.trim()).length }} opção(ões)</small>
                  </div>
                  <button class="btn-icon" title="Editar" @click="editarOpcaoAvulsa(gi)"><i-lucide-pencil style="width:14px;height:14px" /></button>
                  <button class="btn-icon danger" title="Remover" @click="form.opcoes.splice(gi, 1)"><i-lucide-trash-2 style="width:14px;height:14px" /></button>
                </div>
              </div>

              <button class="btn btn-secondary btn-block" @click="abrirOpcaoDrawer">
                <i-lucide-settings-2 style="width:15px;height:15px" /> {{ form.opcoes.length ? 'Gerenciar opções avulsas' : 'Adicionar opções avulsas' }}
              </button>
            </div>
          </div>

          <!-- Tab: Disponibilidade -->
          <div v-show="formTab === 'disponibilidade'">
            <div class="form-section">
              <div class="form-section-title"><i-lucide-utensils style="width:16px;height:16px" /> Talheres obrigatório</div>
              <div class="switch-line">
                <p>Quando ativo, o cliente é obrigado a escolher entre "Sim" ou "Não" querer talheres antes de adicionar ao carrinho.</p>
                <label class="toggle">
                  <input type="checkbox" v-model="form.talheres_obrigatorio" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <div class="form-section">
              <div class="form-section-title"><i-lucide-store style="width:16px;height:16px" /> Módulos onde o prato é vendido</div>
              <p class="section-hint">Escolha em quais módulos o prato aparece. Ex: "Salão + Delivery", somente "Salão" ou somente "Delivery".</p>
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

            <div class="form-section">
              <div class="form-section-title"><i-lucide-calendar-clock style="width:16px;height:16px" /> Dias e horários disponíveis</div>
              <p class="section-hint">Fora do range selecionado, o prato fica automaticamente pausado no cardápio. Deixe todos os dias marcados e os horários vazios para ficar sempre disponível.</p>
              <div class="dias-grid">
                <label v-for="(nome, idx) in diasSemana" :key="idx" class="dia-chip" :class="{ ativa: form.dias_semana.includes(idx) }">
                  <input type="checkbox" :value="idx" v-model="form.dias_semana" />
                  {{ nome }}
                </label>
              </div>
              <div class="form-row" style="max-width:420px;margin-top:0.75rem;">
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
        </div>

        <!-- Footer -->
        <div class="drawer-footer">
          <button class="btn btn-secondary" @click="showForm = false">Cancelar</button>
          <button class="btn btn-primary" style="min-width:140px;" @click="salvar" :disabled="salvando">
            <i-lucide-loader v-if="salvando" class="spinning" style="width:16px;height:16px" />
            <i-lucide-save v-else style="width:16px;height:16px" />
            {{ salvando ? 'Salvando...' : 'Salvar' }}
          </button>
        </div>
      </aside>
    </Transition>

    <!-- ════════════ DRAWER ANINHADO: ADICIONAIS AVULSOS (dentro do form) ════════════ -->
    <Transition name="drawer-fade">
      <div v-if="extraDrawerOpen" class="drawer-overlay stacked" @click.self="fecharExtraDrawer"></div>
    </Transition>
    <Transition name="drawer-slide">
      <aside v-if="extraDrawerOpen" class="drawer-panel drawer-narrow stacked">
        <div class="drawer-header">
          <div class="drawer-icon"><i-lucide-circle-plus style="width:22px;height:22px" /></div>
          <div class="drawer-header-text">
            <h3>Adicionais avulsos</h3>
            <p>Específicos deste produto — aparecem no grupo "Geral" do pedido. O máximo define quantas vezes o cliente pode pedir.</p>
          </div>
          <button class="drawer-close" @click="fecharExtraDrawer"><i-lucide-x style="width:18px;height:18px" /></button>
        </div>

        <!-- ── VIEW: Lista ── -->
        <div v-if="!extraEditorOpen" class="drawer-body">
          <div class="drawer-toolbar">
            <button class="btn btn-primary" @click="novoExtra">
              <i-lucide-plus style="width:16px;height:16px" /> Novo Adicional
            </button>
            <span class="drawer-toolbar-count">{{ form.extras.length }} adicional(is)</span>
          </div>

          <div v-if="form.extras.length" class="catalog-list">
            <div v-for="(extra, i) in form.extras" :key="i" class="catalog-card">
              <div class="catalog-card-head">
                <div class="catalog-card-title">
                  <span class="catalog-card-icon"><i-lucide-circle-plus style="width:16px;height:16px" /></span>
                  <div class="catalog-card-name">
                    <strong>{{ extra.nome }}</strong>
                    <span class="badge badge-soft">{{ formatPrice(extra.preco) }}</span>
                    <span class="badge badge-soft">máx {{ extra.maximo ?? 1 }}</span>
                  </div>
                </div>
                <div class="catalog-card-actions">
                  <button class="btn-icon" title="Editar" @click="editarExtra(i)"><i-lucide-pencil style="width:15px;height:15px" /></button>
                  <button class="btn-icon danger" title="Excluir" @click="form.extras.splice(i, 1)"><i-lucide-trash-2 style="width:15px;height:15px" /></button>
                </div>
              </div>
              <p class="catalog-card-sub">{{ extra.maximo > 1 ? `O cliente pode pedir até ${extra.maximo}x` : 'Cliente pode pedir 1x (checkbox)' }}</p>
            </div>
          </div>

          <div v-else class="drawer-empty">
            <i-lucide-circle-plus style="width:44px;height:44px" />
            <p>Nenhum adicional avulso ainda.</p>
            <button class="btn btn-primary btn-sm" @click="novoExtra">Adicionar o primeiro</button>
          </div>
        </div>

        <!-- ── VIEW: Editor ── -->
        <div v-else class="drawer-body">
          <button class="btn btn-secondary btn-sm" @click="cancelarExtraEdit">
            <i-lucide-arrow-left style="width:15px;height:15px" /> Voltar para a lista
          </button>

          <div class="editor-card">
            <h4>{{ extraEditIdx !== null ? '✏️ Editar adicional' : '➕ Novo adicional' }}</h4>

            <div class="form-group">
              <label>Nome do adicional</label>
              <input v-model="extraForm.nome" placeholder="Ex: Carne extra, Cebola, Bacon..." @keyup.enter="salvarExtra" />
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Preço (R$)</label>
                <input v-model.number="extraForm.preco" type="number" step="0.50" min="0" placeholder="0,00" />
              </div>
              <div class="form-group">
                <label>Máximo por item</label>
                <input v-model.number="extraForm.maximo" type="number" min="0" max="99" placeholder="1" />
                <p class="field-hint">1 = checkbox · 2+ = quantidade</p>
              </div>
            </div>

            <div class="editor-footer">
              <button class="btn btn-primary" @click="salvarExtra" :disabled="!extraForm.nome.trim()">
                <i-lucide-save style="width:15px;height:15px" /> Salvar
              </button>
              <button class="btn btn-secondary" @click="cancelarExtraEdit">Cancelar</button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>

    <!-- ════════════ DRAWER ANINHADO: OPÇÕES AVULSAS DO PRATO (dentro do form) ════════════ -->
    <Transition name="drawer-fade">
      <div v-if="opcaoDrawerOpen" class="drawer-overlay stacked" @click.self="fecharOpcaoDrawer"></div>
    </Transition>
    <Transition name="drawer-slide">
      <aside v-if="opcaoDrawerOpen" class="drawer-panel drawer-narrow stacked">
        <div class="drawer-header">
          <div class="drawer-icon"><i-lucide-list-checks style="width:22px;height:22px" /></div>
          <div class="drawer-header-text">
            <h3>Opções avulsas do prato</h3>
            <p>Grupos de opções gratuitas específicos deste produto (ex: Ponto da carne, Com/Sem açúcar).</p>
          </div>
          <button class="drawer-close" @click="fecharOpcaoDrawer"><i-lucide-x style="width:18px;height:18px" /></button>
        </div>

        <!-- ── VIEW: Lista ── -->
        <div v-if="!opcaoEditorOpen" class="drawer-body">
          <div class="drawer-toolbar">
            <button class="btn btn-primary" @click="novaOpcaoAvulsa">
              <i-lucide-plus style="width:16px;height:16px" /> Novo Grupo
            </button>
            <span class="drawer-toolbar-count">{{ form.opcoes.length }} grupo(s)</span>
          </div>

          <div v-if="form.opcoes.length" class="catalog-list">
            <div v-for="(g, gi) in form.opcoes" :key="gi" class="catalog-card">
              <div class="catalog-card-head">
                <div class="catalog-card-title">
                  <span class="catalog-card-icon"><i-lucide-list-checks style="width:16px;height:16px" /></span>
                  <div class="catalog-card-name">
                    <strong>{{ g.grupo }}</strong>
                    <span class="badge" :class="g.obrigatoria ? 'badge-danger' : 'badge-info'">{{ g.obrigatoria ? 'Obrigatória' : 'Opcional' }}</span>
                    <span class="badge badge-soft">{{ g.tipo === 'unica' ? 'Seleção única' : 'Seleção múltipla' }}</span>
                  </div>
                </div>
                <div class="catalog-card-actions">
                  <button class="btn-icon" title="Editar" @click="editarOpcaoAvulsa(gi)"><i-lucide-pencil style="width:15px;height:15px" /></button>
                  <button class="btn-icon danger" title="Excluir" @click="form.opcoes.splice(gi, 1)"><i-lucide-trash-2 style="width:15px;height:15px" /></button>
                </div>
              </div>
              <div v-if="g.opcoes.length" class="catalog-chips">
                <span v-for="(op, oi) in g.opcoes" :key="oi" class="catalog-chip">{{ op }}</span>
              </div>
              <span v-else class="catalog-empty-hint">sem opções</span>
            </div>
          </div>

          <div v-else class="drawer-empty">
            <i-lucide-list-checks style="width:44px;height:44px" />
            <p>Nenhum grupo de opções ainda.</p>
            <button class="btn btn-primary btn-sm" @click="novaOpcaoAvulsa">Criar o primeiro</button>
          </div>
        </div>

        <!-- ── VIEW: Editor ── -->
        <div v-else class="drawer-body">
          <button class="btn btn-secondary btn-sm" @click="cancelarOpcaoEdit">
            <i-lucide-arrow-left style="width:15px;height:15px" /> Voltar para a lista
          </button>

          <div class="editor-card">
            <h4>{{ opcaoEditIdx !== null ? '✏️ Editar grupo' : '➕ Novo grupo de opções' }}</h4>

            <div class="form-group">
              <label>Nome do grupo</label>
              <input v-model="opcaoForm.grupo" placeholder="Ex: Ponto da carne" @keyup.enter="salvarOpcaoAvulsa" />
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Tipo de seleção</label>
                <div class="segmented">
                  <button :class="{ ativo: opcaoForm.tipo === 'unica' }" @click="opcaoForm.tipo = 'unica'">Única</button>
                  <button :class="{ ativo: opcaoForm.tipo === 'multipla' }" @click="opcaoForm.tipo = 'multipla'">Múltipla</button>
                </div>
              </div>
              <div class="form-group">
                <label>Obrigatória</label>
                <label class="toggle" style="margin-top:10px;">
                  <input type="checkbox" v-model="opcaoForm.obrigatoria" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <div class="editor-subtitle">Opções do grupo</div>
            <div v-for="(op, oi) in opcaoForm.opcoes" :key="oi" class="extra-fields" style="margin-bottom:8px;">
              <input v-model="opcaoForm.opcoes[oi]" placeholder="Ex: Ao ponto" class="extra-name" />
              <button class="btn-icon danger" @click="opcaoForm.opcoes.splice(oi, 1)">
                <i-lucide-x style="width:15px;height:15px" />
              </button>
            </div>
            <button class="btn btn-secondary btn-block" @click="opcaoForm.opcoes.push('')">
              <i-lucide-plus style="width:15px;height:15px" /> Adicionar opção
            </button>

            <div class="editor-footer">
              <button class="btn btn-primary" @click="salvarOpcaoAvulsa" :disabled="!opcaoForm.grupo.trim() || !opcaoForm.opcoes.some(o => o.trim())">
                <i-lucide-save style="width:15px;height:15px" /> Salvar
              </button>
              <button class="btn btn-secondary" @click="cancelarOpcaoEdit">Cancelar</button>
            </div>
          </div>
        </div>
      </aside>
    </Transition>

    <!-- Dialog de erro de upload -->
    <AlertDialog
      :show="!!uploadError"
      title="Imagem muito grande"
      :message="uploadError"
      @close="uploadError = ''"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, markRaw, watch } from 'vue'
import { Info, Image, CirclePlus, ListChecks, CalendarClock } from 'lucide-vue-next'
import api from '../services/api'
import { PRODUCT_PLACEHOLDER } from '../utils/images'
import AlertDialog from '../components/AlertDialog.vue'

const produtos = ref([])
const uploadError = ref('')
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

// Abas do cardápio + drawers (super sidebar)
const mainTab = ref('produtos')
const catalogDrawerOpen = ref(false)
const catalogEditorOpen = ref(false)
const opcoesDrawerOpen = ref(false)
const opcoesEditorOpen = ref(false)
const categoriasDrawerOpen = ref(false)
const categoriasEditorOpen = ref(false)

// Drawers aninhados dentro do formulário de produto (empilhados sobre o form)
const extraDrawerOpen = ref(false)
const extraEditorOpen = ref(false)
const extraEditIdx = ref(null)
const extraForm = reactive({ nome: '', preco: 0, maximo: 1 })
const opcaoDrawerOpen = ref(false)
const opcaoEditorOpen = ref(false)
const opcaoEditIdx = ref(null)
const opcaoForm = reactive({ grupo: '', tipo: 'unica', obrigatoria: false, opcoes: [''] })
// Quando o drawer foi aberto a partir do formulário de produto (botão
// "Gerenciar..."), restaurar o form ao fechar — evita perder edição não salva
const formEraAberto = ref(false)

// Abas do formulário de produto
const formTabs = [
  { id: 'dados', label: 'Dados', icon: markRaw(Info) },
  { id: 'imagem', label: 'Imagem', icon: markRaw(Image) },
  { id: 'extras', label: 'Adicionais', icon: markRaw(CirclePlus) },
  { id: 'opcoes', label: 'Opções', icon: markRaw(ListChecks) },
  { id: 'disponibilidade', label: 'Disponibilidade', icon: markRaw(CalendarClock) },
]

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
    // O backend já retorna extras_count (avulsos + itens de subcategorias) no GET /produtos
    produtos.value = p.data
    categorias.value = c.data
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

// ── Drawer aninhado: Adicionais avulsos ──
function abrirExtraDrawer() { extraDrawerOpen.value = true; extraEditorOpen.value = false }
function fecharExtraDrawer() { extraDrawerOpen.value = false; extraEditorOpen.value = false; extraEditIdx.value = null }
function novoExtra() {
  extraEditIdx.value = null
  extraForm.nome = ''; extraForm.preco = 0; extraForm.maximo = 1
  extraEditorOpen.value = true
}
function editarExtra(i) {
  extraEditIdx.value = i
  const e = form.extras[i]
  extraForm.nome = e.nome; extraForm.preco = Number(e.preco); extraForm.maximo = e.maximo ?? 1
  extraEditorOpen.value = true
}
function cancelarExtraEdit() { extraEditorOpen.value = false; extraEditIdx.value = null }
function salvarExtra() {
  const nome = extraForm.nome.trim()
  if (!nome) return
  const dados = { nome, preco: extraForm.preco || 0, maximo: extraForm.maximo ?? 1 }
  if (extraEditIdx.value !== null) form.extras.splice(extraEditIdx.value, 1, dados)
  else form.extras.push(dados)
  cancelarExtraEdit()
}

// ── Drawer aninhado: Opções avulsas do prato ──
function abrirOpcaoDrawer() { opcaoDrawerOpen.value = true; opcaoEditorOpen.value = false }
function fecharOpcaoDrawer() { opcaoDrawerOpen.value = false; opcaoEditorOpen.value = false; opcaoEditIdx.value = null }
function novaOpcaoAvulsa() {
  opcaoEditIdx.value = null
  opcaoForm.grupo = ''; opcaoForm.tipo = 'unica'; opcaoForm.obrigatoria = false; opcaoForm.opcoes = ['']
  opcaoEditorOpen.value = true
}
function editarOpcaoAvulsa(gi) {
  opcaoEditIdx.value = gi
  const g = form.opcoes[gi]
  opcaoForm.grupo = g.grupo
  opcaoForm.tipo = g.tipo || 'unica'
  opcaoForm.obrigatoria = !!g.obrigatoria
  opcaoForm.opcoes = g.opcoes.length ? [...g.opcoes] : ['']
  opcaoEditorOpen.value = true
}
function cancelarOpcaoEdit() { opcaoEditorOpen.value = false; opcaoEditIdx.value = null }
function salvarOpcaoAvulsa() {
  const grupo = opcaoForm.grupo.trim()
  if (!grupo || !opcaoForm.opcoes.some(o => o.trim())) return
  const dados = {
    grupo,
    tipo: opcaoForm.tipo,
    obrigatoria: !!opcaoForm.obrigatoria,
    opcoes: opcaoForm.opcoes.map(o => o.trim()).filter(Boolean),
  }
  if (opcaoEditIdx.value !== null) form.opcoes.splice(opcaoEditIdx.value, 1, dados)
  else form.opcoes.push(dados)
  cancelarOpcaoEdit()
}

// ── Navegação entre abas + drawers ──
function tabProdutos() {
  catalogDrawerOpen.value = false
  opcoesDrawerOpen.value = false
  categoriasDrawerOpen.value = false
  formEraAberto.value = false
  mainTab.value = 'produtos'
}
function tabCategorias() {
  // Já aberto? Não re-renderiza nem joga do editor para a lista.
  if (categoriasDrawerOpen.value) return
  catalogDrawerOpen.value = false
  opcoesDrawerOpen.value = false
  showForm.value = false
  formEraAberto.value = false
  mainTab.value = 'categorias'
  categoriasDrawerOpen.value = true
  categoriasEditorOpen.value = false
  carregarCategorias()
}
function fecharCategoriasDrawer() {
  categoriasDrawerOpen.value = false
  if (mainTab.value === 'categorias') mainTab.value = 'produtos'
}
function openCatalogDrawer() {
  // Já aberto? Não re-renderiza nem joga do editor para a lista.
  if (catalogDrawerOpen.value) return
  opcoesDrawerOpen.value = false
  categoriasDrawerOpen.value = false
  showForm.value = false
  formEraAberto.value = false
  mainTab.value = 'subcategorias'
  catalogDrawerOpen.value = true
  catalogEditorOpen.value = false
  carregarCatalogo()
}
function closeCatalogDrawer() {
  catalogDrawerOpen.value = false
  if (mainTab.value === 'subcategorias') mainTab.value = 'produtos'
  if (formEraAberto.value) { formEraAberto.value = false; showForm.value = true }
}
function openOpcoesDrawer() {
  if (opcoesDrawerOpen.value) return
  catalogDrawerOpen.value = false
  categoriasDrawerOpen.value = false
  showForm.value = false
  formEraAberto.value = false
  mainTab.value = 'opcoesPadrao'
  opcoesDrawerOpen.value = true
  opcoesEditorOpen.value = false
  carregarOpcoesPadrao()
}
function closeOpcoesDrawer() {
  opcoesDrawerOpen.value = false
  if (mainTab.value === 'opcoesPadrao') mainTab.value = 'produtos'
  if (formEraAberto.value) { formEraAberto.value = false; showForm.value = true }
}

// Botões "Gerenciar catálogo"/"Gerenciar grupos padrão" dentro do form de produto:
// fecha o form e abre o drawer correspondente, marcando para restaurar o form
// ao fechar o drawer (preserva edição não salva).
function gerenciarCatalogoDoForm() {
  showForm.value = false
  openCatalogDrawer()
  formEraAberto.value = true
}
function gerenciarOpcoesPadraoDoForm() {
  showForm.value = false
  openOpcoesDrawer()
  formEraAberto.value = true
}

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
  catalogEditorOpen.value = true
}

function editarCatalogoSub(sub) {
  catalogEditId.value = sub.id
  catalogForm.nome = sub.nome
  catalogForm.tipo = sub.tipo || 'manual'
  catalogForm.categoria_id = sub.categoria_id ? String(sub.categoria_id) : ''
  catalogForm.itens = (sub.itens || []).map(i => ({
    nome: i.nome, preco: Number(i.preco), maximo: i.maximo ?? 1,
    descricao: i.descricao || '', imagem_url: i.imagem_url || '', imagem_base64: i.imagem_base64 || '',
  }))
  catalogEditorOpen.value = true
}

function cancelarCatalogoEdit() {
  catalogEditId.value = null
  catalogForm.nome = ''
  catalogForm.tipo = 'manual'
  catalogForm.categoria_id = ''
  catalogForm.itens = []
  catalogEditorOpen.value = false
}

// Imagem de item do catálogo (base64 — sem upload de arquivo)
function onItemImageSelected(event, item) {
  const file = event.target.files[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) { uploadError.value = 'Imagem muito grande! O tamanho máximo permitido é 5MB.'; return }
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
    await load()
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
  opcoesEditorOpen.value = true
}

function editarOpcaoPadrao(grupo) {
  opPadraoEditId.value = grupo.id
  opPadraoForm.grupo = grupo.grupo
  opPadraoForm.tipo = grupo.tipo || 'unica'
  opPadraoForm.obrigatoria = !!grupo.obrigatoria
  opPadraoForm.opcoes = grupo.opcoes.map(o => o.nome)
  opcoesEditorOpen.value = true
}

function fecharOpcaoPadrao() {
  opcoesEditorOpen.value = false
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
      // `id` só existe nos grupos padrão vinculados (opcao_padrao_id); as
      // avulsas não têm — é o que permite separá-los abaixo sem duplicar
      id: g.id,
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
  if (file.size > 5 * 1024 * 1024) { uploadError.value = 'Imagem muito grande! O tamanho máximo permitido é 5MB.'; return }
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
function novaCategoria() {
  cancelarEditCategoria()
  categoriasEditorOpen.value = true
}

function editarCategoria(cat) {
  editandoCategoria.value = cat
  catForm.nome = cat.nome
  categoriasEditorOpen.value = true
}

function cancelarEditCategoria() {
  editandoCategoria.value = null
  catForm.nome = ''
  categoriasEditorOpen.value = false
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
    categoriasEditorOpen.value = false
    await load()
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

// Fechar os drawers aninhados sempre que o formulário de produto fechar
watch(showForm, (v) => {
  if (!v) {
    extraDrawerOpen.value = false
    extraEditorOpen.value = false
    extraEditIdx.value = null
    opcaoDrawerOpen.value = false
    opcaoEditorOpen.value = false
    opcaoEditIdx.value = null
  }
})

onMounted(() => { load(); carregarCatalogo() })
</script>

<style scoped>
/* ══════════════════════════════════════════════════════════════
   ABAS DO CARDÁPIO (barra de navegação principal)
   ══════════════════════════════════════════════════════════════ */
.cardapio-tabs {
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  padding: 6px;
  background: var(--border-light);
  border: 1px solid var(--border);
  border-radius: 14px;
  margin-bottom: 1.25rem;
  box-shadow: var(--shadow-sm);
}
.cardapio-tab {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0.6rem 1.1rem; border-radius: 10px;
  border: 1px solid transparent; background: transparent;
  color: var(--text-secondary); font-size: 0.88rem; font-weight: 600;
  cursor: pointer; font-family: inherit; white-space: nowrap;
  transition: all 0.18s ease;
}
.cardapio-tab svg { transition: transform 0.18s ease; }
.cardapio-tab:hover { background: var(--surface); color: var(--primary-dark); border-color: var(--border); }
.cardapio-tab:hover svg { transform: scale(1.12); }
.cardapio-tab:active { transform: scale(0.96); }
.cardapio-tab.active {
  background: var(--primary-gradient); color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.28);
}
.cardapio-tab.active svg { color: #fff; }

/* ══════════════════════════════════════════════════════════════
   SUPER SIDEBAR / DRAWER (vem da direita para a esquerda)
   ══════════════════════════════════════════════════════════════ */
.drawer-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.5);
  z-index: 300;
  backdrop-filter: blur(3px);
}
.drawer-panel {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: min(680px, 100vw); height: 100vh;
  background: var(--surface);
  z-index: 301;
  display: flex; flex-direction: column;
  box-shadow: -16px 0 40px rgba(15, 23, 42, 0.18);
}
.drawer-panel.drawer-wide { width: min(920px, 100vw); }
.drawer-panel.drawer-narrow { width: min(480px, 100vw); }

/* Drawers aninhados empilhados sobre o form de produto */
.drawer-overlay.stacked { z-index: 310; }
.drawer-panel.stacked { z-index: 311; }

/* Transições */
.drawer-fade-enter-active, .drawer-fade-leave-active { transition: opacity 0.25s ease; }
.drawer-fade-enter-from, .drawer-fade-leave-to { opacity: 0; }
.drawer-slide-enter-active, .drawer-slide-leave-active { transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1); }
.drawer-slide-enter-from, .drawer-slide-leave-to { transform: translateX(100%); }

.drawer-header {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.drawer-icon {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(220, 38, 38, 0.1); color: var(--primary-dark);
}
.drawer-header-text { flex: 1; min-width: 0; }
.drawer-header-text h3 { margin: 2px 0 0; font-size: 1.05rem; }
.drawer-header-text p { margin: 4px 0 0; font-size: 0.8rem; color: var(--text-muted); line-height: 1.45; }
.drawer-close {
  margin-left: auto; width: 34px; height: 34px; border-radius: 10px; border: none; flex-shrink: 0;
  background: var(--border-light); color: var(--text-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: var(--transition);
}
.drawer-close:hover { background: #fee2e2; color: var(--error); }

.drawer-body { flex: 1; overflow-y: auto; padding: 1.25rem 1.5rem; }
.drawer-footer {
  flex-shrink: 0; padding: 1rem 1.5rem;
  border-top: 1px solid var(--border); background: var(--surface);
  display: flex; gap: 10px; justify-content: flex-end;
}

.drawer-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  margin-bottom: 1rem;
}
.drawer-toolbar-count { font-size: 0.78rem; color: var(--text-muted); font-weight: 600; }

.drawer-empty {
  text-align: center; padding: 3rem 1rem; color: var(--text-muted);
}
.drawer-empty svg { margin: 0 auto 0.75rem; display: block; color: var(--border); }
.drawer-empty p { font-size: 0.9rem; margin: 0 0 1rem; }
.drawer-empty.small { padding: 1.25rem; }

/* Badges (scoped — independentes do global) */
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 9px; border-radius: 999px;
  font-size: 0.7rem; font-weight: 700; white-space: nowrap;
  background: var(--border-light); color: var(--text-secondary);
  border: 1px solid var(--border);
}
.badge-info { background: var(--info-light); color: #1e40af; border-color: #bfdbfe; }
.badge-danger { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
.badge-soft { background: var(--border-light); color: var(--text-secondary); border-color: var(--border); }

/* ── Lista de catálogo (subcategorias / grupos padrão) ── */
.catalog-list { display: flex; flex-direction: column; gap: 10px; }
.catalog-card {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); padding: 0.9rem 1rem;
  transition: var(--transition);
}
.catalog-card:hover { border-color: #cbd5e1; box-shadow: var(--shadow-md); }
.catalog-card-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
}
.catalog-card-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.catalog-card-icon {
  width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--border-light); color: var(--text-secondary);
}
.catalog-card-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.catalog-card-name strong { font-size: 0.95rem; }
.catalog-card-actions { display: flex; gap: 4px; flex-shrink: 0; }
.catalog-card-sub { margin: 0.55rem 0 0.5rem; font-size: 0.78rem; color: var(--text-muted); }

.btn-icon {
  width: 30px; height: 30px; border-radius: 8px; border: none; cursor: pointer;
  background: var(--border-light); color: var(--text-secondary);
  display: inline-flex; align-items: center; justify-content: center;
  transition: var(--transition);
}
.btn-icon:hover { background: var(--info-light); color: #1e40af; }
.btn-icon.danger:hover { background: #fee2e2; color: var(--error); }

.catalog-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.catalog-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--border-light); border: 1px solid var(--border);
  border-radius: 999px; padding: 3px 10px; font-size: 0.76rem;
  color: var(--text-secondary);
}
.catalog-chip img { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
.catalog-chip em { font-style: normal; color: var(--text-muted); }
.catalog-empty-hint { font-size: 0.76rem; color: var(--text-muted); font-style: italic; }

/* ── Editor (drawer) ── */
.editor-card {
  margin-top: 1rem; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--surface);
  padding: 1.25rem;
}
.editor-card h4 { margin: 0 0 1rem; font-size: 1rem; }
.editor-subtitle {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.82rem; font-weight: 700; color: var(--text-secondary);
  margin: 1.1rem 0 0.6rem;
}
.editor-subtitle span { font-weight: 400; color: var(--text-muted); font-size: 0.74rem; }
.editor-footer {
  display: flex; gap: 10px; margin-top: 1.25rem;
  padding-top: 1rem; border-top: 1px solid var(--border);
  justify-content: flex-end;
}
.field-hint { font-size: 0.75rem; color: var(--text-muted); margin: 0.4rem 0 0; line-height: 1.4; }

/* Segmented control */
.segmented {
  display: inline-flex; gap: 4px; padding: 4px;
  background: var(--border-light); border: 1px solid var(--border);
  border-radius: 10px; flex-wrap: wrap;
}
.segmented button {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 8px; border: none; cursor: pointer;
  background: transparent; color: var(--text-secondary);
  font-size: 0.8rem; font-weight: 600; transition: var(--transition);
  font-family: inherit;
}
.segmented button:hover { color: var(--text-secondary); }
.segmented button.ativo {
  background: var(--surface); color: var(--primary-dark);
  box-shadow: var(--shadow-sm); border: 1px solid var(--border);
}

/* Itens do catálogo (editor) */
.catalog-item-card {
  display: flex; gap: 12px; align-items: flex-start;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--border-light); padding: 10px;
  margin-bottom: 8px;
}
.catalog-item-thumb {
  width: 56px; height: 56px; border-radius: 10px; flex-shrink: 0; cursor: pointer;
  border: 1.5px dashed var(--border); background: var(--surface);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
  color: var(--text-muted); transition: var(--transition);
}
.catalog-item-thumb:hover { border-color: var(--primary); color: var(--primary); }
.catalog-item-thumb img { width: 100%; height: 100%; object-fit: cover; }
.catalog-item-fields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.catalog-item-row { display: flex; gap: 6px; align-items: center; }
.catalog-item-row input,
.catalog-item-desc {
  padding: 7px 10px; border: 1.5px solid var(--border); border-radius: 8px;
  font-size: 0.85rem; outline: none; transition: var(--transition); width: 100%;
  background: var(--surface);
}
.catalog-item-row input:focus, .catalog-item-desc:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.08); }
.catalog-item-row .field-price { display: flex; align-items: center; gap: 4px; }
.catalog-item-row .field-price span, .field-max span { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); }
.catalog-item-row .field-price input { width: 74px; }
.catalog-item-row .field-max input { width: 48px; text-align: center; }
.catalog-item-desc { margin-top: 0; }

/* ══════════════════════════════════════════════════════════════
   FORMULÁRIO DE PRODUTO (drawer amplo + abas)
   ══════════════════════════════════════════════════════════════ */
.form-tabs {
  display: flex; gap: 6px; padding: 0.85rem 1.5rem;
  background: var(--surface); border-bottom: 1px solid var(--border);
  overflow-x: auto; flex-shrink: 0;
}
.form-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 0.55rem 1.05rem; border-radius: 999px;
  border: 1.5px solid var(--border); background: var(--surface);
  color: var(--text-secondary); font-size: 0.84rem; font-weight: 600;
  cursor: pointer; white-space: nowrap; transition: var(--transition);
  font-family: inherit;
}
.form-tab:hover { border-color: var(--primary); color: var(--primary-dark); }
.form-tab.active {
  background: var(--primary); border-color: var(--primary); color: #fff;
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
}

.form-body { padding: 1.25rem 1.5rem; }
.form-section {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); padding: 1.1rem 1.25rem; margin-bottom: 1rem;
}
.form-section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.88rem; font-weight: 700; color: var(--text-secondary);
  margin-bottom: 0.9rem;
}
.title-tag {
  font-size: 0.66rem; font-weight: 700; color: var(--text-muted);
  background: var(--border-light); border: 1px solid var(--border);
  padding: 1px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.4px;
}
.section-hint { font-size: 0.8rem; color: var(--text-muted); margin: -0.4rem 0 0.9rem; line-height: 1.5; }

.status-toggle { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.status-toggle .text-ok { display: inline-flex; align-items: center; gap: 5px; font-size: 0.9rem; font-weight: 600; color: var(--success, #16a34a); }
.status-toggle .text-no { display: inline-flex; align-items: center; gap: 5px; font-size: 0.9rem; font-weight: 600; color: var(--error, #ef4444); }

/* Imagem */
.image-upload-area { text-align: center; padding: 0.25rem 0; }
.image-preview {
  width: 100%; max-width: 340px; height: 210px;
  margin: 0 auto 1rem; border-radius: var(--radius);
  overflow: hidden; position: relative;
  border: 2px dashed var(--border);
  display: flex; align-items: center; justify-content: center;
  background: var(--border-light);
}
.image-preview img { width: 100%; height: 100%; object-fit: cover; }
.image-preview.empty { flex-direction: column; gap: 8px; }
.image-preview.empty svg { width: 42px; height: 42px; color: var(--text-muted); }
.image-preview.empty p { font-size: 0.85rem; color: var(--text-muted); }
.image-remove-btn {
  position: absolute; top: 8px; right: 8px;
  background: rgba(239, 68, 68, 0.92); color: white; border: none;
  font-size: 0.75rem; border-radius: 8px; padding: 5px 10px;
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
}
.image-actions { display: flex; justify-content: center; }
.image-hint { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.6rem; }

/* Toggles (scoped) */
.toggle { position: relative; width: 44px; height: 24px; display: inline-block; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle .slider { position: absolute; inset: 0; background: #e2e8f0; border-radius: 999px; cursor: pointer; transition: 0.2s; }
.toggle .slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
.toggle input:checked + .slider { background: #16a34a; }
.toggle input:checked + .slider::before { transform: translateX(20px); }

/* Subcategorias check grid */
.subcats-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 0.75rem; }
.subcat-check {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; border-radius: 10px; cursor: pointer;
  background: var(--border-light); border: 1.5px solid var(--border);
  transition: var(--transition);
}
.subcat-check:hover { border-color: var(--primary); }
.subcat-check.ativa { border-color: var(--primary); background: rgba(220, 38, 38, 0.08); }
.subcat-check input { width: 16px; height: 16px; accent-color: var(--primary); }
.subcat-check span { display: flex; flex-direction: column; line-height: 1.25; }
.subcat-check strong { font-size: 0.86rem; }
.subcat-check small { color: var(--text-muted); font-size: 0.74rem; }

/* Extras avulsos */
.extra-fields {
  display: flex; gap: 8px; align-items: center;
  padding: 9px 10px; border-radius: 10px;
  background: var(--border-light); border: 1px solid var(--border);
}
.extra-name { flex: 1; }
.extra-fields input, .extra-fields select {
  padding: 7px 9px; border: 1.5px solid var(--border); border-radius: 8px;
  font-size: 0.85rem; outline: none; transition: var(--transition); background: var(--surface);
}
.extra-fields input:focus, .extra-fields select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.08); }

/* Mini lista de vínculos dentro do form (adicionais/opções avulsas) */
.mini-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 0.75rem; }
.mini-list-item {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--border-light); padding: 9px 12px;
  transition: var(--transition);
}
.mini-list-item:hover { border-color: #cbd5e1; }
.mini-list-icon {
  width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface); color: var(--primary-dark);
  border: 1px solid var(--border);
}
.mini-list-main { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
.mini-list-main strong { font-size: 0.88rem; }
.mini-list-main small { font-size: 0.74rem; color: var(--text-muted); }
.mini-list-item .btn-icon { flex-shrink: 0; }

/* Disponibilidade */
.switch-line {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
}
.switch-line p { font-size: 0.82rem; color: var(--text-muted); margin: 0; line-height: 1.5; }
.modulos-chips, .dias-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.modulo-chip, .dia-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 999px; cursor: pointer;
  border: 1.5px solid var(--border); background: var(--surface);
  font-size: 0.84rem; font-weight: 600; transition: var(--transition);
}
.modulo-chip:hover, .dia-chip:hover { border-color: var(--primary); }
.modulo-chip.ativa, .dia-chip.ativa {
  border-color: var(--primary); background: rgba(220, 38, 38, 0.08); color: var(--primary-dark);
}
.modulo-chip input, .dia-chip input { width: 15px; height: 15px; accent-color: var(--primary); margin: 0; }

/* Table thumb / badges de lista (manter) */
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

/* Utilidades */
.btn-block { width: 100%; justify-content: center; }
.spinning { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
