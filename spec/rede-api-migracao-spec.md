# 🔄 Migração: API Asaas → API Rede — Spec Técnico

> **Data:** 02/08/2026
> **Status:** Documento de planejamento (nenhuma alteração de código foi feita)
> **Última atualização:** Seções 3, 5, 6, 7 e Apêndice A preenchidos com dados VERIFICADOS do Manual Oficial e-Rede (`developer.userede.com.br/files/traducoes/erede/e-rede-24032026.pdf`, 285 págs., última atualização 23/03/2026).
> **Objetivo:** Substituir completamente a integração de pagamento online (PIX + Cartão de Crédito) do **Asaas** pela **API da Rede** (e-Rede v2, OAuth2), com credenciais configuráveis por tenant no **módulo god**, fallbacks robustos, revisão de todas as jornadas, limpeza de dados de teste e remoção total de qualquer menção ao Asaas.

---

## 1. Sumário Executivo

O sistema atualmente usa o **Asaas** como gateway de pagamento online (PIX com QR Code dinâmico e cartão de crédito com checkout transparente tokenizado). O pedido nasce em `aguardando_pagamento` e é ativado para a fila (`pendente`) quando o webhook do Asaas confirma o pagamento.

O cliente (usuário) decidiu migrar para a **Rede** (Rede Itaú). **A pesquisa do manual oficial revelou que a e-Rede v2 com OAuth 2.0 atende TUDO de forma unificada:** cartão de crédito (checkout transparente), PIX com QR Code dinâmico **e** notificação por webhook (`PV.UPDATE_TRANSACTION_PIX`) — na mesma API, com a mesma autenticação. A decisão é **definitiva**: não haverá retorno ao Asaas, e todo o código/colunas/scripts/variaveis de ambiente relacionados ao Asaas serão removidos.

**Decisões-chave da entrevista (resumo):**

| Tema | Decisão |
|---|---|
| Solução Rede | **e-Rede v2 API** (única): cartão + PIX + webhook, autenticação OAuth2 |
| PIX online | **Manter** `pix_online` com QR dinâmico (e-Rede `kind: "pix"`) |
| Dados de cartão | **Checkout transparente** (dados do cartão passam pelo nosso backend → Rede, nunca armazenados) |
| 3-D Secure | **3DS v2 com Rede MPI, frictionless** (`embedded: true`, `onFailure: "continue"`, `responseMode: "event"`); desafio (se o banco exigir) via **redirect para o banco** |
| Confirmação de pagamento | **Webhook** (PIX: `PV.UPDATE_TRANSACTION_PIX`) + **polling de backup de 15s** (`GET /v2/transactions/{tid}`) |
| Botões manuais do restaurante | **Remover** "Verificar Pagamento" e "Confirmar Pagamento" |
| Parcelamento | **Somente à vista (1x)** (omitir `installments` = à vista) |
| Soft descriptor (fatura) | **Nome do restaurante (tenant)** — campo `softDescriptor` (máx. 18 caracteres) |
| Reembolso | **Manual no painel** (`POST /v2/transactions/{tid}/refunds`) |
| Cartão de débito online | **Adicionar `debito_online`** no checkout (3DS **obrigatório** para débito na e-Rede) |
| Pagamento online no salão | **Apenas delivery** — salão/PDV mantém pagamento na conta (COD) |
| Expiração PIX | **15 minutos** (campo `qrCode.dateTimeExpiration`; máx. permitido pela Rede: 15 dias) |
| Descrição da transação | **Somente o número do pedido** — `reference` = ID interno do pedido (ex: `12345`) |
| Campos no módulo god | **Colunas dedicadas** (padrão atual do Asaas) |
| Limpeza de dados | Apagar **todos** os pedidos/pagamentos/webhook_events e **todos** os clientes de todos os tenants (cardápio NÃO é apagado) |
| Seeds pós-limpeza | `cliente`/`cliente123`, `admin`/`admin123`, `entregador`/`entregador123` presentes em todos os módulos |
| Remoção do Asaas | **Remover tudo de uma vez**, sem feature flag e sem preservar nada do Asaas |

---

## 2. Contexto Atual — Inventário do Asaas (o que será substituído)

### 2.1 Backend

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/services/asaas.js` | Cliente da API Asaas v3: `findOrCreateCustomer`, `createPayment`, `getPayment`, `getPixQrCode`, `deletePayment`, `refundPayment`, `tokenizeCard`, HMAC (`gerarHmacPayLoad`, `verificarAssinaturaWebhook`), `validarTokenWebhook`, cache de credenciais por tenant (TTL 5min) |
| `backend/src/modules/pagamentos/index.js` | Rotas: `POST /criar`, `POST /webhook`, `GET /webhook-health`, `POST /tokenizar-cartao`, `GET /:pedidoId/pix-qrcode`, `GET /:pedidoId/verificar-status`, `GET /:pedidoId/refund-status`, `POST /:pedidoId/reembolsar`. Validação de webhook com IP allowlist + token + HMAC |
| `backend/src/modules/pagamentos/webhookHandler.js` | Handlers de eventos: `PAYMENT_RECEIVED`/`CONFIRMED` (ativa pedido), `OVERDUE`/`DELETED` (cancela), `REFUNDED`/`REFUND_DENIED`, `CHARGEBACK_*`, etc. |
| `backend/src/modules/pedidos/index.js` | Linhas ~597-654: ao cancelar/recusar pedido pago online, consulta status real no Asaas e dispara `refundPayment`/`deletePayment` (reembolso automático) |
| `backend/src/config/index.js` | Bloco `asaas:` (apiKey, environment, baseUrl, webhookToken, webhookSecret, pixExpiryMinutes=30, requestTimeout) |
| `backend/src/middleware/tenantResolver.js` | Seleciona `asaas_api_key`, `asaas_env` na resolução de tenant |
| `backend/migrations/006_asaas_pagamentos.sql` | Tabela `pagamentos`, tabela `webhook_events`, colunas `clientes.asaas_customer_id` e `clientes.cpf_cnpj`, constraints de status/metodo_pagamento |
| `backend/migrations/012_multitenant.sql` | Colunas `restaurantes.asaas_*` e `pagamentos.restaurant_id` |
| Scripts de teste/diagnóstico | `check-webhook.js`, `diagnostico-asaas.js`, `e2e-asaas-test.js`, `test-pix.js`, `testar-refund-completo.js`, `testar-refund-autorizacao.js`, `testar-refund-autorizacao2.js`, `simular-pagamento.js` |
| `docker-compose.yml` / `stack.env` | Variáveis `ASAAS_API_KEY`, `ASAAS_ENV`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_WEBHOOK_SECRET`, `ASAAS_PIX_EXPIRY`, `ASAAS_REQUEST_TIMEOUT` |

### 2.2 Módulo god

- `god/server.js` — CRUD de tenants com colunas `asaas_api_key`, `asaas_env`, `asaas_webhook_token`, `asaas_webhook_secret`; endpoints de transações Asaas (`/pagamentos/transacoes`).
- `god/index.html` — tab "💰 Asaas" (credenciais), tab "💳 Pagamentos" (formas de pagamento), tabela de tenants com tag `tem_asaas`, tab de transações Asaas.

