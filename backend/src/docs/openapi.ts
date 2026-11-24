import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extend Zod with OpenAPI functionality
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// Register Security Schemes
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'JWT Access Token passed in the Authorization header: `Bearer <token>` (15-minute validity)',
});

registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'refreshToken',
  description: 'httpOnly Secure Refresh Token stored in the cookie (7-day validity, path: `/api/auth`)',
});

// Standard Error Schema Component
export const ErrorResponseSchema = registry.register(
  'ErrorResponse',
  z.object({
    error: z.object({
      code: z.string().openapi({ example: 'NOT_FOUND' }),
      message: z.string().openapi({ example: 'The requested resource was not found' }),
      requestId: z.string().uuid().optional().openapi({ example: 'e7b1a208-4e89-4a37-b6ad-1b91386d38e2' }),
      details: z.any().optional(),
    }),
  })
);

// Standard Reusable Error Responses
export const createErrorResponses = (codes: number[] = [400, 401, 403, 404, 409, 429]) => {
  const responses: Record<number, any> = {};
  for (const code of codes) {
    let desc = 'Error response';
    if (code === 400) desc = 'Bad Request - Validation or parameter failure';
    if (code === 401) desc = 'Unauthorized - Missing or invalid access token';
    if (code === 403) desc = 'Forbidden - User does not have sufficient role or ownership permissions';
    if (code === 404) desc = 'Not Found - The requested resource was not found';
    if (code === 409) desc = 'Conflict - Concurrency violation, double-booking, or rule cutoff';
    if (code === 429) desc = 'Too Many Requests - Rate limit threshold exceeded';

    responses[code] = {
      description: desc,
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    };
  }
  return responses;
};

// ==========================================
// 1. AUTH MODULE
// ==========================================

const RegisterBodySchema = z.object({
  name: z.string().min(2).max(100).openapi({ example: 'Priya Sharma' }),
  email: z.string().email().openapi({ example: 'priya@example.com' }),
  password: z.string().min(8).openapi({ example: 'SecurePassword123' }),
  role: z.enum(['customer', 'owner']).optional().default('customer').openapi({ example: 'customer' }),
});

const LoginBodySchema = z.object({
  email: z.string().email().openapi({ example: 'priya@example.com' }),
  password: z.string().min(1).openapi({ example: 'SecurePassword123' }),
});

const UserResponseSchema = z.object({
  id: z.string().uuid().openapi({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' }),
  name: z.string().openapi({ example: 'Priya Sharma' }),
  email: z.string().openapi({ example: 'priya@example.com' }),
  role: z.enum(['customer', 'owner', 'admin']).openapi({ example: 'customer' }),
  created_at: z.string().datetime().openapi({ example: '2026-11-20T10:00:00.000Z' }),
});

const AuthSuccessResponseSchema = z.object({
  user: UserResponseSchema,
  accessToken: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
});

// POST /api/auth/register
registry.registerPath({
  method: 'post',
  path: '/api/auth/register',
  tags: ['Auth'],
  summary: 'Register a new customer or business owner account',
  description: 'Creates a new user profile with bcrypt-hashed password and issues initial access token and httpOnly refresh cookie.',
  request: {
    body: {
      content: { 'application/json': { schema: RegisterBodySchema } },
    },
  },
  responses: {
    201: {
      description: 'Account registered successfully',
      content: { 'application/json': { schema: AuthSuccessResponseSchema } },
    },
    ...createErrorResponses([400, 409, 429]),
  },
});

// POST /api/auth/login
registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: ['Auth'],
  summary: 'Authenticate with email and password',
  description: 'Verifies credentials, issues 15-minute in-memory access token, and sets httpOnly refresh token cookie.',
  request: {
    body: {
      content: { 'application/json': { schema: LoginBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Login successful',
      content: { 'application/json': { schema: AuthSuccessResponseSchema } },
    },
    ...createErrorResponses([400, 401, 403, 429]),
  },
});

// POST /api/auth/refresh
registry.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  tags: ['Auth'],
  summary: 'Refresh access token using httpOnly cookie',
  description: 'Rotates the refresh token family and issues a new short-lived access token and rotated refresh cookie.',
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: 'Token refreshed successfully',
      content: { 'application/json': { schema: AuthSuccessResponseSchema } },
    },
    ...createErrorResponses([401, 403]),
  },
});

