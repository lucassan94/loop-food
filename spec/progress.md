# Progress — SaborExpress V2 / LoopFood

> Memória operacional do projeto. Atualizar após toda execução.

## Última atividade

**02/08/2026 (7)** — **Deploy incremental no `deploy.py`** — sincronização por **manifesto SHA-256** (`.deploy_manifest.json` gravado no servidor): na 1ª subida envia tudo e grava o manifesto; nas seguintes, só arquivos cujo hash mudou (ou faltam) são copiados. Flags `--force` (reenvia tudo) e `--dry-run` (prévia sem enviar) em `upload`/`images`; `.vite` (cache do dev server) excluído do envio. **Testado na VPS real**: 1º `upload` = 124 enviados (manifesto criado), 2º = 0/124 inalterados; `images` = 45 enviadas → 0/45; manifesto final com **169 entradas (124 código + 45 imagens)** coexistindo — `upload` e `images` compartilham o mesmo manifesto e o merge preserva a outra raiz. Code review: corrigido `--force` apagar entradas da outra raiz; escrita do manifesto em bytes UTF-8 explícito.

**02/08/2026 (6)** — **Checkout: endereço salvo no perfil ao clicar "Continuar"** (cliente) — nova função `salvarPerfilNoCheckout(cpfCnpj)` chamada em `goToStep3` (fire-and-forget, não bloqueia) e reutilizada nos dois pontos de `confirmOrder` (eliminada a duplicação de payload). **Fonte do painel corrigida** (BUG-012): reset global `button, input, select, textarea { font-family: inherit; }` no `main.css` do restaurante — form controls (selects/abas/botões) agora usam Inter em vez de Arial. Builds de cliente e restaurante OK.

**02/08/2026 (5)** — **Reorganização da estrutura de pastas**: raiz agora tem `app/`, `spec/`, `project-manager/`, `others/`, `migrations/` e `trash/`. `app/` = código que vai para a VPS (backend, cliente, restaurante, entregador, router, docker-compose.yml). Migrations movidas para `migrations/` (raiz; 006/011/023 → trash por serem Asaas/one-off). Ferramentas locais (deploy.py, god, README, run.bat, stack.env) em `others/`. deploy.py atualizado para subir `app/`; migrate.js com `MIGRATIONS_DIR`; docker-compose com mount de migrations. ⏳ Faltou mover `src/`, `public/`, `.vite/` de cliente/entregador/restaurante (dev servers ativos bloqueavam) — pendência #9.

