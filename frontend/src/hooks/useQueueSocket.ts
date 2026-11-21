import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '../context/SocketContext';
import {
  PublicQueueStatus,
  OwnerQueueDetails,
  CustomerQueuePosition,
  QueueCalledPayload,
  QueueRemovedPayload,
} from '../api/types';

export interface UseQueueSocketOptions {
  owner?: boolean;
  enabled?: boolean;
}

export interface UseQueueSocketResult {
  status: 'connected' | 'reconnecting' | 'offline';
  lastUpdatedAt: Date | null;
}

export const useQueueSocket = (
  businessId?: string | null,
  options: UseQueueSocketOptions = {}
): UseQueueSocketResult => {
  const { owner = false, enabled = true } = options;
  const { socket, status } = useSocket();
  const queryClient = useQueryClient();

  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const wasConnectedRef = useRef(false);

  // 1. Subscribe / Re-subscribe on connect or reconnect
  useEffect(() => {
    if (!enabled || !socket || !businessId) return;

    const subscribe = () => {
      const eventName = owner ? 'queue:watch-owner' : 'queue:watch';
      socket.emit(eventName, { businessId }, (ack?: any) => {
        if (!ack || ack.error) return;

        if (owner && ack.queue) {
          queryClient.setQueryData(['queue', 'owner', businessId], ack.queue);
          setLastUpdatedAt(new Date());
        } else if (!owner && ack.status) {
          queryClient.setQueryData(['queue', 'status', businessId], ack.status);
          setLastUpdatedAt(new Date());
        }
      });
    };

    if (socket.connected) {
      subscribe();
    }

    const handleConnect = () => {
      subscribe();
      // On reconnect, refetch once to resynchronise
      if (wasConnectedRef.current) {
        if (owner) {
          queryClient.refetchQueries({ queryKey: ['queue', 'owner', businessId] });
        } else {
          queryClient.refetchQueries({ queryKey: ['queue', 'status', businessId] });
          queryClient.refetchQueries({ queryKey: ['queue', 'me'] });
        }
      }
      wasConnectedRef.current = true;
    };

    socket.on('connect', handleConnect);

    return () => {
      socket.off('connect', handleConnect);
      if (socket.connected) {
        socket.emit('queue:unwatch', { businessId });
      }
    };
  }, [socket, businessId, owner, enabled, queryClient]);

  // Track wasConnectedRef
  useEffect(() => {
    if (status === 'connected') {
      wasConnectedRef.current = true;
    }
  }, [status]);

  // 2. Fallback polling: every 15s while NOT connected
  useEffect(() => {
    if (!enabled || !businessId) return;

    if (status === 'connected') {
      return; // Stop polling when connected
    }

    const intervalId = setInterval(() => {
      if (owner) {
        queryClient.refetchQueries({ queryKey: ['queue', 'owner', businessId] });
      } else {
        queryClient.refetchQueries({ queryKey: ['queue', 'status', businessId] });
        queryClient.refetchQueries({ queryKey: ['queue', 'me'] });
      }
      setLastUpdatedAt(new Date());
    }, 15000);

    return () => clearInterval(intervalId);
  }, [status, businessId, owner, enabled, queryClient]);

  // 3. Socket event listeners that update React Query cache directly
  useEffect(() => {
    if (!enabled || !socket) return;

    // Public queue updated
    const handleQueueUpdated = (data: PublicQueueStatus & { businessId: string }) => {
      if (businessId && data.businessId !== businessId) return;

      queryClient.setQueryData<PublicQueueStatus>(
        ['queue', 'status', data.businessId],
        (old) => {
          return {
            ...old,
            isOpen: data.isOpen,
            waitingCount: data.waitingCount,
            nowServing: data.nowServing,
            estimatedWaitMinutesForNewJoiner: data.estimatedWaitMinutesForNewJoiner,
            businessId: data.businessId,
          };
        }
      );
      setLastUpdatedAt(new Date());
    };

    // Owner queue updated
    const handleOwnerQueueUpdated = (data: OwnerQueueDetails) => {
      if (!owner || !businessId) return;

      queryClient.setQueryData<OwnerQueueDetails>(
        ['queue', 'owner', businessId],
        data
      );
      setLastUpdatedAt(new Date());
    };

    // Customer queue position updated
    const handleQueuePosition = (data: CustomerQueuePosition) => {
      queryClient.setQueryData<CustomerQueuePosition & { businessId?: string; businessName?: string }>(
        ['queue', 'me'],
        (old) => {
          if (!old) return data;
          return {
            ...old,
            ...data,
            businessId: data.businessId || old.businessId,
            businessName: data.businessName || old.businessName,
          };
        }
      );
      setLastUpdatedAt(new Date());
    };

    // Customer called
    const handleQueueCalled = (data: QueueCalledPayload) => {
      queryClient.setQueryData<any>(['queue', 'me'], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          status: 'called',
          ticketNumber: data.ticketNumber || old.ticketNumber,
        };
      });
      setLastUpdatedAt(new Date());
    };

    // Customer removed
    const handleQueueRemoved = (data: QueueRemovedPayload) => {
      queryClient.setQueryData<any>(['queue', 'me'], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          status: data.status,
        };
      });
      setLastUpdatedAt(new Date());
    };

    socket.on('queue:updated', handleQueueUpdated);
    socket.on('queue:owner-updated', handleOwnerQueueUpdated);
    socket.on('queue:position', handleQueuePosition);
    socket.on('queue:called', handleQueueCalled);
    socket.on('queue:removed', handleQueueRemoved);

    return () => {
      socket.off('queue:updated', handleQueueUpdated);
      socket.off('queue:owner-updated', handleOwnerQueueUpdated);
      socket.off('queue:position', handleQueuePosition);
      socket.off('queue:called', handleQueueCalled);
      socket.off('queue:removed', handleQueueRemoved);
    };
  }, [socket, businessId, owner, enabled, queryClient]);

  return {
    status,
    lastUpdatedAt,
  };
};