// POST /api/auth/logout
registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  tags: ['Auth'],
  summary: 'Log out and revoke refresh token',
  description: 'Revokes the active refresh token in database/Redis and clears the httpOnly refresh cookie.',
  security: [{ cookieAuth: [] }],
  responses: {
    200: {
      description: 'Logged out successfully',
      content: {
        'application/json': {
          schema: z.object({ message: z.string().openapi({ example: 'Logged out successfully' }) }),
        },
      },
    },
    ...createErrorResponses([401]),
  },
});

// GET /api/auth/me
registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags: ['Auth'],
  summary: 'Get current user profile',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'User profile retrieved',
      content: { 'application/json': { schema: z.object({ user: UserResponseSchema }) } },
    },
    ...createErrorResponses([401]),
  },
});

// GET /api/auth/verify
registry.registerPath({
  method: 'get',
  path: '/api/auth/verify',
  tags: ['Auth'],
  summary: 'Verify current access token',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Token is valid',
      content: { 'application/json': { schema: z.object({ user: UserResponseSchema }) } },
    },
    ...createErrorResponses([401]),
  },
});

// ==========================================
// 2. BUSINESSES MODULE
// ==========================================

const BusinessSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' }),
  owner_id: z.string().uuid().openapi({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' }),
  name: z.string().openapi({ example: 'Apollo Dental Clinic' }),
  category: z.string().openapi({ example: 'Clinic' }),
  address: z.string().openapi({ example: '123 MG Road, Indiranagar' }),
  city: z.string().openapi({ example: 'Bengaluru' }),
  phone: z.string().openapi({ example: '+919876543210' }),
  status: z.enum(['pending', 'approved', 'rejected']).openapi({ example: 'approved' }),
  queue_open: z.boolean().openapi({ example: true }),
  created_at: z.string().datetime().openapi({ example: '2026-11-20T10:00:00.000Z' }),
});

const ServiceSchema = z.object({
  id: z.string().uuid().openapi({ example: 's1s2s3s4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' }),
  business_id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' }),
  name: z.string().openapi({ example: 'Dental Consultation' }),
  duration_minutes: z.number().int().openapi({ example: 30 }),
  price: z.number().openapi({ example: 500 }),
  created_at: z.string().datetime().openapi({ example: '2026-11-20T10:00:00.000Z' }),
});

const WorkingHourSchema = z.object({
  id: z.string().uuid().optional(),
  business_id: z.string().uuid().optional(),
  day_of_week: z.number().int().min(0).max(6).openapi({ example: 1 }),
  open_time: z.string().openapi({ example: '09:00' }),
  close_time: z.string().openapi({ example: '18:00' }),
  is_closed: z.boolean().optional().default(false),
});

const SlotSchema = z.object({
  id: z.string().uuid().openapi({ example: 'slot-1111-2222-3333' }),
  service_id: z.string().uuid().openapi({ example: 's1s2s3s4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' }),
  start_time: z.string().datetime().openapi({ example: '2026-11-22T04:30:00.000Z' }),
  end_time: z.string().datetime().openapi({ example: '2026-11-22T05:00:00.000Z' }),
  status: z.enum(['free', 'booked']).openapi({ example: 'free' }),
});

// POST /api/businesses
registry.registerPath({
  method: 'post',
  path: '/api/businesses',
  tags: ['Businesses'],
  summary: 'Create a new business profile',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(2).max(100).openapi({ example: 'Apollo Dental Clinic' }),
            category: z.string().min(2).max(50).openapi({ example: 'Clinic' }),
            address: z.string().min(5).max(255).openapi({ example: '123 MG Road' }),
            city: z.string().min(2).max(50).openapi({ example: 'Bengaluru' }),
            phone: z.string().min(10).max(15).openapi({ example: '+919876543210' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Business profile created with status pending',
      content: { 'application/json': { schema: z.object({ business: BusinessSchema }) } },
    },
    ...createErrorResponses([400, 401, 403, 409]),
  },
});

// GET /api/businesses
registry.registerPath({
  method: 'get',
  path: '/api/businesses',
  tags: ['Businesses'],
  summary: 'Search approved businesses (public)',
  request: {
    query: z.object({
      search: z.string().optional().openapi({ example: 'dental' }),
      category: z.string().optional().openapi({ example: 'Clinic' }),
      city: z.string().optional().openapi({ example: 'Bengaluru' }),
      page: z.coerce.number().optional().default(1),
      limit: z.coerce.number().optional().default(10),
    }),
  },
  responses: {
    200: {
      description: 'Paginated list of approved businesses',
      content: {
        'application/json': {
          schema: z.object({
            businesses: z.array(BusinessSchema),
            total: z.number().int(),
            page: z.number().int(),
            totalPages: z.number().int(),
          }),
        },
      },
    },
    ...createErrorResponses([400]),
  },
});

