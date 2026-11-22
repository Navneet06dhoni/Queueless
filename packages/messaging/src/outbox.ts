import { DbExecutor, DbQueryable, OutboxRow, OutboxStatus } from './types';

function toQueryFn(executor: DbExecutor): (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> {
  if (typeof executor === 'function') {
    return executor;
  }
  if (executor && typeof (executor as DbQueryable).query === 'function') {
    return (executor as DbQueryable).query.bind(executor);
  }
  throw new Error('Invalid database executor provided');
}

export class OutboxRepository {
  private defaultExecutor?: DbExecutor;

  constructor(defaultExecutor?: DbExecutor) {
    this.defaultExecutor = defaultExecutor;
  }

  public setDefaultExecutor(executor: DbExecutor): void {
    this.defaultExecutor = executor;
  }

  private resolveExecutor(client?: DbExecutor): (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> {
    const exec = client || this.defaultExecutor;
    if (!exec) {
      throw new Error('No database executor configured for OutboxRepository');
    }
    return toQueryFn(exec);
  }

  async createOutboxEvent(
    data: {
      id: string;
      eventType: string;
      payload: any;
      traceContext?: any;
    },
    client?: DbExecutor
  ): Promise<void> {
    const query = this.resolveExecutor(client);
    await query(
      `INSERT INTO outbox_events (id, event_type, payload, trace_context, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (id) DO NOTHING`,
      [
        data.id,
        data.eventType,
        JSON.stringify(data.payload),
        JSON.stringify(data.traceContext || {}),
      ]
    );
  }

  async claimPendingEvents(limit: number = 50, client?: DbExecutor): Promise<OutboxRow[]> {
    const query = this.resolveExecutor(client);
    const res = await query(
      `SELECT id, event_type, payload, trace_context, status, attempts, last_error, created_at, published_at
       FROM outbox_events
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    return res.rows;
  }

  async markPublished(id: string, client?: DbExecutor): Promise<void> {
    const query = this.resolveExecutor(client);
    try {
      await query(
        `UPDATE outbox_events
         SET status = 'published', published_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
    } catch {
      await query(
        `UPDATE outbox_events
         SET status = 'published', published_at = NOW()
         WHERE id = $1`,
        [id]
      );
    }
  }

  async recordFailure(id: string, attempts: number, lastError: string, client?: DbExecutor): Promise<void> {
    const status: OutboxStatus = attempts >= 5 ? 'failed' : 'pending';
    const query = this.resolveExecutor(client);
    await query(
      `UPDATE outbox_events
       SET status = $2, attempts = $3, last_error = $4
       WHERE id = $1`,
      [id, status, attempts, lastError]
    );
  }

  async getOutboxRows(status?: string, limit: number = 20, client?: DbExecutor): Promise<{ count: number; rows: OutboxRow[] }> {
    const query = this.resolveExecutor(client);
    let whereClause = '';
    const params: any[] = [];

    if (status && (status === 'pending' || status === 'failed' || status === 'published')) {
      whereClause = 'WHERE status = $1';
      params.push(status);
    }

    const countRes = await query(
      `SELECT COUNT(*)::text as count FROM outbox_events ${whereClause}`,
      params
    );
    const count = parseInt(countRes.rows[0]?.count || '0', 10);

    const dataParams = [...params, limit];
    const limitIdx = params.length + 1;
    const rowsRes = await query(
      `SELECT id, event_type, payload, trace_context, status, attempts, last_error, created_at, published_at
       FROM outbox_events
       ${whereClause}
       ORDER BY created_at ASC
       LIMIT $${limitIdx}`,
      dataParams
    );

    return {
      count,
      rows: rowsRes.rows,
    };
  }

  async getOldestUnpublishedAgeSeconds(client?: DbExecutor): Promise<number | null> {
    try {
      const query = this.resolveExecutor(client);
      const res = await query(
        `SELECT EXTRACT(EPOCH FROM (NOW() - created_at))::int as oldest_age
         FROM outbox_events
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1`
      );
      if (res.rows.length === 0 || res.rows[0].oldest_age === null) {
        return null;
      }
      return parseInt(res.rows[0].oldest_age, 10);
    } catch {
      return null;
    }
  }

  async isEventProcessed(eventId: string, consumerName: string, client?: DbExecutor): Promise<boolean> {
    const query = this.resolveExecutor(client);
    const res = await query(
      `SELECT 1 as exists FROM processed_events WHERE event_id = $1 AND consumer_name = $2`,
      [eventId, consumerName]
    );
    return res.rows.length > 0;
  }

  async markEventProcessed(eventId: string, consumerName: string, client?: DbExecutor): Promise<void> {
    const query = this.resolveExecutor(client);
    await query(
      `INSERT INTO processed_events (event_id, consumer_name, processed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (event_id, consumer_name) DO NOTHING`,
      [eventId, consumerName]
    );
  }
}
