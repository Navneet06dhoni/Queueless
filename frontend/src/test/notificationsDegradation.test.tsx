import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { NotificationsPage } from '../pages/NotificationsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as SocketContextModule from '../context/SocketContext';
import * as ToastModule from '../components/ui/Toast';
import { notificationApi } from '../api';

describe('Notifications Service Graceful Degradation', () => {
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
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    });

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 'usr-1',
        name: 'Test Customer',
        email: 'customer@test.com',
        role: 'customer',
        createdAt: new Date().toISOString(),
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
      },
      isConnected: true,
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

  it('Navbar gracefully displays unavailable message on 502 without crashing', async () => {
    const error502: any = new Error('Bad Gateway');
    error502.response = { status: 502 };
    vi.spyOn(notificationApi, 'getNotifications').mockRejectedValue(error502);

    renderWithProviders(<Navbar />);

    // Click notifications bell
    const bellBtn = screen.getByRole('button', { name: /open notifications/i });
    fireEvent.click(bellBtn);

    // Wait for the dropdown message
    await waitFor(() => {
      expect(screen.getByTestId('notifications-unavailable')).toBeInTheDocument();
      expect(screen.getByText('Notifications are temporarily unavailable')).toBeInTheDocument();
    });

    // Verify unread badge is not shown
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
  });

  it('Throttles error toast to at most once per 60 seconds despite repeated renders/errors', async () => {
    const error503: any = new Error('Service Unavailable');
    error503.response = { status: 503 };
    vi.spyOn(notificationApi, 'getNotifications').mockRejectedValue(error503);

    const { rerender } = renderWithProviders(<Navbar />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledTimes(1);
      expect(mockToast.error).toHaveBeenCalledWith('Notifications are temporarily unavailable');
    });

    // Re-render multiple times
    rerender(
      <QueryClientProvider client={queryClient}>
        <ToastModule.ToastProvider>
          <MemoryRouter>
            <Navbar />
          </MemoryRouter>
        </ToastModule.ToastProvider>
      </QueryClientProvider>
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <ToastModule.ToastProvider>
          <MemoryRouter>
            <Navbar />
          </MemoryRouter>
        </ToastModule.ToastProvider>
      </QueryClientProvider>
    );

    // Still only called once within the 60s cooldown
    expect(mockToast.error).toHaveBeenCalledTimes(1);
  });

  it('NotificationsPage displays fallback state when 502/503 returned', async () => {
    const error502: any = new Error('Bad Gateway');
    error502.response = { status: 502 };
    vi.spyOn(notificationApi, 'getNotifications').mockRejectedValue(error502);

    renderWithProviders(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getByText('Notifications are temporarily unavailable')).toBeInTheDocument();
      expect(
        screen.getByText(/We are currently experiencing issues with our notification service/i)
      ).toBeInTheDocument();
    });
  });
});
