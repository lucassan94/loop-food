// ============================================================================
// Upload Helper — Gerenciamento de arquivos por tenant
// ============================================================================
//
// Estrutura de diretórios:
//   {UPLOAD_DIR}/
//     {tenantId}/
//       cardapio/        ← Fotos dos produtos
//       banners/         ← Imagens dos banners
//       entregadores/    ← Fotos dos entregadores
//       categorias/      ← Ícones das categorias
//
// A URL pública segue o mesmo padrão:
//   /uploads/{tenantId}/cardapio/nome-do-arquivo.jpg
//
// ============================================================================

import fs from 'fs';
import path from 'path';
import { config } from './index.js';

/**
 * Retorna o caminho absoluto do diretório base de uploads.
 */
export function getUploadBaseDir() {
  return path.resolve(config.upload.dir);
}

/**
 * Retorna o caminho absoluto do diretório de uploads de um tenant específico.
 * Ex: /app/uploads/5/cardapio
 *
 * @param {number|string} tenantId - ID do restaurante
 * @param {string} subdir - Subdiretório (cardapio, banners, etc.)
 */
export function getTenantUploadDir(tenantId, subdir = 'cardapio') {
  const tenantDir = path.join(getUploadBaseDir(), String(tenantId), subdir);
  return tenantDir;
}

/**
 * Retorna a URL pública para um arquivo dentro do diretório de um tenant.
 * Ex: /uploads/5/cardapio/foto.jpg
 *
 * @param {number|string} tenantId - ID do restaurante
 * @param {string} subdir - Subdiretório (cardapio, banners, etc.)
 * @param {string} filename - Nome do arquivo
 */
export function getTenantUploadUrl(tenantId, subdir, filename) {
  return `/uploads/${tenantId}/${subdir}/${filename}`;
}

/**
 * Cria o diretório de uploads de um tenant (e subdiretórios) se não existir.
 * Retorna o caminho do diretório criado.
 *
 * @param {number|string} tenantId - ID do restaurante
 * @param {string[]} subdirs - Lista de subdiretórios para criar
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
 * Cria os diretórios de upload para todos os tenants conhecidos.
 * Útil para inicialização/migração.
 */
export function ensureAllTenantUploadDirs(tenantIds) {
  const allCreated = [];
  for (const tenantId of tenantIds) {
    const created = ensureTenantUploadDirs(tenantId);
    allCreated.push(...created);
  }
  return allCreated;
}

/**
 * Converte uma imagem base64 em arquivo no disco, no diretório do tenant.
 * Usa async I/O para não bloquear o event loop em cenários de runtime.
 *
 * @param {number|string} tenantId - ID do restaurante
 * @param {string} subdir - Subdiretório (cardapio, banners, etc.)
 * @param {string} filename - Nome do arquivo (ex: "123_foto.jpg")
 * @param {string} base64Data - Conteúdo base64 da imagem (SEM prefixo data:)
 * @returns {Promise<{ filePath: string, publicUrl: string }>}
 */
export async function saveBase64AsFile(tenantId, subdir, filename, base64Data) {
  const dir = getTenantUploadDir(tenantId, subdir);
  await fs.promises.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, filename);
  const buffer = Buffer.from(base64Data, 'base64');
  await fs.promises.writeFile(filePath, buffer);

  return {
    filePath,
    publicUrl: getTenantUploadUrl(tenantId, subdir, filename),
  };
}

/**
 * Remove um arquivo de upload.
 * Validação contra path traversal: verifica se o path resolvido
 * está dentro do diretório base de uploads.
 *
 * @param {string} publicUrl - URL pública do arquivo (ex: /uploads/5/cardapio/foto.jpg)
 * @returns {Promise<boolean>} true se o arquivo foi removido, false se não existia
 */
export async function deleteUploadFile(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/uploads/')) {
    return false;
  }

  // Resolver path completo e validar contra path traversal
  const baseDir = path.resolve(getUploadBaseDir());
  const relativePath = publicUrl.replace('/uploads/', '');
  const filePath = path.resolve(baseDir, relativePath);

  // Garantir que o path resolvido está DENTRO do diretório base
  if (!filePath.startsWith(baseDir + path.sep)) {
    console.warn(`[Upload] Path traversal detectado: ${publicUrl}`);
    return false;
  }

  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false; // Arquivo não existe
    console.warn(`[Upload] Erro ao remover arquivo ${filePath}:`, err.message);
    return false;
  }
}
