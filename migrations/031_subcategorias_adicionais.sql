-- ============================================================
-- MIGRATION 031: Subcategorias de Adicionais (catálogo compartilhado)
-- ============================================================
-- O restaurante pré-cadastra subcategorias COM seus itens e preço
-- (catálogo global por restaurante), ex:
--   "Porções": arroz 5,00 / feijão 4,00 / batata 6,00 ...
--   "Extra"  : queijo / carne / molho ...
--   "Bebidas": Coca-Cola / Água / Chá / Cerveja ...
-- Depois, em cada produto, o restaurante apenas marca quais
-- subcategorias aparecem (produto_extra_subcategorias) — os itens
-- vêm junto do catálogo (mesmo preço em todos os produtos).
-- Os adicionais avulsos antigos (produtos_extras) continuam
-- funcionando e aparecem no grupo "Geral" (retrocompatível).
-- ============================================================

-- 1. Subcategorias (catálogo por restaurante)
CREATE TABLE IF NOT EXISTS extra_subcategorias (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extra_subcategorias_restaurant ON extra_subcategorias(restaurant_id);

-- 2. Itens do catálogo (compartilhados entre produtos)
CREATE TABLE IF NOT EXISTS extra_subcategoria_itens (
    id SERIAL PRIMARY KEY,
    subcategoria_id INTEGER NOT NULL REFERENCES extra_subcategorias(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,
    preco DECIMAL(10,2) NOT NULL DEFAULT 0,
    maximo INTEGER NOT NULL DEFAULT 1,           -- 1 = checkbox; >1 = seletor de qty
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extra_subcategoria_itens_sub ON extra_subcategoria_itens(subcategoria_id);

-- 3. Quais subcategorias aparecem em cada produto
CREATE TABLE IF NOT EXISTS produto_extra_subcategorias (
    produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
    subcategoria_id INTEGER NOT NULL REFERENCES extra_subcategorias(id) ON DELETE CASCADE,
    PRIMARY KEY (produto_id, subcategoria_id)
);

-- ────────────────────────────────────────────────────────────
-- RLS (padrão produtos_extras: isolamento WITH CHECK + público + staff)
-- ────────────────────────────────────────────────────────────

-- extra_subcategorias
ALTER TABLE extra_subcategorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS extra_subcategorias_restaurant_isolation ON extra_subcategorias;
CREATE POLICY extra_subcategorias_restaurant_isolation ON extra_subcategorias
    FOR ALL
    USING (restaurant_id = current_setting('app.restaurant_id')::integer)
    WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);

DROP POLICY IF EXISTS extra_subcategorias_public_select ON extra_subcategorias;
CREATE POLICY extra_subcategorias_public_select ON extra_subcategorias
    FOR SELECT
    USING (restaurant_id = current_setting('app.restaurant_id', true)::integer);

DROP POLICY IF EXISTS extra_subcategorias_staff ON extra_subcategorias;
CREATE POLICY extra_subcategorias_staff ON extra_subcategorias
    FOR ALL
    USING (
        restaurant_id = current_setting('app.restaurant_id', true)::integer
        AND current_setting('app.user_role', true) = 'restaurante'
        AND current_setting('app.user_cargo', true) IN ('admin', 'gerente', 'chef')
    );

-- extra_subcategoria_itens
ALTER TABLE extra_subcategoria_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS extra_subcategoria_itens_restaurant_isolation ON extra_subcategoria_itens;
CREATE POLICY extra_subcategoria_itens_restaurant_isolation ON extra_subcategoria_itens
    FOR ALL
    USING (
        subcategoria_id IN (
            SELECT id FROM extra_subcategorias
            WHERE restaurant_id = current_setting('app.restaurant_id')::integer
        )
    )
    WITH CHECK (
        subcategoria_id IN (
            SELECT id FROM extra_subcategorias
            WHERE restaurant_id = current_setting('app.restaurant_id')::integer
        )
    );

DROP POLICY IF EXISTS extra_subcategoria_itens_public_select ON extra_subcategoria_itens;
CREATE POLICY extra_subcategoria_itens_public_select ON extra_subcategoria_itens
    FOR SELECT
    USING (
        subcategoria_id IN (
            SELECT id FROM extra_subcategorias
            WHERE restaurant_id = current_setting('app.restaurant_id', true)::integer
        )
    );

DROP POLICY IF EXISTS extra_subcategoria_itens_staff ON extra_subcategoria_itens;
CREATE POLICY extra_subcategoria_itens_staff ON extra_subcategoria_itens
    FOR ALL
    USING (
        subcategoria_id IN (
            SELECT id FROM extra_subcategorias
            WHERE restaurant_id = current_setting('app.restaurant_id', true)::integer
        )
        AND current_setting('app.user_role', true) = 'restaurante'
        AND current_setting('app.user_cargo', true) IN ('admin', 'gerente', 'chef')
    );

-- produto_extra_subcategorias (isola via produto)
ALTER TABLE produto_extra_subcategorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS produto_extra_subcategorias_restaurant_isolation ON produto_extra_subcategorias;
CREATE POLICY produto_extra_subcategorias_restaurant_isolation ON produto_extra_subcategorias
    FOR ALL
    USING (
        produto_id IN (
            SELECT id FROM produtos
            WHERE restaurant_id = current_setting('app.restaurant_id')::integer
        )
    )
    WITH CHECK (
        produto_id IN (
            SELECT id FROM produtos
            WHERE restaurant_id = current_setting('app.restaurant_id')::integer
        )
        AND subcategoria_id IN (
            SELECT id FROM extra_subcategorias
            WHERE restaurant_id = current_setting('app.restaurant_id')::integer
        )
    );

DROP POLICY IF EXISTS produto_extra_subcategorias_public_select ON produto_extra_subcategorias;
CREATE POLICY produto_extra_subcategorias_public_select ON produto_extra_subcategorias
    FOR SELECT
    USING (
        produto_id IN (
            SELECT id FROM produtos
            WHERE restaurant_id = current_setting('app.restaurant_id', true)::integer
            AND ativo = true
        )
    );

DROP POLICY IF EXISTS produto_extra_subcategorias_staff ON produto_extra_subcategorias;
CREATE POLICY produto_extra_subcategorias_staff ON produto_extra_subcategorias
    FOR ALL
    USING (
        produto_id IN (
            SELECT id FROM produtos
            WHERE restaurant_id = current_setting('app.restaurant_id', true)::integer
        )
        AND current_setting('app.user_role', true) = 'restaurante'
        AND current_setting('app.user_cargo', true) IN ('admin', 'gerente', 'chef')
    );

-- ────────────────────────────────────────────────────────────
-- GRANTs (defensivo: se app_user não existir, ignora)
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON extra_subcategorias TO app_user;
        GRANT USAGE, SELECT ON SEQUENCE extra_subcategorias_id_seq TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON extra_subcategoria_itens TO app_user;
        GRANT USAGE, SELECT ON SEQUENCE extra_subcategoria_itens_id_seq TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON produto_extra_subcategorias TO app_user;
    END IF;
END $$;
