export type OutboxStatus = 'pending' | 'published' | 'failed';

export interface IOutboxEvent {
  id: string;
  event_type: string;
  payload: any;
  trace_context?: any;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  published_at: Date | null;
}

export interface OutboxRow {
  id: string;
  event_type: string;
  payload: any;
  trace_context: any;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  published_at: string | null;
}
