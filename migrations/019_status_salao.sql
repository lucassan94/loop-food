-- ============================================================================
-- SABOREXPRESS - Migration 019: Status para Pedidos do Salão (PDV)
-- Adiciona 'pronto' (pronto para servir) e 'finalizado' (conta paga)
-- ============================================================================

-- Remover constraint antiga
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_status_check;

-- Recriar com os novos status
ALTER TABLE pedidos ADD CONSTRAINT pedidos_status_check
    CHECK (status IN (
        'pendente', 'preparando', 'pronto_entrega', 'pronto',
        'em_transito', 'cheguei_destino', 'entregue',
        'finalizado', 'cancelado', 'recusado',
        'aguardando_pagamento'
    ));
