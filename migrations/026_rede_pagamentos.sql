-- ============================================================================
-- SABOREXPRESS - Migration 026: Adaptações para a API da Rede (e-Rede v2)
-- PostgreSQL 16
-- ============================================================================
-- Ajustes na tabela pagamentos para o modelo da Rede:
--   - payment_id  = TID da transação (cartão e PIX)  [já é VARCHAR — sem mudança]
--   - customer_id = e-Rede NÃO usa customer -> torna-se NULL-able (mantido p/ compat)
--   - Novos campos de rastreio: nsu, authorization_code, return_code,
--     end_to_end_id (PIX/BACEN) e gateway ('rede')
--   - billing_type passa a aceitar também DEBIT_CARD (VARCHAR — sem CHECK, ok)
--   - status segue mapeamento Rede (VARCHAR — sem CHECK, ok)
-- Também inclui 'debito_online' no CHECK de pedidos.metodo_pagamento.
-- ============================================================================

BEGIN;

-- ─── 1. PAGAMENTOS: adaptar colunas ───
ALTER TABLE pagamentos ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS nsu VARCHAR(20);
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS authorization_code VARCHAR(20);
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS return_code VARCHAR(10);
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS end_to_end_id VARCHAR(50);
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS gateway VARCHAR(20) DEFAULT 'rede';

CREATE INDEX IF NOT EXISTS idx_pagamentos_end_to_end ON pagamentos(end_to_end_id);

-- ─── 2. PEDIDOS: debito_online no CHECK de metodo_pagamento ───
-- IMPORTANTE: preservar 'salao' e 'conta' (adicionados na migration 017) —
-- recriar o CHECK sem eles quebraria os pagamentos de salão/PDV.
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_metodo_pagamento_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_metodo_pagamento_check
  CHECK (metodo_pagamento IN (
    'dinheiro', 'credito', 'debito', 'pix', 'pix_online', 'credito_online', 'debito_online', 'salao', 'conta'
  ));

COMMIT;
