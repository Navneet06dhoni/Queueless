# @queueless/messaging
Event bus, RabbitMQ transport, transactional outbox, and idempotent consumer for QueueLess.

## Exported Symbols
EventBus, RabbitMQClient, OutboxRepository, OutboxRelay, OUTBOX_MIGRATION_SQL, EXCHANGES, QUEUES

## Runtime Dependencies
@queueless/contracts, @queueless/common, amqplib, zod

## Example: const bus = new EventBus(); bus.subscribe('booking.confirmed', async (e) => {});