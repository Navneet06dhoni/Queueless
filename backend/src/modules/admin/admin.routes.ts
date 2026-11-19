import { Router } from 'express';
import { businessController } from '../business/business.controller';
import { adminController } from './admin.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validateRequest } from '../../middleware/validate';
import {
  adminBusinessQuerySchema,
  adminStatusSchema,
} from '../business/business.validation';
import {
  auditLogQuerySchema,
  blockUserBodySchema,
  listUsersQuerySchema,
} from './admin.validation';

const router = Router();

// All admin routes require authentication and admin role
router.use(authenticate, requireRole('admin'));

// 1. Platform Statistics: GET /api/admin/stats
router.get('/stats', adminController.getStats);

// 2. User Management: GET /api/admin/users
router.get('/users', validateRequest({ query: listUsersQuerySchema }), adminController.listUsers);

// 3. User Blocking: PATCH /api/admin/users/:id/block
router.patch(
  '/users/:id/block',
  validateRequest({ body: blockUserBodySchema }),
  adminController.blockUser
);

// 4. Audit Log: GET /api/admin/audit-log
router.get(
  '/audit-log',
  validateRequest({ query: auditLogQuerySchema }),
  adminController.listAuditLogs
);

// 5. Business Management: GET /api/admin/businesses
router.get(
  '/businesses',
  validateRequest({ query: adminBusinessQuerySchema }),
  businessController.listAdminBusinesses
);

// 6. Business Status Update: PATCH /api/admin/businesses/:id/status
router.patch(
  '/businesses/:id/status',
  validateRequest({ body: adminStatusSchema }),
  businessController.updateBusinessStatus
);

export default router;
