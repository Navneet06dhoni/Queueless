import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { queueController } from './queue.controller';
import {
  checkInSchema,
  skipSchema,
  toggleOpenSchema,
  walkInSchema,
} from './queue.validation';

const router = Router();

// Rate limiter: 20 requests per minute per user on join, check-in, and leave
const queueActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  keyGenerator: (req) => req.user?.id || req.ip || 'anonymous',
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many queue requests, please try again after a minute',
    },
  },
});

// 1. Customer: My active queue entry (must be placed before /:businessId to avoid collision)
router.get('/me', authenticate, requireRole('customer'), queueController.getMyActive);

// 2. Public: Business Queue Status (No authentication required)
router.get('/:businessId/status', queueController.getPublicStatus);

// 3. Customer: Live Position & Estimated Wait
router.get(
  '/:businessId/position',
  authenticate,
  requireRole('customer'),
  queueController.getPosition
);

// 4. Customer: Join Virtual Queue
router.post(
  '/:businessId/join',
  authenticate,
  requireRole('customer'),
  queueActionLimiter,
  queueController.join
);

// 5. Customer: Check-in with Booked Appointment (Hybrid Queue)
router.post(
  '/:businessId/check-in',
  authenticate,
  requireRole('customer'),
  queueActionLimiter,
  validate(checkInSchema),
  queueController.checkIn
);

// 6. Customer: Leave Virtual Queue
router.post(
  '/:businessId/leave',
  authenticate,
  requireRole('customer'),
  queueActionLimiter,
  queueController.leave
);

// 7. Owner: Call Next Customer
router.post(
  '/:businessId/next',
  authenticate,
  requireRole('owner', 'admin'),
  queueController.callNext
);

// 8. Owner: Complete Current Customer
router.post(
  '/:businessId/complete',
  authenticate,
  requireRole('owner', 'admin'),
  queueController.completeCurrent
);

// 9. Owner: Skip Current Customer (with optional requeue)
router.post(
  '/:businessId/skip',
  authenticate,
  requireRole('owner', 'admin'),
  validate(skipSchema),
  queueController.skipCurrent
);

// 10. Owner: Add Walk-in Customer
router.post(
  '/:businessId/walk-in',
  authenticate,
  requireRole('owner', 'admin'),
  validate(walkInSchema),
  queueController.addWalkIn
);

// 11. Owner: Toggle Queue Open/Closed
router.patch(
  '/:businessId/open',
  authenticate,
  requireRole('owner', 'admin'),
  validate(toggleOpenSchema),
  queueController.toggleOpen
);

// 12. Owner: Get Full Queue List & Metrics
router.get(
  '/:businessId',
  authenticate,
  requireRole('owner', 'admin'),
  queueController.getOwnerQueue
);

export const queueRoutes = router;
export default queueRoutes;
