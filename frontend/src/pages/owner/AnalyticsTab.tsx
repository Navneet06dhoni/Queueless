import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../../api';
import { PeakHourItem, DailyAnalyticsItem } from '../../api/types';
import { useToast } from '../../components/ui/Toast';
import { useTheme } from '../../context/ThemeContext';
import { formatDate } from '../../utils/date';
import {
  Card,
  Button,
  Skeleton,
  EmptyState,
} from '../../components/ui';
import {
  Download,
  Calendar,
  Clock,
  TrendingUp,
  Users,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  PieChart as PieChartIcon,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

interface AnalyticsTabProps {
  businessId: string;
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ businessId }) => {
  const toast = useToast();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [rangeDays, setRangeDays] = useState<7 | 14 | 30>(7);
  const [isExporting, setIsExporting] = useState(false);

  // Compute from & to dates (IST)
  const { fromStr, toStr } = useMemo(() => {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - (rangeDays - 1));
    return {
      fromStr: formatDate(fromDate, 'yyyy-MM-dd'),
      toStr: formatDate(toDate, 'yyyy-MM-dd'),
    };
  }, [rangeDays]);

  // Fetch summary analytics
  const { data: analytics, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics', 'summary', businessId, fromStr, toStr],
    queryFn: () => analyticsApi.getSummary(businessId, { from: fromStr, to: toStr }),
  });

  // Export CSV handler
  const handleExportCsv = async () => {
    try {
      setIsExporting(true);
      const { data, filename } = await analyticsApi.exportCsv(businessId, {
        from: fromStr,
        to: toStr,
      });

      const blobUrl = window.URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      toast.success('Analytics CSV report exported successfully');
    } catch {
      toast.error('Could not export CSV report');
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-3xl" />
      </div>
    );
  }

  if (isError || !analytics) {
    return (
      <EmptyState
        icon={<BarChart3 className="w-10 h-10 text-gray-400" />}
        title="Could not load analytics"
        description="Unable to fetch business summary metrics for this date range."
        action={<Button variant="primary" onClick={() => refetch()}>Try Again</Button>}
      />
    );
  }

  // Find peak hour with highest count
  const peakHour = analytics.peakHours?.reduce(
    (max: PeakHourItem, item: PeakHourItem) => (item.count > max.count ? item : max),
    { hour: 0, count: 0 }
  );

  // Source breakdown for Donut Chart
  const sourcesData = [
    { name: 'Online Virtual Queue', value: analytics.queue.onlineCount, color: '#6366f1' },
    { name: 'Scheduled Appointments', value: analytics.queue.appointmentCount, color: '#10b981' },
    { name: 'Walk-ins', value: analytics.queue.walkInCount, color: '#f59e0b' },
  ].filter((s) => s.value > 0);

  const totalSourceVolume =
    analytics.queue.onlineCount +
    analytics.queue.appointmentCount +
    analytics.queue.walkInCount;

  const isDailyAllZero =
    !analytics.daily ||
    analytics.daily.length === 0 ||
    analytics.daily.every((d: DailyAnalyticsItem) => d.served === 0);

  const isPeakAllZero =
    !analytics.peakHours ||
    analytics.peakHours.every((p: PeakHourItem) => p.count === 0);

  // Recharts styling
  const gridColor = isDark ? '#374151' : '#f3f4f6';
  const textColor = isDark ? '#9ca3af' : '#6b7280';
  const tooltipStyle = {
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    borderColor: isDark ? '#374151' : '#e5e7eb',
    color: isDark ? '#f9fafb' : '#111827',
    borderRadius: '1rem',
    fontSize: '0.75rem',
  };

  return (
    <div className="space-y-8">
      {/* Top Header: Date Range Selector & Export CSV */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-xs">
        {/* Range Buttons */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-gray-100 dark:bg-gray-800 text-xs font-semibold">
          {[7, 14, 30].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setRangeDays(days as any)}
              className={`px-3 py-1.5 rounded-lg transition ${
                rangeDays === days
                  ? 'bg-white dark:bg-gray-900 text-primary-600 dark:text-primary-400 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Last {days} Days
            </button>
          ))}
        </div>

        {/* Export CSV Button */}
        <Button
          variant="outline"
          size="sm"
          isLoading={isExporting}
          onClick={handleExportCsv}
          className="text-xs"
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Export CSV ({fromStr} to {toStr})
        </Button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Served */}
        <Card className="p-5 space-y-1">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-primary-600" /> Total Served
          </span>
          <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white">
            {analytics.queue.totalServed}
          </div>
          <p className="text-[11px] text-gray-400">
            {analytics.queue.skipped} skipped • {analytics.queue.left} left
          </p>
        </Card>

        {/* Average Wait */}
        <Card className="p-5 space-y-1">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-emerald-600" /> Avg Wait Time
          </span>
          <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white">
            {analytics.averageWaitMinutes !== null ? `${analytics.averageWaitMinutes}m` : 'n/a'}
          </div>
          <p className="text-[11px] text-gray-400">
            Median: {analytics.medianWaitMinutes !== null ? `${analytics.medianWaitMinutes}m` : 'n/a'}
          </p>
        </Card>

        {/* Avg Service Time */}
        <Card className="p-5 space-y-1">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-indigo-600" /> Avg Service Time
          </span>
          <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white">
            {analytics.averageServiceMinutes !== null ? `${analytics.averageServiceMinutes}m` : 'n/a'}
          </div>
          <p className="text-[11px] text-gray-400">
            Counter duration per customer
          </p>
        </Card>

        {/* No-Show Rate */}
        <Card className="p-5 space-y-1">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500" /> No-Show Rate
          </span>
          <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white">
            {analytics.appointments.noShowRate !== null
              ? `${(analytics.appointments.noShowRate * 100).toFixed(1)}%`
              : 'n/a'}
          </div>
          <p className="text-[11px] text-gray-400">
            {analytics.appointments.noShow} no-shows / {analytics.appointments.completed} completed
          </p>
        </Card>
      </div>

      {/* Utilization & Accuracy Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">Slot Utilization</div>
            <div className="text-2xl font-extrabold text-gray-900 dark:text-white mt-1">
              {analytics.slotUtilization !== null ? `${analytics.slotUtilization}%` : 'n/a'}
            </div>
            <p className="text-xs text-gray-400 mt-1">Booked slots divided by total available capacity</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-primary-50 dark:bg-primary-950/40 flex items-center justify-center text-primary-600">
            <Calendar className="w-6 h-6" />
          </div>
        </Card>

        <Card className="p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">Wait Estimate Accuracy</div>
            {analytics.estimateAccuracy.sampleSize > 0 ? (
              <>
                <div className="text-2xl font-extrabold text-gray-900 dark:text-white mt-1">
                  ±{analytics.estimateAccuracy.meanAbsoluteErrorMinutes} min
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Estimates are off by {analytics.estimateAccuracy.meanAbsoluteErrorMinutes} minutes on average, based on {analytics.estimateAccuracy.sampleSize} samples.
                </p>
              </>
            ) : (
              <>
                <div className="text-base font-bold text-gray-500 mt-1">No completed estimate samples</div>
                <p className="text-xs text-gray-400 mt-1">
                  Accuracy metrics will populate as waiting customers complete service.
                </p>
              </>
            )}
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </Card>
      </div>

      {/* Chart 1: Daily Served & Average Wait Trend (Line Chart) */}
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            Daily Volume & Average Wait Trend
          </h3>
          <p className="text-xs text-gray-400">
            Number of completed visitors and average waiting minutes per day
          </p>
        </div>

        {isDailyAllZero ? (
          <div className="h-64 flex flex-col items-center justify-center text-gray-400 text-xs">
            <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
            No traffic recorded for this period.
          </div>
        ) : (
          <div className="h-72 w-full" aria-label="Daily visitors and average wait trend line chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="date" stroke={textColor} fontSize={12} />
                <YAxis yAxisId="left" stroke={textColor} fontSize={12} />
                <YAxis yAxisId="right" orientation="right" stroke={textColor} fontSize={12} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="served"
                  name="Customers Served"
                  stroke="#6366f1"
                  strokeWidth={2}
                  activeDot={{ r: 6 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="averageWaitMinutes"
                  name="Avg Wait (min)"
                  stroke="#10b981"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Charts Grid: Peak Hours & Customer Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Peak Hours (Bar Chart - 24 hours IST) */}
        <Card className="lg:col-span-7 p-6 space-y-4">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Peak Traffic Hours (IST)
            </h3>
            <p className="text-xs text-gray-400">
              {peakHour && peakHour.count > 0 ? (
                <>
                  Busiest hour was <strong className="text-primary-600 font-bold">{peakHour.hour}:00 - {peakHour.hour + 1}:00</strong> with {peakHour.count} visitors.
                </>
              ) : (
                'Visitor distribution by hour of the day.'
              )}
            </p>
          </div>

          {isPeakAllZero ? (
            <div className="h-64 flex flex-col items-center justify-center text-gray-400 text-xs">
              <Clock className="w-8 h-8 mb-2 opacity-50" />
              No hourly traffic recorded.
            </div>
          ) : (
            <div className="h-64 w-full" aria-label="Hourly traffic bar chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.peakHours}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="hour" stroke={textColor} fontSize={11} tickFormatter={(h) => `${h}h`} />
                  <YAxis stroke={textColor} fontSize={11} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(val: any) => [`${val} visitors`, 'Traffic']}
                    labelFormatter={(label) => `${label}:00 - ${Number(label) + 1}:00 IST`}
                  />
                  <Bar dataKey="count" name="Visitors" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Customer Sources (Donut Chart) */}
        <Card className="lg:col-span-5 p-6 space-y-4">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Customer Acquisition Source
            </h3>
            <p className="text-xs text-gray-400">
              Breakdown between online queue, appointments, and walk-ins
            </p>
          </div>

          {totalSourceVolume === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-gray-400 text-xs">
              <PieChartIcon className="w-8 h-8 mb-2 opacity-50" />
              No customer source entries recorded.
            </div>
          ) : (
            <div className="h-64 w-full flex items-center justify-center" aria-label="Acquisition source donut chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sourcesData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={4}
                  >
                    {sourcesData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
