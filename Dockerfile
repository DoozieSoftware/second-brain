FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY src/ ./src/
COPY public/ ./public/
COPY tsconfig.json ./

RUN mkdir -p data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=300s \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node_modules/.bin/tsx", "src/api.ts"]
