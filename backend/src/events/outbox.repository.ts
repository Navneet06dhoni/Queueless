import { PoolClient } from 'pg';
import { pool, query } from '../db';
import { OutboxRow, OutboxStatus } from './outbox.types';

export class OutboxRepository {
  /**
   * Insert event into outbox_events table.
   * If client is provided (transactional), uses that client so the insert participates in the transaction.
   */
  async createOutboxEvent(
    data: {
      id: string;
      eventType: string;
      payload: any;
      traceContext?: any;
    },
    client?: PoolClient
  ): Promise<void> {
    const executor = client || { query: (q: string, p: any[]) => pool.query(q, p) };
    await executor.query(
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

  /**
   * Fetch a batch of pending outbox events using FOR UPDATE SKIP LOCKED
   */
  async claimPendingEvents(limit: number = 50, client?: PoolClient): Promise<OutboxRow[]> {
    const executor = client || { query: (q: string, p: any[]) => pool.query(q, p) };
    const res = await executor.query<OutboxRow>(
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

  async markPublished(id: string, client?: PoolClient): Promise<void> {
    const executor = client || { query: (q: string, p: any[]) => pool.query(q, p) };
    await executor.query(
      `UPDATE outbox_events
       SET status = 'published', published_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      // fallback in case updated_at column isn't there
      [id]
    ).catch(async () => {
      await executor.query(
        `UPDATE outbox_events
         SET status = 'published', published_at = NOW()
         WHERE id = $1`,
        [id]
      );
    });
  }

  async recordFailure(id: string, attempts: number, lastError: string, client?: PoolClient): Promise<void> {
    const status: OutboxStatus = attempts >= 5 ? 'failed' : 'pending';
    const executor = client || { query: (q: string, p: any[]) => pool.query(q, p) };
    await executor.query(
      `UPDATE outbox_events
       SET status = $2, attempts = $3, last_error = $4
       WHERE id = $1`,
      [id, status, attempts, lastError]
    );
  }

  async getOutboxRows(status?: string, limit: number = 20): Promise<{ count: number; rows: OutboxRow[] }> {
    let whereClause = '';
    const params: any[] = [];

    if (status && (status === 'pending' || status === 'failed' || status === 'published')) {
      whereClause = 'WHERE status = $1';
      params.push(status);
    }

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM outbox_events ${whereClause}`,
      params
    );
    const count = parseInt(countRes.rows[0]?.count || '0', 10);

    const dataParams = [...params, limit];
    const limitIdx = params.length + 1;
    const rowsRes = await query<OutboxRow>(
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

  async getOldestUnpublishedAgeSeconds(): Promise<number | null> {
    try {
      const res = await query<{ oldest_age: string | null }>(
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

  async isEventProcessed(eventId: string, consumerName: string): Promise<boolean> {
    const res = await query<{ exists: number }>(
      `SELECT 1 as exists FROM processed_events WHERE event_id = $1 AND consumer_name = $2`,
      [eventId, consumerName]
    );
    return (res.rows.length > 0);
  }

  async markEventProcessed(eventId: string, consumerName: string, client?: PoolClient): Promise<void> {
    const executor = client || { query: (q: string, p: any[]) => pool.query(q, p) };
    await executor.query(
      `INSERT INTO processed_events (event_id, consumer_name, processed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (event_id, consumer_name) DO NOTHING`,
      [eventId, consumerName]
    );
  }
}

export const outboxRepository = new OutboxRepository();
