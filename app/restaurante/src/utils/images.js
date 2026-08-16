// Placeholder SVG genérico para produtos sem imagem (data URI inline)
// Não depende de rede — evita fallbacks externos (Unsplash) e quebra visual.
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#eef1f5"/>
  <circle cx="200" cy="150" r="86" fill="#f8fafc" stroke="#e2e8f0"/>
  <g transform="translate(177.5 125) scale(2.5)" fill="none" stroke="#94a3b8" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
    <path d="M7 2v20"/>
    <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>
  </g>
</svg>`

export const PRODUCT_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(PLACEHOLDER_SVG)

// ============================================================================
// Compressão de imagem no CLIENTE (antes do upload)
// ============================================================================
// Fotos de celular vêm com 3000-4000px e vários MB — comprimir aqui reduz o
// upload (banda do restaurante) e o payload. O backend também otimiza no
// salvamento (sharp, 1200px/q80), então a compressão do cliente é a primeira
// camada: nunca piora o resultado e nunca quebra o upload.

// Mesma política do backend (upload.js): 1200px máx. e JPEG ~80%.
const MAX_DIM = 1200
const QUALIDADE = 0.8
// Abaixo deste tamanho (e já ≤ MAX_DIM) não compensa recomprimir: usamos o
// arquivo original para não perder qualidade em logos/ícones pequenos.
const MIN_TAMANHO_COMPRESSAO = 300 * 1024

// Lê o arquivo original como base64 (sem prefixo data:) + mime
function lerBase64Original(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const full = reader.result // ex: "data:image/png;base64,...."
      const sep = full.indexOf(',')
      const mime = sep > 5 ? full.slice(5, sep).split(';')[0] : (file.type || 'image/png')
      resolve({ base64: full.slice(sep + 1), mime })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function carregarImagem(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

// PNG com transparência real? (varre o alpha; <250 = transparente)
function imagemTemTransparencia(ctx, w, h) {
  try {
    const dados = ctx.getImageData(0, 0, w, h).data
    for (let i = 3; i < dados.length; i += 4) {
      if (dados[i] < 250) return true
    }
  } catch { /* canvas restrito — assume sem transparência */ }
  return false
}

/**
 * Redimensiona e recomprime uma imagem ANTES do upload.
 *
 * - SVG e GIF → passam intactos (vetor/animação).
 * - PNG com transparência → continua PNG.
 * - Demais (fotos JPEG/PNG/WebP) → vira JPEG ≤ MAX_DIM.
 * - Imagem já pequena ou compressão que não reduz → usa o original.
 *
 * @param {File} file Arquivo selecionado
 * @returns {Promise<{ base64: string, mime: string }>} base64 SEM prefixo data:
 */
export async function comprimirImagemFile(file, { maxDim = MAX_DIM, quality = QUALIDADE } = {}) {
  const tipo = (file?.type || '').toLowerCase()
  if (!tipo.startsWith('image/')) return lerBase64Original(file)
  if (tipo === 'image/svg+xml' || tipo === 'image/gif') return lerBase64Original(file)

  try {
    const url = URL.createObjectURL(file)
    const img = await carregarImagem(url)
    URL.revokeObjectURL(url)

    const largura = img.naturalWidth || 1
    const altura = img.naturalHeight || 1
    const escala = Math.min(1, maxDim / Math.max(largura, altura))

    // Já é pequena — usa o original (evita perda de qualidade à toa)
    if (escala === 1 && file.size <= MIN_TAMANHO_COMPRESSAO) return lerBase64Original(file)

    const w = Math.max(1, Math.round(largura * escala))
    const h = Math.max(1, Math.round(altura * escala))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)

    const mime = tipo === 'image/png' && imagemTemTransparencia(ctx, w, h) ? 'image/png' : 'image/jpeg'
    const base64 = canvas.toDataURL(mime, quality).split(',')[1]
    const original = await lerBase64Original(file)

    // Nunca piorar: se o resultado ficou maior, devolve o original
    if (!base64 || base64.length >= original.base64.length) return original
    return { base64, mime }
  } catch {
    // Qualquer falha (ex.: formato que o canvas não decodifica) → original
    return lerBase64Original(file)
  }
}
