import { Router } from 'express';
import { queueController } from './controller';
import { requireInternalAuth, requireInternalToken, requireRole } from './middleware/auth';
import { queueActionLimiter } from './middleware/rateLimit';

const router = Router();

// 1. Customer: My active queue entry (before /:businessId to avoid path collision)
router.get('/me', requireInternalAuth, requireRole('customer'), queueController.getMyActive);

// 2. Public: Business Queue Status (No authentication required)
router.get('/:businessId/status', queueController.getPublicStatus);

// 3. Customer: Live Position & Estimated Wait
router.get(
  '/:businessId/position',
  requireInternalAuth,
  requireRole('customer'),
  queueController.getPosition
);

// 4. Customer: Join Virtual Queue
router.post(
  '/:businessId/join',
  requireInternalAuth,
  requireRole('customer'),
  queueActionLimiter,
  queueController.join
);

// 5. Customer: Check-in with Booked Appointment
router.post(
  '/:businessId/check-in',
  requireInternalAuth,
  requireRole('customer'),
  queueActionLimiter,
  queueController.checkIn
);

// 6. Customer: Leave Virtual Queue
router.post(
  '/:businessId/leave',
  requireInternalAuth,
  requireRole('customer'),
  queueActionLimiter,
  queueController.leave
);

// 7. Owner: Call Next Customer
router.post(
  '/:businessId/next',
  requireInternalAuth,
  requireRole('owner', 'admin'),
  queueController.callNext
);

// 8. Owner: Complete Current Customer
router.post(
  '/:businessId/complete',
  requireInternalAuth,
  requireRole('owner', 'admin'),
  queueController.completeCurrent
);

// 9. Owner: Skip Current Customer
router.post(
  '/:businessId/skip',
  requireInternalAuth,
  requireRole('owner', 'admin'),
  queueController.skipCurrent
);

// 10. Owner: Add Walk-in Customer
router.post(
  '/:businessId/walk-in',
  requireInternalAuth,
  requireRole('owner', 'admin'),
  queueController.addWalkIn
);

// 11. Owner: Toggle Queue Open/Closed
router.patch(
  '/:businessId/open',
  requireInternalAuth,
  requireRole('owner', 'admin'),
  queueController.toggleOpen
);

// 12. Owner: Get Full Queue List & Metrics
router.get(
  '/:businessId',
  requireInternalAuth,
  requireRole('owner', 'admin'),
  queueController.getOwnerQueue
);

// --- Internal Router ---
const internalRouter = Router();

internalRouter.use(requireInternalToken);
internalRouter.get('/analytics/business/:id/summary', queueController.getAnalyticsSummary);
internalRouter.get('/analytics/business/:id/today', queueController.getAnalyticsToday);
internalRouter.get('/stats', queueController.getStats);

export { router as queueRoutes, internalRouter };
export default router;
