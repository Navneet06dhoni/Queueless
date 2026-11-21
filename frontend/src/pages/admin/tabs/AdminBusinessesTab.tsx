import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../../../api';
import { IBusiness, BusinessStatus } from '../../../api/types';
import { useToast } from '../../../components/ui/Toast';
import { formatDate } from '../../../utils/date';
import {
  Card,
  Badge,
  Button,
  Modal,
  Skeleton,
  EmptyState,
} from '../../../components/ui';
import {
  Building2,
  CheckCircle,
  XCircle,
  MapPin,
  Phone,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export const AdminBusinessesTab: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [statusFilter, setStatusFilter] = useState<BusinessStatus>('pending');
  const [page, setPage] = useState(1);
  const limit = 10;

  // Status Action Modal State
  const [actionTarget, setActionTarget] = useState<{
    business: IBusiness;
    newStatus: 'approved' | 'rejected';
  } | null>(null);

  // Fetch businesses with pagination and status filter
  const { data: result, isLoading } = useQuery({
    queryKey: ['admin-businesses', statusFilter, page, limit],
    queryFn: () => adminApi.listBusinesses({ status: statusFilter, page, limit }),
  });

  const businesses = result?.data || [];
  const total = result?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Status change mutation
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'approved' | 'rejected' }) =>
      adminApi.updateBusinessStatus(id, status),
    onSuccess: (updatedBiz) => {
      setActionTarget(null);
      // Invalidate queries to update immediately
      queryClient.invalidateQueries({ queryKey: ['admin-businesses'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success(
        `Business "${updatedBiz.name}" has been ${
          updatedBiz.status === 'approved' ? 'approved and made live' : 'rejected'
        }`
      );
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error?.message || 'Failed to update business status';
      toast.error(msg);
    },
  });

  const handleStatusFilterChange = (status: BusinessStatus) => {
    setStatusFilter(status);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Top Controls: Status Filter Tabs & Counts */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 p-1 rounded-2xl bg-gray-100 dark:bg-gray-800/80">
          {(['pending', 'approved', 'rejected'] as BusinessStatus[]).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => handleStatusFilterChange(st)}
              className={`px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all ${
                statusFilter === st
                  ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              {st} {st === 'pending' && total > 0 && statusFilter === 'pending' ? `(${total})` : ''}
            </button>
          ))}
        </div>

        <span className="text-xs text-gray-400">
          Showing {businesses.length} of {total} {statusFilter} businesses
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : businesses.length === 0 ? (
        <Card className="p-8 text-center">
          <EmptyState
            icon={<Building2 className="w-12 h-12 text-gray-400" />}
            title={`No ${statusFilter} businesses`}
            description={`There are currently no business listings with status "${statusFilter}".`}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 border border-gray-100 dark:border-gray-800">
          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th scope="col" className="px-5 py-3">Business</th>
                  <th scope="col" className="px-5 py-3">Category</th>
                  <th scope="col" className="px-5 py-3">Location & Phone</th>
                  <th scope="col" className="px-5 py-3">Submitted Date</th>
                  <th scope="col" className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {businesses.map((biz) => (
                  <tr key={biz.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-bold text-gray-900 dark:text-white">
                        {biz.name}
                      </div>
                      <div className="text-xs text-gray-400 font-mono">
                        ID: {biz.id.slice(0, 8)}...
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                        {biz.category}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-xs text-gray-600 dark:text-gray-300">
                      <div>{biz.address}, {biz.city}</div>
                      <div className="text-gray-400">{biz.phone}</div>
                    </td>

                    <td className="px-5 py-4 text-xs text-gray-500">
                      {formatDate(biz.created_at, 'dd MMM yyyy')}
                    </td>

                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {biz.status !== 'approved' && (
                          <Button
                            variant="primary"
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-xs py-1"
                            onClick={() =>
                              setActionTarget({ business: biz, newStatus: 'approved' })
                            }
                          >
                            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                        )}

                        {biz.status !== 'rejected' && (
                          <Button
                            variant="danger"
                            size="sm"
                            className="text-xs py-1"
                            onClick={() =>
                              setActionTarget({ business: biz, newStatus: 'rejected' })
                            }
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Card View (360px friendly) */}
          <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
            {businesses.map((biz) => (
              <div key={biz.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                      {biz.category}
                    </span>
                    <h4 className="text-base font-bold text-gray-900 dark:text-white">
                      {biz.name}
                    </h4>
                  </div>
                  <Badge
                    variant={
                      biz.status === 'approved'
                        ? 'success'
                        : biz.status === 'rejected'
                        ? 'danger'
                        : 'warning'
                    }
                    size="sm"
                    className="capitalize"
                  >
                    {biz.status}
                  </Badge>
                </div>

                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span>{biz.address}, {biz.city}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 shrink-0" />
                    <span>{biz.phone}</span>
                  </div>
                  <div className="text-[11px] text-gray-400 pt-1">
                    Submitted: {formatDate(biz.created_at, 'dd MMM yyyy')}
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-800/60">
                  {biz.status !== 'approved' && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-xs"
                      onClick={() =>
                        setActionTarget({ business: biz, newStatus: 'approved' })
                      }
                    >
                      <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                    </Button>
                  )}
                  {biz.status !== 'rejected' && (
                    <Button
                      variant="danger"
                      size="sm"
                      className="text-xs"
                      onClick={() =>
                        setActionTarget({ business: biz, newStatus: 'rejected' })
                      }
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                    </Button>
                  )}
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
      )}

      {/* Approve / Reject Confirmation Modal */}
      <Modal
        isOpen={!!actionTarget}
        onClose={() => setActionTarget(null)}
        title={
          actionTarget?.newStatus === 'approved'
            ? 'Approve Business Listing?'
            : 'Reject Business Listing?'
        }
        description={`Business: "${actionTarget?.business.name}" • Category: ${actionTarget?.business.category}`}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setActionTarget(null)}>
              Cancel
            </Button>
            <Button
              variant={actionTarget?.newStatus === 'approved' ? 'primary' : 'danger'}
              size="sm"
              className={actionTarget?.newStatus === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
              isLoading={statusMutation.isPending}
              disabled={statusMutation.isPending}
              onClick={() => {
                if (actionTarget) {
                  statusMutation.mutate({
                    id: actionTarget.business.id,
                    status: actionTarget.newStatus,
                  });
                }
              }}
            >
              {actionTarget?.newStatus === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
            </Button>
          </>
        }
      >
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {actionTarget?.newStatus === 'approved'
            ? 'Approving will publish this business to the public search directory, allowing customers to book appointments and join the live virtual queue.'
            : 'Rejecting will hide this business from public search and notify the owner to update their listing information.'}
        </p>
      </Modal>
    </div>
  );
};
