import {
  EventBus as BaseEventBus,
  EventEnvelope,
  IEventBus,
} from '@queueless/messaging';
import { config } from '../config';
import { outboxRepository } from './outbox.repository';
import { setLocalEmitterCallback, tickOutboxRelay } from './outboxRelay';

export { EventEnvelope, IEventBus };

export class EventBus extends BaseEventBus {
  constructor() {
    super({
      outboxRepository,
      transport: config.EVENT_TRANSPORT as 'inprocess' | 'rabbitmq',
      relayTickFn: tickOutboxRelay,
    });

    setLocalEmitterCallback((name: string, payload: any) => {
      this.emitDirect(name, payload);
    });
  }
}

export const events = new EventBus();
