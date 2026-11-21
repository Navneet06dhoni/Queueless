import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';

// Pages to audit
import { LandingPage } from '../pages/LandingPage';
import { LoginPage } from '../pages/LoginPage';
import { BusinessSearchPage } from '../pages/BusinessSearchPage';
import { BusinessDetailPage } from '../pages/BusinessDetailPage';
import { LiveQueuePage } from '../pages/LiveQueuePage';
import { OwnerDashboardPage } from '../pages/owner/OwnerDashboardPage';
import { AdminOverviewTab } from '../pages/admin/tabs/AdminOverviewTab';

import { ToastProvider } from '../components/ui/Toast';
import * as AuthContextModule from '../context/AuthContext';
import * as SocketContextModule from '../context/SocketContext';
import { businessApi, queueApi, analyticsApi, adminApi } from '../api';

// Mock Recharts for JSDOM
vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  };
});

describe('Step 8c Axe Accessibility Audits (Zero Serious/Critical Violations)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });

    vi.spyOn(SocketContextModule, 'useSocket').mockReturnValue({
      socket: null,
      isConnected: false,
    } as any);

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'user-1', name: 'Test User', email: 'test@example.com', role: 'owner', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });
  });

  const renderWithProviders = (ui: React.ReactNode) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
  };

  it('1. LandingPage has no serious or critical accessibility violations', async () => {
    const { container } = renderWithProviders(<LandingPage />);
    const results = await axe(container);
    const criticals = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(criticals).toEqual([]);
  });

  it('2. LoginPage has no serious or critical accessibility violations', async () => {
    const { container } = renderWithProviders(<LoginPage />);
    const results = await axe(container);
    const criticals = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(criticals).toEqual([]);
  });

  it('3. BusinessSearchPage has no serious or critical accessibility violations', async () => {
    vi.spyOn(businessApi, 'getApprovedBusinesses').mockResolvedValue({
      data: [
        {
          id: 'biz-1',
          owner_id: 'owner-1',
          name: 'City Care Hospital',
          category: 'Medical Clinic',
          address: '100 Road',
          city: 'Bangalore',
          phone: '9876543210',
          status: 'approved',
          created_at: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
    });

    const { container } = renderWithProviders(<BusinessSearchPage />);
    const results = await axe(container);
    const criticals = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(criticals).toEqual([]);
  });

  it('4. BusinessDetailPage has no serious or critical accessibility violations', async () => {
    vi.spyOn(businessApi, 'getBusinessDetail').mockResolvedValue({
      id: 'biz-1',
      owner_id: 'owner-1',
      name: 'City Care Hospital',
      category: 'Medical Clinic',
      address: '100 Road',
      city: 'Bangalore',
      phone: '9876543210',
      status: 'approved',
      created_at: new Date().toISOString(),
      working_hours: [
        { day_of_week: 1, open_time: '09:00', close_time: '18:00' },
      ],
      services: [
        {
          id: 'srv-1',
          business_id: 'biz-1',
          name: 'Consultation',
          duration_minutes: 30,
          price: 500,
          created_at: new Date().toISOString(),
        },
      ],
    });
    vi.spyOn(businessApi, 'getSlots').mockResolvedValue([]);
    vi.spyOn(queueApi, 'getPublicStatus').mockResolvedValue({
      businessId: 'biz-1',
      isOpen: true,
      waitingCount: 2,
      nowServing: 1,
      estimatedWaitMinutesForNewJoiner: 15,
    });

    const { container } = renderWithProviders(<BusinessDetailPage />);
    const results = await axe(container);
    const criticals = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(criticals).toEqual([]);
  });

  it('5. LiveQueuePage has no serious or critical accessibility violations', async () => {
    vi.spyOn(queueApi, 'getMyActive').mockResolvedValue({
      businessId: 'biz-1',
      businessName: 'Apollo Care',
      ticketNumber: 42,
      position: 2,
      peopleAhead: 1,
      estimatedWaitMinutes: 10,
      status: 'waiting',
    });

    const { container } = renderWithProviders(<LiveQueuePage />);
    const results = await axe(container);
    const criticals = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(criticals).toEqual([]);
  });

  it('6. OwnerDashboardPage has no serious or critical accessibility violations', async () => {
    vi.spyOn(businessApi, 'getOwnerBusinesses').mockResolvedValue([
      {
        id: 'biz-1',
        owner_id: 'user-1',
        name: 'Apollo Care',
        category: 'Medical Clinic',
        address: '100 Road',
        city: 'Bangalore',
        phone: '9876543210',
        status: 'approved',
        created_at: new Date().toISOString(),
      },
    ]);
    vi.spyOn(queueApi, 'getOwnerQueue').mockResolvedValue({
      current: null,
      waiting: [],
      waitingCount: 0,
      servedToday: 4,
      skippedToday: 0,
    });
    vi.spyOn(queueApi, 'getPublicStatus').mockResolvedValue({
      businessId: 'biz-1',
      isOpen: true,
      waitingCount: 0,
      nowServing: null,
      estimatedWaitMinutesForNewJoiner: 0,
    });
    vi.spyOn(analyticsApi, 'getToday').mockResolvedValue({
      averageWaitMinutesToday: 10,
      todayTotalServed: 4,
      todayWalkInCount: 1,
      todayAppointmentCount: 3,
      nextAppointments: [],
    } as any);

    const { container } = renderWithProviders(<OwnerDashboardPage />);
    const results = await axe(container);
    const criticals = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(criticals).toEqual([]);
  });

  it('7. AdminOverviewTab has no serious or critical accessibility violations', async () => {
    vi.spyOn(adminApi, 'getStats').mockResolvedValue({
      users: { customer: 40, owner: 10, admin: 2, total: 52 },
      businesses: { pending: 2, approved: 8, rejected: 1, total: 11 },
      appointments: { confirmed: 15, completed: 50, no_show: 3, cancelled: 4, total30Days: 72 },
      queueServed30Days: 130,
      failedEmails: 0,
      daily: [
        { date: '2026-11-20', newUsers: 5, newAppointments: 8 },
        { date: '2026-11-21', newUsers: 3, newAppointments: 6 },
      ],
    });

    const { container } = renderWithProviders(<AdminOverviewTab />);
    const results = await axe(container);
    const criticals = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(criticals).toEqual([]);
  });
});
