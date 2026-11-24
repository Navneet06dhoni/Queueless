FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace configurations
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/queue-service ./services/queue-service

# Install dependencies and build
RUN npm ci --workspace=packages/contracts --workspace=packages/common --workspace=packages/messaging --workspace=services/queue-service
RUN npm --prefix packages/contracts run build 2>/dev/null || true
RUN npm --prefix packages/common run build 2>/dev/null || true
RUN npm --prefix packages/messaging run build 2>/dev/null || true
RUN npm --prefix services/queue-service run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/queue-service/package.json ./services/queue-service/
COPY --from=builder /app/services/queue-service/dist ./services/queue-service/dist
COPY --from=builder /app/services/queue-service/migrations ./services/queue-service/migrations

RUN npm ci --omit=dev --workspace=packages/contracts --workspace=packages/common --workspace=packages/messaging --workspace=services/queue-service

WORKDIR /app/services/queue-service
EXPOSE 3003

CMD ["node", "dist/server.js"]
