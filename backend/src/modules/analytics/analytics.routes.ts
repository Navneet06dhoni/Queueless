import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import { analyticsController } from './analytics.controller';
import { summaryQuerySchema } from './analytics.validation';

const router = Router();

// All analytics routes require authenticated owner or admin
router.use(authenticate, requireRole('owner', 'admin'));

// 1. GET /api/analytics/business/:id/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get(
  '/business/:id/summary',
  validateRequest({ query: summaryQuerySchema }),
  analyticsController.getSummary
);

// 2. GET /api/analytics/business/:id/today
router.get('/business/:id/today', analyticsController.getToday);

// 3. GET /api/analytics/business/:id/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get(
  '/business/:id/export.csv',
  validateRequest({ query: summaryQuerySchema }),
  analyticsController.exportCsv
);

export default router;
