// ── Setup do entregador de teste (credencial persistente para a suíte EN) ──
// O seed 'entregador/entregador123' NÃO existe no tenant deployado (401 confirmado).
// Este script reseta a senha/telefone do entregador existente via admin e grava
// tmp_ui_tests/.entregador-teste.json para a suíte logar por telefone.
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const TELEFONE = '(11) 97000-8888';
const SENHA = 'entregador123';
const EMAIL_FIXO = 'entregador.teste.loop@loopautomacoes.com';

async function main() {
  // 1) Admin login (direct API)
  const token = await H.apiLoginAdmin();
  if (!token) { console.error('FAIL: admin login sem token'); process.exit(1); }

  // 2) Listar entregadores
  const lista = await H.apiRequest('/entregadores', 'GET', null, token);
  const arr = Array.isArray(lista.data) ? lista.data : [];
  console.log('entregadores existentes:', arr.length, arr.map(e => ({ id: e.id, nome: e.nome, email: e.email, telefone: e.telefone })));

  let id = arr[0]?.id;
  let criado = false;
  if (!id) {
    // Criar
    const criadoRes = await H.apiRequest('/entregadores', 'POST', {
      nome: 'Entregador Teste Loop', email: EMAIL_FIXO,
      telefone: TELEFONE, password: SENHA, status: 'ativo',
    }, token);
    console.log('POST /entregadores →', criadoRes.status, JSON.stringify(criadoRes.data).slice(0, 160));
    if (criadoRes.status === 201) { id = criadoRes.data.id; criado = true; }
    else if (criadoRes.status === 409) {
      // E-mail duplicado — tentar localizar por email na lista... usar PUT no 1º
      console.error('FAIL: email duplicado e lista vazia?', criadoRes.data);
    }
  } else {
    // Resetar senha/telefone do existente
    const upd = await H.apiRequest(`/entregadores/${id}`, 'PUT', { password: SENHA, telefone: TELEFONE }, token);
    console.log(`PUT /entregadores/${id} →`, upd.status, JSON.stringify(upd.data).slice(0, 160));
  }

  if (!id) { console.error('FAIL: sem entregador configurado'); process.exit(1); }

  fs.writeFileSync(path.join(__dirname, '.entregador-teste.json'),
    JSON.stringify({ telefone: TELEFONE, senha: SENHA, id, criado }, null, 2));
  console.log('OK → .entregador-teste.json', { telefone: TELEFONE, id, criado });

  // 3) Validar login por telefone (1 tentativa de login)
  const login = await H.apiRequest('/auth/entregador/login', 'POST', { telefone: TELEFONE, password: SENHA });
  console.log('validacao login entregador →', login.status, login.data?.error || 'OK');
  process.exit(login.status === 200 ? 0 : 2);
}

main().catch(err => { console.error(err); process.exit(1); });
