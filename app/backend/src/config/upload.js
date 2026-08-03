// ============================================================================
// Upload Helper — Imagens armazenadas NO BANCO (tabela imagens, BYTEA)
// ============================================================================
//
// A partir da migration 028, as imagens (cardápio, banners, entregadores,
// categorias, logos) vivem no Postgres — viajam com o banco (backups incluem
// imagens) e eliminam o volume de uploads no deploy.
//
// URLs públicas NÃO mudam:
//   /uploads/{tenantId}/{tipo}/{filename}
//
// Estrutura original (mantida apenas como FALLBACK de transição):
//   {UPLOAD_DIR}/{tenantId}/{tipo}/{filename}
//
// ============================================================================

import fs from 'fs';
import path from 'path';
import { config } from './index.js';
import { query } from './database.js';

/**
 * Retorna o caminho absoluto do diretório base de uploads (fallback disco).
 */
export function getUploadBaseDir() {
  return path.resolve(config.upload.dir);
}

/**
 * Retorna o caminho absoluto do diretório de uploads de um tenant (fallback).
 * Ex: /app/uploads/5/cardapio
 */
export function getTenantUploadDir(tenantId, subdir = 'cardapio') {
  return path.join(getUploadBaseDir(), String(tenantId), subdir);
}

/**
 * Retorna a URL pública para um arquivo.
 * Ex: /uploads/5/cardapio/foto.jpg
 */
export function getTenantUploadUrl(tenantId, subdir, filename) {
  return `/uploads/${tenantId}/${subdir}/${filename}`;
}

/**
 * Cria o diretório de uploads de um tenant (fallback disco) se não existir.
 */
export function ensureTenantUploadDirs(tenantId, subdirs = ['cardapio', 'banners', 'entregadores', 'categorias']) {
  const created = [];
  for (const subdir of subdirs) {
    const dir = getTenantUploadDir(tenantId, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }
  return created;
}

/**
 * Cria os diretórios de upload para todos os tenants conhecidos (fallback).
 */
export function ensureAllTenantUploadDirs(tenantIds) {
  const allCreated = [];
  for (const tenantId of tenantIds) {
    const created = ensureTenantUploadDirs(tenantId);
    allCreated.push(...created);
  }
  return allCreated;
}

// ============================================================================
// BANCO DE DADOS (fonte primária)
// ============================================================================

/**
 * Salva uma imagem no banco (tabela imagens).
 * Upsert por (restaurant_id, tipo, filename).
 *
 * @param {number|string} tenantId - ID do restaurante
 * @param {string} tipo - Subdiretório/tipo (cardapio, banners, etc.)
 * @param {string} filename - Nome do arquivo (ex: "123_foto.jpg")
 * @param {Buffer} buffer - Bytes da imagem
 * @param {string} mime - Content-Type (ex: image/jpeg)
 * @returns {Promise<{ id: number, publicUrl: string }>}
 */
export async function saveImageToDb(tenantId, tipo, filename, buffer, mime = 'image/jpeg') {
  const result = await query(
    `INSERT INTO imagens (restaurant_id, tipo, filename, mime, dados, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (restaurant_id, tipo, filename)
     DO UPDATE SET dados = EXCLUDED.dados, mime = EXCLUDED.mime, atualizado_em = now()
     RETURNING id`,
    [tenantId, tipo, filename, mime, buffer]
  );

  return {
    id: result.rows[0]?.id,
    publicUrl: getTenantUploadUrl(tenantId, tipo, filename),
  };
}

/**
 * Busca uma imagem no banco.
 * @returns {Promise<{ buffer: Buffer, mime: string } | null>}
 */
export async function getImageFromDb(tenantId, tipo, filename) {
  const result = await query(
    'SELECT dados, mime FROM imagens WHERE restaurant_id = $1 AND tipo = $2 AND filename = $3',
    [tenantId, tipo, filename]
  );
  if (result.rows.length === 0) return null;
  return { buffer: result.rows[0].dados, mime: result.rows[0].mime || 'image/jpeg' };
}

/**
 * Remove uma imagem do banco.
 * @returns {Promise<boolean>} true se removida
 */
export async function deleteImageFromDb(tenantId, tipo, filename) {
  const result = await query(
    'DELETE FROM imagens WHERE restaurant_id = $1 AND tipo = $2 AND filename = $3 RETURNING id',
    [tenantId, tipo, filename]
  );
  return result.rows.length > 0;
}

// ============================================================================
// API DE NEGÓCIO (usadas pelos módulos/scripts)
// ============================================================================

/**
 * Converte uma imagem base64 para o banco, no diretório do tenant.
 * Fonte primária: banco (tabela imagens).
 *
 * @param {number|string} tenantId - ID do restaurante
 * @param {string} subdir - Subdiretório (cardapio, banners, etc.)
 * @param {string} filename - Nome do arquivo (ex: "123_foto.jpg")
 * @param {string} base64Data - Conteúdo base64 da imagem (SEM prefixo data:)
 * @returns {Promise<{ filePath: string, publicUrl: string }>}
 */
export async function saveBase64AsFile(tenantId, subdir, filename, base64Data) {
  const buffer = Buffer.from(base64Data, 'base64');
  const mime = detectMimeFromBase64(base64Data);

  await saveImageToDb(tenantId, subdir, filename, buffer, mime);

  // Fallback disco (transição): mantém o arquivo no disco também
  const dir = getTenantUploadDir(tenantId, subdir);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, filename), buffer);
  } catch (err) {
    console.warn(`[Upload] Falha ao gravar fallback em disco (ignorado): ${err.message}`);
  }

  return {
    filePath: path.join(dir, filename),
    publicUrl: getTenantUploadUrl(tenantId, subdir, filename),
  };
}

