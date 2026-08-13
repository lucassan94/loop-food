-- ============================================================================
-- KARDAPIO DIGITAL - Migration 036: Integração iFood (pedidos + catálogo)
-- PostgreSQL 16
-- ============================================================================
-- Estrutura de dados da integração com a API do iFood (parceiro de software).
--
-- Modelo multitenant:
--   - Credenciais OAuth (clientId/clientSecret) são GLOBAIS da plataforma (ISV),
--     definidas por env (IFOOD_CLIENT_ID/IFOOD_CLIENT_SECRET) — NÃO ficam aqui.
--   - ifood_settings: configuração POR RESTAURANTE (merchantId, ativo, ambiente).
--   - ifood_orders:    mapeamento pedido iFood (orderId) <-> pedido interno.
--   - ifood_events:    dedup/log dos eventos consumidos no events:polling.
--
-- Idempotente (IF NOT EXISTS): o migrate.js re-executa todos os .sql a cada
-- deploy — esta migration deve permanecer re-executável.
-- ============================================================================

BEGIN;

-- ── Configuração por tenant ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ifood_settings (
  restaurant_id  INTEGER PRIMARY KEY REFERENCES restaurantes(id) ON DELETE CASCADE,
  ativo          BOOLEAN NOT NULL DEFAULT false,
  ambiente       VARCHAR(10) NOT NULL DEFAULT 'sandbox',  -- sandbox | producao
  merchant_id    VARCHAR(50),
  delivery_mode  VARCHAR(20) NOT NULL DEFAULT 'own',      -- own (entrega própria) | ifood
  sync_catalogo  BOOLEAN NOT NULL DEFAULT false,
  ultima_sync_em TIMESTAMPTZ,
  ultimo_erro    TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Mapeamento pedido iFood <-> pedido interno ──────────────────────────
CREATE TABLE IF NOT EXISTS ifood_orders (
  id             BIGSERIAL PRIMARY KEY,
  restaurant_id  INTEGER NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
  ifood_order_id VARCHAR(50) NOT NULL,
  pedido_id      INTEGER REFERENCES pedidos(id),
  display_id     VARCHAR(20),
  status_ifood   VARCHAR(30),
  ultimo_evento  VARCHAR(50),
  raw_payload    JSONB,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, ifood_order_id)
);

-- ── Dedup/log de eventos do polling ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ifood_events (
  id             BIGSERIAL PRIMARY KEY,
  event_id       VARCHAR(100) NOT NULL UNIQUE,   -- id do evento no events:polling
  event_code     VARCHAR(50),
  ifood_order_id VARCHAR(50),
  processed      BOOLEAN NOT NULL DEFAULT FALSE,
  error          TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ifood_orders_pedido ON ifood_orders(pedido_id);
CREATE INDEX IF NOT EXISTS idx_ifood_orders_status ON ifood_orders(status_ifood);
CREATE INDEX IF NOT EXISTS idx_ifood_events_processed ON ifood_events(processed);

COMMIT;
