# QueueLess - Smart Appointment Booking & Live Virtual Queue Platform

QueueLess is a modular monolith platform designed for local businesses in India—small clinics, salons, diagnostic centers, and spas—to eliminate physical waiting lines through smart appointment slot booking, real-time virtual queues, owner desk operations, and platform administration.

---

## 🏛️ Architecture Overview

QueueLess is engineered as a clean **Modular Monolith** organized into distinct domain packages, anticipating an eventual microservices split:
- **Loose Coupling via In-Process Event Bus**: Domain modules communicate asynchronously using an event envelope (`{ eventId, type, occurredAt, data }`). State changes publish events (`booking.confirmed`, `queue.advanced`, `business.approved`) that consumers handle without delaying HTTP transactions.
- **Strict Concurrency Protection**: High-contention operations use PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) inside atomic transactions, guaranteeing zero double-bookings under heavy concurrent load.
- **Hybrid Virtual Queue Engine**: Combines scheduled appointments with walk-in arrivals in Redis Sorted Sets (`ZADD`, `ZRANK`, `ZPOPMIN`). Customers checking in for appointments are interleaved fairly ahead of later walk-ins.
- **Resilient Real-Time Sync**: Socket.io backed by Redis pub/sub adapter broadcasts live ticket updates, queue movements, and counter calls with room isolation and sub-100ms latency.
- **In-Memory JWT & Secure Cookies**: 15-minute access tokens stay in memory only (never written to `localStorage`), while 7-day refresh tokens rotate in `httpOnly`, `SameSite=Lax` cookies.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Backend Runtime** | Node.js (LTS), TypeScript, Express 4 |
| **Database & Migrations** | PostgreSQL 16, raw SQL migrations (`pg`), connection pooling |
| **Cache & Real-Time Queue** | Redis 7 (Sorted Sets, Hashes, Pub/Sub), `@socket.io/redis-adapter` |
| **API Documentation** | OpenAPI 3.0 generated from Zod schemas (`@asteasolutions/zod-to-openapi`), Swagger UI |
| **Observability & Logging** | Structured JSON logging with `pino` & `pino-pretty`, UUID request tracking (`X-Request-Id`) |
| **Frontend SPA** | React 18, Vite, TypeScript, Tailwind CSS, React Router v6 |
| **Data Fetching & State** | TanStack React Query v5 (with offline fallback and single-flight 401 token refresh) |
| **Visualization & Timezone** | Recharts (lazy chunk), `date-fns` & `date-fns-tz` pinned to `Asia/Kolkata` (IST) |
| **Testing** | Jest, Supertest (Backend); Vitest, React Testing Library, axe-core (Frontend) |

---

## 📋 Prerequisites

- **Node.js**: v20+ LTS or v22+
- **Docker & Docker Compose**: For PostgreSQL, Redis, and MailHog services
- **Git**

---

## 🚀 Setup in 5 Steps

### Step 1: Clone Repository & Install Dependencies
```bash
git clone https://github.com/navneet06dhoni/QueueLess.git
cd QueueLess

# Install root, backend, and frontend dependencies
npm install
npm --prefix backend install
npm --prefix frontend install
```

### Step 2: Configure Environment Variables
Copy the example environment file:
```bash
cp backend/.env.example backend/.env
```
*(The defaults in `.env.example` work out of the box for local Docker development).*

