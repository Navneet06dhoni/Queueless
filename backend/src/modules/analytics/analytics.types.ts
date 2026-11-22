export interface QueueAnalytics {
  totalServed: number;
  skipped: number;
  left: number;
  walkInCount: number;
  onlineCount: number;
  appointmentCount: number;
}

export interface EstimateAccuracy {
  sampleSize: number;
  meanAbsoluteErrorMinutes: number | null;
}

export interface AppointmentAnalytics {
  confirmed: number;
  completed: number;
  noShow: number;
  cancelled: number;
  noShowRate: number | null;
}

export interface PeakHourItem {
  hour: number;
  count: number;
}

export interface DailyAnalyticsItem {
  date: string;
  served: number;
  averageWaitMinutes: number | null;
}

export interface BusinessSummaryAnalytics {
  queue: QueueAnalytics;
  averageWaitMinutes: number | null;
  medianWaitMinutes: number | null;
  averageServiceMinutes: number | null;
  estimateAccuracy: EstimateAccuracy;
  appointments: AppointmentAnalytics | null;
  slotUtilization: number | null;
  peakHours: PeakHourItem[];
  daily: DailyAnalyticsItem[];
  partial?: boolean;
}

export interface NextAppointmentItem {
  appointmentId: string;
  customerName: string;
  serviceName: string;
  startTime: string;
}

export interface BusinessTodayAnalytics {
  waitingNow: number;
  servedToday: number;
  averageWaitMinutesToday: number | null;
  nextAppointments: NextAppointmentItem[];
}
