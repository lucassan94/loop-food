-- ============================================================================
-- SABOREXPRESS - Migration 025: Credenciais Rede Pagamentos (e-Rede v2 / OAuth2)
-- PostgreSQL 16
-- ============================================================================
-- Substituição da API Asaas pela API da Rede (e-Rede v2).
--
-- A autenticação da Rede é OAuth2:
--   PV (número de filiação)            = clientId  -> rede_client_id
--   Chave de Integração (portal Rede)  = clientSecret -> rede_client_secret
--
-- Campos configuráveis por tenant no módulo god:
--   rede_env            -> sandbox | production
--   rede_client_id      -> PV (filiação), sem zeros à esquerda
--   rede_client_secret  -> Chave de Integração (clientSecret OAuth2)
--   rede_webhook_token  -> token ESCOLHIDO POR NÓS, enviado à Rede no cadastro
--                          da URL de notificação (header Authorization Bearer)
--                          e validado quando a Rede nos chama.
--
-- NOTA: as colunas asaas_* NÃO são removidas aqui — serão removidas na Fase 11
-- (remoção total do Asaas), junto com todo o código que ainda as referencia
-- (services/asaas.js, tenantResolver, pagamentos, config).
-- ============================================================================

BEGIN;

ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS rede_env VARCHAR(10) DEFAULT 'sandbox';
ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS rede_client_id TEXT;
ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS rede_client_secret TEXT;
ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS rede_webhook_token TEXT;

-- Índice auxiliar para localizar tenants com Rede configurada
CREATE INDEX IF NOT EXISTS idx_restaurantes_rede_client ON restaurantes(rede_client_id);

COMMIT;
