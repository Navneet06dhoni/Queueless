import { Router } from 'express';
import { requireInternalAuth, requireAdmin } from './middleware/auth';
import { notificationController } from './controller';

const router = Router();

// User notifications routes
router.get('/notifications', requireInternalAuth, notificationController.getMyNotifications);
router.post('/notifications/read-all', requireInternalAuth, notificationController.markAllAsRead);
router.patch('/notifications/:id/read', requireInternalAuth, notificationController.markAsRead);

// Admin notifications route
router.get('/admin/notifications', requireInternalAuth, requireAdmin, notificationController.getAdminFailed);

export const notificationRoutes = router;
export default notificationRoutes;