### 2.3 Cliente (app)

- `cliente/src/components/CheckoutPanel.vue` — jornada de checkout. **⚠️ INCONSISTÊNCIA ATUAL:** o frontend envia dados brutos do cartão em `body.creditCard` (`holderName`, `number`, `expiryMonth`, `expiryYear`, `ccv`), mas o backend espera `creditCardToken` (tokenizado via `/tokenizar-cartao`) — o fluxo de cartão online está **quebrado** hoje. A migração para a Rede (checkout transparente) corrige isso naturalmente.
- `cliente/src/views/TrackingView.vue` — exibição do QR Code PIX (`encodedImage`, `payload`), timer de 10min, botão copiar payload, gerar novo QR.
- `cliente/src/services/api.js` — `criarPagamento()`, `getPixQrCode()`, comentário "Asaas Payment Methods".

### 2.4 Restaurante (painel)

- `restaurante/src/views/OrdersView.vue` — botões "Verificar Pagamento" (chama `/verificar-status` que consulta Asaas) e "Confirmar Pagamento" (admin); badges de refund; polling local de 10s; comentários citando Asaas.

### 2.5 Banco de dados

- `pagamentos`: `id`, `pedido_id`, `customer_id` (id do cliente no Asaas), `payment_id` (id da cobrança Asaas), `billing_type` (`PIX`/`CREDIT_CARD`), `status` (`PENDING`, `RECEIVED`, `CONFIRMED`, `OVERDUE`, `REFUNDED`, ...), `valor_bruto`, `valor_liquido`, `taxa`, `encoded_image`, `payload`, `invoice_url`, `credit_card_token`, `data_vencimento`, `pago_em`, `criado_em`, `atualizado_em`, `restaurant_id`.
- `webhook_events`: `id`, `event_id` (UNIQUE), `event_type`, `payment_id`, `processed`, `error`, `received_at`.
- `clientes`: `asaas_customer_id`, `cpf_cnpj` (cpf_cnpj DEVE ser mantido).
- `restaurantes`: `asaas_api_key`, `asaas_env`, `asaas_webhook_token`, `asaas_webhook_secret`, `config` (JSONB com `formas_pagamento`), `features`, `cor_*`, `logo_base64`, `jwt_secret`.

---

## 3. Pesquisa da API da Rede — Resultado VERIFICADO (Manual Oficial e-Rede)

> Fonte primária: **Manual de Integração e-Rede** — `https://developer.userede.com.br/files/traducoes/erede/e-rede-24032026.pdf` (285 págs., atualizado 23/03/2026). Complementos: Portal do Desenvolvedor Rede (`developer.userede.com.br`), Apiary `apiaryapib2.docs.apiary.io`.

### 3.1 Conclusão principal — UMA API cobre tudo

A **e-Rede v2** (e não mais produtos separados) é a solução correta para a nossa finalidade. Ela oferece **na mesma API, com a mesma autenticação OAuth2**:

1. **Cartão de crédito/débito** — checkout transparente (`POST /v2/transactions`), aprovação síncrona (`returnCode "00"`).
2. **PIX** — QR Code dinâmico (`kind: "pix"`), com `qrCodeImage` (base64 PNG) e `qrCodeData` (EMV copia-e-cola).
3. **Webhook de status PIX** — eventos `PV.UPDATE_TRANSACTION_PIX` (pago) e `PV.REFUND_PIX` (devolução) via URL registrada.
4. **3DS 2.0 (Rede MPI)** — autenticação frictionless embutida (sem mudança perceptível na jornada na maioria dos casos).
5. **Estorno** — `POST /v2/transactions/{tid}/refunds` (total/parcial, síncrono).
6. **Consulta de status** — `GET /v2/transactions/{tid}` ou `?reference={referencia}`.

Não é necessário contratar produto separado para PIX (o fluxo é habilitado via call center cadastrando a URL de notificação; ver §3.6).

### 3.2 Autenticação — OAuth 2.0 (OBRIGATÓRIO a partir de 05/01/2026)

⚠️ **A Rede migrou TODA a autenticação para OAuth 2.0** (Basic está sendo descontinuado — prazo de ajuste: 5 de janeiro de 2026). O PV + Chave de Integração viraram `clientId` + `clientSecret`.

| Portal Rede | Credencial OAuth2 |
|---|---|
| **PV** (número de filiação) | `clientId` |
| **Chave de Integração** (menu "para vender" > e-commerce > "Chave de integração") | `clientSecret` |
| Token dinâmico | `access_token` |

**Endpoint do token:**
- **Sandbox:** `POST https://rl7-sandbox-api.useredecloud.com.br/oauth2/token`
- **Produção:** `POST https://api.userede.com.br/redelabs/oauth2/token`

**Request (curl):**
```bash
curl --request POST '{base_url}' \
  --header 'Authorization: Basic Base64(clientId:clientSecret)' \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data 'grant_type=client_credentials'
```
- `Authorization`: `clientId` + `clientSecret` unidos por `:` e codificados em base64.
- `Content-Type`: `application/x-www-form-urlencoded` (não JSON).
- `grant_type` fixo: `client_credentials`.

**Response:** `access_token`, `token_type` (`Bearer`), `expires_in`, `scope`.

**Regras críticas:**
- `access_token` válido por **24 minutos**; recomenda-se renovar entre **15 e 23 minutos** após a emissão. → Implementar cache com renovação antecipada.
- Enviar `Authorization: Bearer {access_token}` em **todas** as chamadas de negócio.
- **OAuth exige rotas V2** (V1 é incompatível; erro 370 se misturar).
- **PV sem zeros à esquerda** (enviar "0" à frente → `HTTP 401 invalid_client`).
- `HTTP 401` em chamadas de negócio = token expirado → renovar e repetir.
- Encoding: **UTF-8**; JSON com `Content-Type: application/json` em POST/PUT.

### 3.3 Endpoints (Base URLs + serviços)

| Ambiente | Base URL de autorização |
|---|---|
| **Sandbox** | `https://sandbox-erede.useredecloud.com.br/v2/transactions` |
| **Produção** | `https://api.userede.com.br/erede/v2/transactions` |

Composição: `Base URL` + `Versão da API` + `Serviço`.

| Serviço | Método | URL (produção) |
|---|---|---|
| Criar transação (cartão/PIX) | POST | `/erede/v2/transactions` |
| Consultar por tid | GET | `/erede/v2/transactions/{tid}` |
| Consultar por reference | GET | `/erede/v2/transactions?reference={codigo}` |
| Estornar | POST | `/erede/v2/transactions/{tid}/refunds` |
| Capturar | PUT | `/erede/v2/transactions/{tid}` |
| Cadastrar URL de notificação (sandbox) | POST | `/erede/v1/transactions/notification-URL` |
| Receber webhook PIX | POST | URL do cliente (registrada) |
| Token OAuth2 | POST | `/redelabs/oauth2/token` (prod) / `rl7-sandbox-api.useredecloud.com.br/oauth2/token` (sandbox) |

