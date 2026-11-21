import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { businessApi } from '../../../api';
import { IWorkingHour, WorkingHourInput } from '../../../api/types';
import { useToast } from '../../../components/ui/Toast';
import {
  Card,
  Button,
  Skeleton,
} from '../../../components/ui';
import {
  Save,
  Copy,
  AlertTriangle,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

const DAYS_OF_WEEK = [
  { index: 0, label: 'Sunday', isWeekend: true },
  { index: 1, label: 'Monday', isWeekend: false },
  { index: 2, label: 'Tuesday', isWeekend: false },
  { index: 3, label: 'Wednesday', isWeekend: false },
  { index: 4, label: 'Thursday', isWeekend: false },
  { index: 5, label: 'Friday', isWeekend: false },
  { index: 6, label: 'Saturday', isWeekend: true },
];

interface DayScheduleState {
  day_of_week: number;
  isOpen: boolean;
  open_time: string;
  close_time: string;
  error?: string;
}

interface WorkingHoursManageTabProps {
  businessId: string;
}

export const WorkingHoursManageTab: React.FC<WorkingHoursManageTabProps> = ({ businessId }) => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: business, isLoading } = useQuery({
    queryKey: ['business-detail', businessId],
    queryFn: () => businessApi.getBusinessDetail(businessId),
    enabled: !!businessId,
  });

  const [schedule, setSchedule] = useState<DayScheduleState[]>(() => {
    return DAYS_OF_WEEK.map((d) => ({
      day_of_week: d.index,
      isOpen: d.index >= 1 && d.index <= 5, // Default weekdays open
      open_time: '09:00',
      close_time: '18:00',
    }));
  });

  const [validationError, setValidationError] = useState<string | null>(null);

  // Sync state when business working hours data loads
  useEffect(() => {
    if (business?.working_hours) {
      const existingMap = new Map<number, IWorkingHour>();
      business.working_hours.forEach((wh) => {
        existingMap.set(wh.day_of_week, wh);
      });

      setSchedule(
        DAYS_OF_WEEK.map((d) => {
          const wh = existingMap.get(d.index);
          if (wh) {
            return {
              day_of_week: d.index,
              isOpen: true,
              open_time: wh.open_time.slice(0, 5),
              close_time: wh.close_time.slice(0, 5),
            };
          } else {
            return {
              day_of_week: d.index,
              isOpen: false,
              open_time: '09:00',
              close_time: '18:00',
            };
          }
        })
      );
    }
  }, [business?.working_hours]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (payload: WorkingHourInput[]) => businessApi.setWorkingHours(businessId, payload),
    onSuccess: (updatedHours) => {
      queryClient.setQueryData(['business-detail', businessId], (old: any) =>
        old ? { ...old, working_hours: updatedHours } : old
      );
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      toast.success('Weekly working hours saved successfully');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Failed to save working hours';
      setValidationError(msg);
      toast.error(msg);
    },
  });

  // Toggle open/closed for a day
  const handleToggleDay = (dayIndex: number) => {
    setValidationError(null);
    setSchedule((prev) =>
      prev.map((day) =>
        day.day_of_week === dayIndex
          ? { ...day, isOpen: !day.isOpen, error: undefined }
          : day
      )
    );
  };

  // Change open or close time
  const handleTimeChange = (
    dayIndex: number,
    field: 'open_time' | 'close_time',
    val: string
  ) => {
    setValidationError(null);
    setSchedule((prev) =>
      prev.map((day) => {
        if (day.day_of_week !== dayIndex) return day;
        const updated = { ...day, [field]: val };
        // Check if close_time > open_time
        if (updated.isOpen && updated.close_time <= updated.open_time) {
          updated.error = 'Close time must be later than open time';
        } else {
          updated.error = undefined;
        }
        return updated;
      })
    );
  };

  // Copy Monday to all weekdays (Tue-Fri)
  const handleCopyMondayToWeekdays = () => {
    setValidationError(null);
    const monday = schedule.find((d) => d.day_of_week === 1);
    if (!monday) return;

    setSchedule((prev) =>
      prev.map((d) => {
        if (d.day_of_week >= 2 && d.day_of_week <= 5) {
          return {
            ...d,
            isOpen: monday.isOpen,
            open_time: monday.open_time,
            close_time: monday.close_time,
            error: undefined,
          };
        }
        return d;
      })
    );

    toast.info('Copied Monday hours to Tuesday through Friday');
  };

  // Submit and save
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    let hasErrors = false;
    const validatedSchedule = schedule.map((day) => {
      if (day.isOpen) {
        if (!day.open_time || !day.close_time) {
          hasErrors = true;
          return { ...day, error: 'Open and close times are required' };
        }
        if (day.close_time <= day.open_time) {
          hasErrors = true;
          return { ...day, error: 'Close time must be later than open time' };
        }
      }
      return { ...day, error: undefined };
    });

    if (hasErrors) {
      setSchedule(validatedSchedule);
      setValidationError('Please fix close-time errors before saving');
      return;
    }

    // Prepare payload of open days only
    const payload: WorkingHourInput[] = validatedSchedule
      .filter((d) => d.isOpen)
      .map((d) => ({
        day_of_week: d.day_of_week,
        open_time: d.open_time,
        close_time: d.close_time,
      }));

    saveMutation.mutate(payload);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            Weekly Working Hours
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Set the open hours for each day of the week. Slots are generated strictly within these operating hours.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyMondayToWeekdays}
            className="text-xs"
          >
            <Copy className="w-3.5 h-3.5 mr-1" /> Copy Monday to Weekdays
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSave}
            isLoading={saveMutation.isPending}
            disabled={saveMutation.isPending}
          >
            <Save className="w-3.5 h-3.5 mr-1" /> Save Schedule
          </Button>
        </div>
      </div>

      {validationError && (
        <div
          data-testid="working-hours-error"
          className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* 7-Day Schedule Editor List */}
      <Card className="divide-y divide-gray-100 dark:divide-gray-800 p-0 overflow-hidden">
        {schedule.map((day) => {
          const dayMeta = DAYS_OF_WEEK.find((d) => d.index === day.day_of_week)!;

          return (
            <div
              key={day.day_of_week}
              data-testid={`day-row-${day.day_of_week}`}
              className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                !day.isOpen ? 'bg-gray-50/50 dark:bg-gray-900/40 opacity-80' : ''
              }`}
            >
              {/* Day Label & Open Toggle */}
              <div className="flex items-center justify-between sm:justify-start gap-4 sm:w-48">
                <span className="font-bold text-sm sm:text-base text-gray-900 dark:text-white">
                  {dayMeta.label}
                  {dayMeta.isWeekend && (
                    <span className="ml-2 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase">
                      Weekend
                    </span>
                  )}
                </span>

                <button
                  type="button"
                  onClick={() => handleToggleDay(day.day_of_week)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition ${
                    day.isOpen
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                      : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                  }`}
                  aria-label={`Toggle ${dayMeta.label} ${day.isOpen ? 'Open' : 'Closed'}`}
                >
                  {day.isOpen ? (
                    <>
                      <ToggleRight className="w-4 h-4" /> Open
                    </>
                  ) : (
                    <>
                      <ToggleLeft className="w-4 h-4" /> Closed
                    </>
                  )}
                </button>
              </div>

              {/* Time Inputs or Closed Notice */}
              <div className="flex-1">
                {day.isOpen ? (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <label
                          htmlFor={`open-${day.day_of_week}`}
                          className="text-xs text-gray-500 dark:text-gray-400 font-medium"
                        >
                          From:
                        </label>
                        <input
                          id={`open-${day.day_of_week}`}
                          type="time"
                          value={day.open_time}
                          onChange={(e) =>
                            handleTimeChange(day.day_of_week, 'open_time', e.target.value)
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <label
                          htmlFor={`close-${day.day_of_week}`}
                          className="text-xs text-gray-500 dark:text-gray-400 font-medium"
                        >
                          To:
                        </label>
                        <input
                          id={`close-${day.day_of_week}`}
                          type="time"
                          value={day.close_time}
                          onChange={(e) =>
                            handleTimeChange(day.day_of_week, 'close_time', e.target.value)
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                    </div>

                    {day.error && (
                      <p
                        data-testid={`error-day-${day.day_of_week}`}
                        className="text-xs text-red-500 font-medium"
                      >
                        {day.error}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-gray-400 italic">
                    Closed all day (no slots will be scheduled)
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </Card>

      <div className="flex justify-end pt-2">
        <Button
          type="button"
          variant="primary"
          onClick={handleSave}
          isLoading={saveMutation.isPending}
          disabled={saveMutation.isPending}
        >
          <Save className="w-4 h-4 mr-1.5" /> Save Working Hours Schedule
        </Button>
      </div>
    </div>
  );
};
