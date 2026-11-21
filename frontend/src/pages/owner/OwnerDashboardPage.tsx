import React, { useState, useEffect, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { businessApi } from '../../api';
import {
  Card,
  Badge,
  Button,
  Tabs,
  Skeleton,
  EmptyState,
} from '../../components/ui';
import {
  Building2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { LiveQueueTab } from './LiveQueueTab';
import { TodayTab } from './TodayTab';

// Lazy-load AnalyticsTab so Recharts is in a separate bundle chunk
const AnalyticsTab = React.lazy(() =>
  import('./AnalyticsTab').then((m) => ({ default: m.AnalyticsTab }))
);

export const OwnerDashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'live' | 'today' | 'analytics'>('live');
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(() => {
    return localStorage.getItem('queueless_owner_selected_business') || null;
  });

  useEffect(() => {
    document.title = 'Owner Dashboard | QueueLess';
  }, []);

  // Fetch all businesses owned by this user
  const {
    data: businesses,
    isLoading,
  } = useQuery({
    queryKey: ['owner-businesses'],
    queryFn: () => businessApi.getOwnerBusinesses(),
  });

  const businessList = businesses || [];
  const approvedBusinesses = businessList.filter((b) => b.status === 'approved');

  // Sync selected business ID
  useEffect(() => {
    if (approvedBusinesses.length > 0) {
      if (!selectedBusinessId || !approvedBusinesses.some((b) => b.id === selectedBusinessId)) {
        const firstId = approvedBusinesses[0].id;
        setSelectedBusinessId(firstId);
        localStorage.setItem('queueless_owner_selected_business', firstId);
      }
    }
  }, [approvedBusinesses, selectedBusinessId]);

  const handleSelectBusiness = (id: string) => {
    setSelectedBusinessId(id);
    localStorage.setItem('queueless_owner_selected_business', id);
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Skeleton className="h-12 w-1/3 rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-3xl" />
      </div>
    );
  }

  // If no businesses created at all
  if (businessList.length === 0) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-6">
        <EmptyState
          icon={<Building2 className="w-12 h-12 text-gray-400" />}
          title="No registered businesses found"
          description="You do not have any registered businesses yet. Create your first business profile to manage slots, appointments, and live virtual queues."
          action={
            <Link to="/businesses">
              <Button variant="primary">Explore Platform</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const selectedBusiness = approvedBusinesses.find((b) => b.id === selectedBusinessId) || null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Header & Business Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-primary-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Owner Desk</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Business Operations
          </h1>
        </div>

        {/* Business Selector Pill / Dropdown */}
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="owner-business-select" className="sr-only">
            Select Active Business
          </label>
          <div className="relative min-w-[240px]">
            <select
              id="owner-business-select"
              value={selectedBusinessId || ''}
              onChange={(e) => handleSelectBusiness(e.target.value)}
              className="w-full appearance-none px-4 py-2.5 pr-10 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-bold text-gray-900 dark:text-white shadow-xs focus:ring-2 focus:ring-primary-500"
            >
              {approvedBusinesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.city})
                </option>
              ))}
            </select>
            <Building2 className="w-4 h-4 text-gray-400 absolute right-3 top-3 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Non-Approved Businesses Alert Banner (Pending or Rejected) */}
      {businessList.some((b) => b.status !== 'approved') && (
        <div className="space-y-2">
          {businessList
            .filter((b) => b.status !== 'approved')
            .map((b) => (
              <div
                key={b.id}
                className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="font-semibold text-amber-900 dark:text-amber-200">
                    {b.name}:
                  </span>
                  <span className="text-amber-700 dark:text-amber-300">
                    {b.status === 'pending'
                      ? 'Registration submitted and awaiting platform admin approval.'
                      : 'Registration was rejected by administration. Review requirements.'}
                  </span>
                </div>
                <Badge
                  variant={b.status === 'pending' ? 'warning' : 'danger'}
                  size="sm"
                  className="capitalize"
                >
                  {b.status}
                </Badge>
              </div>
            ))}
        </div>
      )}

      {/* No approved business check */}
      {approvedBusinesses.length === 0 ? (
        <Card className="p-8 text-center space-y-4">
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            No Approved Businesses Available
          </h2>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            Your registered business is currently pending verification. Once an administrator approves your business, your live queue desk and analytics will activate automatically.
          </p>
        </Card>
      ) : selectedBusiness ? (
        <>
          {/* Navigation Tabs */}
          <Tabs
            activeTab={activeTab}
            onChange={(tabId) => setActiveTab(tabId as any)}
            tabs={[
              { id: 'live', label: 'Live Queue' },
              { id: 'today', label: 'Today' },
              { id: 'analytics', label: 'Analytics' },
            ]}
          />

          {/* Tab Content */}
          <div className="mt-6">
            {activeTab === 'live' && (
              <LiveQueueTab businessId={selectedBusiness.id} />
            )}
            {activeTab === 'today' && (
              <TodayTab businessId={selectedBusiness.id} />
            )}
            {activeTab === 'analytics' && (
              <Suspense
                fallback={
                  <div className="space-y-6">
                    <Skeleton className="h-28 rounded-2xl" />
                    <Skeleton className="h-80 rounded-3xl" />
                  </div>
                }
              >
                <AnalyticsTab businessId={selectedBusiness.id} />
              </Suspense>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};
