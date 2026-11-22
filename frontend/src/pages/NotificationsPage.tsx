import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '../api';
import { NotificationStatus } from '../api/types';
import { formatDateTime } from '../utils/date';
import { useToast } from '../components/ui/Toast';
import {
  Card,
  Badge,
  Button,
  Pagination,
  Skeleton,
  EmptyState,
  ErrorState,
} from '../components/ui';
import { Bell, Check, CheckCheck, Clock } from 'lucide-react';

export const NotificationsPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<NotificationStatus | undefined>(undefined);
  const toast = useToast();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    document.title = 'Notifications | QueueLess';
  }, []);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['notifications', filterStatus, page],
    queryFn: ({ signal }) =>
      notificationApi.getNotifications({ status: filterStatus, page, limit: 10 }, signal),
    staleTime: 15000,
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationApi.markAllAsRead(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(res.message || 'All notifications marked as read.');
    },
    onError: () => {
      toast.error('Failed to mark notifications as read.');
    },
  });

  const markSingleMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const notifications = data?.data || [];
  const total = data?.total || 0;
  const unreadCount = data?.unreadCount || 0;
  const limit = data?.limit || 10;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
            <Bell className="w-7 h-7 text-primary-600" /> Notifications
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Keep track of appointment confirmations, cancellations, and live queue updates
          </p>
        </div>

        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllMutation.mutate()}
            isLoading={markAllMutation.isPending}
            leftIcon={<CheckCheck className="w-4 h-4 text-primary-600" />}
          >
            Mark all as read ({unreadCount})
          </Button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setFilterStatus(undefined);
            setPage(1);
          }}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
            filterStatus === undefined
              ? 'bg-primary-600 text-white shadow-soft'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-800'
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => {
            setFilterStatus('unread');
            setPage(1);
          }}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
            filterStatus === 'unread'
              ? 'bg-primary-600 text-white shadow-soft'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-800'
          }`}
        >
          Unread {unreadCount > 0 && `(${unreadCount})`}
        </button>
        <button
          type="button"
          onClick={() => {
            setFilterStatus('read');
            setPage(1);
          }}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
            filterStatus === 'read'
              ? 'bg-primary-600 text-white shadow-soft'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-800'
          }`}
        >
          Read
        </button>
      </div>

      {/* Notifications List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-4 space-y-2">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-3/4" />
            </Card>
          ))}
        </div>
      ) : isError ? (
        ((error as any)?.response?.status === 502 ||
        (error as any)?.response?.status === 503 ||
        (error as any)?.status === 502 ||
        (error as any)?.status === 503) ? (
          <ErrorState
            title="Notifications are temporarily unavailable"
            message="We are currently experiencing issues with our notification service. Please check back shortly."
            onRetry={() => refetch()}
          />
        ) : (
          <ErrorState
            title="Could not load notifications"
            message="An error occurred while fetching your notifications. Please try again."
            onRetry={() => refetch()}
          />
        )
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="w-8 h-8" />}
          title="No notifications"
          description={
            filterStatus
              ? `You have no ${filterStatus} notifications.`
              : 'You have not received any notifications yet.'
          }
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => {
            const isUnread = n.status === 'unread';

            return (
              <Card
                key={n.id}
                className={`p-4 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                  isUnread
                    ? 'border-primary-200 dark:border-primary-900/60 bg-primary-50/20 dark:bg-primary-950/20'
                    : 'border-gray-100 dark:border-gray-800'
                }`}
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                      {n.title || 'Notification'}
                    </h3>
                    {isUnread && (
                      <Badge variant="primary" size="sm">
                        New
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                    {n.message}
                  </p>
                  <p className="text-[11px] text-gray-400 flex items-center gap-1 pt-1">
                    <Clock className="w-3 h-3" />
                    {formatDateTime(n.created_at)}
                  </p>
                </div>

                {isUnread && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markSingleMutation.mutate(n.id)}
                    leftIcon={<Check className="w-3.5 h-3.5" />}
                    className="text-xs text-primary-600 shrink-0"
                  >
                    Mark as read
                  </Button>
                )}
              </Card>
            );
          })}

          <Pagination
            page={page}
            total={total}
            limit={limit}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      )}
    </div>
  );
};
