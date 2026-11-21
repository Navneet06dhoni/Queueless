import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../../api';
import { formatDate } from '../../../utils/date';
import {
  Card,
  Badge,
  Button,
  Skeleton,
} from '../../../components/ui';
import {
  Users,
  Building,
  Calendar,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Table as TableIcon,
  BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

export const AdminOverviewTab: React.FC = () => {
  const [showTableFallback, setShowTableFallback] = useState(false);

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => adminApi.getStats(),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <Skeleton className="h-80 rounded-3xl" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <Card className="p-8 text-center text-red-600 space-y-2">
        <AlertTriangle className="w-8 h-8 mx-auto" />
        <h4 className="font-bold">Failed to load platform overview statistics</h4>
        <p className="text-xs text-gray-500">Please verify admin permissions and try refreshing.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Platform Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Users */}
        <Card className="p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 font-semibold">
            <span>Total Users</span>
            <Users className="w-4 h-4 text-primary-600" />
          </div>
          <div className="text-3xl font-black text-gray-900 dark:text-white">
            {stats.users.total}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <span>{stats.users.customer} cust</span> •
            <span>{stats.users.owner} owners</span> •
            <span>{stats.users.admin} admins</span>
          </div>
        </Card>

        {/* Businesses */}
        <Card className="p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 font-semibold">
            <span>Businesses</span>
            <Building className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-black text-gray-900 dark:text-white">
            {stats.businesses.total}
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <Badge variant="warning" size="sm" className="text-[10px] px-1.5 py-0">
              {stats.businesses.pending} pending
            </Badge>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              {stats.businesses.approved} live
            </span>
          </div>
        </Card>

        {/* 30-Day Appointments */}
        <Card className="p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 font-semibold">
            <span>Appts (30d)</span>
            <Calendar className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-3xl font-black text-gray-900 dark:text-white">
            {stats.appointments.total30Days}
          </div>
          <div className="text-[11px] text-gray-400 truncate">
            {stats.appointments.completed} completed • {stats.appointments.cancelled} cancelled
          </div>
        </Card>

        {/* Queue Served 30d */}
        <Card className="p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 font-semibold">
            <span>Queue Served (30d)</span>
            <CheckCircle className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-3xl font-black text-gray-900 dark:text-white">
            {stats.queueServed30Days}
          </div>
          <div className="text-[11px] text-gray-400">
            Completed live visits
          </div>
        </Card>

        {/* Failed Emails */}
        <Card className="p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 font-semibold">
            <span>Failed Emails</span>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-3xl font-black text-red-600 dark:text-red-400">
            {stats.failedEmails}
          </div>
          <div className="text-[11px] text-gray-400">
            {stats.failedEmails > 0 ? 'Requires attention' : 'All delivered cleanly'}
          </div>
        </Card>
      </div>

      {/* 30-Day Growth Trends Chart & Table Fallback */}
      <Card className="p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary-600" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                30-Day Platform Growth Trends
              </h3>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Daily counts of newly registered users and newly booked appointments.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTableFallback((prev) => !prev)}
            className="text-xs"
            aria-label="Toggle accessible data table view"
          >
            {showTableFallback ? (
              <>
                <BarChart3 className="w-3.5 h-3.5 mr-1" /> Show Chart View
              </>
            ) : (
              <>
                <TableIcon className="w-3.5 h-3.5 mr-1" /> Show Accessible Table View
              </>
            )}
          </Button>
        </div>

        {/* Chart View */}
        {!showTableFallback && (
          <div
            role="region"
            aria-label="30-day growth trends of users and appointments"
            className="w-full h-80 pt-4"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={stats.daily}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(val) => formatDate(val, 'dd MMM')}
                  fontSize={11}
                  stroke="#888888"
                />
                <YAxis allowDecimals={false} fontSize={11} stroke="#888888" />
                <Tooltip
                  formatter={(val: any, name: any) => [
                    val,
                    name === 'newUsers' ? 'New Users' : 'New Appointments',
                  ]}
                  labelFormatter={(val) => formatDate(val, 'EEEE, dd MMMM yyyy')}
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    borderRadius: '12px',
                    borderColor: '#e5e7eb',
                    fontSize: '12px',
                  }}
                />
                <Legend
                  formatter={(value) => (value === 'newUsers' ? 'New Users' : 'New Appointments')}
                />
                <Line
                  type="monotone"
                  dataKey="newUsers"
                  stroke="#4f46e5"
                  strokeWidth={2.5}
                  dot={{ r: 2 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="newAppointments"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 2 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Accessible Table Fallback */}
        <div className={showTableFallback ? 'block' : 'sr-only'}>
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left text-xs">
              <caption className="text-left font-bold text-sm text-gray-900 dark:text-white mb-2">
                30-Day Daily Metric Table
              </caption>
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th scope="col" className="px-4 py-2">Date</th>
                  <th scope="col" className="px-4 py-2">New Users</th>
                  <th scope="col" className="px-4 py-2">New Appointments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {stats.daily.map((d: { date: string; newUsers: number; newAppointments: number }) => (
                  <tr key={d.date} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-2 font-mono">{d.date}</td>
                    <td className="px-4 py-2 font-semibold text-primary-600 dark:text-primary-400">
                      {d.newUsers}
                    </td>
                    <td className="px-4 py-2 font-semibold text-emerald-600 dark:text-emerald-400">
                      {d.newAppointments}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
};
export default AdminOverviewTab;
