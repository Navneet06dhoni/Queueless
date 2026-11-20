import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { api, setAccessToken, setLogoutHandler, getAccessToken } from '../api/client';

describe('Axios Interceptor & Single-Flight Refresh', () => {
  let refreshCallCount = 0;
  let _testEndpointCalls = 0;
  let shouldRefreshSucceed = true;

  const server = setupServer(
    http.post('/api/auth/refresh', () => {
      refreshCallCount++;
      if (shouldRefreshSucceed) {
        return HttpResponse.json({
          user: { id: 'u1', name: 'User', email: 'u@test.com', role: 'customer', created_at: '' },
          accessToken: 'new-refreshed-token',
        });
      }
      return new HttpResponse(
        JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Session expired' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }),

    http.get('/api/protected-data', ({ request }) => {
      _testEndpointCalls++;
      const auth = request.headers.get('authorization');
      if (auth === 'Bearer new-refreshed-token') {
        return HttpResponse.json({ success: true });
      }
      return new HttpResponse(
        JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Token expired' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    })
  );

  beforeEach(() => {
    server.listen();
    refreshCallCount = 0;
    _testEndpointCalls = 0;
    shouldRefreshSucceed = true;
    setAccessToken('initial-expired-token');
  });

  afterEach(() => {
    server.close();
    setAccessToken(null);
  });

  it('when 5 requests fail with 401 at the same time, /auth/refresh is called exactly once and all 5 requests are retried', async () => {
    // Fire 5 simultaneous requests
    const promises = [
      api.get('/protected-data'),
      api.get('/protected-data'),
      api.get('/protected-data'),
      api.get('/protected-data'),
      api.get('/protected-data'),
    ];

    const results = await Promise.all(promises);

    // Refresh endpoint was called exactly once (single-flight promise)
    expect(refreshCallCount).toBe(1);

    // All 5 requests succeeded after retry
    expect(results).toHaveLength(5);
    results.forEach((res) => {
      expect(res.data.success).toBe(true);
    });

    // New token is stored in memory
    expect(getAccessToken()).toBe('new-refreshed-token');
  });

  it('a failed refresh logs the user out', async () => {
    shouldRefreshSucceed = false;
    const logoutSpy = vi.fn();
    setLogoutHandler(logoutSpy);

    await expect(api.get('/protected-data')).rejects.toThrow();

    // Refresh was called
    expect(refreshCallCount).toBe(1);

    // Logout callback triggered
    expect(logoutSpy).toHaveBeenCalledTimes(1);

    // In-memory token was cleared
    expect(getAccessToken()).toBeNull();
  });
});
