# =============================================================================
# ROUTER — Multi-stage build que combina os 3 SPAs em 1 container nginx
# =============================================================================
# Acesso por path:
#   {slug}.loopautomacoes.com.br/           → Cliente (cardápio)
#   {slug}.loopautomacoes.com.br/admin      → Restaurante (painel admin)
#   {slug}.loopautomacoes.com.br/entregador → Entregador (app delivery)
# =============================================================================

# ─── BUILD: CLIENTE ──────────────────────────────────────────────────────────
FROM node:22-alpine AS build-cliente
WORKDIR /app
COPY cliente/package*.json ./
RUN npm ci
COPY cliente/ ./
RUN npm run build

# ─── BUILD: RESTAURANTE ──────────────────────────────────────────────────────
FROM node:22-alpine AS build-restaurante
WORKDIR /app
COPY restaurante/package*.json ./
RUN npm ci
COPY restaurante/ ./
RUN npm run build

# ─── BUILD: ENTREGADOR ───────────────────────────────────────────────────────
FROM node:22-alpine AS build-entregador
WORKDIR /app
COPY entregador/package*.json ./
RUN npm ci
COPY entregador/ ./
RUN npm run build

# ─── PRODUCTION NGINX ────────────────────────────────────────────────────────
FROM nginx:alpine

# Cliente → raiz (/)
COPY --from=build-cliente /app/dist /usr/share/nginx/html

# Restaurante → /admin/
COPY --from=build-restaurante /app/dist /usr/share/nginx/html/admin

# Entregador → /entregador/
COPY --from=build-entregador /app/dist /usr/share/nginx/html/entregador

# Nginx config unificada
COPY router/nginx.conf /etc/nginx/nginx.conf

RUN chmod -R 755 /usr/share/nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
