import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, Clock, Bell, ArrowRight, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const LandingPage: React.FC = () => {
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (city.trim()) params.set('city', city.trim());
    navigate(`/businesses?${params.toString()}`);
  };

  return (
    <div className="space-y-24 py-6 sm:py-12">
      {/* Hero Section */}
      <section className="relative max-w-5xl mx-auto px-4 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-50 dark:bg-primary-950/50 border border-primary-200 dark:border-primary-800 text-primary-700 dark:text-primary-300 text-xs font-semibold mb-6">
          <Zap className="w-3.5 h-3.5 text-primary-600" /> Smart Live Virtual Queue & Booking
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold text-gray-900 dark:text-white tracking-tight leading-tight sm:leading-tight">
          Zero physical waiting. <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-600 to-indigo-500">
            Arrive right when it's your turn.
          </span>
        </h1>

        <p className="mt-5 text-base sm:text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
          QueueLess connects local clinics, salons, and service centers in India with customers. Book guaranteed slots or follow live virtual queue progress from home.
        </p>

        {/* Hero Search Box */}
        <form
          onSubmit={handleSearch}
          className="mt-10 p-2.5 sm:p-3 bg-white dark:bg-gray-900 rounded-2xl sm:rounded-3xl shadow-soft-lg border border-gray-100 dark:border-gray-800 max-w-3xl mx-auto flex flex-col sm:flex-row items-center gap-2"
        >
          <div className="relative w-full flex-1">
            <Search className="w-5 h-5 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Business name, dental, salon..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
            />
          </div>

          <div className="hidden sm:block w-px h-8 bg-gray-200 dark:bg-gray-800" />

          <div className="relative w-full sm:w-56">
            <MapPin className="w-5 h-5 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="City (e.g. Bengaluru)"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
            />
          </div>

          <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto px-8">
            Search
          </Button>
        </form>
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-xs font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400 mb-2">
            How It Works
          </h2>
          <p className="text-3xl font-extrabold text-gray-900 dark:text-white">
            Three simple steps to avoid the waiting room
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-8 rounded-3xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-soft">
            <div className="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-950 text-primary-600 dark:text-primary-400 flex items-center justify-center font-bold text-lg mb-6">
              1
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Find Verified Businesses
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              Search approved clinics, salons, and consultants in your area. Check available services, prices, and operating hours.
            </p>
          </div>

          <div className="p-8 rounded-3xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-soft">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-lg mb-6">
              2
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Book a Slot or Join Queue
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              Lock in an exact appointment time with concurrency protection, or jump into the live virtual queue without physically standing in line.
            </p>
          </div>

          <div className="p-8 rounded-3xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-soft">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-lg mb-6">
              3
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Real-Time Notifications
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              Track live queue position movements and estimated wait times. Receive alerts when you are near the front so you arrive relaxed.
            </p>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-gray-100/70 dark:bg-gray-900/40 py-16 border-y border-gray-200/60 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400 mb-2">
              Platform Features
            </h2>
            <p className="text-3xl font-extrabold text-gray-900 dark:text-white">
              Built with precision and reliability
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200/60 dark:border-gray-800">
              <ShieldCheck className="w-8 h-8 text-primary-600 mb-4" />
              <h4 className="font-bold text-gray-900 dark:text-white mb-1">Concurrency-Safe</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                PostgreSQL row-level locking guarantees slots can never be double-booked simultaneously.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200/60 dark:border-gray-800">
              <Zap className="w-8 h-8 text-emerald-600 mb-4" />
              <h4 className="font-bold text-gray-900 dark:text-white mb-1">Sub-Second Live Sync</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Redis sorted-set queues deliver low-latency queue order and instant Socket.io updates.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200/60 dark:border-gray-800">
              <Clock className="w-8 h-8 text-amber-600 mb-4" />
              <h4 className="font-bold text-gray-900 dark:text-white mb-1">Asia/Kolkata Native</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Slot generations and working hours adhere strictly to IST across all browser environments.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200/60 dark:border-gray-800">
              <Bell className="w-8 h-8 text-indigo-600 mb-4" />
              <h4 className="font-bold text-gray-900 dark:text-white mb-1">Smart Alerts</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Automated reminders 60 minutes before appointments and instant queue call alerts.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="max-w-5xl mx-auto px-4 text-center">
        <div className="p-10 sm:p-14 rounded-3xl bg-primary-600 text-white shadow-soft-lg space-y-6">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Ready to upgrade your scheduling?
          </h2>
          <p className="text-primary-100 max-w-xl mx-auto text-sm sm:text-base">
            Join thousands of customers saving valuable time and business owners streamlining customer flow.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => navigate('/businesses')}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              Browse Businesses
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="border-white/40 text-white hover:bg-white/10"
              onClick={() => navigate('/register')}
            >
              Register as Owner
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};
