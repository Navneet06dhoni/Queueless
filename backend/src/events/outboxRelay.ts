import { config } from '../config';
import { outboxRepository } from './outbox.repository';
import { rabbitMQClient } from './rabbitmq';
import { OutboxRelay } from '@queueless/messaging';

let relayTimer: NodeJS.Timeout | null = null;
let isRelaying = false;
let localEmitterCallback: ((name: string, payload: any) => void) | null = null;
let currentTransport: 'inprocess' | 'rabbitmq' = config.EVENT_TRANSPORT as any;

export const setLocalEmitterCallback = (cb: (name: string, payload: any) => void) => {
  localEmitterCallback = cb;
};

export const setRelayTransport = (t: 'inprocess' | 'rabbitmq') => {
  currentTransport = t;
};

const relay = new OutboxRelay({
  outboxRepository,
  isReady: async () => {
    if (currentTransport === 'rabbitmq') {
      const ch = await rabbitMQClient.getChannel();
      return !!ch;
    }
    return true;
  },
  publishEvent: async (eventType: string, payload: any) => {
    if (currentTransport === 'rabbitmq') {
      return await rabbitMQClient.publish(eventType, payload);
    } else {
      if (localEmitterCallback) {
        localEmitterCallback(eventType, payload);
      }
      return true;
    }
  },
});

export const tickOutboxRelay = async (): Promise<number> => {
  return await relay.tick();
};

export const startOutboxRelay = (intervalMs: number = 500): NodeJS.Timeout => {
  return relay.start(intervalMs);
};

export const stopOutboxRelay = (): void => {
  relay.stop();
};
