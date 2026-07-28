-- ============================================================================
-- loop-food - Migration 014: JWT Secret por Tenant
-- PostgreSQL 16
-- ============================================================================
-- Adiciona coluna jwt_secret na tabela restaurantes para permitir que
-- cada tenant tenha seu próprio segredo JWT. Isso garante isolamento:
-- tokens do Tenant A não funcionam no Tenant B.
--
-- O segredo é gerado automaticamente pelo backend no primeiro login
-- (via crypto.randomBytes) ou pode ser definido manualmente.
--
-- Fallback: se jwt_secret for NULL, o backend usa o JWT_SECRET global do .env.
-- ============================================================================

ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS jwt_secret TEXT;

COMMENT ON COLUMN restaurantes.jwt_secret IS 'Segredo JWT exclusivo do tenant. Gerado automaticamente. Se NULL, usa fallback global JWT_SECRET do .env.';
