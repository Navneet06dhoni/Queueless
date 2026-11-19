import { Request, Response, NextFunction } from 'express';
import { analyticsService, AnalyticsService } from './analytics.service';

export class AnalyticsController {
  constructor(private service: AnalyticsService = analyticsService) {}

  getSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { from, to } = req.query as { from?: string; to?: string };
      const userId = req.user!.id;
      const role = req.user!.role;

      const summary = await this.service.getSummary(id, userId, role, from, to);
      res.status(200).json(summary);
    } catch (err) {
      next(err);
    }
  };

  getToday = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const role = req.user!.role;

      const today = await this.service.getToday(id, userId, role);
      res.status(200).json(today);
    } catch (err) {
      next(err);
    }
  };

  exportCsv = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { from, to } = req.query as { from?: string; to?: string };
      const userId = req.user!.id;
      const role = req.user!.role;

      const { csv, filename } = await this.service.exportCsv(id, userId, role, from, to);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  };
}

export const analyticsController = new AnalyticsController();
