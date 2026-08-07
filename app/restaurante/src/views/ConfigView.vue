<template>
  <div>
    <!-- Tabs -->
    <div class="config-tabs">
      <button v-for="tab in tabs" :key="tab.id"
        class="config-tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        <component :is="tab.icon" style="width:16px;height:16px" />
        {{ tab.label }}
      </button>
    </div>

    <!-- ── Tab: Geral ── -->
    <div v-if="activeTab === 'geral'" style="display:grid;gap:1.5rem;max-width:800px;">

      <!-- Store Status -->
      <div class="card">
        <div class="card-header">
          <i-lucide-power style="width:16px;height:16px" /> Status da Loja
        </div>
        <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <strong :style="{ color: storeOpen ? 'var(--success)' : 'var(--error)' }">
              <span :style="{ display:'inline-block', width:8, height:8, borderRadius:'50%', background: storeOpen ? '#16a34a' : '#ef4444', marginRight:6 }"></span>
              {{ storeOpen ? 'Loja Aberta' : 'Loja Fechada' }}
            </strong>
            <p style="font-size:0.85rem;color:var(--text-muted);margin-top:4px;">
              {{ storeOpen ? 'Clientes podem fazer pedidos normalmente.' : 'Novos pedidos estão bloqueados.' }}
            </p>
          </div>
          <button class="btn" :class="storeOpen ? 'btn-danger' : 'btn-success'" @click="toggleLoja">
            {{ storeOpen ? 'Fechar Loja' : 'Abrir Loja' }}
          </button>
        </div>
        <div class="card-body" style="border-top:1px solid var(--border);padding-top:1rem;">
          <strong><i-lucide-truck style="width:16px;height:16px" /> Modo de Entrega</strong>
          <p style="font-size:0.85rem;color:var(--text-muted);margin-top:4px;margin-bottom:0.85rem;">Escolha como as entregas dos pedidos são gerenciadas.</p>
          <div class="modo-entrega-radios">
            <label class="modo-radio" :class="{ active: !modoSemEntregador }">
              <input type="radio" name="modo_entrega" :checked="!modoSemEntregador" @change="setModoSemEntregador(false)" />
              <span class="radio-dot"></span>
              <div class="modo-radio-info">
                <strong>Com Entregador</strong>
                <span>Entregadores gerenciam o status de entrega (em trânsito, no destino).</span>
              </div>
            </label>
            <label class="modo-radio" :class="{ active: modoSemEntregador }">
              <input type="radio" name="modo_entrega" :checked="modoSemEntregador" @change="setModoSemEntregador(true)" />
              <span class="radio-dot"></span>
              <div class="modo-radio-info">
                <strong>Sem Entregador</strong>
                <span>O restaurante gerencia as entregas manualmente (pronto → entregue).</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      <!-- Retirada no Local + Horários de Funcionamento -->
      <div class="card">
        <div class="card-header">
          <i-lucide-store style="width:16px;height:16px" /> Retirada no Local
        </div>
        <div class="card-body">
          <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.85rem;">
            Permita que clientes retirem os pedidos pessoalmente no restaurante (frete zerado).
          </p>
          <div class="modo-entrega-radios" style="max-width:560px;">
            <label class="modo-radio" :class="{ active: retiradaHabilitada }">
              <input type="radio" name="retirada" :checked="retiradaHabilitada" @change="retiradaHabilitada = true" />
              <span class="radio-dot"></span>
              <div class="modo-radio-info">
                <strong>Habilitada</strong>
                <span>Clientes poderão escolher retirar no local no checkout.</span>
              </div>
            </label>
            <label class="modo-radio" :class="{ active: !retiradaHabilitada }">
              <input type="radio" name="retirada" :checked="!retiradaHabilitada" @change="retiradaHabilitada = false" />
              <span class="radio-dot"></span>
              <div class="modo-radio-info">
                <strong>Desabilitada</strong>
                <span>Somente entrega (delivery) disponível.</span>
              </div>
            </label>
          </div>
        </div>
      </div>

      <!-- Horários de Funcionamento por dia da semana -->
      <div class="card">
        <div class="card-header">
          <i-lucide-clock style="width:16px;height:16px" /> Horários de Funcionamento
        </div>
        <div class="card-body">
          <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem;">
            Defina os dias e horários em que a loja está aberta. Fora destes horários, novos pedidos são bloqueados.
          </p>
          <div class="horario-lista">
            <div v-for="(dia, i) in horariosFuncionamento" :key="i" class="horario-row">
              <span class="horario-dia">{{ diasSemana[i] }}</span>
              <label class="toggle" style="flex-shrink:0;">
                <input type="checkbox" v-model="dia.aberto" />
                <span class="slider"></span>
              </label>
              <template v-if="dia.aberto">
                <input v-model="dia.abre" type="time" class="horario-input" />
                <span style="color:var(--text-muted);">até</span>
                <input v-model="dia.fecha" type="time" class="horario-input" />
              </template>
              <span v-else class="horario-fechado">Fechado</span>
            </div>
          </div>
          <div class="form-group" style="margin-top:1rem;max-width:420px;">
            <label>Fuso Horário <span style="font-size:0.72rem;color:var(--text-muted);font-weight:400;">(os horários acima são neste fuso)</span></label>
            <select v-model="restaurante.timezone">
              <option v-for="tz in timezoneOptions" :key="tz.value" :value="tz.value">{{ tz.label }}</option>
            </select>
          </div>
          <div style="margin-top:1rem;display:flex;gap:8px;align-items:center;">
            <button class="btn btn-primary" @click="salvarRetiradaHorarios" :disabled="salvandoRetirada">
              {{ salvandoRetirada ? 'Salvando...' : 'Salvar Configurações' }}
            </button>
            <span v-if="retiradaMsg" class="retirada-msg" :class="retiradaMsg.tipo">{{ retiradaMsg.texto }}</span>
          </div>
        </div>
      </div>

      <!-- Logo Upload -->
      <div class="card">
        <div class="card-header">
          <i-lucide-image style="width:16px;height:16px" /> Logotipo
        </div>
        <div class="card-body" style="display:flex;align-items:center;gap:1.25rem;">
          <div style="width:72px;height:72px;border-radius:12px;background:var(--border-light);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
            <img v-if="logoPreview" :src="logoPreview" alt="Logo" style="width:100%;height:100%;object-fit:contain;" />
            <i-lucide-crown v-else style="width:32px;height:32px;color:var(--text-muted);" />
          </div>
          <div style="flex:1;">
            <p style="font-size:0.85rem;font-weight:600;margin-bottom:6px;">Logo do Restaurante</p>
            <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;">Substitui o ícone da coroa no menu lateral. PNG ou JPG, até 500KB.</p>
            <div style="display:flex;gap:8px;">
              <input type="file" accept="image/png,image/jpeg" @change="onLogoSelected" style="font-size:0.8rem;" />
              <button v-if="logoPreview" class="btn btn-sm btn-danger" @click="removerLogo">Remover</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Equipe (simplificado: link para aba) -->
      <div class="card">
        <div class="card-header">
          <i-lucide-users style="width:16px;height:16px" /> Equipe
          <span style="font-size:0.75rem;color:var(--text-muted);font-weight:400;">{{ equipe.length }} membro(s)</span>
        </div>
        <div class="card-body">
          <table class="data-table" v-if="equipe.length">
            <thead><tr><th>Nome</th><th>Usuário</th><th>Cargo</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="u in equipe" :key="u.id">
                <td>{{ u.nome }}</td>
                <td>{{ u.apelido || '—' }}</td>
                <td><span class="role-badge" :class="u.cargo">{{ u.cargo }}</span></td>
                <td>
                  <span class="status-dot" :class="u.ativo !== false ? 'active' : 'inactive'"></span>
                  {{ u.ativo !== false ? 'Ativo' : 'Inativo' }}
                </td>
              </tr>
            </tbody>
          </table>
          <button class="btn btn-secondary btn-sm" @click="activeTab = 'equipe'">Gerenciar Equipe</button>
        </div>
      </div>
    </div>

    <!-- ── Tab: Dados ── -->
    <div v-if="activeTab === 'dados'" style="display:grid;gap:1.5rem;max-width:800px;">
      <div class="card">
        <div class="card-header">
          <i-lucide-store style="width:16px;height:16px" /> Dados do Restaurante
        </div>
        <div class="card-body">
          <div class="form-group"><label>Nome Fantasia</label><input v-model="restaurante.nome" placeholder="Nome do restaurante" /></div>
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;">
            <div class="form-group" style="margin-bottom:0;">
              <label>CEP</label>
              <input v-model="restaurante.cep" maxlength="9" placeholder="00000-000" @input="formatCEP" />
            </div>
            <div style="display:flex;align-items:flex-end;">
              <button class="btn btn-secondary" style="width:100%;height:42px;" @click="buscarCEP" :disabled="buscandoCEP">
                {{ buscandoCEP ? 'Buscando...' : 'Buscar CEP' }}
              </button>
            </div>
          </div>
          <div class="form-group"><label>Endereço</label><input v-model="restaurante.endereco" placeholder="Rua, número..." /></div>
          <div class="form-row">
            <div class="form-group"><label>Cidade</label><input v-model="restaurante.cidade" /></div>
            <div class="form-group"><label>Estado</label><input v-model="restaurante.estado" maxlength="2" placeholder="SP" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Latitude</label><input v-model.number="restaurante.latitude" type="number" step="any" placeholder="-23.5505" /></div>
            <div class="form-group"><label>Longitude</label><input v-model.number="restaurante.longitude" type="number" step="any" placeholder="-46.6333" /></div>
          </div>
          <div class="form-group"><label>Tempo de Preparo (min)</label><input v-model.number="restaurante.tempo_preparo_min" type="number" min="5" /></div>
          <div v-if="cepMsg" class="cep-result" :class="cepMsg.tipo" style="margin-bottom:1rem;">
            <i-lucide-circle-check-big v-if="cepMsg.tipo === 'success'" style="width:16px;height:16px" />
            <i-lucide-circle-x v-else style="width:16px;height:16px" />
            {{ cepMsg.texto }}
          </div>
          <button class="btn btn-primary" @click="salvarRestaurante" :disabled="salvando">
            {{ salvando ? 'Salvando...' : 'Salvar Dados' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Tab: Aparência ── -->
    <div v-if="activeTab === 'aparencia'" style="display:grid;gap:1.5rem;max-width:900px;">
      <div class="card">
        <div class="card-header">
          <i-lucide-palette style="width:16px;height:16px" /> Cores do Tema
        </div>
        <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
          <!-- Color Pickers -->
          <div>
            <div class="form-group">
              <label>Cor Primária <span style="font-size:0.7rem;color:var(--text-muted);">(botões, destaque)</span></label>
              <div style="display:flex;gap:8px;align-items:center;">
                <input type="color" v-model="restaurante.cor_primaria" class="color-picker-input" />
                <input v-model="restaurante.cor_primaria" placeholder="#dc2626" maxlength="7" style="flex:1;font-family:monospace;" />
              </div>
            </div>
            <div class="form-group">
              <label>Cor Secundária <span style="font-size:0.7rem;color:var(--text-muted);">(ícones, acentos)</span></label>
              <div style="display:flex;gap:8px;align-items:center;">
                <input type="color" v-model="restaurante.cor_secundaria" class="color-picker-input" />
                <input v-model="restaurante.cor_secundaria" placeholder="#f97316" maxlength="7" style="flex:1;font-family:monospace;" />
              </div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label>Cor Terciária <span style="font-size:0.7rem;color:var(--text-muted);">(links, info)</span></label>
              <div style="display:flex;gap:8px;align-items:center;">
                <input type="color" v-model="restaurante.cor_terciaria" class="color-picker-input" />
                <input v-model="restaurante.cor_terciaria" placeholder="#3b82f6" maxlength="7" style="flex:1;font-family:monospace;" />
              </div>
            </div>
            <button class="btn btn-primary" style="margin-top:1rem;" @click="salvarRestaurante" :disabled="salvando">
              {{ salvando ? 'Salvando...' : 'Salvar Cores' }}
            </button>
          </div>
          <!-- Live Preview -->
          <div class="theme-preview-wrap" :style="themeVars">
            <div class="preview-label"><i-lucide-eye style="width:14px;height:14px" /> Preview ao Vivo</div>
            <div class="theme-preview-grid">
              <div class="preview-section">
                <div class="preview-label">Botões</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button class="preview-btn preview-btn-primary">Primário</button>
                  <button class="preview-btn preview-btn-secondary">Secundário</button>
                  <button class="preview-btn preview-btn-outline">Outline</button>
                </div>
              </div>
              <div class="preview-section">
                <div class="preview-label">Cartão</div>
                <div class="preview-card">
                  <div class="preview-card-header">
                    <span class="preview-card-badge">Destaque</span>
                    <span class="preview-card-price">R$ 39,90</span>
                  </div>
                  <div class="preview-card-body">
                    <strong>Produto Exemplo</strong>
                    <p>Descrição com as cores selecionadas</p>
                    <div class="preview-card-footer">
                      <span class="preview-card-tag">Categoria</span>
                      <button class="preview-btn preview-btn-primary preview-btn-sm">+</button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="preview-section">
                <div class="preview-label">Status</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <span class="preview-status pendente">Pendente</span>
                  <span class="preview-status preparando">Preparando</span>
                  <span class="preview-status entregue">Entregue</span>
                  <span class="preview-status cancelado">Cancelado</span>
                </div>
              </div>
              <div class="preview-section">
                <div class="preview-label">Input</div>
                <input type="text" class="preview-input" placeholder="Campo com foco..." />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Tab: Cardápio ── -->
    <div v-if="activeTab === 'cardapio'" style="display:grid;gap:1.5rem;max-width:800px;">
      <div class="card">
        <div class="card-header">
          <i-lucide-map-pin style="width:16px;height:16px" /> Matriz de Logística (Raios de Entrega)
        </div>
        <div class="card-body">
          <table class="data-table" v-if="raios.length">
            <thead><tr><th>Raio (KM)</th><th>Tempo Mín (min)</th><th>Tempo Máx (min)</th><th>Custo (R$)</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in raios" :key="i">
                <td>{{ r.raio_km }}</td><td>{{ r.tempo_min }}</td><td>{{ r.tempo_max }}</td><td>R$ {{ parseFloat(r.custo).toFixed(2) }}</td>
                <td><button class="btn btn-sm btn-danger" @click="excluirRaio(r.id)">×</button></td>
              </tr>
            </tbody>
          </table>
          <div v-else style="text-align:center;padding:1rem;color:var(--text-muted);font-size:0.9rem;">
            Nenhum raio de entrega cadastrado.
          </div>
          <div style="display:flex;gap:8px;margin-top:1rem;align-items:center;flex-wrap:wrap;">
            <input v-model.number="novoRaio.raio_km" type="number" placeholder="KM" style="width:70px;padding:6px;border:1.5px solid var(--border);border-radius:4px;" />
            <input v-model.number="novoRaio.tempo_min" type="number" placeholder="Min" style="width:70px;padding:6px;border:1.5px solid var(--border);border-radius:4px;" />
            <input v-model.number="novoRaio.tempo_max" type="number" placeholder="Máx" style="width:70px;padding:6px;border:1.5px solid var(--border);border-radius:4px;" />
            <input v-model.number="novoRaio.custo" type="number" step="0.01" placeholder="R$" style="width:80px;padding:6px;border:1.5px solid var(--border);border-radius:4px;" />
            <button class="btn btn-sm btn-primary" @click="adicionarRaio">+ Adicionar Raio</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Tab: Pagamentos ── -->
    <div v-if="activeTab === 'pagamentos'" style="display:grid;gap:1.5rem;max-width:800px;">
      <div class="card">
        <div class="card-header">
          <i-lucide-credit-card style="width:16px;height:16px" /> Formas de Pagamento Aceitas
        </div>
        <div class="card-body">
          <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem;">
            Selecione as formas de pagamento que o restaurante aceita.
          </p>
          <div class="payment-methods-grid">
            <label v-for="mp in allPaymentMethods" :key="mp.value"
              class="payment-method-card"
              :class="{ active: formaspagamento.includes(mp.value) }"
            >
              <input type="checkbox" :value="mp.value" :checked="formaspagamento.includes(mp.value)" @change="togglePaymentMethod(mp.value)" />
              <div class="pm-icon">{{ mp.icon }}</div>
              <div class="pm-info">
                <strong>{{ mp.label }}</strong>
                <span>{{ mp.desc }}</span>
              </div>
              <div class="pm-check" :class="{ checked: formaspagamento.includes(mp.value) }">
                <i-lucide-check style="width:16px;height:16px" />
              </div>
            </label>
          </div>
          <div style="margin-top:1rem;display:flex;gap:8px;">
            <button class="btn btn-primary" @click="salvarFormasPagamento" :disabled="salvandoPagamento">
              {{ salvandoPagamento ? 'Salvando...' : 'Salvar Configuração' }}
            </button>
            <button class="btn btn-secondary" @click="resetarFormasPagamento" :disabled="salvandoPagamento">
              Restaurar Padrão
            </button>
          </div>
          <div v-if="pagamentoMsg" class="cep-result" :class="pagamentoMsg.tipo" style="margin-top:0.75rem;">
            <i-lucide-circle-check-big v-if="pagamentoMsg.tipo === 'success'" style="width:16px;height:16px" />
            <i-lucide-circle-x v-else style="width:16px;height:16px" />
            {{ pagamentoMsg.texto }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── Tab: Salão ── -->
    <div v-if="activeTab === 'salao'" style="display:grid;gap:1.5rem;max-width:800px;">
      <div class="card">
        <div class="card-header">
          <i-lucide-table-2 style="width:16px;height:16px" /> Gerenciar Mesas
        </div>
        <div class="card-body">
          <table class="data-table" v-if="mesas.length">
            <thead><tr><th>Mesa</th><th>Capacidade</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-for="m in mesas" :key="m.id">
                <td><strong>{{ m.nome }}</strong></td>
                <td>{{ m.capacidade }} pessoas</td>
                <td><span class="mesa-config-status" :class="m.status">{{ mesaStatusLabel(m.status) }}</span></td>
                <td style="display:flex;gap:4px;justify-content:flex-end;">
                  <button class="btn btn-sm btn-secondary" @click="abrirMesaForm(m)">
                    <i-lucide-pencil style="width:14px;height:14px" />
                  </button>
                  <button class="btn btn-sm btn-danger" @click="excluirMesa(m.id)">
                    <i-lucide-trash-2 style="width:14px;height:14px" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else style="text-align:center;padding:1.5rem 0;color:var(--text-muted);font-size:0.9rem;">
            Nenhuma mesa cadastrada.
          </div>
          <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);">
            <h4 style="font-size:0.9rem;margin-bottom:0.75rem;">
              <i-lucide-pencil v-if="editandoMesaId" style="width:14px;height:14px" /><i-lucide-plus v-else style="width:14px;height:14px" /> {{ editandoMesaId ? 'Editar Mesa' : 'Nova Mesa' }}
            </h4>
            <div class="form-row">
              <div class="form-group">
                <label>Nome</label>
                <input v-model="mesaForm.nome" placeholder="Ex: Mesa 5" maxlength="50" />
              </div>
              <div class="form-group">
                <label>Capacidade</label>
                <input v-model.number="mesaForm.capacidade" type="number" min="1" max="20" />
              </div>
              <div class="form-group" v-if="editandoMesaId">
                <label>Status</label>
                <select v-model="mesaForm.status">
                  <option value="livre">Livre</option>
                  <option value="ocupada">Ocupada</option>
                  <option value="reservada">Reservada</option>
                  <option value="inativa">Inativa</option>
                </select>
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:0.5rem;">
              <button class="btn btn-primary btn-sm" @click="salvarMesa" :disabled="!mesaForm.nome.trim() || salvandoMesa">
                {{ salvandoMesa ? 'Salvando...' : editandoMesaId ? 'Salvar' : 'Criar Mesa' }}
              </button>
              <button v-if="editandoMesaId" class="btn btn-secondary btn-sm" @click="cancelarMesaForm">Cancelar</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Tab: Equipe ── -->
    <div v-if="activeTab === 'equipe'" style="display:grid;gap:1.5rem;max-width:800px;">
      <div class="card">
        <div class="card-header">
          <i-lucide-users style="width:16px;height:16px" /> Gestão de Equipe
        </div>
        <div class="card-body">
          <table class="data-table" v-if="equipe.length">
            <thead><tr><th>Nome</th><th>Usuário</th><th>Cargo</th><th>Status</th><th>Ações</th></tr></thead>
            <tbody>
              <tr v-for="u in equipe" :key="u.id">
                <td>{{ u.nome }}</td>
                <td>{{ u.apelido || '—' }}</td>
                <td><span class="role-badge" :class="u.cargo">{{ u.cargo }}</span></td>
                <td>
                  <span class="status-dot" :class="u.ativo !== false ? 'active' : 'inactive'"></span>
                  {{ u.ativo !== false ? 'Ativo' : 'Inativo' }}
                </td>
                <td>
                  <button class="btn btn-sm btn-secondary" @click="editarUsuario(u)" style="margin-right:4px;">
                    <i-lucide-pencil style="width:16px;height:16px" />
                  </button>
                  <button class="btn btn-sm btn-danger" @click="excluirUsuario(u.id)">
                    <i-lucide-trash-2 style="width:16px;height:16px" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);">
            <h4 style="font-size:0.9rem;margin-bottom:0.75rem;">Criar Novo Usuário</h4>
            <div class="form-row">
              <div class="form-group"><label>Nome</label><input v-model="novoUsuario.nome" /></div>
              <div class="form-group"><label>Usuário (apelido)</label><input v-model="novoUsuario.apelido" placeholder="ex: maria.cozinha" maxlength="50" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Senha</label><input v-model="novoUsuario.password" type="password" minlength="8" /></div>
              <div class="form-group"><label>Cargo</label>
                <select v-model="novoUsuario.cargo">
                  <option value="gerente">Gerente</option><option value="chef">Chef</option><option value="caixa">Caixa</option>
                </select>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" @click="criarUsuario">Criar Usuário</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Tab: Carrossel ── -->
    <div v-if="activeTab === 'carrossel'" style="display:grid;gap:1.5rem;max-width:800px;">
      <div class="card">
        <div class="card-header">
          <span><i-lucide-images style="width:16px;height:16px" /> Gerenciar Carrossel (Banners)</span>
          <button class="btn btn-sm btn-primary" @click="abrirBannerEditor(null)">
            <i-lucide-plus style="width:16px;height:16px" /> Novo Banner
          </button>
        </div>
        <div class="card-body">
          <div v-if="banners.length === 0" style="text-align:center;padding:2rem 0;color:var(--text-muted);">
            <i-lucide-images style="width:32px;height:32px;display:block;margin:0 auto 0.75rem;" />
            Nenhum banner cadastrado.
          </div>
          <div v-for="(banner, idx) in banners" :key="banner.id" class="banner-item">
            <div class="banner-preview"><img :src="bannerImgSrc(banner)" :alt="banner.titulo" /></div>
            <div class="banner-info">
              <strong>{{ banner.titulo || '(sem título)' }}</strong>
              <p>{{ banner.subtitulo || '(sem subtítulo)' }}</p>
              <span class="banner-ordem">Ordem: {{ banner.ordem }}</span>
              <span v-if="!banner.ativo" class="status-badge inativo">Inativo</span>
            </div>
            <div class="banner-actions">
              <button class="btn btn-sm btn-secondary" @click="moverBanner(idx, -1)" :disabled="idx === 0" title="Subir">
                <i-lucide-chevron-up style="width:16px;height:16px" />
              </button>
              <button class="btn btn-sm btn-secondary" @click="moverBanner(idx, 1)" :disabled="idx === banners.length - 1" title="Descer">
                <i-lucide-chevron-down style="width:16px;height:16px" />
              </button>
              <button class="btn btn-sm btn-secondary" @click="toggleBannerAtivo(banner)" :title="banner.ativo ? 'Desativar' : 'Ativar'">
                <i-lucide-eye-off v-if="banner.ativo" style="width:16px;height:16px" />
                <i-lucide-eye v-else style="width:16px;height:16px" />
              </button>
              <button class="btn btn-sm btn-secondary" @click="abrirBannerEditor(banner)">
                <i-lucide-pencil style="width:16px;height:16px" />
              </button>
              <button class="btn btn-sm btn-danger" @click="excluirBanner(banner)">
                <i-lucide-trash-2 style="width:16px;height:16px" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══════ MODALS ══════ -->

    <!-- Banner Editor Modal -->
    <div v-if="showBannerEditor" class="modal-backdrop" @click.self="showBannerEditor = false">
      <div class="modal-card">
        <div class="modal-header">
          <h3>{{ editandoBanner ? 'Editar Banner' : 'Novo Banner' }}</h3>
          <button class="drawer-close" @click="showBannerEditor = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Título</label>
            <input v-model="bannerForm.titulo" placeholder="Título do banner" maxlength="255" />
          </div>
          <div class="form-group">
            <label>Subtítulo</label>
            <input v-model="bannerForm.subtitulo" placeholder="Subtítulo ou chamada" maxlength="500" />
          </div>
          <div class="form-group">
            <label>Link (opcional)</label>
            <input v-model="bannerForm.link_url" placeholder="https://... ou /cardapio" />
          </div>
          <div class="form-group">
            <label>URL da Imagem (opcional)</label>
            <input v-model="bannerForm.imagem_url" placeholder="https://..." />
          </div>
          <div class="form-group">
            <label>Ou enviar imagem</label>
            <input type="file" accept="image/*" @change="onBannerImageSelected" />
            <div v-if="bannerForm.preview" class="banner-upload-preview"><img :src="bannerForm.preview" alt="Preview" /></div>
          </div>
          <div class="form-group">
            <label><input type="checkbox" v-model="bannerForm.ativo" /> Banner ativo</label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showBannerEditor = false">Cancelar</button>
          <button class="btn btn-primary" @click="salvarBanner" :disabled="salvandoBanner">
            {{ salvandoBanner ? 'Salvando...' : 'Salvar' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Edit User Modal -->
    <div v-if="editUserModal" class="modal-backdrop" @click.self="editUserModal = false">
      <div class="modal-card">
        <div class="modal-header">
          <h3>Editar Usuário</h3>
          <button class="drawer-close" @click="editUserModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group"><label>Nome</label><input v-model="editUserForm.nome" placeholder="Nome completo" /></div>
          <div class="form-group"><label>Usuário (apelido)</label><input v-model="editUserForm.apelido" placeholder="ex: maria.cozinha" maxlength="50" /></div>
          <div class="form-group">
            <label>Nova Senha <span style="color:var(--text-muted);font-size:0.8rem;">(deixe em branco para manter)</span></label>
            <input v-model="editUserForm.password" type="password" placeholder="Nova senha (mín. 8 caracteres)" minlength="8" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Cargo</label>
              <select v-model="editUserForm.cargo">
                <option value="gerente">Gerente</option><option value="chef">Chef</option><option value="caixa">Caixa</option>
              </select>
            </div>
            <div class="form-group">
              <label>Status</label>
              <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
                <label class="toggle"><input type="checkbox" v-model="editUserForm.ativo" /><span class="slider"></span></label>
                <span style="font-size:0.9rem;font-weight:600;" :style="{ color: editUserForm.ativo ? 'var(--success)' : 'var(--error)' }">
                  {{ editUserForm.ativo ? 'Ativo' : 'Inativo' }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="editUserModal = false">Cancelar</button>
          <button class="btn btn-primary" @click="salvarEdicaoUsuario" :disabled="salvandoEditUser">
            {{ salvandoEditUser ? 'Salvando...' : 'Salvar Alterações' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive, computed, markRaw } from 'vue'
import api from '../services/api'
import { Power, Store, Palette, MapPin, CreditCard, Table2, Users, Images } from 'lucide-vue-next'

// ── Tabs ──
const tabs = [
  { id: 'geral', label: 'Geral', icon: markRaw(Power) },
  { id: 'dados', label: 'Dados', icon: markRaw(Store) },
  { id: 'aparencia', label: 'Aparência', icon: markRaw(Palette) },
  { id: 'cardapio', label: 'Cardápio', icon: markRaw(MapPin) },
  { id: 'pagamentos', label: 'Pagamentos', icon: markRaw(CreditCard) },
  { id: 'salao', label: 'Salão', icon: markRaw(Table2) },
  { id: 'equipe', label: 'Equipe', icon: markRaw(Users) },
  { id: 'carrossel', label: 'Carrossel', icon: markRaw(Images) },
]
const activeTab = ref('geral')

// ── Formas de Pagamento ──
const allPaymentMethods = [
  { value: 'dinheiro', label: 'Dinheiro', icon: '💵', desc: 'Pagamento em espécie' },
  { value: 'credito', label: 'Cartão de Crédito', icon: '💳', desc: 'Cartão de crédito na entrega' },
  { value: 'debito', label: 'Cartão de Débito', icon: '🏦', desc: 'Cartão de débito na entrega' },
  { value: 'pix', label: 'PIX', icon: '📱', desc: 'PIX na entrega' },
  { value: 'pix_online', label: 'PIX Online', icon: '⚡', desc: 'QR Code gerado na hora' },
  { value: 'credito_online', label: 'Cartão Online', icon: '🌐', desc: 'Checkout transparente online' },
]

const storeOpen = ref(true)
const modoSemEntregador = ref(false)
const logoPreview = ref('')
const logoBase64 = ref('')
const restaurante = reactive({ nome: '', endereco: '', cep: '', cidade: '', estado: '', latitude: null, longitude: null, tempo_preparo_min: 20, timezone: 'America/Sao_Paulo', cor_primaria: '#dc2626', cor_secundaria: '#f97316', cor_terciaria: '#3b82f6' })
const raios = ref([])
const equipe = ref([])
const buscandoCEP = ref(false)
const salvando = ref(false)
const cepMsg = ref(null)
const novoRaio = reactive({ raio_km: '', tempo_min: '', tempo_max: '', custo: '' })
const novoUsuario = reactive({ nome: '', apelido: '', password: 'senha123', cargo: 'caixa' })

// ── Retirada + Horários ──
const retiradaHabilitada = ref(false)
const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
// Fusos mais comuns (IANA). Os horários de funcionamento são interpretados
// no fuso escolhido — salvo em restaurantes.timezone (migration 034).
const timezoneOptions = [
  { value: 'America/Sao_Paulo', label: '🇧🇷 São Paulo (UTC−3)' },
  { value: 'America/Noronha', label: '🇧🇷 Fernando de Noronha (UTC−2)' },
  { value: 'America/Belem', label: '🇧🇷 Belém (UTC−3)' },
  { value: 'America/Fortaleza', label: '🇧🇷 Fortaleza (UTC−3)' },
  { value: 'America/Recife', label: '🇧🇷 Recife (UTC−3)' },
  { value: 'America/Bahia', label: '🇧🇷 Salvador (UTC−3)' },
  { value: 'America/Manaus', label: '🇧🇷 Manaus (UTC−4)' },
  { value: 'America/Cuiaba', label: '🇧🇷 Cuiabá (UTC−4)' },
  { value: 'America/Porto_Velho', label: '🇧🇷 Porto Velho (UTC−4)' },
  { value: 'America/Boa_Vista', label: '🇧🇷 Boa Vista (UTC−4)' },
  { value: 'America/Rio_Branco', label: '🇧🇷 Rio Branco (UTC−5)' },
  { value: 'America/Buenos_Aires', label: '🇦🇷 Buenos Aires (UTC−3)' },
  { value: 'America/Montevideo', label: '🇺🇾 Montevidéu (UTC−3)' },
  { value: 'America/Asuncion', label: '🇵🇾 Assunção (UTC−3)' },
  { value: 'America/Santiago', label: '🇨🇱 Santiago (UTC−3/−4)' },
  { value: 'America/Bogota', label: '🇨🇴 Bogotá (UTC−5)' },
  { value: 'America/Lima', label: '🇵🇪 Lima (UTC−5)' },
  { value: 'America/Mexico_City', label: '🇲🇽 Cidade do México (UTC−6)' },
  { value: 'America/New_York', label: '🇺🇸 Nova York (UTC−4/−5)' },
  { value: 'Europe/Lisbon', label: '🇵🇹 Lisboa (UTC+0/+1)' },
  { value: 'Europe/London', label: '🇬🇧 Londres (UTC+0/+1)' },
  { value: 'Europe/Madrid', label: '🇪🇸 Madri (UTC+1/+2)' },
]
const horariosFuncionamento = ref(Array.from({ length: 7 }, () => ({ aberto: true, abre: '08:00', fecha: '23:00' })))
const salvandoRetirada = ref(false)
const retiradaMsg = ref(null)

// ── Mesa Management ──
const mesas = ref([])
const editandoMesaId = ref(null)
const salvandoMesa = ref(false)
const mesaForm = reactive({ nome: '', capacidade: 4, status: 'livre' })

// ── Payment Methods ──
const formaspagamento = ref(['dinheiro', 'credito', 'debito', 'pix', 'pix_online', 'credito_online'])
const salvandoPagamento = ref(false)
const pagamentoMsg = ref(null)

// ── Edit User ──
const editUserModal = ref(false)
const editUserForm = reactive({ id: null, nome: '', apelido: '', password: '', cargo: 'caixa', ativo: true })
const salvandoEditUser = ref(false)

// ── Banner ──
const banners = ref([])
const showBannerEditor = ref(false)
const editandoBanner = ref(null)
const salvandoBanner = ref(false)
const bannerForm = reactive({ titulo: '', subtitulo: '', link_url: '', imagem_url: '', imagem_base64: '', preview: '', ativo: true })

function mesaStatusLabel(s) {
  const labels = { livre: 'Livre', ocupada: 'Ocupada', reservada: 'Reservada', inativa: 'Inativa' }
  return labels[s] || s
}

function abrirMesaForm(mesa) {
  if (mesa) {
    editandoMesaId.value = mesa.id
    mesaForm.nome = mesa.nome
    mesaForm.capacidade = mesa.capacidade
    mesaForm.status = mesa.status
  } else {
    editandoMesaId.value = null
    mesaForm.nome = ''
    mesaForm.capacidade = 4
    mesaForm.status = 'livre'
  }
}

function cancelarMesaForm() {
  editandoMesaId.value = null
  mesaForm.nome = ''
  mesaForm.capacidade = 4
  mesaForm.status = 'livre'
}

async function salvarMesa() {
  salvandoMesa.value = true
  try {
    if (editandoMesaId.value) {
      await api.put(`/restaurante/mesas/${editandoMesaId.value}`, { nome: mesaForm.nome, capacidade: mesaForm.capacidade, status: mesaForm.status })
    } else {
      await api.post('/restaurante/mesas', { nome: mesaForm.nome, capacidade: mesaForm.capacidade })
    }
    cancelarMesaForm()
    await loadMesas()
  } catch (err) {
    alert(err.response?.data?.error || 'Erro ao salvar mesa')
  } finally { salvandoMesa.value = false }
}

async function excluirMesa(id) {
  if (!confirm('Excluir esta mesa permanentemente?')) return
  try {
    await api.delete(`/restaurante/mesas/${id}`)
    await loadMesas()
  } catch (err) {
    alert(err.response?.data?.error || 'Erro ao excluir mesa')
  }
}

async function loadMesas() {
  try {
    const { data } = await api.get('/restaurante/mesas')
    mesas.value = data
  } catch { /* ignore */ }
}

async function load() {
  const [r, rios, eq] = await Promise.all([
    api.get('/restaurante'),
    api.get('/restaurante/raios-entrega'),
    api.get('/restaurante/equipe'),
  ])
  Object.assign(restaurante, {
    nome: r.data.nome, endereco: r.data.endereco, cep: r.data.cep,
    cidade: r.data.cidade, estado: r.data.estado,
    latitude: r.data.latitude, longitude: r.data.longitude,
    tempo_preparo_min: r.data.tempo_preparo_min,
    timezone: r.data.timezone || 'America/Sao_Paulo',
    cor_primaria: r.data.cor_primaria || '#dc2626',
    cor_secundaria: r.data.cor_secundaria || '#f97316',
    cor_terciaria: r.data.cor_terciaria || '#3b82f6',
  })
  storeOpen.value = r.data.status_loja
  modoSemEntregador.value = r.data.modo_sem_entregador || false
  retiradaHabilitada.value = r.data.retirada_habilitada || false
  if (Array.isArray(r.data.horarios_funcionamento) && r.data.horarios_funcionamento.length === 7) {
    horariosFuncionamento.value = r.data.horarios_funcionamento.map(d => ({
      aberto: !!d.aberto,
      abre: d.abre || '08:00',
      fecha: d.fecha || '23:00',
    }))
  }
  formaspagamento.value = r.data.formas_pagamento_aceitas || ['dinheiro', 'credito', 'debito', 'pix', 'pix_online', 'credito_online']
  if (r.data.logo_base64) {
    logoPreview.value = 'data:image/png;base64,' + r.data.logo_base64
    logoBase64.value = r.data.logo_base64
  }
  raios.value = rios.data
  equipe.value = eq.data
}

async function setModoSemEntregador(valor) {
  if (modoSemEntregador.value === valor) return
  try {
    const { data } = await api.put('/restaurante', { modo_sem_entregador: valor })
    modoSemEntregador.value = data.modo_sem_entregador
  } catch (err) {
    alert(err.response?.data?.error || 'Erro ao alterar modo de entrega')
  }
}

function formatCEP() {
  restaurante.cep = restaurante.cep.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').substring(0, 9)
}

async function buscarCEP() {
  const cep = restaurante.cep.replace(/\D/g, '')
  if (cep.length !== 8) { cepMsg.value = { tipo: 'error', texto: 'CEP deve ter 8 dígitos.' }; return }
  buscandoCEP.value = true; cepMsg.value = null
  try {
    const { data } = await api.post('/cep', { cep })
    restaurante.endereco = data.logradouro || restaurante.endereco
    restaurante.cidade = data.cidade || restaurante.cidade
    restaurante.estado = data.estado || restaurante.estado
    if (data.latitude) restaurante.latitude = parseFloat(data.latitude)
    if (data.longitude) restaurante.longitude = parseFloat(data.longitude)
    cepMsg.value = { tipo: 'success', texto: `Endereço preenchido: ${data.logradouro || ''}, ${data.cidade || ''}/${data.estado || ''}` }
  } catch (err) {
    cepMsg.value = { tipo: 'error', texto: err.response?.data?.error || 'CEP não encontrado.' }
  } finally { buscandoCEP.value = false }
}

async function salvarRestaurante() {
  salvando.value = true; cepMsg.value = null
  const payload = { ...restaurante }
  if (logoBase64.value) payload.logo_base64 = logoBase64.value
  try {
    await api.put('/restaurante', payload)
    cepMsg.value = { tipo: 'success', texto: 'Dados salvos com sucesso!' }
  } catch (err) {
    cepMsg.value = { tipo: 'error', texto: err.response?.data?.error || 'Erro ao salvar.' }
  } finally { salvando.value = false }
}

async function toggleLoja() {
  const { data } = await api.post('/restaurante/toggle-loja')
  storeOpen.value = data.status_loja
}

function onLogoSelected(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (file.size > 500 * 1024) { alert('Logo deve ter no máximo 500KB.'); return }
  const reader = new FileReader()
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1]
    logoBase64.value = base64
    logoPreview.value = 'data:image/png;base64,' + base64
    try {
      await api.put('/restaurante', { logo_base64: base64 })
      cepMsg.value = { tipo: 'success', texto: 'Logo atualizado com sucesso!' }
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao salvar logo')
    }
  }
  reader.readAsDataURL(file)
}

async function removerLogo() {
  logoPreview.value = ''
  logoBase64.value = ''
  try {
    await api.put('/restaurante', { logo_base64: null })
  } catch { /* ignore */ }
}

async function adicionarRaio() {
  if (!novoRaio.raio_km || !novoRaio.tempo_min || !novoRaio.tempo_max || !novoRaio.custo) {
    cepMsg.value = { tipo: 'error', texto: 'Preencha todos os campos do raio.' }; return
  }
  try {
    await api.post('/restaurante/raios-entrega', {
      raio_km: Number(novoRaio.raio_km), tempo_min: Number(novoRaio.tempo_min),
      tempo_max: Number(novoRaio.tempo_max), custo: Number(novoRaio.custo),
    })
    Object.assign(novoRaio, { raio_km: '', tempo_min: '', tempo_max: '', custo: '' })
    const { data } = await api.get('/restaurante/raios-entrega')
    raios.value = data
    cepMsg.value = { tipo: 'success', texto: 'Raio de entrega adicionado!' }
  } catch (err) { cepMsg.value = { tipo: 'error', texto: err.response?.data?.error || 'Erro.' } }
}

async function excluirRaio(id) {
  await api.delete(`/restaurante/raios-entrega/${id}`)
  raios.value = raios.value.filter(r => r.id !== id)
}

function togglePaymentMethod(value) {
  const idx = formaspagamento.value.indexOf(value)
  if (idx >= 0) {
    if (formaspagamento.value.length <= 1) {
      pagamentoMsg.value = { tipo: 'error', texto: 'Pelo menos uma forma de pagamento deve estar ativa.' }; return
    }
    formaspagamento.value.splice(idx, 1)
  } else { formaspagamento.value.push(value) }
  pagamentoMsg.value = null
}

async function salvarFormasPagamento() {
  salvandoPagamento.value = true; pagamentoMsg.value = null
  try {
    await api.put('/restaurante', { formas_pagamento_aceitas: [...formaspagamento.value] })
    pagamentoMsg.value = { tipo: 'success', texto: 'Formas de pagamento atualizadas!' }
  } catch (err) { pagamentoMsg.value = { tipo: 'error', texto: err.response?.data?.error || 'Erro.' } }
  finally { salvandoPagamento.value = false }
}

async function resetarFormasPagamento() {
  formaspagamento.value = ['dinheiro', 'credito', 'debito', 'pix', 'pix_online', 'credito_online']
  await salvarFormasPagamento()
}

function editarUsuario(u) {
  editUserForm.id = u.id; editUserForm.nome = u.nome; editUserForm.apelido = u.apelido || ''
  editUserForm.password = ''; editUserForm.cargo = u.cargo; editUserForm.ativo = u.ativo !== false
  editUserModal.value = true
}

async function salvarEdicaoUsuario() {
  salvandoEditUser.value = true
  try {
    const payload = { nome: editUserForm.nome, apelido: editUserForm.apelido, cargo: editUserForm.cargo, ativo: editUserForm.ativo }
    if (editUserForm.password?.length >= 8) payload.password = editUserForm.password
    await api.put(`/restaurante/equipe/${editUserForm.id}`, payload)
    editUserModal.value = false
    const { data } = await api.get('/restaurante/equipe'); equipe.value = data
  } catch (err) { alert(err.response?.data?.error || 'Erro ao atualizar usuário.') }
  finally { salvandoEditUser.value = false }
}

async function criarUsuario() {
  if (!novoUsuario.nome || !novoUsuario.apelido) return
  await api.post('/restaurante/equipe', { ...novoUsuario })
  Object.assign(novoUsuario, { nome: '', apelido: '', password: 'senha123' })
  const { data } = await api.get('/restaurante/equipe'); equipe.value = data
}

async function excluirUsuario(id) {
  if (!confirm('Excluir este usuário?')) return
  await api.delete(`/restaurante/equipe/${id}`)
  equipe.value = equipe.value.filter(u => u.id !== id)
}

async function carregarBanners() {
  try { const { data } = await api.get('/restaurante/banners/admin'); banners.value = data } catch { /* ignore */ }
}

function bannerImgSrc(banner) {
  if (banner.imagem_base64) {
    const b64 = banner.imagem_base64
    if (b64.startsWith('/9j/')) return 'data:image/jpeg;base64,' + b64
    if (b64.startsWith('iVBORw0KGgo')) return 'data:image/png;base64,' + b64
    if (b64.startsWith('R0lGOD')) return 'data:image/gif;base64,' + b64
    if (b64.startsWith('UklGR')) return 'data:image/webp;base64,' + b64
    try { if (atob(b64.substring(0, 20)).startsWith('<svg')) return 'data:image/svg+xml;base64,' + b64 } catch {}
    return 'data:image/jpeg;base64,' + b64
  }
  return banner.imagem_url || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=400&q=60'
}

function abrirBannerEditor(banner) {
  editandoBanner.value = banner
  if (banner) {
    bannerForm.titulo = banner.titulo || ''; bannerForm.subtitulo = banner.subtitulo || ''
    bannerForm.link_url = banner.link_url || ''; bannerForm.imagem_url = banner.imagem_url || ''
    bannerForm.imagem_base64 = ''; bannerForm.preview = bannerImgSrc(banner); bannerForm.ativo = banner.ativo
  } else {
    Object.assign(bannerForm, { titulo: '', subtitulo: '', link_url: '', imagem_url: '', imagem_base64: '', preview: '', ativo: true })
  }
  showBannerEditor.value = true
}

function onBannerImageSelected(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) { alert('A imagem deve ter no máximo 2MB.'); return }
  const reader = new FileReader()
  reader.onload = (e) => {
    const base64 = e.target.result.split(',')[1]
    bannerForm.imagem_base64 = base64; bannerForm.preview = 'data:image/jpeg;base64,' + base64
    bannerForm.imagem_url = ''
  }
  reader.readAsDataURL(file)
}

async function salvarBanner() {
  salvandoBanner.value = true
  try {
    const payload = { titulo: bannerForm.titulo, subtitulo: bannerForm.subtitulo, link_url: bannerForm.link_url || null, ativo: bannerForm.ativo }
    if (bannerForm.imagem_base64) payload.imagem_base64 = bannerForm.imagem_base64
    else if (bannerForm.imagem_url) payload.imagem_url = bannerForm.imagem_url
    if (editandoBanner.value) { await api.put(`/restaurante/banners/${editandoBanner.value.id}`, payload) }
    else { await api.post('/restaurante/banners', payload) }
    showBannerEditor.value = false; await carregarBanners()
  } catch (err) { alert(err.response?.data?.error || 'Erro ao salvar banner.') }
  finally { salvandoBanner.value = false }
}

async function excluirBanner(banner) {
  if (!confirm(`Excluir banner "${banner.titulo || 'sem título'}"?`)) return
  try { await api.delete(`/restaurante/banners/${banner.id}`); await carregarBanners() } catch (err) { alert('Erro ao excluir banner.') }
}

async function toggleBannerAtivo(banner) {
  try { await api.put(`/restaurante/banners/${banner.id}`, { ativo: !banner.ativo }); await carregarBanners() } catch { alert('Erro ao alterar banner.') }
}

async function moverBanner(idx, direction) {
  const b = [...banners.value]; const target = idx + direction
  if (target < 0 || target >= b.length) return
  const temp = b[idx].ordem; b[idx].ordem = b[target].ordem; b[target].ordem = temp
  ;[b[idx], b[target]] = [b[target], b[idx]]
  try { await api.put('/restaurante/banners/reorder', { ordem: b.map((item, i) => ({ id: item.id, ordem: i })) }); await carregarBanners() } catch { await carregarBanners() }
}

// ── Theme Preview ──
const themeVars = computed(() => ({
  '--pc-primary': restaurante.cor_primaria || '#dc2626',
  '--pc-primary-dark': adjustColor(restaurante.cor_primaria || '#dc2626', -20),
  '--pc-primary-light': hexToRgba(restaurante.cor_primaria || '#dc2626', 0.12),
  '--pc-secondary': restaurante.cor_secundaria || '#f97316',
  '--pc-secondary-light': hexToRgba(restaurante.cor_secundaria || '#f97316', 0.12),
  '--pc-tertiary': restaurante.cor_terciaria || '#3b82f6',
  '--pc-tertiary-light': hexToRgba(restaurante.cor_terciaria || '#3b82f6', 0.12),
  '--pc-success': '#16a34a', '--pc-muted': '#94a3b8',
}))

function adjustColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xFF) + percent))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xFF) + percent))
  const b = Math.min(255, Math.max(0, (num & 0xFF) + percent))
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

