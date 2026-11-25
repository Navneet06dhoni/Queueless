# QueueLess - Architecture & Domain Model Boundaries

This document describes the architectural domain boundaries of the QueueLess platform, data ownership, event contracts, database access patterns, and explicit couplings that must be resolved prior to decomposing the modular monolith into independent microservices.

---

## 🏗️ Domain Modules Overview

```
                      ┌─────────────────────────────────────────┐
                      │          API Gateway / Express          │
                      │  (CORS, Rate Limit, Helmet, RequestId)  │
                      └────┬──────┬──────┬──────┬──────┬─────┬───┘
                           │      │      │      │      │     │
         ┌─────────────────┼──────┼──────┴──────┼──────┼─────┴───────────┐
         │                 │      │             │      │                 │
         ▼                 ▼      ▼             ▼      ▼                 ▼
   ┌───────────┐     ┌──────────────┐     ┌───────────┐ ┌──────────┐ ┌─────────┐
   │   Auth    │     │   Business   │     │  Booking  │ │  Queue   │ │  Admin  │
   │  Module   │     │  & Services  │     │  Module   │ │  Module  │ │ Module  │
   └─────┬─────┘     └──────┬───────┘     └─────┬─────┘ └────┬─────┘ └────┬────┘
         │                  │                   │            │            │
         │                  └───────────┬───────┘            │            │
         │                              ▼                    │            │
         │                   In-Process Event Bus ───────────┴────────────┘
         │                     (publish / subscribe)
         │                              │
         ▼                              ▼
    [PostgreSQL]                 ┌─────────────┐
    [Redis Set ]                 │Notification │ ──► [MailHog SMTP]
                                 │   Module    │ ──► [Socket.io Push]
                                 └─────────────┘
```

---

## 📦 Data Ownership & Table Access Matrix

| Module | Owned Tables | Tables Read | Tables Written | Redis Keys Owned |
| :--- | :--- | :--- | :--- | :--- |
| **Auth** | `users`, `refresh_tokens` | `users`, `refresh_tokens` | `users`, `refresh_tokens` | `blocked:users` |
| **Business** | `businesses`, `services`, `working_hours`, `slots` | `businesses`, `services`, `working_hours`, `slots`, *`appointments`* | `businesses`, `services`, `working_hours`, `slots` | `businesses:list:*`, `businesses:cache_version` |
| **Booking** | `appointments` | `appointments`, *`slots`*, *`services`*, *`businesses`*, *`users`* | `appointments`, *`slots`* | None |
| **Queue** | `queue_history` | `queue_history`, *`businesses`*, *`appointments`*, *`slots`* | `queue_history`, *`businesses` (queue_open)* | `queue:business:<id>:waiting`, `queue:business:<id>:current`, `queue:ticket_seq:<id>:<date>` |
| **Notification** | `notifications` | `notifications`, *`users`*, *`businesses`*, *`appointments`*, *`slots`* | `notifications` | None |
| **Analytics** | None (View aggregate) | *`queue_history`*, *`appointments`*, *`slots`*, *`businesses`* | None (Read-only) | `analytics:summary:<id>:<from>:<to>` |
| **Admin** | `admin_audit_log` | `admin_audit_log`, *`users`*, *`businesses`*, *`appointments`*, *`queue_history`*, *`notifications`* | `admin_audit_log`, *`users` (is_blocked)*, *`businesses` (status)*, *`appointments`* | Clears `blocked:users` cache |

*Note: Tables italicized indicate cross-module direct table access.*

---

## 📡 Event Contracts (Asynchronous Event Bus)

All inter-module communication during state changes is decoupled through the in-process event envelope:
```json
{
  "eventId": "uuid",
  "type": "domain.event",
  "occurredAt": "2026-11-21T10:00:00.000Z",
  "data": {}
}
```

### Event Catalog

