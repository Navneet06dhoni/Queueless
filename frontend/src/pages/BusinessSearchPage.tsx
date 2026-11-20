import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { businessApi } from '../api';
import {
  Card,
  Badge,
  Button,
  Skeleton,
  EmptyState,
  ErrorState,
  Pagination,
} from '../components/ui';
import { Search, MapPin, Building2, ArrowRight, X } from 'lucide-react';

const CATEGORIES = [
  { value: '', label: 'All Categories' },
  { value: 'clinic', label: 'Clinics & Doctors' },
  { value: 'salon', label: 'Salons & Spas' },
  { value: 'hospital', label: 'Hospitals' },
  { value: 'auto_service', label: 'Automobile Service' },
  { value: 'other', label: 'Other Services' },
];

export const BusinessSearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const qParam = searchParams.get('q') || '';
  const categoryParam = searchParams.get('category') || '';
  const cityParam = searchParams.get('city') || '';
  const pageParam = parseInt(searchParams.get('page') || '1', 10);

  const [searchInput, setSearchInput] = useState(qParam);

  // Sync internal search input if URL changes externally (e.g. back button)
  useEffect(() => {
    setSearchInput(qParam);
  }, [qParam]);

  // Debounced search input update to URL
  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput !== qParam) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          if (searchInput.trim()) {
            next.set('q', searchInput.trim());
          } else {
            next.delete('q');
          }
          next.set('page', '1');
          return next;
        });
      }
    }, 350);

    return () => clearTimeout(handler);
  }, [searchInput, qParam, setSearchParams]);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
        next.set('page', '1');
        return next;
      });
    },
    [setSearchParams]
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('page', newPage.toString());
        return next;
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [setSearchParams]
  );

  const clearAllFilters = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams());
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['businesses', { q: qParam, category: categoryParam, city: cityParam, page: pageParam }],
    queryFn: ({ signal }) =>
      businessApi.getApprovedBusinesses(
        {
          q: qParam || undefined,
          category: categoryParam || undefined,
          city: cityParam || undefined,
          page: pageParam,
          limit: 9,
        },
        signal
      ),
    staleTime: 30000,
  });

  const businesses = data?.data || [];
  const total = data?.total || 0;
  const limit = data?.limit || 9;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          Find Businesses
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Book appointments or monitor virtual queues at verified local establishments
        </p>
      </div>

      {/* Filters Bar */}
      <div className="p-4 sm:p-5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-soft flex flex-col md:flex-row gap-3 items-center">
        {/* Keyword Search */}
        <div className="relative w-full md:flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by business name..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Dropdown */}
        <div className="w-full md:w-56">
          <select
            value={categoryParam}
            onChange={(e) => updateFilter('category', e.target.value)}
            aria-label="Filter by category"
            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* City Filter */}
        <div className="w-full md:w-48 relative">
          <MapPin className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter city..."
            value={cityParam}
            onChange={(e) => updateFilter('city', e.target.value)}
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {(qParam || categoryParam || cityParam) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="text-xs text-gray-500 hover:text-gray-900 shrink-0"
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Results Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="p-6 space-y-4">
              <div className="flex justify-between items-start">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <div className="pt-4 border-t border-gray-100 dark:border-gray-800 flex justify-end">
                <Skeleton className="h-9 w-24 rounded-xl" />
              </div>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Could not load businesses"
          message="An error occurred while communicating with the server. Please check your network and try again."
          onRetry={() => refetch()}
        />
      ) : businesses.length === 0 ? (
        <EmptyState
          icon={<Building2 className="w-7 h-7" />}
          title="No businesses found"
          description={
            qParam || categoryParam || cityParam
              ? 'No approved businesses match your search filters. Try adjusting your query or clearing filters.'
              : 'There are currently no approved businesses on the platform.'
          }
          action={
            (qParam || categoryParam || cityParam) && (
              <Button variant="outline" size="sm" onClick={clearAllFilters}>
                Clear All Filters
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {businesses.map((biz) => {
              const categoryVariants: Record<string, 'primary' | 'success' | 'warning' | 'neutral'> = {
                clinic: 'primary',
                salon: 'warning',
                hospital: 'success',
              };

              return (
                <Card
                  key={biz.id}
                  variant="interactive"
                  className="flex flex-col justify-between hover:scale-[1.01] transition-transform"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-snug">
                        {biz.name}
                      </h3>
                      <Badge
                        variant={categoryVariants[biz.category] || 'neutral'}
                        className="capitalize shrink-0"
                      >
                        {biz.category.replace('_', ' ')}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <MapPin className="w-3.5 h-3.5 text-primary-500 shrink-0" />
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        {biz.city}
                      </span>
                      <span>•</span>
                      <span className="truncate">{biz.address}</span>
                    </div>
                  </div>

                  <div className="pt-6 mt-6 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      Verified & Approved
                    </span>
                    <Link to={`/businesses/${biz.id}`}>
                      <Button
                        variant="primary"
                        size="sm"
                        rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                      >
                        View
                      </Button>
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>

          <Pagination
            page={pageParam}
            total={total}
            limit={limit}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
};
