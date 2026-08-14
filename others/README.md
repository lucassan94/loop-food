# 🍔 SaborExpress V2 / LoopFood

Plataforma completa de delivery multi-tenant com 3 módulos integrados (cliente, restaurante/PDV, entregador) + backend Express + painel god de gestão de tenants.

## 🗂️ Estrutura do projeto (reorganizada)

```
Delivery V3/
├── docker-compose.yml   ← DEPLOY: stack canônica (raiz do repo, usada pelo Portainer)
├── stack.env            ← DEPLOY: segredos commitados (JWT_SECRET, VAPID push)
├── app/                 ← CÓDIGO DA APLICAÇÃO (contextos de build ./app/*)
│   ├── backend/         ← API Express (porta 3001 / 8090 no servidor)
│   ├── cliente/         ← Cardápio digital (Vue 3 SPA)
│   ├── restaurante/     ← Painel admin/PDV (Vue 3 SPA)
│   ├── entregador/      ← App do entregador (Vue 3 SPA)
│   ├── router/          ← Nginx que unifica os 3 SPAs + proxy da API
├── migrations/          ← SQL de schema (commitadas; montadas em /app/migrations no container)
├── others/              ← Ferramentas locais (não vão para a VPS)
│   ├── deploy.py        ← Deploy via SSH (fallback; paramiko/SFTP)
│   ├── deploy_config.json  ← Credenciais da VPS (gitignored)
│   ├── god/             ← Painel admin multi-tenant (local, porta 3002)
│   ├── run.bat          ← Inicia os dev servers
│   └── README.md
├── spec/                ← Documentação spec-driven (vision, requirements, decisions, ...)
├── project-manager/     ← Registros do projeto (pendências, bugs, melhorias)
└── trash/               ← Arquivos descartados (migrations antigas, docs obsoletas, ...)
```

> O deploy usa `docker-compose.yml` + `stack.env` da **raiz** do repo (via Portainer). A pasta `app/` é o código da aplicação (contextos de build).

## 🚀 Deploy via GitHub → Portainer (fluxo OFICIAL)

> O deploy oficial é via **GitHub → Portainer**: a stack `restaurante-v3` no Portainer puxa o repositório, builda os Dockerfiles e sobe os containers. Os arquivos de deploy ficam na **raiz do repo**: `docker-compose.yml` + `stack.env`.

### Como funciona

