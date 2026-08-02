-- ============================================================================
-- Migration 016: Adiciona coluna de formas de pagamento aceitas
-- Permite que cada restaurante configure quais métodos de pagamento aceita
-- ============================================================================

ALTER TABLE restaurantes
  ADD COLUMN IF NOT EXISTS formas_pagamento_aceitas JSONB NOT NULL DEFAULT '["dinheiro", "credito", "debito", "pix", "pix_online", "credito_online"]';
