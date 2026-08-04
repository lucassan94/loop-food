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
