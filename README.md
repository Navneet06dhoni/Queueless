# QueueLess - Smart Appointment Booking & Live Virtual Queue Platform

A modular monolith platform designed for small clinics, salons, and local businesses in India to eliminate physical waiting lines through smart appointment slot booking and real-time virtual queues.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL (with raw SQL migrations via `pg`)
- **Cache & Live Queue:** Redis (Sorted Sets `ZADD`, `ZRANK`, `ZPOPMIN`, `ZREM`)
- **Real-Time:** Socket.io
- **Auth:** JWT Access Token (15 min) + Refresh Token (7 days), bcryptjs, Role-Based Access (`customer`, `owner`, `admin`)
- **Validation & Security:** Zod, Helmet, CORS, Express-Rate-Limit
- **Frontend:** React (Vite) + Tailwind CSS + React Router + Axios + Socket.io client
- **Documentation:** Swagger/OpenAPI (`/api/docs`)
- **Testing:** Jest + Supertest

---

## 📁 Project Architecture

```
/
├── docker-compose.yml       # PostgreSQL 16 + Redis 7 services
├── package.json             # Root monorepo scripts
├── backend/
│   ├── src/
│   │   ├── config/          # Zod-validated environment config, Redis client
│   │   ├── db/              # Postgres Pool, transaction helper, migration runner
│   │   │   └── migrations/  # SQL DDL migrations (up/down)
│   │   ├── events/          # Decoupled event bus wrapper (events.publish)
│   │   ├── middleware/      # Error handler ({ error: { code, message } }), validator
│   │   ├── modules/         # Modular domain packages
│   │   │   ├── auth/        # Authentication, JWT, roles
│   │   │   ├── business/    # Businesses, working hours, services, slots
│   │   │   ├── booking/     # Double-booking safe transactions (FOR UPDATE)
│   │   │   ├── queue/       # Redis sorted set live virtual queue & history
│   │   │   ├── notification/# Event consumers, Nodemailer, notification store
│   │   │   ├── analytics/   # Daily analytics & rolling averages
│   │   │   └── admin/       # Platform administration & approvals
│   │   ├── utils/           # ApiError, response wrappers, helpers
│   │   ├── app.ts           # Express application setup
│   │   └── server.ts        # HTTP & Socket.io server bootstrap
│   └── tests/               # Unit, integration & concurrency tests
└── frontend/
    ├── src/
    │   ├── api/             # Axios instance with refresh interceptor
    │   ├── components/      # UI components (Button, Card, Modal, Input, Badge, etc.)
    │   ├── context/         # AuthContext, ThemeContext
    │   ├── hooks/           # useQueueSocket, etc.
    │   ├── pages/           # Landing, Auth, Search, Detail, Live Queue, Dashboards
    │   └── utils/           # Formatters, helpers
    └── tailwind.config.js   # Indigo (#4F46E5), soft shadows, rounded-2xl
```

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+ or v20+) & npm
- PostgreSQL & Redis (locally installed or via Docker)

### 2. Start PostgreSQL, Redis & MailHog with Docker Compose
```bash
docker compose up -d
```
This spins up:
- PostgreSQL on `localhost:5432` (`queueless` / `queueless` / `queueless_secret`)
- Redis on `localhost:6379`
- MailHog on `localhost:8025` (Web UI) and `localhost:1025` (SMTP)

### 3. Run Database Migrations & Seeds
```bash
# Run up migrations
npm run migrate

# Or rollback last migration
npm run migrate:down

# Seed initial test data (admin, owners, customers, approved businesses)
npm --prefix backend run seed
```

### 4. Start Development Servers
```bash
# Start backend (http://localhost:5000)
npm run dev:backend

# Start frontend (http://localhost:5173)
npm run dev:frontend
```

---

## 📬 Inspecting Emails in MailHog

QueueLess includes a local MailHog SMTP server for testing all email notifications (booking confirmations, cancellations, reminders, and live queue status updates) without sending real external emails:

1. Ensure the Docker container is running:
   ```bash
   docker compose up -d mailhog
   ```
2. Open the MailHog Web UI in your browser:
   **[http://localhost:8025](http://localhost:8025)**
3. Run the live notification demo to send test emails:
   ```bash
   npm --prefix backend run demo:notifications
   ```
4. View incoming emails in real-time in the web interface, inspect formatted HTML styling, plain text fallbacks, recipient addresses, and delivery headers.

---

## 🧪 Testing & Demos

```bash
# Run all backend unit & integration tests
npm --prefix backend test

# Run notification module test suite
npm --prefix backend test -- tests/notification.test.ts

# Run the live notification & MailHog demo
npm --prefix backend run demo:notifications

# Run the live virtual queue & Socket.io demo
npm --prefix backend run demo:socket

# Run the concurrency double-booking prevention demo
npm --prefix backend run demo:double-booking
```

---

## 📦 Database Schema Summary

1. `users`: UUID PK, name, email (unique), password_hash, role (`customer`, `owner`, `admin`), created_at
2. `businesses`: UUID PK, owner_id FK, name, category, address, city, phone, status (`pending`, `approved`, `rejected`), queue_open (boolean), created_at
3. `services`: UUID PK, business_id FK, name, duration_minutes, price, created_at
4. `working_hours`: UUID PK, business_id FK, day_of_week (0-6), open_time, close_time
5. `slots`: UUID PK, service_id FK, start_time, end_time, status (`free`, `booked`), UNIQUE(`service_id`, `start_time`)
6. `appointments`: UUID PK, slot_id FK, customer_id FK, status (`confirmed`, `cancelled`, `completed`, `no_show`), reminder_sent_at, created_at, partial UNIQUE index on slot_id WHERE status <> 'cancelled'
7. `queue_history`: UUID PK, business_id FK, customer_id FK (nullable), walk_in_name, ticket_number, source (`online`, `appointment`, `walk_in`), appointment_id FK, score, joined_at, called_at, completed_at, status (`waiting`, `called`, `completed`, `skipped`)
8. `notifications`: UUID PK, user_id FK, type, title, message, data (JSONB), dedupe_key (UNIQUE), read_at, email_status (`not_required`, `pending`, `sent`, `failed`), email_attempts, last_error, status (`unread`, `read`), created_at

Indexes are created on all foreign keys, search columns, and `slots(start_time)`.
