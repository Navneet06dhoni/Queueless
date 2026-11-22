import { EventEmitter } from 'events';
import crypto from 'crypto';
import { logger } from '@queueless/common';
import { validateEventPublish, validateEventConsume } from '@queueless/contracts';
import { DbExecutor, EventEnvelope, IEventBus } from './types';
import { OutboxRepository } from './outbox';

export interface EventBusConfig {
  outboxRepository?: OutboxRepository;
  transport?: 'inprocess' | 'rabbitmq';
  relayTickFn?: () => Promise<number | void>;
}

export class EventBus implements IEventBus {
  private emitter: EventEmitter;
  private inFlightHandlers: Set<Promise<void>> = new Set();
  private outboxRepository?: OutboxRepository;
  private transport: 'inprocess' | 'rabbitmq';
  private relayTickFn?: () => Promise<number | void>;

  constructor(config?: EventBusConfig) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.outboxRepository = config?.outboxRepository;
    this.transport = config?.transport || 'inprocess';
    this.relayTickFn = config?.relayTickFn;
  }

  public setOutboxRepository(repo: OutboxRepository): void {
    this.outboxRepository = repo;
  }

  public setTransport(transport: 'inprocess' | 'rabbitmq'): void {
    this.transport = transport;
  }

  public setRelayTickFn(fn: () => Promise<number | void>): void {
    this.relayTickFn = fn;
  }

  public async publish(name: string, payload: any, client?: DbExecutor): Promise<void> {
    const eventId = payload?.eventId || crypto.randomUUID();
    const occurredAt = payload?.occurredAt || new Date().toISOString();
    const v = payload?.v ?? 1;

    const data =
      payload && typeof payload === 'object' && 'data' in payload && 'eventId' in payload
        ? payload.data
        : payload;

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

    if ((client || this.transport === 'rabbitmq') && this.outboxRepository) {
      await this.outboxRepository.createOutboxEvent(
        {
          id: eventId,
          eventType: name,
          payload: envelope,
        },
        client
      );
      return;
    }

    this.emitDirect(name, envelope);
  }

  public emitDirect(name: string, envelope: EventEnvelope): void {
    setImmediate(() => {
      this.emitter.emit(name, envelope);
    });
  }

  public subscribe(name: string, handler: (envelope: EventEnvelope) => Promise<void> | void): void {
    const wrappedHandler = (envelope: EventEnvelope) => {
      const promise = (async () => {
        try {
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

  public async flush(): Promise<void> {
    if (this.relayTickFn) {
      try {
        await this.relayTickFn();
      } catch {
        // Ignore relay error during flush
      }
    }

    await new Promise((resolve) => setImmediate(resolve));

    while (this.inFlightHandlers.size > 0) {
      await Promise.all(Array.from(this.inFlightHandlers));
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  public unsubscribe(name: string, handler: (...args: any[]) => void): void {
    this.emitter.off(name, handler);
  }
}
