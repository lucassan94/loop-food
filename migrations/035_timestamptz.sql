-- ============================================================================
-- Migration 035: timestamp → timestamptz (elimina a classe de bug de fuso)
-- ============================================================================
-- Contexto (BUG-017): o banco grava horários como `timestamp without time zone`
-- em UTC (sessão Etc/UTC, NOW() do servidor), mas o driver node-postgres lê e
-- escreve esses valores conforme o fuso LOCAL do processo Node. Com o container
-- em TZ=America/Sao_Paulo (docker-compose), toda data saía +3h deslocada na API
-- (tempo de preparo/previsão errados no frontend) e writes com `new Date()` do
-- Node gravavam hora local. A conversão para `timestamptz` (instante absoluto,
-- armazenado em UTC) torna leitura E escrita corretas em QUALQUER fuso do
-- processo — sem depender de parser customizado.
--
-- ⚠️ A interpretação é EXPLÍCITA: valores existentes são tratados como UTC
-- (`AT TIME ZONE 'UTC'`) — foi assim que foram gravados (NOW() com sessão
-- Etc/UTC). NÃO usar o fuso da sessão aqui, senão os instantes mudariam.
--
-- 🔁 IDEMPOTENTE: o migrate.js roda TODAS as migrations a cada deploy (não há
-- tabela de controle). O DO block converte apenas as colunas que ainda forem
-- `timestamp without time zone` (aplicado em BASE TABLEs — informação_schema
-- também lista views, que não aceitam ALTER TYPE); após a primeira execução o
-- loop não encontra nada e a migration vira um no-op.
--
-- ⚠️ Garantia por CONVENÇÃO: a 035 converte as colunas que existem hoje. Uma
-- migration futura que criar coluna `timestamp without time zone` NOVA volta a
-- introduzir a classe de bug (a regra de escrita está documentada em
-- config/database.js: prefira sempre `timestamptz` + NOW()).
-- ============================================================================

DO $$
DECLARE
  r record;
  convertidas int := 0;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.data_type = 'timestamp without time zone'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
      r.table_name, r.column_name, r.column_name
    );
    convertidas := convertidas + 1;
    RAISE NOTICE 'Convertida: %.%', r.table_name, r.column_name;
  END LOOP;

  IF convertidas > 0 THEN
    RAISE NOTICE '✅ % coluna(s) convertida(s) para timestamptz.', convertidas;
  ELSE
    RAISE NOTICE 'ℹ️ Nenhuma coluna timestamp (sem tz) restante — migration já aplicada (no-op).';
  END IF;
END $$;

-- ============================================================================
-- HARDENING: garante que comparações com datas-string/CURRENT_DATE usem UTC
-- (padrão atual da sessão Etc/UTC), independente de quem conectar. As funções
-- de horário do restaurante usam Intl com timezone explícito (não dependem da
-- sessão), então isto é seguro e torna o contrato explícito. Usa
-- current_database() para não quebrar ambientes com DB_NAME diferente
-- (migrate.js lê DB_NAME do env).
-- ============================================================================
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO ''UTC''', current_database());
END $$;
