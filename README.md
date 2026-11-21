# QueueLess - Smart Appointment Booking & Live Virtual Queue Platform

A modular monolith platform designed for small clinics, salons, and local businesses in India to eliminate physical waiting lines through smart appointment slot booking, real-time virtual queues, owner management tools, and comprehensive platform administration.

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL (with raw SQL migrations via `pg`)
- **Cache & Live Queue:** Redis (Sorted Sets `ZADD`, `ZRANK`, `ZPOPMIN`, `ZREM`)
- **Real-Time:** Socket.io
- **Auth:** JWT Access Token (15 min in-memory) + Refresh Token (7 days httpOnly cookie), bcryptjs, Role-Based Access (`customer`, `owner`, `admin`)
- **Validation & Security:** Zod, Helmet, CORS (credentialed, strict origin), Express-Rate-Limit
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, React Router v6, Axios, Socket.io client, `@tanstack/react-query`, `date-fns` & `date-fns-tz`, Recharts (lazy-loaded)
- **Documentation:** Swagger/OpenAPI (`/api/docs`)
- **Testing:** Jest + Supertest (Backend), Vitest + React Testing Library + axe-core (Frontend)

---

## 📁 Project Architecture

```
/
├── docker-compose.yml       # PostgreSQL 16 + Redis 7 + MailHog services
├── package.json             # Root monorepo scripts
├── backend/
│   ├── src/
│   │   ├── config/          # Zod-validated environment config, Redis client
│   │   ├── db/              # Postgres Pool, transaction helper, migration runner
│   │   │   └── migrations/  # SQL DDL migrations (up/down)
│   │   ├── events/          # Decoupled event bus wrapper (events.publish / subscribe / flush)
│   │   ├── middleware/      # Error handler ({ error: { code, message } }), validator, role auth
│   │   ├── modules/         # Modular domain packages
│   │   │   ├── auth/        # Authentication, JWT, roles, refresh cookie
│   │   │   ├── business/    # Businesses, working hours, services, slots
│   │   │   ├── booking/     # Double-booking safe transactions (FOR UPDATE)
│   │   │   ├── queue/       # Redis sorted set live virtual queue & history
│   │   │   ├── notification/# Event consumers, Nodemailer (MailHog), in-app notifications
│   │   │   ├── analytics/   # Daily analytics, peak hours & rolling averages (Asia/Kolkata)
│   │   │   └── admin/       # Platform administration, approvals, user blocking, audit logs
│   │   ├── utils/           # ApiError, response wrappers, helpers
│   │   ├── app.ts           # Express application setup
│   │   └── server.ts        # HTTP & Socket.io server bootstrap
│   └── tests/               # Unit, integration & concurrency tests
└── frontend/
    ├── src/
    │   ├── api/             # Axios instance with single-flight 401 refresh interceptor
    │   ├── components/      # UI components (Navbar, Modal, OfflineNotice, ErrorBoundary, etc.)
    │   ├── context/         # AuthContext (in-memory token), ThemeContext
    │   ├── hooks/           # useQueueSocket, useDebounce, etc.
    │   ├── pages/
    │   │   ├── LandingPage.tsx
    │   │   ├── auth/        # Login, Register with demo autofill
    │   │   ├── business/    # Search & Business Detail with slot booking
    │   │   ├── queue/       # Live Virtual Queue screen
    │   │   ├── customer/    # My Bookings with check-in button
    │   │   ├── owner/       # Owner Dashboard (Desk, Today, Analytics)
    │   │   │   └── manage/  # Management Hub (Business, Services, Working Hours, Slots)
    │   │   └── admin/       # Admin Panel (Overview, Businesses, Users, Audit, Failed Emails)
    │   └── utils/           # Asia/Kolkata date formatters, audio synthesizer
    └── vite.config.ts       # Granular vendor chunk splitting (under 180 kB main bundle)
```

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+ or v20+) & npm
- Docker and Docker Compose

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

# Rollback last migration if needed
npm run migrate:down

# Seed initial test data (admin, owners, customers, approved businesses)
npm --prefix backend run seed
```

### 4. Start Development Servers
```bash
# Start backend and frontend concurrently
npm run dev

