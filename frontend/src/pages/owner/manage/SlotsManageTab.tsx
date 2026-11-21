import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { businessApi } from '../../../api';
import { ISlot, AppointmentDetail } from '../../../api/types';
import { useToast } from '../../../components/ui/Toast';
import { formatDate, formatTime } from '../../../utils/date';
import {
  Card,
  Badge,
  Button,
  Input,
  Skeleton,
  EmptyState,
} from '../../../components/ui';
import {
  Calendar,
  Clock,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  User,
  Layers,
} from 'lucide-react';

interface SlotsManageTabProps {
  businessId: string;
}

export const SlotsManageTab: React.FC<SlotsManageTabProps> = ({ businessId }) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const todayStr = useMemo(() => formatDate(new Date(), 'yyyy-MM-dd'), []);

  // Fetch business detail to get services & working hours
  const { data: business, isLoading: isBizLoading } = useQuery({
    queryKey: ['business-detail', businessId],
    queryFn: () => businessApi.getBusinessDetail(businessId),
    enabled: !!businessId,
  });

  const services = useMemo(() => business?.services || [], [business?.services]);
  const workingHours = useMemo(() => business?.working_hours || [], [business?.working_hours]);

  // Selected service for slot generation and view
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');

  // Generation range state
  const [fromDate, setFromDate] = useState<string>(todayStr);
  const [toDate, setToDate] = useState<string>(() => {
    const next7Days = new Date();
    next7Days.setDate(next7Days.getDate() + 6);
    return formatDate(next7Days, 'yyyy-MM-dd');
  });

  // Day view date state
  const [viewDate, setViewDate] = useState<string>(todayStr);

  // Generation result state
  const [genResult, setGenResult] = useState<{ created: number; skipped: number } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  // Auto-select first service if none selected
  const activeServiceId = selectedServiceId || services[0]?.id || '';

  // Validate range: fromDate >= today, toDate >= fromDate, toDate - fromDate <= 30
  const validateDateRange = (from: string, to: string): boolean => {
    setRangeError(null);
    if (from < todayStr) {
      setRangeError('Start date cannot be in the past');
      return false;
    }
    if (to < from) {
      setRangeError('End date cannot be earlier than start date');
      return false;
    }
    const fromTime = new Date(from).getTime();
    const toTime = new Date(to).getTime();
    const diffDays = Math.round((toTime - fromTime) / (1000 * 60 * 60 * 24));
    if (diffDays > 30) {
      setRangeError('Date range cannot exceed 30 days per request');
      return false;
    }
    return true;
  };

  // Check if any working hours are missing for chosen days
  const hasWorkingHoursWarning = useMemo(() => {
    if (workingHours.length === 0) return true;
    if (!fromDate || !toDate || fromDate > toDate) return false;

    // Check each day in range
    const cur = new Date(fromDate);
    const end = new Date(toDate);
    const openDays = new Set(workingHours.map((wh) => wh.day_of_week));

    while (cur <= end) {
      const dayOfWeek = cur.getDay(); // 0 = Sun
      if (!openDays.has(dayOfWeek)) {
        return true;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return false;
  }, [workingHours, fromDate, toDate]);

  // Generate Slots Mutation
  const generateMutation = useMutation({
    mutationFn: () => {
      return businessApi.generateSlots(businessId, {
        service_id: activeServiceId,
        from_date: fromDate,
        to_date: toDate,
      });
    },
    onSuccess: (data) => {
      setGenResult(data);
      queryClient.invalidateQueries({ queryKey: ['slots', businessId] });
      toast.success(`Slots generated: ${data.created} created, ${data.skipped} skipped`);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Failed to generate slots';
      setRangeError(msg);
      toast.error(msg);
    },
  });

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeServiceId) {
      toast.error('Please select a service first');
      return;
    }
    if (!validateDateRange(fromDate, toDate)) {
      return;
    }
    generateMutation.mutate();
  };

  // Fetch slots for the day view
  const { data: slots, isLoading: isSlotsLoading } = useQuery({
    queryKey: ['slots', businessId, viewDate, activeServiceId],
    queryFn: () =>
      businessApi.getSlots(businessId, {
        date: viewDate,
        service_id: activeServiceId || undefined,
      }),
    enabled: !!businessId && !!viewDate && !!activeServiceId,
  });

  // Fetch appointments for customer details on booked slots
  const { data: appointments } = useQuery({
    queryKey: ['business-appointments', businessId, viewDate],
    queryFn: () => businessApi.getBusinessAppointments(businessId, viewDate),
    enabled: !!businessId && !!viewDate,
  });

  // Map booked slot id to appointment
  const slotAppointmentMap = useMemo(() => {
    const map = new Map<string, AppointmentDetail>();
    if (appointments) {
      appointments.forEach((appt) => {
        if (appt.slot?.id) {
          map.set(appt.slot.id, appt);
        } else if (appt.slot_id) {
          map.set(appt.slot_id, appt);
        }
      });
    }
    return map;
  }, [appointments]);

  if (isBizLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <Card className="p-8 text-center space-y-4">
        <EmptyState
          icon={<Layers className="w-12 h-12 text-gray-400" />}
          title="No services found"
          description="You need to create at least one service before generating booking slots."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Service Selector & Generator Form Card */}
      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary-600" />
            Generate Appointment Slots
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Automatically create bookable time slots based on your service duration and weekly working hours.
          </p>
        </div>

        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Service Dropdown */}
            <div>
              <label
                htmlFor="slot-service-select"
                className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
              >
                Select Service *
              </label>
              <select
                id="slot-service-select"
                value={activeServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {services.map((srv) => (
                  <option key={srv.id} value={srv.id}>
                    {srv.name} ({srv.duration_minutes}m • ₹{srv.price})
                  </option>
                ))}
              </select>
            </div>

            {/* From Date (min = today) */}
            <div>
              <label
                htmlFor="from-date"
                className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
              >
                From Date *
              </label>
              <Input
                id="from-date"
                type="date"
                min={todayStr}
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  validateDateRange(e.target.value, toDate);
                }}
              />
            </div>

            {/* To Date (max = 30 days) */}
            <div>
              <label
                htmlFor="to-date"
                className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
              >
                To Date (max 30 days) *
              </label>
              <Input
                id="to-date"
                type="date"
                min={fromDate || todayStr}
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  validateDateRange(fromDate, e.target.value);
                }}
              />
            </div>
          </div>

          {/* Range Error Alert */}
          {rangeError && (
            <div
              data-testid="slot-range-error"
              className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{rangeError}</span>
            </div>
          )}

          {/* Working Hours Warning */}
          {hasWorkingHoursWarning && (
            <div
              data-testid="no-working-hours-warning"
              className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div>
                <span className="font-bold">Working Hours Notice:</span> No working hours are configured for some or all days in the selected date range.
                Slots will only be generated for days with active operating hours.
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <span className="text-xs text-gray-400">
              Slots are generated idempotently: existing slots are preserved.
            </span>

            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={generateMutation.isPending || !!rangeError}
              isLoading={generateMutation.isPending}
            >
              <Sparkles className="w-4 h-4 mr-1.5" /> Generate Slots
            </Button>
          </div>
        </form>

        {/* Generation Results Banner */}
        {genResult && (
          <div
            data-testid="generation-result"
            className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-sm flex items-start gap-3"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <h4 className="font-bold">Slots Generation Completed</h4>
              <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-0.5">
                Successfully created <strong className="font-extrabold">{genResult.created}</strong> new slots.
                Skipped <strong className="font-extrabold">{genResult.skipped}</strong> existing or overlapping slots.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Day View: Slots List for Selected Date */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary-600" />
              Day View: Slots Schedule
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Inspect generated slots and booked customer names for any date.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="view-day-picker" className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              View Date:
            </label>
            <input
              id="view-day-picker"
              type="date"
              value={viewDate}
              onChange={(e) => setViewDate(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {isSlotsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        ) : !slots || slots.length === 0 ? (
          <Card className="p-8 text-center">
            <EmptyState
              icon={<Clock className="w-10 h-10 text-gray-400" />}
              title="No slots found for this date"
              description={`There are no generated slots for ${formatDate(viewDate, 'EEEE, dd MMMM yyyy')}. Use the generator above to create slots.`}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {slots.map((slot: ISlot) => {
              const isBooked = slot.status === 'booked';
              const appt = slotAppointmentMap.get(slot.id);

              return (
                <div
                  key={slot.id}
                  data-testid={`slot-card-${slot.id}`}
                  className={`p-4 rounded-2xl border transition-all ${
                    isBooked
                      ? 'bg-primary-50/50 dark:bg-primary-950/30 border-primary-200 dark:border-primary-900/40 shadow-xs'
                      : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-sm sm:text-base text-gray-900 dark:text-white">
                      {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                    </span>
                    <Badge
                      variant={isBooked ? 'primary' : 'success'}
                      size="sm"
                      className="capitalize font-bold text-[10px]"
                    >
                      {slot.status}
                    </Badge>
                  </div>

                  <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800/80 text-xs">
                    {isBooked ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-gray-900 dark:text-white truncate">
                          <User className="w-3.5 h-3.5 text-primary-600 shrink-0" />
                          <span className="truncate">{appt?.customer?.name || 'Customer Booked'}</span>
                        </div>
                        {appt?.customer?.email && (
                          <div className="text-[11px] text-gray-400 truncate">
                            {appt.customer.email}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400 italic">Available for booking</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