function hexToRgba(hex, alpha) {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = (num >> 16) & 0xFF; const g = (num >> 8) & 0xFF; const b = num & 0xFF
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

async function salvarRetiradaHorarios() {
  salvandoRetirada.value = true
  retiradaMsg.value = null
  try {
    await api.put('/restaurante', {
      retirada_habilitada: retiradaHabilitada.value,
      timezone: restaurante.timezone || 'America/Sao_Paulo',
      horarios_funcionamento: horariosFuncionamento.value.map(d => ({
        aberto: !!d.aberto,
        abre: d.aberto ? d.abre || '08:00' : '',
        fecha: d.aberto ? d.fecha || '23:00' : '',
      })),
    })
    retiradaMsg.value = { tipo: 'success', texto: 'Configurações salvas com sucesso!' }
  } catch (err) {
    retiradaMsg.value = { tipo: 'error', texto: err.response?.data?.error || 'Erro ao salvar.' }
  } finally { salvandoRetirada.value = false }
}

onMounted(() => { load(); carregarBanners(); loadMesas() })
</script>

<style scoped>
/* ── Config Tabs ── */
.config-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 1.5rem;
  overflow-x: auto;
  padding-bottom: 4px;
}
.config-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0.55rem 1rem;
  border: none;
  background: transparent;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition);
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  white-space: nowrap;
  font-family: inherit;
}
.config-tab:hover {
  background: var(--border-light);
  color: var(--text-secondary);
}
.config-tab.active {
  background: var(--primary);
  color: white;
  box-shadow: 0 2px 8px rgba(220,38,38,0.25);
}

