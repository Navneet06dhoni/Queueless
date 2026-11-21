import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { businessApi, bookingApi } from '../api';
import { ISlot } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { formatDate, formatTime, formatDateTime } from '../utils/date';
import { BusinessQueueCard } from '../components/BusinessQueueCard';
import {
  Card,
  Badge,
  Button,
  Modal,
  Skeleton,
  ErrorState,
  EmptyState,
} from '../components/ui';
import {
  MapPin,
  Phone,
  Clock,
  Calendar,
  AlertCircle,
  IndianRupee,
  Sparkles,
} from 'lucide-react';

const DAYS_OF_WEEK = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const BusinessDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();

  // Generate next 14 calendar dates starting today in Asia/Kolkata
  const next14Days = useMemo(() => {
    const dates: { dateStr: string; label: string; dayName: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = formatDate(d, 'yyyy-MM-dd');
      const label = formatDate(d, 'dd MMM');
      const dayName = formatDate(d, 'EEE');
      dates.push({ dateStr, label, dayName });
    }
    return dates;
  }, []);

  const [selectedDate, setSelectedDate] = useState<string>(next14Days[0]?.dateStr || '');
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<ISlot | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // 1. Fetch Business Detail
  const {
    data: business,
    isLoading: isBizLoading,
    isError: isBizError,
    refetch: refetchBiz,
  } = useQuery({
    queryKey: ['business', id],
    queryFn: ({ signal }) => businessApi.getBusinessDetail(id!, signal),
    enabled: !!id,
    staleTime: 60000,
  });

  // Automatically select first service once loaded
  const services = useMemo(() => business?.services || [], [business?.services]);
  const currentService = useMemo(() => {
    if (!services.length) return null;
    return services.find((s) => s.id === selectedServiceId) || services[0];
  }, [services, selectedServiceId]);

  const activeServiceId = currentService?.id || '';

  // 2. Fetch Slots for selected service and date
  const {
    data: slots = [],
    isLoading: isSlotsLoading,
    refetch: refetchSlots,
  } = useQuery({
    queryKey: ['slots', id, activeServiceId, selectedDate],
    queryFn: ({ signal }) =>
      businessApi.getSlots(
        id!,
        {
          date: selectedDate,
          service_id: activeServiceId || undefined,
        },
        signal
      ),
    enabled: !!id && !!selectedDate && !!activeServiceId,
    staleTime: 10000,
  });

  // 3. Book slot mutation
  const bookMutation = useMutation({
    mutationFn: (slotId: string) => bookingApi.bookAppointment(slotId),
    onSuccess: () => {
      setIsConfirmModalOpen(false);
      setSelectedSlot(null);
      setBookingError(null);
      toast.success('Appointment booked successfully!');
      queryClient.invalidateQueries({ queryKey: ['slots', id] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (err: any) => {
      if (err.response?.status === 409) {
        setBookingError('This slot was just booked by another customer. Please select another slot.');
        refetchSlots();
      } else if (err.response?.status === 401) {
        setIsConfirmModalOpen(false);
        const returnUrl = encodeURIComponent(location.pathname);
        navigate(`/login?redirect=${returnUrl}`);
      } else if (err.response?.data?.error?.message) {
        setBookingError(err.response.data.error.message);
      } else {
        setBookingError('Failed to book appointment. Please try again.');
      }
    },
  });

  const handleSlotClick = (slot: ISlot) => {
    if (slot.status !== 'free') return;

    if (!user) {
      const returnUrl = encodeURIComponent(location.pathname);
      navigate(`/login?redirect=${returnUrl}`);
      return;
    }

    setBookingError(null);
    setSelectedSlot(slot);
    setIsConfirmModalOpen(true);
  };

  if (isBizLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Skeleton className="h-10 w-2/5" />
        <Skeleton className="h-5 w-1/4" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-6">
          <Skeleton className="h-80 col-span-2 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (isBizError || !business) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <ErrorState
          title="Business Not Found"
          message="Could not load the details of this business. It may not exist or has not been approved."
          onRetry={() => refetchBiz()}
        />
      </div>
    );
  }

  const isOwnerOrAdmin = user?.role === 'owner' || user?.role === 'admin';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Business Header */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 sm:p-8 border border-gray-100 dark:border-gray-800 shadow-soft">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white">
                {business.name}
              </h1>
              <Badge variant="primary" className="capitalize">
                {business.category.replace('_', ' ')}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-primary-500 shrink-0" />
                <span>{business.address}, {business.city}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Phone className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{business.phone}</span>
              </div>
            </div>
          </div>

          {/* Live Virtual Queue Card (Step 8b) */}
          <BusinessQueueCard businessId={business.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Services & Operating Hours */}
        <div className="lg:col-span-1 space-y-6">
          {/* Services List */}
          <Card className="p-6">
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary-600" /> Available Services
            </h2>
            {services.length === 0 ? (
              <p className="text-xs text-gray-400">No services listed yet.</p>
            ) : (
              <div className="space-y-2.5">
                {services.map((svc) => {
                  const isSelected = svc.id === activeServiceId;
                  return (
                    <div
                      key={svc.id}
                      onClick={() => setSelectedServiceId(svc.id)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'border-primary-600 bg-primary-50/50 dark:bg-primary-950/40'
                          : 'border-gray-100 dark:border-gray-800 hover:border-gray-300'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">
                          {svc.name}
                        </p>
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" /> {svc.duration_minutes} mins
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-gray-900 dark:text-white flex items-center justify-end">
                          <IndianRupee className="w-3.5 h-3.5" />
                          {svc.price}
                        </span>
                        {isSelected && (
                          <span className="text-[10px] text-primary-600 font-semibold">
                            Selected
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Working Hours */}
          <Card className="p-6">
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary-600" /> Working Hours (IST)
            </h2>
            <div className="space-y-2 text-xs divide-y divide-gray-100 dark:divide-gray-800">
              {DAYS_OF_WEEK.map((dayName, idx) => {
                const hour = business.working_hours.find((h) => h.day_of_week === idx);
                return (
                  <div key={dayName} className="flex justify-between py-2 items-center">
                    <span className="font-medium text-gray-600 dark:text-gray-300">
                      {dayName}
                    </span>
                    {hour ? (
                      <span className="text-gray-900 dark:text-white font-mono font-medium">
                        {hour.open_time} - {hour.close_time}
                      </span>
                    ) : (
                      <span className="text-gray-400 italic">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Right Column: Appointment Booking Panel */}
        <div className="lg:col-span-2">
          <Card className="p-6 sm:p-8">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800 mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  Book an Appointment
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Select a date and choose an available time slot
                </p>
              </div>
              {currentService && (
                <div className="text-right">
                  <span className="text-xs text-gray-400">Selected:</span>
                  <p className="text-sm font-bold text-primary-600 dark:text-primary-400">
                    {currentService.name} (₹{currentService.price})
                  </p>
                </div>
              )}
            </div>

            {/* If Owner/Admin, hide booking with clear explanation */}
            {isOwnerOrAdmin ? (
              <div className="p-6 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-center">
                <AlertCircle className="w-8 h-8 text-amber-600 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200 mb-1">
                  Customer Booking Only
                </h3>
                <p className="text-xs text-amber-700 dark:text-amber-300 max-w-md mx-auto">
                  Appointment booking is reserved for customer accounts. As an {user.role}, you can manage services, schedule slots, and oversee operations in your dashboard.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Horizontal Date Scroller (Next 14 Days) */}
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-3">
                    Select Date (Next 14 Days)
                  </label>
                  <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                    {next14Days.map((d) => {
                      const isSelected = selectedDate === d.dateStr;
                      return (
                        <button
                          key={d.dateStr}
                          type="button"
                          onClick={() => setSelectedDate(d.dateStr)}
                          className={`flex-shrink-0 w-20 py-3 rounded-2xl border text-center transition-all focus:outline-none ${
                            isSelected
                              ? 'bg-primary-600 text-white border-primary-600 shadow-soft'
                              : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-800 hover:border-primary-400'
                          }`}
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
                            {d.dayName}
                          </p>
                          <p className="text-sm font-extrabold mt-0.5">{d.label}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Slots Grid */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                      Available Time Slots ({formatDate(selectedDate, 'dd MMMM yyyy')})
                    </label>
                    <button
                      type="button"
                      onClick={() => refetchSlots()}
                      className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
                    >
                      Refresh Slots
                    </button>
                  </div>

                  {isSlotsLoading ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <Skeleton key={n} className="h-12 rounded-xl" />
                      ))}
                    </div>
                  ) : slots.length === 0 ? (
                    <EmptyState
                      icon={<Calendar className="w-6 h-6" />}
                      title="No slots generated"
                      description="There are no scheduled slots for this service on the selected date."
                    />
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {slots.map((slot) => {
                        const isFree = slot.status === 'free';
                        // Render IST formatted time regardless of client environment
                        const timeLabel = formatTime(slot.start_time);

                        return (
                          <button
                            key={slot.id}
                            type="button"
                            disabled={!isFree}
                            onClick={() => handleSlotClick(slot)}
                            className={`p-3 rounded-xl border text-center font-semibold text-xs transition-all ${
                              isFree
                                ? 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-primary-600 hover:bg-primary-50/40 dark:hover:bg-primary-950/40 text-gray-900 dark:text-white shadow-xs'
                                : 'bg-gray-100 dark:bg-gray-800/50 border-gray-200 dark:border-gray-800 text-gray-400 cursor-not-allowed line-through'
                            }`}
                          >
                            <div>{timeLabel}</div>
                            <span
                              className={`text-[10px] uppercase font-normal tracking-wide block mt-0.5 ${
                                isFree ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'
                              }`}
                            >
                              {isFree ? 'Free' : 'Booked'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Booking Confirmation Modal */}
      <Modal
        isOpen={isConfirmModalOpen}
        onClose={() => {
          setIsConfirmModalOpen(false);
          setBookingError(null);
        }}
        title="Confirm Appointment"
        description="Please review your appointment details before booking."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsConfirmModalOpen(false);
                setBookingError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={bookMutation.isPending}
              onClick={() => {
                if (selectedSlot) {
                  bookMutation.mutate(selectedSlot.id);
                }
              }}
            >
              Confirm Booking
            </Button>
          </>
        }
      >
        {bookingError && (
          <div
            role="alert"
            className="mb-4 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-600 dark:text-red-400 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{bookingError}</span>
          </div>
        )}

        {selectedSlot && currentService && (
          <div className="space-y-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 text-sm">
            <div className="flex justify-between py-1 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-gray-500">Business:</span>
              <span className="font-semibold text-gray-900 dark:text-white">{business.name}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-gray-500">Service:</span>
              <span className="font-semibold text-gray-900 dark:text-white">{currentService.name}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-gray-500">Duration:</span>
              <span className="font-medium text-gray-800 dark:text-gray-200">{currentService.duration_minutes} minutes</span>
            </div>
            <div className="flex justify-between py-1 border-b border-gray-200/60 dark:border-gray-700/60">
              <span className="text-gray-500">Price:</span>
              <span className="font-bold text-gray-900 dark:text-white">₹{currentService.price}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-gray-500">Time (IST):</span>
              <span className="font-bold text-primary-600 dark:text-primary-400">
                {formatDateTime(selectedSlot.start_time)}
              </span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
