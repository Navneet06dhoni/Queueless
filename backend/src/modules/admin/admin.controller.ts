import { Request, Response, NextFunction } from 'express';
import { adminService, AdminService } from './admin.service';

export class AdminController {
  constructor(private service: AdminService = adminService) {}

  getStats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const stats = await this.service.getStats();
      res.status(200).json(stats);
    } catch (err) {
      next(err);
    }
  };

  listUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listUsers(req.query as any);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  blockUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminId = req.user!.id;
      const { id } = req.params;
      const { blocked, reason } = req.body;

      if (blocked) {
        const result = await this.service.blockUser(adminId, id, reason);
        res.status(200).json(result);
      } else {
        const result = await this.service.unblockUser(adminId, id);
        res.status(200).json(result);
      }
    } catch (err) {
      next(err);
    }
  };

  listAuditLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

      const result = await this.service.listAuditLogs(page, limit);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}

export const adminController = new AdminController();
