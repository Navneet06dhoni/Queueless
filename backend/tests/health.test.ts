import request from 'supertest';
import { createApp } from '../src/app';

describe('App Scaffolding & Health Check', () => {
  const app = createApp();

  it('GET / should return basic service info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('QueueLess API');
    expect(res.body.health).toBe('/api/health');
  });

  it('GET /api/health should respond with dependency status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dependencies).toBeDefined();
  });

  it('GET /api/non-existent-route should return consistent 404 error format', async () => {
    const res = await request(app).get('/api/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource or endpoint was not found'
      }
    });
  });
});
