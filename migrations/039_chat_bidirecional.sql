-- ============================================================================
-- Migration 039: Chat bidirecional restaurante ↔ cliente
--
-- Evolui mensagens_pedido de "aviso unilateral" para chat completo:
--   - remetente    : quem enviou ('restaurante' | 'cliente')
--   - lida         : marcada pelo RESTAURANTE (leu a mensagem do cliente)
--   - lida_cliente : marcada pelo CLIENTE (leu a mensagem do restaurante)
--
-- As policies RLS já existentes cobrem os dois lados:
--   - mensagens_pedido_cliente (FOR ALL, pedidos do próprio cliente)
--   - mensagens_pedido_staff (FOR ALL, restaurante) / _caixa (SELECT)
-- ============================================================================

ALTER TABLE mensagens_pedido
  ADD COLUMN IF NOT EXISTS remetente VARCHAR(20) NOT NULL DEFAULT 'restaurante'
    CHECK (remetente IN ('restaurante', 'cliente'));

ALTER TABLE mensagens_pedido
  ADD COLUMN IF NOT EXISTS lida_cliente BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_mensagens_pedido_remetente ON mensagens_pedido(remetente);

-- Mensagens existentes (todas enviadas pelo restaurante e já exibidas ao
-- cliente no Tracking) — consideradas lidas por ambos os lados para não
-- inflar badges de não-lidas na primeira abertura do chat.
UPDATE mensagens_pedido SET lida = TRUE, lida_cliente = TRUE;
