import pino, { Logger, LoggerOptions } from 'pino';

export const DEFAULT_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'authorization',
  'cookie',
  'password',
  'token',
  'refreshToken',
  'secret',
  'accessToken',
  'body.password',
  'body.token',
  'body.refreshToken',
];

export interface LoggerConfigOptions {
  level?: string;
  isDev?: boolean;
  redactPaths?: string[];
}

export function createLogger(options?: LoggerConfigOptions): Logger {
  const isDev = options?.isDev ?? process.env.NODE_ENV === 'development';
  const level = options?.level || process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

  const pinoOptions: LoggerOptions = {
    level,
    redact: {
      paths: options?.redactPaths || DEFAULT_REDACTION_PATHS,
      censor: '[REDACTED]',
    },
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  };

  return pino(pinoOptions);
}

export const logger = createLogger();
export default logger;
