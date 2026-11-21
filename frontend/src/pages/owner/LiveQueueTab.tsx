import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queueApi, analyticsApi } from '../../api';
import { OwnerQueueWaitingItem } from '../../api/types';
import { useQueueSocket } from '../../hooks/useQueueSocket';
import { useToast } from '../../components/ui/Toast';
import { formatTime, formatDateTime } from '../../utils/date';
import {
  Card,
  Badge,
  Button,
  Input,
  Modal,
  Skeleton,
  EmptyState,
} from '../../components/ui';
import {
  Users,
  Clock,
  PhoneCall,
  CheckCircle,
  SkipForward,
  UserPlus,
  AlertTriangle,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

interface LiveQueueTabProps {
  businessId: string;
}

export const LiveQueueTab: React.FC<LiveQueueTabProps> = ({ businessId }) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  // Walk-in form state
  const [walkInName, setWalkInName] = useState('');
  const [walkInError, setWalkInError] = useState<string | null>(null);

  // Skip Modal State
  const [isSkipModalOpen, setIsSkipModalOpen] = useState(false);

  // Close Queue Confirmation Modal State
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);

  // Track double click safety for Call Next
  const [isCallingNext, setIsCallingNext] = useState(false);

  // Highlight new arrivals
  const prevWaitingIdsRef = useRef<Set<string>>(new Set());
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());

  // Real-time socket sync for Owner
  useQueueSocket(businessId, { owner: true });

  // 1. Fetch full owner queue details
  const {
    data: queueDetails,
    isLoading: isQueueLoading,
    refetch: refetchQueue,
  } = useQuery({
    queryKey: ['queue', 'owner', businessId],
    queryFn: () => queueApi.getOwnerQueue(businessId),
    refetchInterval: false,
  });

  // 2. Fetch public status to know if queue is open
  const { data: publicStatus } = useQuery({
    queryKey: ['queue', 'status', businessId],
    queryFn: () => queueApi.getPublicStatus(businessId),
  });

  // 3. Fetch today's metrics
  const { data: todayMetrics } = useQuery({
    queryKey: ['analytics', 'today', businessId],
    queryFn: () => analyticsApi.getToday(businessId),
  });

  // Highlight new arrival rows
  useEffect(() => {
    if (queueDetails?.waiting) {
      const currentIds = new Set<string>(queueDetails.waiting.map((w: OwnerQueueWaitingItem) => w.id));
      const newlyAdded: string[] = [];

      currentIds.forEach((id) => {
        if (!prevWaitingIdsRef.current.has(id)) {
          newlyAdded.push(id);
        }
      });

      if (newlyAdded.length > 0 && prevWaitingIdsRef.current.size > 0) {
        setHighlightedIds(new Set(newlyAdded));
        const timer = setTimeout(() => {
          setHighlightedIds(new Set());
        }, 3000);
        return () => clearTimeout(timer);
      }

      prevWaitingIdsRef.current = currentIds;
    }
  }, [queueDetails?.waiting]);

  // Running timer for current customer
  const currentCustomer = queueDetails?.current || null;
  const [servedSeconds, setServedSeconds] = useState(0);

  useEffect(() => {
    if (!currentCustomer?.calledAt) {
      setServedSeconds(0);
      return;
    }

    const startTime = new Date(currentCustomer.calledAt).getTime();
    const updateElapsed = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
      setServedSeconds(elapsed);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [currentCustomer?.calledAt]);

  const formatServedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // MUTATIONS

  // Call Next Customer
  const callNextMutation = useMutation({
    mutationFn: () => queueApi.callNext(businessId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['queue', 'owner', businessId] });
      queryClient.invalidateQueries({ queryKey: ['analytics', 'today', businessId] });
      toast.success(`Called ticket #${data.current.ticketNumber} (${data.current.name})`);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Could not call next';
      toast.info(msg);
    },
    onSettled: () => {
      setIsCallingNext(false);
    },
  });

  const handleCallNext = useCallback(() => {
    if (isCallingNext || callNextMutation.isPending) return;
    setIsCallingNext(true);
    callNextMutation.mutate();
  }, [isCallingNext, callNextMutation]);

  // Complete Current Customer
  const completeMutation = useMutation({
    mutationFn: () => queueApi.completeCurrent(businessId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue', 'owner', businessId] });
      queryClient.invalidateQueries({ queryKey: ['analytics', 'today', businessId] });
      toast.success('Completed current customer');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Could not complete customer';
      toast.error(msg);
    },
  });

  // Skip Current Customer
  const skipMutation = useMutation({
    mutationFn: (requeue: boolean) => queueApi.skipCurrent(businessId, requeue),
    onSuccess: (_, requeue) => {
      setIsSkipModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['queue', 'owner', businessId] });
      queryClient.invalidateQueries({ queryKey: ['analytics', 'today', businessId] });
      toast.info(requeue ? 'Skipped and moved to end of queue' : 'Customer skipped permanently');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Could not skip customer';
      toast.error(msg);
    },
  });

  // Add Walk-in
  const walkInMutation = useMutation({
    mutationFn: (name: string) => queueApi.addWalkIn(businessId, name),
    onSuccess: (data) => {
      setWalkInName('');
      setWalkInError(null);
      queryClient.invalidateQueries({ queryKey: ['queue', 'owner', businessId] });
      toast.success(`Walk-in added! Ticket #${data.ticketNumber}, position ${data.position}`);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Could not add walk-in';
      setWalkInError(msg);
      toast.error(msg);
    },
  });

  const handleAddWalkIn = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = walkInName.trim();
    if (!trimmed) {
      setWalkInError('Please enter a name for the walk-in customer');
      return;
    }
    if (trimmed.length > 80) {
      setWalkInError('Walk-in name must be under 80 characters');
      return;
    }
    setWalkInError(null);
    walkInMutation.mutate(trimmed);
  };

  // Toggle Open/Close
  const toggleOpenMutation = useMutation({
    mutationFn: (open: boolean) => queueApi.toggleQueueOpen(businessId, open),
    onSuccess: (data) => {
      setIsCloseModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['queue', 'status', businessId] });
      toast.success(data.queue_open ? 'Queue is now OPEN' : 'Queue is now CLOSED');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Could not update queue status';
      toast.error(msg);
    },
  });

  const handleToggleClick = () => {
    const isCurrentlyOpen = publicStatus?.isOpen ?? true;
    if (isCurrentlyOpen) {
      // Check if people are waiting
      const waitingCount = queueDetails?.waitingCount || 0;
      if (waitingCount > 0) {
        setIsCloseModalOpen(true);
        return;
      }
      toggleOpenMutation.mutate(false);
    } else {
      toggleOpenMutation.mutate(true);
    }
  };

  // Keyboard shortcut "n" for Call Next
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'n' || e.key === 'N') {
        const activeEl = document.activeElement;
        const isInputFocused =
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            (activeEl as HTMLElement).isContentEditable);

        const isAnyModalOpen = isSkipModalOpen || isCloseModalOpen;

        if (!isInputFocused && !isAnyModalOpen) {
          e.preventDefault();
          handleCallNext();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSkipModalOpen, isCloseModalOpen, handleCallNext]);

  const avgWaitToday = todayMetrics?.averageWaitMinutesToday ?? 15;
  const isQueueOpen = publicStatus?.isOpen ?? true;

  if (isQueueLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  const waitingList = queueDetails?.waiting || [];

  return (
    <div className="space-y-8">
      {/* Top Controls: Queue Open/Close & Quick Counters */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-xs">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Queue Acceptance:
          </span>
          <button
            type="button"
            onClick={handleToggleClick}
            disabled={toggleOpenMutation.isPending}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${
              isQueueOpen
                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                : 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400'
            }`}
          >
            {isQueueOpen ? (
              <>
                <ToggleRight className="w-4 h-4" /> Open (Accepting)
              </>
            ) : (
              <>
                <ToggleLeft className="w-4 h-4" /> Closed
              </>
            )}
          </button>
        </div>

        {/* Counters */}
        <div className="flex flex-wrap items-center gap-6 text-xs text-gray-500 dark:text-gray-400">
          <div>
            Waiting now:{' '}
            <strong className="text-base text-gray-900 dark:text-white font-bold ml-1">
              {queueDetails?.waitingCount ?? 0}
            </strong>
          </div>
          <div>
            Served today:{' '}
            <strong className="text-base text-gray-900 dark:text-white font-bold ml-1">
              {queueDetails?.servedToday ?? 0}
            </strong>
          </div>
          <div>
            Avg wait today:{' '}
            <strong className="text-base text-gray-900 dark:text-white font-bold ml-1">
              {todayMetrics?.averageWaitMinutesToday !== null && todayMetrics?.averageWaitMinutesToday !== undefined
                ? `${todayMetrics.averageWaitMinutesToday}m`
                : '—'}
            </strong>
          </div>
        </div>
      </div>

      {/* Hero Now Serving & Next Actions Card (Optimized for reception tablet / mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Now Serving Card (Large touch target) */}
        <Card className="lg:col-span-7 p-6 sm:p-8 space-y-6 bg-gradient-to-br from-white to-gray-50/50 dark:from-gray-900 dark:to-gray-900/50 border-2 border-primary-200 dark:border-primary-900/40">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-extrabold tracking-wider text-primary-600 dark:text-primary-400 flex items-center gap-1.5">
              <PhoneCall className="w-4 h-4" /> Now Serving
            </span>
            {currentCustomer && (
              <Badge variant="warning" size="sm" className="font-mono">
                Duration: {formatServedTime(servedSeconds)}
              </Badge>
            )}
          </div>

          {currentCustomer ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-5xl sm:text-6xl font-black text-gray-900 dark:text-white tracking-tight">
                  #{currentCustomer.ticketNumber}
                </div>
                <Badge variant="primary" size="md" className="capitalize">
                  {currentCustomer.source.replace('_', ' ')}
                </Badge>
              </div>

              <div className="space-y-1">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                  {currentCustomer.name}
                </h2>
                <p className="text-xs text-gray-400">
                  Called at {formatTime(currentCustomer.calledAt)} IST
                </p>
              </div>

              {/* Complete & Skip Action Buttons */}
              <div className="pt-4 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  size="md"
                  className="flex-1 justify-center py-3 text-sm font-bold bg-emerald-600 hover:bg-emerald-700"
                  isLoading={completeMutation.isPending}
                  onClick={() => completeMutation.mutate()}
                >
                  <CheckCircle className="w-4 h-4 mr-2" /> Complete Service
                </Button>
                <Button
                  variant="outline"
                  size="md"
                  className="justify-center py-3 text-sm text-gray-700 dark:text-gray-300"
                  onClick={() => setIsSkipModalOpen(true)}
                >
                  <SkipForward className="w-4 h-4 mr-1.5" /> Skip...
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center space-y-3">
              <div className="w-16 h-16 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400">
                <Users className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-gray-700 dark:text-gray-300">
                No customer currently being served
              </h3>
              <p className="text-xs text-gray-400 max-w-sm mx-auto">
                Press "Call Next Customer" or the keyboard shortcut "N" to advance the virtual queue.
              </p>
            </div>
          )}
        </Card>

        {/* Primary Action & Walk-In Box */}
        <div className="lg:col-span-5 space-y-6">
          {/* Very Large Call Next Button */}
          <div className="space-y-1.5">
            <Button
              variant="primary"
              size="lg"
              disabled={isCallingNext || callNextMutation.isPending || waitingList.length === 0}
              isLoading={callNextMutation.isPending || isCallingNext}
              onClick={handleCallNext}
              className="w-full py-5 text-lg sm:text-xl font-black shadow-lg rounded-2xl justify-center bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] transition-transform"
            >
              <PhoneCall className="w-5 h-5 mr-2" />
              Call Next Customer
              <span className="text-xs font-normal opacity-75 ml-2 border border-white/30 px-1.5 py-0.5 rounded">
                (Press N)
              </span>
            </Button>
            {waitingList.length === 0 && (
              <p className="text-[11px] text-gray-400 text-center">
                Waitlist is currently empty
              </p>
            )}
          </div>

          {/* Add Walk-in Box */}
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
              <UserPlus className="w-4 h-4 text-primary-600" /> Add Walk-in Customer
            </h3>
            <form onSubmit={handleAddWalkIn} className="space-y-3">
              <Input
                placeholder="Walk-in Customer Name (max 80 chars)"
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                maxLength={80}
                error={walkInError || undefined}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="w-full justify-center"
                isLoading={walkInMutation.isPending}
              >
                Add to Virtual Queue
              </Button>
            </form>
          </Card>
        </div>
      </div>

      {/* Waiting List Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Waiting List ({waitingList.length})
            </h3>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchQueue()}
            className="text-xs"
          >
            Refresh
          </Button>
        </div>

        {waitingList.length === 0 ? (
          <EmptyState
            icon={<Users className="w-8 h-8 text-gray-400" />}
            title="No one is waiting"
            description="When online customers or walk-ins join your queue, they will appear here in chronological order."
          />
        ) : (
          <div className="space-y-2.5">
            {waitingList.map((item: OwnerQueueWaitingItem, index: number) => {
              const position = index + 1;
              const waitingSinceDate = new Date(item.waitingSince);
              const minutesWaiting = Math.floor(
                (Date.now() - waitingSinceDate.getTime()) / (60 * 1000)
              );
              const isLongWait = minutesWaiting > avgWaitToday * 2 && avgWaitToday > 0;
              const isNewlyAdded = highlightedIds.has(item.id);

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-wrap items-center justify-between gap-4 ${
                    isNewlyAdded
                      ? 'bg-primary-50 dark:bg-primary-950/60 border-primary-500 scale-[1.01] motion-reduce:transform-none'
                      : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 hover:border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center font-black text-gray-700 dark:text-gray-300 shrink-0 text-sm">
                      #{position}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-base text-gray-900 dark:text-white truncate">
                          #{item.ticketNumber} — {item.name}
                        </span>
                        <Badge variant="neutral" size="sm" className="capitalize text-[10px]">
                          {item.source.replace('_', ' ')}
                        </Badge>
                        {isLongWait && (
                          <Badge variant="danger" size="sm" className="text-[10px] flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> &gt;2x Avg Wait
                          </Badge>
                        )}
                      </div>
                      <div
                        className="text-xs text-gray-400 mt-0.5 flex items-center gap-1 cursor-help"
                        title={`Joined at: ${formatDateTime(item.waitingSince)} IST`}
                      >
                        <Clock className="w-3 h-3" />
                        <span>Waiting for {minutesWaiting} mins (since {formatTime(item.waitingSince)} IST)</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Skip Choice Modal */}
      <Modal
        isOpen={isSkipModalOpen}
        onClose={() => setIsSkipModalOpen(false)}
        title="Skip Current Customer"
        description="Choose how to handle the customer currently being served."
        footer={
          <div className="flex flex-col sm:flex-row justify-end gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSkipModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isLoading={skipMutation.isPending}
              onClick={() => skipMutation.mutate(true)}
            >
              Skip and move to the end
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={skipMutation.isPending}
              onClick={() => skipMutation.mutate(false)}
            >
              Skip permanently
            </Button>
          </div>
        }
      >
        <p className="text-xs text-gray-500 dark:text-gray-400">
          "Move to end" will re-insert this customer at the back of the queue with their original ticket number.
        </p>
      </Modal>

      {/* Close Queue Confirmation Modal */}
      <Modal
        isOpen={isCloseModalOpen}
        onClose={() => setIsCloseModalOpen(false)}
        title="Close Queue While Customers Waiting?"
        description={`There are currently ${queueDetails?.waitingCount ?? 0} customers waiting in line.`}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCloseModalOpen(false)}
            >
              Keep Queue Open
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={toggleOpenMutation.isPending}
              onClick={() => toggleOpenMutation.mutate(false)}
            >
              Confirm Close Queue
            </Button>
          </>
        }
      >
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Closing the queue prevents new customers from joining. Existing waiting customers can still be called.
        </p>
      </Modal>
    </div>
  );
};