/**
 * Remove uma imagem (banco + disco).
 * Validação contra path traversal: verifica se o path resolvido
 * está dentro do diretório base de uploads.
 *
 * @param {string} publicUrl - URL pública do arquivo (ex: /uploads/5/cardapio/foto.jpg)
 * @returns {Promise<boolean>} true se o arquivo foi removido
 */
export async function deleteUploadFile(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/uploads/')) {
    return false;
  }

  // /uploads/{tenantId}/{tipo}/{filename}
  const parts = publicUrl.replace('/uploads/', '').split('/');
  if (parts.length !== 3) return false;
  const [tenantId, tipo, filename] = parts;

  let removed = false;

  // Banco (fonte primária)
  try {
    removed = await deleteImageFromDb(tenantId, tipo, filename);
  } catch (err) {
    console.warn(`[Upload] Erro ao remover do banco ${publicUrl}:`, err.message);
  }

  // Disco (fallback)
  const baseDir = path.resolve(getUploadBaseDir());
  const filePath = path.resolve(baseDir, tenantId, tipo, filename);
  if (filePath.startsWith(baseDir + path.sep)) {
    try {
      await fs.promises.unlink(filePath);
      removed = true;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[Upload] Erro ao remover arquivo ${filePath}:`, err.message);
      }
    }
  }

  return removed;
}

// ============================================================================
// Subdiretórios permitidos (whitelist — CWE-22)
// ============================================================================
export const ALLOWED_UPLOAD_TYPES = ['cardapio', 'banners', 'entregadores', 'categorias', 'logos'];

/**
 * Detecta o mime a partir do prefixo base64.
 */
export function detectMimeFromBase64(base64) {
  if (!base64) return 'image/jpeg';
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  try {
    const decoded = Buffer.from(base64.substring(0, 20), 'base64').toString();
    if (decoded.startsWith('<svg')) return 'image/svg+xml';
  } catch {}
  return 'image/jpeg';
}

/**
 * Retorna a extensão de arquivo a partir do prefixo base64.
 */
export function detectFileExtension(base64) {
  const mime = detectMimeFromBase64(base64);
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  return map[mime] || 'jpg';
}

/**
 * Gera um nome de arquivo seguro e único a partir do nome do produto/banner.
 * Ex: "X-Burger" → "1712345678901_x-burger_a1b2.jpg"
 */
export function gerarNomeArquivo(nome, base64) {
  const slug = String(nome || 'imagem')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50) || 'imagem';
  const ext = detectFileExtension(base64);
  // Sufixo aleatório evita colisão de filename (mesmo ms + mesmo nome)
  const rand = Math.random().toString(36).slice(2, 6);
  return `${Date.now()}_${slug}_${rand}.${ext}`;
}

/**
 * Serve um arquivo de upload com segurança (CWE-22).
 *
 * Fonte primária: banco (tabela imagens).
 * Fallback: disco (período de transição).
 *
 * @param {string} tenantId - ID do restaurante (deve ser numérico)
 * @param {string} type - Tipo do arquivo (cardapio, banners, etc.)
 * @param {string} filename - Nome do arquivo
 * @param {object} res - Express response object
 */
export async function serveUploadFile(tenantId, type, filename, res) {
  // CWE-22: Validar tenantId (apenas dígitos)
  if (!/^\d+$/.test(tenantId)) {
    console.warn(`[Upload] Tenant ID inválido: ${tenantId}`);
    return res.status(400).json({ error: 'Parâmetro inválido.' });
  }

  // CWE-22: Validar tipo contra whitelist
  if (!ALLOWED_UPLOAD_TYPES.includes(type)) {
    console.warn(`[Upload] Tipo de arquivo inválido: ${type}`);
    return res.status(400).json({ error: 'Parâmetro inválido.' });
  }

  // CWE-22: Validar nome do arquivo (sem path separators)
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    console.warn(`[Upload] Nome de arquivo inválido: ${filename}`);
    return res.status(400).json({ error: 'Parâmetro inválido.' });
  }

  // Cache público (imagens do cardápio mudam raramente) — só em respostas 200
  res.setHeader('Cache-Control', 'public, max-age=86400');

  // ─── Fonte primária: banco ───
  try {
    const image = await getImageFromDb(tenantId, type, filename);
    if (image) {
      res.setHeader('Content-Type', image.mime);
      return res.send(image.buffer);
    }
  } catch (err) {
    console.warn(`[Upload] Erro ao ler do banco ${tenantId}/${type}/${filename}:`, err.message);
  }

  // ─── Fallback: disco (transição) ───
  const baseDir = path.resolve(getUploadBaseDir());
  const filePath = path.resolve(baseDir, tenantId, type, filename);

  if (!filePath.startsWith(baseDir + path.sep)) {
    console.warn(`[Upload] Path traversal detectado: ${tenantId}/${type}/${filename}`);
    return res.status(400).json({ error: 'Parâmetro inválido.' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }

  return res.sendFile(filePath, (err) => {
    if (err) {
      console.warn(`[Upload] Erro ao servir arquivo ${filePath}:`, err.message);
      if (!res.headersSent) {
        res.status(404).json({ error: 'Arquivo não encontrado.' });
      }
    }
  });
}
