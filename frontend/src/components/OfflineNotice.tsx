import React, { useState, useEffect } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';

export const OfflineNotice: React.FC = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="assertive"
      data-testid="offline-notice"
      className="bg-amber-600 text-white px-4 py-2 text-xs font-semibold shadow-md flex items-center justify-center gap-2 sticky top-16 z-50 transition-all animate-in fade-in slide-in-from-top-2"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>
        You are currently offline. QueueLess is in read-only mode and will re-sync automatically when your connection is restored.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="underline ml-2 hover:text-amber-100 flex items-center gap-1 cursor-pointer"
        aria-label="Retry network connection"
      >
        <RefreshCw className="w-3 h-3" /> Retry
      </button>
    </div>
  );
};
