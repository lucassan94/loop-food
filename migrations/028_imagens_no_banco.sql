-- ============================================================================
-- MIGRATION 028 — Imagens no banco (tabela imagens)
-- ============================================================================
-- Motivação: o deploy via GitHub (Portainer) não monta mais o volume de
-- uploads; as imagens (cardápio, banners, logos, entregadores, categorias)
-- passam a viver no Postgres, viajando com o banco (backups incluem imagens).
--
-- URLs públicas NÃO mudam: /uploads/{tenantId}/{tipo}/{filename}
--   O backend serve os bytes daqui em vez do disco.
--
-- RLS:
--   - SELECT: pública (as URLs de imagem do cardápio/banners são públicas)
--   - INSERT/UPDATE/DELETE: isoladas por tenant (app.restaurant_id)
-- ============================================================================

CREATE TABLE IF NOT EXISTS imagens (
  id            BIGSERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL,
  tipo          VARCHAR(32) NOT NULL,   -- cardapio, banners, entregadores, categorias, logos
  filename      VARCHAR(255) NOT NULL,
  mime          VARCHAR(100) NOT NULL DEFAULT 'image/jpeg',
  dados         BYTEA NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, tipo, filename)
);

CREATE INDEX IF NOT EXISTS idx_imagens_rest_tipo ON imagens (restaurant_id, tipo);

ALTER TABLE imagens ENABLE ROW LEVEL SECURITY;

-- SELECT público: a URL /uploads/... é consumida por qualquer visitante
-- (mesmo comportamento atual — as rotas /uploads não exigem autenticação).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'imagens_select_public') THEN
    CREATE POLICY imagens_select_public ON imagens
      FOR SELECT USING (true);
  END IF;
END $$;

-- Escrita isolada por tenant (mesmo padrão das demais tabelas)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'imagens_tenant_isolation') THEN
    CREATE POLICY imagens_tenant_isolation ON imagens
      USING (restaurant_id = current_setting('app.restaurant_id')::integer)
      WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);
  END IF;
END $$;
