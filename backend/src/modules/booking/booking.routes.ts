import { Router } from 'express';
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

// 1. Customer books a slot (Customers only, 403 for owners/admins)
router.post(
  '/',
  authenticate,
  requireRole('customer'),
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
