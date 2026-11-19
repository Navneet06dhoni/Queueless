import { Request, Response, NextFunction } from 'express';
import { bookingService, BookingService } from './booking.service';
import { ApiError } from '../../utils/ApiError';

export class BookingController {
  constructor(private service: BookingService = bookingService) {}

  bookAppointment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { slot_id } = req.body;
      const appointment = await this.service.bookSlot(req.user.id, slot_id);
      res.status(201).json({ appointment });
    } catch (err) {
      next(err);
    }
  };

  getMyAppointments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { status, page = 1, limit = 10 } = req.query as any;
      const result = await this.service.getCustomerAppointments(
        req.user.id,
        status,
        parseInt(page, 10),
        parseInt(limit, 10)
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  cancelAppointment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { id } = req.params;
      const result = await this.service.cancelAppointment(id, req.user.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  rescheduleAppointment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { id } = req.params;
      const { new_slot_id } = req.body;
      const result = await this.service.rescheduleAppointment(id, req.user.id, new_slot_id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  getBusinessAppointments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { id } = req.params;
      const { date } = req.query as any;
      const appointments = await this.service.getBusinessAppointments(id, req.user.id, date);
      res.status(200).json({ appointments });
    } catch (err) {
      next(err);
    }
  };

  updateAppointmentStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const { id } = req.params;
      const { status } = req.body;
      const appointment = await this.service.updateStatusByOwner(id, req.user.id, status);
      res.status(200).json({ appointment });
    } catch (err) {
      next(err);
    }
  };
}

export const bookingController = new BookingController();
export default bookingController;
