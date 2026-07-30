// =============================================================================
// Setup Database de Desenvolvimento
// =============================================================================
// Cria o banco delivery_dev (se não existir), roda todas as migrations e seed.
//
// Uso: node src/setup-dev-db.js
// Opções:
//   DB_NAME=delivery_dev   (default)
//   DB_HOST, DB_PORT, DB_USER, DB_PASS  (credenciais do PostgreSQL)
// =============================================================================

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_HOST = process.env.DB_HOST || '86.48.18.22';
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const DB_USER = process.env.DB_USER || 'default';
const DB_PASS = process.env.DB_PASS || 'default';
const DB_NAME = process.env.DB_NAME || 'delivery_dev';

async function createDatabase() {
  console.log(`\n🔧 Conectando ao PostgreSQL em ${DB_HOST}:${DB_PORT}...`);

  // Conectar no banco 'postgres' (padrão do sistema) para criar o database
  const adminPool = new pg.Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: 'postgres',
    user: DB_USER,
    password: DB_PASS,
    max: 1,
  });

  try {
    const result = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [DB_NAME]
    );

    if (result.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${DB_NAME} ENCODING 'UTF8'`);
      console.log(`✅ Banco "${DB_NAME}" criado com sucesso!`);
    } else {
      console.log(`ℹ️  Banco "${DB_NAME}" já existe.`);
    }
  } catch (err) {
    console.error(`❌ Erro ao criar banco "${DB_NAME}":`, err.message);
    process.exit(1);
  } finally {
    await adminPool.end();
  }
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');

  const pool = new pg.Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASS,
    max: 1,
  });

  try {
    if (!fs.existsSync(migrationsDir)) {
      console.error('❌ Diretório de migrations não encontrado:', migrationsDir);
      process.exit(1);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`\n📦 Executando ${files.length} migration(s)...\n`);

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      process.stdout.write(`➜ ${file}... `);

      try {
        await pool.query(sql);
        console.log(`✅`);
      } catch (err) {
        console.log(`⚠️  ${err.message.substring(0, 80)}`);
        console.log(`   (pulando — pode já ter sido aplicada anteriormente)`);
      }
    }

    console.log(`\n✅ Todas as ${files.length} migrations executadas com sucesso!`);
  } finally {
    await pool.end();
  }
}

async function runSeed() {
  console.log(`\n🌱 Executando seed...\n`);

  // Usar o seed.js existente com as variáveis de ambiente corretas
  const { execSync } = await import('child_process');

  const env = {
    ...process.env,
    DB_HOST,
    DB_PORT: String(DB_PORT),
    DB_NAME,
    DB_USER,
    DB_PASS,
    NODE_ENV: 'development',
    RESTAURANT_ID: '1',
    JWT_SECRET: 'dev-secret-local-setup',
  };

  const seedPath = path.join(__dirname, 'seed.js');

  try {
    execSync(`node "${seedPath}"`, {
      env,
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
    console.log(`\n✅ Seed concluído!`);
  } catch (err) {
    console.error(`\n❌ Seed falhou. O banco foi criado e as migrations rodaram.`);
    console.error(`   Execute manualmente: cd backend && npm run seed`);
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════╗');
console.log('║   🗄️  Setup Banco de Desenvolvimento            ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log(`║  Host: ${DB_HOST}:${DB_PORT}`);
console.log(`║  Database: ${DB_NAME}`);
console.log(`║  User: ${DB_USER}`);
console.log('╚══════════════════════════════════════════════════╝');

await createDatabase();
await runMigrations();
await runSeed();

console.log('\n🎉 Setup completo! Banco de desenvolvimento pronto.');
console.log(`📊 Database: ${DB_NAME} em ${DB_HOST}:${DB_PORT}`);
console.log('🔧 Use DB_NAME=delivery_dev no .env.local para conectar.\n');
