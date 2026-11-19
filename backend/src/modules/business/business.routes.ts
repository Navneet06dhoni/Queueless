import { Router } from 'express';
import { businessController } from './business.controller';
import { bookingController } from '../booking/booking.controller';
import { authenticate, requireRole, optionalAuthenticate } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import { businessAppointmentsQuerySchema } from '../booking/booking.validation';
import {
  createBusinessSchema,
  updateBusinessSchema,
  businessQuerySchema,
  createServiceSchema,
  updateServiceSchema,
  workingHoursSchema,
  generateSlotsSchema,
  slotsQuerySchema,
} from './business.validation';

const router = Router();

// 1. Create a business (Owner only)
router.post(
  '/',
  authenticate,
  requireRole('owner'),
  validateRequest({ body: createBusinessSchema }),
  businessController.createBusiness
);

// 2. List approved businesses (Public search & filter with Redis cache)
router.get(
  '/',
  validateRequest({ query: businessQuerySchema }),
  businessController.getApprovedBusinesses
);

// 3. List owner's own businesses (Owner only, before /:id)
router.get(
  '/mine',
  authenticate,
  requireRole('owner'),
  businessController.getOwnerBusinesses
);

// 4. Get business detail (Public for approved; owner/admin for pending/rejected)
router.get('/:id', optionalAuthenticate, businessController.getBusinessDetail);

// 5. Update business details (Owner of business only)
router.put(
  '/:id',
  authenticate,
  requireRole('owner'),
  validateRequest({ body: updateBusinessSchema }),
  businessController.updateBusiness
);

// --- Services Routes ---

router.post(
  '/:id/services',
  authenticate,
  requireRole('owner'),
  validateRequest({ body: createServiceSchema }),
  businessController.addService
);

router.put(
  '/:id/services/:serviceId',
  authenticate,
  requireRole('owner'),
  validateRequest({ body: updateServiceSchema }),
  businessController.updateService
);

router.delete(
  '/:id/services/:serviceId',
  authenticate,
  requireRole('owner'),
  businessController.deleteService
);

// --- Working Hours Routes ---

router.put(
  '/:id/working-hours',
  authenticate,
  requireRole('owner'),
  validateRequest({ body: workingHoursSchema }),
  businessController.setWorkingHours
);

// --- Slots Routes ---

router.post(
  '/:id/slots/generate',
  authenticate,
  requireRole('owner'),
  validateRequest({ body: generateSlotsSchema }),
  businessController.generateSlots
);

router.get(
  '/:id/slots',
  optionalAuthenticate,
  validateRequest({ query: slotsQuerySchema }),
  businessController.getSlots
);

// --- Business Appointments Route (Owner) ---
router.get(
  '/:id/appointments',
  authenticate,
  requireRole('owner'),
  validateRequest({ query: businessAppointmentsQuerySchema }),
  bookingController.getBusinessAppointments
);

export default router;