**Códigos HTTP:** 200 (GET ok) · 201 (POST criado) · 202 (processamento assíncrono) · 204 (PUT/DELETE ok) · 400 (malformado) · 401 (autenticação/token expirado) · 403 (negado) · 404 (não encontrado) · 405 (método) · 408 (timeout) · 413 (tamanho) · 415 (media type — falta `Content-Type: application/json`) · 422 (erro de negócio — ler `returnCode`/`returnMessage`) · 429 (limite de chamadas) · 500 (erro de servidor).

### 3.4 Cartão de crédito (checkout transparente) — `POST /v2/transactions`

**Request:**
```json
{
  "capture": true,
  "kind": "credit",
  "reference": "12345",
  "amount": 2099,
  "installments": 2,
  "cardholderName": "John Snow",
  "cardNumber": "5448280000000007",
  "expirationMonth": 12,
  "expirationYear": 2028,
  "securityCode": "235",
  "softDescriptor": "PALAZZO MOOCA",
  "subscription": false,
  "origin": 1
}
```

| Campo | Tamanho | Obrigatório | Descrição |
|---|---|---|---|
| `capture` | bool | Não (default `true`) | Captura automática; `false` = só autorização (captura depois via PUT) |
| `kind` | — | Não (default `credit`) | `credit` ou `debit` |
| `reference` | até 16 alfanum. | **Sim** | Código do pedido gerado pelo estabelecimento → **usar ID interno do pedido** |
| `amount` | até 10 num. | **Sim** | Valor em **centavos**, sem separadores (R$10,00 = `1000`) |
| `installments` | até 2 | Não | 2 a 12; **omitido = à vista (1x)** |
| `cardholderName` | até 30 | Não | Nome impresso no cartão, **sem caracteres especiais** |
| `cardNumber` | até 19 | **Sim** | Número do cartão |
| `expirationMonth` | 1-2 | **Sim** | Mês de validade (1-12) |
| `expirationYear` | 2 ou 4 | **Sim** | Ano de validade (ex: 2028 ou 28) |
| `securityCode` | até 4 | Não | CVV — enviar aumenta a chance de aprovação |
| `softDescriptor` | até 18* | Não | Frase na fatura do cartão → **nome do restaurante** (limitar a 18 chars, alfanumérico) |
| `subscription` | bool | Não | `false` (sem recorrência) |
| `origin` | até 2 | Não (default 1) | `1` = e.Rede |

**Response (sucesso):**
```json
{
  "reference": "12345",
  "tid": "8345000363484052380",
  "nsu": "663206341",
  "authorizationCode": "186376",
  "dateTime": "2017-02-28T08:54:00.000-03:00",
  "amount": 2099,
  "installments": 2,
  "cardBin": "544828",
  "last4": "0007",
  "returnCode": "00",
  "returnMessage": "Success.",
  "brand": { "name": "Mastercard", "returnCode": "82", "returnMessage": "...", "merchantAdviceCode": "03", "brandTid": "226332", "authorizationCode": "186376" },
  "links": [
    { "method": "GET", "rel": "transaction", "href": ".../transactions/{tid}" },
    { "method": "PUT", "rel": "capture", "href": ".../transactions/{tid}" },
    { "method": "POST", "rel": "refund", "href": ".../transactions/{tid}/refunds" }
  ]
}
```

**Regra de negócio:** `returnCode "00"` = aprovado. Outros códigos = recusado/erro (ler `returnMessage`). Em transação com 3DS pendente a resposta pode vir com `returnCode "220"` + URL de autenticação (ver §3.7). Para transações 3DS ou "Data Only" com erro HTTP 500, **consultar o status final por reference** (`GET /v2/transactions?reference=...`).

### 3.5 PIX — QR Code dinâmico (mesma API)

**Request (`POST /v2/transactions`):**
```json
{
  "kind": "pix",
  "reference": "12345",
  "amount": "3900",
  "qrCode": {
    "dateTimeExpiration": "2026-08-02T13:15:59"
  }
}
```
- `kind` **obrigatório** = `pix` · `reference` = ID do pedido · `amount` em centavos.
- `qrCode.dateTimeExpiration` — expiração do QR (formato `YYYY-MM-DDThh:mm:ss`), **máximo 15 dias**, não pode ser data passada. → Usaremos **+15 minutos** (decisão do usuário).

**Response:**
```json
{
  "reference": "12345",
  "tid": "40402307310827210012",
  "dateTime": "2023-07-31T14:08:50-03:00",
  "amount": 3900,
  "qrCodeResponse": {
    "dateTimeExpiration": "2023-08-30T16:48:00-03:00",
    "qrCodeImage": "iVBORw0KGgo...",   // PNG em base64 → usar como encodedImage (frontend atual)
    "qrCodeData": "00020101021226720014br.gov.bcb.pix2550bx.com.br/..."  // EMV copia-e-cola → usar como payload
  },
  "returnCode": "00",
  "returnMessage": "Success.",
  "links": [ ... ]
}
```

**Mapeamento para o formato atual do frontend** (minimizar mudanças no `TrackingView.vue`): `qrCodeImage` → `encodedImage`, `qrCodeData` → `payload`, `dateTimeExpiration` → `expirationDate`. Normalizar no backend.

**Consulta de PIX:** `GET /v2/transactions/{tid}` (ou por reference). ⚠️ `qrCodeData`/`qrCodeImage` **só voltam enquanto o status for `Pending`** (pagos/devolvidos não retornam). QR expirado → `returnCode 3036 "QrCode Expired"`.

**Status PIX (consulta):** `Pending` | `Approved` | `Canceled`. Devolução parcial mantém `Approved` até devolver 100%.

### 3.6 Webhook PIX — eventos, cadastro e payload

**Cadastro da URL (produção):** não é feito por API — o estabelecimento **liga para o call center da Rede** (4001 4433 capitais/regiões metropolitanas · 0800 728 4433 demais localidades) e informa: **CNPJ, PV, e-mail de contato e a URL** que receberá as notificações. Ativação em até **2 dias úteis**. O cadastro é por **CNPJ** (vale para todos os PVs do estabelecimento).

**Cadastro da URL (sandbox):** via API — `POST /erede/v1/transactions/notification-URL`:
```json
{
  "URL": "https://meudominio.com/api/pagamentos/webhook",
  "authorization": { "type": "bearer", "token": "MEU_TOKEN_ESCOLHIDO" }
}
```
- No sandbox, a notificação de pagamento é **simulada automaticamente 2 minutos** após gerar o QR.
- `authorization.type` = `Bearer` ou `Basic`; `authorization.token` = token nosso (opcional). Usar este mecanismo como **validação do webhook** (header `Authorization` na chamada da Rede).

**Eventos possíveis:**
| Evento | Significado |
|---|---|
| `PV.UPDATE_TRANSACTION_PIX` | PIX **aprovado** (pago) |
| `PV.REFUND_PIX` | Devolução **cancelada** (total ou parcial — apenas devoluções feitas por canais Itaú, ex: bankline) |

⚠️ **Devoluções feitas pela API não geram notificação** — a resposta do estorno é síncrona.

