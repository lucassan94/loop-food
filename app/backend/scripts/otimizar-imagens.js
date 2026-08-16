#!/usr/bin/env node
// ============================================================================
// scripts/otimizar-imagens.js — Otimiza imagens JÁ existentes no banco
// ============================================================================
// Redimensiona/recomprime as imagens salvas ANTES da otimização no upload
// (imagens da tabela `imagens` + colunas base64 embutidas em linhas), para
// que o cardápio carregue rápido também com os dados atuais.
//
// Uso:
//   node scripts/otimizar-imagens.js            # aplica as otimizações
//   node scripts/otimizar-imagens.js --dry-run  # só reporta o que seria feito
//
// RLS: a escrita nas tabelas é isolada por tenant (app.restaurant_id), então
// o script itera tenant a tenant definindo o contexto de sessão. A tabela
// `restaurantes` não tem RLS (padrão dos jobs existentes) e serve para
// descobrir os tenants.
//
// Pool próprio: os blobs BYTEA podem ser grandes e o banco é remoto — o pool
// do backend usa query_timeout de 10s, pequeno demais para transferir todos
// os blobs. Este script usa timeout generoso (120s).
//
// Segurança: nunca amplia imagem nem piora o tamanho — se o resultado não
// for menor, a linha é mantida intacta.
// ============================================================================

import 'dotenv/config';
import pg from 'pg';
import { otimizarImagemBuffer, otimizarImagemBase64, detectMimeFromBase64 } from '../src/config/upload.js';

const DRY_RUN = process.argv.includes('--dry-run');

// Limiar: só processa blobs acima deste tamanho (bytes). Abaixo disso a
// otimização raramente compensa o custo.
const LIMIAR_BYTES = 20 * 1024; // 20 KB
const LIMIAR_BASE64 = 30 * 1024; // ~22 KB decodificados

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'delivery',
  user: process.env.DB_USER || 'default',
  password: process.env.DB_PASS || 'default',
  max: 4,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 15000,
  query_timeout: 120000,
  statement_timeout: 120000,
});

