-- ============================================================================
-- KARDAPIO DIGITAL - Migration 035: Renomear slug/domínio do tenant
--   'saborexpress' → 'kardapio'  (rebranding da marca)
--   Também atualiza o nome de exibição do restaurante para 'Kardapio Digital'.
--
-- PostgreSQL 16 | Aplicar em produção JUNTO com a troca de DNS/NPM
-- (os subdomínios kardapio.* devem estar apontando antes para não gerar 404).
-- Idempotente: rodar de novo não causa dano (WHERE filtra os já renomeados).
-- ============================================================================

-- ⚠️ migrate.js re-executa TODOS os .sql a cada deploy (sem tabela de tracking).
-- Esta migration DEVE permanecer re-executável: após a 1ª aplicação, 'kardapio'
-- já existe e a guarda de conflito NÃO pode disparar (no-op silencioso).
DO $$
DECLARE
  v_id INTEGER;
BEGIN
  -- Guarda contra conflito REAL de UNIQUE: ainda existe tenant 'saborexpress'
  -- E já existe tenant 'kardapio' (slug e dominio são UNIQUE em restaurantes).
  IF EXISTS (SELECT 1 FROM restaurantes WHERE slug = 'saborexpress' OR dominio = 'saborexpress')
     AND EXISTS (SELECT 1 FROM restaurantes WHERE slug = 'kardapio' OR dominio = 'kardapio') THEN
    RAISE EXCEPTION 'Já existe tenant com slug ou dominio "kardapio". Abortando rename de "saborexpress".';
  END IF;

  UPDATE restaurantes
     SET slug = 'kardapio',
         dominio = 'kardapio',
         nome = 'Kardapio Digital'
   WHERE slug = 'saborexpress' OR dominio = 'saborexpress'
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE NOTICE 'Nenhum tenant com slug/dominio "saborexpress" encontrado. Nada a fazer.';
  ELSE
    RAISE NOTICE 'Tenant #% renomeado: slug/dominio -> kardapio, nome -> Kardapio Digital', v_id;
  END IF;
END $$;
