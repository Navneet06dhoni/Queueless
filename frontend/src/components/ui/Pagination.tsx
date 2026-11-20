import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  onPageChange: (newPage: number) => void;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  total,
  limit,
  onPageChange,
  className = '',
}) => {
  const totalPages = Math.ceil(total / limit) || 1;
  if (totalPages <= 1) return null;

  return (
    <div className={`flex items-center justify-between border-t border-gray-200 dark:border-gray-800 pt-4 px-2 ${className}`}>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        Page <span className="font-semibold text-gray-900 dark:text-white">{page}</span> of{' '}
        <span className="font-semibold text-gray-900 dark:text-white">{totalPages}</span> ({total} items)
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          leftIcon={<ChevronLeft className="w-4 h-4" />}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          rightIcon={<ChevronRight className="w-4 h-4" />}
        >
          Next
        </Button>
      </div>
    </div>
  );
};