/* ── Cards ── */
.card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); border: 1px solid var(--border); transition: var(--transition); }
.card:hover { box-shadow: var(--shadow-md); }
.card-header { padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 0.95rem; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.card-body { padding: 1.25rem; }

/* ── Tables ── */
.data-table { width: 100%; border-collapse: separate; border-spacing: 0; }
.data-table th { text-align: left; padding: 0.75rem 0.75rem; font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid var(--border); background: var(--background); }
.data-table td { padding: 0.7rem 0.75rem; font-size: 0.85rem; border-bottom: 1px solid var(--border-light); }
.data-table tr:hover td { background: var(--border-light); }

/* ── Forms ── */
.form-group { margin-bottom: 1rem; }
.form-group label { display: block; font-size: 0.8rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--text-secondary); }
.form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.6rem 0.75rem; border: 1.5px solid var(--border); border-radius: var(--radius-xs); font-size: 0.9rem; outline: none; background: var(--surface); transition: var(--transition); }
.form-group input:focus, .form-group select:focus, .form-group textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(220,38,38,0.1); }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }

/* ── Buttons ── */
.btn { padding: 0.5rem 1rem; border-radius: var(--radius-xs); font-weight: 600; font-size: 0.85rem; border: none; cursor: pointer; transition: var(--transition); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-family: inherit; }
.btn-sm { padding: 0.35rem 0.65rem; font-size: 0.78rem; }
.btn-primary { background: var(--primary-gradient, linear-gradient(135deg, #dc2626, #f97316)); color: white; }
.btn-primary:hover { box-shadow: 0 4px 12px rgba(220,38,38,0.35); transform: translateY(-1px); }
.btn-success { background: var(--success, #16a34a); color: white; }
.btn-success:hover { background: #15803d; }
.btn-danger { background: var(--error, #ef4444); color: white; }
.btn-danger:hover { background: #dc2626; }
.btn-secondary { background: var(--border, #e2e8f0); color: var(--text, #0f172a); }
.btn-secondary:hover { background: #cbd5e1; }

/* ── Modo de Entrega (Radio) ── */
.modo-entrega-radios { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.modo-radio { position: relative; display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.85rem 1rem; border: 1.5px solid var(--border); border-radius: var(--radius-xs); cursor: pointer; transition: var(--transition); background: var(--surface); }
.modo-radio:hover { border-color: var(--primary); }
.modo-radio.active { border-color: var(--primary); background: rgba(220,38,38,0.05); box-shadow: 0 0 0 3px rgba(220,38,38,0.08); }
.modo-radio input { position: absolute; opacity: 0; }
.radio-dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--border); flex-shrink: 0; margin-top: 2px; transition: 0.2s; position: relative; }
.modo-radio.active .radio-dot { border-color: var(--primary); }
.modo-radio.active .radio-dot::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--primary); }
.modo-radio-info { display: flex; flex-direction: column; gap: 2px; }
.modo-radio-info strong { font-size: 0.85rem; }
.modo-radio-info span { font-size: 0.75rem; color: var(--text-muted); line-height: 1.35; }
@media (max-width: 520px) { .modo-entrega-radios { grid-template-columns: 1fr; } }

/* ── Horários de Funcionamento ── */
.horario-lista { display: grid; gap: 0.5rem; }
.horario-row { display: flex; align-items: center; gap: 0.85rem; padding: 0.55rem 0.75rem; border: 1px solid var(--border); border-radius: var(--radius-xs); background: var(--background); }
.horario-dia { width: 90px; font-weight: 600; font-size: 0.85rem; }
.horario-input { padding: 0.4rem 0.5rem; border: 1.5px solid var(--border); border-radius: var(--radius-xs); font-size: 0.85rem; outline: none; background: var(--surface); font-family: inherit; }
.horario-input:focus { border-color: var(--primary); }
.horario-fechado { color: var(--text-muted); font-size: 0.85rem; font-weight: 600; }
.retirada-msg { font-size: 0.8rem; font-weight: 600; }
.retirada-msg.success { color: var(--success, #16a34a); }
.retirada-msg.error { color: var(--error, #ef4444); }
@media (max-width: 520px) {
  .horario-row { flex-wrap: wrap; }
  .horario-dia { width: 100%; }
}

/* ── Toggle ── */
.toggle { position: relative; width: 44px; height: 24px; display: inline-block; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle .slider { position: absolute; inset: 0; background: #e2e8f0; border-radius: 999px; cursor: pointer; transition: 0.2s; }
.toggle .slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
.toggle input:checked + .slider { background: #16a34a; }
.toggle input:checked + .slider::before { transform: translateX(20px); }

/* ── Color Picker ── */
.color-picker-input { width: 40px; height: 40px; border: none; cursor: pointer; border-radius: 8px; padding: 0; }

/* ── Role Badge ── */
.role-badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; text-transform: capitalize; }
.role-badge.admin { background: #fee2e2; color: #991b1b; }
.role-badge.gerente { background: #dbeafe; color: #1e40af; }
.role-badge.chef { background: #fef3c7; color: #92400e; }
.role-badge.caixa { background: #dcfce7; color: #166534; }

/* ── Status Dot ── */
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.status-dot.active { background: #16a34a; }
.status-dot.inactive { background: #94a3b8; }

/* ── CEP Result ── */
.cep-result { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; border-radius: 8px; font-size: 0.85rem; }
.cep-result.success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
.cep-result.error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }

/* ── Mesa Config Status ── */
.mesa-config-status { display: inline-flex; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; }
.mesa-config-status.livre { background: #dcfce7; color: #166534; }
.mesa-config-status.ocupada { background: #fee2e2; color: #991b1b; }
.mesa-config-status.reservada { background: #fef3c7; color: #92400e; }
.mesa-config-status.inativa { background: #f1f5f9; color: #64748b; }

/* ── Theme Preview ── */
.theme-preview-wrap { padding: 1rem; border-radius: var(--radius); background: var(--surface); border: 2px solid var(--border); }
.theme-preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
@media (max-width: 600px) { .theme-preview-grid { grid-template-columns: 1fr; } }
.preview-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 0.6rem; }
.preview-section { padding: 0.65rem; border-radius: 8px; background: var(--background); border: 1px solid var(--border-light); }
.preview-btn { padding: 0.45rem 0.85rem; border-radius: 6px; font-size: 0.78rem; font-weight: 600; border: none; cursor: default; display: inline-flex; align-items: center; gap: 6px; }
.preview-btn-primary { background: var(--pc-primary); color: white; }
.preview-btn-secondary { background: var(--pc-secondary); color: white; }
.preview-btn-outline { background: transparent; color: var(--pc-primary); border: 2px solid var(--pc-primary); }
.preview-btn-sm { padding: 0.3rem 0.55rem; font-size: 0.72rem; border-radius: 999px; }
.preview-card { background: white; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
.preview-card-header { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background: var(--pc-primary-light); border-bottom: 1px solid var(--border-light); }
.preview-card-badge { font-size: 0.62rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--pc-primary); color: white; }
.preview-card-price { font-weight: 800; font-size: 0.82rem; color: var(--pc-primary); }
.preview-card-body { padding: 0.65rem; }
.preview-card-body strong { font-size: 0.82rem; display: block; margin-bottom: 2px; }
.preview-card-body p { font-size: 0.68rem; color: var(--text-secondary); margin-bottom: 0.4rem; }
.preview-card-footer { display: flex; justify-content: space-between; align-items: center; }
.preview-card-tag { font-size: 0.62rem; padding: 2px 8px; border-radius: 4px; background: var(--pc-secondary-light); color: var(--pc-secondary); font-weight: 600; }
.preview-status { display: inline-flex; padding: 2px 10px; border-radius: 999px; font-size: 0.68rem; font-weight: 700; }
.preview-status.pendente { background: #fef3c7; color: #92400e; }
.preview-status.preparando { background: var(--pc-tertiary-light); color: var(--pc-tertiary); }
.preview-status.entregue { background: #dcfce7; color: #166534; }
.preview-status.cancelado { background: var(--pc-primary-light); color: var(--pc-primary); }
.preview-input { width: 100%; padding: 0.5rem 0.65rem; border: 2px solid var(--border); border-radius: 6px; font-size: 0.82rem; outline: none; }
.preview-input:focus { border-color: var(--pc-primary); box-shadow: 0 0 0 3px var(--pc-primary-light); }

/* ── Banner ── */
.banner-item { display: flex; align-items: center; gap: 1rem; padding: 0.85rem; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 0.75rem; background: var(--surface); }
.banner-preview { width: 90px; height: 54px; border-radius: 6px; overflow: hidden; flex-shrink: 0; background: var(--background); }
.banner-preview img { width: 100%; height: 100%; object-fit: cover; }
.banner-info { flex: 1; min-width: 0; }
.banner-info strong { display: block; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.banner-info p { font-size: 0.78rem; color: var(--text-muted); margin: 2px 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.banner-ordem { font-size: 0.72rem; color: var(--text-muted); margin-right: 0.5rem; }
.banner-actions { display: flex; gap: 4px; flex-shrink: 0; }
.banner-upload-preview { margin-top: 0.5rem; border-radius: 6px; overflow: hidden; max-width: 200px; }
.banner-upload-preview img { width: 100%; height: auto; display: block; }
.status-badge.inativo { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-size: 0.68rem; font-weight: 700; background: #fee2e2; color: #991b1b; }

/* ── Payment Methods ── */
.payment-methods-grid { display: grid; gap: 0.65rem; }
.payment-method-card { display: flex; align-items: center; gap: 0.85rem; padding: 0.85rem; border: 2px solid var(--border); border-radius: 10px; cursor: pointer; transition: all 0.2s; background: var(--surface); user-select: none; }
.payment-method-card:hover { border-color: rgba(220,38,38,0.3); }
.payment-method-card.active { border-color: var(--primary, #dc2626); background: #fef2f2; }
.payment-method-card input[type="checkbox"] { display: none; }
.pm-icon { font-size: 1.35rem; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; background: var(--background); border-radius: 8px; flex-shrink: 0; }
.payment-method-card.active .pm-icon { background: #fee2e2; }
.pm-info { flex: 1; min-width: 0; }
.pm-info strong { display: block; font-size: 0.85rem; }
.pm-info span { font-size: 0.75rem; color: var(--text-muted); }
.pm-check { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.2s; }
.pm-check.checked { background: var(--primary, #dc2626); border-color: var(--primary, #dc2626); }
.pm-check svg { color: white; }
.pm-check:not(.checked) svg { opacity: 0; }
.pm-check.checked svg { opacity: 1; }

/* ── Modal ── */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1rem; }
.modal-card { background: white; border-radius: 12px; max-width: 500px; width: 100%; max-height: 90vh; overflow-y: auto; }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border-bottom: 1px solid var(--border); }
.modal-header h3 { font-size: 1.05rem; }
.modal-body { padding: 1.25rem; }
.modal-footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 1rem 1.5rem; border-top: 1px solid var(--border); }
.drawer-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary); padding: 0; line-height: 1; }
</style>