| Event Name | Publisher Module | Consumer Modules | Payload Data | Trigger Condition |
| :--- | :--- | :--- | :--- | :--- |
| `booking.confirmed` | **Booking** | Notification | `appointmentId`, `customerId`, `businessId`, `slotId`, `startTime` | Customer successfully books a slot inside double-booking transaction. |
| `booking.cancelled` | **Booking** | Notification | `appointmentId`, `customerId`, `businessId`, `slotId`, `startTime`, `cancelledBy` | Customer or owner cancels an appointment. |
| `queue.joined` | **Queue** | Notification, Socket | `businessId`, `customerId`, `ticketNumber`, `position`, `source` | Customer joins live virtual queue online or via check-in. |
| `queue.advanced` | **Queue** | Notification, Socket | `businessId`, `called`, `upcomingList` | Owner calls next customer; waiting list advances. |
| `queue.completed` | **Queue** | Socket | `businessId`, `ticketNumber`, `durationMinutes` | Owner completes current customer service. |
| `queue.skipped` | **Queue** | Notification, Socket | `businessId`, `ticketNumber`, `requeued` | Owner skips current customer. |
| `queue.left` | **Queue** | Socket | `businessId`, `customerId`, `ticketNumber` | Customer voluntarily leaves queue. |
| `business.approved` | **Admin / Business** | Notification | `businessId`, `ownerId`, `name` | Admin approves pending business registration. |
| `business.rejected` | **Admin / Business** | Notification | `businessId`, `ownerId`, `name` | Admin rejects pending business registration. |
| `user.blocked` | **Admin** | Auth, Queue, Booking | `userId`, `reason`, `adminId` | Admin blocks an abusive user. |

---

## ⚠️ Couplings to Resolve Before Microservices Split

To cleanly decompose this modular monolith into independent deployable microservices with isolated databases ("Database-per-Service"), the following 6 tight couplings must be addressed:

### 1. Analytics Module $\leftrightarrow$ Core Transactional Tables
- **Current State:** The Analytics module runs multi-table SQL queries joining `queue_history`, `appointments`, `slots`, and `businesses` in PostgreSQL.
- **Problem:** When services are separated into distinct databases, cross-database SQL joins are impossible.
- **Resolution for Microservices:** Implement an event-driven CQRS Read-Model or data warehouse (e.g., ClickHouse). Analytics consumes domain events (`booking.*`, `queue.*`) and populates pre-aggregated denormalized analytical projections.

### 2. Admin User Blocking $\leftrightarrow$ Appointments & Live Queues
- **Current State:** When an admin blocks a user, `admin.service.ts` queries and mutates the `appointments` table directly (cancelling future appointments) and reaches into the `queue` module to purge waiting entries.
- **Problem:** Admin module directly mutates entities owned by Booking and Queue modules.
- **Resolution for Microservices:** Admin service publishes a `user.blocked` domain event. The Booking microservice consumes this event and executes its own cancellation workflow. The Queue microservice consumes it and evicts tickets from Redis.

### 3. Booking Module $\leftrightarrow$ Slots Table in Business Module
- **Current State:** Booking service executes a `SELECT ... FOR UPDATE` lock directly on the `slots` table to safely guarantee double-booking prevention.
- **Problem:** `slots` is defined in the business schema, yet booked by the booking module.
- **Resolution for Microservices:** Option A: Consolidate `slots` and `appointments` into a unified **Scheduling & Booking Microservice**. Option B: Implement an asynchronous reservation pattern (Saga) where slots are held temporarily with a TTL.

### 4. Queue Appointment Check-In $\leftrightarrow$ Appointments & Slots Tables
- **Current State:** `queue.service.ts` queries `appointments` and joins `slots` to verify slot start time against early/grace check-in windows.
- **Problem:** Queue service reads Booking module tables.
- **Resolution for Microservices:** When a customer checks in, the request routes to the Booking Service, which validates the appointment and issues an authorized `CheckInToken` or calls the Queue Service over high-performance internal gRPC.

### 5. Service Deletion $\leftrightarrow$ Appointments Verification
- **Current State:** Before deleting a service, `business.repository.ts` checks the `appointments` table for active bookings to prevent foreign key errors and return HTTP 409.
- **Problem:** Business module inspects Booking module tables.
- **Resolution for Microservices:** Service deletion sends an internal query via gRPC (`CheckActiveAppointments(serviceId)`) or initiates a Saga that verifies zero active appointments before soft-deleting.

