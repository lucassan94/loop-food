-- ============================================================
-- MIGRATION 030: Opções do Prato (opções GRATUITAS por produto)
-- ============================================================
-- Grupos de opções sem custo que o cliente escolhe antes de
-- adicionar o produto ao carrinho, ex:
--   "Ponto da carne"  → Mal passado / Ao ponto / Bem passado
--   "Com/Sem açúcar"  → Com açúcar / Sem açúcar
-- Cada grupo:
--   tipo 'unica'    → cliente escolhe 1 opção (radio)
--   tipo 'multipla' → cliente marca várias (checkbox)
--   obrigatoria     → cliente deve escolher antes de adicionar
-- As opções escolhidas viajam com o item do pedido
-- (pedido_itens.opcoes, JSONB) e NÃO alteram o subtotal.
-- ============================================================

CREATE TABLE IF NOT EXISTS produto_opcoes (
    id SERIAL PRIMARY KEY,
    produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
    grupo VARCHAR(100) NOT NULL,                  -- Nome do grupo (ex: "Ponto da carne")
    nome VARCHAR(100) NOT NULL,                   -- Nome da opção (ex: "Ao ponto")
    tipo VARCHAR(10) NOT NULL DEFAULT 'unica',    -- 'unica' | 'multipla'
    obrigatoria BOOLEAN NOT NULL DEFAULT false,
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_produto_opcoes_produto ON produto_opcoes(produto_id);

-- Opções escolhidas no item do pedido (gratuitas — não somam no subtotal)
ALTER TABLE pedido_itens ADD COLUMN IF NOT EXISTS opcoes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ────────────────────────────────────────────────────────────
-- RLS (espelha produtos_extras + padrão WITH CHECK da 029)
-- ────────────────────────────────────────────────────────────
ALTER TABLE produto_opcoes ENABLE ROW LEVEL SECURITY;

-- Isolamento por tenant (fail-closed: exige contexto)
DROP POLICY IF EXISTS produto_opcoes_restaurant_isolation ON produto_opcoes;
CREATE POLICY produto_opcoes_restaurant_isolation ON produto_opcoes
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
    );

-- Público: SELECT em opções de produtos ativos (cardápio)
DROP POLICY IF EXISTS produto_opcoes_public_select ON produto_opcoes;
CREATE POLICY produto_opcoes_public_select ON produto_opcoes
    FOR SELECT
    USING (
        produto_id IN (
            SELECT id FROM produtos
            WHERE restaurant_id = current_setting('app.restaurant_id', true)::integer
            AND ativo = true
        )
    );

-- Staff (admin/gerente/chef): CRUD completo
DROP POLICY IF EXISTS produto_opcoes_staff ON produto_opcoes;
CREATE POLICY produto_opcoes_staff ON produto_opcoes
    FOR ALL
    USING (
        produto_id IN (
            SELECT id FROM produtos
            WHERE restaurant_id = current_setting('app.restaurant_id', true)::integer
        )
        AND current_setting('app.user_role', true) = 'restaurante'
        AND current_setting('app.user_cargo', true) IN ('admin', 'gerente', 'chef')
    );

-- GRANTs (defensivo: se app_user não existir — ex.: 029 pulada — ignora)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON produto_opcoes TO app_user;
        GRANT USAGE, SELECT ON SEQUENCE produto_opcoes_id_seq TO app_user;
    END IF;
END $$;
