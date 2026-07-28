-- ============================================================================
-- SABOREXPRESS - Migration 012: Multi-tenant Structure
-- PostgreSQL 16 | Adiciona campos de identificação de tenant
-- ============================================================================

-- ============================================================================
-- 1. NOVOS CAMPOS na tabela restaurantes
-- ============================================================================
ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS slug VARCHAR(50) UNIQUE;
ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS dominio VARCHAR(255) UNIQUE;
ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS asaas_api_key TEXT;
ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS asaas_env VARCHAR(10) DEFAULT 'sandbox';
ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS asaas_webhook_token TEXT;
ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS asaas_webhook_secret TEXT;
ALTER TABLE restaurantes ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- ============================================================================
-- 2. Atualizar tenant existente (id=1) com slug e domínio padrão
-- ============================================================================
UPDATE restaurantes
SET slug = 'saborexpress',
    dominio = 'saborexpress'
WHERE id = 1 AND slug IS NULL;

-- ============================================================================
-- 3. CORRIGIR UNIQUE constraints para permitir emails iguais entre tenants
-- ============================================================================

-- 3.1 Clientes: email era UNIQUE global → passa a ser UNIQUE por tenant
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_email_key CASCADE;
-- Garantir que não há duplicatas dentro do mesmo tenant antes de criar a constraint
DELETE FROM clientes a USING clientes b
WHERE a.id < b.id AND a.restaurant_id = b.restaurant_id AND a.email = b.email;
ALTER TABLE clientes ADD UNIQUE (restaurant_id, email);

-- 3.2 Entregadores: email era UNIQUE global → passa a ser UNIQUE por tenant
ALTER TABLE entregadores DROP CONSTRAINT IF EXISTS entregadores_email_key CASCADE;
DELETE FROM entregadores a USING entregadores b
WHERE a.id < b.id AND a.restaurant_id = b.restaurant_id AND a.email = b.email;
ALTER TABLE entregadores ADD UNIQUE (restaurant_id, email);

-- 3.3 Entregadores: CPF também deve ser UNIQUE por tenant
ALTER TABLE entregadores DROP CONSTRAINT IF EXISTS entregadores_cpf_key CASCADE;
DELETE FROM entregadores a USING entregadores b
WHERE a.id < b.id AND a.restaurant_id = b.restaurant_id AND a.cpf = b.cpf AND a.cpf IS NOT NULL;
ALTER TABLE entregadores ADD UNIQUE (restaurant_id, cpf);

-- 3.4 Restaurante users: email era UNIQUE global → passa a ser UNIQUE por tenant
ALTER TABLE restaurante_users DROP CONSTRAINT IF EXISTS restaurante_users_email_key CASCADE;
DELETE FROM restaurante_users a USING restaurante_users b
WHERE a.id < b.id AND a.restaurant_id = b.restaurant_id AND a.email = b.email;
ALTER TABLE restaurante_users ADD UNIQUE (restaurant_id, email);

-- ============================================================================
-- 4. ÍNDICES para busca por domínio (essencial para o tenantResolver)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_restaurantes_dominio ON restaurantes(dominio);
CREATE INDEX IF NOT EXISTS idx_restaurantes_slug ON restaurantes(slug);

-- ============================================================================
-- 5. ATUALIZAR tabela pagamentos com restaurant_id para rastreio por tenant
-- (necessário para o webhook Asaas identificar o tenant)
-- ============================================================================
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS restaurant_id INTEGER REFERENCES restaurantes(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_pagamentos_restaurant ON pagamentos(restaurant_id);

-- Popular restaurant_id em pagamentos existentes (via JOIN com pedidos)
UPDATE pagamentos p
SET restaurant_id = o.restaurant_id
FROM pedidos o
WHERE p.pedido_id = o.id AND p.restaurant_id IS NULL;
