import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import { loadConfig } from '@queueless/common';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3004),
  INTERNAL_TOKEN: z.string().min(16).default('queueless-internal-gateway-secret-key-32ch'),
  DATABASE_URL: z.string().default('postgresql://notification_user:notification_password@localhost:5432/notification_db'),
  TEST_DATABASE_URL: z.string().default('postgresql://notification_user:notification_password@localhost:5432/notification_test'),
  RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),
  SMTP_HOST: z.string().optional().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('"QueueLess Alerts" <no-reply@queueless.local>'),
  NOTIFICATIONS_ENABLED: z.coerce.boolean().default(true),
  EMAIL_RETRY_DELAYS_MS: z.string().default('1000,4000,16000'),
  BUSINESS_TIMEZONE: z.string().default('Asia/Kolkata'),
});

export const config = loadConfig(configSchema);
export default config;
