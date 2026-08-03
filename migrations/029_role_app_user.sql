-- ============================================================================
-- MIGRATION 029 — Role app_user (não-superuser) + RLS com WITH CHECK
-- ============================================================================
-- Corrige BUG-016: o backend operava como o superuser 'default', o que faz o
-- RLS de todas as tabelas ser BYPASSADO. A partir desta migration o backend
-- deve conectar como a role app_user (NOSUPERUSER + NOBYPASSRLS), forçando o
-- isolamento por tenant no próprio banco (defesa em profundidade).
--
-- O QUE ESTA MIGRATION FAZ:
--   1. Cria a role app_user (senha NÃO é commitada — placeholder substituído
--      em tempo de aplicação; veja abaixo).
--   2. GRANTs: schema, tabelas, sequences e default privileges.
--   3. Adiciona WITH CHECK em TODAS as policies de isolamento existentes
--      (sem WITH CHECK, INSERT/UPDATE de uma role não-superuser são NEGADOS
--      pelo RLS em todas as tabelas — "new row violates row-level security").
--   4. Habilita RLS + policy de isolamento (com WITH CHECK) nas 4 tabelas
--      que ainda não tinham: banners, categorias, pagamentos, raios_entrega.
--
-- TABELAS SEM RLS (intencional — fluxos cross-tenant por design):
--   - restaurantes     : tenantResolver resolve por dominio/slug ANTES do
--                        contexto existir; rede.js lê credenciais por id.
--   - refresh_tokens   : tabela legada (não usada no fluxo JWT atual).
--   - webhook_events   : dedup de webhooks da Rede é cross-tenant por design.
--   Documentado em project-manager/02. bugs-aware.md.
--
-- ⚠️ SENHA DO APP_USER (NUNCA commitar em git — repo é PÚBLICO):
--   O placeholder __APP_DB_PASSWORD__ é substituído em tempo de aplicação:
--     - via migrate.js : usa process.env.DB_PASS (override do Portainer)
--     - via psql manual: sed "s/__APP_DB_PASSWORD__/SUASENHA/g" antes de aplicar
--   Se o placeholder chegar ao banco (deploy sem override), o login falha
--   ruidosamente — comportamento desejado (fail-closed).
--
-- AMBIENTE ESPERADO (stack.env / Portainer overrides):
--   DB_USER=app_user          (runtime do backend)
--   DB_PASS=<senha forte>     (override no Portainer — NÃO commitar)
--   DB_ADMIN_USER=default     (somente migrations/seeds)
--   DB_ADMIN_PASS=default     (troque após rotacionar a senha do superuser)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. ROLE app_user
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠️ RE-RUN SAFE (o migrate.js re-executa todas as migrations em cada deploy,
--    sem tabela de tracking). A senha SÓ é definida/alterada quando o role ainda
--    não tem senha — assim um re-run com DB_PASS vazio (placeholder literal)
--    NÃO sobrescreve a senha real definida via override do Portainer.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
      PASSWORD '__APP_DB_PASSWORD__';
  ELSE
    ALTER ROLE app_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    IF NOT EXISTS (
      SELECT 1 FROM pg_authid a JOIN pg_roles r ON r.oid = a.oid
      WHERE r.rolname = 'app_user' AND a.rolpassword IS NOT NULL
    ) THEN
      EXECUTE format('ALTER ROLE app_user PASSWORD %L', '__APP_DB_PASSWORD__');
    END IF;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. GRANTs
-- ────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Tabelas/funções criadas FUTURAMENTE (migrations rodam como admin) também
-- ficam acessíveis ao app_user automaticamente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. WITH CHECK nas policies de isolamento existentes
--    (DROP + CREATE preservando a USING original e adicionando WITH CHECK)
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS clientes_restaurant_isolation ON clientes;
CREATE POLICY clientes_restaurant_isolation ON clientes
  USING (restaurant_id = current_setting('app.restaurant_id')::integer)
  WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);

DROP POLICY IF EXISTS entregadores_restaurant_isolation ON entregadores;
CREATE POLICY entregadores_restaurant_isolation ON entregadores
  USING (restaurant_id = current_setting('app.restaurant_id')::integer)
  WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);

