import { Router } from 'express';
import { businessController } from '../business/business.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import {
  adminBusinessQuerySchema,
  adminStatusSchema,
} from '../business/business.validation';

const router = Router();

// GET /api/admin/businesses?status=pending|approved|rejected
router.get(
  '/businesses',
  authenticate,
  requireRole('admin'),
  validateRequest({ query: adminBusinessQuerySchema }),
  businessController.listAdminBusinesses
);

// PATCH /api/admin/businesses/:id/status
router.patch(
  '/businesses/:id/status',
  authenticate,
  requireRole('admin'),
  validateRequest({ body: adminStatusSchema }),
  businessController.updateBusinessStatus
);

export default router;
