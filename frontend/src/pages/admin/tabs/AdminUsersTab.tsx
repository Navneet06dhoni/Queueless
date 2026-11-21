import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../../api';
import { AdminUserListItem, UserRole } from '../../../api/types';
import { useToast } from '../../../components/ui/Toast';
import { formatDate } from '../../../utils/date';
import {
  Card,
  Badge,
  Button,
  Input,
  Modal,
  Skeleton,
  EmptyState,
} from '../../../components/ui';
import {
  Users,
  Search,
  ShieldAlert,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export const AdminUsersTab: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [blockedFilter, setBlockedFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const limit = 10;

  // Block modal state
  const [blockingUser, setBlockingUser] = useState<AdminUserListItem | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [blockReasonError, setBlockReasonError] = useState<string | null>(null);

  // Unblock modal state
  const [unblockingUser, setUnblockingUser] = useState<AdminUserListItem | null>(null);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch users with filters and pagination
  const { data: result, isLoading } = useQuery({
    queryKey: ['admin-users', debouncedSearch, roleFilter, blockedFilter, page, limit],
    queryFn: () =>
      adminApi.listUsers({
        q: debouncedSearch || undefined,
        role: roleFilter ? (roleFilter as UserRole) : undefined,
        blocked: blockedFilter === 'true' ? true : blockedFilter === 'false' ? false : undefined,
        page,
        limit,
      }),
  });

  const users = result?.data || [];
  const total = result?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Block mutation
  const blockMutation = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      adminApi.blockUser(userId, { blocked: true, reason }),
    onSuccess: (res) => {
      setBlockingUser(null);
      setBlockReason('');
      setBlockReasonError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success(res.message || 'User has been blocked successfully');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Failed to block user';
      setBlockReasonError(msg);
      toast.error(msg);
    },
  });

  // Unblock mutation
  const unblockMutation = useMutation({
    mutationFn: (userId: string) => adminApi.blockUser(userId, { blocked: false }),
    onSuccess: (res) => {
      setUnblockingUser(null);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success(res.message || 'User has been unblocked successfully');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Failed to unblock user';
      toast.error(msg);
    },
  });

  const handleOpenBlockModal = (user: AdminUserListItem) => {
    setBlockingUser(user);
    setBlockReason('');
    setBlockReasonError(null);
  };

  const handleConfirmBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockingUser) return;
    const trimmed = blockReason.trim();
    if (!trimmed) {
      setBlockReasonError('Reason is required to block a user');
      return;
    }
    if (trimmed.length > 200) {
      setBlockReasonError('Reason cannot exceed 200 characters');
      return;
    }
    blockMutation.mutate({ userId: blockingUser.id, reason: trimmed });
  };

  return (
    <div className="space-y-6">
      {/* Search and Filters Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {/* Debounced Search Input */}
        <div className="sm:col-span-2 relative">
          <label htmlFor="admin-user-search" className="sr-only">
            Search users
          </label>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            id="admin-user-search"
            placeholder="Search by name or email..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Role Filter */}
        <div>
          <label htmlFor="admin-role-filter" className="sr-only">
            Filter by role
          </label>
          <select
            id="admin-role-filter"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Roles</option>
            <option value="customer">Customers</option>
            <option value="owner">Business Owners</option>
            <option value="admin">Administrators</option>
          </select>
        </div>

        {/* Blocked Filter */}
        <div>
          <label htmlFor="admin-blocked-filter" className="sr-only">
            Filter by status
          </label>
          <select
            id="admin-blocked-filter"
            value={blockedFilter}
            onChange={(e) => {
              setBlockedFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Statuses</option>
            <option value="false">Active Only</option>
            <option value="true">Blocked Only</option>
          </select>
        </div>
      </div>

      {/* Users Table / Stacked Card View */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : users.length === 0 ? (
        <Card className="p-8 text-center">
          <EmptyState
            icon={<Users className="w-12 h-12 text-gray-400" />}
            title="No users found"
            description="Try adjusting your search keywords or filter criteria."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 border border-gray-100 dark:border-gray-800">
          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th scope="col" className="px-5 py-3">User</th>
                  <th scope="col" className="px-5 py-3">Role</th>
                  <th scope="col" className="px-5 py-3">Status</th>
                  <th scope="col" className="px-5 py-3">Registered</th>
                  <th scope="col" className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {users.map((u) => {
                  const isAdmin = u.role === 'admin';
                  const isBlocked = u.is_blocked;

                  return (
                    <tr key={u.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-bold text-gray-900 dark:text-white">
                          {u.name}
                        </div>
                        <div className="text-xs text-gray-400">{u.email}</div>
                      </td>

                      <td className="px-5 py-4">
                        <Badge
                          variant={
                            u.role === 'admin'
                              ? 'primary'
                              : u.role === 'owner'
                              ? 'warning'
                              : 'neutral'
                          }
                          size="sm"
                          className="capitalize font-semibold text-[10px]"
                        >
                          {u.role}
                        </Badge>
                      </td>

                      <td className="px-5 py-4">
                        {isBlocked ? (
                          <div className="space-y-0.5">
                            <Badge variant="danger" size="sm" className="font-bold text-[10px]">
                              Blocked
                            </Badge>
                            {u.blocked_reason && (
                              <div
                                data-testid={`blocked-reason-${u.id}`}
                                className="text-xs text-red-600 dark:text-red-400 max-w-xs truncate"
                                title={u.blocked_reason}
                              >
                                {u.blocked_reason}
                              </div>
                            )}
                          </div>
                        ) : (
                          <Badge variant="success" size="sm" className="font-semibold text-[10px]">
                            Active
                          </Badge>
                        )}
                      </td>

                      <td className="px-5 py-4 text-xs text-gray-500">
                        {formatDate(u.created_at, 'dd MMM yyyy')}
                      </td>

                      <td className="px-5 py-4 text-right">
                        {/* Block button is HIDDEN for admins */}
                        {!isAdmin && (
                          <div>
                            {isBlocked ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs py-1 text-emerald-600 hover:text-emerald-700 border-emerald-200 dark:border-emerald-900"
                                onClick={() => setUnblockingUser(u)}
                              >
                                <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Unblock
                              </Button>
                            ) : (
                              <Button
                                variant="danger"
                                size="sm"
                                className="text-xs py-1"
                                onClick={() => handleOpenBlockModal(u)}
                              >
                                <ShieldAlert className="w-3.5 h-3.5 mr-1" /> Block User
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card View (360px friendly) */}
          <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
            {users.map((u) => {
              const isAdmin = u.role === 'admin';
              const isBlocked = u.is_blocked;

              return (
                <div key={u.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-gray-900 dark:text-white text-sm">
                        {u.name}
                      </h4>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                    <Badge
                      variant={
                        u.role === 'admin'
                          ? 'primary'
                          : u.role === 'owner'
                          ? 'warning'
                          : 'neutral'
                      }
                      size="sm"
                      className="capitalize"
                    >
                      {u.role}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>Registered: {formatDate(u.created_at, 'dd MMM yyyy')}</span>
                    {isBlocked ? (
                      <Badge variant="danger" size="sm">Blocked</Badge>
                    ) : (
                      <Badge variant="success" size="sm">Active</Badge>
                    )}
                  </div>

                  {isBlocked && u.blocked_reason && (
                    <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/40 text-xs text-red-600 dark:text-red-400">
                      <strong>Reason:</strong> {u.blocked_reason}
                    </div>
                  )}

                  {!isAdmin && (
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-800/60 flex justify-end">
                      {isBlocked ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs text-emerald-600"
                          onClick={() => setUnblockingUser(u)}
                        >
                          <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Unblock
                        </Button>
                      ) : (
                        <Button
                          variant="danger"
                          size="sm"
                          className="text-xs"
                          onClick={() => handleOpenBlockModal(u)}
                        >
                          <ShieldAlert className="w-3.5 h-3.5 mr-1" /> Block User
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination Bar */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">
                Page {page} of {totalPages} ({total} users)
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
      )}

      {/* Block Modal (Reason required, max 200 chars) */}
      <Modal
        isOpen={!!blockingUser}
        onClose={() => {
          setBlockingUser(null);
          setBlockReason('');
          setBlockReasonError(null);
        }}
        title="Block User Account"
        description={`Target user: ${blockingUser?.name} (${blockingUser?.email})`}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBlockingUser(null);
                setBlockReason('');
                setBlockReasonError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={blockMutation.isPending}
              disabled={blockMutation.isPending}
              onClick={handleConfirmBlock}
            >
              Confirm &amp; Block User
            </Button>
          </>
        }
      >
        <form onSubmit={handleConfirmBlock} className="space-y-4">
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Blocking this user immediately revokes their active sessions, removes them from active virtual queues, and cancels future bookings.
          </p>

          <div>
            <label
              htmlFor="block-reason-input"
              className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1"
            >
              Reason for Blocking (required, max 200 characters) *
            </label>
            <textarea
              id="block-reason-input"
              rows={3}
              maxLength={200}
              placeholder="e.g. Terms violation, spamming reservations..."
              value={blockReason}
              onChange={(e) => {
                setBlockReason(e.target.value);
                setBlockReasonError(null);
              }}
              className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <div className="flex justify-between items-center text-[11px] text-gray-400 mt-1">
              <span>{blockReasonError ? <strong className="text-red-500">{blockReasonError}</strong> : 'Required'}</span>
              <span>{blockReason.length} / 200 chars</span>
            </div>
          </div>
        </form>
      </Modal>

      {/* Unblock Confirmation Modal */}
      <Modal
        isOpen={!!unblockingUser}
        onClose={() => setUnblockingUser(null)}
        title="Unblock User Account"
        description={`Are you sure you want to restore access for ${unblockingUser?.name} (${unblockingUser?.email})?`}
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUnblockingUser(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={unblockMutation.isPending}
              disabled={unblockMutation.isPending}
              onClick={() => {
                if (unblockingUser) {
                  unblockMutation.mutate(unblockingUser.id);
                }
              }}
            >
              Confirm Unblock
            </Button>
          </>
        }
      >
        <p className="text-xs text-gray-600 dark:text-gray-300">
          The user will regain login access to their account and can place new bookings or join live virtual queues.
        </p>
      </Modal>
    </div>
  );
};
