import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Migrations ficam FORA de backend/ (pasta migrations/ na raiz do projeto).
// No container, o docker-compose monta ./migrations:/app/migrations (ro).
// Para dev local, apontar com: MIGRATIONS_DIR=../../..\migrations npm run migrate
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  || path.join(__dirname, '..', 'migrations');

// Migrations rodam DDL (CREATE TABLE/ROLE) — exigem credencial ADMIN
// (superuser). O backend em runtime usa app_user (DB_USER), que NÃO pode
// executar DDL. Se DB_ADMIN_USER não estiver definido, cai para DB_USER
// (compatível com ambientes onde a role runtime ainda é admin).
const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'delivery',
  user: process.env.DB_ADMIN_USER || process.env.DB_USER || 'default',
  password: process.env.DB_ADMIN_PASS || process.env.DB_PASS || 'default',
  max: 1,
});

async function runMigrations() {
  const migrationsDir = MIGRATIONS_DIR;

  if (!fs.existsSync(migrationsDir)) {
    console.error('❌ Migrations directory not found:', migrationsDir);
    process.exit(1);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`\n📦 Running ${files.length} migration(s)...\n`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    let sql = fs.readFileSync(filePath, 'utf-8');

    // Migration 029 (role app_user): substitui o placeholder da senha pela
    // senha de runtime (DB_PASS — override do Portainer, nunca commitada).
    if (process.env.DB_PASS && sql.includes('__APP_DB_PASSWORD__')) {
      sql = sql.replaceAll('__APP_DB_PASSWORD__', process.env.DB_PASS);
      console.log(`   🔑 ${file}: senha do app_user injetada (DB_PASS)`);
    }

    // SEM DB_PASS: pular migrations que exigem a senha. Re-executar a 029 com o
    // placeholder literal resetaria a senha do app_user → outage. Pular mantém
    // a senha real (já definida) e falha ruidosamente apenas em ambiente novo.
    if (!process.env.DB_PASS && sql.includes('__APP_DB_PASSWORD__')) {
      console.warn(`   ⏭️  ${file}: SKIP (DB_PASS não definido — senha do app_user preservada). Defina DB_PASS via override do Portainer.`);
      continue;
    }

    console.log(`➜ Executing: ${file}`);

    try {
      await pool.query(sql);
      console.log(`   ✅ ${file} completed successfully`);
    } catch (err) {
      console.error(`   ❌ ${file} FAILED:`, err.message);
      console.log('\n⚠️  Migration aborted. Check the error above.');
      await pool.end();
      process.exit(1);
    }
  }

  console.log(`\n✅ All migrations executed successfully!\n`);
  await pool.end();
}

runMigrations();
