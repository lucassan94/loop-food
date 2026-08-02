# Requirements — SaborExpress V2 / LoopFood

> Fonte oficial dos requisitos. Cada requisito possui identificador. Atualizar sempre que um requisito surgir, mudar ou for removido.

## Requisitos Funcionais (RF)

### Autenticação
- **RF-001** — Login de cliente por **apelido** ou **telefone** + senha (JWT, sessão de longa duração).
- **RF-002** — Login de entregador por **apelido** ou **telefone** + senha.
- **RF-003** — Login de equipe (restaurante) por **apelido** + senha; cargos com permissões (admin, gerente, etc.).
- **RF-004** — Cadastro/autoatendimento de cliente com CPF/CNPJ opcional, endereço e CEP com busca via API de CEP.
- **RF-005** — Gestão de usuários da equipe no painel admin (novos usuários usam apelido, senha padrão `senha123`).
- **RF-006** — Criação de tenant no god com credenciais padrão `admin`/`admin123`.

### Cardápio e pedidos
- **RF-010** — Cardápio digital por tenant: categorias, produtos, extras, imagens, raios de entrega.
- **RF-011** — Carrinho e checkout com endereço de entrega e cálculo de frete.
- **RF-012** — Fluxo de pedidos: `aguardando_pagamento → pendente → preparando → pronto_entrega → em_transito → cheguei_destino → entregue` (terminais: `cancelado`, `recusado`).
- **RF-013** — PDV de salão e gestão de mesas (pedido na conta, status de salão).
- **RF-014** — KDS (kitchen display) para a cozinha.
- **RF-015** — Banners promocionais configuráveis por tenant.
- **RF-016** — Relatórios de pedidos e entregas (módulo restaurante).

### Pagamento online (API da Rede e-Rede v2)
- **RF-020** — PIX online com QR Code dinâmico (`kind: "pix"`), expiração de 15 minutos, copia-e-cola e imagem base64 normalizados (`encodedImage`/`payload`/`expirationDate`).
- **RF-021** — Cartão de crédito online (checkout transparente, `kind: "credit"`) com 3-D Secure v2 (Rede MPI), à vista.
- **RF-022** — Cartão de débito online (`kind: "debit"`, opção `debito_online`) com **3DS obrigatório**.
- **RF-023** — Confirmação de pagamento PIX via **webhook** (`PV.UPDATE_TRANSACTION_PIX`) com **polling de backup de 15s**.
- **RF-024** — Consulta de status real da transação na Rede (`GET /v2/transactions/{tid}`) e por reference.
- **RF-025** — Reembolso manual (admin/gerente) via `POST /v2/transactions/{tid}/refunds`; consulta de status do estorno.
- **RF-026** — 3DS com desafio: redirect para o banco (URL de autenticação), retorno via `threeDSecureSuccess`/`threeDSecureFailure`, consulta final por reference.
- **RF-027** — Fallback: Rede offline → `503 GATEWAY_UNAVAILABLE` com sugestão de pagamento na entrega; tenant sem credenciais → `REDE_MISCONFIG` bloqueando online.

### Multi-tenant e god
- **RF-030** — Módulo god com CRUD de tenants e **credenciais da Rede por tenant** (`rede_env`, `rede_client_id`=PV, `rede_client_secret`=Chave de Integração, `rede_webhook_token`).
- **RF-031** — God com formulário de onboarding Rede (instruções do portal developer.userede.com.br), tabela de tenants com tag `tem_rede`, tab de transações (NSU, return_code, end-to-end ID).
- **RF-032** — Formas de pagamento configuráveis por tenant (default inclui `pix_online`, `credito_online`, `debito_online`).

### Realtime e push
- **RF-040** — Notificações em tempo real via WebSocket (novo pedido, atualização de status).
- **RF-041** — Push notifications (web-push) com inscrição no navegador.

## Requisitos Não Funcionais (RNF)

