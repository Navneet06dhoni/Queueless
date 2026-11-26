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
  if (process.env.REDIS_HOST === 'redis') process.env.REDIS_HOST = 'localhost';
  if (process.env.DB_HOST === 'postgres') process.env.DB_HOST = 'localhost';
}

const parsedPassFromDb = (process.env.DATABASE_URL?.match(/:([^@:]+)@/) || [])[1] || '';
const queuePass = process.env.QUEUE_DB_PASSWORD || parsedPassFromDb;
const dbHost = isInsideDocker ? (process.env.DB_HOST || 'postgres') : (process.env.DB_HOST === 'postgres' ? 'localhost' : (process.env.DB_HOST || 'localhost'));
const defaultDbUrl = process.env.DATABASE_URL || `postgresql://${process.env.QUEUE_DB_USER || 'queue_user'}:${queuePass}@${dbHost}:${process.env.DB_PORT || 5432}/${process.env.QUEUE_DB_NAME || 'queue_db'}`;
const defaultTestDbUrl = process.env.TEST_DATABASE_URL || `postgresql://${process.env.QUEUE_DB_USER || 'queue_user'}:${queuePass}@${dbHost}:${process.env.DB_PORT || 5432}/queue_test`;
const redisHost = isInsideDocker ? (process.env.REDIS_HOST || 'redis') : (process.env.REDIS_HOST === 'redis' ? 'localhost' : (process.env.REDIS_HOST || 'localhost'));
const rabbitHost = isInsideDocker ? 'rabbitmq' : 'localhost';
const defaultRabbitUrl = process.env.RABBITMQ_URL && isInsideDocker ? process.env.RABBITMQ_URL : `amqp://guest:guest@${rabbitHost}:5672`;

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3003),
  INTERNAL_TOKEN: createSecretValidator('INTERNAL_TOKEN'),
  QUEUE_DB_PASSWORD: createSecretValidator('QUEUE_DB_PASSWORD').default(() => queuePass),
  CORE_SERVICE_URL: z.string().default('http://localhost:5000'),
  DATABASE_URL: z.string().default(defaultDbUrl),
  TEST_DATABASE_URL: z.string().default(defaultTestDbUrl),
  REDIS_HOST: z.string().default(redisHost),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_DB: z.coerce.number().default(2),
  RABBITMQ_URL: z.string().default(defaultRabbitUrl),
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
