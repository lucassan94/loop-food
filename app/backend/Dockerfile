FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:22-alpine
WORKDIR /app

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# ── GATE DE REGRESSÃO: teste de fuso horário (antes de cada deploy) ──
# O Portainer reconstrói a imagem a cada Pull & redeploy. Se este teste
# falhar, o build falha e a stack NÃO sobe — impede regressões no cálculo
# de horários de funcionamento (bug de fuso que bloqueava pedidos à noite).
RUN node src/test-horarios.js

# Create uploads directory
RUN mkdir -p /app/uploads && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/api/health || exit 1

CMD ["node", "src/index.js"]
