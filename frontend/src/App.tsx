import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { ToastProvider } from './components/ui/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { ProtectedRoute } from './components/ProtectedRoute';
import { GlobalQueueBanner } from './components/GlobalQueueBanner';
import { OfflineNotice } from './components/OfflineNotice';
import { Spinner } from './components/ui/Spinner';

// Pages
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { BusinessSearchPage } from './pages/BusinessSearchPage';
import { BusinessDetailPage } from './pages/BusinessDetailPage';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Lazy-loaded pages for bundle optimization (Step 8b & 8c)
const LiveQueuePage = React.lazy(() =>
  import('./pages/LiveQueuePage').then((m) => ({ default: m.LiveQueuePage }))
);
const OwnerDashboardPage = React.lazy(() =>
  import('./pages/owner/OwnerDashboardPage').then((m) => ({ default: m.OwnerDashboardPage }))
);
const OwnerManagePage = React.lazy(() =>
  import('./pages/owner/manage/OwnerManagePage').then((m) => ({ default: m.OwnerManagePage }))
);
const AdminPanelPage = React.lazy(() =>
  import('./pages/admin/AdminPanelPage').then((m) => ({ default: m.AdminPanelPage }))
);

const PageLoader = () => (
  <div className="min-h-[50vh] flex flex-col items-center justify-center p-8">
    <Spinner size="lg" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <SocketProvider>
                <BrowserRouter>
                  <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors">
                    <Navbar />
                    <OfflineNotice />
                    <GlobalQueueBanner />
                    <main className="flex-1">
                      <Suspense fallback={<PageLoader />}>
                        <Routes>
                          <Route path="/" element={<LandingPage />} />
                          <Route path="/login" element={<LoginPage />} />
                          <Route path="/register" element={<RegisterPage />} />
                          <Route path="/businesses" element={<BusinessSearchPage />} />
                          <Route path="/businesses/:id" element={<BusinessDetailPage />} />

                          {/* Customer-Only Live Queue Page */}
                          <Route
                            path="/queue"
                            element={
                              <ErrorBoundary>
                                <ProtectedRoute allowedRoles={['customer']}>
                                  <LiveQueuePage />
                                </ProtectedRoute>
                              </ErrorBoundary>
                            }
                          />

                          {/* Protected Customer Routes */}
                          <Route
                            path="/my-bookings"
                            element={
                              <ProtectedRoute allowedRoles={['customer']}>
                                <MyBookingsPage />
                              </ProtectedRoute>
                            }
                          />
                          <Route
                            path="/notifications"
                            element={
                              <ProtectedRoute>
                                <NotificationsPage />
                              </ProtectedRoute>
                            }
                          />

                          {/* Owner-Only Routes */}
                          <Route
                            path="/owner"
                            element={
                              <ErrorBoundary>
                                <ProtectedRoute allowedRoles={['owner']}>
                                  <OwnerDashboardPage />
                                </ProtectedRoute>
                              </ErrorBoundary>
                            }
                          />
                          <Route
                            path="/owner/manage"
                            element={
                              <ErrorBoundary>
                                <ProtectedRoute allowedRoles={['owner']}>
                                  <OwnerManagePage />
                                </ProtectedRoute>
                              </ErrorBoundary>
                            }
                          />

                          {/* Admin-Only Route */}
                          <Route
                            path="/admin"
                            element={
                              <ErrorBoundary>
                                <ProtectedRoute allowedRoles={['admin']}>
                                  <AdminPanelPage />
                                </ProtectedRoute>
                              </ErrorBoundary>
                            }
                          />

                          {/* 404 Catch-All */}
                          <Route path="*" element={<NotFoundPage />} />
                        </Routes>
                      </Suspense>
                    </main>
                    <Footer />
                  </div>
                </BrowserRouter>
              </SocketProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