**Payload do webhook (formato oficial):**
```json
{
  "id": "f526fd25-da12-4874-a24d-c926186301e9",
  "merchantId": "90104480",
  "events": ["PV.UPDATE_TRANSACTION_PIX"],
  "data": {
    "txid": "RERO8044890090104480CV94HGTH46B6BD2",
    "id": "40402508050758050105",
    "endToEndId": "E0000000020241219172445877200001"
  }
}
```
- `id` (top-level) = id do evento; `merchantId` = PV (→ identificar tenant); `events` = lista de eventos; `data.id` = **TID** da transação (→ casar com `pagamentos.payment_id`); `data.endToEndId` = ID da liquidação PIX (BACEN).
- Outro formato equivalente no manual: `{ "companyNumber", "events", "data": { "id" } }`.
- **Dedup:** `id` do top-level é único por notificação → usar como chave em `webhook_events.event_id`. ⚠️ Confirmar na homologação se o mesmo evento pode chegar duplicado com ids diferentes; se sim, gerar dedup adicional `rede:{tid}:{event}`.
- **Recomendação da Rede:** aguardar **pelo menos 10 minutos** após a notificação antes de consultar detalhes (para confirmação de liquidação).

### 3.7 3-D Secure 2.0 (Rede MPI — frictionless)

**Ativação:** portal Rede "para vender" > e-commerce > 3DS > "contratar" (resposta em poucas horas). **Rede MPI** = serviço embutido na plataforma, sem contratação adicional de MPI externo.

**Regras:**
- **Obrigatório para cartão de débito.** Para crédito, é opcional.
- Com Rede MPI, no request da transação enviamos o bloco `threeDSecure`:
```json
"threeDSecure": {
  "embedded": true,
  "onFailure": "continue",
  "userAgent": "Mozilla/5.0 ...",
  "ipAddress": "192.168.130.20",
  "responseMode": "event",
  "device": {
    "colorDepth": 1, "deviceType3ds": "BROWSER",
    "javaEnabled": false, "language": "BR",
    "screenHeight": 500, "screenWidth": 500, "timeZoneOffset": 3
  },
  "billing": {
    "address": "Rua Pedro Luiz", "city": "Guarulhos",
    "postalCode": "07151-385", "state": "SP", "country": "Brasil",
    "emailAddress": "email@user.com", "phoneNumber": "(11)91234-5678"
  },
  "urls": [
    { "kind": "threeDSecureSuccess", "url": "https://{dominio}/api/pagamentos/3ds/sucesso" },
    { "kind": "threeDSecureFailure", "url": "https://{dominio}/api/pagamentos/3ds/erro" }
  ]
}
```
- `embedded: true` → usa o MPI da Rede. `onFailure: "continue"` → em crédito, se a autenticação falhar, podemos seguir sem 3DS (risco do lojista).
- `responseMode: "event"` + `urls` (success/failure) → são URLs **nossas** (públicas, HTTPS) para onde o navegador retorna após o desafio 3DS.

**Fluxo:**
1. **Frictionless (sem desafio):** o emissor autentica em silêncio; a transação é autorizada e o resultado retorna (via postback/consulta). **Nenhuma mudança perceptível para o cliente** — atende a decisão do usuário.
2. **Com desafio:** a resposta da API vem com `returnCode "220"` + `threeDSecure.url` (URL de autenticação). O app abre essa URL (iframe ou redirect) → cliente autentica → banco redireciona para nossa URL `threeDSecureSuccess`/`Failure` → **consultamos o resultado final por reference** (`GET /v2/transactions?reference=...`) para confirmar a autorização.
- **Importante:** não é possível simular iframe com 3DS no sandbox. Se der timeout no 3DS, consultar o status final por reference.
- **Códigos 3DS:** `200` autenticado · `201` autenticação não exigida · `202` não autenticado · `203` serviço não contratado · `204` portador não cadastrado · `220` requisição de autenticação recebida, URL de redirect enviada · `250-269` erros de validação (parâmetros/URLs) · `3000-3019` erros de validação do bloco `device`.
- ECI (indicador de comércio eletrônico): Visa 5/6/7, Mastercard 0/1/2/4/7, Elo 0/4/5/6/7 — usados para análise de responsabilidade por chargeback.

**Decisão para a implementação (revisada):** ativar 3DS v2 com Rede MPI, `onFailure: "continue"`, frictionless-first. **Se o banco exigir desafio** (`returnCode 220` + `threeDSecure.url`), o app faz **redirect para a página do banco** (nova aba) e o banco retorna para a nossa URL `threeDSecureSuccess`/`Failure`, que redireciona o navegador de volta ao app (tela de tracking) e consulta o resultado final por reference. *(Decisão: redirect, não iframe — compatível com o sandbox da Rede, que não simula iframe 3DS.)*

### 3.8 Estorno / Cancelamento — `POST /v2/transactions/{tid}/refunds`

**Request:**
```json
{ "amount": 2000, "urls": [ { "kind": "callback", "url": "https://cliente.callback.com.br" } ] }
```
- `amount` em centavos (obrigatório) — total ou parcial.
- `urls` (opcional): URL que receberá callback do status de cancelamento processado em D+1 (também cadastrável no portal "para vender" > e-commerce > "notificação automática"; a URL da API tem prioridade).

**Response (sucesso):**
```json
{
  "returnCode": "360",
  "returnMessage": "Refund request has been successful",
  "refundId": "d21c0fa9-...",
  "tid": "9274256037511432483",
  "nsu": "750004939",
  "refundDateTime": "2017-02-11T08:45:00.000-03:00",
  "cancelId": "786524681",
  "links": [...]
}
```

**Regras de negócio do estorno:**
- Autorização sem captura: cancelamento **total** apenas.
- Captura / captura automática: **total ou parcial**.
- Prazos: débito **7 dias**; crédito **até 90 dias** (varia por atividade). Mesmo dia → processamento imediato; caso contrário **D+1**. Pedidos após **21h30** processados no dia seguinte.
- PIX: até **90 dias** da autorização, total ou parcial, resposta **síncrona**.
- Código `360` = pedido de devolução recebido — **reconsultar depois** para confirmar sucesso.
- **Códigos de estorno:** `351` proibido · `353` não encontrado · `354` período expirado · `355` já cancelado · `357` soma > valor · `358` soma > disponível · `359` devolução bem-sucedida · `360` pedido recebido · `362` refundId não encontrado · `363` URL callback > 500 chars · `365` parcial indisponível · `368` sem sucesso, tente de novo · `369` refund não encontrado · `370` falha, contate Rede · `371` indisponível agora · `373` sem mais devoluções · `374` devolução não permitida (chargeback).

**Callback de estorno D+1 (formato):** `type` (`refund`), `tid`, `nsu`, `date`, `amount`, `status` (`Done` | `Denied` | `Processing`), `cancellationNotice`, `refundId`.

### 3.9 Consulta de transação — `GET /v2/transactions/{tid}` ou `?reference=`

- Por **tid**: transações até **400 dias**. Por **reference**: até **60 dias**.
- Estrutura da resposta: `requestDateTime`, `authorization { dateTime, returnCode, returnMessage, affiliation, status, reference, tid, nsu, authorizationCode, kind, amount, installments, currency, cardHolderName, cardBin, last4, softDescriptor, origin, subscription, authorizationEci, downgradeEci, brand {...} }`, `capture`, `threeDSecure`, `refunds`, `links`.
- **Status de cartão (consulta):** `Approved` | `Denied` | `Canceled` | `Pending`.
- Transação inexistente → `returnCode 78 "Transaction does not exist"`.

