import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  API_PREFIX: z.string().default('/api'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // PostgreSQL
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgrespassword'),
  DB_NAME: z.string().default('queueless'),
  DB_POOL_MAX: z.coerce.number().default(20),
  DATABASE_URL: z.string().optional(),
  TEST_DATABASE_URL: z.string().default('postgresql://postgres:postgrespassword@localhost:5432/queueless_test'),

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

  // JWT Secrets (Strictly validated)
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters long'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters long'),
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
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables:', parsedEnv.error.format());
  throw new Error('Environment configuration error');
}

export const config = parsedEnv.data;
export default config;
