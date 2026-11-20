import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onChange,
  className = '',
}) => {
  return (
    <div className={`flex border-b border-gray-200 dark:border-gray-800 space-x-6 overflow-x-auto ${className}`}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap focus:outline-none ${
              isActive
                ? 'border-primary-600 text-primary-600 dark:text-primary-400 font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
                  isActive
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
