-- ============================================================
-- MIGRATION 033: Catálogo do Cardápio (Opções Padrão + Subcategorias avançadas)
-- ============================================================
-- 1. extra_subcategoria_itens:
--    - descricao: descrição do item (ex: "Arroz branco soltinho")
--    - imagem_url / imagem_base64: imagem própria do item
-- 2. extra_subcategorias:
--    - tipo: 'manual' (itens pré-cadastrados) | 'categoria'
--      (itens = produtos ATIVOS de uma categoria do cardápio inteira,
--      com o preço do próprio produto — ex: usar "Bebidas" inteira)
--    - categoria_id: categoria do cardápio usada quando tipo='categoria'
-- 3. opcoes_padrao / opcoes_padrao_itens: catálogo compartilhado de
--    "Opções do Prato" (grupos gratuitos reutilizáveis, ex: "Ponto da
--    carne"). Produtos VINCULAM grupos padrão (vínculo ao vivo — editar
--    o grupo atualiza todos os produtos vinculados).
-- 4. produto_opcoes_padrao: vínculo produto ↔ grupo padrão.
-- ============================================================

-- ── Subcategorias: tipo + categoria do cardápio ──
ALTER TABLE extra_subcategorias
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(10) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL;

-- ── Itens de subcategoria: imagem + descrição ──
ALTER TABLE extra_subcategoria_itens
  ADD COLUMN IF NOT EXISTS descricao TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS imagem_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS imagem_base64 TEXT NOT NULL DEFAULT '';

-- ── Opções Padrão do Prato (catálogo compartilhado) ──
CREATE TABLE IF NOT EXISTS opcoes_padrao (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
    grupo VARCHAR(100) NOT NULL,                  -- Nome do grupo (ex: "Ponto da carne")
    tipo VARCHAR(10) NOT NULL DEFAULT 'unica',    -- 'unica' | 'multipla'
    obrigatoria BOOLEAN NOT NULL DEFAULT false,
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opcoes_padrao_restaurant ON opcoes_padrao(restaurant_id);

CREATE TABLE IF NOT EXISTS opcoes_padrao_itens (
    id SERIAL PRIMARY KEY,
    opcao_padrao_id INTEGER NOT NULL REFERENCES opcoes_padrao(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,                   -- Nome da opção (ex: "Ao ponto")
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opcoes_padrao_itens ON opcoes_padrao_itens(opcao_padrao_id);

-- Vínculo produto ↔ grupo padrão (vínculo ao vivo)
CREATE TABLE IF NOT EXISTS produto_opcoes_padrao (
    produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
    opcao_padrao_id INTEGER NOT NULL REFERENCES opcoes_padrao(id) ON DELETE CASCADE,
    PRIMARY KEY (produto_id, opcao_padrao_id)
);

-- ────────────────────────────────────────────────────────────
-- RLS — opcoes_padrao (tenant direto, espelha extra_subcategorias)
-- ────────────────────────────────────────────────────────────
ALTER TABLE opcoes_padrao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opcoes_padrao_restaurant_isolation ON opcoes_padrao;
CREATE POLICY opcoes_padrao_restaurant_isolation ON opcoes_padrao
    FOR ALL
    USING (restaurant_id = current_setting('app.restaurant_id')::integer)
    WITH CHECK (restaurant_id = current_setting('app.restaurant_id')::integer);

DROP POLICY IF EXISTS opcoes_padrao_public_select ON opcoes_padrao;
CREATE POLICY opcoes_padrao_public_select ON opcoes_padrao
    FOR SELECT
    USING (restaurant_id = current_setting('app.restaurant_id', true)::integer);

DROP POLICY IF EXISTS opcoes_padrao_staff ON opcoes_padrao;
CREATE POLICY opcoes_padrao_staff ON opcoes_padrao
    FOR ALL
    USING (
        restaurant_id = current_setting('app.restaurant_id', true)::integer
        AND current_setting('app.user_role', true) = 'restaurante'
        AND current_setting('app.user_cargo', true) IN ('admin', 'gerente', 'chef')
    );

-- ────────────────────────────────────────────────────────────
-- RLS — opcoes_padrao_itens (isola via grupo padrão)
-- ────────────────────────────────────────────────────────────
ALTER TABLE opcoes_padrao_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opcoes_padrao_itens_restaurant_isolation ON opcoes_padrao_itens;
CREATE POLICY opcoes_padrao_itens_restaurant_isolation ON opcoes_padrao_itens
    FOR ALL
    USING (
        opcao_padrao_id IN (
            SELECT id FROM opcoes_padrao
            WHERE restaurant_id = current_setting('app.restaurant_id')::integer
        )
    )
    WITH CHECK (
        opcao_padrao_id IN (
            SELECT id FROM opcoes_padrao
            WHERE restaurant_id = current_setting('app.restaurant_id')::integer
        )
    );

DROP POLICY IF EXISTS opcoes_padrao_itens_public_select ON opcoes_padrao_itens;
CREATE POLICY opcoes_padrao_itens_public_select ON opcoes_padrao_itens
    FOR SELECT
    USING (
        opcao_padrao_id IN (
            SELECT id FROM opcoes_padrao
            WHERE restaurant_id = current_setting('app.restaurant_id', true)::integer
        )
    );

DROP POLICY IF EXISTS opcoes_padrao_itens_staff ON opcoes_padrao_itens;
CREATE POLICY opcoes_padrao_itens_staff ON opcoes_padrao_itens
    FOR ALL
    USING (
        opcao_padrao_id IN (
            SELECT id FROM opcoes_padrao
            WHERE restaurant_id = current_setting('app.restaurant_id', true)::integer
        )
        AND current_setting('app.user_role', true) = 'restaurante'
        AND current_setting('app.user_cargo', true) IN ('admin', 'gerente', 'chef')
    );

-- ────────────────────────────────────────────────────────────
-- RLS — produto_opcoes_padrao (isola via produto)
-- ────────────────────────────────────────────────────────────
ALTER TABLE produto_opcoes_padrao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS produto_opcoes_padrao_restaurant_isolation ON produto_opcoes_padrao;
CREATE POLICY produto_opcoes_padrao_restaurant_isolation ON produto_opcoes_padrao
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
        AND opcao_padrao_id IN (
            SELECT id FROM opcoes_padrao
            WHERE restaurant_id = current_setting('app.restaurant_id')::integer
        )
    );

DROP POLICY IF EXISTS produto_opcoes_padrao_public_select ON produto_opcoes_padrao;
CREATE POLICY produto_opcoes_padrao_public_select ON produto_opcoes_padrao
    FOR SELECT
    USING (
        produto_id IN (
            SELECT id FROM produtos
            WHERE restaurant_id = current_setting('app.restaurant_id', true)::integer
            AND ativo = true
        )
    );

DROP POLICY IF EXISTS produto_opcoes_padrao_staff ON produto_opcoes_padrao;
CREATE POLICY produto_opcoes_padrao_staff ON produto_opcoes_padrao
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON opcoes_padrao TO app_user;
        GRANT USAGE, SELECT ON SEQUENCE opcoes_padrao_id_seq TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON opcoes_padrao_itens TO app_user;
        GRANT USAGE, SELECT ON SEQUENCE opcoes_padrao_itens_id_seq TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON produto_opcoes_padrao TO app_user;
    END IF;
END $$;
