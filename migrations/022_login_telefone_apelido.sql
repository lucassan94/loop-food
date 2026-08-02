-- ============================================================================
-- SABOREXPRESS - Migration 022: Login por Telefone/Apelido
-- PostgreSQL 16
-- ============================================================================
-- Clientes: login por telefone (antes: email)
-- Entregadores: login por telefone (antes: email)
-- Equipe (restaurante_users): login por apelido (antes: email)
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. CLIENTES: telefone UNIQUE por tenant
-- ============================================================================

-- Remover duplicatas de telefone dentro do mesmo tenant antes de criar constraint
DELETE FROM clientes a USING clientes b
WHERE a.id < b.id
  AND a.restaurant_id = b.restaurant_id
  AND a.telefone = b.telefone
  AND a.telefone IS NOT NULL
  AND a.telefone != '';

-- A constraint (restaurant_id, email) continua existindo (email ainda é coletado),
-- mas adicionamos UNIQUE em (restaurant_id, telefone) para login por telefone.
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_restaurant_id_telefone_key CASCADE;
ALTER TABLE clientes ADD UNIQUE (restaurant_id, telefone);

CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone);

-- ============================================================================
-- 2. ENTREGADORES: telefone UNIQUE por tenant
-- ============================================================================

DELETE FROM entregadores a USING entregadores b
WHERE a.id < b.id
  AND a.restaurant_id = b.restaurant_id
  AND a.telefone = b.telefone
  AND a.telefone IS NOT NULL
  AND a.telefone != '';

ALTER TABLE entregadores DROP CONSTRAINT IF EXISTS entregadores_restaurant_id_telefone_key CASCADE;
ALTER TABLE entregadores ADD UNIQUE (restaurant_id, telefone);

CREATE INDEX IF NOT EXISTS idx_entregadores_telefone ON entregadores(telefone);

-- ============================================================================
-- 3. RESTAURANTE_USERS: adicionar apelido + UNIQUE por tenant
-- ============================================================================

ALTER TABLE restaurante_users ADD COLUMN IF NOT EXISTS apelido VARCHAR(50);

-- Remover duplicatas antes de criar constraint
DELETE FROM restaurante_users a USING restaurante_users b
WHERE a.id < b.id
  AND a.restaurant_id = b.restaurant_id
  AND a.apelido = b.apelido
  AND a.apelido IS NOT NULL
  AND a.apelido != '';

ALTER TABLE restaurante_users DROP CONSTRAINT IF EXISTS restaurante_users_restaurant_id_apelido_key CASCADE;
-- UNIQUE (restaurant_id, apelido) mas permite múltiplos NULLs
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurante_users_apelido
  ON restaurante_users(restaurant_id, apelido)
  WHERE apelido IS NOT NULL;

-- Trigger: auto-gerar apelido a partir do nome se não for fornecido
CREATE OR REPLACE FUNCTION gerar_apelido_padrao()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.apelido IS NULL OR NEW.apelido = '' THEN
    NEW.apelido := LOWER(REGEXP_REPLACE(
      SPLIT_PART(NEW.nome, ' ', 1) || '.' || SPLIT_PART(NEW.nome, ' ', 2),
      '[^a-z0-9.]',
      '',
      'g'
    ));
    -- Garantir unicidade adicionando sufixo se necessário
    WHILE EXISTS (SELECT 1 FROM restaurante_users WHERE apelido = NEW.apelido AND restaurant_id = NEW.restaurant_id AND id != COALESCE(NEW.id, 0)) LOOP
      NEW.apelido := NEW.apelido || FLOOR(RANDOM() * 100)::TEXT;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_restaurante_users_apelido ON restaurante_users;
CREATE TRIGGER trg_restaurante_users_apelido
  BEFORE INSERT OR UPDATE OF nome ON restaurante_users
  FOR EACH ROW
  WHEN (NEW.apelido IS NULL OR NEW.apelido = '')
  EXECUTE FUNCTION gerar_apelido_padrao();

COMMIT;