// GET /api/businesses/mine
registry.registerPath({
  method: 'get',
  path: '/api/businesses/mine',
  tags: ['Businesses'],
  summary: "List owner's registered businesses",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'List of businesses owned by the authenticated user',
      content: { 'application/json': { schema: z.object({ businesses: z.array(BusinessSchema) }) } },
    },
    ...createErrorResponses([401, 403]),
  },
});

// GET /api/businesses/{id}
registry.registerPath({
  method: 'get',
  path: '/api/businesses/{id}',
  tags: ['Businesses'],
  summary: 'Get business details by ID',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Business details including services and working hours',
      content: {
        'application/json': {
          schema: z.object({
            business: BusinessSchema.extend({
              services: z.array(ServiceSchema).optional(),
              working_hours: z.array(WorkingHourSchema).optional(),
            }),
          }),
        },
      },
    },
    ...createErrorResponses([400, 404]),
  },
});

// PUT /api/businesses/{id}
registry.registerPath({
  method: 'put',
  path: '/api/businesses/{id}',
  tags: ['Businesses'],
  summary: 'Update business profile details',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(2).max(100).optional(),
            category: z.string().min(2).max(50).optional(),
            address: z.string().min(5).max(255).optional(),
            city: z.string().min(2).max(50).optional(),
            phone: z.string().min(10).max(15).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Business updated successfully',
      content: { 'application/json': { schema: z.object({ business: BusinessSchema }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// POST /api/businesses/{id}/services
registry.registerPath({
  method: 'post',
  path: '/api/businesses/{id}/services',
  tags: ['Businesses'],
  summary: 'Add a new service to a business',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(2).max(100).openapi({ example: 'Teeth Whitening' }),
            duration_minutes: z.number().int().min(5).max(480).openapi({ example: 45 }),
            price: z.number().min(0).openapi({ example: 1200 }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Service added successfully',
      content: { 'application/json': { schema: z.object({ service: ServiceSchema }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// PUT /api/businesses/{id}/services/{serviceId}
registry.registerPath({
  method: 'put',
  path: '/api/businesses/{id}/services/{serviceId}',
  tags: ['Businesses'],
  summary: 'Update a business service',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid(), serviceId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(2).max(100).optional(),
            duration_minutes: z.number().int().min(5).max(480).optional(),
            price: z.number().min(0).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Service updated successfully',
      content: { 'application/json': { schema: z.object({ service: ServiceSchema }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// DELETE /api/businesses/{id}/services/{serviceId}
registry.registerPath({
  method: 'delete',
  path: '/api/businesses/{id}/services/{serviceId}',
  tags: ['Businesses'],
  summary: 'Delete a business service',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid(), serviceId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Service deleted successfully',
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
    },
    ...createErrorResponses([400, 401, 403, 404, 409]),
  },
});

// PUT /api/businesses/{id}/working-hours
registry.registerPath({
  method: 'put',
  path: '/api/businesses/{id}/working-hours',
  tags: ['Businesses'],
  summary: 'Set 7-day weekly working hours schedule',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            working_hours: z.array(
              z.object({
                day_of_week: z.number().int().min(0).max(6),
                open_time: z.string().regex(/^\d{2}:\d{2}$/),
                close_time: z.string().regex(/^\d{2}:\d{2}$/),
                is_closed: z.boolean().optional(),
              })
            ),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Working hours updated successfully',
      content: { 'application/json': { schema: z.object({ working_hours: z.array(WorkingHourSchema) }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// POST /api/businesses/{id}/slots/generate
registry.registerPath({
  method: 'post',
  path: '/api/businesses/{id}/slots/generate',
  tags: ['Businesses'],
  summary: 'Generate appointment slots for a service across date range',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            service_id: z.string().uuid(),
            start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-11-22' }),
            end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-11-29' }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Slots generated idempotently',
      content: {
        'application/json': {
          schema: z.object({
            message: z.string().openapi({ example: 'Generated 24 slots (0 skipped)' }),
            generated: z.number().int().openapi({ example: 24 }),
            skipped: z.number().int().openapi({ example: 0 }),
          }),
        },
      },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// GET /api/businesses/{id}/slots
registry.registerPath({
  method: 'get',
  path: '/api/businesses/{id}/slots',
  tags: ['Businesses'],
  summary: 'List available and booked slots for a business',
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-11-22' }),
      service_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of slots for the given date',
      content: { 'application/json': { schema: z.object({ slots: z.array(SlotSchema) }) } },
    },
    ...createErrorResponses([400, 404]),
  },
});

// GET /api/businesses/{id}/appointments
registry.registerPath({
  method: 'get',
  path: '/api/businesses/{id}/appointments',
  tags: ['Businesses'],
  summary: 'List appointments for a business (Owner view)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']).optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of appointments with customer info',
      content: { 'application/json': { schema: z.object({ appointments: z.array(z.any()) }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// ==========================================
// 3. APPOINTMENTS MODULE
// ==========================================

const AppointmentSchema = z.object({
  id: z.string().uuid().openapi({ example: 'b0a1c2d3-e4f5-6a7b-8c9d-0e1f2a3b4c5d' }),
  slot_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']).openapi({ example: 'confirmed' }),
  created_at: z.string().datetime(),
  slot: SlotSchema.optional(),
  service: ServiceSchema.optional(),
  business: BusinessSchema.optional(),
});

// POST /api/appointments
registry.registerPath({
  method: 'post',
  path: '/api/appointments',
  tags: ['Appointments'],
  summary: 'Book an appointment slot (Concurrency-safe FOR UPDATE)',
  description: 'Atomically locks the slot, creates the confirmed appointment, flips slot status to booked, and publishes booking.confirmed event.',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            slot_id: z.string().uuid().openapi({ example: 'slot-1111-2222-3333' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Appointment confirmed successfully',
      content: { 'application/json': { schema: z.object({ appointment: AppointmentSchema }) } },
    },
    ...createErrorResponses([400, 401, 403, 404, 409]),
  },
});

// GET /api/appointments/me
registry.registerPath({
  method: 'get',
  path: '/api/appointments/me',
  tags: ['Appointments'],
  summary: 'List customer appointments (upcoming and past)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']).optional(),
      page: z.coerce.number().optional().default(1),
      limit: z.coerce.number().optional().default(10),
    }),
  },
  responses: {
    200: {
      description: 'Paginated customer appointments',
      content: {
        'application/json': {
          schema: z.object({
            appointments: z.array(AppointmentSchema),
            total: z.number().int(),
            page: z.number().int(),
            totalPages: z.number().int(),
          }),
        },
      },
    },
    ...createErrorResponses([400, 401, 403]),
  },
});

// DELETE /api/appointments/{id}
registry.registerPath({
  method: 'delete',
  path: '/api/appointments/{id}',
  tags: ['Appointments'],
  summary: 'Cancel an appointment',
  description: 'Cancels appointment, frees the associated slot, and notifies parties. Customers are subject to cancellation cutoff window; owners may cancel at any time.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Appointment cancelled successfully',
      content: { 'application/json': { schema: z.object({ message: z.string().openapi({ example: 'Appointment cancelled successfully' }) }) } },
    },
    ...createErrorResponses([400, 401, 403, 404, 409]),
  },
});

// PATCH /api/appointments/{id}/reschedule
registry.registerPath({
  method: 'patch',
  path: '/api/appointments/{id}/reschedule',
  tags: ['Appointments'],
  summary: 'Reschedule an appointment to a new slot',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            new_slot_id: z.string().uuid(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Appointment rescheduled successfully',
      content: { 'application/json': { schema: z.object({ appointment: AppointmentSchema }) } },
    },
    ...createErrorResponses([400, 401, 403, 404, 409]),
  },
});

// PATCH /api/appointments/{id}/status
registry.registerPath({
  method: 'patch',
  path: '/api/appointments/{id}/status',
  tags: ['Appointments'],
  summary: 'Update appointment status (Owner completed / no_show)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            status: z.enum(['completed', 'no_show']),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Appointment status updated',
      content: { 'application/json': { schema: z.object({ appointment: AppointmentSchema }) } },
    },
    ...createErrorResponses([400, 401, 403, 404, 409]),
  },
});

// ==========================================
// 4. QUEUE MODULE
// ==========================================

const QueueEntrySchema = z.object({
  ticketNumber: z.number().int().openapi({ example: 4 }),
  position: z.number().int().openapi({ example: 1 }),
  estimatedWaitMinutes: z.number().int().openapi({ example: 12 }),
  status: z.enum(['waiting', 'called', 'completed', 'skipped']).openapi({ example: 'waiting' }),
  source: z.enum(['online', 'appointment', 'walk_in']).openapi({ example: 'online' }),
  joinedAt: z.string().datetime(),
  customerName: z.string().optional(),
});

// GET /api/queue/me
registry.registerPath({
  method: 'get',
  path: '/api/queue/me',
  tags: ['Queue'],
  summary: 'Get active queue ticket for authenticated customer',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Active ticket or null if not currently queued',
      content: { 'application/json': { schema: z.object({ entry: QueueEntrySchema.nullable() }) } },
    },
    ...createErrorResponses([401, 403]),
  },
});

// GET /api/queue/{businessId}/status
registry.registerPath({
  method: 'get',
  path: '/api/queue/{businessId}/status',
  tags: ['Queue'],
  summary: 'Get public virtual queue overview for a business',
  request: {
    params: z.object({ businessId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Queue open status, waiting count, current serving ticket, and estimated wait',
      content: {
        'application/json': {
          schema: z.object({
            isOpen: z.boolean().openapi({ example: true }),
            waitingCount: z.number().int().openapi({ example: 5 }),
            currentTicket: z.number().int().nullable().openapi({ example: 3 }),
            estimatedWaitMinutes: z.number().int().openapi({ example: 25 }),
          }),
        },
      },
    },
    ...createErrorResponses([400, 404]),
  },
});

// GET /api/queue/{businessId}/position
registry.registerPath({
  method: 'get',
  path: '/api/queue/{businessId}/position',
  tags: ['Queue'],
  summary: "Get customer's live position in a specific business queue",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ businessId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Live queue position and estimated wait',
      content: { 'application/json': { schema: QueueEntrySchema } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// POST /api/queue/{businessId}/join
registry.registerPath({
  method: 'post',
  path: '/api/queue/{businessId}/join',
  tags: ['Queue'],
  summary: 'Join live virtual queue online',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ businessId: z.string().uuid() }),
  },
  responses: {
    201: {
      description: 'Joined queue successfully and ticket issued',
      content: { 'application/json': { schema: QueueEntrySchema } },
    },
    ...createErrorResponses([400, 401, 403, 404, 409, 429]),
  },
});

// POST /api/queue/{businessId}/check-in
registry.registerPath({
  method: 'post',
  path: '/api/queue/{businessId}/check-in',
  tags: ['Queue'],
  summary: 'Check in with booked appointment into live hybrid queue',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ businessId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            appointment_id: z.string().uuid(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Checked in and positioned into virtual queue with appointment priority',
      content: { 'application/json': { schema: QueueEntrySchema } },
    },
    ...createErrorResponses([400, 401, 403, 404, 409, 429]),
  },
});

// POST /api/queue/{businessId}/leave
registry.registerPath({
  method: 'post',
  path: '/api/queue/{businessId}/leave',
  tags: ['Queue'],
  summary: 'Leave the virtual queue',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ businessId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Successfully left queue',
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
    },
    ...createErrorResponses([400, 401, 403, 404, 429]),
  },
});

// POST /api/queue/{businessId}/next
registry.registerPath({
  method: 'post',
  path: '/api/queue/{businessId}/next',
  tags: ['Queue'],
  summary: 'Call next customer in queue (Owner/Desk action)',
  description: 'Pops next customer in FIFO order from Redis sorted set, marks them as called, and auto-completes the previously called customer.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ businessId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Next customer called',
      content: { 'application/json': { schema: z.object({ called: QueueEntrySchema.nullable() }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// POST /api/queue/{businessId}/complete
registry.registerPath({
  method: 'post',
  path: '/api/queue/{businessId}/complete',
  tags: ['Queue'],
  summary: 'Mark currently served customer as completed',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ businessId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Customer completed',
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// POST /api/queue/{businessId}/skip
registry.registerPath({
  method: 'post',
  path: '/api/queue/{businessId}/skip',
  tags: ['Queue'],
  summary: 'Skip currently served customer (with optional requeue to end of line)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ businessId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            requeue: z.boolean().optional().default(false),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Customer skipped',
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// POST /api/queue/{businessId}/walk-in
registry.registerPath({
  method: 'post',
  path: '/api/queue/{businessId}/walk-in',
  tags: ['Queue'],
  summary: 'Add a walk-in customer directly to the virtual queue',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ businessId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(2).max(80).openapi({ example: 'Ramesh Patel' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Walk-in ticket added',
      content: { 'application/json': { schema: QueueEntrySchema } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// PATCH /api/queue/{businessId}/open
registry.registerPath({
  method: 'patch',
  path: '/api/queue/{businessId}/open',
  tags: ['Queue'],
  summary: 'Toggle queue open or closed for new arrivals',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ businessId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            open: z.boolean().openapi({ example: true }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Queue status toggled',
      content: { 'application/json': { schema: z.object({ queue_open: z.boolean() }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// GET /api/queue/{businessId}
registry.registerPath({
  method: 'get',
  path: '/api/queue/{businessId}',
  tags: ['Queue'],
  summary: 'Get full queue state and waiting list for owner desk',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ businessId: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Full desk queue state including waiting list, currently serving, and today totals',
      content: {
        'application/json': {
          schema: z.object({
            isOpen: z.boolean(),
            current: QueueEntrySchema.nullable(),
            waitingList: z.array(QueueEntrySchema),
            totalServedToday: z.number().int(),
          }),
        },
      },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// ==========================================
// 5. NOTIFICATIONS MODULE
// ==========================================

const NotificationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  type: z.string().openapi({ example: 'booking.confirmed' }),
  title: z.string().openapi({ example: 'Appointment Confirmed' }),
  message: z.string().openapi({ example: 'Your booking at Apollo Dental Clinic is confirmed for tomorrow.' }),
  data: z.any().optional(),
  status: z.enum(['unread', 'read']),
  created_at: z.string().datetime(),
});

// GET /api/notifications
registry.registerPath({
  method: 'get',
  path: '/api/notifications',
  tags: ['Notifications'],
  summary: 'List in-app notifications for authenticated user',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      page: z.coerce.number().optional().default(1),
      limit: z.coerce.number().optional().default(20),
    }),
  },
  responses: {
    200: {
      description: 'Paginated user notifications and unread count',
      content: {
        'application/json': {
          schema: z.object({
            notifications: z.array(NotificationSchema),
            total: z.number().int(),
            unreadCount: z.number().int(),
          }),
        },
      },
    },
    ...createErrorResponses([401]),
  },
});

// POST /api/notifications/read-all
registry.registerPath({
  method: 'post',
  path: '/api/notifications/read-all',
  tags: ['Notifications'],
  summary: 'Mark all unread notifications as read',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'All notifications marked as read',
      content: { 'application/json': { schema: z.object({ updated: z.number().int() }) } },
    },
    ...createErrorResponses([401]),
  },
});

// PATCH /api/notifications/{id}/read
registry.registerPath({
  method: 'patch',
  path: '/api/notifications/{id}/read',
  tags: ['Notifications'],
  summary: 'Mark a single notification as read',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Notification marked as read',
      content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
    },
    ...createErrorResponses([401, 404]),
  },
});

// GET /api/admin/notifications
registry.registerPath({
  method: 'get',
  path: '/api/admin/notifications',
  tags: ['Admin'],
  summary: 'List failed email notifications (Admin only)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      page: z.coerce.number().optional().default(1),
      limit: z.coerce.number().optional().default(20),
    }),
  },
  responses: {
    200: {
      description: 'List of failed email notifications with error details',
      content: { 'application/json': { schema: z.object({ failedNotifications: z.array(z.any()), total: z.number() }) } },
    },
    ...createErrorResponses([401, 403]),
  },
});

// ==========================================
// 6. ANALYTICS MODULE
// ==========================================

// GET /api/analytics/business/{id}/summary
registry.registerPath({
  method: 'get',
  path: '/api/analytics/business/{id}/summary',
  tags: ['Analytics'],
  summary: 'Get aggregated business analytics summary (Asia/Kolkata)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Aggregated analytics: queue metrics, wait times, peak hours, customer acquisition, and daily trends',
      content: { 'application/json': { schema: z.any() } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// GET /api/analytics/business/{id}/today
registry.registerPath({
  method: 'get',
  path: '/api/analytics/business/{id}/today',
  tags: ['Analytics'],
  summary: "Get today's quick KPI snapshot for owner desk",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Today's served count, average wait, and currently waiting",
      content: { 'application/json': { schema: z.any() } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// GET /api/analytics/business/{id}/export.csv
registry.registerPath({
  method: 'get',
  path: '/api/analytics/business/{id}/export.csv',
  tags: ['Analytics'],
  summary: 'Export business analytics to CSV',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  },
  responses: {
    200: {
      description: 'CSV file download containing analytics metrics',
      content: { 'text/csv': { schema: z.string() } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// ==========================================
// 7. ADMIN MODULE
// ==========================================

// GET /api/admin/stats
registry.registerPath({
  method: 'get',
  path: '/api/admin/stats',
  tags: ['Admin'],
  summary: 'Platform-wide high-level metrics (Admin only)',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Users count, businesses count by status, appointment volume, and queue throughput',
      content: { 'application/json': { schema: z.any() } },
    },
    ...createErrorResponses([401, 403]),
  },
});

// GET /api/admin/users
registry.registerPath({
  method: 'get',
  path: '/api/admin/users',
  tags: ['Admin'],
  summary: 'List and search platform users with status and role filters',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      search: z.string().optional(),
      role: z.enum(['customer', 'owner', 'admin']).optional(),
      blocked: z.enum(['true', 'false']).optional(),
      page: z.coerce.number().optional().default(1),
      limit: z.coerce.number().optional().default(20),
    }),
  },
  responses: {
    200: {
      description: 'Paginated user list',
      content: { 'application/json': { schema: z.object({ users: z.array(z.any()), total: z.number() }) } },
    },
    ...createErrorResponses([401, 403]),
  },
});

// PATCH /api/admin/users/{id}/block
registry.registerPath({
  method: 'patch',
  path: '/api/admin/users/{id}/block',
  tags: ['Admin'],
  summary: 'Block a user account with required reason',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            reason: z.string().min(3).max(200).openapi({ example: 'Violation of cancellation policy' }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'User blocked and active sessions revoked',
      content: { 'application/json': { schema: z.object({ message: z.string() }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// GET /api/admin/audit-log
registry.registerPath({
  method: 'get',
  path: '/api/admin/audit-log',
  tags: ['Admin'],
  summary: 'View platform administrative audit log',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      page: z.coerce.number().optional().default(1),
      limit: z.coerce.number().optional().default(20),
    }),
  },
  responses: {
    200: {
      description: 'Paginated audit logs with IST timestamps',
      content: { 'application/json': { schema: z.object({ logs: z.array(z.any()), total: z.number() }) } },
    },
    ...createErrorResponses([401, 403]),
  },
});

// GET /api/admin/outbox
registry.registerPath({
  method: 'get',
  path: '/api/admin/outbox',
  tags: ['Admin'],
  summary: 'View transactional outbox events by status (pending or failed)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: z.enum(['pending', 'failed']).optional(),
      page: z.coerce.number().optional().default(1),
      limit: z.coerce.number().optional().default(20),
    }),
  },
  responses: {
    200: {
      description: 'Outbox events list with pagination and oldest unpublished age',
      content: {
        'application/json': {
          schema: z.object({
            events: z.array(
              z.object({
                id: z.string().uuid(),
                event_type: z.string(),
                payload: z.any(),
                status: z.string(),
                retry_count: z.number(),
                last_error: z.string().nullable(),
                created_at: z.string().datetime(),
                published_at: z.string().datetime().nullable(),
              })
            ),
            oldestUnpublishedAgeSeconds: z.number().nullable(),
            page: z.number(),
            limit: z.number(),
          }),
        },
      },
    },
    ...createErrorResponses([401, 403]),
  },
});

// GET /api/admin/businesses
registry.registerPath({
  method: 'get',
  path: '/api/admin/businesses',
  tags: ['Admin'],
  summary: 'List businesses by status (pending, approved, rejected)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: z.enum(['pending', 'approved', 'rejected']).optional().default('pending'),
      page: z.coerce.number().optional().default(1),
      limit: z.coerce.number().optional().default(20),
    }),
  },
  responses: {
    200: {
      description: 'Paginated business list for moderation',
      content: { 'application/json': { schema: z.object({ businesses: z.array(z.any()), total: z.number() }) } },
    },
    ...createErrorResponses([401, 403]),
  },
});

// PATCH /api/admin/businesses/{id}/status
registry.registerPath({
  method: 'patch',
  path: '/api/admin/businesses/{id}/status',
  tags: ['Admin'],
  summary: 'Approve or reject a business profile',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            status: z.enum(['approved', 'rejected']).openapi({ example: 'approved' }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Business status updated',
      content: { 'application/json': { schema: z.object({ business: BusinessSchema }) } },
    },
    ...createErrorResponses([400, 401, 403, 404]),
  },
});

// ==========================================
// 8. CONFIG & HEALTH (Public System Endpoints)
// ==========================================

// GET /api/config
registry.registerPath({
  method: 'get',
  path: '/api/config',
  tags: ['Config'],
  summary: 'Get public platform timing and policy configuration',
  responses: {
    200: {
      description: 'Operational cancellation and check-in window policies',
      content: {
        'application/json': {
          schema: z.object({
            cancellationCutoffMinutes: z.number().int().openapi({ example: 60 }),
            checkInEarlyMinutes: z.number().int().openapi({ example: 15 }),
            checkInGraceMinutes: z.number().int().openapi({ example: 15 }),
          }),
        },
      },
    },
  },
});

// GET /api/health/live
registry.registerPath({
  method: 'get',
  path: '/api/health/live',
  tags: ['Health'],
  summary: 'Process liveness probe (no dependency checks)',
  responses: {
    200: {
      description: 'Process is alive',
      content: {
        'application/json': {
          schema: z.object({
            status: z.literal('ok'),
            uptime: z.number(),
            timestamp: z.string().datetime(),
          }),
        },
      },
    },
  },
});

// GET /api/health/ready
registry.registerPath({
  method: 'get',
  path: '/api/health/ready',
  tags: ['Health'],
  summary: 'Readiness probe with 2s timeout on DB and Redis dependencies',
  responses: {
    200: {
      description: 'All system dependencies are healthy',
      content: {
        'application/json': {
          schema: z.object({
            status: z.literal('ok'),
            checks: z.object({
              database: z.literal('up'),
              redis: z.literal('up'),
            }),
            oldestUnpublishedOutboxAgeSeconds: z.number().nullable().optional(),
            timestamp: z.string().datetime(),
          }),
        },
      },
    },
    503: {
      description: 'One or more system dependencies are unavailable',
      content: {
        'application/json': {
          schema: z.object({
            status: z.literal('down'),
            checks: z.object({
              database: z.enum(['up', 'down']),
              redis: z.enum(['up', 'down']),
            }),
            details: z.record(z.string()).optional(),
            timestamp: z.string().datetime(),
          }),
        },
      },
    },
  },
});

// GET /api/health
registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['Health'],
  summary: 'Backward-compatible health status',
  responses: {
    200: {
      description: 'System and dependencies operational status',
      content: {
        'application/json': {
          schema: z.object({
            status: z.literal('ok'),
            service: z.literal('queueless-backend'),
            timestamp: z.string().datetime(),
            dependencies: z.object({
              database: z.string(),
              redis: z.string(),
            }),
          }),
        },
      },
    },
  },
});

// --- Internal Core API ---
registry.registerPath({
  method: 'get',
  path: '/internal/businesses/{id}/queue-info',
  tags: ['internal'],
  summary: 'Internal endpoint to retrieve business queue status and working hours',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    },
  ],
  responses: {
    200: {
      description: 'Business queue info and today working hours',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string().uuid(),
            name: z.string(),
            ownerId: z.string().uuid(),
            status: z.string(),
            workingHoursToday: z
              .object({
                openTime: z.string(),
                closeTime: z.string(),
              })
              .nullable(),
          }),
        },
      },
    },
    404: {
      description: 'Business not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/internal/appointments/{id}/check-in-info',
  tags: ['internal'],
  summary: 'Internal endpoint to retrieve appointment check-in details',
  parameters: [
    {
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    },
  ],
  responses: {
    200: {
      description: 'Appointment check-in details',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string().uuid(),
            customerId: z.string().uuid(),
            businessId: z.string().uuid(),
            status: z.string(),
            slotStartTime: z.string(),
          }),
        },
      },
    },
    404: {
      description: 'Appointment not found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/internal/auth/verify-token',
  tags: ['internal'],
  summary: 'Internal endpoint to verify customer or owner token and block status',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            token: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Token verified successfully',
      content: {
        'application/json': {
          schema: z.object({
            userId: z.string().uuid(),
            role: z.string(),
            name: z.string(),
          }),
        },
      },
    },
    401: {
      description: 'Token invalid, expired, or user suspended',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

// Export OpenApi Generator
export const generateOpenApiSpec = () => {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'QueueLess API',
      version: '1.0.0',
      description: `
Smart appointment booking and live virtual queue platform for local businesses, clinics, and salons.

### Key Authentication Features
- **In-Memory JWT Access Tokens**: 15-minute expiration, passed via \`Authorization: Bearer <token>\`.
- **httpOnly Refresh Tokens**: 7-day expiration, stored strictly in cookie (\`SameSite=Lax\`, path: \`/api/auth\`).
- **Role-Based Access Control**: \`customer\`, \`owner\`, and \`admin\` roles.

### Error Format
All error responses consistently return:
\`\`\`json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error description",
    "requestId": "uuid",
    "details": {}
  }
}
\`\`\`
`,
    },
    servers: [
      {
        url: '/',
        description: 'Current Environment API Server',
      },
    ],
  });
};

export default generateOpenApiSpec;
