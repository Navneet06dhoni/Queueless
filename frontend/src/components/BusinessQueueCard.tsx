import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queueApi } from '../api';
import { useAuth } from '../context/AuthContext';
import { useQueueSocket } from '../hooks/useQueueSocket';
import { useToast } from './ui/Toast';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Users, Clock, AlertCircle, ArrowRight } from 'lucide-react';

interface BusinessQueueCardProps {
  businessId: string;
}

export const BusinessQueueCard: React.FC<BusinessQueueCardProps> = ({ businessId }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [joinError, setJoinError] = useState<string | null>(null);

  // Real-time socket sync
  useQueueSocket(businessId);

  // Fetch public queue status
  const { data: queueStatus, isLoading, error: statusError } = useQuery({
    queryKey: ['queue', 'status', businessId],
    queryFn: () => queueApi.getPublicStatus(businessId),
    refetchInterval: (query) => {
      const s = (query.state.error as any)?.response?.status;
      return s === 502 || s === 503 ? 15000 : false;
    },
  });

  // Check if customer already in active queue
  const isCustomer = user?.role === 'customer';
  const { data: myQueue, error: myQueueError } = useQuery({
    queryKey: ['queue', 'me'],
    queryFn: () => queueApi.getMyActive(),
    enabled: isCustomer,
    retry: false,
    refetchInterval: (query) => {
      const s = (query.state.error as any)?.response?.status;
      return s === 502 || s === 503 ? 15000 : false;
    },
  });

  const isOutage =
    (statusError as any)?.response?.status === 502 ||
    (statusError as any)?.response?.status === 503 ||
    (statusError as any)?.response?.data?.error?.code === 'UPSTREAM_UNAVAILABLE' ||
    (myQueueError as any)?.response?.status === 502 ||
    (myQueueError as any)?.response?.status === 503 ||
    (myQueueError as any)?.response?.data?.error?.code === 'UPSTREAM_UNAVAILABLE';

  const alreadyInQueue = !!myQueue && (myQueue.status === 'waiting' || myQueue.status === 'called');

  const joinMutation = useMutation({
    mutationFn: () => queueApi.join(businessId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      toast.success(`Joined queue! You are ticket #${data.ticketNumber}, position ${data.position}`);
      navigate('/queue');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Could not join virtual queue';
      setJoinError(msg);
      toast.error(msg);
    },
  });

  const handleJoinClick = () => {
    setJoinError(null);
    if (!user) {
      navigate('/login', { state: { from: `/businesses/${businessId}` } });
      return;
    }
    joinMutation.mutate();
  };

  const isOwnerOrAdmin = user?.role === 'owner' || user?.role === 'admin';
  const isOpen = queueStatus?.isOpen ?? false;

  // Determine disable reason
  let disableReason = '';
  if (isOutage) {
    disableReason = 'The queue service is temporarily unavailable, retrying';
  } else if (!isOpen) {
    disableReason = 'Queue is closed';
  } else if (alreadyInQueue) {
    disableReason = 'You are already in an active queue';
  }

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-gray-800/80 border border-gray-100 dark:border-gray-800 shadow-soft max-w-sm w-full space-y-4">
      {/* Header & Status Badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
          <Users className="w-4 h-4 text-primary-600" />
          <span>Live Virtual Queue</span>
        </div>
        {isLoading ? (
          <Badge variant="neutral" size="sm">Loading...</Badge>
        ) : isOpen ? (
          <Badge variant="success" size="sm">Open</Badge>
        ) : (
          <Badge variant="danger" size="sm">Closed</Badge>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-3 gap-2 py-1 text-center border-y border-gray-100 dark:border-gray-800">
        <div className="p-2 rounded-xl bg-gray-50 dark:bg-gray-900/50">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Waiting</div>
          <div className="text-base font-bold text-gray-900 dark:text-white">
            {isLoading ? '...' : (queueStatus?.waitingCount ?? 0)}
          </div>
        </div>
        <div className="p-2 rounded-xl bg-gray-50 dark:bg-gray-900/50">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Now Serving</div>
          <div className="text-base font-bold text-primary-600 dark:text-primary-400">
            {isLoading ? '...' : queueStatus?.nowServing ? `#${queueStatus.nowServing}` : '—'}
          </div>
        </div>
        <div className="p-2 rounded-xl bg-gray-50 dark:bg-gray-900/50">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Est. Wait</div>
          <div className="text-base font-bold text-gray-900 dark:text-white flex items-center justify-center gap-0.5">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <span>{isLoading ? '...' : `${queueStatus?.estimatedWaitMinutesForNewJoiner ?? 0}m`}</span>
          </div>
        </div>
      </div>

      {/* Error or Disable Message */}
      {joinError && (
        <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{joinError}</span>
        </div>
      )}

      {/* Already In Queue Link */}
      {alreadyInQueue && (
        <div className="p-2.5 rounded-xl bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 text-xs flex items-center justify-between">
          <span>You have an active ticket #{myQueue.ticketNumber}</span>
          <Link to="/queue" className="font-semibold underline flex items-center gap-1">
            View <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      )}

      {/* Action Button: Hidden for Owners and Admins */}
      {!isOwnerOrAdmin && (
        <div>
          <Button
            variant="primary"
            size="sm"
            className="w-full justify-center"
            disabled={isOutage || !isOpen || alreadyInQueue || joinMutation.isPending}
            isLoading={joinMutation.isPending}
            onClick={handleJoinClick}
            title={disableReason}
          >
            {disableReason || (user ? 'Join Live Queue' : 'Login to Join Queue')}
          </Button>
          {disableReason && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center mt-1.5">
              {disableReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
