import { EventEmitter } from 'events';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export interface EventEnvelope<T = any> {
  eventId: string;
  type: string;
  occurredAt: string;
  data: T;
  [key: string]: any; // Backwards compatibility for callers accessing properties directly on payload
}

class EventBus {
  private emitter: EventEmitter;
  private inFlightHandlers: Set<Promise<void>> = new Set();

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  /**
   * Publish an event wrapped in an envelope: { eventId, type, occurredAt, data }
   * Preserves backward compatibility for callers accessing fields directly.
   */
  public publish(name: string, payload: any): void {
    const eventId = payload?.eventId || crypto.randomUUID();
    const occurredAt = payload?.occurredAt || new Date().toISOString();

    const data =
      payload && typeof payload === 'object' && 'data' in payload && 'eventId' in payload
        ? payload.data
        : payload;

    const envelope: EventEnvelope = {
      eventId,
      type: name,
      occurredAt,
      data,
    };

    // Attach data properties directly to envelope for backwards compatibility with tests and callers
    if (data && typeof data === 'object') {
      Object.assign(envelope, data);
      envelope.data = data;
      envelope.eventId = eventId;
      envelope.type = name;
      envelope.occurredAt = occurredAt;
    }

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
   * Flush all currently in-flight async event handlers.
   * Useful in tests so assertions can reliably await event completions.
   */
  public async flush(): Promise<void> {
    // Yield to event loop to allow any scheduled setImmediate handlers to start
    await new Promise((resolve) => setImmediate(resolve));

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
export default events;
