-- ============================================================
-- 034: Fuso horário por restaurante
-- ============================================================
-- Horários de funcionamento (restaurantes.horarios_funcionamento) e a
-- disponibilidade por dia/horário dos produtos (produtos.dias_semana /
-- horario_inicio / horario_fim) são cadastrados no fuso LOCAL de cada
-- restaurante. Antes o fuso era fixo em America/Sao_Paulo (código); agora
-- cada tenant pode ter o seu (ex.: America/Manaus, Europe/Lisbon).
--
-- Default = America/Sao_Paulo → comportamento atual preservado para todos
-- os restaurantes existentes. O valor é usado pelo backend (validação de
-- pedidos/pagamentos/disponibilidade) e pelo cliente (banner aberto/fechado),
-- que o recebe no GET /restaurante.
ALTER TABLE restaurantes
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
