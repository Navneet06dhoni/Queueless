export type QueueEntrySource = 'online' | 'appointment' | 'walk_in';
export type QueueEntryStatus = 'waiting' | 'called' | 'completed' | 'skipped' | 'left';

export interface IQueueHistory {
  id: string;
  business_id: string;
  customer_id: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  joined_at: Date;
  called_at: Date | null;
  completed_at: Date | null;
  status: QueueEntryStatus;
  walk_in_name: string | null;
  ticket_number: number;
  source: QueueEntrySource;
  appointment_id: string | null;
  score: number;
  estimated_wait_minutes?: number | null;
}

export interface IQueueEntryRedis {
  id: string;
  businessId: string;
  customerId: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  walkInName?: string | null;
  ticketNumber: number;
  source: QueueEntrySource;
  appointmentId?: string | null;
  joinedAt: string;
  score: number;
}

export interface PublicQueueStatus {
  isOpen: boolean;
  waitingCount: number;
  nowServing: number | null;
  estimatedWaitMinutesForNewJoiner: number;
}

export interface CustomerQueuePosition {
  ticketNumber: number;
  position: number;
  peopleAhead: number;
  estimatedWaitMinutes: number;
  status: QueueEntryStatus;
  businessId?: string;
  businessName?: string;
}

export interface OwnerQueueWaitingItem {
  id: string;
  ticketNumber: number;
  name: string;
  source: QueueEntrySource;
  waitingSince: string;
  score: number;
  customerId: string | null;
}

export interface OwnerQueueCurrentItem {
  id: string;
  ticketNumber: number;
  name: string;
  source: QueueEntrySource;
  calledAt: string;
  customerId: string | null;
}

export interface OwnerQueueDetails {
  current: OwnerQueueCurrentItem | null;
  waiting: OwnerQueueWaitingItem[];
  servedToday: number;
  waitingCount: number;
  skippedToday: number;
}
