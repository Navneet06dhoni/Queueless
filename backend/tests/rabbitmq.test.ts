import amqp, { Channel, ChannelModel } from 'amqplib';
import crypto from 'crypto';
import { config } from '../src/config';
import { rabbitMQClient, EXCHANGES, QUEUES } from '../src/events/rabbitmq';
import { outboxRepository } from '../src/events/outbox.repository';
import { tickOutboxRelay } from '../src/events/outboxRelay';
import { query } from '../src/db';
import { setupTestDb, TestDbInstance } from './setupTestDb';

describe('RabbitMQ Transport Integration Tests', () => {
  let testDb: TestDbInstance;
  let connection: ChannelModel;
  let channel: Channel;

  beforeAll(async () => {
    testDb = await setupTestDb();
    connection = await amqp.connect(config.RABBITMQ_URL);
    channel = await connection.createChannel();
    await rabbitMQClient.connect();
  });

  afterAll(async () => {
    try {
      if (channel) await channel.close();
      if (connection) await connection.close();
      await rabbitMQClient.close();
      await testDb.cleanup();
    } catch {
      // Ignore cleanup error
    }
  });

  beforeEach(async () => {
    if (!channel || (channel as any).closed) {
      channel = await connection.createChannel();
    }
    await testDb.resetData();
  });

  test('publish and consume: message published to queueless.events exchange is delivered to matching queue', async () => {
    const testQueue = `test.booking.q.${Date.now()}`;
    await channel.assertQueue(testQueue, { durable: true });
    await channel.bindQueue(testQueue, EXCHANGES.EVENTS, 'booking.created');

    const testEvent = {
      v: 1,
      eventId: crypto.randomUUID(),
      type: 'booking.created',
      data: { appointmentId: crypto.randomUUID(), message: 'Hello RabbitMQ' },
    };

    const published = await rabbitMQClient.publish('booking.created', testEvent);
    expect(published).toBe(true);

    const received = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for message')), 5000);
      channel.consume(testQueue, (msg) => {
        if (msg) {
          clearTimeout(timeout);
          const payload = JSON.parse(msg.content.toString());
          channel.ack(msg);
          resolve(payload);
        }
      });
    });

    expect(received.eventId).toBe(testEvent.eventId);
    expect(received.data.message).toBe('Hello RabbitMQ');
    await channel.deleteQueue(testQueue);
  });

  test('(a) stop consumer, publish 20 events, restart consumer -> all 20 are processed exactly once', async () => {
    const queueName = `test.twenty.q.${Date.now()}`;
    // Durable queue without autoDelete so it persists when consumer stops
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, EXCHANGES.EVENTS, 'test.twenty.*');

    const processedIds: string[] = [];
    const consumerName = `twenty_consumer_${Date.now()}`;

    // 1. Start consumer then stop it immediately
    await rabbitMQClient.startConsumer(queueName, consumerName, async (data) => {
      processedIds.push(data.eventId);
    });
    await rabbitMQClient.stopConsumer(queueName);

    // 2. Publish 20 events while consumer is stopped
    const eventIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const eventId = crypto.randomUUID();
      eventIds.push(eventId);
      await rabbitMQClient.publish('test.twenty.item', {
        v: 1,
        eventId,
        type: 'test.twenty.item',
        index: i,
      });
    }

    // Verify messages are waiting in queue
    let messageCount = 0;
    for (let i = 0; i < 20; i++) {
      const qState = await channel.checkQueue(queueName);
      messageCount = qState.messageCount;
      if (messageCount === 20) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(messageCount).toBe(20);

    // 3. Restart consumer and verify all 20 are processed exactly once
    const completionPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timed out waiting for 20 messages, got ${processedIds.length}`)),
        10000
      );
      rabbitMQClient.startConsumer(queueName, consumerName, async (data) => {
        processedIds.push(data.eventId);
        if (processedIds.length === 20) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await completionPromise;
    expect(processedIds).toHaveLength(20);
    expect(new Set(processedIds).size).toBe(20);
    expect([...processedIds].sort()).toEqual([...eventIds].sort());

    await rabbitMQClient.stopConsumer(queueName);
    await channel.deleteQueue(queueName);
  });

  test('(b) invalid payload ends in DLQ after retries', async () => {
    const queueName = `test.invalid_dlq.q.${Date.now()}`;
    await channel.assertQueue(queueName, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': EXCHANGES.DLX },
    });
    await channel.bindQueue(queueName, EXCHANGES.EVENTS, 'booking.confirmed');

    // Purge DLQ first
    await channel.purgeQueue(QUEUES.DLQ);

    const consumerName = `invalid_payload_consumer_${Date.now()}`;
    let handlerCalled = false;

    await rabbitMQClient.startConsumer(queueName, consumerName, async (_data) => {
      handlerCalled = true;
    });

    // An invalid payload missing required fields for booking.confirmed
    const invalidEvent = {
      v: 1,
      eventId: crypto.randomUUID(),
      type: 'booking.confirmed',
      data: {
        badField: 'missing required fields',
      },
    };

    // Publish with x-attempts = 2 so the consumer's validation failure triggers the 3rd attempt and sends to DLQ
    const ch = await rabbitMQClient.getChannel();
    expect(ch).not.toBeNull();
    ch!.publish(
      EXCHANGES.EVENTS,
      'booking.confirmed',
      Buffer.from(JSON.stringify(invalidEvent)),
      {
        headers: { 'x-attempts': 2 },
        persistent: true,
      }
    );

    // Wait for message to arrive in DLQ
    let dlqMsg: any = null;
    for (let i = 0; i < 30; i++) {
      const check = await channel.get(QUEUES.DLQ, { noAck: false });
      if (check) {
        dlqMsg = check;
        channel.ack(check);
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(dlqMsg).not.toBeNull();
    const dlqPayload = JSON.parse(dlqMsg.content.toString());
    expect(dlqPayload.eventId).toBe(invalidEvent.eventId);
    expect(handlerCalled).toBe(false); // Handler was not called because schema validation rejected it
    expect(dlqMsg.properties.headers['x-attempts']).toBe(3);

    await rabbitMQClient.stopConsumer(queueName);
    await channel.deleteQueue(queueName);
  });

  test('(c) delivering the same eventId twice has the effect once (processed_events)', async () => {
    const queueName = `test.idempotent.q.${Date.now()}`;
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, EXCHANGES.EVENTS, 'test.idempotent');

    let effectCount = 0;
    const consumerName = `idempotent_consumer_${Date.now()}`;
    const eventId = crypto.randomUUID();

    await rabbitMQClient.startConsumer(queueName, consumerName, async (_data) => {
      effectCount++;
    });

    const testEvent = {
      v: 1,
      eventId,
      type: 'test.idempotent',
      data: { action: 'increment' },
    };

    // 1. Deliver event first time
    await rabbitMQClient.publish('test.idempotent', testEvent);

    for (let i = 0; i < 20; i++) {
      if (effectCount === 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(effectCount).toBe(1);

    // Confirm it is marked in processed_events
    const isProcessed = await outboxRepository.isEventProcessed(eventId, consumerName);
    expect(isProcessed).toBe(true);

    // 2. Deliver identical event with same eventId a second time
    await rabbitMQClient.publish('test.idempotent', testEvent);

    // Wait to allow consumer to receive and inspect the message
    await new Promise((r) => setTimeout(r, 500));

    // Effect should STILL be 1 because processed_events suppressed duplicate execution
    expect(effectCount).toBe(1);

    await rabbitMQClient.stopConsumer(queueName);
    await channel.deleteQueue(queueName);
  });

  test('(d) the relay is killed after committing but before publishing, then restarted, and the consumer gets the event exactly once', async () => {
    const queueName = `test.relay_kill.q.${Date.now()}`;
    await channel.assertQueue(queueName, { durable: true });
    await channel.bindQueue(queueName, EXCHANGES.EVENTS, 'test.relay_kill');

    let consumerExecutions = 0;
    const consumerName = `relay_kill_consumer_${Date.now()}`;
    const eventId = crypto.randomUUID();

    await rabbitMQClient.startConsumer(queueName, consumerName, async (_data) => {
      consumerExecutions++;
    });

    const eventPayload = {
      v: 1,
      eventId,
      type: 'test.relay_kill',
      data: { message: 'resilient event' },
    };

    // 1. Commit outbox row in PostgreSQL (status: 'pending')
    await outboxRepository.createOutboxEvent({
      id: eventId,
      eventType: 'test.relay_kill',
      payload: eventPayload,
    });

    // 2. Simulate failure scenario: relay published to broker, but was killed before committing 'published' status to DB
    await rabbitMQClient.publish('test.relay_kill', eventPayload);

    // Wait for consumer to process first delivery
    for (let i = 0; i < 20; i++) {
      if (consumerExecutions === 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(consumerExecutions).toBe(1);

    // The outbox row in DB is still 'pending' because the previous relay run was killed before updating DB
    const pendingCheck = await query<{ status: string }>(
      `SELECT status FROM outbox_events WHERE id = $1`,
      [eventId]
    );
    expect(pendingCheck.rows[0].status).toBe('pending');

    // 3. Relay is restarted and runs its next pass
    const processedRelayCount = await tickOutboxRelay();
    expect(processedRelayCount).toBeGreaterThanOrEqual(1);

    // Outbox row is now updated to 'published'
    const publishedCheck = await query<{ status: string; published_at: Date }>(
      `SELECT status, published_at FROM outbox_events WHERE id = $1`,
      [eventId]
    );
    expect(publishedCheck.rows[0].status).toBe('published');
    expect(publishedCheck.rows[0].published_at).not.toBeNull();

    // 4. Wait for consumer to receive second delivery from the restarted relay
    await new Promise((r) => setTimeout(r, 500));

    // Consumer got the event exactly once due to processed_events idempotency
    expect(consumerExecutions).toBe(1);

    await rabbitMQClient.stopConsumer(queueName);
    await channel.deleteQueue(queueName);
  });
});
