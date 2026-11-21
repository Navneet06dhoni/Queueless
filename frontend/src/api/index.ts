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
  PublicQueueStatus,
  CustomerQueuePosition,
  JoinQueueResponse,
  OwnerQueueCurrentItem,
  OwnerQueueDetails,
  BusinessSummaryAnalytics,
  BusinessTodayAnalytics,
  CreateBusinessInput,
  CreateServiceInput,
  IService,
  WorkingHourInput,
  IWorkingHour,
  GenerateSlotsInput,
  GenerateSlotsResponse,
  AdminStats,
  AdminUserListItem,
  AdminAuditLogItem,
  AdminFailedNotificationItem,
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
  getOwnerBusinesses: async (signal?: AbortSignal): Promise<IBusiness[]> => {
    const res = await api.get<{ businesses: IBusiness[] }>('/businesses/mine', { signal });
    return res.data.businesses;
  },
  getBusinessAppointments: async (
    businessId: string,
    date: string,
    signal?: AbortSignal
  ): Promise<AppointmentDetail[]> => {
    const res = await api.get<{ appointments: AppointmentDetail[] }>(
      `/businesses/${businessId}/appointments`,
      {
        params: { date },
        signal,
      }
    );
    return res.data.appointments;
  },
  createBusiness: async (data: CreateBusinessInput): Promise<IBusiness> => {
    const res = await api.post<{ business: IBusiness }>('/businesses', data);
    return res.data.business;
  },
  updateBusiness: async (id: string, data: Partial<CreateBusinessInput>): Promise<IBusiness> => {
    const res = await api.put<{ business: IBusiness }>(`/businesses/${id}`, data);
    return res.data.business;
  },
  addService: async (businessId: string, data: CreateServiceInput): Promise<IService> => {
    const res = await api.post<{ service: IService }>(`/businesses/${businessId}/services`, data);
    return res.data.service;
  },
  updateService: async (
    businessId: string,
    serviceId: string,
    data: Partial<CreateServiceInput>
  ): Promise<IService> => {
    const res = await api.put<{ service: IService }>(
      `/businesses/${businessId}/services/${serviceId}`,
      data
    );
    return res.data.service;
  },
  deleteService: async (businessId: string, serviceId: string): Promise<{ message: string }> => {
    const res = await api.delete<{ message: string }>(
      `/businesses/${businessId}/services/${serviceId}`
    );
    return res.data;
  },
  setWorkingHours: async (
    businessId: string,
    workingHours: WorkingHourInput[]
  ): Promise<IWorkingHour[]> => {
    const res = await api.put<{ working_hours: IWorkingHour[] }>(
      `/businesses/${businessId}/working-hours`,
      workingHours
    );
    return res.data.working_hours;
  },
  generateSlots: async (
    businessId: string,
    data: GenerateSlotsInput
  ): Promise<GenerateSlotsResponse> => {
    const res = await api.post<GenerateSlotsResponse>(
      `/businesses/${businessId}/slots/generate`,
      data
    );
    return res.data;
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
  updateAppointmentStatus: async (
    id: string,
    status: 'completed' | 'no_show'
  ): Promise<AppointmentDetail> => {
    const res = await api.patch<{ appointment: AppointmentDetail }>(
      `/appointments/${id}/status`,
      { status }
    );
    return res.data.appointment;
  },
};

export const queueApi = {
  getPublicStatus: async (
    businessId: string,
    signal?: AbortSignal
  ): Promise<PublicQueueStatus> => {
    const res = await api.get<PublicQueueStatus>(`/queue/${businessId}/status`, { signal });
    return res.data;
  },
  getMyActive: async (
    signal?: AbortSignal
  ): Promise<CustomerQueuePosition & { businessId: string; businessName: string }> => {
    const res = await api.get<CustomerQueuePosition & { businessId: string; businessName: string }>(
      '/queue/me',
      { signal }
    );
    return res.data;
  },
  getPosition: async (
    businessId: string,
    signal?: AbortSignal
  ): Promise<CustomerQueuePosition> => {
    const res = await api.get<CustomerQueuePosition>(`/queue/${businessId}/position`, { signal });
    return res.data;
  },
  join: async (businessId: string): Promise<JoinQueueResponse> => {
    const res = await api.post<JoinQueueResponse>(`/queue/${businessId}/join`);
    return res.data;
  },
  checkIn: async (businessId: string, appointmentId: string): Promise<JoinQueueResponse> => {
    const res = await api.post<JoinQueueResponse>(`/queue/${businessId}/check-in`, {
      appointment_id: appointmentId,
    });
    return res.data;
  },
  leave: async (businessId: string): Promise<{ success: boolean; message: string }> => {
    const res = await api.post<{ success: boolean; message: string }>(`/queue/${businessId}/leave`);
    return res.data;
  },
  callNext: async (businessId: string): Promise<{ current: OwnerQueueCurrentItem }> => {
    const res = await api.post<{ current: OwnerQueueCurrentItem }>(`/queue/${businessId}/next`);
    return res.data;
  },
  completeCurrent: async (businessId: string): Promise<{ success: boolean; message: string }> => {
    const res = await api.post<{ success: boolean; message: string }>(`/queue/${businessId}/complete`);
    return res.data;
  },
  skipCurrent: async (
    businessId: string,
    requeue = false
  ): Promise<{ success: boolean; requeued: boolean }> => {
    const res = await api.post<{ success: boolean; requeued: boolean }>(
      `/queue/${businessId}/skip`,
      { requeue }
    );
    return res.data;
  },
  addWalkIn: async (businessId: string, name: string): Promise<JoinQueueResponse> => {
    const res = await api.post<JoinQueueResponse>(`/queue/${businessId}/walk-in`, { name });
    return res.data;
  },
  toggleQueueOpen: async (businessId: string, open: boolean): Promise<{ queue_open: boolean }> => {
    const res = await api.patch<{ queue_open: boolean }>(`/queue/${businessId}/open`, { open });
    return res.data;
  },
  getOwnerQueue: async (
    businessId: string,
    signal?: AbortSignal
  ): Promise<OwnerQueueDetails> => {
    const res = await api.get<OwnerQueueDetails>(`/queue/${businessId}`, { signal });
    return res.data;
  },
};

