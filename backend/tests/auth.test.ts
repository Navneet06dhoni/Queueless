import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app';
import { setupTestDb, TestDbInstance } from './setupTestDb';
import { authenticate, requireRole } from '../src/middleware/auth';
import { errorHandler } from '../src/middleware/errorHandler';

describe('Auth Module Integration Tests', () => {
  let testDb: TestDbInstance;
  let app: ReturnType<typeof createApp>;
  let roleTestApp: express.Express;

  beforeAll(async () => {
    testDb = await setupTestDb();
    app = createApp();

    // Dedicated app to test authenticate + requireRole middleware pipeline
    roleTestApp = express();
    roleTestApp.use(express.json());
    roleTestApp.get(
      '/api/test-owner-only',
      authenticate,
      requireRole('owner'),
      (req, res) => {
        res.status(200).json({ ok: true, user: req.user });
      }
    );
    roleTestApp.use(errorHandler);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  beforeEach(async () => {
    await testDb.resetData();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new customer successfully and return 201 with user and tokens', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Aarav Patel',
          email: 'aarav@example.com',
          password: 'Password123',
          role: 'customer',
        });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('aarav@example.com');
      expect(res.body.user.role).toBe('customer');
      expect(res.body.user.password_hash).toBeUndefined(); // no password hash
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeUndefined(); // token is only in httpOnly cookie

      // Check httpOnly cookie is set
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('refreshToken=');
      expect(cookies[0]).toContain('HttpOnly');
    });

    it('should return 409 if email is already registered', async () => {
      await request(app).post('/api/auth/register').send({
        name: 'Aarav Patel',
        email: 'aarav@example.com',
        password: 'Password123',
        role: 'customer',
      });

      const res = await request(app).post('/api/auth/register').send({
        name: 'Aarav Duplicate',
        email: 'AARAV@example.com', // normalized case check
        password: 'Password456',
        role: 'customer',
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('should reject admin role with 400 validation error', async () => {
      const res = await request(app).post('/api/auth/register').send({
        name: 'Malicious Admin',
        email: 'admin@hack.com',
        password: 'Password123',
        role: 'admin',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject weak password (< 8 chars or no numbers/letters) with 400', async () => {
      // Less than 8 characters
      const resShort = await request(app).post('/api/auth/register').send({
        name: 'Short Pass',
        email: 'short@example.com',
        password: 'pass1',
        role: 'customer',
      });
      expect(resShort.status).toBe(400);
      expect(resShort.body.error.code).toBe('VALIDATION_ERROR');

      // No numbers
      const resNoNum = await request(app).post('/api/auth/register').send({
        name: 'No Number Pass',
        email: 'nonum@example.com',
        password: 'onlyletters',
        role: 'customer',
      });
      expect(resNoNum.status).toBe(400);
      expect(resNoNum.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send({
        name: 'Priya Sharma',
        email: 'priya@example.com',
        password: 'Password123',
        role: 'customer',
      });
    });

    it('should login successfully with correct credentials and return 200 with tokens', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'priya@example.com',
        password: 'Password123',
      });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('priya@example.com');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeUndefined(); // returned only in cookie
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'][0]).toContain('refreshToken=');
    });

    it('should return identical 401 error message for wrong password and unknown email to prevent enumeration', async () => {
      // Wrong password
      const wrongPassRes = await request(app).post('/api/auth/login').send({
        email: 'priya@example.com',
        password: 'WrongPassword999',
      });

      // Unknown email
      const unknownEmailRes = await request(app).post('/api/auth/login').send({
        email: 'nobody@example.com',
        password: 'Password123',
      });

      expect(wrongPassRes.status).toBe(401);
      expect(unknownEmailRes.status).toBe(401);
      expect(wrongPassRes.body.error.message).toBe('Invalid email or password');
      expect(unknownEmailRes.body.error.message).toBe('Invalid email or password');
      expect(wrongPassRes.body.error.code).toBe(unknownEmailRes.body.error.code);
    });
  });

  describe('GET /api/auth/me', () => {
    let accessToken: string;

    beforeEach(async () => {
      const reg = await request(app).post('/api/auth/register').send({
        name: 'Rohan Mehta',
        email: 'rohan@example.com',
        password: 'Password123',
        role: 'customer',
      });
      accessToken = reg.body.accessToken;
    });

    it('should return 401 without an Authorization token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 200 with current user when a valid access token is provided', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.name).toBe('Rohan Mehta');
      expect(res.body.user.email).toBe('rohan@example.com');
    });
  });

  describe('GET /api/auth/verify', () => {
    it('should return 200 with X-User-Id and X-User-Role headers for microservice auth_request', async () => {
      const reg = await request(app).post('/api/auth/register').send({
        name: 'Dr. Sunita',
        email: 'sunita@clinic.in',
        password: 'Password123',
        role: 'owner',
      });

      const res = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${reg.body.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['x-user-id']).toBe(reg.body.user.id);
      expect(res.headers['x-user-role']).toBe('owner');
      expect(res.body.status).toBe('ok');
    });
  });

  describe('POST /api/auth/refresh and rotation security', () => {
    it('should rotate refresh token and issue a new one', async () => {
      const reg = await request(app).post('/api/auth/register').send({
        name: 'Refresh Tester',
        email: 'refresh@example.com',
        password: 'Password123',
        role: 'customer',
      });

      const initialCookie = reg.headers['set-cookie'];
      expect(initialCookie).toBeDefined();

      // Rotate token via cookie
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', initialCookie);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.accessToken).toBeDefined();
      expect(refreshRes.body.refreshToken).toBeUndefined(); // only in cookie

      const newCookie = refreshRes.headers['set-cookie'];
      expect(newCookie).toBeDefined();
      expect(newCookie[0]).not.toBe(initialCookie[0]);

      // Reusing the old (revoked) refresh token must fail with 401 and revoke family
      const replayRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', initialCookie);

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.error.code).toBe('TOKEN_COMPROMISED');

      // Even the latest token in the family must now be revoked due to compromised family!
      const subsequentRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', newCookie);

      expect(subsequentRes.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should revoke refresh token on logout', async () => {
      const reg = await request(app).post('/api/auth/register').send({
        name: 'Logout Tester',
        email: 'logout@example.com',
        password: 'Password123',
        role: 'customer',
      });

      const regCookie = reg.headers['set-cookie'];
      expect(regCookie).toBeDefined();

      // Logout via cookie
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', regCookie);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.message).toContain('logged out');

      // Attempting to refresh with logged-out token should fail
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', regCookie);

      expect(refreshRes.status).toBe(401);
    });
  });

  describe('requireRole middleware', () => {
    it('should return 403 when user does not have the required role', async () => {
      // Register a customer
      const custReg = await request(app).post('/api/auth/register').send({
        name: 'Regular Customer',
        email: 'customer@test.com',
        password: 'Password123',
        role: 'customer',
      });

      // Customer accesses owner-only endpoint -> 403 Forbidden
      const resCust = await request(roleTestApp)
        .get('/api/test-owner-only')
        .set('Authorization', `Bearer ${custReg.body.accessToken}`);

      expect(resCust.status).toBe(403);
      expect(resCust.body.error.code).toBe('FORBIDDEN');

      // Register an owner
      const ownerReg = await request(app).post('/api/auth/register').send({
        name: 'Business Owner',
        email: 'owner@test.com',
        password: 'Password123',
        role: 'owner',
      });

      // Owner accesses owner-only endpoint -> 200 OK
      const resOwner = await request(roleTestApp)
        .get('/api/test-owner-only')
        .set('Authorization', `Bearer ${ownerReg.body.accessToken}`);

      expect(resOwner.status).toBe(200);
      expect(resOwner.body.ok).toBe(true);
    });
  });
});
