export type OutboxStatus = 'pending' | 'published' | 'failed';

export interface IOutboxEvent {
  id: string;
  eventType: string;
  payload: any;
  traceContext?: any;
  status?: OutboxStatus;
  attempts?: number;
  lastError?: string | null;
  createdAt?: Date;
  publishedAt?: Date | null;
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

export interface EventEnvelope<T = any> {
  eventId: string;
  type: string;
  occurredAt: string;
  data: T;
  v?: number;
  [key: string]: any;
}

export type QueryFn = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

export interface DbQueryable {
  query: QueryFn;
}

export type DbExecutor = QueryFn | DbQueryable;

export interface IEventBus {
  publish(name: string, payload: any, client?: DbExecutor): Promise<void>;
  subscribe(name: string, handler: (envelope: EventEnvelope) => Promise<void> | void): void;
  unsubscribe(name: string, handler: (...args: any[]) => void): void;
  flush(): Promise<void>;
}
