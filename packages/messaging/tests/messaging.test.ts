import {
  EventBus,
  OutboxRepository,
  OutboxRelay,
  OUTBOX_MIGRATION_SQL,
  RabbitMQClient,
  EXCHANGES,
  QUEUES,
} from '../src';

describe('@queueless/messaging unit tests', () => {
  describe('OUTBOX_MIGRATION_SQL', () => {
    it('exports SQL statements creating outbox_events and processed_events', () => {
      expect(OUTBOX_MIGRATION_SQL).toContain('CREATE TABLE IF NOT EXISTS outbox_events');
      expect(OUTBOX_MIGRATION_SQL).toContain('CREATE TABLE IF NOT EXISTS processed_events');
    });
  });

  describe('EventBus in-process', () => {
    it('publishes and receives in-process events', async () => {
      const bus = new EventBus();
      const received: any[] = [];

      bus.subscribe('business.status_changed', (env) => {
        received.push(env);
      });

      await bus.publish('business.status_changed', {
        businessId: '11111111-1111-1111-1111-111111111111',
        ownerId: '22222222-2222-2222-2222-222222222222',
        status: 'approved',
      });

      await bus.flush();

      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('business.status_changed');
      expect(received[0].data.businessId).toBe('11111111-1111-1111-1111-111111111111');
      expect(received[0].data.status).toBe('approved');
    });
  });

  describe('OutboxRepository (generic with mock DbExecutor)', () => {
    it('creates and claims outbox events via mock executor', async () => {
      const mockRows: any[] = [];
      const mockExecutor = jest.fn(async (sql: string, params?: any[]) => {
        if (sql.includes('INSERT INTO outbox_events')) {
          mockRows.push({
            id: params?.[0],
            event_type: params?.[1],
            payload: params?.[2],
            trace_context: params?.[3],
            status: 'pending',
            attempts: 0,
            last_error: null,
            created_at: new Date().toISOString(),
            published_at: null,
          });
          return { rows: [] };
        }
        if (sql.includes('SELECT') && sql.includes('FROM outbox_events')) {
          return { rows: mockRows.filter((r) => r.status === 'pending') };
        }
        if (sql.includes('UPDATE outbox_events') && sql.includes('published')) {
          const row = mockRows.find((r) => r.id === params?.[0]);
          if (row) row.status = 'published';
          return { rows: [] };
        }
        return { rows: [] };
      });

      const repo = new OutboxRepository(mockExecutor);
      await repo.createOutboxEvent({
        id: '22222222-2222-2222-2222-222222222222',
        eventType: 'booking.confirmed',
        payload: { appointmentId: 'abc' },
      });

      expect(mockExecutor).toHaveBeenCalledTimes(1);

      const claimed = await repo.claimPendingEvents(10);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].id).toBe('22222222-2222-2222-2222-222222222222');

      await repo.markPublished(claimed[0].id);
      expect(mockRows[0].status).toBe('published');
    });
  });

  describe('OutboxRelay', () => {
    it('drains pending rows and invokes publishEvent', async () => {
      const mockRows = [
        {
          id: 'evt-1',
          event_type: 'queue.joined',
          payload: { ticketNumber: 101 },
          trace_context: {},
          status: 'pending',
          attempts: 0,
          last_error: null,
          created_at: new Date().toISOString(),
          published_at: null,
        },
      ];

      const repo = new OutboxRepository(async (sql: string, params?: any[]) => {
        if (sql.includes('SELECT') && sql.includes('outbox_events')) {
          return { rows: mockRows.filter((r) => r.status === 'pending') };
        }
        if (sql.includes('UPDATE outbox_events') && sql.includes('published')) {
          const row = mockRows.find((r) => r.id === params?.[0]);
          if (row) row.status = 'published';
          return { rows: [] };
        }
        return { rows: [] };
      });

      const publishedList: any[] = [];
      const relay = new OutboxRelay({
        outboxRepository: repo,
        publishEvent: async (eventType, payload) => {
          publishedList.push({ eventType, payload });
          return true;
        },
      });

      const count = await relay.tick();
      expect(count).toBe(1);
      expect(publishedList).toHaveLength(1);
      expect(publishedList[0].eventType).toBe('queue.joined');
      expect(mockRows[0].status).toBe('published');
    });
  });

  describe('RabbitMQClient constants', () => {
    it('exports topology constants and client constructor', () => {
      expect(EXCHANGES.EVENTS).toBe('queueless.events');
      expect(QUEUES.DLQ).toBe('queueless.dlq');
      const client = new RabbitMQClient();
      expect(client).toBeDefined();
      expect(typeof client.publish).toBe('function');
      expect(typeof client.startConsumer).toBe('function');
    });
  });
});
