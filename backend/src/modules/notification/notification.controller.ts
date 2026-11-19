import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../utils/ApiError';
import { notificationService, NotificationService } from './notification.service';
import { NotificationStatus } from './notification.types';

export class NotificationController {
  constructor(private service: NotificationService = notificationService) {}

  getMyNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const status = req.query.status as NotificationStatus | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const result = await this.service.getUserNotifications(userId, { status, page, limit });
      res.status(200).json({
        data: result.data,
        total: result.total,
        unreadCount: result.unreadCount,
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  };

  markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const updated = await this.service.markAsRead(id, userId);

      if (!updated) {
        throw ApiError.notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');
      }

      res.status(200).json({ notification: updated });
    } catch (err) {
      next(err);
    }
  };

  markAllAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const count = await this.service.markAllAsRead(userId);
      res.status(200).json({ success: true, count, message: `${count} notifications marked as read` });
    } catch (err) {
      next(err);
    }
  };

  getAdminFailed = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const result = await this.service.getAdminFailedNotifications({ page, limit });
      res.status(200).json({
        data: result.data,
        total: result.total,
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  };
}

export const notificationController = new NotificationController();
