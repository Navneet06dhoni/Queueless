import { api } from './client';
import {
  AuthResponse,
  BusinessDetail,
  BusinessListQuery,
  IBusiness,
  ISlot,
  LoginInput,
  NotificationsResponse,
  PaginatedResult,
  RegisterInput,
  AppointmentDetail,
  User,
  INotification,
} from './types';

export * from './types';
export * from './client';

export const authApi = {
  register: async (data: RegisterInput): Promise<AuthResponse> => {
    const res = await api.post<AuthResponse>('/auth/register', data);
    return res.data;
  },
  login: async (data: LoginInput): Promise<AuthResponse> => {
    const res = await api.post<AuthResponse>('/auth/login', data);
    return res.data;
  },
  refresh: async (): Promise<AuthResponse> => {
    const res = await api.post<AuthResponse>('/auth/refresh');
    return res.data;
  },
  logout: async (): Promise<{ message: string }> => {
    const res = await api.post<{ message: string }>('/auth/logout');
    return res.data;
  },
  getMe: async (): Promise<{ user: User }> => {
    const res = await api.get<{ user: User }>('/auth/me');
    return res.data;
  },
};

export const businessApi = {
  getApprovedBusinesses: async (
    params: BusinessListQuery = {},
    signal?: AbortSignal
  ): Promise<PaginatedResult<IBusiness>> => {
    const res = await api.get<PaginatedResult<IBusiness>>('/businesses', {
      params,
      signal,
    });
    return res.data;
  },
  getBusinessDetail: async (id: string, signal?: AbortSignal): Promise<BusinessDetail> => {
    const res = await api.get<{ business: BusinessDetail }>(`/businesses/${id}`, { signal });
    return res.data.business;
  },
  getSlots: async (
    businessId: string,
    params: { date: string; service_id?: string },
    signal?: AbortSignal
  ): Promise<ISlot[]> => {
    const res = await api.get<{ slots: ISlot[] }>(`/businesses/${businessId}/slots`, {
      params,
      signal,
    });
    return res.data.slots;
  },
};

export const bookingApi = {
  bookAppointment: async (slotId: string): Promise<AppointmentDetail> => {
    const res = await api.post<{ appointment: AppointmentDetail }>('/appointments', {
      slot_id: slotId,
    });
    return res.data.appointment;
  },
  getMyAppointments: async (
    params: { status?: string; page?: number; limit?: number } = {},
    signal?: AbortSignal
  ): Promise<PaginatedResult<AppointmentDetail>> => {
    const res = await api.get<PaginatedResult<AppointmentDetail>>('/appointments/me', {
      params,
      signal,
    });
    return res.data;
  },
  cancelAppointment: async (id: string): Promise<{ message: string }> => {
    const res = await api.delete<{ message: string }>(`/appointments/${id}`);
    return res.data;
  },
  rescheduleAppointment: async (
    id: string,
    newSlotId: string
  ): Promise<{ message: string; appointment: any }> => {
    const res = await api.patch<{ message: string; appointment: any }>(
      `/appointments/${id}/reschedule`,
      {
        new_slot_id: newSlotId,
      }
    );
    return res.data;
  },
};

export const notificationApi = {
  getNotifications: async (
    params: { status?: string; page?: number; limit?: number } = {},
    signal?: AbortSignal
  ): Promise<NotificationsResponse> => {
    const res = await api.get<NotificationsResponse>('/notifications', {
      params,
      signal,
    });
    return res.data;
  },
  markAsRead: async (id: string): Promise<INotification> => {
    const res = await api.patch<{ notification: INotification }>(`/notifications/${id}/read`);
    return res.data.notification;
  },
  markAllAsRead: async (): Promise<{ count: number; message: string }> => {
    const res = await api.post<{ success: boolean; count: number; message: string }>(
      '/notifications/read-all'
    );
    return res.data;
  },
};
