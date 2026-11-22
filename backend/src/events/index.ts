import { EventEmitter } from 'events';
import crypto from 'crypto';
import { PoolClient } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';
import { outboxRepository } from './outbox.repository';
import { setLocalEmitterCallback, tickOutboxRelay } from './outboxRelay';
import { validateEventPublish, validateEventConsume } from '../contracts/events';

export interface EventEnvelope<T = any> {
  eventId: string;
  type: string;
  occurredAt: string;
  data: T;
  v?: number;
  [key: string]: any; // Backwards compatibility for callers accessing properties directly on payload
}

class EventBus {
  private emitter: EventEmitter;
  private inFlightHandlers: Set<Promise<void>> = new Set();

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);

    // Wire up outbox relay callback to emit events locally
    setLocalEmitterCallback((name: string, payload: any) => {
      this.emitDirect(name, payload);
    });
  }

  /**
   * Publish an event.
   * If client is provided (transactional), writes to outbox_events within that transaction.
   * If client is omitted and transport is rabbitmq, writes to outbox_events to be relayed.
   * If client is omitted and transport is inprocess, emits directly to in-process subscribers.
   */
  public async publish(name: string, payload: any, client?: PoolClient): Promise<void> {
    const eventId = payload?.eventId || crypto.randomUUID();
    const occurredAt = payload?.occurredAt || new Date().toISOString();
    const v = payload?.v ?? 1;

    const data =
      payload && typeof payload === 'object' && 'data' in payload && 'eventId' in payload
        ? payload.data
        : payload;

    // Validate payload against versioned event contract on publish
    const validatedData = validateEventPublish(name, data);

    const envelope: EventEnvelope = {
      eventId,
      type: name,
      occurredAt,
      v,
      data: validatedData,
    };

    if (validatedData && typeof validatedData === 'object') {
      Object.assign(envelope, validatedData);
      envelope.data = validatedData;
      envelope.eventId = eventId;
      envelope.type = name;
      envelope.occurredAt = occurredAt;
      envelope.v = v;
    }

    if (client || config.EVENT_TRANSPORT === 'rabbitmq') {
      // Write to transactional outbox
      await outboxRepository.createOutboxEvent(
        {
          id: eventId,
          eventType: name,
          payload: envelope,
        },
        client
      );
      return;
    }

    // Direct in-process emission
    this.emitDirect(name, envelope);
  }

  /**
   * Emits an event to registered local subscribers and tracks in-flight promises.
   */
  public emitDirect(name: string, envelope: EventEnvelope): void {
    setImmediate(() => {
      this.emitter.emit(name, envelope);
    });
  }

  /**
   * Subscribe to an event.
   * Handlers run asynchronously AFTER publish returns; any error is caught and logged.
   */
  public subscribe(name: string, handler: (envelope: EventEnvelope) => Promise<void> | void): void {
    const wrappedHandler = (envelope: EventEnvelope) => {
      const promise = (async () => {
        try {
          // Validate payload against versioned event contract on consume
          if (envelope.data) {
            validateEventConsume(name, envelope.data);
          }
          await handler(envelope);
        } catch (err: any) {
          logger.error({ err: err?.message || err, eventName: name }, `[EventBus] Error handling event "${name}"`);
        }
      })();

      this.inFlightHandlers.add(promise);
      promise.finally(() => {
        this.inFlightHandlers.delete(promise);
      });
    };

    this.emitter.on(name, wrappedHandler);
  }

  /**
   * Flush all currently in-flight async event handlers and pending outbox events.
   * Useful in tests so assertions can reliably await event completions.
   */
  public async flush(): Promise<void> {
    // 1. Run outbox relay tick to dispatch any pending transactional outbox events
    try {
      await tickOutboxRelay();
    } catch {
      // Ignore if outbox tables not present or error
    }

    // 2. Yield to event loop to allow any scheduled setImmediate handlers to start
    await new Promise((resolve) => setImmediate(resolve));

    // 3. Await all in-flight handlers
    while (this.inFlightHandlers.size > 0) {
      await Promise.all(Array.from(this.inFlightHandlers));
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /**
   * Unsubscribe from an event
   */
  public unsubscribe(name: string, handler: (...args: any[]) => void): void {
    this.emitter.off(name, handler);
  }
}

export const events = new EventBus();
