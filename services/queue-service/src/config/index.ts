import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import { loadConfig } from '@queueless/common';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3003),
  INTERNAL_TOKEN: z.string().min(16).default('queueless-internal-gateway-secret-key-32ch'),
  CORE_SERVICE_URL: z.string().default('http://localhost:5000'),
  DATABASE_URL: z.string().default('postgresql://queue_user:queue_password@localhost:5432/queue_db'),
  TEST_DATABASE_URL: z.string().default('postgresql://queue_user:queue_password@localhost:5432/queue_test'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.coerce.number().default(2),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),
  EVENT_TRANSPORT: z.enum(['in-memory', 'rabbitmq']).default('rabbitmq'),
  DEFAULT_SERVICE_MINUTES: z.coerce.number().default(10),
  QUEUE_NOTIFY_POSITION: z.coerce.number().default(3),
  CHECKIN_EARLY_MINUTES: z.coerce.number().default(30),
  CHECKIN_GRACE_MINUTES: z.coerce.number().default(15),
  BUSINESS_TIMEZONE: z.string().default('Asia/Kolkata'),
  FRONTEND_ORIGIN: z.string().optional().default('*'),
});

export const config = loadConfig(configSchema);
export default config;
