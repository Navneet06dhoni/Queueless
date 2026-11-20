import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  ariaLabel?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  className = '',
  ariaLabel = 'Loading',
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-10 h-10 border-3',
  };

  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={`inline-block animate-spin rounded-full border-solid border-primary-600 border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite] ${sizeClasses[size]} ${className}`}
    >
      <span className="sr-only">{ariaLabel}</span>
    </div>
  );
};