# Or run them individually:
npm run dev:backend   # Express server at http://localhost:5000
npm run dev:frontend  # Vite React app at http://localhost:5173
```

---

## 💻 Complete Feature Tour

### 1. Customer Experience
- **Discovery & Search (`/businesses`):** Real-time debounced keyword search, category filters (Clinic, Salon, Spa, Diagnostics), city filters, and shareable URL query state.
- **Interactive Booking (`/businesses/:id`):** 14-day calendar slot grid, automatic free/booked indicators, and dynamic price/duration preview.
- **Smart Check-In (`/my-bookings`):** View upcoming and past appointments. A **"Check in and join the queue"** button activates strictly within 30 minutes of the appointment's start time, allowing the customer to transition directly into the live virtual queue.
- **Live Virtual Queue (`/queue`):**
  - Instant ticket issuance with persistent ticket number.
  - Live count of people ahead and estimated wait time in minutes.
  - "It is your turn!" alert screen with audio chime and vibration.
  - Safe "Leave queue" modal with confirmation.
- **Global Queue Banner:** Persistent top navigation banner on all pages when the customer has an active ticket, providing a one-click return to their queue view.

### 2. Owner Operations
- **Live Queue Desk (`/owner` - Desk Tab):**
  - Real-time "Now Serving" counter with live duration stopwatch.
  - Large **"Call Next Customer"** button (with single-key shortcut **N** and double-click protection).
  - **Complete Customer** action.
  - **Skip Customer** dialog offering two actions:
    - *Skip Permanently* (status marked as skipped).
    - *Move to End of Line* (preserves the customer's exact ticket number while re-queueing them at the end of the line).
  - Add Walk-In customer form (captures walk-in name, validates length, issues next ticket).
  - Real-time queue toggle (Open / Closed for new entries).
- **Today's Appointments (`/owner` - Today Tab):**
  - List of today's scheduled slots with customer details and status badges.
  - Quick action to Mark Completed or Mark No-Show.
  - **Cancel Appointment** action with reason confirmation.
- **Owner Analytics (`/owner` - Analytics Tab):**
  - Filterable by 7, 14, or 30 days.
  - KPI Cards: Total served, average wait time, median wait time, average service duration, no-show rate, slot utilization, and queue estimate accuracy.
  - Recharts visual graphs: Daily volume & wait trend, 24-hour peak traffic breakdown (Asia/Kolkata), and customer acquisition channel donut (Online vs Walk-in vs Appointment).
  - One-click **Export CSV** download using authenticated fetch.
- **Management Hub (`/owner/manage`):**
  - **Business Profile:** Edit business details (name, category, address, city, phone) with approval status alerts.
  - **Services Management:** Add, edit, or delete services with duration (5–480 min) and price validation. Foreign key 409 conflict handling prevents accidental deletion of services with existing appointments. Responsive card view on mobile screens.
  - **Working Hours:** 7-day schedule editor with open/closed toggles, time range validation, and a 1-click "Copy Monday to all weekdays" shortcut.
  - **Slot Generator:** Select service and date range (up to 30 days forward). Idempotently creates slots matching working hours, reporting total generated and already-existing slots. Includes a day-by-day slot viewer with customer names on booked slots.

### 3. Platform Administration (`/admin` - Admin Only)
- **Role Isolation:** Admins are restricted from `/owner` or `/owner/manage`; non-admins are denied access to `/admin`.
- **System Overview Tab:** High-level platform metrics (total users by role, businesses by status, appointments, queue throughput) and a 30-day registration/booking trend chart with an accessible table fallback.
- **Business Approvals Tab:** Filter by Pending (default), Approved, or Rejected. 1-click Approve or Reject actions with confirmation dialogs.
- **User Management Tab:** Search users by name/email, filter by role (`customer`, `owner`, `admin`) and status (`active`, `blocked`). Block user modal requiring a reason (max 200 chars). Immediate unblock action. Admin accounts cannot be blocked.
- **Audit Log Tab:** Comprehensive log of administrative actions (approvals, rejections, user bans) with Asia/Kolkata timestamps, target details, and pagination.
- **Failed Notifications Tab:** Monitor failed email deliveries with error messages rendered safely as plain text (XSS-safe).

---

## 👥 Comprehensive Live Demo Script

Follow this step-by-step walkthrough across two browser windows (or one standard and one incognito window) to demonstrate all capabilities:

### Demo Accounts & Credentials
| Role | Email | Password | Quick Notes |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@queueless.in` | `AdminPassword123` | Platform oversight & approvals |
| **Owner** | `owner1@clinic.in` | `OwnerPassword123` | Owns Apollo Dental Clinic |
| **Customer** | `customer1@example.com` | `CustomerPassword123` | Appointments & virtual queue |

