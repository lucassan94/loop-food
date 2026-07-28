-- ============================================================================
-- SABOREXPRESS - Migration 013: Unique constraint on raios_entrega
-- PostgreSQL 16
-- ============================================================================
-- Adiciona UNIQUE (restaurant_id, raio_km) para garantir que cada tenant
-- tenha no máximo UM raio de entrega com a mesma quilometragem.
-- Isso também permite usar ON CONFLICT DO NOTHING no seed, tornando-o
-- totalmente idempotente.
-- ============================================================================

-- Remover duplicatas antes de criar a constraint (se houver)
DELETE FROM raios_entrega a USING raios_entrega b
WHERE a.id < b.id
  AND a.restaurant_id = b.restaurant_id
  AND a.raio_km = b.raio_km;

-- Adicionar UNIQUE constraint
ALTER TABLE raios_entrega ADD CONSTRAINT raios_entrega_unique_tenant_raio
  UNIQUE (restaurant_id, raio_km);
