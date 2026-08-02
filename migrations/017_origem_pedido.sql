-- ============================================================================
-- SABOREXPRESS - Migration 017: Origem do Pedido (Delivery / Salão)
-- Permite distinguir pedidos do delivery dos pedidos do salão (PDV)
-- ============================================================================

-- 1. Adicionar coluna `origem` na tabela pedidos
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origem VARCHAR(20) NOT NULL DEFAULT 'delivery'
    CHECK (origem IN ('delivery', 'salao'));

-- 2. Adicionar coluna `mesa` (opcional, para identificar mesa no salão)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mesa VARCHAR(10);

-- 3. Tornar cliente_id opcional para pedidos do salão (PDV pode criar sem cliente cadastrado)
-- Primeiro, remover a constraint NOT NULL se existir
ALTER TABLE pedidos ALTER COLUMN cliente_id DROP NOT NULL;

-- 4. Atualizar a constraint CHECK de metodo_pagamento para incluir formas do salão
-- Primeiro remover a constraint antiga
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_metodo_pagamento_check;
-- Recriar com os valores existentes + 'salao' (pagamento na conta)
ALTER TABLE pedidos ADD CONSTRAINT pedidos_metodo_pagamento_check
    CHECK (metodo_pagamento IN ('dinheiro', 'credito', 'debito', 'pix', 'pix_online', 'credito_online', 'salao', 'conta'));