/** Query simples (sem contexto RLS) — para a descoberta de tenants. */
async function queryPlain(text, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

/** Query com contexto RLS do tenant (SET app.restaurant_id + query na MESMA conexão). */
async function queryTenant(tenantId, text, params = []) {
  const client = await pool.connect();
  try {
    await client.query(`SET app.restaurant_id = ${tenantId}`);
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

const stats = {};

function addStat(tabela, antes, depois) {
  if (!stats[tabela]) stats[tabela] = { n: 0, bytesAntes: 0, bytesDepois: 0, mantidas: 0 };
  stats[tabela].n += 1;
  stats[tabela].bytesAntes += antes;
  stats[tabela].bytesDepois += depois;
}

function fmtBytes(b) {
  if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

// Detalhe por linha só aparece em --dry-run (em modo normal, apenas o resumo)
function log(...args) {
  if (!DRY_RUN) return;
  console.log(...args);
}

// ── Tabela imagens (fonte das URLs /uploads/...) ──
async function otimizarImagens(tenantId) {
  // Filtro explícito por tenant: o RLS de imagens só isola a ESCRITA (SELECT é
  // público), então sem o filtro cada imagem apareceria em todos os tenants.
  const rows = (
    await queryTenant(
      tenantId,
      `SELECT id, filename, mime, dados FROM imagens
       WHERE restaurant_id = ${tenantId} AND octet_length(dados) > ${LIMIAR_BYTES}
       ORDER BY octet_length(dados) DESC`
    )
  ).rows;

  let otimizadas = 0;
  for (const row of rows) {
    const mimeOriginal = row.mime || detectMimeFromBase64(row.dados.toString('base64').substring(0, 30));
    const res = await otimizarImagemBuffer(row.dados, mimeOriginal);
    const antes = row.dados.length;
    const depois = res.buffer.length;
    if (depois >= antes) {
      stats['imagens'].mantidas += 1;
      continue;
    }
    otimizadas++;
    addStat('imagens', antes, depois);
    if (!DRY_RUN) {
      await queryTenant(
        tenantId,
        'UPDATE imagens SET dados = $1, mime = $2, atualizado_em = now() WHERE id = $3',
        [res.buffer, res.mime, row.id]
      );
    } else {
      log(`  imagens #${row.id} (${row.filename}): ${fmtBytes(antes)} → ${fmtBytes(depois)}`);
    }
  }
  if (otimizadas > 0) log(`  ✔ ${otimizadas} imagem(ns) otimizada(s) em imagens (tenant ${tenantId})`);
}

// ── Colunas base64 embutidas em linhas (mantém o formato) ──
async function otimizarColunaBase64(tenantId, tabela, idCol, coluna, sqlFiltro = '') {
  const rows = (
    await queryTenant(
      tenantId,
      `SELECT ${idCol} AS id, ${coluna} FROM ${tabela}
       WHERE length(${coluna}) > ${LIMIAR_BASE64} ${sqlFiltro}`
    )
  ).rows;

  let otimizadas = 0;
  const chave = `${tabela}.${coluna}`;
  for (const row of rows) {
    const res = await otimizarImagemBase64(row[coluna]);
    const antes = row[coluna].length;
    const depois = res.base64.length;
    if (depois >= antes) {
      stats[chave].mantidas += 1;
      continue;
    }
    otimizadas++;
    addStat(chave, antes, depois);
    if (!DRY_RUN) {
      await queryTenant(
        tenantId,
        `UPDATE ${tabela} SET ${coluna} = $1 WHERE ${idCol} = $2`,
        [res.base64, row.id]
      );
    } else {
      log(`  ${chave} #${row.id}: base64 ${fmtBytes(antes)} → ${fmtBytes(depois)}`);
    }
  }
  if (otimizadas > 0) log(`  ✔ ${otimizadas} linha(s) otimizada(s) em ${chave} (tenant ${tenantId})`);
}

async function main() {
  console.log(`\n🖼️  Otimização de imagens existentes ${DRY_RUN ? '(DRY-RUN — nada será alterado)' : ''}\n`);

  // Inicializa estatísticas
  for (const chave of ['imagens', 'extra_subcategoria_itens.imagem_base64', 'produtos.imagem_base64', 'banners.imagem_base64', 'restaurantes.logo_base64']) {
    stats[chave] = { n: 0, bytesAntes: 0, bytesDepois: 0, mantidas: 0 };
  }

  // Descobre tenants via restaurantes (tabela sem RLS — padrão dos jobs existentes)
  const tenants = (await queryPlain('SELECT id FROM restaurantes ORDER BY id')).rows.map(r => r.id);
  if (tenants.length === 0) {
    console.log('Nenhum restaurante encontrado.');
    await pool.end();
    return;
  }
  console.log(`Tenants encontrados: ${tenants.join(', ')}\n`);

  for (const tenantId of tenants) {
    console.log(`── Tenant ${tenantId} ──`);
    await otimizarImagens(tenantId);
    // SELECT de extra_subcategoria_itens é público — filtra pela subcategoria
    // do tenant (mesma regra da policy de escrita, evita otimizar 2×)
    await otimizarColunaBase64(
      tenantId, 'extra_subcategoria_itens', 'id', 'imagem_base64',
      `AND subcategoria_id IN (SELECT id FROM extra_subcategorias WHERE restaurant_id = ${tenantId})`
    );
    await otimizarColunaBase64(tenantId, 'produtos', 'id', 'imagem_base64', `AND restaurant_id = ${tenantId}`);
    await otimizarColunaBase64(tenantId, 'banners', 'id', 'imagem_base64', `AND restaurant_id = ${tenantId}`);
    await otimizarColunaBase64(tenantId, 'restaurantes', 'id', 'logo_base64', 'AND id = ' + tenantId);
  }

  // Resumo
  console.log('\n══════════ RESUMO ══════════');
  let totalAntes = 0;
  let totalDepois = 0;
  for (const [chave, s] of Object.entries(stats)) {
    const salvos = s.bytesAntes - s.bytesDepois;
    totalAntes += s.bytesAntes;
    totalDepois += s.bytesDepois;
    if (s.n > 0 || s.mantidas > 0) {
      console.log(
        `  ${chave.padEnd(38)} ${s.n} otimizada(s) · ${fmtBytes(s.bytesAntes)} → ${fmtBytes(s.bytesDepois)} (salvou ${fmtBytes(salvos)})${s.mantidas ? ` · ${s.mantidas} já pequenas` : ''}`
      );
    } else {
      console.log(`  ${chave.padEnd(38)} nada a otimizar`);
    }
  }
  const pct = totalAntes > 0 ? (100 * (totalAntes - totalDepois) / totalAntes).toFixed(1) : '0.0';
  console.log(`\n  TOTAL: ${fmtBytes(totalAntes)} → ${fmtBytes(totalDepois)} (${pct}% menor)`);

  if (DRY_RUN) console.log('\n(DRY-RUN — rode sem --dry-run para aplicar)');
  await pool.end();
}

main().catch(async (err) => {
  console.error('❌ Erro:', err);
  await pool.end();
  process.exit(1);
});
