import request from 'supertest';
import pino from 'pino';
import { createApp } from '../src/app';

describe('Observability & Security Logging', () => {
  const app = createApp();

  describe('Request ID Middleware', () => {
    it('generates a new UUID when X-Request-Id is not provided', async () => {
      const res = await request(app).get('/api/health/live');
      expect(res.status).toBe(200);
      const reqId = res.headers['x-request-id'];
      expect(reqId).toBeDefined();
      expect(typeof reqId).toBe('string');
      expect(reqId.length).toBeGreaterThan(10);
    });

    it('honors valid incoming X-Request-Id header', async () => {
      const customId = 'test-req-id-12345';
      const res = await request(app)
        .get('/api/health/live')
        .set('X-Request-Id', customId);

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('includes requestId in error response body', async () => {
      const customId = 'custom-error-id-999';
      const res = await request(app)
        .get('/api/some-undefined-path')
        .set('X-Request-Id', customId);

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.requestId).toBe(customId);
      expect(res.headers['x-request-id']).toBe(customId);
    });
  });

  describe('Logger Redaction', () => {
    it('redacts sensitive authorization headers, bearer tokens, cookies, and passwords', () => {
      let loggedOutput = '';
      const testLogger = pino(
        {
          redact: {
            paths: [
              'authorization',
              'cookie',
              'password',
              'token',
              'refreshToken',
              'headers.authorization',
              'headers.cookie',
            ],
            censor: '[REDACTED]',
          },
        },
        {
          write: (msg: string) => {
            loggedOutput += msg;
          },
        }
      );

      testLogger.info(
        {
          authorization: 'Bearer secret-access-token-xyz',
          cookie: 'refreshToken=secret-refresh-cookie-abc',
          password: 'SuperSecretPassword',
          token: 'secret-token-value',
        },
        'User action'
      );

      expect(loggedOutput).toContain('[REDACTED]');
      expect(loggedOutput).not.toContain('secret-access-token-xyz');
      expect(loggedOutput).not.toContain('secret-refresh-cookie-abc');
      expect(loggedOutput).not.toContain('SuperSecretPassword');
    });
  });
});
