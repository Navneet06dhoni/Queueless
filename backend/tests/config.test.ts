import request from 'supertest';
import { createApp } from '../src/app';
import { config } from '../src/config';

describe('Configuration & Cancellation Cutoff API', () => {
  const app = createApp();

  it('GET /api/config should expose cancellationCutoffMinutes and check-in window policies', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cancellationCutoffMinutes: config.CANCELLATION_CUTOFF_MINUTES,
      checkInEarlyMinutes: config.CHECKIN_EARLY_MINUTES,
      checkInGraceMinutes: config.CHECKIN_GRACE_MINUTES,
    });
  });

  it('cancellationCutoffMinutes is dynamically bound to config.CANCELLATION_CUTOFF_MINUTES', async () => {
    const originalCutoff = config.CANCELLATION_CUTOFF_MINUTES;
    try {
      (config as any).CANCELLATION_CUTOFF_MINUTES = 90;
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
      expect(res.body.cancellationCutoffMinutes).toBe(90);
    } finally {
      (config as any).CANCELLATION_CUTOFF_MINUTES = originalCutoff;
    }
  });

  describe('Secret Configuration Validation (JWT, INTERNAL_TOKEN, Database Passwords)', () => {
    const { envSchema } = require('../src/config');

    const baseValidEnv = {
      NODE_ENV: 'test',
      POSTGRES_PASSWORD: 'a'.repeat(32),
      INTERNAL_TOKEN: 'b'.repeat(32),
      JWT_ACCESS_SECRET: 'c'.repeat(32),
      JWT_REFRESH_SECRET: 'd'.repeat(32),
    };

    it('accepts valid secrets >= 32 characters', () => {
      const result = envSchema.safeParse(baseValidEnv);
      expect(result.success).toBe(true);
    });

    it('rejects empty, short, or CHANGE_ME for JWT_ACCESS_SECRET', () => {
      expect(envSchema.safeParse({ ...baseValidEnv, JWT_ACCESS_SECRET: '' }).success).toBe(false);
      expect(envSchema.safeParse({ ...baseValidEnv, JWT_ACCESS_SECRET: 'short_secret_under_32_chars' }).success).toBe(false);
      expect(envSchema.safeParse({ ...baseValidEnv, JWT_ACCESS_SECRET: 'CHANGE_ME' }).success).toBe(false);
      expect(envSchema.safeParse({ ...baseValidEnv, JWT_ACCESS_SECRET: 'CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME' }).success).toBe(false);
    });

    it('rejects empty, short, or CHANGE_ME for JWT_REFRESH_SECRET', () => {
      expect(envSchema.safeParse({ ...baseValidEnv, JWT_REFRESH_SECRET: '' }).success).toBe(false);
      expect(envSchema.safeParse({ ...baseValidEnv, JWT_REFRESH_SECRET: 'short_secret' }).success).toBe(false);
      expect(envSchema.safeParse({ ...baseValidEnv, JWT_REFRESH_SECRET: 'CHANGE_ME' }).success).toBe(false);
    });

    it('rejects empty, short, or CHANGE_ME for INTERNAL_TOKEN', () => {
      expect(envSchema.safeParse({ ...baseValidEnv, INTERNAL_TOKEN: '' }).success).toBe(false);
      expect(envSchema.safeParse({ ...baseValidEnv, INTERNAL_TOKEN: 'short_token' }).success).toBe(false);
      expect(envSchema.safeParse({ ...baseValidEnv, INTERNAL_TOKEN: 'CHANGE_ME' }).success).toBe(false);
    });

    it('rejects empty, short, or CHANGE_ME for POSTGRES_PASSWORD', () => {
      expect(envSchema.safeParse({ ...baseValidEnv, POSTGRES_PASSWORD: '' }).success).toBe(false);
      expect(envSchema.safeParse({ ...baseValidEnv, POSTGRES_PASSWORD: 'short_password' }).success).toBe(false);
      expect(envSchema.safeParse({ ...baseValidEnv, POSTGRES_PASSWORD: 'CHANGE_ME' }).success).toBe(false);
    });
  });
});