1. Altere o código e faça `git push` para `main` (`github.com/lucassan94/loop-food`).
2. No Portainer (http://86.48.18.22:9000), na stack `restaurante-v3`: clique em **Pull & redeploy** (ou use o webhook).
3. O Portainer clona o repo, builda os 4 serviços (`backend`, `cliente`, `router`) e sobe.

**Estrutura de deploy (raiz do repo):**

| Arquivo | Papel |
|---------|-------|
| `docker-compose.yml` | Stack completa (contextos `./app/*`, volume nomeado de uploads, migrations montadas) |
| `stack.env` | Segredos commitados (JWT_SECRET, VAPID push) — usados via `env_file` |
| `migrations/` | SQL de schema, montado em `/app/migrations` no container |

**Contextos de build** (docker-compose.yml na raiz):

- `backend` → `./app/backend` (porta 8090)
- `cliente` → `./app/cliente` (porta 8091)
- `router` → `./app` + `router/Dockerfile` (porta 8094) — builda os 3 SPAs em um nginx só

> 💡 **Imagens NO BANCO (migration 028)**: as imagens (cardápio, banners, entregadores, categorias, logos) vivem na tabela `imagens` (BYTEA) do Postgres — **não há mais volume de uploads**. URLs públicas `/uploads/{tenantId}/{tipo}/{filename}` continuam iguais (servidas pelo backend a partir do banco, com `Cache-Control`). Backup do banco = backup das imagens. O `UPLOAD_DIR` em disco fica apenas como fallback de transição.

> ✅ **Imagens migradas:** a importação dos arquivos antigos (disco + base64 em colunas) para a tabela `imagens` já foi executada (migration 028).

> ⚠️ **Migrations:** rodar dentro do container: `docker compose exec backend node src/migrate.js` (as migrations são commitadas e montadas em `/app/migrations`).

## 🔧 Deploy via SSH (fallback, NÃO usar no dia a dia)

> Script legado mantido como fallback (SFTP). Replica a MESMA estrutura do clone GitHub em `/opt/restaurante-v3`: `app/` → `{dir}/app`, compose e stack.env da raiz, `migrations/` → `{dir}/migrations`.

### Pré-requisitos

- Python 3 + `pip install paramiko`
- Arquivo `others/deploy_config.json` (gitignored):
  ```json
  { "host": "86.48.18.22", "user": "root", "password": "sua_senha", "dir": "/opt/restaurante-v3" }
  ```

### Comandos (rodar da pasta `others/`)

```bash
cd others
python deploy.py check    # inspeciona o servidor (read-only)
python deploy.py upload   # envia/atualiza app/ → {dir}/app + compose/stack.env
python deploy.py images   # sincroniza SOMENTE app/backend/uploads (cardápio/banners)
python deploy.py env      # cria o .env de produção (só na 1ª vez)
python deploy.py migrate  # sincroniza migrations/ e roda no container backend
python deploy.py up       # docker-compose up -d --build (com rebuild)
python deploy.py deploy   # upload + env + up (fluxo completo)
python deploy.py logs backend   # logs de um serviço
python deploy.py ps       # status dos containers
```

> ⚠️ **Uploads:** as imagens agora vivem no **banco** (migration 028). O comando `python deploy.py images` (sincroniza `app/backend/uploads`) está **obsoleto** — mantenha apenas para ambientes legados; o fluxo normal usa a tabela `imagens`.

> ⚠️ **Layout do servidor:** o fallback agora sincroniza `app/` → `{dir}/app` (aninhado, igual ao clone GitHub). Se o servidor ainda tiver as pastas **planas** antigas (`{dir}/backend`, `{dir}/cliente`, ...) de deploys anteriores, elas ficam órfãs após o switch — remova manualmente para liberar disco:
> ```bash
> ssh root@86.48.18.22 'ls /opt/restaurante-v3'  # confira e remova: backend/ cliente/ entregador/ restaurante/ router/ antigos
> ```

### Notas de produção

- Stack: `restaurante-v3` — backend (8090), cliente (8091), router (8094). Restaurante/entregador são servidos pelo router (`/admin`, `/entregador`).
- Banco: `grupopadrao-postgres` (86.48.18.22:5432/delivery). Migrations: `python deploy.py migrate`.

## 🔧 Desenvolvimento Local

### Terminal 1: Backend
```bash
cd app/backend
npm install
npm run migrate   # ou: MIGRATIONS_DIR=../../migrations npm run migrate
npm run seed
npm run dev
```

### Terminal 2: Cliente
```bash
cd app/cliente
npm install
npm run dev
```

### Terminal 3: Restaurante (Admin)
```bash
cd app/restaurante
npm install
npm run dev
```

### Terminal 4: Entregador
```bash
cd app/entregador
npm install
npm run dev
```

> 💡 Use `others/run.bat` para iniciar todos os dev servers de uma vez (backend, cliente, entregador, restaurante, god).

> 🏪 **Acessando outro tenant localmente (multi-tenant):** o backend local usa `RESTAURANT_ID` do `.env` (default `1`).
> Para testar outro restaurante sem mudar o `.env`, adicione `?slug=<slug>` na URL do módulo — o frontend envia
> o header `X-Tenant-Slug` e o backend resolve o tenant correto para o login e todas as chamadas. Ex.: o tenant
> **Loop** (slug `loop`) fica em `http://localhost:5174/admin/?slug=loop` (restaurante), e os demais módulos usam o mesmo recurso.

## 🔐 Credenciais Padrão (Seed)

> **Importante:** o login NÃO é por e-mail. Cada módulo usa identificador próprio.

| Módulo | Como acessar | Login | Senha |
|--------|-------------|-------|-------|
| Restaurante (Admin) | Painel `/admin` | usuário: `admin` | admin123 |
| Cliente | Cardápio | usuário: `cliente` (ou telefone `(11) 99999-8888`) | cliente123 |
| Entregador | App do entregador | usuário: `entregador` (ou telefone `(11) 98888-7777`) | entregador123 |

- **Todos os módulos aceitam login por usuário (apelido) OU telefone.**
- **Tenant 2 (SaborExpress):** `admin` / `admin123` · `cliente` / `cliente123` · `entregador` / `entregador123`
- **Tenant 3 (Loop) — restaurante PADRÃO PARA TESTES LOCAIS (ADR-008):** `admin` / `admin123` · `cliente` / `cliente123` · `joao` / `cliente123` · `ana` / `cliente123` · `entregador` / `entregador123`
- Novos usuários de equipe criados no painel usam **apelido** (username) como login, com senha padrão `senha123`
- Novo tenant criado no painel **god** (LoopFood Admin, porta `3002`): `admin` / `admin123`
- E-mails continuam sendo coletados, mas apenas como dado complementar

> 🧪 **Seed (ADR-008):** `npm run seed` (em `app/backend`) popula o tenant do `RESTAURANT_ID` (local = Loop) com cardápio,
> clientes, entregador, raios, mesas, banners e **11 pedidos de exemplo** (delivery + salão + retirada). O seed é
> **idempotente** — pode rodar quantas vezes quiser sem duplicar. Para testar outro tenant sem mudar o `.env`,
> use `?slug=<slug>` (ex.: `http://localhost:5174/admin/?slug=kardapio`).

## 🏪 Multi-tenant

O `RESTAURANT_ID` no `.env` define qual restaurante esta instância atende.
Para adicionar outro restaurante:
1. Criar registro na tabela `restaurantes`
2. Copiar o projeto
3. Alterar `RESTAURANT_ID` no `.env`
4. Fazer deploy como nova instância

## 🐘 Banco de Dados

Host: `86.48.18.22:5432`
Database: `delivery`
Gerenciador: pgAdmin
