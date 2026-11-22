import { pool, query, withTransaction } from '../src/db';
import { events } from '../src/events';
import { outboxRepository } from '../src/events/outbox.repository';
import { tickOutboxRelay } from '../src/events/outboxRelay';
import { notificationService } from '../src/modules/notification/notification.service';

describe('Transactional Outbox Pattern & Atomicity', () => {
  beforeAll(() => {
    events.setTransport('inprocess');
  });

  beforeEach(async () => {
    await query(`DELETE FROM notifications`);
    await query(`DELETE FROM outbox_events`);
    await query(`DELETE FROM processed_events`);
  });

  afterAll(async () => {
    await query(`DELETE FROM notifications`);
    await query(`DELETE FROM outbox_events`);
    await query(`DELETE FROM processed_events`);
  });

  test('outbox atomicity: rolled back transaction produces no outbox row and no notification', async () => {
    const receivedEvents: any[] = [];
    const testHandler = (envelope: any) => {
      receivedEvents.push(envelope);
    };
    events.subscribe('test.outbox.rollback', testHandler);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await events.publish(
        'test.outbox.rollback',
        {
          id: '11111111-1111-1111-1111-111111111111',
          message: 'This should be rolled back',
        },
        client
      );

      // Roll back transaction
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Verify outbox table has no row
    const res = await query(`SELECT * FROM outbox_events WHERE event_type = 'test.outbox.rollback'`);
    expect(res.rows).toHaveLength(0);

    // Trigger relay tick
    await tickOutboxRelay();
    await events.flush();

    expect(receivedEvents).toHaveLength(0);
    events.unsubscribe('test.outbox.rollback', testHandler);
  });

  test('outbox atomicity: committed transaction writes pending row, relay publishes and notifies', async () => {
    const receivedEvents: any[] = [];
    const testHandler = (envelope: any) => {
      receivedEvents.push(envelope);
    };
    events.subscribe('test.outbox.commit', testHandler);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await events.publish(
        'test.outbox.commit',
        {
          id: '22222222-2222-2222-2222-222222222222',
          message: 'This should be committed',
        },
        client
      );

      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Verify outbox row exists in 'pending' state
    const pendingRes = await query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM outbox_events WHERE event_type = 'test.outbox.commit'`
    );
    expect(pendingRes.rows).toHaveLength(1);
    expect(pendingRes.rows[0].status).toBe('pending');
    expect(pendingRes.rows[0].attempts).toBe(0);

    // Trigger relay tick to drain outbox
    const relayedCount = await tickOutboxRelay();
    expect(relayedCount).toBeGreaterThanOrEqual(1);
    await events.flush();

    // Verify status updated to 'published'
    const publishedRes = await query<{ status: string; published_at: string | null }>(
      `SELECT status, published_at FROM outbox_events WHERE event_type = 'test.outbox.commit'`
    );
    expect(publishedRes.rows).toHaveLength(1);
    expect(publishedRes.rows[0].status).toBe('published');
    expect(publishedRes.rows[0].published_at).not.toBeNull();

    // Verify subscriber received the event
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].data?.message || receivedEvents[0].message).toBe('This should be committed');

    events.unsubscribe('test.outbox.commit', testHandler);
  });

  test('crash safety: relay mid-batch recovery processes remaining events without duplicates', async () => {
    const handledEventIds: string[] = [];
    const crashHandler = (envelope: any) => {
      handledEventIds.push(envelope.eventId || envelope.id);
    };
    events.subscribe('test.outbox.crash', crashHandler);

    // Insert 5 outbox events
    for (let i = 1; i <= 5; i++) {
      await outboxRepository.createOutboxEvent({
        id: `33333333-3333-3333-3333-33333333330${i}`,
        eventType: 'test.outbox.crash',
        payload: { itemNumber: i },
      });
    }

    // First relay tick processes them
    const count1 = await tickOutboxRelay();
    expect(count1).toBe(5);
    await events.flush();

    expect(handledEventIds).toHaveLength(5);

    // Verify all 5 are marked published
    const rows = await query<{ status: string }>(
      `SELECT status FROM outbox_events WHERE event_type = 'test.outbox.crash'`
    );
    expect(rows.rows.every((r) => r.status === 'published')).toBe(true);

    // Subsequent tick finds 0 pending rows (no double dispatch)
    const count2 = await tickOutboxRelay();
    expect(count2).toBe(0);
    expect(handledEventIds).toHaveLength(5);

    events.unsubscribe('test.outbox.crash', crashHandler);
  });
});
