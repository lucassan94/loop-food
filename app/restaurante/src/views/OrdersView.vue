<template>
  <div>
    <!-- Feedback Toast -->
    <div v-if="feedbackMsg" class="feedback-toast" :class="feedbackMsg.tipo" @click="feedbackMsg = null">
      <i-lucide-circle-check-big v-if="feedbackMsg.tipo === 'success'" style="width:20px;height:20px" />
      <i-lucide-triangle-alert v-else style="width:20px;height:20px" />
      {{ feedbackMsg.texto }}
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <!-- Filtro de status: mesmo visual dos demais filtros (pílulas) -->
      <div class="status-radio-group">
        <label class="status-radio" :class="{ active: filtroStatus === 'ativos' }">
          <input type="radio" name="statusFiltro" value="ativos" v-model="filtroStatus" @change="aoMudarStatusFiltro" />
          <span>Ativos</span>
        </label>
        <label class="status-radio" :class="{ active: filtroStatus === 'concluidos' }">
          <input type="radio" name="statusFiltro" value="concluidos" v-model="filtroStatus" @change="aoMudarStatusFiltro" />
          <span>Concluídos</span>
        </label>
        <label class="status-radio" :class="{ active: filtroStatus === 'cancelados' }">
          <input type="radio" name="statusFiltro" value="cancelados" v-model="filtroStatus" @change="aoMudarStatusFiltro" />
          <span>Cancelados</span>
        </label>
        <label class="status-radio" :class="{ active: filtroStatus === '' }">
          <input type="radio" name="statusFiltro" value="" v-model="filtroStatus" @change="aoMudarStatusFiltro" />
          <span>Todos</span>
        </label>
      </div>

      <!-- Origem Filter -->
      <div class="origem-radio-group">
        <label class="origem-radio" :class="{ active: filtroOrigem === 'todos' }">
          <input type="radio" name="origemFiltro" value="todos" v-model="filtroOrigem" @change="loadOrders" />
          <span>Todos</span>
        </label>
        <label class="origem-radio" :class="{ active: filtroOrigem === 'salao' }">
          <input type="radio" name="origemFiltro" value="salao" v-model="filtroOrigem" @change="loadOrders" />
          <i-lucide-store style="width:14px;height:14px" />
          <span>Salão</span>
        </label>
        <label class="origem-radio" :class="{ active: filtroOrigem === 'delivery' }">
          <input type="radio" name="origemFiltro" value="delivery" v-model="filtroOrigem" @change="loadOrders" />
          <i-lucide-truck style="width:14px;height:14px" />
          <span>Delivery</span>
        </label>
        <label class="origem-radio" :class="{ active: filtroOrigem === 'retirada' }">
          <input type="radio" name="origemFiltro" value="retirada" v-model="filtroOrigem" @change="loadOrders" />
          <i-lucide-store style="width:14px;height:14px" />
          <span>Retirada</span>
        </label>
        <label class="origem-radio" :class="{ active: filtroOrigem === 'ifood' }">
          <input type="radio" name="origemFiltro" value="ifood" v-model="filtroOrigem" @change="loadOrders" />
          <i-lucide-utensils style="width:14px;height:14px" />
          <span>iFood</span>
        </label>
      </div>

      <div class="date-radio-group">
        <label class="date-radio" :class="{ active: filtroDataPeriodo === 'hoje' }">
          <input type="radio" name="dataFiltro" value="hoje" v-model="filtroDataPeriodo" @change="aplicarFiltroData()" />
          <span>Hoje</span>
        </label>
        <label class="date-radio" :class="{ active: filtroDataPeriodo === 'ontem' }">
          <input type="radio" name="dataFiltro" value="ontem" v-model="filtroDataPeriodo" @change="aplicarFiltroData()" />
          <span>Ontem</span>
        </label>
        <label class="date-radio" :class="{ active: filtroDataPeriodo === '7dias' }">
          <input type="radio" name="dataFiltro" value="7dias" v-model="filtroDataPeriodo" @change="aplicarFiltroData()" />
          <span>7 dias</span>
        </label>
        <label class="date-radio" :class="{ active: filtroDataPeriodo === '' }">
          <input type="radio" name="dataFiltro" value="" v-model="filtroDataPeriodo" @change="aplicarFiltroData()" />
          <span>Todos</span>
        </label>
      </div>
      <div v-if="filtroMesa.value" class="mesa-filter-badge">
        <i-lucide-table-2 style="width:14px;height:14px" /> Mesa: <strong>{{ filtroMesa.value }}</strong>
        <button class="btn-clear-filter" @click="limparFiltroMesa" title="Remover filtro de mesa">✕</button>
      </div>
      <button class="btn btn-secondary btn-sm" @click="limparFiltros">Limpar</button>
    </div>

    <div v-if="resumo" class="stats-grid">
  <div class="stat-card"><div class="label">Pedidos Entregues (hoje)</div><div class="value success">{{ resumo?.pedidos_entregues || 0 }}</div></div>
  <div class="stat-card"><div class="label">Faturamento (hoje)</div><div class="value primary">{{ formatPrice(resumo?.faturamento_estimado || 0) }}</div></div>
  <div class="stat-card"><div class="label">Ativos na Fila</div><div class="value info">{{ resumo?.pedidos_ativos || 0 }}</div></div>
