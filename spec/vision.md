# Vision — SaborExpress V2 / LoopFood

> Mantido conforme skill spec-driven. Atualizar **somente** em mudança estratégica. Sem detalhes técnicos.

## Objetivo do produto

Plataforma **multi-tenant de delivery e restaurante completo**, na qual cada restaurante (tenant) opera uma instância própria com cardápio digital, pedidos online, pagamento online, entregadores, PDV de salão, mesas e painel administrativo — tudo gerenciado por uma única plataforma (LoopFood) através do módulo **god**.

## Público-alvo

- **Restaurantes** (donos/operadores) que usam o painel administrativo (módulo restaurante) para gerir pedidos, cardápio, entregadores, mesas e relatórios.
- **Clientes finais** que acessam o cardápio digital (módulo cliente) para pedir com entrega ou salão.
- **Entregadores** que usam o app de delivery (módulo entregador) para receber e concluir entregas.
- **Administradores da plataforma** que usam o painel god para criar e configurar tenants (restaurantes), incluindo credenciais de pagamento.

## Escopo

- Cardápio digital com categorias, produtos, extras e imagens.
- Carrinho e checkout com **pagamento na entrega (COD)** e **pagamento online** (PIX e cartão de crédito/débito via API da Rede e-Rede).
- Rastreamento de pedido em tempo real (WebSocket) com timeline de status.
- Painel admin: pedidos (fila/PDV/KDS), produtos, clientes, entregadores, mesas, relatórios, configurações, formas de pagamento, banners.
- App do entregador com rotas/entregas e status.
- Multi-tenant: cada restaurante com seu domínio/subdomínio, cardápio, equipe e credenciais de pagamento próprias.
- Módulo god (LoopFood Admin): gestão central de tenants e credenciais de integração.

## Módulos

| Módulo | Tipo | Acesso |
|---|---|---|
| Cliente (cardápio) | Vue 3 SPA | `{slug}.loopautomacoes.com.br` (rota `/`) |
| Restaurante (admin) | Vue 3 SPA | rota `/admin` |
| Entregador (app) | Vue 3 SPA | rota `/entregador` |
| Backend | Node/Express API | `api` / porta 3001 |
| God (LoopFood Admin) | Node/Express + HTML | porta 3002 |
| Router | Nginx | porta 8094 (unifica subdomínios por path) |

## Restrições de negócio

- **Login por apelido (username) ou telefone** — não por e-mail. E-mail é dado complementar.
- Pagamento online **somente em delivery**; salão/PDV usa pagamento na conta (COD).
- **Parcelamento: somente à vista (1x)** no pagamento online.
- **Cartão de débito online exige 3-D Secure** (obrigatório por regra da Rede).
- **Soft descriptor** na fatura = nome do restaurante (máx. 18 caracteres).
- **Reembolso é manual** (ação do admin) — cancelamento de pedido pago não estorna automaticamente.
- **Expiração do PIX: 15 minutos**.
- Gateway de pagamento único: **API da Rede (e-Rede v2)**. Asaas foi removido e não voltará.

## Fora do escopo

- Pagamentos com outros gateways (Stripe, Mercado Pago, etc.).
- Parcelamento no checkout online (somente à vista).
- Logística/roteirização avançada de entregas (mapa, otimização de rotas).
- App nativo iOS/Android (PWA via service worker).
- Marketplace com múltiplos restaurantes na mesma sessão de compra (cada tenant é independente).