### 3.10 Testes (sandbox)

- Ambiente sandbox: `https://sandbox-erede.useredecloud.com.br` (base) — credenciais `clientId`/`clientSecret` geradas no portal após criar **projeto** e obter acesso ao ambiente de testes.
- **PIX no sandbox:** o pagamento é **simulado automaticamente 2 minutos** após gerar o QR (evento `PV.UPDATE_TRANSACTION_PIX`); devoluções parciais simuladas com QR de R$ 50,00 (evento `PV.REFUND_PIX`).
- **3DS no sandbox:** não é possível simular iframe com 3DS.
- Simulações adicionais no manual: transação com data retroativa, Zero Dollar, 3DS 2.0 com MPI Rede, PIX, erros de marca, configuração de webhook.

### 3.11 Pontos restantes para confirmar (menores — durante homologação)

1. **Casing real de `qrCode.dateTimeExpiration`** (o manual exibe "Date timeExpiration" — provável `dateTimeExpiration` na API real; validar com request real no sandbox).
2. **Dedup de webhooks:** confirmar se um mesmo evento pode chegar com `id` diferente (definir chave extra `rede:{tid}:{event}` se necessário).
3. ✅ **Resolvido:** 3DS com desafio será via **redirect para o banco** (não iframe).
4. **Cadastro da URL de notificação em produção** via call center (2 dias úteis) — agendar com o cliente antes do go-live.
5. **Exigência de TLS 1.2+** no endpoint de notificação (manual exige certificado público compatível com TLS 1.2 desde 2018).
6. **Cartões de teste do sandbox** (listados no portal logado, não reproduzidos no PDF).

---

## 4. Plano de Implementação

> Ordem sugerida. Cada fase termina com validação. **Nenhuma alteração foi feita ainda** — este é o plano a ser executado na próxima etapa.

### Fase 0 — Limpeza de dados de teste (antes de migrar)

Executar script (novo `backend/src/limpar-dados-teste.js` ou SQL único) que em **todos os tenants** apaga, em ordem:

1. `webhook_events`
2. `mensagens_pedido`
3. `pedido_timeline`
4. `pedido_itens`
5. `pagamentos`
6. `pedidos`
7. `clientes` (**todos** — decisão do usuário)
8. `entregadores` (**todos**)
9. `restaurante_users` (**todos** — recriados nos seeds)

**NÃO apagar:** `produtos`, `categorias`, `produtos_extras` (cardápio), `raios_entrega`, `mesas`, `banners`, `restaurantes`.

Reativar sequência de IDs de `pedidos` (ex: `setval`), como já fazem `011_limpar_pedidos.sql`/`limpar-pedidos.js`.

### Fase 1 — Recriar seeds padronizados (todos os tenants / módulos) ✅ IMPLEMENTADO

- **Equipe (restaurante_users):** apelido `admin`, senha `admin123`, cargo `admin`.
- **Cliente (clientes):** usuário `cliente`, senha `cliente123`.
- **Entregador (entregadores):** usuário `entregador`, senha `entregador123`.
- Implementado: migration `024_apelido_clientes_entregadores.sql` (coluna `apelido` em `clientes`/`entregadores` + índice UNIQUE por tenant), login por `apelido` **ou** telefone em `auth/index.js`, seeds em `seed.js`/`seed-tenant2.js`, suporte a apelido no `god/server.js`, README atualizado.

### Fase 2 — Migration do banco (PARCIALMENTE IMPLEMENTADO — campos god ✅)

Nova migration `025_rede_pagamentos.sql` (o nº 024 já foi usado pelos apelidos):

- ✅ **`restaurantes`** (implementado na 025): colunas dedicadas `rede_env`, `rede_client_id` (PV), `rede_client_secret` (Chave de Integração), `rede_webhook_token`. **As colunas `asaas_*` NÃO foram removidas ainda** — serão removidas na Fase 11 junto com todo o código que as referencia (para não quebrar o backend em execução).
- ⏳ **`clientes`**: `DROP COLUMN IF EXISTS asaas_customer_id` → Fase 11 (manter `cpf_cnpj`). `apelido` já adicionado na migration 024.
- ⏳ **`entregadores`**: `apelido` já adicionado na migration 024.
- ⏳ **`pagamentos`**: adaptar para Rede (payment_id = tid, customer_id NULL-able, `nsu`/`authorization_code`/`return_code`/`end_to_end_id`/`gateway`, `billing_type` com `DEBIT_CARD`, `status` com mapeamento Rede) → será feito junto da Fase 3-4 (serviço rede.js).
- ⏳ **`pedidos.metodo_pagamento`**: CHECK constraint com `debito_online` → Fase 4.
- ⏳ **`webhook_events`**: dedup com `id` do top-level → Fase 5.

### Fase 3 — Novo serviço `backend/src/services/rede.js`

Substituir `asaas.js` (que será deletado na Fase 9). Estrutura:

- **Credenciais multi-tenant** com cache (mesmo padrão atual): `getTenantCredentials(tenantId)` → `rede_env`, `rede_client_id`, `rede_client_secret`, `rede_webhook_token`. Erro `REDE_MISCONFIG` se não configurado.
- **OAuth2:** `getAccessToken(tenantId)` com cache (TTL 20 min, renovação antecipada aos ~15-20 min), `POST {base}/oauth2/token` com Basic `base64(clientId:clientSecret)` + `grant_type=client_credentials`. Em `HTTP 401` de negócio → limpar cache, renovar e repetir 1x.
- **Cartão:** `criarTransacaoCartao({ amountCentavos, reference, installments?, card: {cardholderName, cardNumber, expirationMonth, expirationYear, securityCode}, softDescriptor, capture=true, kind='credit', threeDSecure? })` → `{ tid, nsu, authorizationCode, returnCode, returnMessage, status, brand }`.
- **PIX:** `criarCobrancaPix({ valorCentavos, reference, dataExpiracao })` → `{ tid, qrCodeImage, qrCodeData, dateTimeExpiration }`; **normalizar** para `{ encodedImage, payload, expirationDate }`.
- **Consulta:** `consultarTransacao(tid|reference, tenantId)` → status/tid/refunds.
- **Estorno:** `estornarTransacao(tid, valorCentavos, tenantId)` → `{ returnCode, refundId, tid, nsu, cancelId }`.
- **Webhook:** `verificarAuthWebhook(headers, tenantToken)` (Bearer) e `resolverTenantPorWebhook(merchantId)`.
- **3DS:** helper de build do bloco `threeDSecure` (device/billing/urls) com `embedded: true`, `onFailure: 'continue'`, `responseMode: 'event'`.
- **Retry/Timeout:** reutilizar o padrão `withRetry` atual (backoff exponencial, retry só em erro de rede). Timeout `REDE_REQUEST_TIMEOUT` (30s).
- **Logging:** `[Rede] ...` no mesmo padrão.
- **Conversão de valores:** função `reaisParaCentavos(valor)` (ex: 62.90 → 6290) e `centavosParaReais`.

### Fase 4 — Módulo `pagamentos` (rotas) ✅ IMPLEMENTADO

`backend/src/modules/pagamentos/index.js` reescrito (migration 026 criada):

