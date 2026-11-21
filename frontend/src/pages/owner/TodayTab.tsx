import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { businessApi, bookingApi, analyticsApi } from '../../api';
import { AppointmentDetail, NextAppointmentItem } from '../../api/types';
import { useToast } from '../../components/ui/Toast';
import { formatDate, formatTime } from '../../utils/date';
import {
  Card,
  Badge,
  Button,
  Modal,
  Skeleton,
  EmptyState,
} from '../../components/ui';
import {
  Calendar,
  User,
  CheckCircle,
  XCircle,
  Sparkles,
} from 'lucide-react';

interface TodayTabProps {
  businessId: string;
}

export const TodayTab: React.FC<TodayTabProps> = ({ businessId }) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const todayStr = formatDate(new Date(), 'yyyy-MM-dd');

  // Confirmation modal state
  const [actionTarget, setActionTarget] = useState<{
    appointment: AppointmentDetail;
    newStatus: 'completed' | 'no_show';
  } | null>(null);

  // 1. Fetch today's business appointments
  const {
    data: appointments,
    isLoading: isApptsLoading,
    refetch: refetchAppts,
  } = useQuery({
    queryKey: ['business-appointments', businessId, todayStr],
    queryFn: () => businessApi.getBusinessAppointments(businessId, todayStr),
  });

  // 2. Fetch today's metrics & next appointments
  const { data: todayMetrics, isLoading: isMetricsLoading } = useQuery({
    queryKey: ['analytics', 'today', businessId],
    queryFn: () => analyticsApi.getToday(businessId),
  });

  // Status mutation (completed or no_show)
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'completed' | 'no_show' }) =>
      bookingApi.updateAppointmentStatus(id, status),
    onSuccess: (_, vars) => {
      setActionTarget(null);
      queryClient.invalidateQueries({ queryKey: ['business-appointments', businessId] });
      queryClient.invalidateQueries({ queryKey: ['analytics', 'today', businessId] });
      toast.success(
        `Appointment marked as ${vars.status === 'completed' ? 'Completed' : 'No-Show'}`
      );
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Could not update status';
      toast.error(msg);
    },
  });

  if (isApptsLoading || isMetricsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  const apptList = appointments || [];
  const nextAppts = todayMetrics?.nextAppointments || [];
  const nowMs = Date.now();

  return (
    <div className="space-y-8">
      {/* Next Upcoming Appointments Preview (from Today endpoint) */}
      {nextAppts.length > 0 && (
        <Card className="p-5 space-y-4 bg-primary-50/40 dark:bg-primary-950/20 border-primary-100 dark:border-primary-900/30">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary-600" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              Next Upcoming Appointments
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {nextAppts.map((item: NextAppointmentItem) => (
              <div
                key={item.appointmentId}
                className="p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-xs space-y-1"
              >
                <div className="flex items-center justify-between text-xs text-primary-600 dark:text-primary-400 font-bold">
                  <span>{formatTime(item.startTime)} IST</span>
                  <Badge variant="neutral" size="sm">Upcoming</Badge>
                </div>
                <div className="text-sm font-bold text-gray-900 dark:text-white truncate">
                  {item.customerName}
                </div>
                <div className="text-xs text-gray-400 truncate">
                  {item.serviceName}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Full Today Appointments List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary-600" />
            Today's Scheduled Appointments ({apptList.length})
          </h3>
          <Button variant="outline" size="sm" onClick={() => refetchAppts()}>
            Refresh
          </Button>
        </div>

        {apptList.length === 0 ? (
          <EmptyState
            icon={<Calendar className="w-8 h-8 text-gray-400" />}
            title="No appointments scheduled for today"
            description="All slots are currently free or have been completed."
          />
        ) : (
          <div className="space-y-3">
            {apptList.map((appt) => {
              const startMs = new Date(appt.slot.start_time).getTime();
              const hasStarted = startMs <= nowMs;
              const isConfirmed = appt.status === 'confirmed';

              return (
                <div
                  key={appt.id}
                  className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-extrabold text-primary-600 dark:text-primary-400">
                        {formatTime(appt.slot.start_time)} IST
                      </span>
                      <span className="text-xs text-gray-400">
                        ({appt.service.duration_minutes} mins)
                      </span>
                      <Badge
                        variant={
                          appt.status === 'confirmed'
                            ? 'primary'
                            : appt.status === 'completed'
                            ? 'success'
                            : appt.status === 'no_show'
                            ? 'danger'
                            : 'neutral'
                        }
                        size="sm"
                        className="capitalize text-[10px]"
                      >
                        {appt.status.replace('_', ' ')}
                      </Badge>
                    </div>

                    <div className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <User className="w-3.5 h-3.5 text-gray-400" />
                      <span>{appt.customer?.name || 'Customer'}</span>
                      <span className="text-xs font-normal text-gray-400">
                        ({appt.customer?.email})
                      </span>
                    </div>

                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Service: <span className="font-semibold">{appt.service.name}</span> • ₹{appt.service.price}
                    </div>
                  </div>

                  {/* Actions for Confirmed appointments that have already started */}
                  {isConfirmed && (
                    <div className="flex items-center gap-2 shrink-0">
                      {hasStarted ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700"
                            onClick={() =>
                              setActionTarget({ appointment: appt, newStatus: 'completed' })
                            }
                          >
                            <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                            Mark Completed
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() =>
                              setActionTarget({ appointment: appt, newStatus: 'no_show' })
                            }
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1.5" />
                            Mark No-show
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400 italic">
                          Starts at {formatTime(appt.slot.start_time)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Confirmation Modal */}
      <Modal
        isOpen={!!actionTarget}
        onClose={() => setActionTarget(null)}
        title={
          actionTarget?.newStatus === 'completed'
            ? 'Mark Appointment as Completed?'
            : 'Mark Appointment as No-Show?'
        }
        description={`Customer: ${actionTarget?.appointment.customer?.name || 'Customer'}`}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant={actionTarget?.newStatus === 'completed' ? 'primary' : 'danger'}
              size="sm"
              className={actionTarget?.newStatus === 'completed' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
              isLoading={statusMutation.isPending}
              onClick={() => {
                if (actionTarget) {
                  statusMutation.mutate({
                    id: actionTarget.appointment.id,
                    status: actionTarget.newStatus,
                  });
                }
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {actionTarget?.newStatus === 'completed'
            ? 'This will record the appointment as successfully delivered.'
            : 'This will record the customer as absent, updating your no-show analytics.'}
        </p>
      </Modal>
    </div>
  );
};
