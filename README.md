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
# Start backend and frontend together
npm run dev

# Or run them individually:
npm run dev:backend   # Express server at http://localhost:5000
npm run dev:frontend  # Vite React app at http://localhost:5173
```

---

## 💻 Frontend (Step 8a & 8b: Foundation, Live Queue & Owner Dashboard)

The frontend is a modern React application built with Vite, TypeScript, and Tailwind CSS.

### Architecture & Key Principles
- **Vite Dev Proxy:** Transparently proxies `/api` and `/socket.io` (with WebSocket support) to `http://localhost:5000`, keeping the app on a single origin so the `httpOnly` refresh cookie works seamlessly with `SameSite=Lax`.
- **In-Memory JWT Access Token:** The 15-minute access token is kept in memory only (`client.ts`), never written to `localStorage` or `sessionStorage`.
- **Single-Flight 401 Interceptor:** When multiple simultaneous requests fail with 401, a single-flight promise calls `POST /api/auth/refresh` once, updates the in-memory token, and transparently retries all in-flight requests. If refresh fails, it logs out the session.
- **Real-Time Socket Layer (`useQueueSocket`):** Subscribes with `queue:watch` (or `queue:watch-owner`), auto-resubscribes and refetches on reconnect, updates React Query cache directly via `setQueryData`, and falls back to a 15-second REST polling interval when disconnected.
- **Code Splitting & Bundle Optimization:** The Owner Dashboard and Recharts analytics chunk are lazy-loaded via `React.lazy` and `Suspense`, ensuring customer pages download under 13 kB gzipped JS.
- **Asia/Kolkata Formatting:** All dates and times are formatted in IST using `date-fns-tz` regardless of the browser or OS timezone.
- **Accessibility & Motion:** Live screen-reader updates via `aria-live="polite"`, full keyboard shortcuts (`N` for Call Next), and animations that honor `prefers-reduced-motion`.

### Pages & Core Features
1. **Landing Page (`/`):** Hero with business & city search bar, "How it works" guide, and key features.
2. **Login (`/login`) & Register (`/register`):** Validated forms with inline errors, customer/owner role picker, password strength indicator, and demo fill buttons.
3. **Business Search (`/businesses`):** Debounced search, category and city filters, pagination, and URL query parameter synchronization.
4. **Business Detail (`/businesses/:id`):** Services list, working hours, 14-day interactive slot booking, and real-time **Live Virtual Queue Card** (open/closed state, waiting count, now serving, estimated wait, and Join button).
5. **Live Virtual Queue (`/queue` - Customer Only):** Centered ticket display, live position & countdown, smooth progress indicator, persistent "It is your turn" counter banner, synthetic web audio chime with localStorage mute toggle, haptic vibration, and Leave queue confirmation modal.
6. **Global Queue Banner:** Persistent top banner shown across all routes while the customer has an active queue entry with a one-click link to `/queue`.
7. **My Bookings (`/my-bookings`):** Upcoming/Past/Cancelled bookings, slot rescheduling, cancellation cutoff rules, and a **"Check in and join the queue"** button appearing strictly within 30 minutes of appointment start time.
8. **Owner Dashboard (`/owner` - Owner Only):**
   - **Business Selector:** Switch between owned approved businesses, with pending/rejected status notices.
   - **Live Queue Desk:** Tablet/mobile optimized, "Now Serving" card with running timer, large "Call Next Customer" button (with keyboard shortcut `N` and double-click safety), complete customer action, skip dialog (permanent or move to end), walk-in form (max 80 chars), and queue open/close toggle.
   - **Today Tab:** Today's scheduled appointments with "Mark Completed" and "Mark No-Show" actions (confirmed appointments that have started), plus upcoming appointments preview.
   - **Analytics Tab:** Range selector (7, 14, 30 days), KPI cards (served, avg wait, median wait, avg service time, no-show rate, slot utilization, estimate accuracy), Recharts line chart (daily volume & avg wait trend), 24-hour peak traffic bar chart (highlighting busiest IST hour), customer acquisition donut chart, and CSV export with in-memory Bearer token.

---

## 👥 Live Demo Script (Two Browser Windows)

Follow this script to demonstrate the real-time virtual queue and owner desk to an evaluator:

### Setup & Credentials
- **Owner Window (Window 1):** Incognito or Chrome profile
  - URL: `http://localhost:5173/login`
  - Email: `owner1@clinic.in`
  - Password: `OwnerPassword123`
  - Navigate to **Owner Dashboard** (`/owner`). Select "Apollo Dental Clinic". Note the queue shows **Open**.
- **Customer Window (Window 2):** Standard window or second profile
  - URL: `http://localhost:5173/login`
  - Email: `customer1@example.com`
  - Password: `CustomerPassword123`

### Step-by-Step Live Flow
1. **Join Queue as Customer:**
   - In Customer Window, browse to `/businesses` $\rightarrow$ click **Apollo Dental Clinic**.
   - Notice the Live Virtual Queue card displaying current wait and status. Click **Join Live Queue**.
   - The customer is automatically routed to `/queue` and issued **Ticket #1** ("You are #1, No one ahead of you").
2. **Instant Sync in Owner Window:**
   - Look at the Owner Desk in Window 1: Ticket #1 (`customer1`) instantly appears in the **Waiting List** without refreshing the page!
3. **Add a Walk-in Customer (Owner Desk):**
   - In Owner Window, type "Ramesh Kumar" in the **Add Walk-in** form and click **Add to Virtual Queue**.
   - Ramesh is issued **Ticket #2** at Position #2.
4. **Call Next Customer:**
   - In Owner Window, click the large **Call Next Customer** button (or press the **N** key on your keyboard).
   - Ticket #1 is called! The "Now Serving" card displays Ticket #1 with a running service timer.
5. **Instant "It is your turn" Alert (Customer Screen):**
   - Look at Customer Window (Window 2): The screen instantly changes to the highlighted amber **"It is your turn!"** panel, document title updates to `"It is your turn - QueueLess"`, device vibrates (if supported), and chime plays.
6. **Navigate Around & Global Queue Banner:**
   - In Customer Window, navigate to `/businesses` or `/my-bookings`.
   - A persistent **Global Queue Banner** stays at the top of every page displaying `"It is your turn! Ticket #1 called at Apollo Dental Clinic"` with a link back to `/queue`.
7. **Complete Service & Call Next:**
   - In Owner Window, click **Complete Service**. Ticket #1 is finished.
   - Press **N** to call the next customer (Ticket #2 Walk-in Ramesh Kumar).
8. **View Analytics:**
   - Run `npm --prefix backend run seed:analytics` to populate historical metrics if needed.
   - In Owner Window, click the **Analytics** tab. View the daily traffic line chart, 24-hour peak hours, source breakdown donut, and click **Export CSV** to download the report.

### Frontend Commands
```bash
# Run unit & integration tests (Vitest + RTL + MSW)
npm --prefix frontend test

# Run linter
npm --prefix frontend run lint

# Build production bundle
npm --prefix frontend run build
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
