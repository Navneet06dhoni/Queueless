import request from 'supertest';
import { createApp } from '../src/app';
import redis from '../src/config/redis';

describe('App Scaffolding, Health Checks & Probes', () => {
  const app = createApp();

  it('GET / should return basic service info and documentation link', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('QueueLess API');
    expect(res.body.health).toBe('/api/health');
    expect(res.body.docs).toBe('/api/docs');
  });

  it('GET /api/health/live should respond with 200 and process uptime', async () => {
    const res = await request(app).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /api/health/ready should respond with 200 when DB and Redis are up', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toEqual({
      database: 'up',
      redis: 'up',
    });
  });

  it('GET /api/health/ready should respond with 503 when Redis check fails', async () => {
    const pingSpy = jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('Connection refused'));
    try {
      const res = await request(app).get('/api/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('down');
      expect(res.body.checks.redis).toBe('down');
      expect(res.body.details?.redis).toContain('Connection refused');
    } finally {
      pingSpy.mockRestore();
    }
  });

  it('GET /api/health should respond with backward-compatible 200 and dependency status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('queueless-backend');
    expect(res.body.dependencies).toBeDefined();
  });

  it('GET /api/non-existent-route should return consistent 404 error format with requestId', async () => {
    const res = await request(app).get('/api/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('The requested resource or endpoint was not found');
    expect(res.body.error.requestId).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });
});
