import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { loadConfig, createSecretValidator } from '@queueless/common';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isInsideDocker = fs.existsSync('/.dockerenv') || process.env.INSIDE_DOCKER === 'true';

if (!isInsideDocker) {
  if (process.env.DB_HOST === 'postgres') process.env.DB_HOST = 'localhost';
  if (process.env.SMTP_HOST === 'mailhog') process.env.SMTP_HOST = 'localhost';
}

const parsedPassFromDb = (process.env.DATABASE_URL?.match(/:([^@:]+)@/) || [])[1] || '';
const notifPass = process.env.NOTIFICATION_DB_PASSWORD || parsedPassFromDb;
const dbHost = isInsideDocker ? (process.env.DB_HOST || 'postgres') : (process.env.DB_HOST === 'postgres' ? 'localhost' : (process.env.DB_HOST || 'localhost'));
const defaultDbUrl = process.env.DATABASE_URL || `postgresql://${process.env.NOTIFICATION_DB_USER || 'notification_user'}:${notifPass}@${dbHost}:${process.env.DB_PORT || 5432}/${process.env.NOTIFICATION_DB_NAME || 'notification_db'}`;
const defaultTestDbUrl = process.env.TEST_DATABASE_URL || `postgresql://${process.env.NOTIFICATION_DB_USER || 'notification_user'}:${notifPass}@${dbHost}:${process.env.DB_PORT || 5432}/notification_test`;
const rabbitHost = isInsideDocker ? 'rabbitmq' : 'localhost';
const defaultRabbitUrl = process.env.RABBITMQ_URL && isInsideDocker ? process.env.RABBITMQ_URL : `amqp://guest:guest@${rabbitHost}:5672`;
const smtpHost = isInsideDocker ? (process.env.SMTP_HOST || 'mailhog') : (process.env.SMTP_HOST === 'mailhog' ? 'localhost' : (process.env.SMTP_HOST || 'localhost'));

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3004),
  INTERNAL_TOKEN: createSecretValidator('INTERNAL_TOKEN'),
  NOTIFICATION_DB_PASSWORD: createSecretValidator('NOTIFICATION_DB_PASSWORD').default(() => notifPass),
  DATABASE_URL: z.string().default(defaultDbUrl),
  TEST_DATABASE_URL: z.string().default(defaultTestDbUrl),
  RABBITMQ_URL: z.string().default(defaultRabbitUrl),
  SMTP_HOST: z.string().optional().default(smtpHost),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('"QueueLess Alerts" <no-reply@queueless.local>'),
  NOTIFICATIONS_ENABLED: z.coerce.boolean().default(true),
  EMAIL_RETRY_DELAYS_MS: z.string().default('1000,4000,16000'),
  QUEUE_NOTIFY_POSITION: z.coerce.number().default(3),
  BUSINESS_TIMEZONE: z.string().default('Asia/Kolkata'),
});

export const config = loadConfig(configSchema);
export default config;
