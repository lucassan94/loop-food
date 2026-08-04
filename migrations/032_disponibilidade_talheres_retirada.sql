-- ============================================================
-- MIGRATION 032: Disponibilidade de Pratos + Talheres + Retirada
-- ============================================================
-- 1. Produtos:
--    - talheres_obrigatorio: quando TRUE, o cliente DEVE escolher
--      (Sim/Não) antes de adicionar ao carrinho.
--    - modulos: em quais módulos o prato é vendido
--      (['delivery','salao'] | ['delivery'] | ['salao']).
--      Vazio/ausente = todos os módulos.
--    - dias_semana (JSONB): dias em que o prato fica disponível
--      (0=Domingo ... 6=Sábado). NULL = todos os dias.
--    - horario_inicio / horario_fim (TIME): janela de horário de
--      disponibilidade. NULL em ambos = qualquer horário.
--      Fora do range o prato é pausado automaticamente no cardápio.
-- 2. pedido_itens:
--    - observacao: observação INDIVIDUAL do item na sacola.
--    - talheres: escolha de talheres do item (Sim/Não).
-- 3. Restaurantes:
--    - retirada_habilitada: habilita/desabilita retirada no local.
--    - horarios_funcionamento: horário de funcionamento por dia da
--      semana ([{aberto, abre, fecha}] x7 — índice = dia, 0=Domingo).
-- 4. Pedidos: origem passa a aceitar 'retirada'.
-- ============================================================

-- ── Produtos ──
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS talheres_obrigatorio BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS modulos JSONB NOT NULL DEFAULT '["delivery","salao"]';

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS dias_semana JSONB;

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS horario_inicio TIME;

ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS horario_fim TIME;

-- ── Itens do pedido ──
ALTER TABLE pedido_itens
  ADD COLUMN IF NOT EXISTS observacao TEXT NOT NULL DEFAULT '';

ALTER TABLE pedido_itens
  ADD COLUMN IF NOT EXISTS talheres BOOLEAN;

-- ── Restaurantes ──
ALTER TABLE restaurantes
  ADD COLUMN IF NOT EXISTS retirada_habilitada BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE restaurantes
  ADD COLUMN IF NOT EXISTS horarios_funcionamento JSONB NOT NULL DEFAULT '[]';

-- ── Pedidos: origem aceita 'retirada' ──
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_origem_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_origem_check
  CHECK (origem IN ('delivery', 'salao', 'retirada'));
