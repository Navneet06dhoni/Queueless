import express from 'express';
import request from 'supertest';
import { createServiceMetrics, normalizeRoutePattern } from '../src/metrics';

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('Metrics Helper (@queueless/common)', () => {
  it('uses matched route pattern and never raw URL, UUIDs, or emails in labels', async () => {
    const metrics = createServiceMetrics({ serviceName: 'test-service' });
    const app = express();
    app.use(metrics.metricsMiddleware);

    const router = express.Router();
    router.get('/:id/slots', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    router.post('/users/:email/notify', (_req, res) => {
      res.status(201).json({ ok: true });
    });
    app.use('/api/businesses', router);

    app.get('/metrics', metrics.metricsHandler);

    const sampleUuid = '123e4567-e89b-12d3-a456-426614174000';
    await request(app).get(`/api/businesses/${sampleUuid}/slots`).expect(200);
    await request(app).post('/api/businesses/users/alice@example.com/notify').expect(201);
    await request(app).get('/api/unknown/9999/123e4567-e89b-12d3-a456-426614174000').expect(404);

    const res = await request(app).get('/metrics').expect(200);
    const body = res.text;

    expect(body).toContain('http_requests_total');
    expect(body).toContain('http_request_duration_seconds');
    expect(body).toContain('http_in_flight_requests');
    expect(body).toContain('route="/api/businesses/:id/slots"');
    expect(body).toContain('route="/api/businesses/users/:email/notify"');
    expect(body).toContain('route="unmatched"');
    expect(body).toContain('status_class="2xx"');
    expect(body).toContain('status_class="4xx"');
    expect(body).toContain('service="test-service"');

    // Verify no label values contain '@' or a UUID
    expect(body).not.toContain('@');
    expect(body).not.toMatch(UUID_PATTERN);
  });

  it('registers custom counters, gauges, and histograms and executes onBeforeScrape', async () => {
    let scrapeCount = 0;
    let customGaugeRef: any = null;

    const metrics = createServiceMetrics({
      serviceName: 'custom-service',
      onBeforeScrape: async () => {
        scrapeCount += 1;
        customGaugeRef?.set(42);
      },
    });

    const counter = metrics.registerCounter({
      name: 'custom_events_total',
      help: 'Custom events',
      labelNames: ['type'] as const,
    });
    customGaugeRef = metrics.registerGauge({
      name: 'custom_depth',
      help: 'Custom depth',
    });
    const hist = metrics.registerHistogram({
      name: 'custom_duration_seconds',
      help: 'Custom duration',
    });

    counter.inc({ type: 'test' }, 3);
    hist.observe(0.12);

    const app = express();
    app.get('/metrics', metrics.metricsHandler);

    const res = await request(app).get('/metrics').expect(200);
    expect(scrapeCount).toBe(1);
    expect(res.text).toContain('custom_events_total{type="test",service="custom-service"} 3');
    expect(res.text).toContain('custom_depth{service="custom-service"} 42');
    expect(res.text).toContain('custom_duration_seconds_count{service="custom-service"} 1');
  });

  it('normalizes route patterns defensively even if a synthetic route contains an id or email', () => {
    const fakeReq: any = {
      baseUrl: '/api/users',
      route: { path: '/123e4567-e89b-12d3-a456-426614174000/alice@example.com/12345' },
    };
    const normalized = normalizeRoutePattern(fakeReq);
    expect(normalized).toBe('/api/users/:id/:email/:id');
    expect(normalized).not.toContain('@');
    expect(normalized).not.toMatch(UUID_PATTERN);
  });
});
