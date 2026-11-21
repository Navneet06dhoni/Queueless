import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { businessApi } from '../../../api';
import {
  Skeleton,
} from '../../../components/ui';
import {
  Building2,
  Scissors,
  Clock,
  Calendar,
  ChevronRight,
} from 'lucide-react';
import { BusinessManageTab } from './BusinessManageTab';
import { ServicesManageTab } from './ServicesManageTab';
import { WorkingHoursManageTab } from './WorkingHoursManageTab';
import { SlotsManageTab } from './SlotsManageTab';

export type ManageSubTab = 'business' | 'services' | 'hours' | 'slots';

export const OwnerManagePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = (searchParams.get('tab') as ManageSubTab) || 'business';

  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(() => {
    return localStorage.getItem('queueless_owner_selected_business') || null;
  });

  useEffect(() => {
    document.title = 'Owner Management | QueueLess';
  }, []);

  const {
    data: businesses,
    isLoading,
    refetch: refetchBusinesses,
  } = useQuery({
    queryKey: ['owner-businesses'],
    queryFn: () => businessApi.getOwnerBusinesses(),
  });

  const businessList = useMemo(() => businesses || [], [businesses]);

  // Sync selected business ID
  useEffect(() => {
    if (businessList.length > 0) {
      if (!selectedBusinessId || !businessList.some((b) => b.id === selectedBusinessId)) {
        const firstId = businessList[0].id;
        setSelectedBusinessId(firstId);
        localStorage.setItem('queueless_owner_selected_business', firstId);
      }
    }
  }, [businessList, selectedBusinessId]);

  const handleSelectBusiness = (id: string) => {
    setSelectedBusinessId(id);
    localStorage.setItem('queueless_owner_selected_business', id);
  };

  const handleTabChange = (tab: ManageSubTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-3xl" />
      </div>
    );
  }

  const selectedBiz = businessList.find((b) => b.id === selectedBusinessId) || businessList[0] || null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Breadcrumb & Navigation Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1">
            <Link to="/owner" className="hover:text-primary-600 transition">
              Owner Dashboard
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="font-semibold text-gray-900 dark:text-white">Management</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Business &amp; Operations Management
          </h1>
        </div>

        {/* Shared Business Switcher Selector */}
        {businessList.length > 1 && (
          <div className="flex items-center gap-2">
            <label htmlFor="owner-biz-switcher" className="text-xs text-gray-500 dark:text-gray-400 font-semibold whitespace-nowrap">
              Active Business:
            </label>
            <select
              id="owner-biz-switcher"
              value={selectedBiz?.id || ''}
              onChange={(e) => handleSelectBusiness(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {businessList.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="flex space-x-2 sm:space-x-8 overflow-x-auto pb-1" aria-label="Management Tabs">
          <button
            type="button"
            onClick={() => handleTabChange('business')}
            className={`py-3 px-3 inline-flex items-center gap-2 border-b-2 font-bold text-sm whitespace-nowrap transition-colors ${
              currentTab === 'business'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Building2 className="w-4 h-4" />
            Business Profile
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('services')}
            disabled={!selectedBiz}
            className={`py-3 px-3 inline-flex items-center gap-2 border-b-2 font-bold text-sm whitespace-nowrap transition-colors ${
              currentTab === 'services'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            } ${!selectedBiz ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <Scissors className="w-4 h-4" />
            Services
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('hours')}
            disabled={!selectedBiz}
            className={`py-3 px-3 inline-flex items-center gap-2 border-b-2 font-bold text-sm whitespace-nowrap transition-colors ${
              currentTab === 'hours'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            } ${!selectedBiz ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <Clock className="w-4 h-4" />
            Working Hours
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('slots')}
            disabled={!selectedBiz}
            className={`py-3 px-3 inline-flex items-center gap-2 border-b-2 font-bold text-sm whitespace-nowrap transition-colors ${
              currentTab === 'slots'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            } ${!selectedBiz ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <Calendar className="w-4 h-4" />
            Slots
          </button>
        </nav>
      </div>

      {/* Tab Panels */}
      <div>
        {currentTab === 'business' && (
          <BusinessManageTab
            businesses={businessList}
            selectedBusinessId={selectedBiz?.id || null}
            onSelectBusiness={handleSelectBusiness}
            refetchBusinesses={refetchBusinesses}
          />
        )}

        {currentTab === 'services' && selectedBiz && (
          <ServicesManageTab businessId={selectedBiz.id} />
        )}

        {currentTab === 'hours' && selectedBiz && (
          <WorkingHoursManageTab businessId={selectedBiz.id} />
        )}

        {currentTab === 'slots' && selectedBiz && (
          <SlotsManageTab businessId={selectedBiz.id} />
        )}
      </div>
    </div>
  );
};
export default OwnerManagePage;