- **RNF-001** — Multi-tenant com isolamento por `restaurant_id` (RLS role-based aplicado no banco).
- **RNF-002** — JWT por tenant (`restaurantes.jwt_secret`), cookies httpOnly, rate limiting por rota.
- **RNF-003** — Segurança: helmet, CORS com wildcard por subdomínio, validação zod, sem logs de dados sensíveis de cartão.
- **RNF-004** — PCI-DSS (escopo SAQ A-EP do checkout transparente): TLS 1.2+, dados de cartão apenas em memória, descarte imediato.
- **RNF-005** — Disponibilidade do gateway: retry com backoff exponencial, timeout 30s, polling de backup, dedup de webhook.
- **RNF-006** — Token OAuth2 da Rede com cache (TTL 20min, renovação antecipada) e renovação automática em 401.
- **RNF-007** — Valores monetários em **centavos** na camada de integração (conversão rigorosa).
- **RNF-008** — Frontends em Vue 3 (SPA), build estático servido por nginx.
- **RNF-009** — Backend Node.js (ESM), Express, PostgreSQL 16, Docker/docker-compose.

## Regras de Negócio (RN)

- **RN-001** — Login identifica por apelido **ou** telefone; telefone normalizado (somente dígitos) na busca.
- **RN-002** — Pagamento online somente em delivery; salão/PDV usa conta (COD).
- **RN-003** — Parcelamento: somente à vista (omitir `installments`).
- **RN-004** — Débito online exige 3DS (`onFailure: "decline"`); crédito usa `onFailure: "continue"`.
- **RN-005** — Soft descriptor = nome do restaurante (≤18 chars, alfanumérico).
- **RN-006** — Expiração PIX = 15 minutos (`dateTimeExpiration`).
- **RN-007** — `reference` da transação Rede = ID interno do pedido.
- **RN-008** — Reembolso manual: cancelar/recusar pedido pago **não** estorna automaticamente; admin usa `POST /:pedidoId/reembolsar`.
- **RN-009** — Pedido só entra na fila do restaurante após confirmação do pagamento (webhook/polling).
- **RN-010** — Cartão recusado → pedido cancelado com motivo; PIX expirado (`3036`) → pedido cancelado (OVERDUE).
- **RN-011** — Dedup de webhook: `event_id` (id top-level) + chave secundária `rede:{tid}:{event}`.
- **RN-012** — Estornos por API são síncronos (sem webhook); devoluções feitas por canais Itaú geram `PV.REFUND_PIX`.
- **RN-013** — Prazos de estorno: débito 7 dias, crédito até 90 dias, PIX até 90 dias; pedidos após 21h30 processados no dia seguinte.

## Critérios de Aceite (por área)

### Checkout online (Rede)
1. PIX: QR gerado, copia-e-cola válido, timer de 15min, confirmação automática por webhook/polling.
2. Cartão aprovado (`returnCode "00"`) → pedido `pendente` e visível na fila.
3. Cartão recusado → mensagem amigável + pedido cancelado com motivo.
4. 3DS com desafio (`220`) → redirect abre em nova aba; retorno confirma resultado final por reference.
5. Débito online envia `kind: "debit"` com 3DS obrigatório.
6. Rede offline → erro amigável sugerindo pagamento na entrega (nenhum pedido órfão).
7. Tenant sem credenciais Rede → online bloqueado com mensagem clara.

### Reembolso manual
8. Admin estorna pedido pago; `pagamentos.status` atualiza (REFUNDED/REFUND_IN_PROGRESS); badge visível no painel.

### Multi-tenant
9. Tenant com credenciais sandbox funciona; tenant sem credenciais bloqueia online; god salva/lê credenciais corretamente.

### Regressão
10. COD (dinheiro/cartão na entrega) e salão/conta continuam funcionando após a migração.
11. Seeds `admin`/`admin123`, `cliente`/`cliente123`, `entregador`/`entregador123` funcionam em todos os módulos.
