-- ============================================================================
-- SABOREXPRESS - Migration 024: Apelido para Clientes e Entregadores
-- PostgreSQL 16
-- ============================================================================
-- Habilita login por USERNAME (apelido) também para clientes e entregadores,
-- além do telefone (migration 022). Necessário para os seeds padronizados:
--   cliente  / cliente123
--   entregador / entregador123
-- (Staff já possui apelido desde a migration 022.)
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. CLIENTES: adicionar apelido + UNIQUE por tenant
-- ============================================================================

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS apelido VARCHAR(50);

-- Remover duplicatas de apelido dentro do mesmo tenant antes de criar o índice
DELETE FROM clientes a USING clientes b
WHERE a.id < b.id
  AND a.restaurant_id = b.restaurant_id
  AND a.apelido = b.apelido
  AND a.apelido IS NOT NULL
  AND a.apelido != '';

-- UNIQUE (restaurant_id, apelido) mas permite múltiplos NULLs
DROP INDEX IF EXISTS idx_clientes_apelido;
CREATE UNIQUE INDEX idx_clientes_apelido
  ON clientes(restaurant_id, apelido)
  WHERE apelido IS NOT NULL;

-- ============================================================================
-- 2. ENTREGADORES: adicionar apelido + UNIQUE por tenant
-- ============================================================================

ALTER TABLE entregadores ADD COLUMN IF NOT EXISTS apelido VARCHAR(50);

-- Remover duplicatas de apelido dentro do mesmo tenant antes de criar o índice
DELETE FROM entregadores a USING entregadores b
WHERE a.id < b.id
  AND a.restaurant_id = b.restaurant_id
  AND a.apelido = b.apelido
  AND a.apelido IS NOT NULL
  AND a.apelido != '';

-- UNIQUE (restaurant_id, apelido) mas permite múltiplos NULLs
DROP INDEX IF EXISTS idx_entregadores_apelido;
CREATE UNIQUE INDEX idx_entregadores_apelido
  ON entregadores(restaurant_id, apelido)
  WHERE apelido IS NOT NULL;

COMMIT;
