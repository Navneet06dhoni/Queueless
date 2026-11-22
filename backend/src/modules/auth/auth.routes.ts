import { Router } from 'express';
import { authController } from './auth.controller';
import { validateRequest } from '../../middleware/validate';
import { registerSchema, loginSchema, refreshSchema } from './auth.validation';
import { authenticate, authRateLimiter } from '../../middleware/auth';

const router = Router();

router.post(
  '/register',
  authRateLimiter,
  validateRequest({ body: registerSchema }),
  authController.register
);

router.post(
  '/login',
  authRateLimiter,
  validateRequest({ body: loginSchema }),
  authController.login
);

router.post(
  '/refresh',
  authController.refresh
);

router.post('/logout', authController.logout);

const gatewayAuthOrMonolith = (req: any, res: any, next: any) => {
  const gatewayUserId = req.headers['x-user-id'] as string;
  const gatewayUserRole = req.headers['x-user-role'] as string;
  if (gatewayUserId) {
    req.user = {
      id: gatewayUserId,
      role: gatewayUserRole || 'customer',
      email: '',
    };
    return next();
  }
  return authenticate(req, res, next);
};

router.get('/me', gatewayAuthOrMonolith, authController.getMe);

router.get('/verify', authenticate, authController.verify);

export default router;