### Step 3: Start Infrastructure Services
Start PostgreSQL, Redis, and MailHog containers in background:
```bash
docker compose up -d
```
Verify containers are running:
- PostgreSQL on `localhost:5432` (`queueless` / `postgrespassword`)
- Redis on `localhost:6379`
- MailHog Web UI on [http://localhost:8025](http://localhost:8025)

### Step 4: Run Migrations & Seed Data
```bash
# Apply raw SQL migrations up
npm run migrate

# Seed initial test data (Admin, clinic owners, test customers, approved businesses)
npm run seed
```

### Step 5: Start Development Servers
```bash
# Concurrently starts backend on :5000 and frontend on :5173
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## ⚙️ Environment Variables Reference

| Variable Name | Purpose | Default Value | Required |
| :--- | :--- | :--- | :---: |
| `NODE_ENV` | Runtime environment (`development`, `test`, `production`) | `development` | No |
| `PORT` | HTTP server listening port | `5000` | No |
| `API_PREFIX` | Prefix for API routes | `/api` | No |
| `FRONTEND_URL` | Primary frontend URL | `http://localhost:5173` | No |
| `FRONTEND_ORIGIN`| Allowed origin for CORS credentialed requests | `http://localhost:5173` | Yes |
| `DB_HOST` | PostgreSQL host | `localhost` | Yes |
| `DB_PORT` | PostgreSQL port | `5432` | No |
| `DB_USER` | PostgreSQL user | `postgres` | Yes |
| `DB_PASSWORD` | PostgreSQL password | `postgrespassword` | Yes |
| `DB_NAME` | PostgreSQL database name | `queueless` | Yes |
| `TEST_DATABASE_URL` | PostgreSQL connection string for test suite | `postgresql://postgres:postgrespassword@localhost:5432/queueless_test` | Yes |
| `REDIS_HOST` | Redis cache host | `localhost` | Yes |
| `REDIS_PORT` | Redis cache port | `6379` | No |
| `REDIS_PASSWORD` | Redis auth password (blank if unauthenticated) | `""` | No |
| `JWT_ACCESS_SECRET` | Secret key for signing 15-min JWT access tokens ($\ge$ 16 chars) | *(Set secure secret)* | Yes |
| `JWT_REFRESH_SECRET`| Secret key for signing 7-day refresh tokens ($\ge$ 16 chars) | *(Set secure secret)* | Yes |
| `CANCELLATION_CUTOFF_MINUTES` | Window before start time when customer cancellation is locked | `60` | No |
| `CHECKIN_EARLY_MINUTES` | Minutes before slot start time when customer can check in | `15` | No |
| `CHECKIN_GRACE_MINUTES` | Minutes after slot start time before check-in expires | `15` | No |
| `ENABLE_DOCS` | Force-enable Swagger docs in production | `false` | No |
| `LOG_LEVEL` | Pino logging level (`fatal`, `error`, `warn`, `info`, `debug`) | `info` | No |
| `BUSINESS_TIMEZONE` | Timezone for booking slots and analytics | `Asia/Kolkata` | No |
| `SMTP_HOST` | SMTP server host (MailHog in dev) | `localhost` | No |
| `SMTP_PORT` | SMTP server port (`1025` for MailHog) | `1025` | No |

---

## 🧪 Automated Testing & Verification

Run the full platform verification with one command:
```bash
npm run verify
```
This runs:
1. OpenAPI specification export (`backend/scripts/export-openapi.ts`)
2. All 12 backend test suites (concurrency, booking, queue, notifications, contract test, health probes, shutdown)
3. Frontend ESLint checks
4. All 11 frontend test suites (unit, integration, and axe-core accessibility audits)
5. Backend TypeScript production compilation
6. Frontend production bundle build (`vite build`)

### Run Tests Individually
```bash
# Backend test suite (Jest + Supertest on real PostgreSQL)
npm --prefix backend test

# OpenAPI Route Contract test
npm --prefix backend test -- tests/openapi.test.ts

# Frontend test suite (Vitest + RTL + axe-core)
npm --prefix frontend test

# Export OpenAPI spec to docs/openapi.json
npm --prefix backend run docs:export
```

---

## 🎮 Interactive Demo Scripts

QueueLess includes automated CLI scripts to demonstrate core platform mechanics:

```bash
# 1. Double-Booking Concurrency Demo
# Spawns 20 concurrent requests for the exact same slot; verifies exactly 1 succeeds and 19 get 409
npm --prefix backend run demo:double-booking

# 2. Live Virtual Queue & Socket.io Demo
# Simulates customers joining, owner calling next, and position broadcasts
npm --prefix backend run demo:socket

# 3. Notifications & MailHog Email Demo
# Triggers confirmation and queue alert emails viewable at http://localhost:8025
npm --prefix backend run demo:notifications

# 4. Historical Analytics Seed
# Generates 30 days of realistic appointment and queue history for charts
npm --prefix backend run seed:analytics
```

---

## 👥 Comprehensive Live Demo Script (Two Windows)

Walk through the full end-to-end platform flow across two browser windows:

### Demo Accounts
- **Owner Window (Incognito):** `owner1@clinic.in` / `OwnerPassword123`
- **Customer Window (Normal):** `customer1@example.com` / `CustomerPassword123`
- **Admin Window (Optional):** `admin@queueless.in` / `AdminPassword123`

---

### Step-by-Step Walkthrough

1. **Owner Configures Hours & Slots:**
   - In Owner Window, navigate to **Management** (`/owner/manage`) $\rightarrow$ **Working Hours**. Click "Copy Monday to all weekdays" and save.
   - Go to **Slots** tab, select "Dental Consultation", choose the next 7 days, and click **Generate Slots**. Slots are generated idempotently.
2. **Customer Books Appointment:**
   - In Customer Window, browse to **Apollo Dental Clinic** (`/businesses`).
   - Select tomorrow's date, choose an available slot (e.g. 10:00 AM), and click **Confirm Booking**.
   - Navigate to **My Bookings** (`/my-bookings`) to view the confirmed booking.
3. **Customer Joins Live Virtual Queue:**
   - Go back to **Apollo Dental Clinic** $\rightarrow$ click **Join Live Queue** on the virtual queue card.
   - Customer is routed to `/queue` and issued **Ticket #1** ("You are #1, No one ahead of you").
   - Notice the persistent **Global Queue Banner** across all pages.
4. **Owner Runs Live Queue Desk:**
   - In Owner Window, open **Live Desk** (`/owner`). Ticket #1 appears in the waiting list in real-time via Socket.io without refreshing!
   - Add a walk-in: type "Ramesh Kumar" in the Walk-In form $\rightarrow$ click **Add to Virtual Queue** (issued Ticket #2).
   - Press the **N** key on the keyboard to call the next customer.
5. **Instant Customer Turn Alert:**
   - Look at Customer Window: The screen turns into the highlighted **"It is your turn!"** panel, device vibrates, and an audio chime plays.
6. **Skip with Requeue:**
   - In Owner Window, click **Skip** $\rightarrow$ select **Move to End of Line**.
   - The customer retains their exact ticket number while their position moves behind Ticket #2.
7. **Complete Service & View Analytics:**
   - Owner completes Ticket #2, then opens the **Analytics** tab.
   - View KPI summary cards, daily traffic trend, 24-hour peak traffic breakdown (Asia/Kolkata), and click **Export CSV**.
8. **Admin Oversight:**
   - Log in as `admin@queueless.in`. Notice the navbar displays **Admin Panel** and hides Owner links.
   - Under **Businesses**, review pending business registrations and click **Approve**.
   - Under **Users**, search for a user, click **Block**, and enter a required reason.
   - Under **Audit Log**, verify all actions are logged with IST timestamps.

---

## 📁 Project Structure

```
QueueLess/
├── docker-compose.yml       # PostgreSQL 16 + Redis 7 + MailHog services
├── package.json             # Root monorepo scripts (dev, verify, migrate)
├── docs/
│   ├── ARCHITECTURE.md      # Domain boundaries, table ownership, microservices plan
│   ├── SOCKET_EVENTS.md     # Socket.io event protocol specification
│   └── openapi.json         # Exported OpenAPI 3.0 specification
├── backend/
│   ├── src/
│   │   ├── app.ts           # Express setup (CORS, Helmet, RateLimit, RequestId, Docs)
│   │   ├── server.ts        # HTTP bootstrap, Socket.io, graceful shutdown
│   │   ├── config/          # Zod-validated environment config, Redis client
│   │   ├── db/              # Postgres pool, raw SQL migrations runner (up/down)
│   │   ├── docs/            # OpenAPI 3.0 generator from Zod schemas
│   │   ├── events/          # In-process event bus (publish, subscribe, flush)
│   │   ├── middleware/      # Auth, RequestId, Logger, RateLimiter, ErrorHandler
│   │   ├── modules/
│   │   │   ├── auth/        # Register, login, refresh token rotation, logout
│   │   │   ├── business/    # Businesses, working hours, services, slots
│   │   │   ├── booking/     # Double-booking prevention transactions (FOR UPDATE)
│   │   │   ├── queue/       # Redis sorted set live virtual queue & check-in
│   │   │   ├── notification/# Event handlers, in-app notifications, MailHog SMTP
│   │   │   ├── analytics/   # Asia/Kolkata daily analytics, rolling averages, CSV
│   │   │   ├── admin/       # Approvals, user blocking, audit logging
│   │   │   ├── config/      # Public platform policy endpoints
│   │   │   └── health/      # Liveness & readiness probes (/live, /ready)
│   │   └── utils/           # ApiError, logger (pino), clock, formatters
│   └── tests/               # 12 test suites (unit, integration, concurrency, contract)
└── frontend/
    ├── src/
    │   ├── api/             # Axios instance with single-flight 401 refresh interceptor
    │   ├── components/      # UI components (Navbar, Modal, Button, Toast, OfflineNotice)
    │   ├── context/         # AuthContext (in-memory token), ThemeContext
    │   ├── hooks/           # useQueueSocket, useDebounce
    │   ├── pages/           # Customer, Owner desk & management, Admin panel
    │   └── utils/           # Asia/Kolkata date formatters, audio synthesizer
    └── vite.config.ts       # Manual vendor chunk splitting (under 180 kB main bundle)
```

---

## 🔧 Troubleshooting Guide

### 1. Docker is Not Running
**Symptoms:** `ECONNREFUSED 127.0.0.1:5432` or `127.0.0.1:6379`.
**Solution:**
Ensure Docker Desktop or the Docker daemon is active, then restart the containers:
```bash
docker compose down
docker compose up -d
```

### 2. Port 5000 or 5173 is Already in Use
**Symptoms:** `listen EADDRINUSE: address already in use :::5000` or Vite binds to port 5174.
**Solution (PowerShell on Windows):**
Identify and terminate the lingering process holding the port:
```powershell
# Free port 5000 (Backend)
Get-Process -Id (Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force

# Free port 5173 (Frontend)
Get-Process -Id (Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
```

### 3. Database Migrations Not Applied
**Symptoms:** Table `appointments` or `queue_history` does not exist.
**Solution:**
Run the raw SQL migration tool:
```bash
npm run migrate
```
To reset and re-apply from scratch:
```bash
npm run migrate:down
npm run migrate
npm run seed
```

### 4. Redis Was Flushed or Restarted
**Symptoms:** Redis queue keys are missing while customers have active tickets in PostgreSQL.
**Solution:**
The backend automatically rebuilds all active virtual queues into Redis from `queue_history` on startup:
Simply restart the backend server (`npm run dev:backend`), or restart via Docker.
