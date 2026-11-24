import { createInternalClient, InternalClient, ApiError, logger } from '@queueless/common';
import { config } from '../config';
import { redis } from '../redis';

export interface BusinessQueueInfo {
  id: string;
  name: string;
  ownerId: string;
  status: string;
  queue_open?: boolean;
  workingHoursToday: {
    openTime: string;
    closeTime: string;
    isOpenToday: boolean;
  } | null;
}

export interface AppointmentCheckInInfo {
  id: string;
  customerId: string;
  businessId: string;
  status: string;
  slotStartTime: string;
}

export interface AuthVerifyResult {
  userId: string;
  role: string;
  name: string;
}

export class CoreClient {
  private client: InternalClient;

  constructor(client?: InternalClient) {
    this.client =
      client ||
      createInternalClient({
        baseUrl: config.CORE_SERVICE_URL,
        internalToken: config.INTERNAL_TOKEN,
        timeoutMs: 2000,
      });
  }

  /**
   * Fetch business info with 60s fresh Redis cache and up to 10m stale-if-error
   */
  async getBusinessQueueInfo(businessId: string): Promise<BusinessQueueInfo> {
    const cacheKey = `cache:core:biz:${businessId}`;
    let cachedJson: string | null = null;

    try {
      cachedJson = await redis.get(cacheKey);
    } catch {
      cachedJson = null;
    }

    if (cachedJson) {
      try {
        const parsed = JSON.parse(cachedJson);
        const ageMs = Date.now() - (parsed.cachedAt || 0);

        // If fresh (< 60s), return immediately
        if (ageMs < 60 * 1000) {
          return parsed.data;
        }

        // Stale (between 60s and 10m): try to refresh from core
        try {
          const fresh = await this.client.get<BusinessQueueInfo>(
            `/internal/businesses/${encodeURIComponent(businessId)}/queue-info`
          );
          await redis.set(
            cacheKey,
            JSON.stringify({ data: fresh, cachedAt: Date.now() }),
            'EX',
            600
          );
          return fresh;
        } catch (fetchErr: any) {
          if (fetchErr.statusCode === 404) {
            throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
          }
          // If within 10 minutes, serve stale copy
          if (ageMs < 600 * 1000) {
            logger.warn(
              { businessId, ageMs, err: fetchErr.message },
              '[CoreClient] Core unavailable; serving stale cached business queue info'
            );
            return parsed.data;
          }
        }
      } catch (e: any) {
        if (e instanceof ApiError) throw e;
      }
    }

    // No cache or stale beyond 10m: fetch directly
    try {
      const fresh = await this.client.get<BusinessQueueInfo>(
        `/internal/businesses/${encodeURIComponent(businessId)}/queue-info`
      );
      try {
        await redis.set(
          cacheKey,
          JSON.stringify({ data: fresh, cachedAt: Date.now() }),
          'EX',
          600
        );
      } catch {}
      return fresh;
    } catch (err: any) {
      if (err.statusCode === 404) {
        throw ApiError.notFound('Business not found', 'BUSINESS_NOT_FOUND');
      }
      throw ApiError.serviceUnavailable(
        'Upstream core service unavailable',
        'UPSTREAM_UNAVAILABLE'
      );
    }
  }

  /**
   * Fetch appointment check-in info directly from core
   */
  async getAppointmentCheckInInfo(appointmentId: string): Promise<AppointmentCheckInInfo> {
    try {
      return await this.client.get<AppointmentCheckInInfo>(
        `/internal/appointments/${encodeURIComponent(appointmentId)}/check-in-info`
      );
    } catch (err: any) {
      if (err.statusCode === 404) {
        throw ApiError.notFound('Appointment not found', 'APPOINTMENT_NOT_FOUND');
      }
      throw ApiError.serviceUnavailable(
        'Upstream core service unavailable',
        'UPSTREAM_UNAVAILABLE'
      );
    }
  }

  /**
   * Verify token for socket handshake via POST /internal/auth/verify-token
   */
  async verifyToken(token: string): Promise<AuthVerifyResult> {
    try {
      return await this.client.post<AuthVerifyResult>('/internal/auth/verify-token', { token });
    } catch (err: any) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        throw ApiError.unauthorized('Invalid or expired authentication token', 'UNAUTHORIZED');
      }
      throw ApiError.serviceUnavailable(
        'Upstream auth service unavailable',
        'UPSTREAM_UNAVAILABLE'
      );
    }
  }
}

export const coreClient = new CoreClient();