**02/08/2026 (4)** — **Certificado wildcard `*.loopautomacoes.com.br` emitido** (Let's Encrypt DNS-01 manual, TXT na Umbler) — resolveu a página em branco dos subdomínios de tenant (`palazzomooca`, `saborexpress`) causada por `ERR_CERT_COMMON_NAME_INVALID` (cert anterior só cobria o domínio raiz; CSP força HTTPS). **502 transitório** durante reload do NPM (forward_scheme=https momentâneo contra router HTTP) — normalizado sozinho. Validade: 31/10/2026. Pendência #8 criada para renovação (NPM renova por http-01, que não cobre wildcard).

**02/08/2026 (3)** — **Deploy via SSH na VPS** (novo fluxo sem GitHub): criado `deploy.py` (paramiko/SFTP, comandos `check`/`upload`/`env`/`up`/`deploy`/`logs`/`ps`), upload de 226 arquivos para `/opt/restaurante-v3`, `.env` de produção criado, stack antiga `loop-food-temp` substituída pela `restaurante-v3` (backend 8090, cliente 8091, router 8094 — todos **healthy**), healthcheck corrigido para IPv4 (127.0.0.1), uploads em bind mount (`./backend/uploads`), 44 imagens do cardápio servidas com 200 em produção, volumes órfãos removidos.

**02/08/2026 (2)** — Bug das imagens do cardápio corrigido (BUG-011): 44 produtos com `imagem_url` no formato antigo (sem tenantId) foram migrados via novo script `corrigir-imagens-cardapio.js` para `/uploads/1/cardapio/...`, com arquivos movidos em disco e validação HTTP (200). Registros atualizados no project-manager e spec.

**02/08/2026 (1)** — Migração Asaas → API da Rede **concluída e implantada no banco** (Fases 0–12 + melhorias MELHORIA-001/004/005 aplicadas). Limpeza de dados + seeds executados. Registros do project-manager limpos (somente pendências ativas). Estrutura `/spec` da skill spec-driven criada.

## O que foi concluído

- **Migração de gateway completa**: serviço `rede.js` (OAuth2/cartão/PIX/consulta/estorno/3DS/webhook), módulo `pagamentos` reescrito, `redeWebhookHandler.js`, `pollingRede.js` (15s), `e2e-rede-test.js`.
- **Remoção total do Asaas**: 11+ arquivos deletados, config/env/compose/stack limpos, colunas `asaas_*` dropadas (migration 027), zero menções no código.
- **Migrations aplicadas no banco**: 022/023/024 (login por apelido/telefone), 025 (campos `rede_*`), 026 (tabela pagamentos p/ Rede), 027 (drop asaas_*).
- **Limpeza de dados + seeds**: tenants 1 e 2 com `admin`/`admin123`, `cliente`/`cliente123`, `entregador`/`entregador123`; cardápio preservado.
- **Frontends**: cliente com `debito_online`, 3DS redirect, timer PIX 15min; restaurante sem ações manuais de pagamento.
- **God**: formulário de credenciais Rede (PV, Chave de Integração, webhook token, ambiente), tab de transações com NSU/cód/end-to-end.
- **Melhorias**: MELHORIA-005 (token resiliente), MELHORIA-004 (dedup secundário), MELHORIA-001 (bloco TLS 1.2+ nos nginx — pendente habilitar).
- **Estrutura /spec** criada (vision, requirements, architecture, decisions, progress, backlog, technical-debt, changelog).
- **Deploy via SSH sem GitHub**: `deploy.py` + `docker-compose` no servidor; stack `restaurante-v3` no ar (backend/cliente/router healthy); healthcheck IPv4; uploads bind-mounted; imagens do cardápio funcionando em produção.
- **Estrutura reorganizada**: `app/` (código → VPS), `migrations/` (fora de app), `others/` (ferramentas locais), `trash/` (lixo), `spec/` e `project-manager/` na raiz.
- **Deploy incremental**: manifesto SHA-256 no servidor; `upload`/`images` enviam só o que mudou; `--force`/`--dry-run`; testado na VPS real (124 → 0/124; images 45 → 0/45).

## Em andamento

- Nada em implementação no momento.

## Pendências

1. **Credenciais reais do sandbox da Rede** (PV + Chave de Integração) — ⛔ bloqueado: usuário ainda não tem acesso ao portal developer.userede.com.br.
2. **Cadastro da URL de notificação PIX** via call center da Rede (4001 4433 / 0800 728 4433) — ~2 dias úteis.
3. ~~Restart do backend + rebuild dos frontends~~ — ✅ **concluído no deploy via SSH** (stack restaurante-v3 no ar).
4. **Habilitar TLS 1.2+** (bloco pronto nos nginx; falta montar certificados no docker-compose e TLS no proxy externo).
5. **Tenant 3 (Loop) sem usuários** (BUG-010) — criar admin no god se o tenant estiver em uso.

6. **Renovação do certificado wildcard** (expira 31/10/2026) — NPM renova por http-01 (não cobre wildcard); renovar manualmente via DNS-01 (mesmo procedimento) ou configurar plugin DNS. Se expirar, a página em branco volta.

## Bloqueadores

- Acesso do usuário ao **Portal do Desenvolvedor Rede** (credenciais de sandbox) — impede homologação real (e2e no sandbox, validação de webhook/3DS/PIX).

## Próximo passo recomendado

1. Usuário obter acesso ao portal Rede e criar projeto sandbox (PV + Chave de Integração).
2. Preencher credenciais no módulo god (tenant 1/2).
3. Rodar `e2e-rede-test.js` contra o sandbox real e validar as 14 jornadas.
4. Cadastrar URL de webhook no call center e habilitar TLS para go-live.

## Arquivos modificados (última execução)

- `others/deploy.py` (sincronização incremental por hash SHA-256, `--force`/`--dry-run`, `.vite` no EXCLUDE_DIRS), `project-manager/*`, `spec/*` (progress/changelog).

## Cobertura aproximada da especificação

**~80%** — Implementação técnica completa (backend/frontends/god/migrations/seeds). Restante (~20%) depende de **homologação com credenciais reais do sandbox** (jornadas e2e, webhook real, 3DS real, estorno real), cadastro da URL de notificação e habilitar TLS em produção.
