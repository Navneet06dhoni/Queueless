import { Request, Response, NextFunction } from 'express';
import { queueService, QueueService } from './queue.service';

export class QueueController {
  constructor(private service: QueueService = queueService) {}

  join = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const customerId = req.user!.id;
      const result = await this.service.joinQueue(businessId, customerId);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  checkIn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const customerId = req.user!.id;
      const { appointment_id } = req.body;
      const result = await this.service.checkInAppointment(businessId, customerId, appointment_id);
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

  getMyActive = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerId = req.user!.id;
      const result = await this.service.getMyActiveEntry(customerId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getPosition = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const customerId = req.user!.id;
      const result = await this.service.getCustomerPosition(businessId, customerId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getPublicStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const result = await this.service.getPublicStatus(businessId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  callNext = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const userRole = req.user!.role;
      const result = await this.service.callNext(businessId, ownerId, userRole);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  completeCurrent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const userRole = req.user!.role;
      const result = await this.service.completeCurrent(businessId, ownerId, userRole);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  skipCurrent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const userRole = req.user!.role;
      const { requeue } = req.body;
      const result = await this.service.skipCurrent(businessId, ownerId, userRole, requeue);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  addWalkIn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const userRole = req.user!.role;
      const { name } = req.body;
      const result = await this.service.addWalkIn(businessId, ownerId, userRole, name);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  toggleOpen = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const userRole = req.user!.role;
      const { open } = req.body;
      const result = await this.service.toggleQueueOpen(businessId, ownerId, userRole, open);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getOwnerQueue = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { businessId } = req.params;
      const ownerId = req.user!.id;
      const result = await this.service.getOwnerQueue(businessId, ownerId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}

export const queueController = new QueueController();