### 6. Appointment Reminder Background Cron Job
- **Current State:** The notification reminder job runs a SQL query joining `appointments`, `slots`, `users`, and `businesses` to identify appointments starting in 60 minutes.
- **Problem:** Background job violates service encapsulation by reading across 4 separate domains.
- **Resolution for Microservices:** The Scheduling & Booking Service schedules a delayed message via RabbitMQ / AWS SQS at booking creation time (`SendAppointmentReminder` scheduled for `startTime - 60m`).

---

## 🏛️ Shared Packages & Gateway Architecture (Phase 10b)

### 1. Monorepo Package Layout (`packages/*`)

To prepare for decoupling the modular monolith into independently deployable services without code duplication or circular dependencies, common cross-cutting capabilities are extracted into strictly governed internal packages:

```
packages/
├── contracts/             # Zod event contracts, event schemas, REST error types
│   ├── src/events.ts      # 9 versioned event schemas & validators (publish/consume)
│   ├── src/errors.ts      # Standardized REST error payload schema
│   └── package.json       # Dependencies: zod ONLY
├── common/                # HTTP & observability foundation
│   ├── src/logger.ts      # Pino logger with automated sensitive data redaction
│   ├── src/requestId.ts   # X-Request-Id middleware & request logger
│   ├── src/ApiError.ts    # Standard ApiError class & static factory methods
│   ├── src/errorHandler.ts# Central Express error handling middleware
│   ├── src/health.ts      # Factory createHealthRouter (/live, /ready, /)
│   ├── src/shutdown.ts    # Graceful shutdown lifecycle management
│   ├── src/config.ts      # Strongly typed configuration loader
│   └── package.json       # Dependencies: @queueless/contracts, express, pino, pino-http, zod
└── messaging/             # Messaging infrastructure & transactional outbox
    ├── src/bus.ts         # IEventBus interface & EventBus implementation
    ├── src/rabbitmq.ts    # RabbitMQ topology (events, retry.q with TTL, dlx/dlq), publisher & consumer
    ├── src/outbox.ts      # Generic OutboxRepository parameterized by DbExecutor
    ├── src/relay.ts       # OutboxRelay background worker with FOR UPDATE SKIP LOCKED
    ├── src/migration.ts   # Exported standalone SQL DDL for outbox_events & processed_events
    └── package.json       # Dependencies: @queueless/contracts, @queueless/common, amqplib, zod
```

#### Architectural Boundary Enforcement
- Packages in `packages/*` **NEVER** import from `backend/*` or `services/*`.
- Packages contain **NO business domain logic or tables** (`appointments`, `businesses`, `services`, `slots`, `users`, `queue_history`, `notifications`). The only tables managed within `packages/` are `outbox_events` and `processed_events`.
- Strict directional dependency DAG:
  `@queueless/contracts` $\leftarrow$ `@queueless/common` $\leftarrow$ `@queueless/messaging` $\leftarrow$ `backend` / future microservices.

---

### 2. API Gateway & Trust Boundary (Nginx Port 8080)

All external traffic enters through the Nginx API gateway (`queueless_gateway` on port `8080`):

```
Clients / Browser (Frontend)
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                 Nginx Gateway (:8080)                       │
│  - /healthz: 200 {"status":"ok"} directly from Nginx        │
│  - /internal/*: 404 block for direct external clients       │
│  - Request ID: Map or generate X-Request-Id ($request_id)   │
│  - Trust Boundary: Strip incoming X-User-Id, X-User-Role    │
│  - Rate Limiting: auth_limit (5r/m), api_limit (20r/s)      │
│  - Payload Cap: client_max_body_size 100k                   │
│  - Custom JSON error pages:                                          │
│    * 401: UNAUTHORIZED                                               │
│    * 413: PAYLOAD_TOO_LARGE                                          │
│    * 429: RATE_LIMITED                                               │
│    * 502/503: UPSTREAM_UNAVAILABLE                                   │
│    * 504: UPSTREAM_TIMEOUT                                           │
│    * /internal/* (direct access): 404 NOT_FOUND                      │
│    All error pages strictly conform to {error:{code,message,requestId}}│
│  - WebSocket: Upgrade headers & 86400s timeout on /socket.io         │
│  - Canary Auth: auth_request on /api/auth/me                │
└──────────────────────┬──────────────────────────────────────┘
                       │ Upstream ($BACKEND_UPSTREAM)
                       ▼
         ┌───────────────────────────┐
         │ QueueLess Monolith (:5000)│
         └───────────────────────────┘
```