export const analyticsApi = {
  getSummary: async (
    businessId: string,
    params?: { from?: string; to?: string },
    signal?: AbortSignal
  ): Promise<BusinessSummaryAnalytics> => {
    const res = await api.get<BusinessSummaryAnalytics>(
      `/analytics/business/${businessId}/summary`,
      {
        params,
        signal,
      }
    );
    return res.data;
  },
  getToday: async (businessId: string, signal?: AbortSignal): Promise<BusinessTodayAnalytics> => {
    const res = await api.get<BusinessTodayAnalytics>(`/analytics/business/${businessId}/today`, {
      signal,
    });
    return res.data;
  },
  exportCsv: async (
    businessId: string,
    params?: { from?: string; to?: string },
    signal?: AbortSignal
  ): Promise<{ data: Blob; filename: string }> => {
    const res = await api.get(`/analytics/business/${businessId}/export.csv`, {
      params,
      signal,
      responseType: 'blob',
    });

    let filename = `queueless-${businessId}.csv`;
    const disposition = res.headers['content-disposition'];
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    return { data: res.data, filename };
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

export const adminApi = {
  getStats: async (signal?: AbortSignal): Promise<AdminStats> => {
    const res = await api.get<AdminStats>('/admin/stats', { signal });
    return res.data;
  },
  listUsers: async (
    params: {
      role?: string;
      q?: string;
      blocked?: boolean;
      page?: number;
      limit?: number;
    } = {},
    signal?: AbortSignal
  ): Promise<{ data: AdminUserListItem[]; total: number; page: number; limit: number }> => {
    const res = await api.get<{
      data: AdminUserListItem[];
      total: number;
      page: number;
      limit: number;
    }>('/admin/users', { params, signal });
    return res.data;
  },
  blockUser: async (
    userId: string,
    data: { blocked: boolean; reason?: string }
  ): Promise<{ message: string; user: AdminUserListItem }> => {
    const res = await api.patch<{ message: string; user: AdminUserListItem }>(
      `/admin/users/${userId}/block`,
      data
    );
    return res.data;
  },
  listAuditLogs: async (
    params: { page?: number; limit?: number } = {},
    signal?: AbortSignal
  ): Promise<{ data: AdminAuditLogItem[]; total: number; page: number; limit: number }> => {
    const res = await api.get<{
      data: AdminAuditLogItem[];
      total: number;
      page: number;
      limit: number;
    }>('/admin/audit-log', { params, signal });
    return res.data;
  },
  listBusinesses: async (
    params: { status?: string; page?: number; limit?: number } = {},
    signal?: AbortSignal
  ): Promise<PaginatedResult<IBusiness>> => {
    const res = await api.get<PaginatedResult<IBusiness>>('/admin/businesses', { params, signal });
    return res.data;
  },
  updateBusinessStatus: async (
    businessId: string,
    status: 'approved' | 'rejected'
  ): Promise<IBusiness> => {
    const res = await api.patch<{ business: IBusiness }>(
      `/admin/businesses/${businessId}/status`,
      { status }
    );
    return res.data.business;
  },
  getFailedNotifications: async (
    params: { page?: number; limit?: number } = {},
    signal?: AbortSignal
  ): Promise<{ data: AdminFailedNotificationItem[]; total: number; page: number; limit: number }> => {
    const res = await api.get<{
      data: AdminFailedNotificationItem[];
      total: number;
      page: number;
      limit: number;
    }>('/admin/notifications', {
      params: { ...params, status: 'failed' },
      signal,
    });
    return res.data;
  },
};
