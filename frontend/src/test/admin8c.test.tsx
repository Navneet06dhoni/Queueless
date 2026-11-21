import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminBusinessesTab } from '../pages/admin/tabs/AdminBusinessesTab';
import { AdminUsersTab } from '../pages/admin/tabs/AdminUsersTab';
import { AdminFailedEmailsTab } from '../pages/admin/tabs/AdminFailedEmailsTab';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { Navbar } from '../components/Navbar';
import * as AuthContextModule from '../context/AuthContext';
import * as SocketContextModule from '../context/SocketContext';
import { adminApi, notificationApi } from '../api';
import { AdminUserListItem } from '../api/types';
import { ToastProvider } from '../components/ui/Toast';

describe('Step 8c Admin Panel & Governance Tests', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    });

    vi.spyOn(SocketContextModule, 'useSocket').mockReturnValue({
      socket: null,
      isConnected: false,
    } as any);

    vi.spyOn(notificationApi, 'getNotifications').mockResolvedValue({
      data: [],
      total: 0,
      unreadCount: 0,
      page: 1,
      limit: 10,
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

  it('route guards: customer cannot open /owner/manage or /admin, owner cannot open /admin, admin does not see /owner link', async () => {
    // 1. Customer user trying to open /owner/manage
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'cust-1', name: 'Customer User', email: 'cust@test.com', role: 'customer', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/owner/manage']}>
            <Routes>
              <Route
                path="/owner/manage"
                element={
                  <ProtectedRoute allowedRoles={['owner']}>
                    <div>Owner Management Content</div>
                  </ProtectedRoute>
                }
              />
              <Route path="/" element={<div>Home Page</div>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(screen.queryByText('Owner Management Content')).not.toBeInTheDocument();
    expect(screen.getByText('Home Page')).toBeInTheDocument();

    // 2. Customer user trying to open /admin
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/admin']}>
            <Routes>
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <div>Admin Panel Content</div>
                  </ProtectedRoute>
                }
              />
              <Route path="/" element={<div>Home Page</div>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(screen.queryByText('Admin Panel Content')).not.toBeInTheDocument();

    // 3. Owner user trying to open /admin
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'owner-1', name: 'Owner User', email: 'owner@test.com', role: 'owner', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/admin']}>
            <Routes>
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <div>Admin Panel Content</div>
                  </ProtectedRoute>
                }
              />
              <Route path="/" element={<div>Home Page</div>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    expect(screen.queryByText('Admin Panel Content')).not.toBeInTheDocument();

    // 4. Admin user does NOT see /owner link in Navbar
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'admin-1', name: 'Admin User', email: 'admin@test.com', role: 'admin', created_at: '' },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter>
            <Navbar />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    // Admin should see Admin Panel link, but NEVER Owner Dashboard or Management
    expect(screen.getByRole('link', { name: /Admin Panel/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Owner Dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Management/i })).not.toBeInTheDocument();
  });

  it('admin businesses: approve moves an item out of the pending list', async () => {
    const pendingBiz = {
      id: 'biz-p1',
      owner_id: 'owner-1',
      name: 'Dr. Rao Dental Clinic',
      category: 'Dental Clinic',
      address: '12 Indiranagar',
      city: 'Bangalore',
      phone: '9876543210',
      status: 'pending' as const,
      created_at: new Date().toISOString(),
    };

    let listData = [pendingBiz];

    vi.spyOn(adminApi, 'listBusinesses').mockImplementation(async () => ({
      data: listData,
      total: listData.length,
      page: 1,
      limit: 10,
    }));

    const updateStatusSpy = vi.spyOn(adminApi, 'updateBusinessStatus').mockImplementation(async () => {
      // Simulate backend status change
      listData = [];
      return { ...pendingBiz, status: 'approved' };
    });

    renderWithProviders(<AdminBusinessesTab />);

    await waitFor(() => {
      expect(screen.getAllByText('Dr. Rao Dental Clinic')[0]).toBeInTheDocument();
    });

    // Click Approve button (action button with exact text "Approve")
    const approveButtons = screen.getAllByRole('button', { name: /^Approve$/i });
    fireEvent.click(approveButtons[0]);

    // Confirmation modal appears
    expect(screen.getByText(/Approve Business Listing\?/i)).toBeInTheDocument();
    const confirmApproveBtn = screen.getByRole('button', { name: /Confirm Approval/i });
    fireEvent.click(confirmApproveBtn);

    await waitFor(() => {
      expect(updateStatusSpy).toHaveBeenCalledWith('biz-p1', 'approved');
      // List should update immediately and pending item is gone
      expect(screen.queryByText('Dr. Rao Dental Clinic')).not.toBeInTheDocument();
      expect(screen.getByText(/No pending businesses/i)).toBeInTheDocument();
    });
  });

  it('admin users: block requires a reason; block button is hidden for admins; blocked badge appears', async () => {
    const regularUser = {
      id: 'user-regular-1',
      name: 'Rohan Sharma',
      email: 'rohan@example.com',
      role: 'customer' as const,
      is_blocked: false,
      blocked_at: null,
      blocked_reason: null,
      created_at: new Date().toISOString(),
    };

    const adminUser = {
      id: 'user-admin-1',
      name: 'Super Admin',
      email: 'admin@queueless.com',
      role: 'admin' as const,
      is_blocked: false,
      blocked_at: null,
      blocked_reason: null,
      created_at: new Date().toISOString(),
    };

    const blockedUser = {
      id: 'user-blocked-1',
      name: 'Spam Bot',
      email: 'bot@spam.com',
      role: 'customer' as const,
      is_blocked: true,
      blocked_at: new Date().toISOString(),
      blocked_reason: 'Spamming appointments across multiple clinics',
      created_at: new Date().toISOString(),
    };

    let userList: AdminUserListItem[] = [
      regularUser,
      adminUser,
      blockedUser,
    ];

    vi.spyOn(adminApi, 'listUsers').mockImplementation(async () => ({
      data: userList,
      total: userList.length,
      page: 1,
      limit: 10,
    }));

    const blockSpy = vi.spyOn(adminApi, 'blockUser').mockImplementation(async (userId, data) => {
      userList = userList.map((u) =>
        u.id === userId ? { ...u, is_blocked: data.blocked, blocked_reason: data.reason || null } : u
      );
      return {
        message: 'User blocked',
        user: userList.find((u) => u.id === userId)!,
      };
    });

    renderWithProviders(<AdminUsersTab />);

    await waitFor(() => {
      expect(screen.getAllByText('Rohan Sharma')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Super Admin')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Spam Bot')[0]).toBeInTheDocument();
    });

    // 1. Verify block button is HIDDEN for admins
    // There are 3 users: 1 regular customer (has Block button in desktop + mobile = 2 buttons), 1 admin (NO block button in desktop or mobile), 1 blocked customer (has Unblock button)
    const blockButtons = screen.getAllByRole('button', { name: /Block User/i });
    // Exactly 2 buttons (1 in desktop view, 1 in mobile view for Rohan Sharma)
    expect(blockButtons.length).toBe(2);

    // 2. Verify blocked badge appears for Spam Bot
    expect(screen.getByTestId('blocked-reason-user-blocked-1')).toHaveTextContent(
      'Spamming appointments across multiple clinics'
    );

    // 3. Block Rohan Sharma: requires reason
    fireEvent.click(blockButtons[0]);
    expect(screen.getByText(/Block User Account/i)).toBeInTheDocument();

    const confirmBlockBtn = screen.getByRole('button', { name: /Confirm & Block User/i });
    // Click with empty reason: rejected
    fireEvent.click(confirmBlockBtn);

    await waitFor(() => {
      expect(screen.getByText(/Reason is required to block a user/i)).toBeInTheDocument();
      expect(blockSpy).not.toHaveBeenCalled();
    });

    // Enter valid reason
    const reasonInput = screen.getByLabelText(/Reason for Blocking/i);
    fireEvent.change(reasonInput, {
      target: { value: 'Violation of cancellation policy' },
    });
    fireEvent.click(confirmBlockBtn);

    await waitFor(() => {
      expect(blockSpy).toHaveBeenCalledWith('user-regular-1', {
        blocked: true,
        reason: 'Violation of cancellation policy',
      });
    });
  });

  it('failed-email rows render a last_error containing <script> as plain text', async () => {
    const xssScript = '<script>alert("xss")</script>';
    const failedItem = {
      id: 'notif-failed-1',
      user_id: 'user-1',
      user_name: 'Priya Sharma',
      user_email: 'priya@example.com',
      type: 'booking.confirmed',
      title: 'Booking Confirmed',
      message: 'Your booking has been confirmed',
      email_status: 'failed',
      email_attempts: 3,
      last_error: `SMTP connection failed: ${xssScript}`,
      created_at: new Date().toISOString(),
    };

    vi.spyOn(adminApi, 'getFailedNotifications').mockResolvedValue({
      data: [failedItem],
      total: 1,
      page: 1,
      limit: 10,
    });

    renderWithProviders(<AdminFailedEmailsTab />);

    await waitFor(() => {
      expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    });

    const errorEl = screen.getByTestId('last-error-notif-failed-1');
    expect(errorEl).toBeInTheDocument();

    // Verify it is rendered as text content, not executable script tag
    expect(errorEl.textContent).toContain('<script>alert("xss")</script>');
    expect(errorEl.querySelector('script')).toBeNull();
  });
});
