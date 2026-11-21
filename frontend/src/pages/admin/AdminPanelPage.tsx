import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  Users,
  FileText,
  MailX,
  ShieldAlert,
} from 'lucide-react';
import { AdminOverviewTab } from './tabs/AdminOverviewTab';
import { AdminBusinessesTab } from './tabs/AdminBusinessesTab';
import { AdminUsersTab } from './tabs/AdminUsersTab';
import { AdminAuditLogTab } from './tabs/AdminAuditLogTab';
import { AdminFailedEmailsTab } from './tabs/AdminFailedEmailsTab';

export type AdminTab = 'overview' | 'businesses' | 'users' | 'audit' | 'failed-emails';

export const AdminPanelPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = (searchParams.get('tab') as AdminTab) || 'overview';

  useEffect(() => {
    document.title = 'Admin Panel | QueueLess';
  }, []);

  const handleTabChange = (tab: AdminTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
          <ShieldAlert className="w-4 h-4" />
          <span>Platform Administration</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight mt-0.5">
          Admin Governance &amp; Moderation
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
          Review business listings, govern platform accounts, monitor transmission errors, and audit interventions.
        </p>
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="flex space-x-2 sm:space-x-8 overflow-x-auto pb-1" aria-label="Admin Tabs">
          <button
            type="button"
            onClick={() => handleTabChange('overview')}
            className={`py-3 px-3 inline-flex items-center gap-2 border-b-2 font-bold text-sm whitespace-nowrap transition-colors ${
              currentTab === 'overview'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Overview
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('businesses')}
            className={`py-3 px-3 inline-flex items-center gap-2 border-b-2 font-bold text-sm whitespace-nowrap transition-colors ${
              currentTab === 'businesses'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Building2 className="w-4 h-4" />
            Businesses
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('users')}
            className={`py-3 px-3 inline-flex items-center gap-2 border-b-2 font-bold text-sm whitespace-nowrap transition-colors ${
              currentTab === 'users'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Users className="w-4 h-4" />
            Users
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('audit')}
            className={`py-3 px-3 inline-flex items-center gap-2 border-b-2 font-bold text-sm whitespace-nowrap transition-colors ${
              currentTab === 'audit'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            Audit Log
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('failed-emails')}
            className={`py-3 px-3 inline-flex items-center gap-2 border-b-2 font-bold text-sm whitespace-nowrap transition-colors ${
              currentTab === 'failed-emails'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <MailX className="w-4 h-4" />
            Failed Emails
          </button>
        </nav>
      </div>

      {/* Tab Panels */}
      <div>
        {currentTab === 'overview' && <AdminOverviewTab />}
        {currentTab === 'businesses' && <AdminBusinessesTab />}
        {currentTab === 'users' && <AdminUsersTab />}
        {currentTab === 'audit' && <AdminAuditLogTab />}
        {currentTab === 'failed-emails' && <AdminFailedEmailsTab />}
      </div>
    </div>
  );
};
export default AdminPanelPage;
