import React from 'react';
import { Link } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 rounded-full bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-400 flex items-center justify-center mb-6 shadow-soft">
        <Compass className="w-10 h-10 animate-spin-slow" />
      </div>
      <h1 className="text-4xl font-extrabold text-gray-900 dark:text-white mb-2">404</h1>
      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-3">Page Not Found</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mb-6">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link to="/">
        <Button variant="primary" leftIcon={<Home className="w-4 h-4" />}>
          Back to Home
        </Button>
      </Link>
    </div>
  );
};
