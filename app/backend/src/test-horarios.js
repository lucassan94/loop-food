// ============================================================================
// Teste de regressão: horários de funcionamento no fuso do restaurante.
// ============================================================================
// Bug corrigido: o servidor roda em UTC (Docker) e comparava os horários com
// new Date() local → das 21h às 23h59 (BRT) via UTC no dia seguinte, bloqueava
// pedidos mesmo com a loja aberta (ex.: 21:39 local = 00:39 UTC).
// Rode com: node src/test-horarios.js
// ============================================================================
import { lojaAbertaAgora } from './services/horarios.js';

// Convenção do painel: índice 0 = Domingo (diasSemana[0]='Domingo' no ConfigView)
const horarios = [
  { aberto: false, abre: '', fecha: '' },            // domingo fechado (índice 0)
  { aberto: true, abre: '08:00', fecha: '23:00' },  // segunda
  { aberto: true, abre: '08:00', fecha: '23:00' },  // terça
  { aberto: true, abre: '08:00', fecha: '23:00' },  // quarta
  { aberto: true, abre: '08:00', fecha: '23:00' },  // quinta (índice 4)
  { aberto: true, abre: '08:00', fecha: '23:00' },  // sexta
  { aberto: true, abre: '08:00', fecha: '23:00' },  // sábado
];

// ── Fuso alternativo: America/Manaus (UTC−4) — prova o parâmetro de fuso ──
// Local 21:00 em Manaus (qui) = UTC 01:00 de 2026-08-07.
const casosManaus = [
  { label: 'Manaus Qui 21:00 local', utc: '2026-08-07T01:00:00Z', esperado: true, tz: 'America/Manaus' },
  { label: 'Manaus Qui 23:30 local', utc: '2026-08-07T03:30:00Z', esperado: false, tz: 'America/Manaus' },
  { label: 'Manaus Dom 12:00 local (fechado)', utc: '2026-08-09T16:00:00Z', esperado: false, tz: 'America/Manaus' },
];

// Quinta-feira em UTC correspondente à hora local (BRT = UTC-3)
// 2026-08-06 é quinta-feira. Local 21:00 = UTC 00:00 de 2026-08-07.
const casos = [
  { label: 'Qui 18:00 local', utc: '2026-08-06T21:00:00Z', esperado: true },
  { label: 'Qui 20:00 local', utc: '2026-08-06T23:00:00Z', esperado: true },
  { label: 'Qui 21:00 local', utc: '2026-08-07T00:00:00Z', esperado: true },
  { label: 'Qui 22:00 local', utc: '2026-08-07T01:00:00Z', esperado: true },
  { label: 'Qui 22:59 local', utc: '2026-08-07T01:59:00Z', esperado: true },
  { label: 'Qui 23:00 local', utc: '2026-08-07T02:00:00Z', esperado: true },
  { label: 'Qui 23:30 local', utc: '2026-08-07T02:30:00Z', esperado: false }, // depois de fechar
  { label: 'Sexta 02:00 local', utc: '2026-08-07T05:00:00Z', esperado: false }, // madrugada
  { label: 'Sexta 08:00 local', utc: '2026-08-07T11:00:00Z', esperado: true },
  { label: 'Dom 12:00 local (fechado)', utc: '2026-08-09T15:00:00Z', esperado: false },
];

let falhas = 0;
for (const c of [...casos, ...casosManaus]) {
  const res = lojaAbertaAgora(horarios, new Date(c.utc), c.tz || 'America/Sao_Paulo');
  const ok = res === c.esperado;
  if (!ok) falhas++;
  console.log(`${ok ? '✅' : '❌'} ${c.label}: ${res ? 'ABERTO' : 'FECHADO'} (esperado ${c.esperado ? 'ABERTO' : 'FECHADO'})`);
}
console.log(falhas === 0 ? '\n🎉 Todos os cenários passaram!' : `\n⚠️ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