---

### Step 1: Owner Sets Hours & Generates Slots
1. Open Window 1 (Incognito) and navigate to `http://localhost:5173/login`.
2. Click **Demo: Owner** (or enter `owner1@clinic.in` / `OwnerPassword123`).
3. Click **Management** in the top navigation bar (`/owner/manage`).
4. In the **Working Hours** tab:
   - Verify Monday–Friday are open (09:00 - 18:00).
   - Click **Copy Monday to all weekdays** and click **Save Schedule**.
5. Switch to the **Slots** tab:
   - Select service: "Dental Checkup & Cleaning".
   - Set Start Date to tomorrow and End Date to 7 days from tomorrow.
   - Click **Generate Slots**. Notice the notification: *"Generated X new slots (0 skipped)"*.
   - Click on tomorrow's date in the slot list to verify the slots are created and available.

---

### Step 2: Customer Books an Appointment
1. Open Window 2 (Standard Browser) and navigate to `http://localhost:5173/login`.
2. Click **Demo: Customer** (or enter `customer1@example.com` / `CustomerPassword123`).
3. Click **Browse** (`/businesses`) $\rightarrow$ Click **Apollo Dental Clinic**.
4. In the Appointment Booking section:
   - Select tomorrow's date.
   - Click an available slot (e.g., 09:30 - 10:00).
   - Click **Confirm Booking**. The slot confirms instantly.
5. Navigate to **My Bookings** (`/my-bookings`) to see the confirmed appointment.

---

