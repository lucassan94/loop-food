-- ============================================================================
-- SABOREXPRESS - Migration 018: Cliente genérico "Salão" para PDV
-- Cria um cliente placeholder para cada restaurante existente
-- ============================================================================

-- Inserir cliente "Salão" para cada restaurante que ainda não tem um
INSERT INTO clientes (restaurant_id, nome, email, senha_hash, ativo)
SELECT
    r.id,
    'Salão',
    CONCAT('salao-placeholder-', r.id, '@internal.local'),
    '$2b$12$placeholder_hash_para_pdv_local_salao',
    true
FROM restaurantes r
WHERE NOT EXISTS (
    SELECT 1 FROM clientes c
    WHERE c.restaurant_id = r.id AND c.email LIKE 'salao-placeholder-%'
)
ON CONFLICT (restaurant_id, email) DO NOTHING;
