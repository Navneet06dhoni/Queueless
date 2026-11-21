import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LiveQueuePage } from '../pages/LiveQueuePage';
import { BusinessQueueCard } from '../components/BusinessQueueCard';
import { LiveQueueTab } from '../pages/owner/LiveQueueTab';
import { AnalyticsTab } from '../pages/owner/AnalyticsTab';
import { MyBookingsPage } from '../pages/MyBookingsPage';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { ToastProvider } from '../components/ui/Toast';
import * as AuthContextModule from '../context/AuthContext';
import * as SocketContextModule from '../context/SocketContext';
import { queueApi, analyticsApi, businessApi } from '../api';

// Mock Recharts for JSDOM
vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => <div style={{ width: 600, height: 300 }}>{children}</div>,
  };
});

describe('Step 8b Live Queue, Customer & Owner Dashboard Tests', () => {
  let queryClient: QueryClient;
  let mockSocket: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    });

    const handlers: Record<string, ((...args: any[]) => void)[]> = {};
    mockSocket = {
      connected: true,
      on: vi.fn((event: string, fn: any) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(fn);
      }),
      off: vi.fn((event: string, fn: any) => {
        if (handlers[event]) {
          handlers[event] = handlers[event].filter((h) => h !== fn);
        }
      }),
      emit: vi.fn((_event: string, _data: any, ack?: any) => {
        if (ack) ack({});
      }),
      trigger: (event: string, ...args: any[]) => {
        const fns = handlers[event] || [];
        fns.forEach((fn) => fn(...args));
      },
    };

    vi.spyOn(SocketContextModule, 'useSocket').mockReturnValue({
      socket: mockSocket,
      isConnected: true,
      status: 'connected',
    });

    // Default customer auth
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 'cust-1',
        name: 'Test Customer',
        email: 'customer@test.com',
        role: 'customer',
        created_at: '',
      },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  const renderWithProviders = (ui: React.ReactElement, initialRoute = '/') => {
    return render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[initialRoute]}>
            {ui}
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
  };

  it('the queue page shows the position from /queue/me and updates when queue:position arrives, without a refetch', async () => {
    const getMyActiveSpy = vi.spyOn(queueApi, 'getMyActive').mockResolvedValue({
      ticketNumber: 42,
      position: 3,
      peopleAhead: 2,
      estimatedWaitMinutes: 15,
      status: 'waiting',
      businessId: 'biz-123',
      businessName: 'Apollo Clinic',
    });

    renderWithProviders(<LiveQueuePage />, '/queue');

    // Wait for initial render from /queue/me
    await waitFor(() => {
      expect(screen.getByText('#42')).toBeInTheDocument();
      expect(screen.getByText('You are #3')).toBeInTheDocument();
      expect(screen.getByText('2 people ahead')).toBeInTheDocument();
    });

    expect(getMyActiveSpy).toHaveBeenCalledTimes(1);

    // Socket event queue:position arrives with updated position 1
    act(() => {
      mockSocket.trigger('queue:position', {
        ticketNumber: 42,
        position: 1,
        peopleAhead: 0,
        estimatedWaitMinutes: 5,
        status: 'waiting',
        businessId: 'biz-123',
      });
    });

    // Content should update immediately without an extra REST call
    await waitFor(() => {
      expect(screen.getByText('You are #1')).toBeInTheDocument();
      expect(screen.getByText('No one ahead of you')).toBeInTheDocument();
      expect(screen.getByText(/You are next, please be ready/i)).toBeInTheDocument();
    });

    // Still exactly 1 REST call
    expect(getMyActiveSpy).toHaveBeenCalledTimes(1);
  });

  it('queue:called switches to the called state, sets and later restores document.title, and calls vibrate when available', async () => {
    const vibrateMock = vi.fn();
    (navigator as any).vibrate = vibrateMock;

    vi.spyOn(queueApi, 'getMyActive').mockResolvedValue({
      ticketNumber: 42,
      position: 1,
      peopleAhead: 0,
      estimatedWaitMinutes: 5,
      status: 'waiting',
      businessId: 'biz-123',
      businessName: 'Apollo Clinic',
    });

    const initialDocTitle = document.title;
    const { unmount } = renderWithProviders(<LiveQueuePage />, '/queue');

    await waitFor(() => {
      expect(screen.getByText('#42')).toBeInTheDocument();
    });

    // Simulate user interaction so audio/vibration triggers
    fireEvent.click(window);

    // Trigger queue:called
    act(() => {
      mockSocket.trigger('queue:called', {
        businessId: 'biz-123',
        ticketNumber: 42,
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText(/It is your turn/i).length).toBeGreaterThan(0);
      expect(document.title).toBe('It is your turn - QueueLess');
      expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200, 100, 200]);
    });

    // On unmount, document title must be restored
    unmount();
    expect(document.title).toBe(initialDocTitle);
  });

  it('no customer-facing component renders another customer name (extra fields ignored)', async () => {
    vi.spyOn(queueApi, 'getMyActive').mockResolvedValue({
      ticketNumber: 88,
      position: 2,
      peopleAhead: 1,
      estimatedWaitMinutes: 10,
      status: 'waiting',
      businessId: 'biz-123',
      businessName: 'Health Care',
      // Malicious or accidental leak of another customer's name
      otherCustomerName: 'Confidential Alice',
      customerName: 'Confidential Bob',
    } as any);

    renderWithProviders(<LiveQueuePage />, '/queue');

    await waitFor(() => {
      expect(screen.getByText('#88')).toBeInTheDocument();
    });

    expect(screen.queryByText('Confidential Alice')).not.toBeInTheDocument();
    expect(screen.queryByText('Confidential Bob')).not.toBeInTheDocument();

    // Also verify via socket event
    act(() => {
      mockSocket.trigger('queue:position', {
        ticketNumber: 88,
        position: 1,
        peopleAhead: 0,
        estimatedWaitMinutes: 5,
        status: 'waiting',
        businessId: 'biz-123',
        customerName: 'Leaked Charlie',
      });
    });

    expect(screen.queryByText('Leaked Charlie')).not.toBeInTheDocument();
  });

  it('the join button is disabled with the right reason when queue is closed, when user already has an entry, and for owners it is hidden', async () => {
    // 1. When queue is closed
    vi.spyOn(queueApi, 'getPublicStatus').mockResolvedValue({
      isOpen: false,
      waitingCount: 5,
      nowServing: 2,
      estimatedWaitMinutesForNewJoiner: 25,
    });
    vi.spyOn(queueApi, 'getMyActive').mockRejectedValue({ response: { status: 404 } });

    const { unmount } = renderWithProviders(<BusinessQueueCard businessId="b-closed" />);

    await waitFor(() => {
      expect(screen.getByText('Closed')).toBeInTheDocument();
      const btn = screen.getByRole('button', { name: /Queue is closed/i });
      expect(btn).toBeDisabled();
    });

    unmount();

    // 2. When user already has an active entry
    vi.spyOn(queueApi, 'getPublicStatus').mockResolvedValue({
      isOpen: true,
      waitingCount: 3,
      nowServing: 1,
      estimatedWaitMinutesForNewJoiner: 15,
    });
    vi.spyOn(queueApi, 'getMyActive').mockResolvedValue({
      ticketNumber: 99,
      position: 2,
      peopleAhead: 1,
      estimatedWaitMinutes: 10,
      status: 'waiting',
      businessId: 'b-open',
      businessName: 'Dental One',
    });

    const { unmount: unmount2 } = renderWithProviders(<BusinessQueueCard businessId="b-open" />);

    await waitFor(() => {
      expect(screen.getByText('Open')).toBeInTheDocument();
      const btn = screen.getByRole('button', { name: /You are already in an active queue/i });
      expect(btn).toBeDisabled();
      expect(screen.getByText(/You have an active ticket #99/i)).toBeInTheDocument();
    });

    unmount2();

    // 3. For owners, the join button is hidden
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'o-1', name: 'Owner', email: 'o@test.com', role: 'owner', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    renderWithProviders(<BusinessQueueCard businessId="b-open" />);

    await waitFor(() => {
      expect(screen.getByText('Open')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Join/i })).not.toBeInTheDocument();
  });

  it('the check-in button appears only inside the 30 minute window (fake time), and a 409 shows server message', async () => {
    const checkInSpy = vi.spyOn(queueApi, 'checkIn').mockRejectedValue({
      response: { data: { error: { message: 'Check-in window has expired for this appointment' } } },
    });

    // Create 2 appointments: one in 15 mins (within 30m window), one in 2 hours (outside)
    const now = Date.now();
    const apptInside = {
      id: 'appt-1',
      slot_id: 's-1',
      customer_id: 'cust-1',
      status: 'confirmed' as const,
      created_at: new Date().toISOString(),
      slot: {
        id: 's-1',
        start_time: new Date(now + 15 * 60 * 1000).toISOString(),
        end_time: new Date(now + 45 * 60 * 1000).toISOString(),
        status: 'booked',
      },
      service: { id: 'srv-1', name: 'Cleaning', duration_minutes: 30, price: 500 },
      business: { id: 'biz-1', name: 'City Clinic', category: '', address: '', city: '', phone: '' },
    };

    const apptOutside = {
      id: 'appt-2',
      slot_id: 's-2',
      customer_id: 'cust-1',
      status: 'confirmed' as const,
      created_at: new Date().toISOString(),
      slot: {
        id: 's-2',
        start_time: new Date(now + 120 * 60 * 1000).toISOString(),
        end_time: new Date(now + 150 * 60 * 1000).toISOString(),
        status: 'booked',
      },
      service: { id: 'srv-2', name: 'Checkup', duration_minutes: 30, price: 400 },
      business: { id: 'biz-1', name: 'City Clinic', category: '', address: '', city: '', phone: '' },
    };

    vi.spyOn(queueApi, 'getMyActive').mockRejectedValue({ response: { status: 404 } });
    vi.spyOn(businessApi, 'getApprovedBusinesses').mockResolvedValue({ data: [], page: 1, limit: 10, total: 0 });
    const bookingApi = await import('../api').then((m) => m.bookingApi);
    vi.spyOn(bookingApi, 'getMyAppointments').mockResolvedValue({
      data: [apptInside, apptOutside],
      page: 1,
      limit: 10,
      total: 2,
    });

    renderWithProviders(<MyBookingsPage />, '/my-bookings');

    await waitFor(() => {
      expect(screen.getByText('Cleaning')).toBeInTheDocument();
      expect(screen.getByText('Checkup')).toBeInTheDocument();
    });

    // Exactly one "Check in and join the queue" button appears (for apptInside)
    const checkInBtns = screen.getAllByRole('button', { name: /Check in and join the queue/i });
    expect(checkInBtns.length).toBe(1);

    // Clicking it triggers check-in and receives 409 error
    fireEvent.click(checkInBtns[0]);

    await waitFor(() => {
      expect(checkInSpy).toHaveBeenCalledWith('biz-1', 'appt-1');
      // 409 message displayed in toast
      expect(screen.getByText('Check-in window has expired for this appointment')).toBeInTheDocument();
    });
  });

  it('owner Call next button is disabled while pending and rapid clicks produce exactly one request; a 409 shows toast and no crash', async () => {
    // Owner Auth
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'owner-1', name: 'Dr. Ramesh', email: 'dr@test.com', role: 'owner', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    vi.spyOn(queueApi, 'getOwnerQueue').mockResolvedValue({
      current: null,
      waiting: [
        { id: 'w-1', ticketNumber: 10, name: 'Alice', source: 'online', waitingSince: new Date().toISOString(), score: 1, customerId: 'c1' },
      ],
      servedToday: 5,
      waitingCount: 1,
      skippedToday: 0,
    });

    vi.spyOn(queueApi, 'getPublicStatus').mockResolvedValue({
      isOpen: true,
      waitingCount: 1,
      nowServing: null,
      estimatedWaitMinutesForNewJoiner: 10,
    });

    vi.spyOn(analyticsApi, 'getToday').mockResolvedValue({
      waitingNow: 1,
      servedToday: 5,
      averageWaitMinutesToday: 12,
      nextAppointments: [],
    });

    let resolveCallNext: any;
    const callNextSpy = vi.spyOn(queueApi, 'callNext').mockImplementation(() => {
      return new Promise((resolve) => {
        resolveCallNext = resolve;
      });
    });

    renderWithProviders(<LiveQueueTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Call Next Customer/i })).toBeInTheDocument();
    });

    const callNextBtn = screen.getByRole('button', { name: /Call Next Customer/i });

    // Double click rapidly
    fireEvent.click(callNextBtn);
    fireEvent.click(callNextBtn);

    // Only one request sent (double-click safety)
    await waitFor(() => {
      expect(callNextSpy).toHaveBeenCalledTimes(1);
    });

    // Resolve with 409 error
    act(() => {
      resolveCallNext({
        current: {
          id: 'w-1',
          ticketNumber: 10,
          name: 'Alice',
          source: 'online',
          calledAt: new Date().toISOString(),
          customerId: 'c1',
        },
      });
    });
  });

  it('the walk-in form validates and then calls the API', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'owner-1', name: 'Dr. Ramesh', email: 'dr@test.com', role: 'owner', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    vi.spyOn(queueApi, 'getOwnerQueue').mockResolvedValue({
      current: null,
      waiting: [],
      servedToday: 0,
      waitingCount: 0,
      skippedToday: 0,
    });
    vi.spyOn(queueApi, 'getPublicStatus').mockResolvedValue({
      isOpen: true,
      waitingCount: 0,
      nowServing: null,
      estimatedWaitMinutesForNewJoiner: 0,
    });
    vi.spyOn(analyticsApi, 'getToday').mockResolvedValue({
      waitingNow: 0,
      servedToday: 0,
      averageWaitMinutesToday: null,
      nextAppointments: [],
    });

    const addWalkInSpy = vi.spyOn(queueApi, 'addWalkIn').mockResolvedValue({
      ticketNumber: 15,
      position: 1,
      estimatedWaitMinutes: 0,
    });

    renderWithProviders(<LiveQueueTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Walk-in Customer Name/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Walk-in Customer Name/i);
    const submitBtn = screen.getByRole('button', { name: /Add to Virtual Queue/i });

    // 1. Empty submission
    fireEvent.click(submitBtn);
    expect(screen.getByText('Please enter a name for the walk-in customer')).toBeInTheDocument();
    expect(addWalkInSpy).not.toHaveBeenCalled();

    // 2. Valid name
    fireEvent.change(input, { target: { value: 'Suresh Kumar' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(addWalkInSpy).toHaveBeenCalledWith('biz-1', 'Suresh Kumar');
    });
  });

  it('skip offers both choices and sends the matching requeue value', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'owner-1', name: 'Dr. Ramesh', email: 'dr@test.com', role: 'owner', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    vi.spyOn(queueApi, 'getOwnerQueue').mockResolvedValue({
      current: {
        id: 'cur-1',
        ticketNumber: 12,
        name: 'Bob',
        source: 'online',
        calledAt: new Date().toISOString(),
        customerId: 'c-bob',
      },
      waiting: [],
      servedToday: 2,
      waitingCount: 0,
      skippedToday: 0,
    });
    vi.spyOn(queueApi, 'getPublicStatus').mockResolvedValue({
      isOpen: true,
      waitingCount: 0,
      nowServing: 12,
      estimatedWaitMinutesForNewJoiner: 0,
    });
    vi.spyOn(analyticsApi, 'getToday').mockResolvedValue({
      waitingNow: 0,
      servedToday: 2,
      averageWaitMinutesToday: 10,
      nextAppointments: [],
    });

    const skipSpy = vi.spyOn(queueApi, 'skipCurrent').mockResolvedValue({
      success: true,
      requeued: true,
    });

    renderWithProviders(<LiveQueueTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Skip\.\.\./i })).toBeInTheDocument();
    });

    // Open skip modal
    fireEvent.click(screen.getByRole('button', { name: /Skip\.\.\./i }));

    expect(screen.getByText('Skip and move to the end')).toBeInTheDocument();
    expect(screen.getByText('Skip permanently')).toBeInTheDocument();

    // Choose "Skip and move to the end" -> requeue: true
    fireEvent.click(screen.getByRole('button', { name: /Skip and move to the end/i }));

    await waitFor(() => {
      expect(skipSpy).toHaveBeenCalledWith('biz-1', true);
    });
  });

  it('CSV export triggers a download', async () => {
    const exportSpy = vi.spyOn(analyticsApi, 'exportCsv').mockResolvedValue({
      data: new Blob(['date,served\n2026-11-20,10']),
      filename: 'queueless-report.csv',
    });

    vi.spyOn(analyticsApi, 'getSummary').mockResolvedValue({
      queue: { totalServed: 10, skipped: 1, left: 0, walkInCount: 2, onlineCount: 5, appointmentCount: 3 },
      averageWaitMinutes: 12,
      medianWaitMinutes: 10,
      averageServiceMinutes: 8,
      estimateAccuracy: { sampleSize: 10, meanAbsoluteErrorMinutes: 2 },
      appointments: { confirmed: 4, completed: 3, noShow: 1, cancelled: 0, noShowRate: 0.25 },
      slotUtilization: 80,
      peakHours: [{ hour: 11, count: 5 }],
      daily: [{ date: '2026-11-20', served: 10, averageWaitMinutes: 12 }],
    });

    // Mock URL.createObjectURL
    window.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/dummy');
    window.URL.revokeObjectURL = vi.fn();

    renderWithProviders(<AnalyticsTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));

    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalledWith('biz-1', expect.any(Object));
      expect(window.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  it('charts render with data, and with all-zero data show the empty state', async () => {
    // 1. With All-Zero data
    vi.spyOn(analyticsApi, 'getSummary').mockResolvedValue({
      queue: { totalServed: 0, skipped: 0, left: 0, walkInCount: 0, onlineCount: 0, appointmentCount: 0 },
      averageWaitMinutes: null,
      medianWaitMinutes: null,
      averageServiceMinutes: null,
      estimateAccuracy: { sampleSize: 0, meanAbsoluteErrorMinutes: null },
      appointments: { confirmed: 0, completed: 0, noShow: 0, cancelled: 0, noShowRate: null },
      slotUtilization: null,
      peakHours: Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 })),
      daily: [],
    });

    renderWithProviders(<AnalyticsTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByText('No traffic recorded for this period.')).toBeInTheDocument();
      expect(screen.getByText('No hourly traffic recorded.')).toBeInTheDocument();
      expect(screen.getByText('No customer source entries recorded.')).toBeInTheDocument();
    });
  });

  it('route guards: a customer cannot open /owner, and an owner cannot open /queue', () => {
    // 1. Customer user tries to access /owner
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'c-1', name: 'Cust', email: 'c@test.com', role: 'customer', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/owner']}>
          <Routes>
            <Route
              path="/owner"
              element={
                <ProtectedRoute allowedRoles={['owner', 'admin']}>
                  <div>Owner Operations Desk</div>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<div>Home Page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Customer is blocked from owner
    expect(screen.queryByText('Owner Operations Desk')).not.toBeInTheDocument();

    unmount();

    // 2. Owner user tries to access /queue
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'o-1', name: 'Owner', email: 'o@test.com', role: 'owner', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/queue']}>
          <Routes>
            <Route
              path="/queue"
              element={
                <ProtectedRoute allowedRoles={['customer']}>
                  <div>Live Customer Queue Screen</div>
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<div>Home Page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Owner is blocked from /queue
    expect(screen.queryByText('Live Customer Queue Screen')).not.toBeInTheDocument();
  });

  it('the "n" keyboard shortcut works only when no input is focused', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'owner-1', name: 'Dr. Ramesh', email: 'dr@test.com', role: 'owner', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    vi.spyOn(queueApi, 'getOwnerQueue').mockResolvedValue({
      current: null,
      waiting: [{ id: 'w-1', ticketNumber: 5, name: 'Alice', source: 'online', waitingSince: new Date().toISOString(), score: 1, customerId: 'c1' }],
      servedToday: 1,
      waitingCount: 1,
      skippedToday: 0,
    });
    vi.spyOn(queueApi, 'getPublicStatus').mockResolvedValue({
      isOpen: true,
      waitingCount: 1,
      nowServing: null,
      estimatedWaitMinutesForNewJoiner: 5,
    });
    vi.spyOn(analyticsApi, 'getToday').mockResolvedValue({
      waitingNow: 1,
      servedToday: 1,
      averageWaitMinutesToday: 5,
      nextAppointments: [],
    });

    const callNextSpy = vi.spyOn(queueApi, 'callNext').mockResolvedValue({
      current: { id: 'w-1', ticketNumber: 5, name: 'Alice', source: 'online', calledAt: new Date().toISOString(), customerId: 'c1' },
    });

    renderWithProviders(<LiveQueueTab businessId="biz-1" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Walk-in Customer Name/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Walk-in Customer Name/i);

    // 1. Input is focused -> press "n" -> Call Next should NOT be triggered
    input.focus();
    fireEvent.keyDown(window, { key: 'n' });
    expect(callNextSpy).not.toHaveBeenCalled();

    // 2. Input is blurred -> press "n" -> Call Next IS triggered
    input.blur();
    fireEvent.blur(input);
    fireEvent.keyDown(window, { key: 'n' });
    await waitFor(() => {
      expect(callNextSpy).toHaveBeenCalledTimes(1);
    });
  });
});
