import { Request, Response, NextFunction } from 'express';
import { authService, AuthService } from './auth.service';
import { config } from '../../config';
import { ApiError } from '../../utils/ApiError';

const setRefreshTokenCookie = (res: Response, token: string) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
};

const clearRefreshTokenCookie = (res: Response) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  });
};

export class AuthController {
  constructor(private service: AuthService = authService) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.register(req.body);
      setRefreshTokenCookie(res, result.tokens.refreshToken);
      res.status(201).json({
        user: result.user,
        accessToken: result.tokens.accessToken,
      });
    } catch (error) {
      next(error);
    }
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.login(req.body);
      setRefreshTokenCookie(res, result.tokens.refreshToken);
      res.status(200).json({
        user: result.user,
        accessToken: result.tokens.accessToken,
      });
    } catch (error) {
      next(error);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.cookies?.refreshToken;
      if (!token) {
        throw ApiError.unauthorized('Refresh token is required', 'TOKEN_REQUIRED');
      }

      const result = await this.service.refresh(token);
      setRefreshTokenCookie(res, result.tokens.refreshToken);
      res.status(200).json({
        user: result.user,
        accessToken: result.tokens.accessToken,
      });
    } catch (error) {
      next(error);
    }
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.cookies?.refreshToken;
      if (token) {
        await this.service.logout(token);
      }
      clearRefreshTokenCookie(res);
      res.status(200).json({
        message: 'Successfully logged out',
      });
    } catch (error) {
      next(error);
    }
  };

  getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw ApiError.unauthorized('Authentication required', 'UNAUTHORIZED');
      }
      const user = await this.service.getCurrentUser(req.user.id);
      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  };

  verify = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id || !req.user?.role) {
        throw ApiError.unauthorized('Invalid or missing authentication token', 'UNAUTHORIZED');
      }

      // Headers for reverse proxy (e.g. Nginx auth_request)
      res.setHeader('X-User-Id', req.user.id);
      res.setHeader('X-User-Role', req.user.role);

      res.status(200).json({
        status: 'ok',
        userId: req.user.id,
        role: req.user.role,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const authController = new AuthController();
export default authController;
