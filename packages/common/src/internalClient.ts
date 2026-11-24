import { ApiError } from './ApiError';

export interface InternalClientOptions {
  baseUrl: string;
  internalToken?: string;
  timeoutMs?: number; // default 2000
  maxFailures?: number; // default 5
  openDurationMs?: number; // default 10000
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service Unavailable', code = 'UPSTREAM_UNAVAILABLE', details?: any) {
    super(503, code, message, details);
    this.name = 'ServiceUnavailableError';
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  requestId?: string;
  signal?: AbortSignal;
}

export interface InternalClient {
  get<T = any>(path: string, options?: RequestOptions): Promise<T>;
  post<T = any>(path: string, body?: any, options?: RequestOptions): Promise<T>;
  put<T = any>(path: string, body?: any, options?: RequestOptions): Promise<T>;
  delete<T = any>(path: string, options?: RequestOptions): Promise<T>;
  getState(): CircuitBreakerState;
  reset(): void;
}

export class CircuitBreakerInternalClient implements InternalClient {
  private baseUrl: string;
  private internalToken?: string;
  private timeoutMs: number;
  private maxFailures: number;
  private openDurationMs: number;

  private state: CircuitBreakerState = 'CLOSED';
  private failureCount: number = 0;
  private nextAttemptTime: number = 0;

  constructor(options: InternalClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalToken = options.internalToken;
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.maxFailures = options.maxFailures ?? 5;
    this.openDurationMs = options.openDurationMs ?? 10000;
  }

  getState(): CircuitBreakerState {
    if (this.state === 'OPEN' && Date.now() >= this.nextAttemptTime) {
      return 'HALF_OPEN';
    }
    return this.state;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.nextAttemptTime = 0;
  }

  private recordSuccess(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
  }

  private recordFailure(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.openDurationMs;
    } else if (this.state === 'CLOSED') {
      this.failureCount++;
      if (this.failureCount >= this.maxFailures) {
        this.state = 'OPEN';
        this.nextAttemptTime = Date.now() + this.openDurationMs;
      }
    }
  }

  private async executeWithBreaker<T>(
    method: string,
    path: string,
    body?: any,
    options?: RequestOptions
  ): Promise<T> {
    const currentState = this.getState();
    if (currentState === 'OPEN') {
      throw new ServiceUnavailableError('Circuit breaker is open', 'CIRCUIT_BREAKER_OPEN');
    }
    if (currentState === 'HALF_OPEN') {
      this.state = 'HALF_OPEN';
    }

    const isGet = method.toUpperCase() === 'GET';
    const maxAttempts = isGet ? 2 : 1;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.doFetch<T>(method, path, body, options);
        this.recordSuccess();
        return result;
      } catch (err: any) {
        lastError = err;
        // Only retry if it is GET and this is the first attempt
        if (isGet && attempt < maxAttempts) {
          continue;
        }
      }
    }

    // Record failure on circuit breaker
    this.recordFailure();

    if (lastError instanceof ApiError) {
      throw lastError;
    }
    throw new ServiceUnavailableError(
      lastError?.message || 'Upstream service unavailable',
      'UPSTREAM_UNAVAILABLE',
      { originalError: lastError?.message }
    );
  }

  private async doFetch<T>(
    method: string,
    path: string,
    body?: any,
    options?: RequestOptions
  ): Promise<T> {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseUrl}${cleanPath}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options?.headers || {}),
    };

    if (this.internalToken) {
      headers['X-Internal-Token'] = this.internalToken;
    }
    if (options?.requestId) {
      headers['X-Request-Id'] = options.requestId;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${this.timeoutMs}ms`));
    }, this.timeoutMs);

    let abortHandler: (() => void) | undefined;
    if (options?.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeoutId);
        throw options.signal.reason;
      }
      abortHandler = () => controller.abort(options.signal?.reason);
      options.signal.addEventListener('abort', abortHandler);
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errJson: any;
        try {
          errJson = await response.json();
        } catch {
          // non-JSON response
        }

        const msg = errJson?.error?.message || response.statusText || 'Request failed';
        const code = errJson?.error?.code || `HTTP_${response.status}`;

        if (response.status >= 500) {
          throw new ServiceUnavailableError(msg, code, errJson);
        }
        throw new ApiError(response.status, code, msg, errJson);
      }

      return (await response.json()) as T;
    } catch (err: any) {
      if (controller.signal.aborted && !options?.signal?.aborted) {
        throw new ServiceUnavailableError(`Request timed out after ${this.timeoutMs}ms`, 'TIMEOUT');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (options?.signal && abortHandler) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  async get<T = any>(path: string, options?: RequestOptions): Promise<T> {
    return this.executeWithBreaker<T>('GET', path, undefined, options);
  }

  async post<T = any>(path: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.executeWithBreaker<T>('POST', path, body, options);
  }

  async put<T = any>(path: string, body?: any, options?: RequestOptions): Promise<T> {
    return this.executeWithBreaker<T>('PUT', path, body, options);
  }

  async delete<T = any>(path: string, options?: RequestOptions): Promise<T> {
    return this.executeWithBreaker<T>('DELETE', path, undefined, options);
  }
}

export function createInternalClient(options: InternalClientOptions): InternalClient {
  return new CircuitBreakerInternalClient(options);
}
