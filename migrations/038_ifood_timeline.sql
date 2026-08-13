-- ============================================================================
-- KARDAPIO DIGITAL - Migration 038: timeline aceita usuario_tipo 'ifood'
-- PostgreSQL 16
-- ============================================================================
-- Os eventos/processamento do iFood registram a timeline com usuario_tipo
-- 'ifood' (Fases 3-4). O CHECK original (migration 001) só aceitava
-- sistema/cliente/entregador/restaurante.
--
-- Idempotente: migrate.js re-executa todos os .sql a cada deploy.
-- ============================================================================

BEGIN;

ALTER TABLE pedido_timeline DROP CONSTRAINT IF EXISTS pedido_timeline_usuario_tipo_check;
ALTER TABLE pedido_timeline ADD CONSTRAINT pedido_timeline_usuario_tipo_check
  CHECK (usuario_tipo IN ('sistema', 'cliente', 'entregador', 'restaurante', 'ifood'));

COMMIT;
