import { Router, Request, Response, NextFunction } from 'express';
import { DateTime } from 'luxon';
import { config } from '../../config';
import { query } from '../../db';
import { ApiError } from '../../utils/ApiError';
import { requireInternalToken } from '../../middleware/internalAuth';
import { verifyAccessToken } from '../auth/auth.utils';
import { isUserBlocked } from '../../middleware/auth';

const router = Router();

// Require internal secret token on all internal routes
router.use(requireInternalToken);

/**
 * GET /internal/businesses/:id/queue-info
 * Returns basic business details and today's working hours in Asia/Kolkata timezone
 */
router.get('/businesses/:id/queue-info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const bizRes = await query<{
      id: string;
      name: string;
      owner_id: string;
      status: string;
    }>('SELECT id, name, owner_id, status FROM businesses WHERE id = $1', [id]);

    if (!bizRes.rows[0]) {
      throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
    }
    const biz = bizRes.rows[0];

    // Compute today in IST
    const nowKolkata = DateTime.now().setZone(config.BUSINESS_TIMEZONE);
    const dayOfWeek = nowKolkata.weekday % 7; // 0 = Sunday, 1 = Monday ... 6 = Saturday

    const whRes = await query<{ open_time: string; close_time: string }>(
      'SELECT open_time, close_time FROM working_hours WHERE business_id = $1 AND day_of_week = $2',
      [id, dayOfWeek]
    );

    const workingHoursToday = whRes.rows[0]
      ? {
          openTime: whRes.rows[0].open_time,
          closeTime: whRes.rows[0].close_time,
          isOpenToday: true,
        }
      : null;

    res.status(200).json({
      id: biz.id,
      name: biz.name,
      ownerId: biz.owner_id,
      status: biz.status,
      workingHoursToday,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /internal/appointments/:id/check-in-info
 * Returns appointment details needed for queue check-in verification
 */
router.get('/appointments/:id/check-in-info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const apptRes = await query<{
      id: string;
      customer_id: string;
      business_id: string;
      status: string;
      start_time: Date | string;
    }>(
      `SELECT a.id, a.customer_id, srv.business_id, a.status, s.start_time
       FROM appointments a
       JOIN slots s ON a.slot_id = s.id
       JOIN services srv ON s.service_id = srv.id
       WHERE a.id = $1`,
      [id]
    );

    if (!apptRes.rows[0]) {
      throw ApiError.notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');
    }
    const appt = apptRes.rows[0];

    res.status(200).json({
      id: appt.id,
      customerId: appt.customer_id,
      businessId: appt.business_id,
      status: appt.status,
      slotStartTime:
        appt.start_time instanceof Date ? appt.start_time.toISOString() : String(appt.start_time),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /internal/auth/verify-token
 * Body: { token: string }
 * Validates JWT access token and rejects blocked users
 */
router.post('/auth/verify-token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;
    if (!token) {
      throw ApiError.unauthorized('Token is required', 'TOKEN_REQUIRED');
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      throw ApiError.unauthorized('Invalid or expired token', 'INVALID_TOKEN');
    }

    const blocked = await isUserBlocked(decoded.sub);
    if (blocked) {
      throw ApiError.unauthorized('User account has been suspended', 'USER_BLOCKED');
    }

    res.status(200).json({
      userId: decoded.sub,
      role: decoded.role,
      name: decoded.name || 'Customer',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
