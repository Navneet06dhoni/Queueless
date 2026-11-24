import { Request, Response, NextFunction } from 'express';
import { queueService, QueueService } from './service';
import { ApiError } from '@queueless/common';

export class QueueController {
  constructor(private service: QueueService = queueService) {}

  getMyActive = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerId = req.user!.id;
      const result = await this.service.getMyActiveEntry(customerId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getPublicStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const status = await this.service.getPublicStatus(businessId);
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  };

  getPosition = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const customerId = req.user!.id;
      const position = await this.service.getCustomerPosition(businessId, customerId);
      res.status(200).json(position);
    } catch (err) {
      next(err);
    }
  };

  join = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const customerId = req.user!.id;
      const customerName = req.user?.name;
      const customerEmail = req.user?.email;

      const result = await this.service.joinQueue(
        businessId,
        customerId,
        customerName,
        customerEmail
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  checkIn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const customerId = req.user!.id;
      const customerName = req.user?.name;
      const customerEmail = req.user?.email;
      const { appointmentId } = req.body;

      if (!appointmentId) {
        throw ApiError.badRequest('appointmentId is required', 'VALIDATION_ERROR');
      }

      const result = await this.service.checkInAppointment(
        businessId,
        customerId,
        customerName,
        customerEmail,
        appointmentId
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  leave = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const customerId = req.user!.id;
      const result = await this.service.leaveQueue(businessId, customerId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  callNext = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const role = req.user!.role;
      const result = await this.service.callNext(businessId, ownerId, role);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  completeCurrent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const role = req.user!.role;
      const result = await this.service.completeCurrent(businessId, ownerId, role);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  skipCurrent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const role = req.user!.role;
      const requeue = Boolean(req.body.requeue);
      const result = await this.service.skipCurrent(businessId, ownerId, role, requeue);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  addWalkIn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const role = req.user!.role;
      const { name } = req.body;

      if (!name || typeof name !== 'string') {
        throw ApiError.badRequest('Walk-in name is required', 'VALIDATION_ERROR');
      }

      const result = await this.service.addWalkIn(businessId, ownerId, role, name.trim());
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  toggleOpen = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const role = req.user!.role;
      const open = Boolean(req.body.queue_open ?? req.body.open);

      const result = await this.service.toggleQueueOpen(businessId, ownerId, role, open);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getOwnerQueue = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const role = req.user!.role;
      const details = await this.service.getOwnerQueue(businessId, ownerId, role);
      res.status(200).json(details);
    } catch (err) {
      next(err);
    }
  };

  // --- Internal Analytics & Admin Endpoints ---

  getAnalyticsSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const from = (req.query.from as string) || new Date().toISOString().split('T')[0];
      const to = (req.query.to as string) || new Date().toISOString().split('T')[0];
      const summary = await this.service.getAnalyticsSummary(id, from, to);
      res.status(200).json(summary);
    } catch (err) {
      next(err);
    }
  };

  getAnalyticsToday = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const today = await this.service.getAnalyticsToday(id);
      res.status(200).json(today);
    } catch (err) {
      next(err);
    }
  };

  getStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const days = parseInt((req.query.days as string) || '30', 10);
      const stats = await this.service.get30DayStats(days);
      res.status(200).json(stats);
    } catch (err) {
      next(err);
    }
  };
}

export const queueController = new QueueController();
