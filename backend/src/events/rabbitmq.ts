import {
  RabbitMQClient as BaseRabbitMQClient,
  EXCHANGES,
  QUEUES,
} from '@queueless/messaging';
import { config } from '../config';
import { outboxRepository } from './outbox.repository';

export { EXCHANGES, QUEUES };

export class RabbitMQClient extends BaseRabbitMQClient {
  constructor() {
    super({
      url: config.RABBITMQ_URL,
      outboxRepository,
    });
  }
}

export const rabbitMQClient = new RabbitMQClient();
