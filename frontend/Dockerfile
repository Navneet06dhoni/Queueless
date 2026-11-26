# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY packages/contracts/package*.json ./packages/contracts/
COPY packages/common/package*.json ./packages/common/
COPY packages/messaging/package*.json ./packages/messaging/
COPY services/notification-service/package*.json ./services/notification-service/
COPY services/queue-service/package*.json ./services/queue-service/

RUN npm ci

COPY frontend ./frontend

RUN npm --prefix frontend run build

# Stage 2: Production Nginx Server
FROM nginx:1.26-alpine AS runner

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=5s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:80/healthz | grep ok || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
