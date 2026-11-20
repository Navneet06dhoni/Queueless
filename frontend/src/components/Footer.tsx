import React from 'react';
import { Link } from 'react-router-dom';

export const Footer: React.FC = () => {
  return (
    <footer className="mt-auto border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 py-10 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-sm">
              Q
            </div>
            <span className="font-bold text-gray-900 dark:text-white">
              Queue<span className="text-primary-600">Less</span>
            </span>
            <span className="text-xs text-gray-400 ml-2">
              Virtual Queue & Appointment Booking
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs text-gray-500 dark:text-gray-400">
            <Link to="/businesses" className="hover:text-primary-600 transition-colors">
              Find Businesses
            </Link>
            <Link to="/login" className="hover:text-primary-600 transition-colors">
              Sign In
            </Link>
            <Link to="/register" className="hover:text-primary-600 transition-colors">
              Register Business
            </Link>
            <span>Timezone: Asia/Kolkata (IST)</span>
          </div>

          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} QueueLess India. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