- `POST /api/pagamentos/criar`
  - Body: `tipo: 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD'`, `cliente {cpfCnpj, nome, telefone}`, `pedido {endereco,...}`, valores, `itens`, e para cartão: **dados brutos** `creditCard {holderName, number, expiryMonth, expiryYear, ccv}` (checkout transparente — corrige a inconsistência atual) + `creditCardHolderInfo` (usado no bloco 3DS `billing`).
  - Fluxo: transação no BD cria pedido `aguardando_pagamento` + itens + timeline → **fora** da transação: chamada à Rede.
  - PIX: criar cobrança → salvar `pagamentos` (payment_id = tid, encoded_image, payload) → responder `{ id, pedido_id, payment_id, status:'aguardando_pagamento', pix:{encodedImage, payload, expirationDate}, expira_em_segundos: 900 }`.
  - Cartão (crédito/débito): criar transação com 3DS (`kind: 'credit'` ou `'debit'`; para **débito o 3DS é obrigatório** — `onFailure: 'decline'` em vez de `'continue'`) → se `returnCode "00"` (aprovado): atualizar pedido p/ `pendente`, `emitNovoPedido`, responder `{ status:'pendente', cartao:{aprovado:true, tid} }`. Se `returnCode "220"` (desafio 3DS): responder com `{ status:'aguardando_3ds', url: threeDSecure.url, tid }` para o app fazer o **redirect** para o banco. Se recusado: cancelar pedido (timeline) e responder com erro amigável.
  - **Fallback:** Rede offline/timeout → `503 GATEWAY_UNAVAILABLE` com mensagem amigável (padrão atual).
- `POST /api/pagamentos/webhook` — novo handler Rede (validar `Authorization` bearer com `rede_webhook_token` do tenant, dedup por `id`, processar `PV.UPDATE_TRANSACTION_PIX`/`PV.REFUND_PIX`).
- `GET /api/pagamentos/3ds/sucesso` e `GET /api/pagamentos/3ds/erro` — redirecionam o navegador de volta ao app (tracking) após o desafio 3DS.
- `GET /api/pagamentos/:pedidoId/pix-qrcode` — mesma assinatura; lê de `pagamentos` (dados já normalizados).
- `GET /api/pagamentos/:pedidoId/verificar-status` — consulta status REAL na Rede (`GET /v2/transactions/{tid}`) e ativa pedido se pago; usado pelo **polling de 15s**.
- `GET /api/pagamentos/:pedidoId/refund-status` — consulta status do estorno (`refunds` na consulta de transação).
- `POST /api/pagamentos/:pedidoId/reembolsar` — **reembolso manual** (admin/gerente) mantido; chama `estornarTransacao`.
- **Remover** `POST /tokenizar-cartao` e `GET /webhook-health`.

### Fase 5 — Webhook handler da Rede ✅ IMPLEMENTADO

Novo `backend/src/modules/pagamentos/redeWebhookHandler.js` criado (substitui `webhookHandler.js`):

- `PV.UPDATE_TRANSACTION_PIX` → `atualizarPagamento(status 'RECEIVED', pago_em=NOW(), end_to_end_id)` + `ativarPedidoSeAguardando` (via `data.id`=tid → `pagamentos.payment_id`) + `emitNovoPedido`.
- `PV.REFUND_PIX` → `atualizarPagamento(status 'REFUNDED')`; notificar admin.
- **Dedup:** `webhook_events.event_id` = `id` top-level (mais chave secundária `rede:{tid}:{event}` se necessário).
- Estornos por API: resposta síncrona (sem evento); o `refund-status`/consulta cobre.

### Fase 6 — Polling de backup (15s) ✅ IMPLEMENTADO

`backend/src/services/pollingRede.js` criado e iniciado no `index.js`:

- A cada 15s, busca pedidos `aguardando_pagamento` com `pagamentos.status = 'PENDING'` (FIFO, LIMIT 20/ciclo).
- `Approved` → mesmo processamento do webhook (`processarEventoRede`) ativa pedido.
- `3036`/`Canceled` → cancela pedido (OVERDUE).
- `Denied` → cancela pedido (motivo 'Cartão recusado') e marca pagamento `REFUSED`.
- **Fallback de segurança:** desistir (cancelar) após expiração do PIX + 5min — **apenas para PIX** (cartão em 3DS não é cancelado por tempo).
- Guardas: `running` (sem concorrência), per-pedido try/catch, `unref()` (não bloqueia shutdown).

### Fase 7 — Módulo god (campos + UI) ✅ IMPLEMENTADO

- ✅ `god/server.js`:
  - CRUD de tenants passa a usar colunas `rede_*` (listagem com `tem_rede`, GET/PUT).
  - Criar tenant: salvar campos `rede_*` (defaults `rede_env='sandbox'`).
  - Endpoint de transações Rede lê `pagamentos` (tabela adaptada na migration 026 — campos `nsu`/`return_code`/`end_to_end_id`/`gateway` retornados via `SELECT pg.*`).
  - Default de `formas_pagamento` = `['dinheiro','credito','debito','pix','pix_online','credito_online','debito_online']` (spec §8).
- ✅ `god/index.html`:
  - Tab "💰 Asaas" → **"🔒 Rede"** (transações) renomeada; formulário "🔐 Credenciais Asaas" → **"🔒 Credenciais Rede Pagamentos"** com: Ambiente (sandbox/produção), `rede_client_id` (= PV), `rede_client_secret` (= Chave de Integração), `rede_webhook_token` (token próprio) + instruções de onde obter cada um no portal Rede.
  - Tabela de tenants: coluna/tag `tem_rede` (✅ Configurado / —).
  - Tab Pagamentos: label `debito_online` adicionado (formas online salváveis).
  - Aba de transações: colunas NSU e Cód (return_code), end-to-end ID em tooltip, status `REFUSED`/`CANCELLED` em vermelho; detalhe do pedido mostra valor, NSU, return_code, authorization_code, end_to_end_id, gateway e pago_em.
  - Nenhuma referência a "asaas" restante em `god/`.

### Fase 8 — Cliente (app) ✅ IMPLEMENTADO

- `CheckoutPanel.vue`:
  - PIX Online: manter fluxo (CPF obrigatório) — sem mudança visual.
  - Cartão Online: **payload corrigido** — envia `creditCard` (dados brutos) + `creditCardHolderInfo` (sem `creditCardToken`); referência a tokenização removida.
  - **Nova opção `debito_online`** no select de pagamento com os mesmos campos de cartão; envio com `tipo: 'DEBIT_CARD'`.
  - 3DS com desafio: resposta `status:'aguardando_3ds'` → limpa carrinho, fecha drawer, **abre `url` em nova aba** e leva ao tracking (que confirma via polling/webhook).
  - Guard de CPF explícito para todos os métodos online (`['pix_online','credito_online','debito_online']`).
  - Pagamento online fica **restrito ao delivery** (etapa de checkout); o salão/PDV não oferece estas opções.
  - Mensagem de fallback existente (`GATEWAY_UNAVAILABLE`) permanece.
- `TrackingView.vue`:
  - Manter QR (campos normalizados `encodedImage`/`payload`), botão copiar e "gerar novo QR".
  - Timer visual: **15 minutos** (alinhado com a expiração da Rede).
  - `isOnlinePayment` inclui `debito_online` (badge de estorno).
