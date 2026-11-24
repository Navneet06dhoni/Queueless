import http from 'http';
import { createInternalClient, ServiceUnavailableError } from '../src/internalClient';

describe('createInternalClient with Circuit Breaker', () => {
  let server: http.Server;
  let serverPort: number;
  let requestCount = 0;
  let lastHeaders: http.IncomingHttpHeaders = {};
  let simulateDelayMs = 0;
  let simulateStatus = 200;
  let simulateBody: any = { ok: true };

  beforeEach(async () => {
    requestCount = 0;
    simulateDelayMs = 0;
    simulateStatus = 200;
    simulateBody = { ok: true };

    server = http.createServer(async (req, res) => {
      requestCount++;
      lastHeaders = req.headers;

      if (simulateDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, simulateDelayMs));
      }

      res.writeHead(simulateStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(simulateBody));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('propagates internal token and request ID', async () => {
    const client = createInternalClient({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      internalToken: 'test-secret-token',
    });

    const data = await client.get('/test', { requestId: 'req-12345' });
    expect(data).toEqual({ ok: true });
    expect(lastHeaders['x-internal-token']).toBe('test-secret-token');
    expect(lastHeaders['x-request-id']).toBe('req-12345');
    expect(client.getState()).toBe('CLOSED');
  });

  it('retries GET requests once upon 500 failure', async () => {
    simulateStatus = 500;
    simulateBody = { error: { message: 'Internal error' } };

    const client = createInternalClient({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      internalToken: 'token',
      timeoutMs: 1000,
      maxFailures: 5,
    });

    await expect(client.get('/fail')).rejects.toThrow();
    // 1 initial attempt + 1 retry = 2 attempts
    expect(requestCount).toBe(2);
  });

  it('does NOT retry POST requests upon failure', async () => {
    simulateStatus = 500;
    simulateBody = { error: { message: 'Internal error' } };

    const client = createInternalClient({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      internalToken: 'token',
      timeoutMs: 1000,
      maxFailures: 5,
    });

    await expect(client.post('/fail', { some: 'body' })).rejects.toThrow();
    // Only 1 attempt
    expect(requestCount).toBe(1);
  });

  it('times out after specified timeoutMs and throws ServiceUnavailableError', async () => {
    simulateDelayMs = 200;

    const client = createInternalClient({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      timeoutMs: 50,
      maxFailures: 5,
    });

    await expect(client.get('/slow')).rejects.toThrow(ServiceUnavailableError);
  });

  it('opens circuit breaker after 5 consecutive failures and rejects immediately', async () => {
    simulateStatus = 500;

    const client = createInternalClient({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      maxFailures: 5,
      openDurationMs: 100,
    });

    // Cause 5 failures with POST (1 attempt each)
    for (let i = 0; i < 5; i++) {
      await expect(client.post('/fail', {})).rejects.toThrow();
    }

    expect(client.getState()).toBe('OPEN');

    // Next call should be blocked immediately by circuit breaker without reaching server
    const countBefore = requestCount;
    await expect(client.post('/fail', {})).rejects.toThrow('Circuit breaker is open');
    expect(requestCount).toBe(countBefore);

    // Wait for openDurationMs to elapse -> HALF_OPEN
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(client.getState()).toBe('HALF_OPEN');

    // Server recovers
    simulateStatus = 200;
    simulateBody = { recovered: true };

    const res = await client.post('/recover', {});
    expect(res).toEqual({ recovered: true });
    expect(client.getState()).toBe('CLOSED');
  });
});
