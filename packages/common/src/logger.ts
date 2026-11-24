import pino, { Logger, LoggerOptions } from 'pino';

export const DEFAULT_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-user-email"]',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'headers["x-user-email"]',
  'authorization',
  'cookie',
  'password',
  'token',
  'refreshToken',
  'secret',
  'accessToken',
  'email',
  'body.password',
  'body.token',
  'body.refreshToken',
  'body.email',
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
