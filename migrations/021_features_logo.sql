-- ============================================================================
-- Migration 021: Features por tenant + Logo upload
-- ============================================================================

-- Coluna para ativar/desativar funcionalidades por tenant
ALTER TABLE restaurantes
  ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{"salao": true, "delivery": true}';

-- Coluna para logo (base64) do restaurante
ALTER TABLE restaurantes
  ADD COLUMN IF NOT EXISTS logo_base64 TEXT;
