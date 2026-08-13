-- ============================================================================
-- KARDAPIO DIGITAL - Migration 037: Pedidos iFood (origem + auto-aceite + RLS)
-- PostgreSQL 16
-- ============================================================================
-- Fases 3-4 da integração iFood:
--   1. pedidos.origem aceita 'ifood' (pedidos vindos do iFood entram na fila).
--   2. pedidos.metodo_pagamento aceita 'ifood' (pagamento processado pelo iFood).
--   3. ifood_settings.auto_aceite — aceitar automaticamente os pedidos
--      (SLA ~5-7min do iFood; recomendado para evitar cancelamento automático).
--   4. RLS por tenant em ifood_settings e ifood_orders (defesa em profundidade,
--      alinhada à migration 029). ifood_events permanece SEM RLS por design
--      (dedup cross-tenant, como webhook_events).
--
-- Idempotente: migrate.js re-executa todos os .sql a cada deploy.
-- ============================================================================

BEGIN;

-- ── 1. PEDIDOS: origem aceita 'ifood' ─────────────────────────────────────
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_origem_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_origem_check
  CHECK (origem IN ('delivery', 'salao', 'retirada', 'ifood'));

-- ── 2. PEDIDOS: metodo_pagamento aceita 'ifood' ───────────────────────────
-- Preserva as formas existentes (017 + 026) e adiciona 'ifood'.
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_metodo_pagamento_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_metodo_pagamento_check
  CHECK (metodo_pagamento IN (
    'dinheiro', 'credito', 'debito', 'pix', 'pix_online',
    'credito_online', 'debito_online', 'salao', 'conta', 'ifood'
  ));

-- ── 3. ifood_settings: auto_aceite ────────────────────────────────────────
ALTER TABLE ifood_settings ADD COLUMN IF NOT EXISTS auto_aceite BOOLEAN NOT NULL DEFAULT false;

-- ── 4. RLS nas tabelas ifood ──────────────────────────────────────────────
ALTER TABLE ifood_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ifood_settings_tenant_isolation ON ifood_settings;
CREATE POLICY ifood_settings_tenant_isolation ON ifood_settings
  USING (restaurant_id = current_setting('app.restaurant_id')::integer)
  WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);

ALTER TABLE ifood_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ifood_orders_tenant_isolation ON ifood_orders;
CREATE POLICY ifood_orders_tenant_isolation ON ifood_orders
  USING (restaurant_id = current_setting('app.restaurant_id')::integer)
  WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);

COMMIT;
