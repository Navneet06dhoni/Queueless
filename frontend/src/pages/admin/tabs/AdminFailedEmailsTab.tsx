import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../../api';
import { AdminFailedNotificationItem } from '../../../api/types';
import { formatDateTime } from '../../../utils/date';
import {
  Card,
  Badge,
  Button,
  Skeleton,
  EmptyState,
} from '../../../components/ui';
import {
  MailX,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';

export const AdminFailedEmailsTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const limit = 10;

  const { data: result, isLoading } = useQuery({
    queryKey: ['admin-failed-notifications', page, limit],
    queryFn: () => adminApi.getFailedNotifications({ page, limit }),
  });

  const items = result?.data || [];
  const total = result?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="p-8 text-center">
        <EmptyState
          icon={<MailX className="w-12 h-12 text-emerald-500" />}
          title="No failed email notifications"
          description="All system and booking transactional emails have been dispatched successfully."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MailX className="w-5 h-5 text-red-500" />
            Failed Email Transmissions
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Transactional email dispatches that failed after reaching maximum retry attempts.
          </p>
        </div>
        <span className="text-xs text-gray-400">Total Failed: {total}</span>
      </div>

      <Card className="overflow-hidden p-0 border border-gray-100 dark:border-gray-800">
        {/* Desktop Table View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
              <tr>
                <th scope="col" className="px-5 py-3">Recipient</th>
                <th scope="col" className="px-5 py-3">Event Type</th>
                <th scope="col" className="px-5 py-3">Attempts</th>
                <th scope="col" className="px-5 py-3">Created (IST)</th>
                <th scope="col" className="px-5 py-3">Last Error (Plain Text)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.map((item: AdminFailedNotificationItem) => (
                <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-gray-900 dark:text-white text-xs">
                      {item.user_name || 'Customer'}
                    </div>
                    <div className="text-[11px] text-gray-400 font-mono">
                      {item.user_email || 'No email provided'}
                    </div>
                  </td>

                  <td className="px-5 py-4">
                    <Badge variant="neutral" size="sm" className="font-mono text-[10px]">
                      {item.type}
                    </Badge>
                  </td>

                  <td className="px-5 py-4 text-xs font-bold text-red-600 dark:text-red-400">
                    <span className="inline-flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" />
                      {item.email_attempts}
                    </span>
                  </td>

                  <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">
                    {formatDateTime(item.created_at)} IST
                  </td>

                  {/* Rendered strictly as plain text (XSS-safe) */}
                  <td className="px-5 py-4 text-xs font-mono text-red-600 dark:text-red-400 max-w-md break-all">
                    <span data-testid={`last-error-${item.id}`}>
                      {item.last_error ? String(item.last_error) : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Card View (360px friendly) */}
        <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
          {items.map((item: AdminFailedNotificationItem) => (
            <div key={item.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="neutral" size="sm" className="font-mono text-[10px]">
                  {item.type}
                </Badge>
                <span className="text-[11px] text-red-600 font-bold">
                  {item.email_attempts} attempts
                </span>
              </div>

              <div className="text-xs text-gray-800 dark:text-gray-200">
                <strong>Recipient:</strong> {item.user_name} ({item.user_email})
              </div>

              <div className="text-[11px] text-gray-400">
                Created: {formatDateTime(item.created_at)} IST
              </div>

              {/* Rendered strictly as plain text */}
              <div
                data-testid={`last-error-mobile-${item.id}`}
                className="p-2 rounded bg-red-50 dark:bg-red-950/40 text-[11px] font-mono text-red-700 dark:text-red-300 break-all"
              >
                {item.last_error ? String(item.last_error) : '—'}
              </div>
            </div>
          ))}
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs">
            <span className="text-gray-500 dark:text-gray-400">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 text-xs"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 text-xs"
              >
                Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
