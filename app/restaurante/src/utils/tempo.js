// ============================================================================
// Timer de pedido no MESMO formato que o cliente enxerga (TrackingView).
// O restaurante usa isto para saber o tempo estimado que o cliente está vendo
// no card: countdown ("~44 min") + previsão (HH:MM).
//
// Regras idênticas ao frontend do cliente (app/cliente/src/views/TrackingView.vue):
//   - preparo default 20, entrega default 25 (quando tempo_preparo_estimado /
//     tempo_entrega_estimado ausentes)
//   - total = preparo + entrega; retirada conta só o preparo
//   - restante = max(0, total - decorrido desde a criação)
//
// Salão (PDV) também conta só o preparo: o cliente não acompanha pedidos de
// salão (não há TrackingView) e tempo_entrega_estimado é null — somar 25 min
// de entrega inflaria a previsão nos cards do restaurante.
// ============================================================================

/**
 * Calcula o timer de um pedido (mesmo cálculo do TrackingView do cliente).
 * @param {object} order - pedido (criado_em, tempo_preparo_estimado, tempo_entrega_estimado, origem)
 * @param {number} [agora=Date.now()] - instante de referência (ms)
 * @returns {{totalMin:number, elapsedMin:number, restante:number, previsao:string}|null}
 */
export function calcularTimerPedido(order, agora = Date.now()) {
  if (!order?.criado_em) return null
  const criado = new Date(order.criado_em).getTime()
  if (Number.isNaN(criado)) return null

  const preparo = parseInt(order.tempo_preparo_estimado) || 20
  const entrega = parseInt(order.tempo_entrega_estimado) || 25
  const totalMin = (order.origem === 'retirada' || order.origem === 'salao') ? preparo : preparo + entrega

  const elapsedMin = Math.max(0, Math.floor((agora - criado) / 60000))
  const restante = Math.max(0, totalMin - elapsedMin)
  const previsao = new Date(criado + totalMin * 60000).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return { totalMin, elapsedMin, restante, previsao }
}

/**
 * Texto do countdown — igual ao do cliente ("~44 min"; "Saindo agora! 🚀").
 */
export function textoRestante(timer) {
  if (!timer) return ''
  if (timer.restante === 0) return 'Saindo agora! 🚀'
  return `~${timer.restante} min`
}

/**
 * Cor do timer para o restaurante: vermelho quando o prazo do cliente já
 * passou, âmbar quando falta pouco, neutro caso contrário.
 */
export function corTimer(timer) {
  if (!timer) return 'var(--text-secondary)'
  if (timer.restante === 0) return 'var(--error)'
  if (timer.restante <= 5) return 'var(--warning)'
  return 'var(--text-secondary)'
}
