import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { notificationController } from './notification.controller';

const router = Router();

// 1. My notifications (authenticated user)
router.get('/', authenticate, notificationController.getMyNotifications);

// 2. Mark all as read
router.post('/read-all', authenticate, notificationController.markAllAsRead);

// 3. Mark single notification as read
router.patch('/:id/read', authenticate, notificationController.markAsRead);

export const notificationRoutes = router;
export default notificationRoutes;

// Admin router for /api/admin/notifications
const adminNotificationRouter = Router();
adminNotificationRouter.get('/', authenticate, requireRole('admin'), notificationController.getAdminFailed);
export const adminNotificationRoutes = adminNotificationRouter;
