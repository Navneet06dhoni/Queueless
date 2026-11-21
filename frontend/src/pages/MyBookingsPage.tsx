import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bookingApi, businessApi, queueApi } from '../api';
import { AppointmentDetail } from '../api/types';
import { formatDate, formatTime, formatDateTime } from '../utils/date';
import { useToast } from '../components/ui/Toast';
import {
  Card,
  Badge,
  Button,
  Tabs,
  Modal,
  Pagination,
  Skeleton,
  EmptyState,
  ErrorState,
} from '../components/ui';
import {
  Calendar,
  AlertTriangle,
} from 'lucide-react';

export const MyBookingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming');
  const [page, setPage] = useState(1);
  const toast = useToast();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    document.title = 'My Bookings | QueueLess';
  }, []);

  // Check-In Mutation
  const checkInMutation = useMutation({
    mutationFn: ({ businessId, appointmentId }: { businessId: string; appointmentId: string }) =>
      queueApi.checkIn(businessId, appointmentId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
      toast.success(
        `Checked in successfully! You are ticket #${res.ticketNumber}, position ${res.position}.`
      );
      navigate('/queue');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Check-in failed';
      toast.error(msg);
    },
  });

  // Cancel Modal State
  const [cancelTarget, setCancelTarget] = useState<AppointmentDetail | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Reschedule Modal State
  const [rescheduleTarget, setRescheduleTarget] = useState<AppointmentDetail | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string>(formatDate(new Date(), 'yyyy-MM-dd'));
  const [newSelectedSlotId, setNewSelectedSlotId] = useState<string | null>(null);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-appointments', page],
    queryFn: ({ signal }) => bookingApi.getMyAppointments({ page, limit: 10 }, signal),
    staleTime: 15000,
  });

  const appointments = data?.data || [];
  const total = data?.total || 0;
  const limit = data?.limit || 10;

  // Filter into tabs
  const now = new Date().toISOString();
  const upcomingList = appointments.filter(
    (a) => a.status === 'confirmed' && a.slot.start_time > now
  );
  const pastList = appointments.filter(
    (a) =>
      a.status === 'completed' ||
      a.status === 'no_show' ||
      (a.status === 'confirmed' && a.slot.start_time <= now)
  );
  const cancelledList = appointments.filter((a) => a.status === 'cancelled');

  const currentTabItems =
    activeTab === 'upcoming'
      ? upcomingList
      : activeTab === 'past'
      ? pastList
      : cancelledList;

  // Cancel Mutation
  const cancelMutation = useMutation({
    mutationFn: (id: string) => bookingApi.cancelAppointment(id),
    onSuccess: () => {
      setCancelTarget(null);
      setCancelError(null);
      toast.success('Appointment cancelled successfully.');
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
    onError: (err: any) => {
      if (err.response?.data?.error?.message) {
        setCancelError(err.response.data.error.message);
      } else {
        setCancelError('Unable to cancel appointment.');
      }
    },
  });

  // Fetch free slots for rescheduling
  const { data: rescheduleSlots = [], isLoading: isRescheduleSlotsLoading } = useQuery({
    queryKey: [
      'reschedule-slots',
      rescheduleTarget?.business.id,
      rescheduleTarget?.service.id,
      rescheduleDate,
    ],
    queryFn: ({ signal }) =>
      businessApi.getSlots(
        rescheduleTarget!.business.id,
        {
          date: rescheduleDate,
          service_id: rescheduleTarget!.service.id,
        },
        signal
      ),
    enabled: !!rescheduleTarget && !!rescheduleDate,
  });

  // Reschedule Mutation
  const rescheduleMutation = useMutation({
    mutationFn: ({ id, newSlotId }: { id: string; newSlotId: string }) =>
      bookingApi.rescheduleAppointment(id, newSlotId),
    onSuccess: () => {
      setRescheduleTarget(null);
      setNewSelectedSlotId(null);
      setRescheduleError(null);
      toast.success('Appointment rescheduled successfully.');
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
    onError: (err: any) => {
      if (err.response?.data?.error?.message) {
        setRescheduleError(err.response.data.error.message);
      } else {
        setRescheduleError('Unable to reschedule appointment.');
      }
    },
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          My Bookings
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage your scheduled appointments, view history, or reschedule
        </p>
      </div>

      {/* Tabs */}
      <Tabs
        activeTab={activeTab}
        onChange={(tabId) => setActiveTab(tabId as any)}
        tabs={[
          { id: 'upcoming', label: 'Upcoming', count: upcomingList.length },
          { id: 'past', label: 'Past & Completed', count: pastList.length },
          { id: 'cancelled', label: 'Cancelled', count: cancelledList.length },
        ]}
      />

      {/* Bookings List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-6 space-y-4">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
            </Card>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Could not load bookings"
          message="An error occurred while fetching your appointments. Please try again."
          onRetry={() => refetch()}
        />
      ) : currentTabItems.length === 0 ? (
        <EmptyState
          icon={<Calendar className="w-8 h-8" />}
          title={`No ${activeTab} appointments`}
          description={
            activeTab === 'upcoming'
              ? 'You have no upcoming appointments. Find a business to book your next slot.'
              : `You have no ${activeTab} bookings on your account.`
          }
          action={
            activeTab === 'upcoming' && (
              <Button variant="primary" size="sm" onClick={() => (window.location.href = '/businesses')}>
                Find Businesses
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {currentTabItems.map((appt) => {
              const statusBadges: Record<string, { label: string; variant: 'success' | 'primary' | 'danger' | 'warning' }> = {
                confirmed: { label: 'Confirmed', variant: 'success' },
                completed: { label: 'Completed', variant: 'primary' },
                cancelled: { label: 'Cancelled', variant: 'danger' },
                no_show: { label: 'No Show', variant: 'warning' },
              };

              const badge = statusBadges[appt.status] || { label: appt.status, variant: 'warning' };

              return (
                <Card key={appt.id} className="p-6 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-lg text-gray-900 dark:text-white">
                          {appt.business.name}
                        </h3>
                        <p className="text-xs text-gray-500 capitalize">
                          {appt.business.category} • {appt.business.city}
                        </p>
                      </div>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>

                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Service:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {appt.service.name}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Duration:</span>
                        <span className="text-gray-700 dark:text-gray-300">
                          {appt.service.duration_minutes} mins
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Time (IST):</span>
                        <span className="font-bold text-primary-600 dark:text-primary-400">
                          {formatDateTime(appt.slot.start_time)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions for upcoming bookings */}
                  {activeTab === 'upcoming' && appt.status === 'confirmed' && (
                    <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-end gap-2">
                      {(() => {
                        const nowMs = Date.now();
                        const startMs = new Date(appt.slot.start_time).getTime();
                        const diffMinutes = (startMs - nowMs) / (60 * 1000);
                        // Start time is within 30 minutes before or after now (IST)
                        const isWithin30MinWindow = diffMinutes >= -30 && diffMinutes <= 30;
                        if (!isWithin30MinWindow) return null;

                        const isPending =
                          checkInMutation.isPending &&
                          (checkInMutation.variables as any)?.appointmentId === appt.id;

                        return (
                          <Button
                            variant="primary"
                            size="sm"
                            isLoading={isPending}
                            onClick={() =>
                              checkInMutation.mutate({
                                businessId: appt.business.id,
                                appointmentId: appt.id,
                              })
                            }
                          >
                            Check in and join the queue
                          </Button>
                        );
                      })()}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRescheduleTarget(appt);
                          setRescheduleDate(formatDate(appt.slot.start_time, 'yyyy-MM-dd'));
                          setNewSelectedSlotId(null);
                          setRescheduleError(null);
                        }}
                      >
                        Reschedule
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setCancelTarget(appt);
                          setCancelError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <Pagination
            page={page}
            total={total}
            limit={limit}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      )}

      {/* Cancellation Modal */}
      <Modal
        isOpen={!!cancelTarget}
        onClose={() => {
          setCancelTarget(null);
          setCancelError(null);
        }}
        title="Cancel Appointment"
        description="Are you sure you want to cancel this booking?"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCancelTarget(null);
                setCancelError(null);
              }}
            >
              Keep Booking
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={cancelMutation.isPending}
              onClick={() => {
                if (cancelTarget) {
                  cancelMutation.mutate(cancelTarget.id);
                }
              }}
            >
              Confirm Cancellation
            </Button>
          </>
        }
      >
        {cancelError && (
          <div
            role="alert"
            className="mb-4 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-600 dark:text-red-400 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{cancelError}</span>
          </div>
        )}

        {cancelTarget && (
          <div className="text-xs text-gray-600 dark:text-gray-300 space-y-2">
            <p>
              Cancelling appointment for <span className="font-bold text-gray-900 dark:text-white">{cancelTarget.service.name}</span> at{' '}
              <span className="font-bold text-gray-900 dark:text-white">{cancelTarget.business.name}</span>.
            </p>
            <p className="text-gray-500">
              Scheduled for: {formatDateTime(cancelTarget.slot.start_time)}
            </p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              * Note: Cancellations within 60 minutes of start time are not allowed per business policy.
            </p>
          </div>
        )}
      </Modal>

      {/* Reschedule Modal */}
      <Modal
        isOpen={!!rescheduleTarget}
        onClose={() => {
          setRescheduleTarget(null);
          setNewSelectedSlotId(null);
          setRescheduleError(null);
        }}
        title="Reschedule Appointment"
        description="Select a new available date and time slot for the same service."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRescheduleTarget(null);
                setNewSelectedSlotId(null);
                setRescheduleError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!newSelectedSlotId}
              isLoading={rescheduleMutation.isPending}
              onClick={() => {
                if (rescheduleTarget && newSelectedSlotId) {
                  rescheduleMutation.mutate({
                    id: rescheduleTarget.id,
                    newSlotId: newSelectedSlotId,
                  });
                }
              }}
            >
              Confirm Reschedule
            </Button>
          </>
        }
      >
        {rescheduleError && (
          <div
            role="alert"
            className="mb-4 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-600 dark:text-red-400 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{rescheduleError}</span>
          </div>
        )}

        {rescheduleTarget && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                Target Date (YYYY-MM-DD):
              </label>
              <input
                type="date"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Available Slots:
              </label>
              {isRescheduleSlotsLoading ? (
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((n) => (
                    <Skeleton key={n} className="h-9 rounded-lg" />
                  ))}
                </div>
              ) : rescheduleSlots.filter((s) => s.status === 'free').length === 0 ? (
                <p className="text-xs text-gray-400 italic">No free slots on this date.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                  {rescheduleSlots
                    .filter((s) => s.status === 'free')
                    .map((slot) => {
                      const isSelected = newSelectedSlotId === slot.id;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => setNewSelectedSlotId(slot.id)}
                          className={`p-2 rounded-lg border text-xs font-semibold transition-all ${
                            isSelected
                              ? 'bg-primary-600 text-white border-primary-600'
                              : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-primary-500'
                          }`}
                        >
                          {formatTime(slot.start_time)}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
