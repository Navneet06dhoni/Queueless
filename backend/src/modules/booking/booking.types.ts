export type AppointmentStatus = 'confirmed' | 'cancelled' | 'completed' | 'no_show';

export interface IAppointment {
  id: string;
  slot_id: string;
  customer_id: string;
  status: AppointmentStatus;
  created_at: Date;
}

export interface SlotWithServiceBusiness {
  id: string;
  service_id: string;
  start_time: Date;
  end_time: Date;
  status: string;
  service_name: string;
  duration_minutes: number;
  price: number;
  business_id: string;
  business_name: string;
  business_status: string;
  business_owner_id: string;
}

export interface AppointmentDetail {
  id: string;
  slot_id: string;
  customer_id: string;
  status: AppointmentStatus;
  created_at: Date;
  slot: {
    id: string;
    start_time: Date;
    end_time: Date;
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
