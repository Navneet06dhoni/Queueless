import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'flat' | 'interactive';
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  className = '',
  ...props
}) => {
  const variants = {
    default:
      'bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-soft',
    flat:
      'bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800',
    interactive:
      'bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-soft hover:shadow-soft-lg hover:border-primary-200 dark:hover:border-primary-900 transition-all cursor-pointer',
  };

  return (
    <div className={`rounded-2xl p-6 ${variants[variant]} ${className}`} {...props}>
      {children}
    </div>
  );
};
