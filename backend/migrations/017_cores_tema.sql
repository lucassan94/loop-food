-- ============================================================================
-- MIGRATION 017: Cores do Tema (Personalização da Marca)
-- ============================================================================
-- Adiciona colunas para personalização das cores do restaurante
-- Os valores são hexadecimais (ex: #dc2626) e podem ser alterados
-- pelo admin no painel de Configurações.
-- ============================================================================

ALTER TABLE IF EXISTS restaurantes
  ADD COLUMN IF NOT EXISTS cor_primaria VARCHAR(7) DEFAULT '#dc2626',
  ADD COLUMN IF NOT EXISTS cor_secundaria VARCHAR(7) DEFAULT '#f97316',
  ADD COLUMN IF NOT EXISTS cor_terciaria VARCHAR(7) DEFAULT '#3b82f6';
