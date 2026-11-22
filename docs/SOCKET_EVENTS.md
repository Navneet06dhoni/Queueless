# QueueLess - Real-Time Socket.io Events Specification

This document defines the real-time event protocol between the QueueLess client and backend Socket.io server.

---

## 🔒 Authentication & Connection

### Connection Handshake
Clients connect to the root namespace `/` with their in-memory JWT access token:

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  auth: {
    token: accessToken, // or Authorization: Bearer <token>
  },
  transports: ['websocket', 'polling'],
  reconnectionAttempts: Infinity,
});
```

### Auto-Joined Rooms
Upon successful authentication, the server automatically joins the socket to:
- `user:<userId>` — Private room for personalized ticket updates and in-app notifications.

---

## 📡 Client-to-Server Events

### 1. `queue:watch`
Subscribe to live public queue status updates for a specific business.
- **Direction:** Client $\rightarrow$ Server
- **Access:** Public (authenticated or anonymous)
- **Payload:**
  ```json
  {
    "businessId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"
  }
  ```
- **Server Action:** Adds socket to `business:<businessId>:public` room.

---

### 2. `queue:unwatch`
Unsubscribe from public queue status updates.
- **Direction:** Client $\rightarrow$ Server
- **Access:** Public
- **Payload:**
  ```json
  {
    "businessId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"
  }
  ```
- **Server Action:** Removes socket from `business:<businessId>:public` room.

---

### 3. `queue:watch-owner`
Subscribe to full live desk operations for a business.
- **Direction:** Client $\rightarrow$ Server
- **Access:** Owner of the business or Admin only
- **Payload:**
  ```json
  {
    "businessId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"
  }
  ```
- **Server Action:** Validates ownership in database. Adds socket to `business:<businessId>:owner` room.

---

### 4. `queue:unwatch-owner`
Unsubscribe from owner desk operations.
- **Direction:** Client $\rightarrow$ Server
- **Access:** Owner or Admin
- **Payload:**
  ```json
  {
    "businessId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"
  }
  ```
- **Server Action:** Removes socket from `business:<businessId>:owner` room.

---

## 🔔 Server-to-Client Events

### 1. `queue:updated`
Broadcast whenever a queue changes (customer joins, leaves, is called, or completed).
- **Direction:** Server $\rightarrow$ Client
- **Room:** `business:<businessId>:public`
- **Recipients:** Any customer or visitor viewing the business detail page.
- **Payload:**
  ```json
  {
    "isOpen": true,
    "waitingCount": 4,
    "currentTicket": 12,
    "estimatedWaitMinutes": 20
  }
  ```

---

### 2. `queue:owner-updated`
Broadcast to the business owner desk whenever the queue changes.
- **Direction:** Server $\rightarrow$ Client
- **Room:** `business:<businessId>:owner`
- **Recipients:** Authenticated business owner at `/owner`.
- **Payload:**
  ```json
  {
    "isOpen": true,
    "current": {
      "ticketNumber": 12,
      "position": 0,
      "estimatedWaitMinutes": 0,
      "status": "called",
      "source": "online",
      "joinedAt": "2026-11-21T10:00:00.000Z",
      "customerName": "Priya Sharma"
    },
    "waitingList": [
      {
        "ticketNumber": 13,
        "position": 1,
        "estimatedWaitMinutes": 10,
        "status": "waiting",
        "source": "walk_in",
        "joinedAt": "2026-11-21T10:05:00.000Z",
        "customerName": "Ramesh Patel (Walk-in)"
      }
    ],
    "totalServedToday": 8
  }
  ```

---

### 3. `queue:position`
Sent to a specific customer when their position or estimated wait changes.
- **Direction:** Server $\rightarrow$ Client
- **Room:** `user:<customerId>`
- **Recipients:** The queued customer.
- **Payload:**
  ```json
  {
    "ticketNumber": 13,
    "position": 1,
    "peopleAhead": 0,
    "estimatedWaitMinutes": 8,
    "status": "waiting",
    "businessId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"
  }
  ```

---

### 4. `queue:called`
Sent immediately to a customer when the owner calls their ticket ("It is your turn!").
- **Direction:** Server $\rightarrow$ Client
- **Room:** `user:<customerId>`
- **Recipients:** The customer being called.
- **Payload:**
  ```json
  {
    "ticketNumber": 13,
    "status": "called",
    "businessId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "calledAt": "2026-11-21T10:15:30.000Z"
  }
  ```

---

### 5. `queue:removed`
Sent to a customer if they leave the queue, or if an administrator cancels their queue entry.
- **Direction:** Server $\rightarrow$ Client
- **Room:** `user:<customerId>`
- **Recipients:** The removed customer.
- **Payload:**
  ```json
  {
    "reason": "left", // "left" | "cancelled" | "blocked"
    "businessId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"
  }
  ```

---

### 6. `notification:new`
Pushed when an in-app notification is recorded (booking confirmed, cancelled, queue milestone).
- **Direction:** Server $\rightarrow$ Client
- **Room:** `user:<userId>`
- **Recipients:** The recipient user.
- **Payload:**
  ```json
  {
    "id": "e7b1a208-4e89-4a37-b6ad-1b91386d38e2",
    "type": "booking.confirmed",
    "title": "Appointment Confirmed",
    "message": "Your booking for Dental Consultation at Apollo Dental Clinic is confirmed.",
    "data": {
      "appointmentId": "b0a1c2d3-e4f5-6a7b-8c9d-0e1f2a3b4c5d",
      "businessId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"
    },
    "status": "unread",
    "created_at": "2026-11-21T10:00:00.000Z"
  }
  ```
