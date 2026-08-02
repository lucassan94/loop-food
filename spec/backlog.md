# Backlog — SaborExpress V2 / LoopFood

> Lista priorizada de tudo que ainda precisa ser feito. Novos itens identificados durante o desenvolvimento são adicionados automaticamente.

## 🟥 Alta prioridade

| Item | Motivo | Dependências |
|---|---|---|
| Obter credenciais do sandbox Rede (PV + Chave de Integração) e preencher no god | Sem elas não há homologação real do gateway | Acesso do usuário ao portal developer.userede.com.br |
| Rodar `e2e-rede-test.js` contra o sandbox e validar as 14 jornadas (PIX, cartão, débito, 3DS, fallbacks, reembolso, multi-tenant, regressão COD) | Validação de todas as jornadas exigida pelo usuário | Credenciais sandbox |
| Cadastrar URL de notificação PIX no call center da Rede (4001 4433 / 0800 728 4433) | Sem a URL, PIX só é confirmado por polling (funciona, mas não é o fluxo principal) | CNPJ + PV + URL pública HTTPS |
| Restart do backend + rebuild dos frontends em produção | Config sem Asaas + polling + MELHORIA-005 só valem após restart | Deploy (Portainer) |
| Habilitar TLS 1.2+ nos nginx (certs + proxy externo) | Escopo PCI-DSS do checkout transparente (dados de cartão) | Certificados/domínio |

## 🟨 Média prioridade

| Item | Motivo | Dependências |
|---|---|---|
| Criar admin do tenant 3 (Loop) no god (BUG-010) | Tenant 3 ficou sem usuários após a limpeza/seeds | Decisão se o tenant ainda está em uso |
| Validar dedup de webhook com eventos reais (chave secundária `rede:{tid}:{event}`) | Confirmação se a Rede pode reentregar com `id` diferente | Homologação sandbox |
| Validar cache OAuth2 (20min) com token real | Confirmação de renovação antecipada sem quebras | Credenciais sandbox |
| Confirmar casing real de `qrCode.dateTimeExpiration` na API | Manual exibe variação de casing | Request real no sandbox |

## 🟩 Baixa prioridade

| Item | Motivo | Dependências |
|---|---|---|
| Treinar operadores sobre reembolso manual (ADR-005) | Cancelar pedido pago não estorna mais automaticamente | Antes do go-live |
| Revisar prazos de estorno na operação (débito 7d, crédito 90d, PIX 90d; 21h30) | Alinhar expectativa do suporte | — |
| Avaliar upgrade de logs de transações no god (filtros, exportação) | Facilita suporte/auditoria | — |
| Testar push notifications em produção (web-push) | Funcionalidade existente sem validação recente | — |
