import React, { useId } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  error?: string;
  helperText?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, error, helperText, className = '', id, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id || generatedId;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1.5"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`block w-full rounded-xl border bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm transition-colors py-2.5 px-3.5 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 cursor-pointer ${
            error
              ? 'border-red-500 dark:border-red-500 focus:ring-red-500'
              : 'border-gray-300 dark:border-gray-700'
          } ${className}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${selectId}-error` : helperText ? `${selectId}-helper` : undefined}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={`${selectId}-error`} className="mt-1.5 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {!error && helperText && (
          <p id={`${selectId}-helper`} className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
