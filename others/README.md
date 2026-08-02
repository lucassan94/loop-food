# 🍔 SaborExpress V2 / LoopFood

Plataforma completa de delivery multi-tenant com 3 módulos integrados (cliente, restaurante/PDV, entregador) + backend Express + painel god de gestão de tenants.

## 🗂️ Estrutura do projeto (reorganizada)

```
Delivery V3/
├── app/                 ← CÓDIGO DA APLICAÇÃO — é isto que vai para a VPS
│   ├── backend/         ← API Express (porta 3001 / 8090 no servidor)
│   ├── cliente/         ← Cardápio digital (Vue 3 SPA)
│   ├── restaurante/     ← Painel admin/PDV (Vue 3 SPA)
│   ├── entregador/      ← App do entregador (Vue 3 SPA)
│   ├── router/          ← Nginx que unifica os 3 SPAs + proxy da API
│   └── docker-compose.yml
├── migrations/          ← SQL de schema (fora de app/; sincronizadas no `deploy.py migrate`)
├── others/              ← Ferramentas locais (não vão para a VPS)
│   ├── deploy.py        ← Deploy via SSH (paramiko/SFTP)
│   ├── deploy_config.json  ← Credenciais da VPS (gitignored)
│   ├── god/             ← Painel admin multi-tenant (local, porta 3002)
│   ├── run.bat          ← Inicia os dev servers
│   ├── README.md
│   └── stack.env
├── spec/                ← Documentação spec-driven (vision, requirements, decisions, ...)
├── project-manager/     ← Registros do projeto (pendências, bugs, melhorias)
└── trash/               ← Arquivos descartados (migrations antigas, docs obsoletas, ...)
```

> A pasta `app/` é o único código que a VPS precisa. Tudo o mais (ferramentas, docs, migrations) fica fora dela.

## 🚀 Deploy via SSH (sem GitHub)

> O deploy **não depende de git**. Os arquivos de `app/` sobem direto para a VPS via SFTP e os containers são geridos com docker-compose no servidor.

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
python deploy.py upload   # envia/atualiza os arquivos de app/ (SEM uploads)
python deploy.py images   # sincroniza SOMENTE app/backend/uploads (cardápio/banners)
python deploy.py env      # cria o .env de produção (só na 1ª vez)
python deploy.py migrate  # sincroniza migrations/ e roda no container backend
python deploy.py up       # docker-compose up -d --build (com rebuild)
python deploy.py deploy   # upload + env + up (fluxo completo)
python deploy.py logs backend   # logs de um serviço
python deploy.py ps       # status dos containers
```

> ⚠️ **Uploads:** `app/backend/uploads` **não** sobe no `deploy` automático (o diretório pertence ao servidor — evita sobrescrever banners/fotos enviados pelo painel). Para sincronizar imagens do cardápio local: `python deploy.py images`.
>
> ⚠️ **Migrations:** ficam em `migrations/` (fora de `app/`). O comando `migrate` sincroniza a pasta e roda dentro do container (montada em `/app/migrations`).

> 💡 **Fluxo do dia a dia:** alterou um arquivo em `app/`? Rode `python deploy.py deploy`.

### Notas de produção

- Stack: `restaurante-v3` — backend (8090), cliente (8091), router (8094). Restaurante/entregador são servidos pelo router (`/admin`, `/entregador`).
- Uploads ficam em **bind mount** `./backend/uploads` (as imagens do cardápio viajam junto no deploy).
- Banco: `grupopadrao-postgres` (86.48.18.22:5432/delivery). Migrations: `python deploy.py migrate`.
- Servidor usa `docker-compose` **v1** (o plugin `docker compose` não está instalado) — o `deploy.py` detecta automaticamente.

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

## 🔐 Credenciais Padrão (Seed)

> **Importante:** o login NÃO é por e-mail. Cada módulo usa identificador próprio.

| Módulo | Como acessar | Login | Senha |
|--------|-------------|-------|-------|
| Restaurante (Admin) | Painel `/admin` | usuário: `admin` | admin123 |
| Cliente | Cardápio | usuário: `cliente` (ou telefone `(11) 99999-8888`) | cliente123 |
| Entregador | App do entregador | usuário: `entregador` (ou telefone `(11) 98888-7777`) | entregador123 |

- **Todos os módulos aceitam login por usuário (apelido) OU telefone.**
- **Tenant 2 (SaborExpress):** `admin` / `admin123` · `cliente` / `cliente123` · `entregador` / `entregador123`
- Novos usuários de equipe criados no painel usam **apelido** (username) como login, com senha padrão `senha123`
- Novo tenant criado no painel **god** (LoopFood Admin, porta `3002`): `admin` / `admin123`
- E-mails continuam sendo coletados, mas apenas como dado complementar

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
