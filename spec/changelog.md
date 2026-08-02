# Changelog — SaborExpress V2 / LoopFood

> Histórico cronológico do projeto. Atualizar após qualquer alteração.

## [2.3.2] — 02/08/2026 — Deploy incremental (delta por hash)

### Adicionado (deploy)
- **Sincronização incremental no `deploy.py`**: manifesto `.deploy_manifest.json` no servidor com o hash SHA-256 de cada arquivo enviado. Na primeira subida (ou `--force`) envia tudo e grava o manifesto; nas seguintes, apenas os arquivos cujo hash mudou (ou que faltam no manifesto) são copiados — deploys rotineiros enviam só o que foi alterado, em segundos.
- Flags `--force` (reenvia tudo, ignora a comparação) e `--dry-run` (mostra o que mudaria sem enviar nada) para `upload` e `images`.
- `.vite` (cache do dev server, `deps_temp_*`) adicionado ao `EXCLUDE_DIRS` — deixou de subir 3 arquivos de lixo.

### Alterado (deploy)
- `upload` e `images` compartilham o **mesmo manifesto**: rodar um comando não apaga as entradas do outro (merge preserva a outra raiz).
- Escrita do manifesto em bytes UTF-8 explícito (funciona em qualquer versão do paramiko).
- Manifesto só é reescrito quando houve upload (evita write + round-trip à toa).
- Docstring/uso: documentado o caso de arquivo removido manualmente no servidor (recuperação com `upload --force`).

### Corrigido (deploy)
- `--force` em `images` apagava as entradas de código do manifesto → o próximo `upload` refazia upload completo. Agora o manifesto é sempre carregado e o `--force` apenas ignora a comparação de igualdade.

### Validado (VPS real)
- 1º `upload`: 124 enviados, manifesto criado; 2º `upload`: 0 enviados / 124 inalterados (segundos).
- `images`: 45 enviadas → 2º: 0 / 45 inalteradas.
- Manifesto final no servidor: 169 entradas (124 código + 45 imagens) — merge entre comandos funcionando.

## [2.3.1] — 02/08/2026 — Endereço no checkout + fonte do painel

### Adicionado (cliente)
- **Endereço salvo no perfil ao clicar "Continuar"** na etapa de endereço do checkout (`goToStep3` → nova função `salvarPerfilNoCheckout()`). Antes só era salvo na confirmação do pedido; agora, se o cliente alterar o endereço, ele é registrado no banco (`PUT /clientes/perfil`) no momento do clique, sem bloquear o fluxo (fire-and-forget com try/catch).
- Refactor: os 3 blocos duplicados de `PUT /clientes/perfil` (etapa de endereço + fluxos online/COD do `confirmOrder`) centralizados na função única `salvarPerfilNoCheckout(cpfCnpj)` — sem drift futuro do payload.

### Corrigido (restaurante)
- BUG-012: **form controls com fonte Arial** no painel (selects, abas, botões). Reset global `button, input, select, textarea { font-family: inherit; }` no `main.css` — agora tudo herda a Inter.

## [2.3.0] — 02/08/2026 — Reorganização da estrutura de pastas

### Estrutura nova
- **`app/`** — código da aplicação que vai para a VPS: `backend/`, `cliente/`, `restaurante/`, `entregador/`, `router/`, `docker-compose.yml`.
- **`migrations/`** — SQL de schema fora de `app/` (sincronizado sob demanda no `deploy.py migrate`; container monta `./migrations:/app/migrations:ro`).
- **`others/`** — ferramentas locais: `deploy.py`, `deploy_config.json`, `god/`, `README.md`, `run.bat`, `stack.env`.
- **`spec/`** — adicionado `rede-api-migracao-spec.md` (spec original da migração).
- **`trash/`** — arquivos descartados: `.env` raiz, `docs/`, `__pycache__/`, `bl`, migrations obsoletas (`006_asaas_pagamentos`, `011_limpar_pedidos`, `023_apelido_backfill`), `backend.log`/`.env` antigos do backend.

