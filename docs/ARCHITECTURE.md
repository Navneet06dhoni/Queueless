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
