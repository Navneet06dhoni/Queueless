import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSocket } from '../context/SocketContext';
import { useToast } from './ui/Toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '../api';
import { formatDate } from '../utils/date';
import {
  Bell,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  Calendar,
  ExternalLink,
} from 'lucide-react';
import { Button } from './ui/Button';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { socket } = useSocket();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotificationOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch recent notifications for authenticated users
  const { data: notifData } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => notificationApi.getNotifications({ limit: 5 }),
    enabled: !!user,
    staleTime: 30000,
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationApi.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('All notifications marked as read');
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Listen to socket event: notification:new
  useEffect(() => {
    if (!socket || !user) return;

    const handleNewNotification = (notification: any) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.info(notification.message, notification.title || 'Notification');
    };

    socket.on('notification:new', handleNewNotification);

    return () => {
      socket.off('notification:new', handleNewNotification);
    };
  }, [socket, user, queryClient, toast]);

  const unreadCount = notifData?.unreadCount || 0;

  return (
    <nav className="sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center text-white font-bold text-lg shadow-soft group-hover:scale-105 transition-transform">
                Q
              </div>
              <span className="font-extrabold text-xl tracking-tight text-gray-900 dark:text-white">
                Queue<span className="text-primary-600">Less</span>
              </span>
            </Link>

            {/* Desktop Navigation Links */}
            <div className="hidden md:flex items-center gap-1">
              <Link
                to="/businesses"
                className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100/60 dark:hover:bg-gray-800 transition-colors"
              >
                Businesses
              </Link>

              {user?.role === 'customer' && (
                <>
                  <Link
                    to="/my-bookings"
                    className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100/60 dark:hover:bg-gray-800 transition-colors"
                  >
                    My Bookings
                  </Link>
                  <Link
                    to="/queue"
                    className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100/60 dark:hover:bg-gray-800 transition-colors"
                  >
                    Live Queue
                  </Link>
                </>
              )}

              {user?.role === 'owner' && (
                <>
                  <Link
                    to="/owner"
                    className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100/60 dark:hover:bg-gray-800 transition-colors"
                  >
                    Owner Dashboard
                  </Link>
                  <Link
                    to="/owner/manage"
                    className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100/60 dark:hover:bg-gray-800 transition-colors"
                  >
                    Management
                  </Link>
                </>
              )}

              {user?.role === 'admin' && (
                <Link
                  to="/admin"
                  className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100/60 dark:hover:bg-gray-800 transition-colors"
                >
                  Admin Panel
                </Link>
              )}
            </div>
          </div>

          {/* Right Action Items */}
          <div className="hidden md:flex items-center gap-2">
            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
            </button>

            {/* Notifications Bell (Authenticated only) */}
            {user && (
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => setNotificationOpen((prev) => !prev)}
                  aria-label="Open notifications"
                  className="p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors relative"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span
                      data-testid="unread-badge"
                      className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center animate-pulse"
                    >
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {/* Notifications Dropdown */}
                {notificationOpen && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-soft-lg z-50 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-gray-900 dark:text-white text-sm">Notifications</h4>
                        {unreadCount > 0 && (
                          <span className="text-xs bg-primary-100 dark:bg-primary-950 text-primary-600 dark:text-primary-400 font-semibold px-2 py-0.5 rounded-full">
                            {unreadCount} new
                          </span>
                        )}
                      </div>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={() => markAllMutation.mutate()}
                          disabled={markAllMutation.isPending}
                          className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>

                    <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800/60">
                      {(!notifData?.data || notifData.data.length === 0) ? (
                        <div className="p-6 text-center text-xs text-gray-400">
                          No notifications yet
                        </div>
                      ) : (
                        notifData.data.map((n) => (
                          <div
                            key={n.id}
                            onClick={() => {
                              if (n.status === 'unread') {
                                markReadMutation.mutate(n.id);
                              }
                            }}
                            className={`p-3.5 text-xs transition-colors cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                              n.status === 'unread'
                                ? 'bg-primary-50/40 dark:bg-primary-950/20'
                                : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-gray-900 dark:text-white">
                                {n.title || 'Alert'}
                              </p>
                              <span className="text-[10px] text-gray-400 shrink-0">
                                {formatDate(n.created_at, 'dd MMM')}
                              </span>
                            </div>
                            <p className="mt-1 text-gray-600 dark:text-gray-300 leading-relaxed">
                              {n.message}
                            </p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="p-2.5 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 text-center">
                      <Link
                        to="/notifications"
                        onClick={() => setNotificationOpen(false)}
                        className="text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400 inline-flex items-center gap-1"
                      >
                        View all notifications <ExternalLink className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Auth Buttons / User Menu */}
            {user ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((prev) => !prev)}
                  className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-950 text-primary-700 dark:text-primary-300 font-bold text-xs flex items-center justify-center">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="text-left hidden lg:block">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white leading-none">
                      {user.name}
                    </p>
                    <p className="text-[10px] text-gray-400 capitalize mt-0.5">{user.role}</p>
                  </div>
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-52 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-soft-lg z-50 py-1.5">
                    <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
                      <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{user.name}</p>
                      <p className="text-[11px] text-gray-400 truncate">{user.email}</p>
                    </div>

                    {user.role === 'customer' && (
                      <Link
                        to="/my-bookings"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <Calendar className="w-4 h-4" /> My Bookings
                      </Link>
                    )}

                    <button
                      type="button"
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await logout();
                        navigate('/login');
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <LogOut className="w-4 h-4" /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link to="/login">
                  <Button variant="ghost" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link to="/register">
                  <Button variant="primary" size="sm">
                    Get Started
                  </Button>
                </Link>
              </div>
            )}
          </div>

          {/* Mobile hamburger button */}
          <div className="flex md:hidden items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="p-2 rounded-xl text-gray-500"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Open mobile menu"
              className="p-2 rounded-xl text-gray-600 dark:text-gray-300"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 pt-2 pb-6 space-y-3">
          <Link
            to="/businesses"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
          >
            Find Businesses
          </Link>

          {user?.role === 'customer' && (
            <>
              <Link
                to="/my-bookings"
                onClick={() => setMobileMenuOpen(false)}
                className="block py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
              >
                My Bookings
              </Link>
              <Link
                to="/queue"
                onClick={() => setMobileMenuOpen(false)}
                className="block py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
              >
                Live Virtual Queue
              </Link>
            </>
          )}

          {user?.role === 'owner' && (
            <>
              <Link
                to="/owner"
                onClick={() => setMobileMenuOpen(false)}
                className="block py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
              >
                Owner Dashboard
              </Link>
              <Link
                to="/owner/manage"
                onClick={() => setMobileMenuOpen(false)}
                className="block py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
              >
                Management
              </Link>
            </>
          )}

          {user?.role === 'admin' && (
            <Link
              to="/admin"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
            >
              Admin Panel
            </Link>
          )}

          {user && (
            <Link
              to="/notifications"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between py-2 text-sm font-medium text-gray-800 dark:text-gray-200"
            >
              <span>Notifications</span>
              {unreadCount > 0 && (
                <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                  {unreadCount}
                </span>
              )}
            </Link>
          )}

          <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
            {user ? (
              <div className="space-y-3">
                <div className="text-xs text-gray-500">
                  Signed in as <span className="font-semibold text-gray-800 dark:text-white">{user.name}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    setMobileMenuOpen(false);
                    await logout();
                    navigate('/login');
                  }}
                >
                  Sign Out
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Link to="/login" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="outline" size="sm" className="w-full">
                    Sign In
                  </Button>
                </Link>
                <Link to="/register" onClick={() => setMobileMenuOpen(false)}>
                  <Button variant="primary" size="sm" className="w-full">
                    Register
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};
