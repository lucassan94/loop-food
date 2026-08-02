# Technical Debt — SaborExpress V2 / LoopFood

> Registro de todas as dívidas técnicas. Nunca esconder uma dívida técnica.

---

## TD-001 — TLS 1.2+ ainda não habilitado nos nginx

- **Descrição:** o bloco HTTPS (443 ssl, TLSv1.2/1.3, ciphers fortes) está adicionado mas **comentado** nos 4 nginx (cliente/restaurante/entregador/router). Não há certificados montados no docker-compose nem TLS terminado no proxy externo.
- **Motivo:** depende de certificados/domínios do usuário; adiado para o go-live.
- **Impacto:** alto para PCI-DSS (checkout transparente manipula dados de cartão). Tráfego de produção sem TLS 1.2+ se não for feito.
- **Prioridade:** alta.
- **Recomendação:** montar certs via volumes (ou proxy reverso com TLS) e descomentar o bloco antes do go-live.
- **Quando remover:** quando o tráfego externo estiver 100% HTTPS com TLS 1.2+.

---

## TD-002 — Credenciais da Rede por tenant mantêm padrão de colunas dedicadas (não config JSONB)

- **Descrição:** as credenciais Rede (`rede_env`, `rede_client_id`, `rede_client_secret`, `rede_webhook_token`) são colunas dedicadas em `restaurantes`, no mesmo padrão legado do Asaas.
- **Motivo:** decisão do usuário (padrão atual); menor risco de refatoração na migração.
- **Impacto:** baixo — cada novo provedor de pagamento exige novas colunas/migrations e atualização do god.
- **Prioridade:** baixa.
- **Recomendação:** em futuras integrações, avaliar JSONB `payment_config` por tenant.
- **Quando remover:** quando houver necessidade de múltiplos provedores ou múltiplas credenciais por tenant.

---

## TD-003 — Migrations 006/012 (Asaas) permanecem no histórico sem edição

- **Descrição:** as migrations históricas que criaram colunas/tabelas Asaas não foram editadas; a limpeza real foi feita pela migration 027 (drop `asaas_*`). Isso é intencional (histórico imutável), mas a sequência contém passos "mortos" em ambientes novos.
- **Motivo:** princípio de nunca editar migrations aplicadas.
- **Impacto:** baixo — em banco novo, as migrations criam e depois dropam as colunas Asaas.
- **Prioridade:** baixa.
- **Recomendação:** manter como está; não editar migrations históricas.
- **Quando remover:** nunca (apenas documentar).

---

## TD-004 — Dados sensíveis de cartão transitam pelo backend (escopo PCI-DSS)

- **Descrição:** checkout transparente: número/CVV do cartão passam pelo backend em memória (nunca persistidos). Requer disciplina contínua: sem logs, sem cache, sem telemetria com dados sensíveis.
- **Motivo:** padrão e-Rede v2 (não há tokenização obrigatória).
- **Impacto:** alto se violado (vazamento). Mitigado por não-log e descarte em memória.
- **Prioridade:** alta (acompanhamento contínuo).
- **Recomendação:** auditoria periódica de logs; garantir TLS; revisar dependências.
- **Quando remover:** quando a Rede oferecer tokenização no checkout transparente (avaliar em homologação).

---

## TD-005 — Testes e2e dependem de credenciais reais de sandbox

- **Descrição:** o `e2e-rede-test.js` existe e está sintaticamente válido, mas nunca rodou contra o sandbox real (sem credenciais). Cobertura de testes automatizados é limitada fora de homologação.
- **Motivo:** usuário ainda sem acesso ao portal Rede.
- **Impacto:** médio — bugs de integração podem aparecer no primeiro teste real.
- **Prioridade:** média.
- **Recomendação:** assim que houver credenciais, rodar as 14 jornadas e registrar resultados no progress.md.
- **Quando remover:** após homologação completa no sandbox.
