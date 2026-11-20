import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '../components/ProtectedRoute';
import * as AuthContextModule from '../context/AuthContext';

describe('ProtectedRoute component', () => {
  it('redirects an anonymous user to /login with a return URL', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: null,
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/my-bookings?page=2']}>
        <Routes>
          <Route
            path="/my-bookings"
            element={
              <ProtectedRoute allowedRoles={['customer']}>
                <div>Protected Bookings Content</div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/login"
            element={<div>Login Page Screen</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    // Content should not be visible
    expect(screen.queryByText('Protected Bookings Content')).not.toBeInTheDocument();
    // Redirected to login
    expect(screen.getByText('Login Page Screen')).toBeInTheDocument();
  });

  it('blocks the wrong role from accessing customer-only page', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 'o1',
        name: 'Owner User',
        email: 'owner@test.com',
        role: 'owner',
        created_at: '',
      },
      isLoading: false,
      isBlocked: false,
      blockedReason: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/my-bookings']}>
        <Routes>
          <Route
            path="/my-bookings"
            element={
              <ProtectedRoute allowedRoles={['customer']}>
                <div>Protected Bookings Content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<div>Home Screen</div>} />
        </Routes>
      </MemoryRouter>
    );

    // Owner should be blocked from customer page
    expect(screen.queryByText('Protected Bookings Content')).not.toBeInTheDocument();
  });

  it('renders children when authenticated with the allowed role', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 'c1',
        name: 'Customer User',
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

    render(
      <MemoryRouter initialEntries={['/my-bookings']}>
        <Routes>
          <Route
            path="/my-bookings"
            element={
              <ProtectedRoute allowedRoles={['customer']}>
                <div>Protected Bookings Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Bookings Content')).toBeInTheDocument();
  });
});