### Alterado
- `deploy.py` — upload passa a subir `app/` (APP_ROOT) em vez da raiz; `images` usa `app/backend/uploads`; `migrate` sincroniza `migrations/` para a VPS antes de rodar.
- `backend/src/migrate.js` — suporte a `MIGRATIONS_DIR` (default `../migrations` relativo a src → montado no container).
- `docker-compose.yml` — volume `./migrations:/app/migrations:ro` no backend.
- `README.md`, `run.bat`, `.gitignore` — caminhos ajustados à nova estrutura.

## [2.2.1] — 02/08/2026 — Certificado wildcard + página em branco

### Corrigido
- **Página em branco nos subdomínios de tenant** (`palazzomooca.loopautomacoes.com.br`, `saborexpress...`): causa raiz era o certificado SSL do NPM (`npm-1`) que só cobria o domínio raiz (`DNS:loopautomacoes.com.br`, sem wildcard). Com a CSP `upgrade-insecure-requests`, o navegador era forçado a HTTPS e recebia `ERR_CERT_COMMON_NAME_INVALID` → JS bloqueado → tela branca.
- **Certificado wildcard `*.loopautomacoes.com.br` emitido** via Let's Encrypt com **DNS-01 manual** (registro TXT `_acme-challenge` na Umbler — wildcard não é emitido por HTTP-01). Validade: **31/10/2026**.

### Observado
- **502 transitório** durante o reload do NPM: o proxy temporariamente resolveu `forward_scheme=https` contra o router (HTTP puro) → `SSL_do_handshake: wrong version number`. Voltou ao normal sozinho após o reload; `17.conf` correto (`set $forward_scheme http`).

## [2.2.0] — 02/08/2026 — Deploy via SSH (sem GitHub)

### Adicionado
- `deploy.py` — script de deploy via SSH/SFTP (paramiko): comandos `check`, `upload`, `images`, `env`, `migrate`, `up`, `deploy`, `logs`, `ps`. Compatível com `docker-compose` v1 (detecção **no servidor** via `compose_cmd(client)`). Credenciais em `deploy_config.json` (gitignored).
- `deploy_config.json` (gitignored) — credenciais da VPS (host, user, pass, dir `/opt/restaurante-v3`).
- Comando `env` no deploy.py — cria o `.env` de produção no servidor se não existir.
- Comando `images` — sincroniza somente `backend/uploads` (evita sobrescrever uploads de produção no deploy automático).
- Comando `migrate` — roda `node src/migrate.js` dentro do container backend.

### Alterado
- `docker-compose.yml` — healthcheck do backend usa `127.0.0.1` (IPv4) em vez de `localhost` (que resolvia para `::1` → falso unhealthy); uploads agora em bind mount `./backend/uploads:/app/uploads` (imagens viajam junto no deploy).
- `backend/Dockerfile` — healthcheck IPv4 `127.0.0.1`.
- `.gitignore` — `deploy_config.json` adicionado (nunca commitar credenciais).

### Corrigido
- Falso `unhealthy` do backend (wget/Alpine resolve `localhost` para IPv6 `::1`; servidor escuta só IPv4).
- Imagens do cardápio em produção (volume antigo estava vazio; agora bind mount com 44 arquivos).

### Removido
- Stack antiga `loop-food-temp` (containers e volumes órfãos `loop-food-dev_*`, `loop-food-temp_backend_uploads`).

## [2.1.1] — 02/08/2026 — Correção de imagens do cardápio

### Corrigido
- BUG-011: imagens do cardápio com 404 → fallback Unsplash. 44 produtos com `imagem_url` no formato antigo `/uploads/cardapio/...` (sem tenantId) e arquivos fora da estrutura multi-tenant. Novo script `backend/src/corrigir-imagens-cardapio.js` (idempotente, com `--dry-run` e `--tenant=`): move arquivos para `uploads/{tenantId}/cardapio/` e atualiza o banco. 44/44 migrados, validado por HTTP (200).
- Limpeza: 37 arquivos órfãos removidos de `backend/uploads/cardapio/` (verificado no banco: 0 referências em produtos/banners).

### Adicionado
- `backend/src/corrigir-imagens-cardapio.js` — utilitário de correção de imagens (formato multi-tenant).

## [2.1.0] — 02/08/2026 — Migração Asaas → API da Rede (concluída)

