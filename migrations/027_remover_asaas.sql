-- ============================================================================
-- SABOREXPRESS - Migration 027: Remoção total do Asaas (Fase 11)
-- PostgreSQL 16
-- ============================================================================
-- Remove as colunas legadas da integração Asaas, já substituída pela
-- API da Rede (e-Rede v2 / OAuth2).
--
-- Removidas:
--   restaurantes.asaas_api_key, asaas_env, asaas_webhook_token, asaas_webhook_secret
--   clientes.asaas_customer_id
--
-- Mantidas de propósito:
--   pagamentos.customer_id      → NULL-able; o módulo atual insere NULL (Rede não usa customer)
--   pagamentos.invoice_url / credit_card_token / valor_liquido / taxa
--                              → colunas do schema Asaas ainda presentes; sem uso na Rede.
--   webhook_events             → usada pelo dedup de webhooks da Rede
-- ============================================================================

BEGIN;

-- ─── 1. RESTAURANTES: dropar credenciais Asaas ───
ALTER TABLE restaurantes DROP COLUMN IF EXISTS asaas_api_key;
ALTER TABLE restaurantes DROP COLUMN IF EXISTS asaas_env;
ALTER TABLE restaurantes DROP COLUMN IF EXISTS asaas_webhook_token;
ALTER TABLE restaurantes DROP COLUMN IF EXISTS asaas_webhook_secret;

-- ─── 2. CLIENTES: dropar customer_id do Asaas ───
ALTER TABLE clientes DROP COLUMN IF EXISTS asaas_customer_id;

COMMIT;
