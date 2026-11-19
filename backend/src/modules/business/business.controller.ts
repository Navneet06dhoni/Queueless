import { Request, Response, NextFunction } from 'express';
import { businessService, BusinessService } from './business.service';
import { ApiError } from '../../utils/ApiError';

export class BusinessController {
  constructor(private service: BusinessService = businessService) {}

  createBusiness = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const business = await this.service.createBusiness(req.user.id, req.body);
      res.status(201).json({ business });
    } catch (err) {
      next(err);
    }
  };

  getApprovedBusinesses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getApprovedBusinesses(req.query as any);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getBusinessDetail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const business = await this.service.getBusinessDetail(
        id,
        req.user?.id,
        req.user?.role
      );
      res.status(200).json({ business });
    } catch (err) {
      next(err);
    }
  };

  getOwnerBusinesses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const businesses = await this.service.getOwnerBusinesses(req.user.id);
      res.status(200).json({ businesses });
    } catch (err) {
      next(err);
    }
  };

  updateBusiness = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { id } = req.params;
      const business = await this.service.updateBusiness(id, req.user.id, req.body);
      res.status(200).json({ business });
    } catch (err) {
      next(err);
    }
  };

  // --- Services ---

  addService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { id } = req.params;
      const service = await this.service.addService(id, req.user.id, req.body);
      res.status(201).json({ service });
    } catch (err) {
      next(err);
    }
  };

  updateService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { id, serviceId } = req.params;
      const service = await this.service.updateService(id, serviceId, req.user.id, req.body);
      res.status(200).json({ service });
    } catch (err) {
      next(err);
    }
  };

  deleteService = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { id, serviceId } = req.params;
      await this.service.deleteService(id, serviceId, req.user.id);
      res.status(200).json({ message: 'Service and free slots deleted successfully' });
    } catch (err) {
      next(err);
    }
  };

  // --- Working Hours ---

  setWorkingHours = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { id } = req.params;
      const working_hours = await this.service.setWorkingHours(id, req.user.id, req.body);
      res.status(200).json({ working_hours });
    } catch (err) {
      next(err);
    }
  };

  // --- Slots ---

  generateSlots = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { id } = req.params;
      const result = await this.service.generateSlots(id, req.user.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  getSlots = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const slots = await this.service.getSlots(
        id,
        req.query as any,
        req.user?.id,
        req.user?.role
      );
      res.status(200).json({ slots });
    } catch (err) {
      next(err);
    }
  };

  // --- Admin ---

  listAdminBusinesses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status = 'pending', page = 1, limit = 10 } = req.query as any;
      const result = await this.service.listAdminBusinesses(
        status,
        parseInt(page, 10),
        parseInt(limit, 10)
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  updateBusinessStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const adminId = req.user?.id;
      const business = await this.service.updateBusinessStatus(id, status);

      if (adminId) {
        try {
          const { adminService } = await import('../admin/admin.service');
          await adminService.logAudit(
            adminId,
            status === 'approved' ? 'business.approve' : 'business.reject',
            'business',
            id,
            { status }
          );
        } catch {}
      }

      res.status(200).json({ business });
    } catch (err) {
      next(err);
    }
  };
}

export const businessController = new BusinessController();
export default businessController;