### Adicionado
- `backend/src/services/rede.js` — cliente da e-Rede v2: OAuth2 (cache 20min, renovação antecipada), cartão (crédito/débito, 3DS), PIX com QR dinâmico, consulta, estorno, validação de webhook, retry/backoff, conversão centavos.
- `backend/src/modules/pagamentos/redeWebhookHandler.js` — eventos `PV.UPDATE_TRANSACTION_PIX` (ativa pedido) e `PV.REFUND_PIX` (marca devolução).
- `backend/src/services/pollingRede.js` — polling de backup 15s (Approved/Denied/3036; desistência por idade só para PIX).
- `backend/src/e2e-rede-test.js` — teste das jornadas (login apelido/password).
- `backend/src/limpar-dados-teste.js` — limpeza de dados de teste preservando cardápio.
- Migrations **025** (campos `rede_*`), **026** (tabela pagamentos p/ Rede), **027** (drop colunas `asaas_*`).
- Opção **`debito_online`** no checkout (cliente) e em `formas_pagamento` (god).
- Bloco **TLS 1.2+** (comentado) nos nginx de cliente/restaurante/entregador/router.
- Estrutura **`/spec`** (spec-driven): vision, requirements, architecture, decisions, progress, backlog, technical-debt, changelog.

### Alterado
- `backend/src/modules/pagamentos/index.js` — rotas para Rede (`/criar` com PIX/cartão/débito+3DS, `/webhook` com dedup `rede:{tid}:{event}`, `/3ds/sucesso`+`/3ds/erro`, `/pix-qrcode`, `/verificar-status`, `/refund-status`, `/reembolsar`); removidos `/tokenizar-cartao` e `/webhook-health`.
- `cliente/src/components/CheckoutPanel.vue` — checkout transparente (dados brutos), 3DS redirect, CPF obrigatório nos métodos online, `DEBIT_CARD`.
- `cliente/src/views/TrackingView.vue` — timer PIX 15min, `debito_online` no badge de estorno.
- `restaurante/src/views/OrdersView.vue` — removidos botões/funções manuais de verificação/confirmação de pagamento.
- `god/server.js` + `god/index.html` — credenciais Rede por tenant, tab de transações (NSU/cód/end-to-end).
- `backend/src/services/rede.js` — MELHORIA-005: 5xx/429 do OAuth viram `GATEWAY_UNAVAILABLE`; `REDE_AUTH_ERROR` com token em cache renova 1x.
- `backend/src/modules/pagamentos/index.js` — dedup secundário `rede:{tid}:{event}` (INSERT multi-row).
- `auth/index.js` — login por apelido/telefone (migrations 022/023/024).
- `seed.js`/`seed-tenant2.js` — usuários padrão por apelido.
- `docker-compose.yml`/`stack.env` — removidas variáveis `ASAAS_*`.
- `project-manager/*` — limpos, somente pendências ativas.

### Corrigido
- BUG-001: checkout de cartão online quebrado (frontend × backend incompatíveis).
- BUG-002/003/004: retry de rede, JSON.parse crash, código de erro 503 enganoso.
- BUG-005: CHECK de `metodo_pagamento` sem `salao`/`conta`.
- BUG-006: pedido órfão em falha de gateway.
- BUG-007: cartão Denied pós-3DS deixava pedido preso (prevenido).
- BUG-008: guard de CPF não cobria PIX no runtime.
- BUG-009: payload de login no e2e (`login`/`senha` → `apelido`/`password`).
- Branch de retry 5xx/429 da MELHORIA-005 que estava fora do `withRetry` (code review).

### Removido
- Asaas: `services/asaas.js`, `modules/pagamentos/webhookHandler.js`, `check-webhook.js`, `diagnostico-asaas.js`, `e2e-asaas-test.js`, `test-pix.js`, `test-phone.js`, `testar-refund-*.js` (3), `simular-pagamento.js`.
- Bloco `asaas` do `config/index.js`; `asaas_api_key`/`asaas_env` do `tenantResolver.js`; estorno automático de `pedidos/index.js`; `rawBody` do `index.js`.
- Colunas `asaas_*` do banco (migration 027); variáveis `ASAAS_*` de env/compose/stack.
- Menções a Asaas em todo o código (grep zerado).

### Refatorado
- Migração completa do módulo de pagamentos para a API da Rede (e-Rede v2 OAuth2).
- Valores monetários centralizados em centavos na camada de integração.
- Seeds padronizados por apelido em todos os módulos.