#### Trust Boundary Security Invariants:
1. **Identity Header Stripping:** Any client attempt to inject spoofed `X-User-Id`, `X-User-Role`, or `X-Internal-*` headers is stripped at ingress (`proxy_set_header X-User-Id "";`).
2. **Standardized Forwarding:** The gateway populates `X-Forwarded-For ($remote_addr)`, `X-Forwarded-Proto ($scheme)`, `X-Forwarded-Host ($host)`, and `X-Request-Id ($gateway_request_id)`.
3. **Upstream Isolation:** Upstream services never serve raw HTML error pages; Nginx translates connection timeouts and upstream crashes (502/503/504) into standard JSON error objects matching the `@queueless/contracts` schema.

---

### 3. Non-Cached `auth_request` Canary Verification Rationale

For the canary route `/api/auth/me`, Nginx delegates verification to `/internal/auth-verify` (proxied to backend `/api/auth/verify`), copying verified `X-User-Id` and `X-User-Role` upstream via `auth_request_set`.

#### Why Gateway Auth Caching is Explicitly Disabled:
1. **Immediate Revocation Guarantee:** If a user logs out, their refresh/access tokens are blacklisted, or their account is suspended (`user.blocked`), caching the auth verification at the gateway level would permit unauthorized access until the cache TTL expired.
2. **Immediate Role & Permission Updates:** Role changes (e.g., customer promoted to owner, or owner blocked by admin) must take effect on the very next HTTP request.
3. **No Distributed Invalidation Bus Yet:** Properly caching authenticated sessions at edge proxies requires a low-latency cache eviction channel (such as Redis pub/sub or an invalidation topic). In Phase 10b, auth verification queries the fast in-memory Redis token blacklist and stateless JWT validation, achieving sub-millisecond verification overhead without cache staleness risks.

---

### 4. Notification Microservice Decomposition (Phase 10c)

Phase 10c cleanly extracts the notification domain into an autonomous microservice (`services/notification-service`):

```
                   ┌────────────────────────────────────────┐
                   │          Nginx Gateway (:8080)         │
                   │  (Strip incoming X-Internal-Token)     │
                   └──────┬──────────────────────────┬──────┘
                          │                          │
                          │ /api/notifications       │ All other
                          │ + auth_request           │ routes
                          │ + X-Internal-Token       │
                          ▼                          ▼
               ┌─────────────────────┐    ┌─────────────────────┐
               │notification-service │    │ QueueLess Monolith  │
               │  (Port 3004 internal│    │  (Port 5000)        │
               │   Docker net only)  │    └──────────┬──────────┘
               └──────────┬──────────┘               │
                          │                          │ publishes events
                          ▼                          ▼
                   [notification_db]           [queueless DB]
                   [PostgreSQL role:           [PostgreSQL role:
                    notification_user]          postgres]
                          ▲                          │
                          │                          ▼
                          └────────[ RabbitMQ ]◄─────┘
                              (notification.q: events)
                              (socket.q: notification.created)
```

#### 1. Data Ownership
- **Database:** Independent PostgreSQL database `notification_db` (test: `notification_test`).
- **Least-Privilege User:** `notification_user` owns `notifications`, `outbox_events`, `processed_events`. Permissions on `queueless` and `queueless_test` are explicitly revoked.
- **Migration & Copy Scripts:**
  - `npm run migrate:notification`: runs service migrations in `services/notification-service/migrations`.
  - `npm run copy:notifications`: idempotent backfill copying legacy notifications from monolith `queueless` to `notification_db` using `ON CONFLICT (id) DO NOTHING`.

#### 2. Event Consumption & Publication
- **Consumed Events (`notification.q`):**
  - `booking.confirmed`, `booking.cancelled`, `booking.rescheduled`
  - `business.status_changed`
  - `queue.advanced`
  - `appointment.reminder_due`
  All event consumption relies strictly on denormalized contract payloads; the notification service performs no cross-service SQL queries or synchronous lookups back to the monolith.