- `services/api.js`: comentário renomeado para "Rede Payment Methods"; assinaturas inalteradas.

### Fase 9 — Restaurante (painel) ✅ IMPLEMENTADO

- `OrdersView.vue`:
  - **Removidos** os botões "Verificar Pagamento" e "Confirmar Pagamento" (substituídos por texto "⏳ Aguardando confirmação do pagamento...") e as funções `verificarPagamento`/`confirmarPagamento`/`verificandoIds`.
  - Badges de estorno mantidos (polling `refund-status` — consulta a Rede).
  - Comentários atualizados (sem "consulta API Asaas").
  - Status `aguardando_pagamento` continua exibido com badge.
  - `paymentLabel`/`isOnlinePayment` incluem `debito_online`.
- Busca por "asaas" em `restaurante/src` → **zero menções** (nenhuma nos demais views).

### Fase 10 — Fallbacks (consolidado)

| Cenário | Comportamento |
|---|---|
| Rede offline/timeout | `503 GATEWAY_UNAVAILABLE` + mensagem "Tente novamente ou escolha pagamento na entrega" |
| Credenciais do tenant ausentes | Bloquear pagamento online com mensagem clara (sugerir pagamento na entrega); log `REDE_MISCONFIG` |
| Token OAuth expirado (HTTP 401) | Renovar token automaticamente e repetir 1x |
| Webhook PIX não chega | Polling de backup 15s ativa o pedido quando pago |
| Cartão recusado | Pedido cancelado com motivo + timeline + notificação |
| 3DS com desafio | Abrir URL de autenticação; após retorno, consultar resultado final por reference |
| PIX expirado (`3036`) | Pedido cancelado (detecção no polling/webhook) |
| Estorno falha/negado | `pagamentos.status` atualizado; admin notificado (badge no painel) |
| Pagamento duplicado (dedup) | `webhook_events.event_id` (id do webhook) |
| HTTP 429 (rate limit) | Backoff exponencial + respeito ao intervalo de polling |

### Fase 11 — Remoção total do Asaas ✅ IMPLEMENTADO (decisão: definitiva, sem preservar nada)

- Deletar: `backend/src/services/asaas.js`, `backend/src/modules/pagamentos/webhookHandler.js`, `check-webhook.js`, `diagnostico-asaas.js`, `e2e-asaas-test.js`, `test-pix.js`, `testar-refund-*.js` (3 arquivos), `simular-pagamento.js`.
- Remover imports `asaas` em `pedidos/index.js` (e o bloco de reembolso automático — decisão: reembolso manual) e `pagamentos/index.js`.
- Remover bloco `asaas` de `backend/src/config/index.js`.
- Remover `asaas_api_key`/`asaas_env` das queries do `tenantResolver.js`.
- Remover variáveis `ASAAS_*` de `docker-compose.yml` e `stack.env`.
- Migration para dropar colunas/tabelas legadas (aproveitar a 024 — ver Fase 2).
- Buscar `asaas|Asaas|ASAAS` em todo o repo (incl. `god/`, `cliente/`, `restaurante/`, `entregador/`, README) e remover.
- **As migrations 006/012 não devem ser editadas** (histórico); a limpeza real é feita pela migration 024.

### Fase 12 — Testes (todas as jornadas) + Code Review ✅ IMPLEMENTADO (pendente homologação no sandbox)

**Jornadas a testar (e2e, no sandbox da Rede):**

1. **PIX online feliz:** criar pedido → QR gerado → sandbox simula pagamento em 2min → webhook `PV.UPDATE_TRANSACTION_PIX` → pedido vira `pendente` → tracking atualiza.
2. **PIX expirado:** QR expira → `3036` → pedido cancelado com motivo.
3. **PIX copia-e-cola:** `qrCodeData` (EMV) copiável e válido; `qrCodeImage` renderiza.
4. **Cartão aprovado:** checkout → Rede → `returnCode "00"` → pedido `pendente` → fila do restaurante.
5. **Cartão recusado:** pedido cancelado, mensagem amigável.
6. **3DS frictionless:** cartão com 3DS autenticado em silêncio → pedido aprovado sem mudança de tela.
7. **3DS com desafio (se simulável):** `220` → redirect para o banco → retorno → consulta final.
8. **Débito online:** opção `debito_online` no checkout → transação `kind: 'debit'` com 3DS obrigatório → aprovação/recusa.
9. **Webhook falha:** polling de 15s ativa o pedido.
10. **Rede offline:** `GATEWAY_UNAVAILABLE` e sugestão de pagamento na entrega.
11. **Reembolso manual:** cancelar pedido pago → admin estorna (`refunds`) → status atualiza (badge).
12. **Multi-tenant:** tenant com credenciais sandbox funciona; tenant sem credenciais bloqueia com mensagem.
13. **Login seeds:** `admin`/`admin123`, `cliente`/`cliente123`, `entregador`/`entregador123` funcionam em todos os módulos, pós-limpeza.
14. **Regressão COD:** dinheiro/cartão na entrega/salão continuam funcionando.

**Validação técnica:** novo `e2e-rede-test.js` (substitui `e2e-asaas-test.js`), `node --check` nos arquivos alterados, e revisão com code-reviewer após implementação.

---

## 5. Campos do Módulo God (tabela para o formulário)

| Campo | Coluna | Obrigatório | Descrição / Onde obter |
|---|---|---|---|
| Ambiente | `rede_env` | sim (default `sandbox`) | `sandbox` ou `production` |
| PV / Filiação (= clientId) | `rede_client_id` | sim | Número de filiação (PV) — Portal Rede ("para vender" > e-commerce). **Sem zeros à esquerda.** É o `clientId` do OAuth2 e o `merchantId`/`companyNumber` do webhook |
| Chave de Integração (= clientSecret) | `rede_client_secret` | sim | Gerada no Portal Rede (menu "Chave de integração") — é o `clientSecret` do OAuth2 |
| Token do Webhook (nosso) | `rede_webhook_token` | recomendado | Token ESCOLHIDO POR NÓS, enviado à Rede no cadastro da URL de notificação (header `Authorization: Bearer`) e validado quando a Rede nos chama |

> **Observação:** a autenticação é OAuth2 (`client_id`=PV + `client_secret`=Chave de Integração). Não há mais "token básico separado" no padrão antigo. O `rede_webhook_token` é uma credencial que **nós** definimos para proteger nosso endpoint de webhook.

Campos que **não** viram coluna (decisões fixas): soft descriptor (usa `restaurantes.nome`, limitar 18 chars), expiração PIX (15min), parcelas (1x), 3DS (v2 frictionless, Rede MPI), descrição/reference (`{id}` do pedido).

**Instruções de onboarding para o cliente (texto da UI do god):**
1. Criar conta/empresa no Portal do Desenvolvedor Rede (developer.userede.com.br/login).
2. Criar um **projeto** (libera ambiente sandbox e credenciais).
3. Obter **PV** e **Chave de Integração** (menu "para vender" > e-commerce).
4. Cadastrar a URL de notificação PIX no call center da Rede (4001 4433 / 0800 728 4433) informando CNPJ, PV, e-mail e a URL `https://{dominio}/api/pagamentos/webhook` (ativação ~2 dias úteis).
5. Preencher os campos no módulo god.

