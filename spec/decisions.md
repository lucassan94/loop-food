# Decisions (ADR) — SaborExpress V2 / LoopFood

> Registro de decisões arquiteturais. Nunca editar decisões antigas; criar novas ADRs.

---

## ADR-001 — Migração do gateway de pagamento: Asaas → API da Rede (e-Rede v2)

- **ID:** ADR-001
- **Data:** 02/08/2026
- **Contexto:** o sistema usava o Asaas como gateway de pagamento online (PIX + cartão tokenizado), com credenciais por tenant no módulo god. O usuário decidiu migrar para a **Rede (Itaú)**.
- **Problema:** qual produto/solução da Rede atende PIX, cartão de crédito e débito, notificação de pagamento e estorno com um único contrato e autenticação?
- **Alternativas:**
  1. **e-Rede v2 API (OAuth2)** — cartão (checkout transparente), PIX com QR dinâmico, webhook `PV.UPDATE_TRANSACTION_PIX`, estorno, 3DS v2 (Rede MPI) — **tudo em uma única API**.
  2. Produtos separados da Rede (um para cartão, outro para PIX) — mais contratos, mais integrações.
  3. Manter Asaas — descartado (decisão definitiva do usuário de sair do Asaas).
- **Decisão:** adotar a **e-Rede v2 API** como gateway único. Remover totalmente o Asaas (código, colunas, envs, scripts, migrations de limpeza). Credenciais por tenant no god (`rede_env`, `rede_client_id`=PV, `rede_client_secret`=Chave de Integração, `rede_webhook_token`).
- **Consequências:** backend passa a manipular dados brutos de cartão (escopo PCI-DSS SAQ A-EP — exigir TLS 1.2+); webhook PIX precisa cadastro via call center (~2 dias úteis); polling de backup 15s cobre ausência de webhook; reembolso passa a ser manual.

---

## ADR-002 — Checkout transparente (dados brutos de cartão no backend), não tokenização

- **ID:** ADR-002
- **Data:** 02/08/2026
- **Contexto:** no Asaas o fluxo usava tokenização (`/tokenizar-cartao`). O frontend já enviava dados brutos, mas o backend esperava token — **fluxo quebrado** (BUG-001). Com a e-Rede v2, o padrão é checkout transparente.
- **Problema:** como enviar o cartão à Rede e corrigir a inconsistência existente?
- **Alternativas:** 1) tokenização própria antes da transação; 2) checkout transparente (dados do cartão passam pelo nosso backend → Rede, nunca armazenados).
- **Decisão:** **checkout transparente**. O backend aceita `creditCard {holderName, number, expiryMonth, expiryYear, ccv}` + `creditCardHolderInfo` (usado no bloco 3DS `billing`) e envia à Rede. Nada é persistido/logado.
- **Consequências:** escopo PCI-DSS SAQ A-EP; exige HTTPS/TLS 1.2+ e disciplina de não-log; correção natural do BUG-001.

---

## ADR-003 — Confirmação de pagamento: webhook + polling de backup (15s)

- **ID:** ADR-003
- **Data:** 02/08/2026
- **Contexto:** a Rede notifica PIX pago via `PV.UPDATE_TRANSACTION_PIX`, mas o cadastro da URL é manual (call center, ~2 dias úteis) e há risco de entrega perdida.
- **Problema:** como garantir que pedidos PIX sejam ativados mesmo sem webhook?
- **Alternativas:** 1) somente webhook; 2) somente polling; 3) **webhook + polling de backup**.
- **Decisão:** webhook (primário) + **polling de 15s** (`pollingRede.js`) que consulta `GET /v2/transactions/{tid}` dos pedidos `aguardando_pagamento`/`PENDING` e aplica Approved/Denied/3036.
- **Consequências:** robustez em caso de webhook não cadastrado/perdido; leve custo de chamadas; limpeza de pedidos órfãos por idade (só PIX).

---

## ADR-004 — 3-D Secure v2 com Rede MPI, frictionless-first; desafio via redirect

- **ID:** ADR-004
- **Data:** 02/08/2026
- **Contexto:** a Rede oferece 3DS v2 embutido (Rede MPI). Débito online exige 3DS; crédito é opcional. O sandbox não simula iframe 3DS.
- **Problema:** como apresentar o 3DS sem degradar a jornada?
- **Alternativas:** 1) iframe embutido (não simulável no sandbox); 2) **redirect para o banco em nova aba**; 3) sem 3DS (inaceitável para débito).
- **Decisão:** 3DS v2 frictionless-first (`embedded: true`, `responseMode: "event"`, `onFailure: "continue"` para crédito, `"decline"` para débito). Quando o banco exigir desafio (`returnCode 220` + `threeDSecure.url`), o app abre a URL em **nova aba**; o banco retorna para `threeDSecureSuccess`/`Failure`, e o backend consulta o resultado final por reference.
- **Consequências:** jornada invisível na maioria dos casos; UX de nova aba no desafio; consulta final por reference confirma autorização.

---

## ADR-005 — Reembolso manual (sem estorno automático ao cancelar pedido pago)

- **ID:** ADR-005
- **Data:** 02/08/2026
- **Contexto:** no Asaas, cancelar/recusar pedido pago disparava estorno automático.
- **Problema:** risco de estornos indesejados e surpresa ao operador.
- **Alternativas:** 1) manter estorno automático; 2) **reembolso manual** pelo admin via `POST /:pedidoId/reembolsar`.
- **Decisão:** **reembolso manual**. O admin decide estornar; o painel mostra badge de status do estorno (polling `refund-status`).
- **Consequências:** operação mais segura/controlada; requer treinamento dos operadores.

---

## ADR-006 — Login por apelido (username) ou telefone; e-mail é complementar

- **ID:** ADR-006
- **Data:** 02/08/2026
- **Contexto:** o login era por e-mail; clientes reais frequentemente não lembram/possuem e-mail válido.
- **Problema:** como simplificar o acesso de clientes/entregadores/equipe?
- **Alternativas:** 1) manter e-mail; 2) **apelido e/ou telefone**.
- **Decisão:** todos os módulos aceitam **apelido ou telefone** (equipe usa apelido). Novos usuários da equipe ganham apelido com senha padrão `senha123`. Migrations 022/023/024 + `apelido` em `clientes`/`entregadores` + busca por telefone normalizada (só dígitos).
- **Consequências:** e-mail vira dado complementar; README/seed atualizados; tenant novo no god: `admin`/`admin123`.

---

## ADR-007 — Valores monetários em centavos na integração Rede

- **ID:** ADR-007
- **Data:** 02/08/2026
- **Contexto:** a API da Rede exige `amount` em centavos (sem separadores).
- **Problema:** erro de conversão geraria transações de valor errado.
- **Alternativas:** conversão ad-hoc em cada chamada; **funções centralizadas**.
- **Decisão:** funções `reaisParaCentavos`/`centavosParaReais` no serviço Rede; toda a camada de pagamento usa centavos.
- **Consequências:** baixo risco de erro de valor; fácil manutenção.
