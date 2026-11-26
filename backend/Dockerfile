# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY packages/contracts/package*.json ./packages/contracts/
COPY packages/common/package*.json ./packages/common/
COPY packages/messaging/package*.json ./packages/messaging/
COPY services/notification-service/package*.json ./services/notification-service/
COPY services/queue-service/package*.json ./services/queue-service/

# Install dependencies across workspaces for building
RUN npm ci

# Copy sources for packages and backend
COPY packages/contracts ./packages/contracts
COPY packages/common ./packages/common
COPY packages/messaging ./packages/messaging
COPY backend ./backend

# Build packages and backend
RUN npm --prefix packages/contracts run build && \
    npm --prefix packages/common run build && \
    npm --prefix packages/messaging run build && \
    npm --prefix backend run build

# Stage 2: Production Dependencies
FROM node:22-alpine AS prod-deps

WORKDIR /app

COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY packages/contracts/package*.json ./packages/contracts/
COPY packages/common/package*.json ./packages/common/
COPY packages/messaging/package*.json ./packages/messaging/
COPY services/notification-service/package*.json ./services/notification-service/
COPY services/queue-service/package*.json ./services/queue-service/

# Install ONLY production dependencies for backend workspace
RUN npm ci --omit=dev --workspace=backend --include-workspace-root --ignore-scripts

# Stage 3: Production Runner
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NODE_PATH=/app/node_modules

# Security: run as non-root user
USER node

# Copy production node_modules and built artifacts
COPY --chown=node:node --from=prod-deps /app/package*.json ./
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --chown=node:node --from=builder /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --chown=node:node --from=builder /app/packages/common/dist ./packages/common/dist
COPY --chown=node:node --from=builder /app/packages/common/package.json ./packages/common/package.json
COPY --chown=node:node --from=builder /app/packages/messaging/dist ./packages/messaging/dist
COPY --chown=node:node --from=builder /app/packages/messaging/package.json ./packages/messaging/package.json

COPY --chown=node:node --from=builder /app/backend/package.json ./backend/
COPY --chown=node:node --from=builder /app/backend/dist ./backend/dist
COPY --chown=node:node --from=builder /app/backend/src/db/migrations ./backend/dist/db/migrations
COPY --chown=node:node --from=builder /app/backend/src/db/migrations ./backend/src/db/migrations

WORKDIR /app/backend

HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5000/api/health/live || exit 1

EXPOSE 5000

CMD ["node", "dist/server.js"]
