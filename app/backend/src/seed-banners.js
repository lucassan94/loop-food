// ================================================================
// 🌱 SEED - Banners do Carrossel (Cliente)
// ================================================================
// Cria banners promocionais com imagens de comida do Unsplash
// e chamadas atrativas para cada categoria.
//
// Uso: node src/seed-banners.js
// ================================================================

import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.DB_HOST || '86.48.18.22',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'delivery',
  user: process.env.DB_ADMIN_USER || process.env.DB_USER || 'default',
  password: process.env.DB_ADMIN_PASS || process.env.DB_PASS || 'default',
});

const BANNERS = [
  {
    titulo: '🔥 Em Destaque',
    subtitulo: 'Os pratos mais pedidos da casa — imperdível!',
    imagem_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1000&q=80',
    link_url: null,
    ordem: 0,
  },
  {
    titulo: '🥩 Ancho Grelhado',
    subtitulo: 'Suculento, macio e no ponto certo. Experimente!',
    imagem_url: 'https://images.unsplash.com/photo-1558030006-450675393462?auto=format&fit=crop&w=1000&q=80',
    link_url: null,
    ordem: 1,
  },
  {
    titulo: '🍝 Parmegiana de Filé Mignon',
    subtitulo: 'Molho pomodoro fresco e Catupiry gratinado',
    imagem_url: 'https://images.unsplash.com/photo-1632778149955-e80d8cef0fb6?auto=format&fit=crop&w=1000&q=80',
    link_url: null,
    ordem: 2,
  },
  {
    titulo: '🥗 Salada Caesar',
    subtitulo: 'Leve e refrescante — a escolha certa para qualquer dia',
    imagem_url: 'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?auto=format&fit=crop&w=1000&q=80',
    link_url: null,
    ordem: 3,
  },
  {
    titulo: '🍰 Sobremesas Artesanais',
    subtitulo: 'Pudim, Cheesecake e Bolo de Cenoura — doces que encantam',
    imagem_url: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=1000&q=80',
    link_url: null,
    ordem: 4,
  },
  {
    titulo: '🥤 Bebidas Geladas',
    subtitulo: 'Refrigerantes, sucos naturais e muito mais',
    imagem_url: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=1000&q=80',
    link_url: null,
    ordem: 5,
  },
  {
    titulo: '👨‍👩‍👧‍👦 Para até 2 Pessoas',
    subtitulo: 'Porções generosas para compartilhar momentos especiais',
    imagem_url: 'https://images.unsplash.com/photo-1561758033-d89a9ad46330?auto=format&fit=crop&w=1000&q=80',
    link_url: null,
    ordem: 6,
  },
  {
    titulo: '⚡ Executivo Rápido',
    subtitulo: 'Prato feito no ponto certo para sua correria do dia',
    imagem_url: 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?auto=format&fit=crop&w=1000&q=80',
    link_url: null,
    ordem: 7,
  },
];

async function seed() {
  const restaurantId = 1;

  console.log('🌱 Seeding banners...\n');

  // Verificar se já existem banners
  const existing = await pool.query(
    'SELECT COUNT(*) as total FROM banners WHERE restaurant_id = $1',
    [restaurantId]
  );
  const total = parseInt(existing.rows[0].total);

  if (total > 0) {
    console.log(`⚠️  Já existem ${total} banners cadastrados. Pulando seed (use --force para recriar).`);
    if (!process.argv.includes('--force')) {
      await pool.end();
      return;
    }
    // Apagar banners existentes se --force
    await pool.query('DELETE FROM banners WHERE restaurant_id = $1', [restaurantId]);
    console.log(`🗑️  ${total} banners existentes removidos.\n`);
  }

  let criados = 0;
  for (const banner of BANNERS) {
    await pool.query(
      `INSERT INTO banners (restaurant_id, titulo, subtitulo, imagem_url, link_url, ordem, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [restaurantId, banner.titulo, banner.subtitulo, banner.imagem_url, banner.link_url, banner.ordem]
    );
    criados++;
    console.log(`  ✅ [${banner.ordem + 1}/${BANNERS.length}] ${banner.titulo}`);
  }

  console.log(`\n✅ ${criados} banners criados com sucesso!`);
  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
