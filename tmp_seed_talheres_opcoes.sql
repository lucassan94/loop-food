-- ============================================================
-- Seed: Talheres obrigatório + Opções do Prato (teste)
-- Aplica em TODAS as instâncias de cada produto do tenant 1
-- ============================================================

-- ── 1. Talheres obrigatório: burgers, carnes e pratos principais ──
UPDATE produtos SET talheres_obrigatorio = true
WHERE restaurant_id = 1 AND ativo
  AND (nome ILIKE '%X-Burguer%' OR nome ILIKE '%X-Bacon%' OR nome ILIKE '%X-Salada%'
    OR nome ILIKE '%Ancho%' OR nome ILIKE '%Filé Mignon%' OR nome ILIKE '%Medalhão%'
    OR nome ILIKE '%Lasanha%' OR nome ILIKE '%Parmegiana%' OR nome ILIKE '%Picadinho%'
    OR nome ILIKE '%Grelhada%' OR nome ILIKE '%Grelhado%' OR nome ILIKE '%Fraldinha%'
    OR nome ILIKE '%Picanha%' OR nome ILIKE '%Nhoque%');

-- ── 2. Opção "Ponto da carne" (única, obrigatória) — burgers e carnes ──
INSERT INTO produto_opcoes (produto_id, grupo, nome, tipo, obrigatoria, ordem)
SELECT p.id, 'Ponto da carne', op, 'unica', true, ordem
FROM produtos p
CROSS JOIN (VALUES ('Mal passado', 0), ('Ao ponto', 1), ('Bem passado', 2)) AS v(op, ordem)
WHERE p.restaurant_id = 1 AND p.ativo
  AND (p.nome ILIKE '%X-Burguer%' OR p.nome ILIKE '%X-Bacon%' OR p.nome ILIKE '%X-Salada%'
    OR p.nome ILIKE '%Ancho%' OR p.nome ILIKE '%Filé Mignon%' OR p.nome ILIKE '%Medalhão%'
    OR p.nome ILIKE '%Picadinho%' OR p.nome ILIKE '%Grelhada%' OR p.nome ILIKE '%Grelhado%'
    OR p.nome ILIKE '%Fraldinha%' OR p.nome ILIKE '%Picanha%')
  AND NOT EXISTS (
    SELECT 1 FROM produto_opcoes o
    WHERE o.produto_id = p.id AND o.grupo = 'Ponto da carne' AND o.nome = op
  );

-- ── 3. Opção "Molhos grátis" (múltipla, opcional) — burgers ──
INSERT INTO produto_opcoes (produto_id, grupo, nome, tipo, obrigatoria, ordem)
SELECT p.id, 'Molhos grátis', op, 'multipla', false, ordem
FROM produtos p
CROSS JOIN (VALUES ('Ketchup', 0), ('Maionese', 1), ('Mostarda', 2)) AS v(op, ordem)
WHERE p.restaurant_id = 1 AND p.ativo
  AND (p.nome ILIKE '%X-Burguer%' OR p.nome ILIKE '%X-Bacon%' OR p.nome ILIKE '%X-Salada%')
  AND NOT EXISTS (
    SELECT 1 FROM produto_opcoes o
    WHERE o.produto_id = p.id AND o.grupo = 'Molhos grátis' AND o.nome = op
  );

-- ── 4. Opção "Espessura da borda" (única, obrigatória) — pizzas ──
INSERT INTO produto_opcoes (produto_id, grupo, nome, tipo, obrigatoria, ordem)
SELECT p.id, 'Espessura da borda', op, 'unica', true, ordem
FROM produtos p
CROSS JOIN (VALUES ('Fina', 0), ('Média', 1), ('Grossa', 2)) AS v(op, ordem)
WHERE p.restaurant_id = 1 AND p.ativo
  AND p.nome ILIKE 'Pizza%'
  AND NOT EXISTS (
    SELECT 1 FROM produto_opcoes o
    WHERE o.produto_id = p.id AND o.grupo = 'Espessura da borda' AND o.nome = op
  );

-- ── 5. Opção "Com/Sem açúcar" (única, obrigatória) — sucos ──
INSERT INTO produto_opcoes (produto_id, grupo, nome, tipo, obrigatoria, ordem)
SELECT p.id, 'Com/Sem açúcar', op, 'unica', true, ordem
FROM produtos p
CROSS JOIN (VALUES ('Com açúcar', 0), ('Sem açúcar', 1)) AS v(op, ordem)
WHERE p.restaurant_id = 1 AND p.ativo
  AND p.nome ILIKE 'Suco%'
  AND NOT EXISTS (
    SELECT 1 FROM produto_opcoes o
    WHERE o.produto_id = p.id AND o.grupo = 'Com/Sem açúcar' AND o.nome = op
  );