### Step 3: Customer Joins Live Virtual Queue
1. In Window 2 (Customer), navigate back to **Apollo Dental Clinic** (`/businesses/:id`).
2. Notice the **Live Virtual Queue** card showing status **Open**.
3. Click **Join Live Queue**.
4. The customer is immediately routed to `/queue` and issued a ticket (e.g., **Ticket #1** - *"You are #1, No one ahead of you"*).
5. Open a new tab in Window 2 and navigate to `/businesses`: notice the persistent **Global Queue Banner** at the top showing active ticket status.

---

### Step 4: Owner Runs the Live Queue Desk
1. Switch to Window 1 (Owner). Click **Live Desk** (`/owner`).
2. Notice that **Ticket #1** appears instantly in the Waiting List via Socket.io without any page reload!
3. **Add Walk-In:** In the "Add Walk-In" input, enter "Suresh Patel" and click **Add to Virtual Queue**. Ticket #2 is issued and placed in position #2.
4. **Call Next:** Press the **N** key on the keyboard (or click **Call Next Customer**).
   - Ticket #1 moves to "Now Serving" with an active stopwatch timer.
5. **Customer Screen Live Update:** Switch to Window 2 (Customer):
   - The screen instantly turns into the highlighted amber **"It is your turn!"** panel.
   - An audio chime plays and the page title updates to `"It is your turn - QueueLess"`.
6. **Skip with Requeue:**
   - In Window 1 (Owner), click **Skip**.
   - Select **Move to End of Line** and confirm.
   - The customer retains **Ticket #1** but is moved behind Ticket #2 in the queue.
7. **Complete Service:**
   - Press **N** to call Ticket #2 (Suresh Patel).
   - Click **Complete Service** to finish Ticket #2.

---

### Step 5: Owner Views Real-Time Analytics
1. In Window 1 (Owner), click the **Analytics** tab.
2. Observe the KPI summary cards (Total Served, Average Wait Time, Estimate Accuracy).
3. Review the Daily Traffic Trend line chart and 24-hour peak traffic breakdown.
4. Click **Export CSV** to verify direct download of analytics data.

---

### Step 6: Admin Approves Business & Manages Users
1. Log out of Window 1 and log in as Admin: `admin@queueless.in` / `AdminPassword123`.
2. Notice the navbar automatically displays **Admin Panel** (`/admin`) and hides Owner links.
3. **Overview:** View high-level system statistics and registration charts.
4. **Businesses Tab:**
   - Filter by **Pending** to view new business registrations.
   - Click **Approve** on a pending clinic and confirm. The business is now public.
5. **Users Tab:**
   - Search for a user (e.g., "customer").
   - Click **Block**, enter reason: *"Violated no-show terms"*, and confirm.
   - The user status changes to Blocked and an audit record is created.
6. **Audit Log Tab:**
   - Switch to the **Audit Log** tab to verify both the business approval and user block actions are logged with accurate IST timestamps.

---

## ⚡ Performance & Bundle Optimization

Vite manual chunking splits large vendor libraries into separate cached bundles to ensure rapid page load:

| Chunk | Content | Uncompressed Size | Gzipped Size |
| :--- | :--- | :--- | :--- |
| `index-*.js` | Main application code & customer pages | **177.72 kB** | **49.80 kB** |
| `vendor-react-*.js` | React 18, React DOM | 142.47 kB | 45.69 kB |
| `vendor-router-*.js` | React Router v6 | 32.48 kB | 11.75 kB |
| `vendor-query-*.js` | TanStack React Query v5 | 40.09 kB | 12.01 kB |
| `vendor-socket-*.js` | Socket.io Client | 33.68 kB | 11.23 kB |
| `vendor-date-*.js` | date-fns & date-fns-tz | 44.57 kB | 10.74 kB |
| `vendor-forms-*.js` | React Hook Form & Zod | 81.33 kB | 22.84 kB |
| `LineChart-*.js` | Recharts (lazy-loaded on analytics/admin) | 409.94 kB | 112.56 kB |
| `index-*.css` | Tailwind CSS compiled styles | 30.56 kB | 6.06 kB |

*Result:* The main application bundle is well below the 500 kB chunk threshold with **zero Vite chunk size warnings**.

---

## 🧪 Automated Testing

### Backend Suites
```bash
# Run all backend tests (concurrency, booking, queue, notifications, analytics, admin)
npm --prefix backend test

# Run core integration test files
npm --prefix backend test -- tests/booking.test.ts tests/queue.test.ts tests/notification.test.ts
```

### Frontend Suites
```bash
# Run 49 unit and integration tests (Vitest + React Testing Library)
npm --prefix frontend test

# Run ESLint check
npm --prefix frontend run lint

# Production build verification
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

## 📦 Database Schema Summary

1. `users`: UUID PK, name, email (unique), password_hash, role (`customer`, `owner`, `admin`), is_blocked (boolean), blocked_at, blocked_reason, created_at
2. `businesses`: UUID PK, owner_id FK, name, category, address, city, phone, status (`pending`, `approved`, `rejected`), queue_open (boolean), created_at
3. `services`: UUID PK, business_id FK, name, duration_minutes, price, created_at
4. `working_hours`: UUID PK, business_id FK, day_of_week (0-6), open_time, close_time
5. `slots`: UUID PK, service_id FK, start_time, end_time, status (`free`, `booked`), UNIQUE(`service_id`, `start_time`)
6. `appointments`: UUID PK, slot_id FK, customer_id FK, status (`confirmed`, `cancelled`, `completed`, `no_show`), reminder_sent_at, created_at, partial UNIQUE index on slot_id WHERE status <> 'cancelled'
7. `queue_history`: UUID PK, business_id FK, customer_id FK (nullable), walk_in_name, ticket_number, source (`online`, `appointment`, `walk_in`), appointment_id FK, score, joined_at, called_at, completed_at, status (`waiting`, `called`, `completed`, `skipped`), estimated_wait_minutes
8. `notifications`: UUID PK, user_id FK, type, title, message, data (JSONB), dedupe_key (UNIQUE), read_at, email_status (`not_required`, `pending`, `sent`, `failed`), email_attempts, last_error, status (`unread`, `read`), created_at
9. `admin_audit_log`: UUID PK, admin_id FK, action, target_type, target_id, details (JSONB), created_at
