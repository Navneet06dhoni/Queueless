import request from 'supertest';
import { createApp } from '../src/app';
import { config } from '../src/config';

describe('Debug Endpoint Mount & Security (/internal/debug/client-ip)', () => {
  const originalEnv = config.NODE_ENV;
  const originalDebug = config.DEBUG_ENDPOINTS;

  afterEach(() => {
    (config as any).NODE_ENV = originalEnv;
    (config as any).DEBUG_ENDPOINTS = originalDebug;
  });

  it('Normal development run (NODE_ENV=development, DEBUG_ENDPOINTS=false): returns 404', async () => {
    (config as any).NODE_ENV = 'development';
    (config as any).DEBUG_ENDPOINTS = 'false';
    const app = createApp();

    const res = await request(app)
      .get('/internal/debug/client-ip')
      .set('X-Internal-Token', config.INTERNAL_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('Production run (NODE_ENV=production, DEBUG_ENDPOINTS=false): returns 404', async () => {
    (config as any).NODE_ENV = 'production';
    (config as any).DEBUG_ENDPOINTS = 'false';
    const app = createApp();

    const res = await request(app)
      .get('/internal/debug/client-ip')
      .set('X-Internal-Token', config.INTERNAL_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('DEBUG_ENDPOINTS=true: requires internal token (returns 401 without token)', async () => {
    (config as any).NODE_ENV = 'production';
    (config as any).DEBUG_ENDPOINTS = 'true';
    const app = createApp();

    const res = await request(app).get('/internal/debug/client-ip');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('DEBUG_ENDPOINTS=true: returns 200 with client IP details when valid token provided', async () => {
    (config as any).NODE_ENV = 'production';
    (config as any).DEBUG_ENDPOINTS = 'true';
    const app = createApp();

    const res = await request(app)
      .get('/internal/debug/client-ip')
      .set('X-Internal-Token', config.INTERNAL_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ip');
    expect(res.body).toHaveProperty('xForwardedFor');
    expect(res.body).toHaveProperty('trustProxy');
  });

  it('NODE_ENV=test: returns 401 without token and 200 with token', async () => {
    (config as any).NODE_ENV = 'test';
    (config as any).DEBUG_ENDPOINTS = 'false';
    const app = createApp();

    const unauthRes = await request(app).get('/internal/debug/client-ip');
    expect(unauthRes.status).toBe(401);

    const authRes = await request(app)
      .get('/internal/debug/client-ip')
      .set('X-Internal-Token', config.INTERNAL_TOKEN);
    expect(authRes.status).toBe(200);
    expect(authRes.body).toHaveProperty('ip');
  });
});