---

## 6. Mapeamento de Status (Rede → nosso)

### Cartão (e-Rede v2) — crédito e débito

| Situação | Rede | `pagamentos.status` | `pedidos.status` |
|---|---|---|---|
| Aprovado | `returnCode "00"` (criação) / status `Approved` (consulta) | `RECEIVED`/`CONFIRMED` + `pago_em` | `pendente` |
| 3DS com desafio | `returnCode "220"` + `threeDSecure.url` | `PENDING` (aguardando_3ds) | `aguardando_pagamento` |
| Recusado | demais returnCodes / status `Denied` | `REFUSED` | `cancelado` (motivo) |
| Cancelado/estornado | status `Canceled` / código estorno 359/360 | `REFUNDED`/`CANCELLED` | `cancelado` |

### PIX (e-Rede v2)

| Situação | Rede | `pagamentos.status` | `pedidos.status` |
|---|---|---|---|
| Aguardando | `Pending` (consulta) / sem evento | `PENDING` | `aguardando_pagamento` |
| Pago | evento `PV.UPDATE_TRANSACTION_PIX` / status `Approved` | `RECEIVED` + `pago_em` + `end_to_end_id` | `pendente` |
| Expirado | `returnCode 3036` ("QrCode Expired") | `OVERDUE` | `cancelado` (motivo) |
| Cancelado/devolvido | evento `PV.REFUND_PIX` / status `Canceled` | `REFUNDED`/`CANCELLED` | `cancelado` |

### Códigos de retorno relevantes (resumo)

- **Aprovação:** `00` Success.
- **3DS:** `200` autenticado · `201` não exigida · `202` não autenticado · `203` serviço não contratado · `204` portador não cadastrado · `220` redirect enviado.
- **PIX:** `3036` QR expirado · status `Pending`/`Approved`/`Canceled`.
- **Estorno:** `359` devolução ok · `360` pedido recebido (reconsultar) · `373` sem mais devoluções · `374` chargeback em disputa · `370` falha, contate Rede.
- **Erros HTTP:** 401 token expirado (renovar) · 422 erro de negócio (ler returnCode) · 429 rate limit (backoff).

---

## 7. Riscos e Pendências

1. ✅ **Resolvido com a pesquisa:** endpoints, autenticação OAuth2, payloads de webhook, fluxo 3DS, regras de estorno, códigos de retorno e testes de sandbox — todos extraídos do manual oficial.
2. **Cadastro da URL de notificação em produção é manual** (call center, 2 dias úteis) — agendar com o cliente **antes** do go-live; sem a URL cadastrada, PIX nunca é confirmado por webhook (só polling).
3. **Mudança no modelo de dados de cartão:** o checkout transparente torna o backend o manipulador de dados de cartão (escopo PCI-DSS SAQ A-EP). Garantir: HTTPS, TLS 1.2+, sem logs de dados sensíveis, descarte imediato em memória.
4. **Inconsistência atual do checkout de cartão** (frontend envia `creditCard` cru, backend espera `creditCardToken`) será corrigida na migração — não é bug novo, mas precisa ser validado.
5. ✅ **Resolvido:** 3DS com desafio via **redirect para o banco** (o sandbox não simula iframe — decisão já alinhada). Nota: **débito online exige 3DS obrigatório** (`onFailure: 'decline'`), então a UX de redirect será obrigatória para débito.
6. **Reembolso automático removido:** cancelamento de pedido pago não estorna mais sozinho; depende do admin (decisão do usuário). Treinar/avisar operadores.
7. **Seed `cliente`/`entregador` por username** exige coluna `apelido` em `clientes`/`entregadores` + ajuste no login (extensão da migration 022).
8. **Token OAuth2 (24 min):** implementar cache com renovação antecipada e retry em 401, senão transações falham.
9. **Valores em centavos:** toda a camada de pagamento precisa converter BRL ↔ centavos; erros de conversão geram transações de valor errado.

---

## 8. Escopo Fora Desta Migração (mantido como está)

- Pagamentos COD (dinheiro, cartão na entrega) e salão/conta — nenhuma alteração.
- Formas de pagamento aceitas (`formas_pagamento_aceitas` / tab Pagamentos do god / ConfigView) — `pix_online`, `credito_online` mantidos e **`debito_online` adicionado** (default: `["dinheiro","credito","debito","pix","pix_online","credito_online","debito_online"]`).
- Frete, cardápio, banners, mesas, raios, push, realtime — intactos.

---

## Apêndice A — Referência rápida da API e-Rede v2 (extraída do manual oficial)

### A.1 Autenticação OAuth2
- Token: `POST {sandbox|prod}/oauth2/token` · Basic `base64(clientId:clientSecret)` · `grant_type=client_credentials` · `Content-Type: application/x-www-form-urlencoded`.
- Sandbox: `https://rl7-sandbox-api.useredecloud.com.br/oauth2/token` · Produção: `https://api.userede.com.br/redelabs/oauth2/token`.
- Validade: 24 min; renovar 15–23 min. Usar `Authorization: Bearer {access_token}`.

### A.2 URLs de negócio
- Sandbox: `https://sandbox-erede.useredecloud.com.br` · Produção: `https://api.userede.com.br/erede`.
- Cartão/PIX: `POST /v2/transactions` · Consulta: `GET /v2/transactions/{tid}` ou `?reference=` · Estorno: `POST /v2/transactions/{tid}/refunds` · Captura: `PUT /v2/transactions/{tid}`.
- Cadastro URL sandbox: `POST /v1/transactions/notification-URL`.

### A.3 Exemplos de payload

**PIX request:**
```json
{ "kind": "pix", "reference": "12345", "amount": "3900",
  "qrCode": { "dateTimeExpiration": "2026-08-02T13:15:59" } }
```

**PIX response (campos relevantes):** `tid`, `qrCodeResponse.qrCodeImage` (base64 PNG), `qrCodeResponse.qrCodeData` (EMV), `qrCodeResponse.dateTimeExpiration`, `returnCode "00"`.

**Webhook PIX:**
```json
{ "id": "f526fd25-da12-4874-a24d-c926186301e9", "merchantId": "90104480",
  "events": ["PV.UPDATE_TRANSACTION_PIX"],
  "data": { "txid": "...", "id": "40402508050758050105", "endToEndId": "E00000000..." } }
```

**Cartão request (com 3DS):** ver §3.4 e §3.7.

**Estorno request:** `{ "amount": 2000, "urls": [{ "kind": "callback", "url": "https://..." }] }`

**Estorno response:** `returnCode "360"`, `refundId`, `tid`, `nsu`, `refundDateTime`, `cancelId`.

### A.4 Fontes
- Manual e-Rede (PDF, 285 págs.): `https://developer.userede.com.br/files/traducoes/erede/e-rede-24032026.pdf`
- Portal do Desenvolvedor Rede: `https://developer.userede.com.br` (e-Rede: `/e-rede` · e-commerce: `/plataformas-e-commerce`)
- Apiary Serviços Rede: `https://apiaryapib2.docs.apiary.io/`
