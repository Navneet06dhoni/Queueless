import { Request, Response, NextFunction } from 'express';
import { ApiError } from '@queueless/common';
import { notificationService, NotificationService } from './service';
import { NotificationStatus } from './types';

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
        notifications: result.data,
        total: result.total,
        unreadCount: result.unreadCount,
        page,
        limit,
      });
    } catch (error) {
      next(error);
    }
  };

  markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const notificationId = req.params.id;

      const notification = await this.service.markAsRead(notificationId, userId);
      if (!notification) {
        throw ApiError.notFound('Notification not found', 'NOT_FOUND');
      }

      res.status(200).json({ notification });
    } catch (error) {
      next(error);
    }
  };

  markAllAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const updatedCount = await this.service.markAllAsRead(userId);

      res.status(200).json({
        message: 'All notifications marked as read',
        updatedCount,
      });
    } catch (error) {
      next(error);
    }
  };

  getAdminFailed = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const result = await this.service.getAdminFailed({ page, limit });

      res.status(200).json({
        failedNotifications: result.data,
        total: result.total,
        page,
        limit,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const notificationController = new NotificationController();
