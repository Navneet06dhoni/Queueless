import { logger } from '@queueless/common';
import { OutboxRepository } from './outbox';

export interface OutboxRelayConfig {
  outboxRepository: OutboxRepository;
  publishEvent: (eventType: string, payload: any) => Promise<boolean>;
  isReady?: () => Promise<boolean> | boolean;
  batchSize?: number;
  intervalMs?: number;
}

export class OutboxRelay {
  private config: OutboxRelayConfig;
  private timer: NodeJS.Timeout | null = null;
  private isRelaying: boolean = false;

  constructor(config: OutboxRelayConfig) {
    this.config = config;
  }

  public async tick(): Promise<number> {
    if (this.isRelaying) return 0;
    this.isRelaying = true;

    try {
      if (this.config.isReady) {
        const ready = await this.config.isReady();
        if (!ready) return 0;
      }

      const rows = await this.config.outboxRepository.claimPendingEvents(this.config.batchSize || 50);
      if (rows.length === 0) return 0;

      for (const row of rows) {
        try {
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          const published = await this.config.publishEvent(row.event_type, payload);
          if (!published) {
            throw new Error('Publish returned false');
          }
          await this.config.outboxRepository.markPublished(row.id);
        } catch (err: any) {
          const attempts = (row.attempts || 0) + 1;
          const errMsg = err?.message || 'Outbox dispatch failed';
          logger.warn(
            { err: errMsg, eventId: row.id, eventType: row.event_type, attempts },
            '[OutboxRelay] Failed to publish event'
          );
          await this.config.outboxRepository.recordFailure(row.id, attempts, errMsg);
        }
      }

      return rows.length;
    } catch (err: any) {
      logger.error({ err: err?.message || err }, '[OutboxRelay] Error in relay pass');
      return 0;
    } finally {
      this.isRelaying = false;
    }
  }

  public start(intervalMs?: number): NodeJS.Timeout {
    if (this.timer) {
      clearInterval(this.timer);
    }
    const interval = intervalMs || this.config.intervalMs || 500;
    this.timer = setInterval(() => this.tick(), interval);
    return this.timer;
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
