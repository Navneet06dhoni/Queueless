import { createApp } from '../src/app';
import { generateOpenApiSpec } from '../src/docs/openapi';
import { config } from '../src/config';

interface RouteEntry {
  method: string;
  path: string;
}

const normalizePath = (p: string): string => {
  return p
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .replace(/\{([^}]+)\}/g, ':$1')
    .toLowerCase() || '/';
};

const extractExpressRoutes = (app: any): RouteEntry[] => {
  const routes: RouteEntry[] = [];

  const processStack = (stack: any[], basePath: string = '') => {
    for (const layer of stack) {
      if (layer.route) {
        const routePath = layer.route.path;
        const fullPath = normalizePath(`${basePath}/${routePath}`);
        for (const method of Object.keys(layer.route.methods)) {
          if (layer.route.methods[method]) {
            routes.push({ method: method.toUpperCase(), path: fullPath });
          }
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        let mountPath = '';
        if (layer.regexp) {
          const src = layer.regexp.source;
          // Extract mounted prefix from express regex
          const cleaned = src
            .replace('^\\', '')
            .replace('\\/?(?=\\/|$)', '')
            .replace(/\\\//g, '/')
            .replace(/\^/g, '')
            .replace(/\$/g, '')
            .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, '')
            .replace(/\?\(\?=\\\/\|\$\)/g, '')
            .replace(/\\/g, '');
          mountPath = cleaned.endsWith('/') ? cleaned.slice(0, -1) : cleaned;
          if (mountPath === '/') mountPath = '';
        }
        processStack(layer.handle.stack, `${basePath}/${mountPath}`);
      }
    }
  };

  processStack(app._router.stack);
  return routes;
};

describe('OpenAPI Contract Test', () => {
  const app = createApp();
  const spec = generateOpenApiSpec();

  it('validates 100% bidirectional coverage between Express routes and OpenAPI documentation', () => {
    const rawExpressRoutes = extractExpressRoutes(app);

    // Routes that are internal framework infrastructure (not part of the business API surface)
    const ignoredRoutes = new Set([
      'GET /',
      'GET /api/openapi.json',
      'GET /api/docs',
      'GET /api/docs/*',
      'USE /api/docs',
      'GET /internal/debug/client-ip',
      'GET /metrics',
    ]);

    const expressRouteSet = new Set(
      rawExpressRoutes
        .map((r) => `${r.method} ${normalizePath(r.path)}`)
        .filter((r) => !ignoredRoutes.has(r))
    );

    // Extract paths from OpenAPI specification
    const openApiRouteSet = new Set<string>();
    for (const pathKey of Object.keys(spec.paths)) {
      const pathObj = (spec.paths as any)[pathKey];
      for (const method of Object.keys(pathObj)) {
        openApiRouteSet.add(`${method.toUpperCase()} ${normalizePath(pathKey)}`);
      }
    }

    // 1. Check for Express routes missing from OpenAPI
    const missingInOpenApi: string[] = [];
    for (const route of expressRouteSet) {
      if (!openApiRouteSet.has(route)) {
        missingInOpenApi.push(route);
      }
    }

    // 2. Check for documented OpenAPI routes missing from Express
    const notificationServiceRoutes = new Set([
      'GET /api/notifications',
      'POST /api/notifications/read-all',
      'PATCH /api/notifications/:id/read',
      'GET /api/admin/notifications',
    ]);

    const queueServiceRoutes = new Set([
      'GET /api/queue/me',
      'GET /api/queue/:businessid/status',
      'GET /api/queue/:businessid/position',
      'POST /api/queue/:businessid/join',
      'POST /api/queue/:businessid/check-in',
      'POST /api/queue/:businessid/leave',
      'POST /api/queue/:businessid/next',
      'POST /api/queue/:businessid/complete',
      'POST /api/queue/:businessid/skip',
      'POST /api/queue/:businessid/walk-in',
      'PATCH /api/queue/:businessid/open',
      'GET /api/queue/:businessid',
    ]);

    const missingInExpress: string[] = [];
    for (const route of openApiRouteSet) {
      if (!expressRouteSet.has(route)) {
        if (config.NOTIFICATIONS_MODE === 'service' && notificationServiceRoutes.has(route)) {
          // Handled by services/notification-service in service mode
          continue;
        }
        if (config.QUEUE_MODE === 'service' && queueServiceRoutes.has(route)) {
          // Handled by services/queue-service in service mode
          continue;
        }
        missingInExpress.push(route);
      }
    }

    if (missingInOpenApi.length > 0 || missingInExpress.length > 0) {
      const message = [
        'OpenAPI Spec does not match registered Express routes!',
        missingInOpenApi.length > 0
          ? `Missing in OpenAPI Spec:\n  ${missingInOpenApi.join('\n  ')}`
          : null,
        missingInExpress.length > 0
          ? `Documented in OpenAPI but not in Express:\n  ${missingInExpress.join('\n  ')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n\n');

      throw new Error(message);
    }

    expect(missingInOpenApi).toHaveLength(0);
    expect(missingInExpress).toHaveLength(0);
  });
});
