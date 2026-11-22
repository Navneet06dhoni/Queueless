import http from 'http';
import { logger } from './logger';

export interface GracefulShutdownConfig {
  server?: http.Server;
  onShutdown?: () => Promise<void> | void;
  timeoutMs?: number;
  log?: typeof logger;
}

export function createGracefulShutdown(config: GracefulShutdownConfig) {
  const log = config.log || logger;
  const timeoutMs = config.timeoutMs ?? 10000;

  return async function performGracefulShutdown(signal: string): Promise<void> {
    log.info(`🛑 Received ${signal}. Gracefully shutting down...`);

    if (config.server) {
      await new Promise<void>((resolve) => {
        config.server!.close((err) => {
          if (err) log.warn({ err: err.message }, 'Server close notice');
          resolve();
        });
      });
    }

    if (config.onShutdown) {
      let timer: NodeJS.Timeout;
      const timeoutPromise = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([
        Promise.resolve(config.onShutdown()),
        timeoutPromise,
      ]);
      clearTimeout(timer!);
    }

    log.info('✅ Clean shutdown completed');
  };
}
