import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queueApi } from '../api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useToast } from './ui/Toast';
import { Users, ArrowRight, BellRing } from 'lucide-react';
import { QueueCalledPayload, QueueRemovedPayload } from '../api/types';

export const GlobalQueueBanner: React.FC = () => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const isCustomer = user?.role === 'customer';
  const isOnQueuePage = location.pathname === '/queue';

  // Cached active queue entry
  const { data: queueData } = useQuery({
    queryKey: ['queue', 'me'],
    queryFn: () => queueApi.getMyActive(),
    enabled: isCustomer,
    retry: false,
    staleTime: 10000,
  });

  // Global toast alerts for queue:called and queue:removed when on other pages
  useEffect(() => {
    if (!socket || !isCustomer) return;

    const handleCalled = (data: QueueCalledPayload) => {
      queryClient.setQueryData<any>(['queue', 'me'], (old: any) => {
        if (!old) return old;
        return { ...old, status: 'called', ticketNumber: data.ticketNumber || old.ticketNumber };
      });

      if (location.pathname !== '/queue') {
        toast.info(
          `It is your turn! Ticket #${data.ticketNumber} has been called. Please proceed to the service counter.`,
          'Queue Alert'
        );
      }
    };

    const handleRemoved = (data: QueueRemovedPayload) => {
      queryClient.setQueryData<any>(['queue', 'me'], (old: any) => {
        if (!old) return old;
        return { ...old, status: data.status };
      });

      if (location.pathname !== '/queue') {
        toast.info(
          `Your queue status changed: ${data.status}.`,
          'Queue Update'
        );
      }
    };

    socket.on('queue:called', handleCalled);
    socket.on('queue:removed', handleRemoved);

    return () => {
      socket.off('queue:called', handleCalled);
      socket.off('queue:removed', handleRemoved);
    };
  }, [socket, isCustomer, location.pathname, toast, queryClient]);

  if (!isCustomer || isOnQueuePage || !queueData) {
    return null;
  }

  const isActive = queueData.status === 'waiting' || queueData.status === 'called';
  if (!isActive) {
    return null;
  }

  const isCalled = queueData.status === 'called';

  return (
    <aside
      aria-label="Active queue status banner"
      className={`w-full py-2.5 px-4 text-xs sm:text-sm font-medium transition-colors ${
        isCalled
          ? 'bg-amber-500 text-white shadow-md'
          : 'bg-primary-600 text-white shadow-xs'
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          {isCalled ? (
            <BellRing className="w-4 h-4 shrink-0 animate-bounce motion-reduce:animate-none" />
          ) : (
            <Users className="w-4 h-4 shrink-0" />
          )}
          <span className="truncate">
            {isCalled ? (
              <strong>It is your turn! Ticket #{queueData.ticketNumber} called at {queueData.businessName || 'the business'}.</strong>
            ) : (
              <>
                You are in line at <strong className="font-semibold">{queueData.businessName || 'Business'}</strong> — Ticket #{queueData.ticketNumber} (Position #{queueData.position}, {queueData.peopleAhead} ahead)
              </>
            )}
          </span>
        </div>

        <Link
          to="/queue"
          className="shrink-0 flex items-center gap-1 font-bold underline hover:opacity-90 transition-opacity"
        >
          View Queue <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </aside>
  );
};