- **Published Events (`socket.q`):**
  - When in-app notifications are saved, `notification-service` enqueues `notification.created` into its own transactional outbox table.
  - The `OutboxRelay` publishes `notification.created` to RabbitMQ.
  - The monolith socket layer consumes `socket.q` and pushes `notification:new` over WebSockets to room `user:{userId}`.

#### 3. Trust Boundary & Security
- **Port Isolation:** Port `3004` is NOT exposed on host interfaces; it is accessible only within the internal Docker Compose bridge network (`queueless_network`).
- **Internal Shared Token:** Gateway authenticates requests via `auth_request /internal/auth-verify`, attaches `X-Internal-Token: ${INTERNAL_TOKEN}`, `X-User-Id`, and `X-User-Role`.
- **Constant-Time Verification:** Service validates `X-Internal-Token` with `crypto.timingSafeEqual` and rejects forged or missing tokens with 401 Unauthorized.

#### 4. Monolith Rollback Flag (`NOTIFICATIONS_MODE`)
- Monolith config supports `NOTIFICATIONS_MODE=embedded|service` (defaults to `service`).
- In `embedded` mode: monolith mounts `/api/notifications` routes and activates in-process event handlers.
- In `service` mode: monolith unmounts `/api/notifications` routes and warns if a consumer conflict is detected on startup.

#### 5. Intentionally Retained Monolith Responsibilities
- **Reminder Job:** The 15-minute appointment reminder cron remains inside the monolith Booking module because appointment time calculation and slot status evaluation belong to the Booking domain. It publishes `appointment.reminder_due` to RabbitMQ.
- **WebSocket Gateway:** The Socket.io connection manager and user room management (`user:{userId}`) remain on the monolith to avoid premature connection splitting.

#### 6. Failure-Behavior Matrix

| Component Failure | System Behavior | User Experience | Recovery Mechanism |
| :--- | :--- | :--- | :--- |
| **Notification Service DOWN** | Bookings, queue operations, and admin actions succeed without blocking or delays. Events buffer in RabbitMQ `notification.q`. | Bookings succeed immediately. In frontend, notification bell dropdown gracefully shows "Notifications are temporarily unavailable" with error toasts throttled to $\le 1$ per minute without UI crashes. | Once service restarts, it consumes buffered events from RabbitMQ and delivers queued emails/notifications. |
| **RabbitMQ Broker DOWN** | Outbox events are safely committed within PostgreSQL transactions in `outbox_events` table. | End-user operations succeed normally. Real-time push and emails paused temporarily. | `OutboxRelay` resumes polling upon reconnection and drains all pending outbox rows in order. |
| **SMTP Server (MailHog) DOWN** | Notification service retries email delivery 3 times with backoff. Marks row as `failed` with `last_error`. | In-app notifications remain fully functional and unread count increments. | Admins view failed deliveries at `GET /api/admin/notifications` for operational triage. |

---

### Queue Service Transition Architecture (Phase 10d)

#### 1. Configuration Flags & Coupling Rule
- **Mode Flags:**
  - `QUEUE_MODE`: `embedded` | `service` (default: `embedded`)
  - `SOCKET_MODE`: `embedded` | `remote` (default: `embedded`)
- **Temporary Architecture Rule:**
  `QUEUE_MODE=service` requires `SOCKET_MODE=remote` (default both to `embedded`).
  When `QUEUE_MODE=service`, the monolith:
  - Mounts no `/api/queue` routes
  - Runs no Socket.io server
  - Does not rebuild active queues on startup
  - Registers no queue consumers for `user.blocked`
- **Startup Guard (embedded mode):**
  If `QUEUE_MODE=embedded` and RabbitMQ transport is enabled, the monolith verifies via passive queue check (`ch.checkQueue('queue.q')` and `ch.checkQueue('socket.q')`) that no consumers are already attached. If `consumerCount > 0`, it logs a warning and refuses to attach duplicate consumers.

#### 2. Internal Core API & Inter-Service Communication
- Mounted only when `INTERNAL_TOKEN` is configured, protected by constant-time `crypto.timingSafeEqual`:
  - `GET /internal/businesses/:id/queue-info` -> `{ id, name, ownerId, status, workingHoursToday }` (Asia/Kolkata timezone).
  - `GET /internal/appointments/:id/check-in-info` -> `{ id, customerId, businessId, status, slotStartTime }`.
  - `POST /internal/auth/verify-token` -> body `{ token }` -> `{ userId, role, name }` (rejects suspended accounts).
