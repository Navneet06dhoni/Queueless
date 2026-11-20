import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../api/types';
import { Spinner } from './ui/Spinner';
import { ShieldAlert } from 'lucide-react';
import { Button } from './ui/Button';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
}) => {
  const { user, isLoading, isBlocked, blockedReason, logout } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div
        data-testid="auth-loading"
        className="min-h-[70vh] flex flex-col items-center justify-center p-4"
      >
        <Spinner size="lg" />
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading your session...</p>
      </div>
    );
  }

  if (isBlocked || user?.is_blocked) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Account Suspended</h2>
        <p className="max-w-md text-gray-600 dark:text-gray-300 mb-6">
          {blockedReason || 'Your account has been suspended by an administrator. Please contact support.'}
        </p>
        <Button variant="secondary" onClick={() => logout()}>
          Sign Out
        </Button>
      </div>
    );
  }

  if (!user) {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${returnUrl}`} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Access Restricted</h2>
        <p className="text-gray-600 dark:text-gray-400 max-w-sm mb-6">
          You do not have permission to view this page with your current account ({user.role}).
        </p>
        <Navigate to="/" replace />
      </div>
    );
  }

  return <>{children}</>;
};
