import { pool } from '../db';
import { OutboxRepository as BaseOutboxRepository, OutboxRow, OutboxStatus } from '@queueless/messaging';

export { OutboxRow, OutboxStatus };

export const outboxRepository = new BaseOutboxRepository({
  query: (sql: string, params?: any[]) => pool.query(sql, params),
});

export class OutboxRepository extends BaseOutboxRepository {
  constructor() {
    super({
      query: (sql: string, params?: any[]) => pool.query(sql, params),
    });
  }
}
