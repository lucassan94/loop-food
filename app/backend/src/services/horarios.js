// ============================================================================
// Horários de funcionamento — avaliação no fuso horário do restaurante
// ============================================================================
// Os horários cadastrados no painel (restaurantes.horarios_funcionamento e
// produtos.dias_semana/horario_*) são SEMPRE no fuso local do restaurante
// (America/Sao_Paulo). O servidor roda em UTC (Docker/Alpine sem TZ) — por
// isso comparar com new Date()/getHours()/getDay() desloca a janela em 3h e
// bloqueia pedidos à noite (ex.: 21h local = 00h UTC do dia seguinte).
//
// Estes helpers usam Intl.DateTimeFormat com timeZone explícita e NÃO
// dependem do TZ do processo. O cliente também os replica (App.vue) usando o
// campo `timezone` retornado pelo GET /restaurante.
// ============================================================================

export const TZ_RESTAURANTE = 'America/Sao_Paulo';

const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Valida se uma string é um fuso horário IANA reconhecido pelo Intl.
 * Usada ao salvar restaurantes.timezone (PUT /restaurante).
 */
export function timeZoneValido(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * Retorna { diaSemana (0=Domingo), minutos } no fuso informado (padrão: restaurante).
 */
export function agoraNoFusoDoRestaurante(date = new Date(), timeZone = TZ_RESTAURANTE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const partes = fmt.formatToParts(date);
  const get = (t) => partes.find(p => p.type === t)?.value;
  let hora = parseInt(get('hour') || '0', 10);
  if (hora === 24) hora = 0; // Intl pode retornar "24" para meia-noite
  return {
    diaSemana: DIAS[get('weekday')] ?? date.getDay(),
    minutos: hora * 60 + parseInt(get('minute') || '0', 10),
  };
}

function parseHora(valor) {
  const [hh, mm] = String(valor || '00:00').split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

/**
 * True se a loja está aberta agora conforme horarios_funcionamento
 * (array de 7 dias, índice 0 = Domingo). Sem dados (não-array/≠7) → true.
 */
export function lojaAbertaAgora(horarios, date = new Date(), timeZone = TZ_RESTAURANTE) {
  if (!Array.isArray(horarios) || horarios.length !== 7) return true;
  const { diaSemana, minutos } = agoraNoFusoDoRestaurante(date, timeZone);
  const dia = horarios[diaSemana];
  if (!dia || !dia.aberto) return false;
  const abre = parseHora(dia.abre || '08:00');
  const fecha = parseHora(dia.fecha || '23:00');
  if (fecha <= abre) {
    // Overnight (ex.: 22:00 às 02:00)
    return minutos >= abre || minutos <= fecha;
  }
  return minutos >= abre && minutos <= fecha;
}

/**
 * Minutos até fechar (null = sem horários configurados; 0 = já fechou).
 * Usada para a contagem regressiva no cliente.
 */
export function minutosAteFechar(horarios, date = new Date(), timeZone = TZ_RESTAURANTE) {
  if (!Array.isArray(horarios) || horarios.length !== 7) return null;
  const { diaSemana, minutos } = agoraNoFusoDoRestaurante(date, timeZone);
  const dia = horarios[diaSemana];
  if (!dia || !dia.aberto) return 0;
  const abre = parseHora(dia.abre || '08:00');
  const fecha = parseHora(dia.fecha || '23:00');
  if (fecha <= abre) {
    // Fecha no dia seguinte
    if (minutos > fecha) return (1440 - minutos) + fecha;
    return fecha - minutos;
  }
  return fecha - minutos;
}
