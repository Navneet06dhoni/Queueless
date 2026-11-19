import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

export const App: React.FC = () => {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
        {/* Navigation Header */}
        <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-primary-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                Q
              </div>
              <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">
                Queue<span className="text-primary-600">Less</span>
              </span>
            </Link>
            <nav className="flex items-center gap-4">
              <Link
                to="/"
                className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600"
              >
                Home
              </Link>
              <div className="h-4 w-px bg-gray-300 dark:bg-gray-700" />
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                Backend Ready
              </span>
            </nav>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Routes>
            <Route
              path="/"
              element={
                <div className="max-w-3xl mx-auto text-center space-y-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-primary-50 text-primary-600 dark:bg-primary-950/50 dark:text-primary-400 border border-primary-200 dark:border-primary-800">
                    Step 1 Initialized
                  </div>
                  <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                    Smart Appointment Booking & <span className="text-primary-600">Live Virtual Queue</span>
                  </h1>
                  <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                    Designed for small clinics, salons, and local businesses in India. Zero physical waiting, real-time sync, and slot locking.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 text-left">
                    <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-soft">
                      <div className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600 flex items-center justify-center font-bold mb-3">1</div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">Modular Architecture</h3>
                      <p className="text-xs text-gray-500 mt-1">Structured Express backend ready for future microservices splitting.</p>
                    </div>
                    <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-soft">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 flex items-center justify-center font-bold mb-3">2</div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">PostgreSQL Migrations</h3>
                      <p className="text-xs text-gray-500 mt-1">Transaction-safe migrations with indexes, FKs, and concurrency constraints.</p>
                    </div>
                    <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-soft">
                      <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 flex items-center justify-center font-bold mb-3">3</div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">Redis & Sockets Ready</h3>
                      <p className="text-xs text-gray-500 mt-1">Prepared for sorted-set live queues and low-latency real-time rooms.</p>
                    </div>
                  </div>
                </div>
              }
            />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="border-t border-gray-200 dark:border-gray-800 py-6 text-center text-xs text-gray-500">
          QueueLess &copy; {new Date().getFullYear()} — Built with Express, PostgreSQL, Redis, React & Tailwind CSS.
        </footer>
      </div>
    </Router>
  );
};

export default App;
