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
});
