import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config';
import { bookingController } from './booking.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import {
  bookAppointmentSchema,
  rescheduleAppointmentSchema,
  updateAppointmentStatusSchema,
  myAppointmentsQuerySchema,
} from './booking.validation';

const router = Router();

// Rate limiter: 30 booking requests per minute per user
const bookingActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  keyGenerator: (req) => (req as any).user?.id || req.ip || 'anonymous',
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many booking requests, please try again after a minute',
    },
  },
});

// 1. Customer books a slot (Customers only, 403 for owners/admins)
router.post(
  '/',
  authenticate,
  requireRole('customer'),
  bookingActionLimiter,
  validateRequest({ body: bookAppointmentSchema }),
  bookingController.bookAppointment
);

// 2. Customer lists their appointments (paginated, newest first)
router.get(
  '/me',
  authenticate,
  requireRole('customer'),
  validateRequest({ query: myAppointmentsQuerySchema }),
  bookingController.getMyAppointments
);

// 3. Cancel an appointment (Customer or Business Owner)
router.delete('/:id', authenticate, bookingController.cancelAppointment);

// 4. Customer reschedules appointment to a new slot
router.patch(
  '/:id/reschedule',
  authenticate,
  requireRole('customer'),
  validateRequest({ body: rescheduleAppointmentSchema }),
  bookingController.rescheduleAppointment
);

// 5. Business owner updates appointment status (completed / no_show)
router.patch(
  '/:id/status',
  authenticate,
  requireRole('owner'),
  validateRequest({ body: updateAppointmentStatusSchema }),
  bookingController.updateAppointmentStatus
);

export default router;
