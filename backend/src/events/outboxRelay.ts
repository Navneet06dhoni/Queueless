import { config } from '../config';
import { logger } from '../utils/logger';
import { outboxRepository } from './outbox.repository';
import { rabbitMQClient } from './rabbitmq';

let relayTimer: NodeJS.Timeout | null = null;
let isRelaying = false;
let localEmitterCallback: ((name: string, payload: any) => void) | null = null;

export const setLocalEmitterCallback = (cb: (name: string, payload: any) => void) => {
  localEmitterCallback = cb;
};

/**
 * Execute a single outbox relay pass.
 * Claims pending rows using FOR UPDATE SKIP LOCKED in batches of 50.
 * Dispatches to RabbitMQ or in-process handlers and marks rows published.
 */
export const tickOutboxRelay = async (): Promise<number> => {
  if (isRelaying) return 0;
  isRelaying = true;

  try {
    const transport = config.EVENT_TRANSPORT;

    // If using RabbitMQ transport, ensure broker is reachable before claiming rows
    if (transport === 'rabbitmq') {
      const ch = await rabbitMQClient.getChannel();
      if (!ch) {
        return 0;
      }
    }

    const rows = await outboxRepository.claimPendingEvents(50);
    if (rows.length === 0) {
      return 0;
    }

    for (const row of rows) {
      try {
        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

        if (transport === 'rabbitmq') {
          const published = await rabbitMQClient.publish(row.event_type, payload);
          if (!published) {
            throw new Error('RabbitMQ publish returned false');
          }
        } else {
          // inprocess transport: invoke local event bus
          if (localEmitterCallback) {
            localEmitterCallback(row.event_type, payload);
          }
        }

        await outboxRepository.markPublished(row.id);
      } catch (err: any) {
        const attempts = (row.attempts || 0) + 1;
        const errMsg = err?.message || 'Outbox dispatch failed';
        logger.warn(
          { err: errMsg, eventId: row.id, eventType: row.event_type, attempts },
          '[OutboxRelay] Failed to publish event'
        );
        await outboxRepository.recordFailure(row.id, attempts, errMsg);
      }
    }

    return rows.length;
  } catch (err: any) {
    logger.error({ err: err?.message || err }, '[OutboxRelay] Error in relay pass');
    return 0;
  } finally {
    isRelaying = false;
  }
};

export const startOutboxRelay = (intervalMs: number = 500): NodeJS.Timeout => {
  if (relayTimer) {
    clearInterval(relayTimer);
  }
  relayTimer = setInterval(tickOutboxRelay, intervalMs);
  return relayTimer;
};

export const stopOutboxRelay = (): void => {
  if (relayTimer) {
    clearInterval(relayTimer);
    relayTimer = null;
  }
};
