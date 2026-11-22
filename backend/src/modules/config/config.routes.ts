import { Router, Request, Response } from 'express';
import { config } from '../../config';

const router = Router();

// Public endpoint exposing platform operational configuration
router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    cancellationCutoffMinutes: config.CANCELLATION_CUTOFF_MINUTES,
    checkInEarlyMinutes: config.CHECKIN_EARLY_MINUTES,
    checkInGraceMinutes: config.CHECKIN_GRACE_MINUTES,
  });
});

export default router;