</div>    <!-- View Mode Tabs -->
    <div class="tabs">
      <button class="tab" :class="{ active: viewMode === 'cards' }" @click="viewMode = 'cards'">Cartões</button>
      <button class="tab" :class="{ active: viewMode === 'lista' }" @click="viewMode = 'lista'">Lista</button>
      <button class="chat-toggle-btn" @click="abrirChatDrawer()">
        <i-lucide-message-circle style="width:16px;height:16px" />
        Mensagens
        <span v-if="chatTotalNaoLidas" class="chat-toggle-badge">{{ chatTotalNaoLidas }}</span>
      </button>
    </div>

    <!-- Cards View (formato anterior) -->
    <div v-if="viewMode === 'cards'">
      <div v-for="order in filteredOrders" :key="order.id" class="order-card" :class="order.status">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <strong>{{ order.pedido_id }}</strong>
            <span class="origem-badge" :class="order.origem || 'delivery'">
              <i-lucide-store v-if="order.origem === 'salao'" style="width:12px;height:12px" />
              <i-lucide-store v-else-if="order.origem === 'retirada'" style="width:12px;height:12px" />
              <i-lucide-utensils v-else-if="order.origem === 'ifood'" style="width:12px;height:12px" />
              <i-lucide-truck v-else style="width:12px;height:12px" />
              {{ order.origem === 'salao' ? 'Salão' : (order.origem === 'retirada' ? 'Retirada' : (order.origem === 'ifood' ? 'iFood' : 'Delivery')) }}
            </span>
            — {{ order.nome_cliente }}
            <div style="font-size:0.8rem;color:var(--text-muted);">{{ formatDate(order.criado_em) }}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
            <span v-if="order.mesa" class="mesa-badge">Mesa {{ order.mesa }}</span>
            <span class="status-badge" :class="order.status">{{ statusLabel(order.status) }}</span>
            <!-- Badge de refund (restaurante) -->
            <div v-if="(order.status === 'cancelado' || order.status === 'recusado') && isOnlinePayment(order.metodo_pagamento)"
                 class="refund-status" :class="refundClass(order.id)" style="margin-top:4px;">
              <i-lucide-clock v-if="refundIcon(order.id) === 'clock'" style="width:16px;height:16px" />
              <i-lucide-circle-check-big v-else-if="refundIcon(order.id) === 'check-circle'" style="width:16px;height:16px" />
              <i-lucide-circle-x v-else-if="refundIcon(order.id) === 'x-circle'" style="width:16px;height:16px" />
              <i-lucide-loader v-else class="spinning" style="width:16px;height:16px" />
              {{ refundLabel(order.id) }}
            </div>
          </div>
        </div>

        <div v-if="order.entregador_nome" style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">
          <i-lucide-bike style="width:14px;height:14px;vertical-align:middle;" /> {{ order.entregador_nome }}
        </div>

        <!-- Timer: mesmo countdown/previsão que o cliente vê (TrackingView) -->
        <div v-if="isActiveOrder(order.status)" style="margin-top:8px;font-size:0.85rem;">
          <span :style="{ color: timers[order.id]?.cor }" :title="`Prazo estimado: ${timers[order.id]?.previsao}`">
            <i-lucide-clock style="width:14px;height:14px" />
            {{ timers[order.id]?.texto }} · prev. {{ timers[order.id]?.previsao }}
          </span>
        </div>

        <div style="font-size:0.85rem;margin-top:8px;">
          <strong>{{ order.itens?.length }} item(ns)</strong> — {{ formatPrice(order.total) }}
          <br />{{ paymentLabel(order.metodo_pagamento) }}
        </div>

        <div v-if="order.observacoes" class="order-obs-badge">
          <i-lucide-pen-line style="width:14px;height:14px" /> {{ order.observacoes }}
        </div>

        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">
          <!-- Aguardando Pagamento: a confirmação é automática (webhook + polling de 15s) -->
          <template v-if="order.status === 'aguardando_pagamento'">
            <span style="font-size:0.85rem;color:var(--text-muted);">⏳ Aguardando confirmação do pagamento...</span>
          </template>

          <!-- Pendente: Aceitar (admin/gerente/chef), Recusar (admin/gerente) -->
          <template v-if="order.status === 'pendente'">
            <button v-if="podeAceitar" class="btn btn-success btn-sm" @click="changeStatus(order.id, 'preparando')">Aceitar</button>
            <button v-if="podeRecusar" class="btn btn-danger btn-sm" @click="abrirModalCancelamento(order, 'recusado')">Recusar</button>
          </template>

          <!-- Preparando: Pronto (admin/gerente/chef) -->
          <template v-if="order.status === 'preparando'">
            <button v-if="order.origem === 'salao' && podeMarcarPronto" class="btn btn-primary btn-sm" @click="changeStatus(order.id, 'pronto')"><i-lucide-circle-check-big style="width:14px;height:14px" /> Pronto para Servir</button>
            <button v-else-if="podeMarcarPronto" class="btn btn-primary btn-sm" @click="changeStatus(order.id, 'pronto_entrega')"><i-lucide-circle-check-big style="width:14px;height:14px" /> {{ order.origem === 'retirada' ? 'Pronto para Retirada' : 'Pronto para Entrega' }}</button>
          </template>

          <!-- Pronto (Salão) - Finalizar Conta -->
          <template v-if="order.status === 'pronto'">
            <button v-if="podeMarcarPronto || isCaixa" class="btn btn-warning btn-sm" @click="changeStatus(order.id, 'finalizado')">
              <i-lucide-wallet style="width:14px;height:14px" />
              Finalizar Conta
            </button>
          </template>

          <!-- Pronto para entrega / Retirada pronta -->
          <template v-if="order.status === 'pronto_entrega'">
            <template v-if="order.origem === 'retirada'">
              <button v-if="podeDarBaixaRetirada" class="btn btn-success btn-sm" @click="changeStatus(order.id, 'entregue')"><i-lucide-circle-check-big style="width:14px;height:14px" /> Dar Baixa na Retirada</button>
            </template>
            <template v-else-if="modoSemEntregador">
              <button v-if="podeMarcarPronto" class="btn btn-success btn-sm" @click="changeStatus(order.id, 'entregue')"><i-lucide-circle-check-big style="width:14px;height:14px" /> Confirmar Entrega</button>
            </template>
            <template v-else>
              <span style="font-size:0.85rem;color:var(--text-muted);">Aguardando Entregador...</span>
            </template>
          </template>

          <!-- Em trânsito / Chegou destino -->
          <template v-if="order.status === 'em_transito'">
            <span style="font-size:0.85rem;">Pedido em Rota de Entrega</span>
          </template>
          <template v-if="order.status === 'cheguei_destino'">
            <span style="font-size:0.85rem;color:var(--primary);">Entregador no Local</span>
          </template>

          <!-- Entregue / Finalizado -->
          <template v-if="order.status === 'entregue'">
            <span style="font-size:0.85rem;color:var(--success);">✓ Entrega Concluída</span>
          </template>
          <template v-if="order.status === 'finalizado'">
            <span style="font-size:0.85rem;color:var(--success);">✓ Conta Finalizada</span>
          </template>

          <!-- Cancelado / Recusado -->
          <template v-if="order.status === 'cancelado' || order.status === 'recusado'">
            <span style="font-size:0.85rem;color:var(--error);"><i-lucide-x style="width:14px;height:14px" /> {{ order.motivo_cancelamento || 'Sem motivo' }}</span>
          </template>

          <button class="btn btn-secondary btn-sm" @click="abrirDetalhes(order)">Detalhes</button>
          <button v-if="podeAbrirChat && !['entregue','finalizado','cancelado','recusado'].includes(order.status)" class="btn btn-secondary btn-sm" @click="abrirChatDoPedido(order)"><i-lucide-message-square style="width:14px;height:14px" /> Mensagem</button>
          <!-- Cancelar disponível durante toda jornada do pedido (antes de entregue/cancelado) -->
          <button v-if="podeCancelar && isActiveOrder(order.status) && order.status !== 'aguardando_pagamento'" class="btn btn-danger btn-sm" @click="abrirModalCancelamento(order, 'cancelado')">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- List View -->
    <div v-if="viewMode === 'lista'" class="card">
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th><th>Origem</th><th>Mesa</th><th>Cliente</th><th>Status</th><th>Data/Hora</th><th>Itens</th><th>Total</th><th>Tempo</th><th>Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in filteredOrders" :key="order.id">
            <td><strong>{{ order.pedido_id }}</strong></td>
            <td>
              <span class="origem-badge" :class="order.origem || 'delivery'" style="font-size:0.7rem;">
                {{ order.origem === 'salao' ? 'Salão' : (order.origem === 'retirada' ? 'Retirada' : (order.origem === 'ifood' ? 'iFood' : 'Delivery')) }}
              </span>
            </td>
            <td><span v-if="order.mesa" class="mesa-badge">{{ order.mesa }}</span></td>
            <td>{{ order.nome_cliente }}</td>
            <td>
              <span class="status-badge" :class="order.status">{{ statusLabel(order.status) }}</span>
              <!-- Badge de refund (Lista) -->
              <div v-if="(order.status === 'cancelado' || order.status === 'recusado') && isOnlinePayment(order.metodo_pagamento)"
                   class="refund-status" :class="refundClass(order.id)" style="margin-top:4px;font-size:0.7rem;">
                <i-lucide-clock v-if="refundIcon(order.id) === 'clock'" style="width:16px;height:16px" />
            <i-lucide-circle-check-big v-else-if="refundIcon(order.id) === 'check-circle'" style="width:16px;height:16px" />
            <i-lucide-circle-x v-else-if="refundIcon(order.id) === 'x-circle'" style="width:16px;height:16px" />
            <i-lucide-loader v-else class="spinning" style="width:16px;height:16px" />
                {{ refundLabel(order.id) }}
              </div>
            </td>
            <td style="white-space:nowrap;font-size:0.85rem;">{{ formatDate(order.criado_em) }}</td>
            <td>{{ order.itens?.length }}</td>
            <td><strong>{{ formatPrice(order.total) }}</strong></td>
            <td>{{ isActiveOrder(order.status) ? (timers[order.id]?.texto || '—') : '—' }}</td>
            <td>
              <button class="btn btn-sm btn-primary" @click="abrirDetalhes(order)">Ver</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Painel lateral de detalhes (estilo iFood) -->
    <transition name="chat-fade">
      <div v-if="selectedOrder" class="detail-overlay" @click="selectedOrder = null"></div>
    </transition>
    <transition name="chat-slide">
      <aside v-if="selectedOrder" class="detail-drawer">
        <header class="detail-header">
          <div class="detail-header-left">
            <h3>{{ selectedOrder.pedido_id }}</h3>
            <span class="status-badge" :class="selectedOrder.status">{{ statusLabel(selectedOrder.status) }}</span>
          </div>
          <button class="chat-close" @click="selectedOrder = null" title="Fechar">✕</button>
        </header>

        <div class="detail-scroll">
          <!-- Meta -->
          <div class="detail-meta">
            <span>Feito às <b>{{ horaFeito(selectedOrder) }}</b></span>
            <span class="detail-dot">•</span>
            <span class="origem-badge" :class="selectedOrder.origem || 'delivery'">
              {{ origemIcon(selectedOrder) }} {{ origemLabel(selectedOrder) }}
            </span>
            <span v-if="selectedOrder.mesa" class="mesa-badge">Mesa {{ selectedOrder.mesa }}</span>
          </div>

          <!-- Previsão + tempo decorrido -->
          <div class="detail-previsao">
            <i-lucide-clock style="width:16px;height:16px" />
            Entrega prevista: <b>{{ timers[selectedOrder.id]?.previsao || '—' }}</b>
            <span v-if="elapsedMap[selectedOrder.id]" class="detail-countdown" :style="{ color: elapsedMap[selectedOrder.id].cor }">
              {{ elapsedMap[selectedOrder.id].texto }}
            </span>
          </div>

          <div class="detail-status" :style="{ color: statusCor(selectedOrder) }">
            <strong>{{ statusLabel(selectedOrder.status) }}</strong>
            <span v-if="selectedOrder.status === 'pendente'"> · 5 minutos para aceitar o pedido</span>
            <span v-if="selectedOrder.status === 'aguardando_pagamento'"> · Aguardando confirmação do pagamento</span>
          </div>

          <!-- Cliente -->
          <div class="profile-section">
            <div class="profile-section-title">Cliente</div>
            <div class="detail-cliente">
              <strong>{{ selectedOrder.nome_cliente }}</strong>
              <span v-if="selectedOrder.telefone_cliente">
                <i-lucide-phone style="width:13px;height:13px" />
                <a :href="`tel:${selectedOrder.telefone_cliente}`">{{ selectedOrder.telefone_cliente }}</a>
              </span>
              <span v-if="selectedOrder.origem === 'retirada'" class="detail-retirada">🏪 Retirada no local</span>
              <span v-else-if="selectedOrder.origem !== 'salao'" class="detail-endereco">
                <i-lucide-map-pin style="width:13px;height:13px" />
                {{ selectedOrder.endereco_cliente }}, {{ selectedOrder.numero_cliente }} — {{ selectedOrder.bairro_cliente }}
              </span>
            </div>
          </div>

          <!-- Itens -->
          <div class="profile-section">
            <div class="profile-section-title">Itens no pedido</div>
            <div v-for="item in selectedOrder.itens" :key="item.id" class="detail-item">
              <div class="detail-item-row">
                <div class="ifood-item-thumb">{{ item.quantidade }}</div>
                <div class="detail-item-main">
                  <span class="detail-item-nome">{{ item.nome_produto }}</span>
                  <span class="detail-item-preco">{{ formatPrice(item.subtotal) }}</span>
                </div>
              </div>
              <div v-if="item.extras?.length" class="detail-item-extra">
                + {{ item.extras.map(e => e.nome + (e.qty > 1 ? ` (${e.qty})` : '')).join(', ') }}
              </div>
              <div v-if="item.opcoes?.length" class="detail-item-extra">
                {{ item.opcoes.map(o => `${o.grupo}: ${o.nome}`).join(' • ') }}
              </div>
              <div v-if="item.talheres != null" class="detail-item-extra">🍴 {{ item.talheres ? 'Com talheres' : 'Sem talheres' }}</div>
              <div v-if="item.observacao" class="detail-item-obs">📝 {{ item.observacao }}</div>
            </div>
          </div>

          <!-- Resumo -->
          <div class="order-summary">
            <div class="order-summary-row"><span>Subtotal</span><span>{{ formatPrice(selectedOrder.subtotal) }}</span></div>
            <div class="order-summary-row"><span>Taxa de entrega</span><span>{{ formatPrice(selectedOrder.valor_frete) }}</span></div>
            <div class="order-summary-total"><span>Total</span><span>{{ formatPrice(selectedOrder.total) }}</span></div>
            <div class="order-summary-row"><span>Pagamento</span><span>{{ paymentLabel(selectedOrder.metodo_pagamento) }}</span></div>
          </div>

          <!-- Observações -->
          <div v-if="selectedOrder.observacoes" class="order-obs-badge">
            <i-lucide-pen-line style="width:14px;height:14px" /> {{ selectedOrder.observacoes }}
          </div>

          <!-- Refund -->
          <div v-if="(selectedOrder.status === 'cancelado' || selectedOrder.status === 'recusado') && isOnlinePayment(selectedOrder.metodo_pagamento)"
               class="refund-status" :class="refundClass(selectedOrder.id)">
            <i-lucide-clock v-if="refundIcon(selectedOrder.id) === 'clock'" style="width:16px;height:16px" />
            <i-lucide-circle-check-big v-else-if="refundIcon(selectedOrder.id) === 'check-circle'" style="width:16px;height:16px" />
            <i-lucide-circle-x v-else-if="refundIcon(selectedOrder.id) === 'x-circle'" style="width:16px;height:16px" />
            <i-lucide-loader v-else class="spinning" style="width:16px;height:16px" />
            {{ refundLabel(selectedOrder.id) }}
          </div>

          <!-- Ações -->
          <div class="detail-actions">
            <template v-if="selectedOrder.status === 'pendente'">
              <button v-if="podeAceitar" class="btn btn-success" @click="changeStatus(selectedOrder.id, 'preparando')">Aceitar</button>
              <button v-if="podeRecusar" class="btn btn-danger" @click="abrirModalCancelamento(selectedOrder, 'recusado')">Recusar</button>
            </template>
            <template v-if="selectedOrder.status === 'preparando'">
              <button v-if="podeMarcarPronto" class="btn btn-primary" @click="changeStatus(selectedOrder.id, selectedOrder.origem === 'salao' ? 'pronto' : 'pronto_entrega')">
                <i-lucide-circle-check-big style="width:16px;height:16px" />
                {{ selectedOrder.origem === 'salao' ? 'Pronto para Servir' : (selectedOrder.origem === 'retirada' ? 'Pronto para Retirada' : 'Pronto para Entrega') }}
              </button>
            </template>
            <template v-if="selectedOrder.status === 'pronto'">
              <button v-if="podeMarcarPronto || isCaixa" class="btn btn-warning" @click="changeStatus(selectedOrder.id, 'finalizado')">
                <i-lucide-wallet style="width:16px;height:16px" /> Finalizar Conta
              </button>
            </template>
            <template v-if="selectedOrder.status === 'pronto_entrega' && selectedOrder.origem === 'retirada'">
              <button v-if="podeDarBaixaRetirada" class="btn btn-success" @click="changeStatus(selectedOrder.id, 'entregue')">
                <i-lucide-circle-check-big style="width:16px;height:16px" /> Dar Baixa na Retirada
              </button>
            </template>
            <template v-else-if="selectedOrder.status === 'pronto_entrega' && modoSemEntregador">
              <button v-if="podeMarcarPronto" class="btn btn-success" @click="changeStatus(selectedOrder.id, 'entregue')">
                <i-lucide-circle-check-big style="width:16px;height:16px" /> Confirmar Entrega
              </button>
            </template>
            <button v-if="podeCancelar && isActiveOrder(selectedOrder.status) && selectedOrder.status !== 'aguardando_pagamento'" class="btn btn-danger" @click="abrirModalCancelamento(selectedOrder, 'cancelado')">Cancelar</button>
            <button v-if="podeAbrirChat" class="btn btn-secondary" @click="abrirChatDoPedido(selectedOrder)">
              <i-lucide-message-square style="width:16px;height:16px" /> Chat
            </button>
            <button class="btn btn-secondary" @click="imprimirPedido(selectedOrder)">
              <i-lucide-printer style="width:16px;height:16px" /> Imprimir
            </button>
          </div>
        </div>
      </aside>
    </transition>

    <!-- Cancel/Recuse Modal (customizado, substitui prompt()) -->
    <div v-if="cancelModalOrder" class="modal-overlay" @click.self="fecharModalCancelamento">
      <div class="modal-content" style="max-width:420px;">
        <div style="text-align:center;margin-bottom:1rem;">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--error-light);display:flex;align-items:center;justify-content:center;margin:0 auto 0.75rem;">
            <i-lucide-triangle-alert style="width:24px;height:24px;color:var(--error)" />
          </div>
          <h3 style="font-size:1.1rem;font-weight:700;">
            {{ cancelModalAction === 'cancelado' ? 'Cancelar Pedido' : 'Recusar Pedido' }}
          </h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:0.25rem;">
            {{ cancelModalOrder?.pedido_id }} — {{ cancelModalOrder?.nome_cliente }}
          </p>
        </div>

        <div class="form-group">
          <label>Motivo do {{ cancelModalAction === 'cancelado' ? 'cancelamento' : 'recusa' }}:</label>
          <textarea
            v-model="cancelModalMotivo"
            rows="3"
            placeholder="Descreva o motivo..."
            style="width:100%;padding:0.75rem;border:1.5px solid var(--border);border-radius:6px;font-family:inherit;font-size:0.9rem;outline:none;"
            @focus="$event.target.style.borderColor = 'var(--primary)'"
            @blur="$event.target.style.borderColor = 'var(--border)'"
          ></textarea>
        </div>

        <div style="display:flex;gap:0.75rem;margin-top:1.25rem;">
          <button class="btn btn-secondary" style="flex:1;justify-content:center;" @click="fecharModalCancelamento">
            Voltar
          </button>
          <button
            class="btn btn-danger"
            style="flex:1;justify-content:center;"
            @click="confirmarCancelamento"
            :disabled="!cancelModalMotivo.trim()"
          >
            <i-lucide-check style="width:16px;height:16px" />
            {{ cancelModalAction === 'cancelado' ? 'Cancelar Pedido' : 'Recusar Pedido' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Chat SuperSide bar (restaurante ↔ cliente) -->
    <transition name="chat-fade">
      <div v-if="chatAberto" class="chat-overlay" @click="fecharChat()"></div>
    </transition>
    <transition name="chat-slide">
      <aside v-if="chatAberto" class="chat-drawer">
        <div class="chat-drawer-header">
          <div class="chat-drawer-title">
            <h3><i-lucide-message-circle style="width:18px;height:18px" /> Mensagens</h3>
            <span v-if="chatTotalNaoLidas" class="chat-drawer-sub">{{ chatTotalNaoLidas }} não lida(s)</span>
          </div>
          <button class="chat-close" @click="fecharChat()" title="Fechar">✕</button>
        </div>

        <!-- Lista de conversas -->
        <div v-if="!chatAtivo" class="chat-conversas">
          <div v-if="chatCarregando" class="chat-empty">Carregando...</div>
          <div v-else-if="chatConversas.length === 0" class="chat-empty">
            <i-lucide-message-circle style="width:34px;height:34px;opacity:.35" />
            <p>Nenhuma conversa ainda.<br />As mensagens trocadas com os clientes aparecem aqui.</p>
          </div>
          <button
            v-for="c in chatConversas"
            :key="c.pedido_id"
            class="chat-conversa"
            @click="abrirConversa(c)"
          >
            <div class="chat-conv-avatar">{{ inicial(c.nome_cliente) }}</div>
            <div class="chat-conv-body">
              <div class="chat-conv-top">
                <strong>{{ c.nome_cliente }}</strong>
                <span class="chat-conv-time">{{ formatDate(c.ultima?.criado_em || c.criado_em) }}</span>
              </div>
              <div class="chat-conv-mid">
                <span class="chat-conv-ref">{{ c.ref }} · {{ statusLabel(c.status) }}</span>
                <span v-if="c.nao_lidas" class="chat-unread-badge">{{ c.nao_lidas }}</span>
              </div>
              <div class="chat-conv-preview">{{ previewChat(c.ultima) }}</div>
            </div>
          </button>
        </div>

        <!-- Conversa aberta -->
        <div v-else class="chat-thread">
          <div class="chat-thread-header">
            <button class="chat-back" @click="chatAtivo = null" title="Voltar">←</button>
            <div class="chat-thread-title">
              <strong>{{ chatAtivo.nome_cliente }}</strong>
              <span>{{ chatAtivo.ref }} · {{ statusLabel(chatAtivo.status) }}</span>
            </div>
            <button class="btn btn-secondary btn-sm" @click="verPedidoNoCard">Ver pedido</button>
          </div>

          <div ref="chatScroll" class="chat-msgs">
            <div
              v-for="m in chatMensagens"
              :key="m.id"
              class="chat-msg"
              :class="m.remetente === 'restaurante' ? 'out' : 'in'"
            >
              <div class="chat-bubble">{{ m.mensagem }}</div>
              <div class="chat-msg-meta">
                {{ formatDate(m.criado_em) }}
                <span v-if="m.remetente === 'restaurante' && m.lida_cliente" title="Cliente leu" class="receipt">✓✓</span>
                <span v-else-if="m.remetente === 'cliente'" class="receipt" :class="{ read: m.lida }">{{ m.lida ? '✓✓' : '✓' }}</span>
              </div>
            </div>
          </div>

          <div v-if="chatPodeEnviar" class="chat-input-bar">
            <textarea v-model="chatTexto" rows="1" placeholder="Responder..." @keydown.enter.exact.prevent="enviarChat()"></textarea>
            <button class="btn btn-primary chat-send" :disabled="!chatTexto.trim() || chatEnviando" @click="enviarChat()">
              <i-lucide-send style="width:16px;height:16px" />
            </button>
          </div>
          <div v-else class="chat-somente-leitura">Somente leitura — admin/gerente/chef podem responder.</div>
        </div>
      </aside>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, inject, watch, onMounted, onUnmounted } from 'vue'
import api from '../services/api'
import { onEvent } from '../services/realtime'
import { useAuthStore } from '../stores/auth'
import { calcularTimerPedido, textoRestante, corTimer } from '../utils/tempo'

const emit = defineEmits(['changeView'])
const filtroMesa = inject('filtroMesa', ref(''))
const authStore = useAuthStore()
const globalLoading = inject('globalLoading')
const loadingMessage = inject('loadingMessage')

const cargo = computed(() => authStore.user?.cargo)

const feedbackMsg = ref(null)
function showFeedback(texto, tipo = 'erro') {
  feedbackMsg.value = { texto, tipo }
  setTimeout(() => { feedbackMsg.value = null }, 4000)
}

const viewMode = ref('cards')
const orders = ref([])
const resumo = ref(null)
const infoRestaurante = ref({}) // nome/endereço do restaurante (impressão)
const selectedOrder = ref(null)
const cancelModalOrder = ref(null)     // pedido alvo do cancelamento/recusa
const cancelModalAction = ref('cancelado') // 'cancelado' | 'recusado'
const cancelModalMotivo = ref('')      // motivo digitado
let pollingPaymentInterval = null
let timerInterval = null

// Estado dos estornos (refund) por pedido
const refundStatus = ref({})
let pollingRefundInterval = null

function isOnlinePayment(metodo) {
  return ['pix_online', 'credito_online', 'debito_online'].includes(metodo)
}

function refundClass(orderId) {
  const s = refundStatus.value[orderId]
  if (!s || s === 'PENDING') return 'refund-pending'
  if (s === 'DONE') return 'refund-done'
  if (s === 'CANCELLED') return 'refund-error'
  return 'refund-pending'
}

function refundIcon(orderId) {
  const s = refundStatus.value[orderId]
  if (!s || s === 'PENDING') return 'clock'
  if (s === 'DONE') return 'check-circle'
  if (s === 'CANCELLED') return 'x-circle'
  return 'loader'
}

function refundLabel(orderId) {
  const s = refundStatus.value[orderId]
  if (!s || s === 'PENDING') return '⏳ Estorno solicitado'
  if (s === 'DONE') return '✅ Estorno concluído'
  if (s === 'CANCELLED') return '❌ Estorno cancelado'
  if (s === 'AWAITING_CRITICAL_ACTION_AUTHORIZATION') return '🔐 Aguardando autorização (código SMS enviado)'
  return '⏳ Estorno em processamento...'
}

async function checkRefundStatus(orderId) {
  try {
    const { data } = await api.get(`/pagamentos/${orderId}/refund-status`)
    console.log(`[Refund] Pedido ${orderId}:`, data)
    if (data.refund_status) {
      refundStatus.value = { ...refundStatus.value, [orderId]: data.refund_status }
    } else if (data.deleted) {
      refundStatus.value = { ...refundStatus.value, [orderId]: 'DONE' }
    }
  } catch { /* silent */ }
}

const hoje = new Date().toISOString().split('T')[0]
// Fila padrão: Ativos (pedido concluído/cancelado some da fila)
const filtroStatus = ref('ativos')
const filtroOrigem = ref('todos')
const filtroDataPeriodo = ref('hoje')
const filtroDataInicio = ref(hoje)
const filtroDataFim = ref('')
const modoSemEntregador = ref(false)

function aoMudarStatusFiltro() {
  // Fila "Ativos" = todos os pedidos ativos (sem filtro de data), igual ao KDS
  if (filtroStatus.value === 'ativos') {
    filtroDataPeriodo.value = ''
    filtroDataInicio.value = ''
    filtroDataFim.value = ''
  } else {
    // Filtros específicos (Concluídos/Cancelados/Todos) fazem sentido na Lista —
    // o Quadro já agrupa por status de expedição.
    viewMode.value = 'lista'
  }
  loadOrders()
}

function aplicarFiltroData() {
  const hojeStr = new Date().toISOString().split('T')[0]
  if (filtroDataPeriodo.value === 'hoje') {
    filtroDataInicio.value = hojeStr
    filtroDataFim.value = ''
  } else if (filtroDataPeriodo.value === 'ontem') {
    const ontem = new Date(); ontem.setDate(ontem.getDate() - 1)
    filtroDataInicio.value = ontem.toISOString().split('T')[0]
    filtroDataFim.value = ''
  } else if (filtroDataPeriodo.value === '7dias') {
    const seteDias = new Date(); seteDias.setDate(seteDias.getDate() - 7)
    filtroDataInicio.value = seteDias.toISOString().split('T')[0]
    filtroDataFim.value = ''
  } else {
    filtroDataInicio.value = ''
    filtroDataFim.value = ''
  }
  loadOrders()
}

// Computed que filtra pedidos pela origem + status 'ativos' (local)
// Ordem da fila: do mais antigo para o mais recente
const filteredOrders = computed(() => {
  let base = filtroOrigem.value === 'todos'
    ? orders.value
    : orders.value.filter(o => o.origem === filtroOrigem.value)
  if (filtroStatus.value === 'ativos') {
    base = base.filter(o => !['entregue', 'finalizado', 'cancelado', 'recusado'].includes(o.status))
  }
  return [...base].sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
})

// ── SLA / barra de countdown (estilo iFood) ──
function slaSegundos(order) {
  if (order.status === 'pendente') return 5 * 60
  if (order.status === 'aguardando_pagamento') return 15 * 60
  const preparo = parseInt(order.tempo_preparo_estimado) || 20
  const entrega = parseInt(order.tempo_entrega_estimado) || 25
  if (order.status === 'preparando') return preparo * 60
  if (order.status === 'pronto_entrega' || order.status === 'pronto') {
    return (order.origem === 'salao' || order.origem === 'retirada' ? preparo : entrega) * 60
  }
  if (order.status === 'em_transito' || order.status === 'cheguei_destino') return entrega * 60
  return 0
}

function elapsedInfo(order, agora = Date.now()) {
  // Status fora de expedição não têm SLA — sem anel nem countdown
  if (['entregue', 'finalizado', 'cancelado', 'recusado'].includes(order.status)) return null
  const criado = new Date(order.criado_em).getTime()
  const elapsed = Number.isNaN(criado) ? 0 : Math.max(0, Math.floor((agora - criado) / 1000))
  const sla = slaSegundos(order)
  const pct = sla > 0 ? Math.min(100, Math.round((elapsed / sla) * 100)) : 100
  const mm = Math.floor(elapsed / 60)
  const ss = elapsed % 60
  const texto = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  const cor = sla > 0
    ? (pct >= 100 ? 'var(--error)' : pct >= 70 ? 'var(--warning)' : 'var(--success)')
    : 'var(--text-muted)'
  return { elapsed, sla, pct, texto, cor }
}

// Mapa de SLA por pedido (recalculado a cada tick de 1s, como `timers`)
const elapsedMap = computed(() => {
  const map = {}
  const agora = nowTick.value
  for (const o of orders.value) map[o.id] = elapsedInfo(o, agora)
  return map
})

// Cor do status no painel: Pendente sempre vermelho iFood, demais seguem o SLA
function statusCor(order) {
  if (order.status === 'pendente') return '#EA1D2C'
  if (order.status === 'aguardando_pagamento') return '#f59e0b'
  const el = elapsedMap.value[order.id]
  return el?.cor || '#151515'
}

function horaFeito(order) {
  return new Date(order.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function origemLabel(order) {
  const l = { salao: 'Salão', delivery: 'Delivery', retirada: 'Retirada', ifood: 'iFood' }
  return l[order.origem] || 'Delivery'
}

function origemIcon(order) {
  if (order.origem === 'salao') return '🪑'
  if (order.origem === 'retirada') return '🏪'
  if (order.origem === 'ifood') return '🍽️'
  return '🛵'
}

function formatPrice(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v) }

function formatDate(d) {
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function statusLabel(s) {
  const l = { pendente: 'Pendente', preparando: 'Preparando', pronto_entrega: 'Pronto', pronto: 'Pronto (Salão)', finalizado: 'Conta Finalizada', em_transito: 'Em Rota', cheguei_destino: 'No Local', entregue: 'Entregue', cancelado: 'Cancelado', recusado: 'Recusado', aguardando_pagamento: 'Aguardando Pagamento' }
  return l[s] || s
}

function paymentLabel(m) {
  const l = { credito: 'Cartão Crédito', debito: 'Cartão Débito', dinheiro: 'Dinheiro', pix: 'PIX', pix_online: 'PIX Online', credito_online: 'Cartão Crédito Online', debito_online: 'Cartão Débito Online', ifood: 'iFood (processado pelo iFood)' }
  return l[m] || m
}

function isActiveOrder(s) { return !['entregue', 'finalizado', 'cancelado', 'recusado'].includes(s) }

// ============================================
// Helper functions de permissão por cargo
// ============================================
const isAdmin = computed(() => cargo.value === 'admin' || cargo.value === 'gerente')
const isChef = computed(() => cargo.value === 'chef')
const isCaixa = computed(() => cargo.value === 'caixa')

// Admin/Gerente: podem fazer tudo
const podeAceitar = computed(() => isAdmin.value || isChef.value)
const podeRecusar = computed(() => isAdmin.value)
const podeMarcarPronto = computed(() => isAdmin.value || isChef.value)
const podeCancelar = computed(() => isAdmin.value || isCaixa.value)
const podeAbrirChat = computed(() => isAdmin.value || isChef.value || isCaixa.value)
// Dar baixa na retirada (cliente retirou no balcão) — admin/gerente/chef/caixa
const podeDarBaixaRetirada = computed(() => isAdmin.value || isChef.value || isCaixa.value)
const chatPodeEnviar = computed(() => isAdmin.value || isChef.value)

// ── Chat SuperSide bar ──
const chatAberto = ref(false)
const chatAtivo = ref(null)
const chatConversas = ref([])
const chatMensagens = ref([])
const chatTexto = ref('')
const chatCarregando = ref(false)
const chatEnviando = ref(false)
const chatScroll = ref(null)

const chatTotalNaoLidas = computed(() =>
  chatConversas.value.reduce((acc, c) => acc + (c.nao_lidas || 0), 0)
)

async function carregarConversas() {
  try {
    const { data } = await api.get('/restaurante/mensagens/conversas')
    chatConversas.value = data.conversas || []
  } catch { /* ignore */ }
}

function abrirChatDrawer() {
  chatAberto.value = true
  chatAtivo.value = null
  chatMensagens.value = []
  carregarConversas()
}

function abrirChatDoPedido(order) {
  chatAberto.value = true
  abrirConversa({
    pedido_id: order.id,
    ref: order.pedido_id,
    status: order.status,
    origem: order.origem,
    nome_cliente: order.nome_cliente,
  })
}

function fecharChat() {
  chatAberto.value = false
  chatAtivo.value = null
  chatMensagens.value = []
  chatTexto.value = ''
}

function inicial(nome) {
  return (nome || '?').trim().charAt(0).toUpperCase()
}

function previewChat(ultima) {
  if (!ultima) return ''
  const prefixo = ultima.remetente === 'cliente' ? '👤 ' : '🍳 '
  const t = String(ultima.mensagem || '')
  return prefixo + (t.length > 58 ? t.slice(0, 58) + '…' : t)
}

async function abrirConversa(conversa) {
  chatAtivo.value = conversa
  chatMensagens.value = []
  chatTexto.value = ''
  try {
    const { data } = await api.get(`/pedidos/${conversa.pedido_id}`)
    chatMensagens.value = (data.mensagens || []).slice().sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
  } catch { /* ignore */ }
  marcarConversaLida(conversa.pedido_id)
  scrollChat()
}

async function marcarConversaLida(pedidoId) {
  const conv = chatConversas.value.find((c) => c.pedido_id === pedidoId)
  if (conv && conv.nao_lidas > 0) {
    conv.nao_lidas = 0
    try {
      await api.post('/restaurante/mensagens/ler', { pedido_id: pedidoId })
    } catch { /* ignore */ }
  }
}

function scrollChat() {
  setTimeout(() => {
    if (chatScroll.value) chatScroll.value.scrollTop = chatScroll.value.scrollHeight
  }, 60)
}

async function enviarChat() {
  const t = chatTexto.value.trim()
  if (!t || !chatAtivo.value || chatEnviando.value) return
  chatEnviando.value = true
  chatTexto.value = ''
  try {
    const { data } = await api.post('/restaurante/mensagens', { pedido_id: chatAtivo.value.pedido_id, mensagem: t })
    if (!chatMensagens.value.some((x) => x.id === data.id)) {
      chatMensagens.value.push(data)
    }
    const conv = chatConversas.value.find((c) => c.pedido_id === data.pedido_id)
    if (conv) conv.ultima = { id: data.id, mensagem: data.mensagem, remetente: data.remetente, criado_em: data.criado_em }
    scrollChat()
  } catch (err) {
    chatTexto.value = t
    showFeedback(err.response?.data?.error || 'Erro ao enviar mensagem', 'erro')
  } finally {
    chatEnviando.value = false
  }
}

function verPedidoNoCard() {
  if (!chatAtivo.value) return
  const id = chatAtivo.value.pedido_id
  fecharChat()
  // Garantir que o pedido apareça no Quadro (limpa filtros e mostra o board)
  filtroStatus.value = 'ativos'
  filtroOrigem.value = 'todos'
  filtroDataPeriodo.value = ''
  filtroDataInicio.value = ''
  filtroDataFim.value = ''
  viewMode.value = 'cards'
  loadOrders().then(() => {
    setTimeout(() => {
      const el = document.querySelector(`.board-card[data-order-id="${id}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
  })
}
// ── Timer no formato do cliente (countdown + previsão), tick a cada 1s ──
const nowTick = ref(Date.now())
const timers = computed(() => {
  const map = {}
  const agora = nowTick.value
  for (const o of orders.value) {
    const t = calcularTimerPedido(o, agora)
    if (t) map[o.id] = { texto: textoRestante(t), cor: corTimer(t), previsao: t.previsao }
  }
  return map
})

async function loadOrders() {
  try {
    const params = {
      data_inicio: filtroDataInicio.value || undefined,
      data_fim: filtroDataFim.value || undefined,
      limit: 300,
    }
    // Status só vai ao backend quando explícito (Concluídos/Cancelados/Todos).
    // 'ativos' é filtrado LOCALMENTE para o Quadro ter também os Finalizados.
    if (filtroStatus.value && filtroStatus.value !== 'ativos') {
      params.status = filtroStatus.value
    }
    if (filtroOrigem.value !== 'todos') {
      params.origem = filtroOrigem.value
    }
    // Filtro por mesa (vindo do MesasView)
    if (filtroMesa.value) {
      params.mesa = filtroMesa.value
    }
    const { data } = await api.get('/pedidos', { params })
    orders.value = data
  } catch { /* ignore */ }
}

// Mantém o painel lateral sincronizado com a lista após mudanças
function syncSelectedOrder() {
  if (selectedOrder.value) {
    const atualizado = orders.value.find(o => o.id === selectedOrder.value.id)
    if (atualizado) selectedOrder.value = atualizado
  }
}

async function loadResumo() {
  try {
    const { data } = await api.get('/dashboard/resumo-dia')
    resumo.value = data
  } catch { /* ignore */ }
}

async function changeStatus(orderId, newStatus) {
  globalLoading.value = true
  loadingMessage.value = 'Atualizando status...'
  try {
    await api.patch(`/pedidos/${orderId}/status`, { status: newStatus })
    await loadOrders()
    await loadResumo()
    syncSelectedOrder()
  } catch (err) {
    showFeedback(err.response?.data?.error || 'Erro ao atualizar status', 'erro')
  } finally {
    globalLoading.value = false
  }
}

// ── Modal customizado de cancelamento/recusa (substitui prompt()) ──
function abrirModalCancelamento(order, action) {
  cancelModalOrder.value = order
  cancelModalAction.value = action
  cancelModalMotivo.value = ''
}

function fecharModalCancelamento() {
  cancelModalOrder.value = null
  cancelModalMotivo.value = ''
}

async function confirmarCancelamento() {
  const order = cancelModalOrder.value
  const action = cancelModalAction.value
  const motivo = cancelModalMotivo.value.trim()
  if (!order || !motivo) return

  fecharModalCancelamento()

  globalLoading.value = true
  loadingMessage.value = action === 'cancelado' ? 'Cancelando pedido...' : 'Recusando pedido...'
  try {
    await api.patch(`/pedidos/${order.id}/status`, { status: action, motivo })
    await loadOrders()
    await loadResumo()
    if (isOnlinePayment(order.metodo_pagamento)) {
      setTimeout(() => checkRefundStatus(order.id), 3000)
    }
    showFeedback(`✅ Pedido ${order.pedido_id} ${action === 'cancelado' ? 'cancelado' : 'recusado'} com sucesso!`, 'success')
  } catch (err) {
    showFeedback(err.response?.data?.error || `Erro ao ${action === 'cancelado' ? 'cancelar' : 'recusar'}`, 'erro')
  } finally {
    globalLoading.value = false
  }
}

function abrirDetalhes(order) { selectedOrder.value = order }

function imprimirPedido(order) {
  const printWindow = window.open('', '_blank', 'width=400,height=600')
  if (!printWindow) { showFeedback('Permita pop-ups para imprimir.', 'erro'); return }

  const itensHTML = order.itens?.map(item =>
    `<tr><td style="padding:4px 0;">${item.quantidade}x ${item.nome_produto}</td><td style="text-align:right;padding:4px 0;">R$ ${parseFloat(item.subtotal).toFixed(2)}</td></tr>`
  ).join('') || ''
  const restaurante = infoRestaurante.value

  printWindow.document.write(`
    <html><head>
      <title>Pedido ${order.pedido_id}</title>
      <style>
        @page { margin: 0; size: 80mm auto; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          width: 80mm;
          padding: 8mm 5mm;
          color: #000;
        }
        .header { text-align: center; margin-bottom: 8px; }
        .header h2 { font-size: 16px; font-weight: 800; }
        .header .info { font-size: 10px; color: #333; margin-top: 2px; }
        .divider { border-top: 1px dashed #000; margin: 8px 0; }
        .cliente { font-size: 11px; margin-bottom: 8px; }
        .cliente strong { font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; font-size: 10px; border-bottom: 1px solid #000; padding: 4px 0; }
        .total { font-size: 14px; font-weight: 800; text-align: right; margin-top: 8px; }
        .footer { text-align: center; font-size: 10px; margin-top: 12px; border-top: 1px dashed #000; padding-top: 8px; }
        .obs { font-size: 10px; margin-top: 6px; font-style: italic; }
        @media print { body { width: 80mm; } }
      </style>
    </head><body>
      <div class="header">
        <h2>${(restaurante.nome || 'Pedido').toUpperCase()}</h2>
        <div class="info">${[restaurante.cidade, restaurante.estado].filter(Boolean).join(' - ') || restaurante.endereco}</div>
        <div class="info">${order.pedido_id} | ${new Date(order.criado_em).toLocaleString('pt-BR')}</div>
      </div>
      <div class="divider"></div>
      <div class="cliente">
        <strong>${order.nome_cliente}</strong><br />
        ${order.endereco_cliente}, ${order.numero_cliente}<br />
        ${order.bairro_cliente}<br />
        Tel: ${order.telefone_cliente || '—'}
      </div>
      <div class="divider"></div>
      <table><tr><th>Item</th><th style="text-align:right;">Valor</th></tr>${itensHTML}</table>
      <div class="total">
        <div>Subtotal: R$ ${parseFloat(order.subtotal).toFixed(2)}</div>
        <div>Frete: R$ ${parseFloat(order.valor_frete).toFixed(2)}</div>
        <div style="font-size:16px;">TOTAL: R$ ${parseFloat(order.total).toFixed(2)}</div>
      </div>
      <div style="margin-top:6px;font-size:11px;">
        <strong>Pagamento:</strong> ${paymentLabel(order.metodo_pagamento)}
      </div>
      ${order.observacoes ? `<div class="obs">📝 ${order.observacoes}</div>` : ''}
      <div class="footer">
        Obrigado pela preferência! 🍕<br />
        ${restaurante.nome}
      </div>
    </body></html>
  `)
  printWindow.document.close()

  // Aguardar carregamento das fontes e imprimir
  setTimeout(() => {
    printWindow.focus()
    printWindow.print()
  }, 500)
}


async function loadConfig() {
  try {
    const { data } = await api.get('/restaurante')
    modoSemEntregador.value = data.modo_sem_entregador || false
    infoRestaurante.value = {
      nome: data.nome || '',
      endereco: data.endereco || '',
      cidade: data.cidade || '',
      estado: data.estado || '',
    }
  } catch { /* ignore */ }
}

function limparFiltros() {
  filtroStatus.value = ''
  filtroOrigem.value = 'todos'
  filtroDataPeriodo.value = 'hoje'
  filtroDataInicio.value = hoje
  filtroDataFim.value = ''
  loadOrders()
}

function limparFiltroMesa() {
  filtroMesa.value = ''
  loadOrders()
}

// Recarregar pedidos quando o filtro de mesa mudar (vindo do MesasView)
watch(filtroMesa, () => {
  loadOrders()
})

onMounted(async () => {
  await loadOrders()
  await loadResumo()
  await loadConfig()
  onEvent('pedido:novo', () => { loadOrders().then(syncSelectedOrder); loadResumo() })
  onEvent('pedido:atualizado', () => { loadOrders().then(syncSelectedOrder); loadResumo() })

  // Chat: badge inicial + atualizações em tempo real
  carregarConversas()
  onEvent('mensagem:novo', (m) => {
    if (chatAberto.value && chatAtivo.value?.pedido_id === m.pedido_id) {
      if (!chatMensagens.value.some((x) => x.id === m.id)) {
        chatMensagens.value.push(m)
        scrollChat()
      }
      marcarConversaLida(m.pedido_id)
    } else {
      const conv = chatConversas.value.find((c) => c.pedido_id === m.pedido_id)
      if (conv) {
        if (m.remetente === 'cliente') conv.nao_lidas = (conv.nao_lidas || 0) + 1
        conv.ultima = { id: m.id, mensagem: m.mensagem, remetente: m.remetente, criado_em: m.criado_em }
      } else {
        carregarConversas()
      }
    }
  })
  onEvent('mensagem:lida', (data) => {
    // Cliente leu → atualiza os recibos ✓✓ nas mensagens do restaurante
    if (data.pedido_id && data.lida_cliente) {
      chatMensagens.value.forEach((m) => {
        if (m.remetente === 'restaurante') m.lida_cliente = true
      })
    }
  })

  // Tick do timer (countdown do cliente) — 1s
  timerInterval = setInterval(() => { nowTick.value = Date.now() }, 1000)

  // Auto-polling LOCAL: recarrega lista de pedidos a cada 10s
  // O webhook da Rede + polling de backup do backend (15s) são os mecanismos principais
  pollingPaymentInterval = setInterval(async () => {
    await loadOrders()
    await loadResumo()
  }, 10000)

  // Polling de refund LOCAL: verifica status de estorno a cada 10s
  // O reembolso é manual (admin) e o status é consultado na Rede via /refund-status
  pollingRefundInterval = setInterval(async () => {
    const recusados = orders.value.filter(o =>
      (o.status === 'cancelado' || o.status === 'recusado') &&
      isOnlinePayment(o.metodo_pagamento)
    )
    if (recusados.length === 0) return
    for (const order of recusados) {
      const currentStatus = refundStatus.value[order.id]
      if (currentStatus === 'DONE' || currentStatus === 'CANCELLED') continue
      await checkRefundStatus(order.id)
      await new Promise(r => setTimeout(r, 300))
    }
  }, 10000)

  // Verificar estorno inicial dos pedidos já carregados
  setTimeout(() => {
    const recusados = orders.value.filter(o =>
      (o.status === 'cancelado' || o.status === 'recusado') &&
      isOnlinePayment(o.metodo_pagamento)
    )
    recusados.forEach(o => checkRefundStatus(o.id))
  }, 1000)
})

// Limpar intervalos ao desmontar
onUnmounted(() => {
  if (pollingPaymentInterval) clearInterval(pollingPaymentInterval)
  if (pollingRefundInterval) clearInterval(pollingRefundInterval)
  if (timerInterval) clearInterval(timerInterval)
})
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 400;
  display: flex; align-items: center; justify-content: center; padding: 1rem;
}

/* ── Painel lateral de detalhes (estilo iFood) ── */
.detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 300;
}
.detail-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(480px, 96vw);
  background: var(--surface);
  box-shadow: -8px 0 32px rgba(0,0,0,0.18);
  z-index: 310;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
}
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid var(--border);
}
.detail-header-left { display: flex; align-items: center; gap: 10px; }
.detail-header-left h3 { font-size: 18px; margin: 0; color: #151515; font-weight: 600; }
.detail-scroll { flex: 1; overflow-y: auto; padding: 1rem 1.1rem 2rem; }
.detail-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #717171;
  flex-wrap: wrap;
}
.detail-dot { opacity: 0.5; }
.detail-previsao {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  font-size: 14px;
  color: #3E3E3E;
}
.detail-countdown { margin-left: auto; font-weight: 700; }
.detail-status {
  margin-top: 10px;
  font-size: 16px;
  font-weight: 600;
  background: #fff;
  border: 1px solid #EBEBEB;
  border-radius: 8px;
  padding: 14px 16px;
}
.detail-cliente { display: flex; flex-direction: column; gap: 6px; font-size: 0.9rem; }
.detail-cliente a { color: #EB0033; text-decoration: none; font-weight: 500; }
.detail-cliente span { display: flex; align-items: center; gap: 6px; color: #717171; }
.detail-retirada { color: #EA1D2C; font-weight: 700; }
.detail-item { padding: 8px 0; border-bottom: 1px solid #EBEBEB; }
.detail-item:last-child { border-bottom: none; }
.detail-item-row { display: flex; align-items: center; gap: 10px; }
.ifood-item-thumb {
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 16px;
  background: #F5F5F5;
  border: 1px solid #EBEBEB;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #3E3E3E;
}
.detail-item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.detail-item-nome { font-weight: 500; font-size: 14px; color: #3E3E3E; }
.detail-item-preco { font-size: 14px; font-weight: 500; color: #3E3E3E; }
.detail-item-extra { font-size: 12px; color: #717171; margin: 2px 0 0 0; }
.detail-item-obs { font-size: 12px; color: #717171; font-style: italic; }
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}
.detail-actions .btn { flex: 1 1 45%; justify-content: center; }
.modal-content {
  background: white; border-radius: var(--radius); padding: 1.5rem;
  width: 100%; max-width: 500px; max-height: 80vh; overflow-y: auto;
}
.profile-section { margin-bottom: 1rem; }
.profile-section-title {
  font-size: 0.8rem; font-weight: 700; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.5rem;
  padding-bottom: 0.3rem; border-bottom: 1px solid var(--border);
}
.order-summary { background: var(--background); padding: 1rem; border-radius: var(--radius-sm); margin-top: 1rem; }
.order-summary-row { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 4px; }
.order-summary-total { display: flex; justify-content: space-between; font-weight: 800; font-size: 1.1rem; padding-top: 8px; margin-top: 8px; border-top: 2px solid var(--border); }
.status-badge { display: inline-flex; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; }
.feedback-toast {
  position: fixed;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-sm);
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
.date-radio-group,
.status-radio-group {
  display: flex;
  gap: 4px;
  background: var(--background);
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.date-radio,
.status-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition);
  color: var(--text-muted);
  user-select: none;
}
.date-radio:hover,
.status-radio:hover {
  color: var(--text);
}
.date-radio.active,
.status-radio.active {
  background: var(--surface);
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.date-radio input[type="radio"],
.status-radio input[type="radio"] {
  display: none;
}

.feedback-toast.erro {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

/* ── Origem Filter ── */
.origem-radio-group {
  display: flex;
  gap: 4px;
  background: var(--background);
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.origem-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition);
  color: var(--text-muted);
  user-select: none;
}
.origem-radio:hover {
  color: var(--text);
}
.origem-radio.active {
  background: var(--surface);
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.origem-radio input[type="radio"] {
  display: none;
}
.origem-radio svg {
  width: 14px;
  height: 14px;
}

/* ── Origem Badge (cards) ── */
.origem-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  vertical-align: middle;
  margin-left: 4px;
}
.origem-badge.salao {
  background: #ede9fe;
  color: #5b21b6;
}
.origem-badge.delivery {
  background: #dbeafe;
  color: #1e40af;
}
.origem-badge.retirada {
  background: #dcfce7;
  color: #166534;
}
.origem-badge.ifood {
  background: #ffedd5;
  color: #c2410c;
}
.origem-badge svg {
  width: 12px;
  height: 12px;
}

/* ── Mesa Badge ── */
.mesa-badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  background: var(--purple-light);
  color: #5b21b6;
}
@keyframes slideDown {
  from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ── Chat SuperSide bar ── */
.chat-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: var(--transition);
  position: relative;
}
.chat-toggle-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.chat-toggle-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.chat-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 350;
}
.chat-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(400px, 94vw);
  background: var(--surface);
  box-shadow: -8px 0 32px rgba(0,0,0,0.18);
  z-index: 360;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
}
.chat-fade-enter-active, .chat-fade-leave-active { transition: opacity 0.2s ease; }
.chat-fade-enter-from, .chat-fade-leave-to { opacity: 0; }
.chat-slide-enter-active, .chat-slide-leave-active { transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
.chat-slide-enter-from, .chat-slide-leave-to { transform: translateX(100%); }

.chat-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.chat-drawer-title h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1rem;
  margin: 0;
}
.chat-drawer-sub {
  font-size: 0.72rem;
  color: var(--primary);
  font-weight: 700;
}
.chat-close {
  border: none;
  background: none;
  font-size: 1rem;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  transition: var(--transition);
}
.chat-close:hover { background: var(--background); color: var(--text); }

.chat-conversas {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 0.85rem;
  text-align: center;
  padding: 2rem;
}
.chat-conversa {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--background);
  cursor: pointer;
  transition: var(--transition);
  font-family: inherit;
}
.chat-conversa:hover { border-color: var(--primary); background: var(--surface); }
.chat-conv-avatar {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--primary-light);
  color: var(--primary-dark);
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chat-conv-body { flex: 1; min-width: 0; }
.chat-conv-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}
.chat-conv-time { font-size: 0.68rem; color: var(--text-muted); white-space: nowrap; }
.chat-conv-mid {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin: 3px 0;
}
.chat-conv-ref { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; }
.chat-unread-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 0.68rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.chat-conv-preview {
  font-size: 0.78rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-thread {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.chat-thread-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.chat-back {
  border: none;
  background: none;
  color: var(--primary);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 4px 8px;
}
.chat-thread-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.chat-thread-title strong { font-size: 0.9rem; }
.chat-thread-title span { font-size: 0.72rem; color: var(--text-muted); }
.chat-msgs {
  flex: 1;
  overflow-y: auto;
  padding: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--background);
}
.chat-msg {
  display: flex;
  flex-direction: column;
  max-width: 82%;
}
.chat-msg.in { align-self: flex-start; align-items: flex-start; }
.chat-msg.out { align-self: flex-end; align-items: flex-end; }
.chat-bubble {
  padding: 8px 12px;
  border-radius: 14px;
  font-size: 0.85rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-msg.in .chat-bubble {
  background: var(--surface);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}
.chat-msg.out .chat-bubble {
  background: var(--primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.chat-msg-meta {
  font-size: 0.62rem;
  color: var(--text-muted);
  margin-top: 2px;
  padding: 0 5px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.receipt { font-weight: 700; }
.receipt.read { color: var(--primary); }
.chat-input-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.chat-input-bar textarea {
  flex: 1;
  resize: none;
  border: 1.5px solid var(--border);
  border-radius: 18px;
  padding: 8px 12px;
  font-family: inherit;
  font-size: 0.85rem;
  outline: none;
  max-height: 100px;
  transition: border-color var(--transition);
}
.chat-input-bar textarea:focus { border-color: var(--primary); }
.chat-send {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.chat-send:disabled { opacity: 0.45; cursor: not-allowed; }
.chat-somente-leitura {
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--border);
  background: var(--warning-light);
  color: #92400e;
  font-size: 0.75rem;
  font-weight: 600;
  text-align: center;
}

/* Refund status indicator */
.order-obs-badge {
  background: var(--warning-light);
  padding: 6px 8px;
  border-radius: var(--radius-xs);
  font-size: 0.85rem;
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.refund-status {
  font-size: 0.8rem;
  margin-top: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.refund-status svg { width: 14px; height: 14px; }

/* ── Mesa Filter Badge ── */
.mesa-filter-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 8px;
  background: #ede9fe;
  border: 1px solid #c4b5fd;
  color: #5b21b6;
  font-size: 0.8rem;
  font-weight: 600;
}
.mesa-filter-badge .btn-clear-filter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(91,33,182,0.12);
  color: #5b21b6;
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 700;
  transition: all 0.15s ease;
}
.mesa-filter-badge .btn-clear-filter:hover {
  background: rgba(91,33,182,0.25);
}
.refund-pending {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}
.refund-done {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}
.refund-error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}
</style>
