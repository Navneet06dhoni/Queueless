import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queueApi } from '../api';
import { useQueueSocket } from '../hooks/useQueueSocket';
import { useToast } from '../components/ui/Toast';
import { formatTime } from '../utils/date';
import { playNotificationChime } from '../utils/sound';
import {
  Card,
  Badge,
  Button,
  Modal,
  Skeleton,
  EmptyState,
} from '../components/ui';
import {
  Users,
  Clock,
  Sparkles,
  CheckCircle2,
  Volume2,
  VolumeX,
  WifiOff,
  RefreshCw,
  LogOut,
  Building,
  BellRing,
} from 'lucide-react';

export const LiveQueuePage: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    return localStorage.getItem('queueless_sound_muted') === 'true';
  });

  // Track max position seen to compute fill percentage
  const maxPositionRef = useRef<number>(1);
  const originalTitleRef = useRef<string>(document.title);
  const userInteractedRef = useRef<boolean>(false);
  const prevStatusRef = useRef<string | null>(null);

  // Record user interaction for audio autoplay policy
  useEffect(() => {
    const handleInteraction = () => {
      userInteractedRef.current = true;
    };
    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('keydown', handleInteraction, { once: true });
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, []);

  // Fetch active queue entry
  const { data: queueData, isLoading, isError } = useQuery({
    queryKey: ['queue', 'me'],
    queryFn: () => queueApi.getMyActive(),
    retry: false,
    refetchInterval: false,
  });

  const businessId = queueData?.businessId || null;

  // Real-time socket sync
  const { status: socketStatus, lastUpdatedAt } = useQueueSocket(businessId, {
    enabled: !!businessId,
  });

  // Toggle Mute
  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    localStorage.setItem('queueless_sound_muted', String(next));
  };

  // Leave Queue Mutation
  const leaveMutation = useMutation({
    mutationFn: () => queueApi.leave(businessId!),
    onSuccess: () => {
      setIsLeaveModalOpen(false);
      queryClient.setQueryData(['queue', 'me'], (old: any) =>
        old ? { ...old, status: 'left' } : null
      );
      toast.info('You have left the queue');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Could not leave queue';
      toast.error(msg);
    },
  });

  // Manage Max Position for Progress Visual
  useEffect(() => {
    if (queueData?.position) {
      if (queueData.position > maxPositionRef.current) {
        maxPositionRef.current = queueData.position;
      }
    }
  }, [queueData?.position]);

  // Handle Called State: Title, Vibration, Sound
  const isCalled = queueData?.status === 'called';
  useEffect(() => {
    if (isCalled && prevStatusRef.current !== 'called') {
      document.title = 'It is your turn - QueueLess';

      // Vibrate if supported
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([200, 100, 200, 100, 200]);
        } catch {
          // Vibration not supported or permission denied
        }
      }

      // Play sound only if user interacted
      if (userInteractedRef.current && !isMuted) {
        playNotificationChime();
      }
    }

    prevStatusRef.current = queueData?.status || null;
    const initialTitle = originalTitleRef.current;

    return () => {
      document.title = initialTitle;
    };
  }, [isCalled, isMuted, queueData?.status]);

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
        <Skeleton className="h-10 w-1/3 mx-auto" />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }

  // Not in queue or ended
  if (isError || !queueData) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <EmptyState
          icon={<Users className="w-12 h-12 text-gray-400" />}
          title="You are not in any active queue"
          description="Explore registered businesses nearby and join their live virtual queue without standing in line."
          action={
            <Link to="/businesses">
              <Button variant="primary">Find Businesses</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const isCompletedOrRemoved = ['completed', 'skipped', 'left'].includes(queueData.status);

  if (isCompletedOrRemoved) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white capitalize">
            Queue Session {queueData.status}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {queueData.status === 'completed'
              ? 'Thank you! Your service has been completed.'
              : queueData.status === 'skipped'
              ? 'Your ticket was skipped by the service staff.'
              : 'You have left the virtual queue.'}
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Link to="/my-bookings">
            <Button variant="primary" size="sm">Go to My Bookings</Button>
          </Link>
          <Link to="/businesses">
            <Button variant="outline" size="sm">Find Another Service</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Calculate Progress Percentage (Fills as position approaches 1)
  const currentPos = queueData.position || 1;
  const maxPos = Math.max(maxPositionRef.current, currentPos);
  const progressPercent =
    isCalled ? 100 : Math.min(100, Math.max(15, Math.round(((maxPos - currentPos + 1) / (maxPos || 1)) * 100)));

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12 space-y-6">
      {/* Screen Reader Live Region */}
      <div aria-live="polite" className="sr-only">
        {isCalled
          ? `It is your turn! Ticket number ${queueData.ticketNumber} called.`
          : `You are in position ${queueData.position}. ${queueData.peopleAhead} people ahead of you.`}
      </div>

      {/* Top Bar: Business & Status Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
            <Building className="w-3.5 h-3.5" />
            <span>{queueData.businessName || 'Service Provider'}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
            Live Virtual Queue
          </h1>
        </div>

        {/* Audio Mute & Connection Indicator */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute queue chime' : 'Mute queue chime'}
            className="p-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
            title={isMuted ? 'Chime muted' : 'Chime active'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-primary-600" />}
          </button>

          {/* Connection Status Indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xs">
            {socketStatus === 'connected' ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-emerald-700 dark:text-emerald-400">Live</span>
              </>
            ) : socketStatus === 'reconnecting' ? (
              <>
                <RefreshCw className="w-3 h-3 text-amber-500 animate-spin" />
                <span className="text-amber-700 dark:text-amber-400">Reconnecting...</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-red-500" />
                <span className="text-gray-600 dark:text-gray-400">Offline, refreshing every 15 s</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Persistent Full-Width Called Alert */}
      {isCalled && (
        <div className="p-6 rounded-3xl bg-amber-500 text-white shadow-xl animate-bounce-subtle motion-reduce:animate-none space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/20 rounded-2xl">
              <BellRing className="w-8 h-8 text-white animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight">It is your turn!</h2>
              <p className="text-sm text-amber-100">
                Ticket #{queueData.ticketNumber} has been called. Please proceed to the service counter immediately.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Ticket Card */}
      <Card className="p-8 text-center space-y-8 relative overflow-hidden border-2 border-primary-100 dark:border-primary-950/60 shadow-xl">
        {/* State Banner */}
        <div>
          {isCalled ? (
            <Badge variant="warning" size="md" className="px-4 py-1 font-bold text-sm">
              Currently Serving
            </Badge>
          ) : queueData.position === 1 ? (
            <Badge variant="primary" size="md" className="px-4 py-1 font-bold text-sm bg-indigo-600 text-white animate-pulse motion-reduce:animate-none">
              <Sparkles className="w-3.5 h-3.5 mr-1" /> You are next, please be ready
            </Badge>
          ) : (
            <Badge variant="neutral" size="md" className="px-4 py-1 text-sm font-semibold">
              Waiting in Queue
            </Badge>
          )}
        </div>

        {/* Big Ticket Number */}
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wider text-gray-400 font-bold">
            Your Ticket Number
          </div>
          <div className="text-6xl sm:text-7xl font-black text-gray-900 dark:text-white tracking-tight">
            #{queueData.ticketNumber}
          </div>
        </div>

        {/* Position & Ahead Counter */}
        {!isCalled && (
          <div className="space-y-1">
            <div className="text-2xl sm:text-3xl font-extrabold text-primary-600 dark:text-primary-400">
              You are #{queueData.position}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {queueData.peopleAhead === 0
                ? 'No one ahead of you'
                : `${queueData.peopleAhead} ${queueData.peopleAhead === 1 ? 'person' : 'people'} ahead`}
            </p>
          </div>
        )}

        {/* Visual Progress Bar */}
        <div className="space-y-2 max-w-md mx-auto">
          <div className="h-3 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden p-0.5">
            <div
              className="h-full bg-primary-600 dark:bg-primary-500 rounded-full transition-all duration-700 ease-out motion-reduce:transition-none"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Joined</span>
            <span>{progressPercent}% to counter</span>
            <span>Serving</span>
          </div>
        </div>

        {/* Estimated Wait Card */}
        {!isCalled && (
          <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
            <Clock className="w-4 h-4 text-primary-600" />
            <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
              Estimated wait:
            </span>
            <span className="text-base font-bold text-gray-900 dark:text-white">
              ~{queueData.estimatedWaitMinutes} min
            </span>
          </div>
        )}

        {/* Leave Queue Button */}
        {!isCalled && (
          <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 dark:border-red-900/60 dark:hover:border-red-800"
              onClick={() => setIsLeaveModalOpen(true)}
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Leave Virtual Queue
            </Button>
          </div>
        )}
      </Card>

      {/* Footer Meta: Last Updated Timestamp in IST */}
      {lastUpdatedAt && (
        <div className="text-center text-xs text-gray-400">
          Last updated at {formatTime(lastUpdatedAt)} IST
        </div>
      )}

      {/* Leave Queue Confirmation Modal */}
      <Modal
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        title="Leave Virtual Queue"
        description="Are you sure you want to surrender ticket #{queueData.ticketNumber}? You will lose your current spot in line."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsLeaveModalOpen(false)}
            >
              Stay in Queue
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={leaveMutation.isPending}
              onClick={() => leaveMutation.mutate()}
            >
              Confirm Leave
            </Button>
          </>
        }
      >
        <p className="text-xs text-gray-500 dark:text-gray-400">
          If you leave now, you will need to re-join and be placed at the end of the waitlist.
        </p>
      </Modal>
    </div>
  );
};
