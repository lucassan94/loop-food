// ═══════════════════════════════════════════════════════════════════════════
// Teste REAL de criação de pedido (fuso horário):
//   1. Sobe o backend CORRIGIDO localmente apontando para o banco de produção
//      (porta 3101) e faz POST /api/pedidos — deve criar (201).
//   2. Faz o mesmo POST no SERVIDOR DE PRODUÇÃO (porta 8090, código ANTIGO) —
//      deve recusar com 'loja fechada' (21h-23h local = UTC dia seguinte).
//   3. Remove o(s) pedido(s) de teste do banco (pedido_itens, timeline, pedidos).
//   4. Derruba o servidor local.
// ═══════════════════════════════════════════════════════════════════════════
import { spawn } from 'child_process';
import pg from 'pg';

const PROD_URL = 'http://86.48.18.22:8090';
const LOCAL_URL = 'http://localhost:3101';
const LOJA = { lat: -23.5329, lng: -46.7917 }; // Palazzo

const pool = new pg.Pool({
  host: process.env.DB_HOST || '86.48.18.22',
  port: 5432,
  database: 'delivery',
  user: process.env.DB_ADMIN_USER || 'default',
  password: process.env.DB_ADMIN_PASS || 'default',
  max: 1,
});

async function aguardarHealth(url, timeoutMs = 20000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return true;
    } catch { /* ainda subindo */ }
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
}

function montarPayload(frete) {
  return {
    origem: 'delivery',
    nome_cliente: 'TESTE FUSO HORARIO',
    telefone_cliente: '(11) 99999-9999',
    endereco_cliente: 'Rua Teste, 123',
    numero_cliente: '123',
    bairro_cliente: 'Centro',
    cep_cliente: '01001-000',
    cidade_cliente: 'São Paulo',
    estado_cliente: 'SP',
    latitude_cliente: LOJA.lat,
    longitude_cliente: LOJA.lng,
    subtotal: 55.9,
    valor_frete: frete?.custo ?? 0,
    total: (frete?.custo ?? 0) + 55.9,
    metodo_pagamento: 'pix',
    observacoes: 'Pedido de teste fuso horario - remover',
    itens: [{
      produto_id: 21,
      nome_produto: 'Lasanha de costela com Molho Branco e Pomodoro',
      quantidade: 1,
      preco_unitario: 55.9,
      extras: [],
      opcoes: [],
      talheres: true,
      observacao: '',
      subtotal: 55.9,
    }],
  };
}

async function criarPedido(url, payload) {
  try {
    const r = await fetch(`${url}/api/pedidos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  } catch (err) {
    return { status: 0, body: { erro: err.message } };
  }
}

async function limparPedidosTeste() {
  // Multi-statement: o pg retorna um ARRAY de Results (um por statement) —
  // os ids removidos estão no último (DELETE FROM pedidos ... RETURNING id).
  const del = await pool.query(`
    DELETE FROM pedido_timeline WHERE pedido_id IN (SELECT id FROM pedidos WHERE nome_cliente LIKE 'TESTE FUSO%');
    DELETE FROM pedido_itens   WHERE pedido_id IN (SELECT id FROM pedidos WHERE nome_cliente LIKE 'TESTE FUSO%');
    DELETE FROM pagamentos     WHERE pedido_id IN (SELECT id FROM pedidos WHERE nome_cliente LIKE 'TESTE FUSO%');
    DELETE FROM pedidos        WHERE nome_cliente LIKE 'TESTE FUSO%' RETURNING id;
  `);
  const ultimo = Array.isArray(del) ? del[del.length - 1] : del;
  return ultimo?.rows || [];
}

let server = null;
try {
  console.log('═══════════ TESTE REAL: POST /api/pedidos (fuso horário) ═══════════');
  console.log('Hora local SP :', new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()));

  // ── 1. Sobe o backend CORRIGIDO localmente (porta 3101) ──
  console.log('\n[1] Subindo backend corrigido localmente (porta 3101)...');
  server = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '3101',
      NODE_ENV: 'development',
      DB_HOST: process.env.DB_HOST || '86.48.18.22',
      DB_PORT: '5432',
      DB_NAME: 'delivery',
      DB_USER: 'default',
      DB_PASS: 'default',
      RESTAURANT_ID: '1',
      REDE_ENV: 'sandbox',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => { if (process.env.DEBUG_TEST) process.stdout.write('[local] ' + d); });
  server.stderr.on('data', d => { if (process.env.DEBUG_TEST) process.stderr.write('[local-err] ' + d); });

  const localOk = await aguardarHealth(LOCAL_URL);
  console.log(`    Health local: ${localOk ? 'OK ✅' : 'FALHOU ❌'}`);
  if (!localOk) throw new Error('Backend local não subiu.');

  // Frete autoritativo (mesmo fluxo do cliente)
  const freteResp = await fetch(`${LOCAL_URL}/api/pedidos/calcular-frete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: LOJA.lat, longitude: LOJA.lng, estado: 'SP' }),
  });
  const frete = await freteResp.json();
  console.log(`    Frete calculado: R$ ${frete.custo} (raio ${frete.faixa_raio}km)`);

  const payload = montarPayload(frete);

  // ── 2. POST no backend CORRIGIDO (local) ──
  console.log('\n[2] POST /api/pedidos → BACKEND CORRIGIDO (local, banco de produção)...');
  const localRes = await criarPedido(LOCAL_URL, payload);
  if (localRes.status === 201) {
    console.log(`    ✅ ${localRes.status} — PEDIDO CRIADO! id=${localRes.body.id} total=R$ ${localRes.body.total} status=${localRes.body.status}`);
  } else {
    console.log(`    ❌ ${localRes.status} — ${JSON.stringify(localRes.body)}`);
  }

  // ── 3. POST no SERVIDOR DE PRODUÇÃO (código antigo) ──
  console.log('\n[3] POST /api/pedidos → PRODUÇÃO (código antigo, 8090)...');
  const prodRes = await criarPedido(PROD_URL, payload);
  if (prodRes.status === 201) {
    console.log(`    ⚠️  ${prodRes.status} — produção ACEITOU (pode ser código já atualizado). id=${prodRes.body.id}`);
  } else {
    console.log(`    ${prodRes.status} — ${prodRes.body.error || JSON.stringify(prodRes.body)}`);
    if (prodRes.status === 400 && /fechad/i.test(prodRes.body.error || '')) {
      console.log('    → Confirma o BUG AO VIVO: produção (código antigo) bloqueia pedido às 21h-23h locais.');
    }
  }

  // ── 4. Limpeza ──
  console.log('\n[4] Limpando pedidos de teste...');
  const removidos = await limparPedidosTeste();
  console.log(`    ${removidos.length} pedido(s) de teste removido(s).`);

  console.log('\n═══════════ FIM ═══════════');
} finally {
  if (server) {
    server.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 500));
    console.log('Backend local encerrado.');
  }
  await pool.end();
}
