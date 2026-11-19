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
  created_at: Date;
}

export interface IService {
  id: string;
  business_id: string;
  name: string;
  duration_minutes: number;
  price: number;
  created_at: Date;
}

export interface IWorkingHour {
  id?: string;
  business_id?: string;
  day_of_week: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  open_time: string;   // e.g. "09:00"
  close_time: string;  // e.g. "17:00"
}

export interface ISlot {
  id: string;
  service_id: string;
  start_time: Date;
  end_time: Date;
  status: SlotStatus;
}

export interface BusinessDetail extends IBusiness {
  services: IService[];
  working_hours: IWorkingHour[];
}

export interface BusinessListQuery {
  q?: string;
  category?: string;
  city?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}
