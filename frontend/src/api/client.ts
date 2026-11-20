import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { AuthResponse } from './types';

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
let logoutHandler: (() => void) | null = null;

export const getAccessToken = (): string | null => accessToken;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const setLogoutHandler = (handler: () => void): void => {
  logoutHandler = handler;
};

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor: Attach in-memory access token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (accessToken && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Single-flight 401 refresh & retry
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // If no config or already retried or was an auth endpoint (prevent infinite loops)
    if (
      !originalRequest ||
      originalRequest._retry ||
      originalRequest.url?.includes('/auth/refresh') ||
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/register')
    ) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401) {
      originalRequest._retry = true;

      if (!refreshPromise) {
        refreshPromise = axios
          .post<AuthResponse>('/api/auth/refresh', {}, { withCredentials: true })
          .then((res) => {
            const newToken = res.data.accessToken;
            setAccessToken(newToken);
            return newToken;
          })
          .catch((refreshErr) => {
            setAccessToken(null);
            if (logoutHandler) {
              logoutHandler();
            }
            throw refreshErr;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }

      try {
        const newToken = await refreshPromise;
        if (newToken) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