DROP POLICY IF EXISTS restaurante_users_restaurant_isolation ON restaurante_users;
CREATE POLICY restaurante_users_restaurant_isolation ON restaurante_users
  USING (restaurant_id = current_setting('app.restaurant_id')::integer)
  WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);

DROP POLICY IF EXISTS produtos_restaurant_isolation ON produtos;
CREATE POLICY produtos_restaurant_isolation ON produtos
  USING (restaurant_id = current_setting('app.restaurant_id')::integer)
  WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);

DROP POLICY IF EXISTS produtos_extras_restaurant_isolation ON produtos_extras;
CREATE POLICY produtos_extras_restaurant_isolation ON produtos_extras
  USING (produto_id IN (
    SELECT id FROM produtos
    WHERE restaurant_id = current_setting('app.restaurant_id')::integer
  ))
  WITH CHECK (produto_id IN (
    SELECT id FROM produtos
    WHERE restaurant_id = current_setting('app.restaurant_id')::integer
  ));

DROP POLICY IF EXISTS pedidos_restaurant_isolation ON pedidos;
CREATE POLICY pedidos_restaurant_isolation ON pedidos
  USING (restaurant_id = current_setting('app.restaurant_id')::integer)
  WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);

DROP POLICY IF EXISTS pedido_itens_restaurant_isolation ON pedido_itens;
CREATE POLICY pedido_itens_restaurant_isolation ON pedido_itens
  USING (pedido_id IN (
    SELECT id FROM pedidos
    WHERE restaurant_id = current_setting('app.restaurant_id')::integer
  ))
  WITH CHECK (pedido_id IN (
    SELECT id FROM pedidos
    WHERE restaurant_id = current_setting('app.restaurant_id')::integer
  ));

DROP POLICY IF EXISTS pedido_timeline_restaurant_isolation ON pedido_timeline;
CREATE POLICY pedido_timeline_restaurant_isolation ON pedido_timeline
  USING (pedido_id IN (
    SELECT id FROM pedidos
    WHERE restaurant_id = current_setting('app.restaurant_id')::integer
  ))
  WITH CHECK (pedido_id IN (
    SELECT id FROM pedidos
    WHERE restaurant_id = current_setting('app.restaurant_id')::integer
  ));

DROP POLICY IF EXISTS mensagens_pedido_restaurant_isolation ON mensagens_pedido;
CREATE POLICY mensagens_pedido_restaurant_isolation ON mensagens_pedido
  USING (restaurante_id = current_setting('app.restaurant_id')::integer)
  WITH CHECK (restaurante_id = current_setting('app.restaurant_id')::integer);

DROP POLICY IF EXISTS mesas_restaurant_isolation ON mesas;
CREATE POLICY mesas_restaurant_isolation ON mesas
  USING (restaurant_id = current_setting('app.restaurant_id')::integer)
  WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);

-- imagens_tenant_isolation (migration 028) JÁ possui WITH CHECK — mantida.

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS nas 4 tabelas sem isolamento
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE banners ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'banners_tenant_isolation') THEN
    CREATE POLICY banners_tenant_isolation ON banners
      USING (restaurant_id = current_setting('app.restaurant_id')::integer)
      WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);
  END IF;
END $$;

ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'categorias_tenant_isolation') THEN
    CREATE POLICY categorias_tenant_isolation ON categorias
      USING (restaurant_id = current_setting('app.restaurant_id')::integer)
      WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);
  END IF;
END $$;

ALTER TABLE pagamentos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pagamentos_tenant_isolation') THEN
    CREATE POLICY pagamentos_tenant_isolation ON pagamentos
      USING (restaurant_id = current_setting('app.restaurant_id')::integer)
      WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);
  END IF;
END $$;

ALTER TABLE raios_entrega ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'raios_entrega_tenant_isolation') THEN
    CREATE POLICY raios_entrega_tenant_isolation ON raios_entrega
      USING (restaurant_id = current_setting('app.restaurant_id')::integer)
      WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Verificação (opcional — descomente para conferir)
-- ────────────────────────────────────────────────────────────────────────────
-- SELECT tablename, policyname, cmd, with_check IS NOT NULL AS tem_check
-- FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
