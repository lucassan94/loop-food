# Suítes de teste — tenant LOOP

> As suítes funcionais são executadas contra o **Loop** (tenant 3, slug `loop`) — o restaurante
> padrão para testes locais (ADR-008). Todo request envia `X-Tenant-Slug: loop` (ou usa
> `?slug=loop` na URL), então funcionam mesmo com o backend local ainda com `RESTAURANT_ID=1`.

## Pré-requisitos

- Backend local rodando: `cd app/backend && npm run dev` (porta 3001).
- (UI) Dev servers vite: `cd app/cliente && npm run dev` (5173) · `app/restaurante` (5174) · `app/entregador` (5175).
- (UI) Chrome instalado (o smoke usa `puppeteer-core` + o Chrome do sistema).

## API (20 testes)

```bash
python tests/api_tests_loop.py
# opcional:
API_BASE=http://localhost:3001/api TENANT_SLUG=loop python tests/api_tests_loop.py
```

Cobre health, cardápio, CEP, frete (dentro/fora do raio), login admin (certo/errado), criação de
pedido (fora do raio, frete adulterado, COD válido), listagem, pagamento sem CPF, perfil, 401/404/CORS.

## UI smoke (12 testes: RS-01..04, CL-01..05, EN-01..03)

```bash
cd tests/ui_smoke
npm install          # 1ª vez (puppeteer-core)
node smoke.js
```

Cobre os fluxos principais dos 3 módulos contra o Loop:

| ID | Fluxo |
|----|-------|
| RS-01..04 | Login admin (`admin`/`admin123`) + painel + fila mostra pedidos do Loop + menu |
| CL-01..05 | Cardápio carrega (X-Burguer) + add ao carrinho + toast + login por telefone (`11999998888`/`cliente123`) + header mostra Maria |
| EN-01..03 | Login entregador (`entregador`/`entregador123`) + fila de entregas + pedidos pronto_entrega |

Screenshots vão para `tests/ui_smoke/shots/`.

## ⚠️ Limpeza pós-execução

A suíte API cria artefatos no banco (cliente de teste `@loop.test`, pedidos `Teste API`) e o
`PUT /clientes/perfil` altera o perfil do usuário logado. Para voltar o Loop ao estado do seed,
rode a limpeza documentada em `project-manager/04. tests.md` (bloco "Limpeza dos dados de teste").
