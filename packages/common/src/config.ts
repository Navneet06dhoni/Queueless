import { z } from 'zod';

export function loadConfig<T extends z.ZodTypeAny>(schema: T, env: Record<string, any> = process.env): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    console.error('Configuration validation failed:', parsed.error.format());
    throw new Error(`Configuration validation error: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}
