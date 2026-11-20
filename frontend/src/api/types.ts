export type UserRole = 'customer' | 'owner' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_blocked?: boolean;
  blocked_at?: string | null;
  blocked_reason?: string | null;
  created_at: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role: 'customer' | 'owner';
}

export interface LoginInput {
  email: string;
  password: string;
}

export type BusinessStatus = 'pending' | 'approved' | 'rejected';
export type SlotStatus = 'free' | 'booked';

export interface IBusiness {
  id: string;
  owner_id: string;
  name: string;
  category: string;
  address: string;
  city: string;
  phone: string;
  status: BusinessStatus;
  created_at: string;
}

export interface IService {
  id: string;
  business_id: string;
  name: string;
  duration_minutes: number;
  price: number;
  created_at: string;
}

export interface IWorkingHour {
  id?: string;
  business_id?: string;
  day_of_week: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  open_time: string;   // "09:00"
  close_time: string;  // "17:00"
}

export interface ISlot {
  id: string;
  service_id: string;
  start_time: string;
  end_time: string;
  status: SlotStatus;
}

export interface BusinessDetail extends IBusiness {
  services: IService[];
  working_hours: IWorkingHour[];
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export interface BusinessListQuery {
  q?: string;
  category?: string;
  city?: string;
  page?: number;
  limit?: number;
}

export type AppointmentStatus = 'confirmed' | 'cancelled' | 'completed' | 'no_show';

export interface AppointmentDetail {
  id: string;
  slot_id: string;
  customer_id: string;
  status: AppointmentStatus;
  created_at: string;
  slot: {
    id: string;
    start_time: string;
    end_time: string;
    status: string;
  };
  service: {
    id: string;
    name: string;
    duration_minutes: number;
    price: number;
  };
  business: {
    id: string;
    name: string;
    category: string;
    address: string;
    city: string;
    phone: string;
  };
  customer?: {
    id: string;
    name: string;
    email: string;
  };
}

export type NotificationStatus = 'unread' | 'read';
export type EmailDeliveryStatus = 'not_required' | 'pending' | 'sent' | 'failed';

export interface INotification {
  id: string;
  user_id: string;
  type: string;
  title: string | null;
  message: string;
  data: any;
  dedupe_key: string | null;
  read_at: string | null;
  email_status: EmailDeliveryStatus;
  email_attempts: number;
  last_error: string | null;
  status: NotificationStatus;
  created_at: string;
}

export interface NotificationsResponse {
  data: INotification[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}
