import { UserRole } from '../auth/auth.types';
import { BusinessStatus } from '../business/business.types';

export interface AdminStats {
  users: {
    customer: number;
    owner: number;
    admin: number;
    total: number;
  };
  businesses: {
    pending: number;
    approved: number;
    rejected: number;
    total: number;
  };
  appointments: {
    confirmed: number;
    completed: number;
    no_show: number;
    cancelled: number;
    total30Days: number;
  };
  queueServed30Days: number;
  failedEmails: number;
  daily: Array<{
    date: string;
    newUsers: number;
    newAppointments: number;
  }>;
}

export interface AdminUserListItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_blocked: boolean;
  blocked_at: string | null;
  blocked_reason: string | null;
  created_at: string;
}

export interface AdminAuditLogItem {
  id: string;
  admin_id: string;
  admin_name: string | null;
  admin_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: any;
  created_at: string;
}

export interface BlockUserInput {
  blocked: boolean;
  reason?: string;
}

export interface ListUsersQuery {
  role?: UserRole;
  q?: string;
  blocked?: boolean;
  page?: number;
  limit?: number;
}
