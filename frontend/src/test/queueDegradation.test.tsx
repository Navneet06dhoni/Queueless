import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LiveQueuePage } from '../pages/LiveQueuePage';
import { BusinessQueueCard } from '../components/BusinessQueueCard';
import { GlobalQueueBanner } from '../components/GlobalQueueBanner';
import * as AuthContextModule from '../context/AuthContext';
import * as SocketContextModule from '../context/SocketContext';
import * as ToastModule from '../components/ui/Toast';
import { queueApi } from '../api';
import { resetQueueOutageToastThrottleForTesting } from '../utils/toastThrottle';

describe('Queue Service Outage Graceful Degradation (502 / 503)', () => {
  let queryClient: QueryClient;
  const mockToast = {
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    resetQueueOutageToastThrottleForTesting();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    });

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 'cust-123',
        name: 'Test Customer',
        email: 'cust@example.com',
        role: 'customer',
        created_at: new Date().toISOString(),
      },
      token: 'mock-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    } as any);

    vi.spyOn(SocketContextModule, 'useSocket').mockReturnValue({
      socket: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
        connected: false,
      },
      status: 'offline',
      isConnected: false,
    } as any);

    vi.spyOn(ToastModule, 'useToast').mockReturnValue(mockToast as any);
  });

  const renderWithProviders = (ui: React.ReactNode) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <ToastModule.ToastProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </ToastModule.ToastProvider>
      </QueryClientProvider>
    );
  };

  it('1. LiveQueuePage shows "The queue service is temporarily unavailable, retrying" on 502/503', async () => {
    const error502: any = new Error('Bad Gateway');
    error502.response = { status: 502, data: { error: { code: 'UPSTREAM_UNAVAILABLE' } } };
    vi.spyOn(queueApi, 'getMyActive').mockRejectedValue(error502);

    renderWithProviders(<LiveQueuePage />);

    await waitFor(() => {
      expect(screen.getByTestId('queue-outage-state')).toBeInTheDocument();
      expect(screen.getByText('The queue service is temporarily unavailable, retrying')).toBeInTheDocument();
    });
  });

  it('2. BusinessQueueCard disables the Join button with "The queue service is temporarily unavailable, retrying" on 502/503', async () => {
    const error503: any = new Error('Service Unavailable');
    error503.response = { status: 503, data: { error: { code: 'UPSTREAM_UNAVAILABLE' } } };
    vi.spyOn(queueApi, 'getPublicStatus').mockRejectedValue(error503);
    vi.spyOn(queueApi, 'getMyActive').mockResolvedValue(null as any);

    renderWithProviders(<BusinessQueueCard businessId="biz-1" />);

    await waitFor(() => {
      const joinBtn = screen.getByRole('button', { name: /The queue service is temporarily unavailable, retrying/i });
      expect(joinBtn).toBeInTheDocument();
      expect(joinBtn).toBeDisabled();
    });
  });

  it('3. GlobalQueueBanner hides itself when queue returns 502 or 503', async () => {
    const error502: any = new Error('Bad Gateway');
    error502.response = { status: 502, data: { error: { code: 'UPSTREAM_UNAVAILABLE' } } };
    vi.spyOn(queueApi, 'getMyActive').mockRejectedValue(error502);

    renderWithProviders(<GlobalQueueBanner />);

    // Wait for query to settle and assert banner is not rendered
    await waitFor(() => {
      expect(screen.queryByLabelText('Active queue status banner')).not.toBeInTheDocument();
    });
  });

  it('4. Throttles queue outage error toast to at most once per 60 seconds', async () => {
    const error502: any = new Error('Bad Gateway');
    error502.response = { status: 502, data: { error: { code: 'UPSTREAM_UNAVAILABLE' } } };
    vi.spyOn(queueApi, 'getMyActive').mockRejectedValue(error502);

    const { unmount } = renderWithProviders(<LiveQueuePage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledTimes(1);
      expect(mockToast.error).toHaveBeenCalledWith('The queue service is temporarily unavailable, retrying');
    });

    unmount();

    // Re-render within 60s should NOT produce a second toast
    renderWithProviders(<LiveQueuePage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledTimes(1);
    });
  });
});