- All `/internal/` paths are blocked at the Nginx edge gateway (returns 404).

#### 3. Client & Fail-Soft Aggregation
- `createInternalClient` in `@queueless/common`: circuit breaker (5 consecutive failures opens for 10s, then half-opens), 2s timeout, 1 retry on GET only, `X-Request-Id` and `X-Internal-Token` propagation, and `ServiceUnavailableError` (HTTP 503).
- Analytics fail-soft rule: In `AnalyticsRepository.getSummary`, both queue and appointment metrics are queried with a 2s timeout. If either fails or times out, the missing metrics become `null` with `partial: true` and HTTP 200 is returned to callers.

#### 4. Platform Failure-Behavior Matrix

| Outage Scenario | System Behavior | End-User Experience | Recovery Mechanism |
| :--- | :--- | :--- | :--- |
| **Notification Service DOWN** | Queue operations, bookings, businesses, and admin actions continue normally. Events buffer in RabbitMQ `notification.q`. | Bookings and queue joins/calls succeed immediately without delay. In-app notification bell shows "Notifications are temporarily unavailable" with error toasts throttled to at most once per minute. | Once `notification-service` container restarts, consumer drains `notification.q` to 0 and delivers all buffered emails to MailHog/SMTP and rows to `notification_db`. |
| **Queue Service DOWN** | Core monolith continues serving Business, Booking, and Admin APIs. Analytics summary returns HTTP 200 with `partial: true` (queue metrics `null`). Gateway `/api/queue/*` routes fail fast (<2s) with HTTP 502 `UPSTREAM_UNAVAILABLE`. | Live Queue page displays *"The queue service is temporarily unavailable, retrying"*, automatically retries every 15 seconds, and disables the Join button. Global queue banner hides itself. Outage toast throttled to $\le 1$ per minute. Appointments and business listings function normally. | Once `queue-service` container restarts, active queues are immediately reconstructed from `queue_db` and Redis state, ticket positions match pre-outage state, and WebSockets automatically reconnect. |
| **Core Monolith DOWN** | Monolith process (port 5000) is unavailable. Public queue routes (`GET /api/queue/:id/status`) and WebSockets through gateway remain operational as they are served directly by `queue-service`. Authenticated gateway requests fail fast with HTTP 502 `UPSTREAM_UNAVAILABLE` because the `auth_request` subrequest to `/internal/auth/verify` cannot reach the core. Direct actions to `127.0.0.1:3003` with `X-Internal-Token` succeed. | Anonymous customers can view public business queue status without disruption. Previously connected sockets keep receiving real-time queue position and ticket called updates. Any new authenticated requests fail immediately with clear upstream error rather than hanging. | Once monolith process is restarted, `auth_request` verification resumes instantly across all routes. |
| **RabbitMQ Broker DOWN** | Outbox events are safely committed within PostgreSQL transactions in each service's respective `outbox_events` table (core monolith, `queue_db`, `notification_db`). | Synchronous HTTP operations (booking, joining queue, calling next, login) succeed without interruption. Real-time event propagation and asynchronous emails pause temporarily without data loss. | `OutboxRelay` background workers in each service detect reconnection, poll pending rows, and publish them in order to RabbitMQ. |

#### 5. Architectural Dependency: Monolith Core as Authentication Hub
Currently, the monolith core hosts the `users` table and the `/internal/auth/verify` endpoint. In the current Nginx gateway configuration, every authenticated request across all routes (`/api/queue/*`, `/api/notifications/*`, `/api/appointments/*`, `/api/admin/*`) relies on an `auth_request /internal/auth/verify` subrequest to the core monolith.

**Honest Assessment:** The core monolith is currently a **hard single point of failure for authentication**. Even though the Queue service and Notification service are isolated microservices with independent databases and separate containers, no client can make an authenticated REST call to either service if the core monolith process is down. This hard dependency provides clear architectural justification and priority for extracting an independent **Auth & Identity Microservice** in the next phase of decomposition, allowing authentication tokens to be validated independently (e.g. via stateless JWT verification or a dedicated lightweight Auth service) without depending on the monolith.




