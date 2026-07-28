-- ============================================================================
-- Migration: Adiciona opção de desligar etapas do entregador
-- ============================================================================
-- Quando modo_sem_entregador = true:
--   - O restaurante gerencia todos os status manualmente
--   - Os status em_transito e cheguei_destino são pulados
--   - O entregador não pode assumir entregas deste restaurante
--   - O restaurante confirma a entrega diretamente de pronto_entrega → entregue
-- ============================================================================

ALTER TABLE restaurantes
  ADD COLUMN IF NOT EXISTS modo_sem_entregador BOOLEAN NOT NULL DEFAULT false;
