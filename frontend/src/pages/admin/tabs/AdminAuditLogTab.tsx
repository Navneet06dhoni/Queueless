import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../../api';
import { AdminAuditLogItem } from '../../../api/types';
import { formatDateTime } from '../../../utils/date';
import {
  Card,
  Badge,
  Button,
  Skeleton,
  EmptyState,
} from '../../../components/ui';
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  Shield,
} from 'lucide-react';

export const AdminAuditLogTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data: result, isLoading } = useQuery({
    queryKey: ['admin-audit-log', page, limit],
    queryFn: () => adminApi.listAuditLogs({ page, limit }),
  });

  const logs = result?.data || [];
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

  if (logs.length === 0) {
    return (
      <Card className="p-8 text-center">
        <EmptyState
          icon={<FileText className="w-12 h-12 text-gray-400" />}
          title="Audit log is empty"
          description="Administrative actions such as approvals, rejections, and user blocks will be logged here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary-600" />
            Security &amp; Administrative Audit Log
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Immutable log of all administrative interventions and governance actions.
          </p>
        </div>
        <span className="text-xs text-gray-400">Total Entries: {total}</span>
      </div>

      <Card className="overflow-hidden p-0 border border-gray-100 dark:border-gray-800">
        {/* Desktop Table View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
              <tr>
                <th scope="col" className="px-5 py-3">Timestamp (IST)</th>
                <th scope="col" className="px-5 py-3">Administrator</th>
                <th scope="col" className="px-5 py-3">Action</th>
                <th scope="col" className="px-5 py-3">Target</th>
                <th scope="col" className="px-5 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {logs.map((item: AdminAuditLogItem) => (
                <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                  <td className="px-5 py-4 text-xs font-mono text-gray-600 dark:text-gray-300 whitespace-nowrap">
                    {formatDateTime(item.created_at)} IST
                  </td>

                  <td className="px-5 py-4">
                    <div className="text-xs font-semibold text-gray-900 dark:text-white">
                      {item.admin_name || 'Admin'}
                    </div>
                    <div className="text-[11px] text-gray-400">{item.admin_email}</div>
                  </td>

                  <td className="px-5 py-4">
                    <Badge
                      variant={
                        item.action.includes('block')
                          ? 'danger'
                          : item.action.includes('approve')
                          ? 'success'
                          : item.action.includes('reject')
                          ? 'warning'
                          : 'primary'
                      }
                      size="sm"
                      className="font-mono text-[10px]"
                    >
                      {item.action}
                    </Badge>
                  </td>

                  <td className="px-5 py-4 text-xs text-gray-600 dark:text-gray-300">
                    <span className="font-semibold capitalize">{item.target_type}</span>
                    {item.target_id && (
                      <span className="text-gray-400 font-mono ml-1 text-[11px]">
                        ({item.target_id.slice(0, 8)}...)
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-4 text-xs font-mono text-gray-500 max-w-xs truncate">
                    {item.details ? JSON.stringify(item.details) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Stacked Card View (360px friendly) */}
        <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
          {logs.map((item: AdminAuditLogItem) => (
            <div key={item.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant={
                    item.action.includes('block')
                      ? 'danger'
                      : item.action.includes('approve')
                      ? 'success'
                      : 'primary'
                  }
                  size="sm"
                  className="font-mono text-[10px]"
                >
                  {item.action}
                </Badge>
                <span className="text-[11px] font-mono text-gray-400">
                  {formatDateTime(item.created_at)} IST
                </span>
              </div>

              <div className="text-xs text-gray-600 dark:text-gray-300">
                <strong>Admin:</strong> {item.admin_name || item.admin_email || 'System'}
              </div>

              <div className="text-xs text-gray-600 dark:text-gray-300">
                <strong>Target:</strong> {item.target_type} {item.target_id ? `(${item.target_id.slice(0, 8)}...)` : ''}
              </div>

              {item.details && (
                <div className="p-2 rounded bg-gray-50 dark:bg-gray-800 font-mono text-[10px] text-gray-600 dark:text-gray-400 break-all">
                  {JSON.stringify(item.details)}
                </div>
              )}
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
