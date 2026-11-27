import { Request, Response, NextFunction, RequestHandler } from 'express';
import * as promClient from 'prom-client';

export { promClient };

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_REGEX = /[^\s/]+@[^\s/]+/g;
const NUMERIC_SEGMENT_REGEX = /\/\d+(?=\/|$)/g;

/**
 * Extracts a low-cardinality Express route pattern (e.g. `/api/businesses/:id`).
 * Never returns raw URLs, UUIDs, numeric IDs, or email addresses.
 */
export function normalizeRoutePattern(req: Request): string {
  if (!req.route || !req.route.path) {
    return 'unmatched';
  }

  const base = req.baseUrl || '';
  const routePath = typeof req.route.path === 'string' ? req.route.path : String(req.route.path);
  let pattern = `${base}${routePath === '/' ? '' : routePath}` || '/';

  // Normalize multiple slashes and trailing slash (except root '/')
  pattern = pattern.replace(/\/+/g, '/');
  if (pattern.length > 1 && pattern.endsWith('/')) {
    pattern = pattern.slice(0, -1);
  }

  // Defensive sanitization: ensure no IDs or emails ever leak into route labels
  pattern = pattern
    .replace(UUID_REGEX, ':id')
    .replace(EMAIL_REGEX, ':email')
    .replace(NUMERIC_SEGMENT_REGEX, '/:id');

  return pattern || '/';
}

export function getStatusClass(statusCode: number): string {
  const cls = Math.floor(statusCode / 100);
  if (cls >= 1 && cls <= 5) {
    return `${cls}xx`;
  }
  return 'unknown';
}

export interface ServiceMetricsOptions {
  serviceName: string;
  onBeforeScrape?: () => Promise<void> | void;
  collectDefault?: boolean;
}

export interface ServiceMetrics {
  registry: promClient.Registry;
  httpRequestsTotal: promClient.Counter<'method' | 'route' | 'status_class' | 'service'>;
  httpRequestDurationSeconds: promClient.Histogram<'method' | 'route' | 'status_class' | 'service'>;
  httpInFlightRequests: promClient.Gauge<'service'>;
  metricsMiddleware: RequestHandler;
  metricsHandler: RequestHandler;
  registerCounter: <T extends string = string>(
    config: Omit<promClient.CounterConfiguration<T>, 'registers'>
  ) => promClient.Counter<T>;
  registerGauge: <T extends string = string>(
    config: Omit<promClient.GaugeConfiguration<T>, 'registers'>
  ) => promClient.Gauge<T>;
  registerHistogram: <T extends string = string>(
    config: Omit<promClient.HistogramConfiguration<T>, 'registers'>
  ) => promClient.Histogram<T>;
}

export function createServiceMetrics(options: ServiceMetricsOptions): ServiceMetrics {
  const { serviceName, onBeforeScrape, collectDefault = true } = options;
  const registry = new promClient.Registry();
  registry.setDefaultLabels({ service: serviceName });

  if (collectDefault) {
    promClient.collectDefaultMetrics({ register: registry });
  }

  const httpRequestsTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_class', 'service'] as const,
    registers: [registry],
  });

  const httpRequestDurationSeconds = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_class', 'service'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const httpInFlightRequests = new promClient.Gauge({
    name: 'http_in_flight_requests',
    help: 'Number of HTTP requests currently in flight',
    labelNames: ['service'] as const,
    registers: [registry],
  });

  const metricsMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/metrics') {
      return next();
    }

    const startNs = process.hrtime.bigint();
    let decremented = false;
    httpInFlightRequests.inc({ service: serviceName });

    const decrementOnce = () => {
      if (!decremented) {
        decremented = true;
        httpInFlightRequests.dec({ service: serviceName });
      }
    };

    res.on('finish', () => {
      decrementOnce();
      const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
      const route = normalizeRoutePattern(req);
      const statusClass = getStatusClass(res.statusCode);
      const labels = {
        method: req.method.toUpperCase(),
        route,
        status_class: statusClass,
        service: serviceName,
      };
      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationSeconds);
    });

    res.on('close', () => {
      decrementOnce();
    });

    next();
  };

  const metricsHandler: RequestHandler = async (_req: Request, res: Response) => {
    if (onBeforeScrape) {
      try {
        await onBeforeScrape();
      } catch {
        // Never fail the /metrics scrape if an optional gauge refresh fails
      }
    }
    res.setHeader('Content-Type', registry.contentType);
    res.status(200).send(await registry.metrics());
  };

  const registerCounter = <T extends string = string>(
    config: Omit<promClient.CounterConfiguration<T>, 'registers'>
  ) => {
    return new promClient.Counter<T>({
      ...config,
      registers: [registry],
    });
  };

  const registerGauge = <T extends string = string>(
    config: Omit<promClient.GaugeConfiguration<T>, 'registers'>
  ) => {
    return new promClient.Gauge<T>({
      ...config,
      registers: [registry],
    });
  };

  const registerHistogram = <T extends string = string>(
    config: Omit<promClient.HistogramConfiguration<T>, 'registers'>
  ) => {
    return new promClient.Histogram<T>({
      ...config,
      registers: [registry],
    });
  };

  return {
    registry,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    httpInFlightRequests,
    metricsMiddleware,
    metricsHandler,
    registerCounter,
    registerGauge,
    registerHistogram,
  };
}
