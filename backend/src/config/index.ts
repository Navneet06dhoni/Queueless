import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { createSecretValidator } from '@queueless/common';

// Load environment variables prioritizing root .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isInsideDocker = fs.existsSync('/.dockerenv') || process.env.INSIDE_DOCKER === 'true';
if (!isInsideDocker) {
  if (process.env.REDIS_HOST === 'redis') process.env.REDIS_HOST = 'localhost';
  if (process.env.DB_HOST === 'postgres') process.env.DB_HOST = 'localhost';
}
const parsedPassFromDb = (process.env.DATABASE_URL?.match(/:([^@:]+)@/) || [])[1] || '';
const pgPass = process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || parsedPassFromDb;
const pgUser = process.env.POSTGRES_USER || process.env.DB_USER || 'postgres';
const pgHost = isInsideDocker ? (process.env.DB_HOST || 'postgres') : (process.env.DB_HOST === 'postgres' ? 'localhost' : (process.env.DB_HOST || 'localhost'));
const pgPort = process.env.DB_PORT || 5432;
const defaultDbUrl = process.env.DATABASE_URL || `postgresql://${pgUser}:${pgPass}@${pgHost}:${pgPort}/${process.env.POSTGRES_DB || process.env.DB_NAME || 'queueless'}`;
const defaultTestDbUrl = process.env.TEST_DATABASE_URL || `postgresql://${pgUser}:${pgPass}@${pgHost}:${pgPort}/queueless_test`;

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  API_PREFIX: z.string().default('/api'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // PostgreSQL & Database Secret Validation (min 32 chars, no CHANGE_ME, no empty)
  POSTGRES_PASSWORD: createSecretValidator('POSTGRES_PASSWORD').default(() => pgPass),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default(pgPass),
  DB_NAME: z.string().default('queueless'),
  DB_POOL_MAX: z.coerce.number().default(20),
  DATABASE_URL: z.string().default(defaultDbUrl),
  TEST_DATABASE_URL: z.string().default(defaultTestDbUrl),

  // Booking & Appointments
  CANCELLATION_CUTOFF_MINUTES: z.coerce.number().default(60),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB_TEST: z.coerce.number().default(1),

  // Live Queue & Hybrid System
  QUEUE_NOTIFY_POSITION: z.coerce.number().default(3),
  DEFAULT_SERVICE_MINUTES: z.coerce.number().default(10),
  CHECKIN_EARLY_MINUTES: z.coerce.number().default(15),
  CHECKIN_GRACE_MINUTES: z.coerce.number().default(15),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),

  // JWT Secrets (Strictly validated: min 32 chars, no CHANGE_ME, no empty)
  JWT_ACCESS_SECRET: createSecretValidator('JWT_ACCESS_SECRET'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: createSecretValidator('JWT_REFRESH_SECRET'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Docs & Observability
  ENABLE_DOCS: z.coerce.boolean().default(false),
  TRUST_PROXY: z.string().default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ADMIN_EMAIL: z.string().email().default('admin@queueless.local'),
  ADMIN_PASSWORD: z.string().min(8).default('Admin@QueueLess123'),

  // Business Timezone
  BUSINESS_TIMEZONE: z.string().default('Asia/Kolkata'),

  // SMTP & Notifications
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional().default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('"QueueLess Alerts" <no-reply@queueless.local>'),
  NOTIFICATIONS_ENABLED: z.coerce.boolean().default(true),
  REMINDER_MINUTES_BEFORE: z.coerce.number().default(60),
  EMAIL_RETRY_DELAYS_MS: z.string().default('1000,4000,16000'),

  // Event Bus & Transport
  EVENT_TRANSPORT: z.enum(['inprocess', 'rabbitmq']).default('inprocess'),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),

  // Notification Architecture Mode & Internal Token (min 32 chars, no CHANGE_ME, no empty)
  NOTIFICATIONS_MODE: z.enum(['embedded', 'service']).default('service'),
  INTERNAL_TOKEN: createSecretValidator('INTERNAL_TOKEN'),

  // Queue Architecture Mode & Service URL
  QUEUE_MODE: z.enum(['embedded', 'service']).default('service'),
  SOCKET_MODE: z.enum(['embedded', 'remote']).default('remote'),
  QUEUE_SERVICE_URL: z.string().default('http://localhost:3003'),
  DEBUG_ENDPOINTS: z.string().default('false'),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().default(1000),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables:', parsedEnv.error.format());
  throw new Error('Environment configuration error');
}

export const config = parsedEnv.data;
export default config;
