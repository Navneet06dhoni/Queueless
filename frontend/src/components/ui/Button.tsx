import React from 'react';
import { Spinner } from './Spinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      className = '',
      type = 'button',
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed select-none';

    const variants = {
      primary:
        'bg-primary-600 hover:bg-primary-700 text-white shadow-soft focus:ring-primary-500 active:bg-primary-800',
      secondary:
        'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 focus:ring-gray-400',
      outline:
        'border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300 focus:ring-primary-500',
      danger:
        'bg-red-600 hover:bg-red-700 text-white shadow-soft focus:ring-red-500 active:bg-red-800',
      ghost:
        'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 focus:ring-primary-500',
    };

    const sizes = {
      sm: 'text-xs px-3 py-1.5 gap-1.5',
      md: 'text-sm px-4 py-2 gap-2',
      lg: 'text-base px-6 py-2.5 gap-2.5',
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {isLoading && <Spinner size="sm" className="text-current border-current border-r-transparent mr-1" />}
        {!isLoading && leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
        <span>{children}</span>
        {!isLoading && rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
