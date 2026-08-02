-- ============================================================================
-- SABOREXPRESS - Migration 020: Mesas (Salão)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mesas (
    id SERIAL PRIMARY KEY,
    restaurant_id INTEGER NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
    nome VARCHAR(50) NOT NULL,
    capacidade INTEGER NOT NULL DEFAULT 4,
    status VARCHAR(20) NOT NULL DEFAULT 'livre' CHECK (status IN ('livre', 'ocupada', 'reservada', 'inativa')),
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mesas_restaurant ON mesas(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_mesas_status ON mesas(status);

ALTER TABLE mesas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mesas_restaurant_isolation') THEN
        CREATE POLICY mesas_restaurant_isolation ON mesas
            USING (restaurant_id = current_setting('app.restaurant_id')::integer);
    END IF;
END $$;

-- Seed data: 10 mesas padrão
INSERT INTO mesas (restaurant_id, nome, capacidade, status)
SELECT 1, 'Mesa ' || n, 4, 'livre'
FROM generate_series(1, 10) AS n
WHERE NOT EXISTS (SELECT 1 FROM mesas WHERE restaurant_id = 1 LIMIT 1);
