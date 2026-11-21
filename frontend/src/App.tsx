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

// Lazy-loaded pages for bundle optimization (Step 8b)
const LiveQueuePage = React.lazy(() =>
  import('./pages/LiveQueuePage').then((m) => ({ default: m.LiveQueuePage }))
);
const OwnerDashboardPage = React.lazy(() =>
  import('./pages/owner/OwnerDashboardPage').then((m) => ({ default: m.OwnerDashboardPage }))
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
                              <ProtectedRoute allowedRoles={['customer']}>
                                <LiveQueuePage />
                              </ProtectedRoute>
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

                          {/* Owner-Only Dashboard (Step 8b) */}
                          <Route
                            path="/owner"
                            element={
                              <ProtectedRoute allowedRoles={['owner', 'admin']}>
                                <OwnerDashboardPage />
                              </ProtectedRoute>
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
