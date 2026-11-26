import { z } from 'zod';

export const createSecretValidator = (name: string) =>
  z
    .string({ required_error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters long`)
    .refine((val) => val.trim().length > 0, `${name} must not be empty`)
    .refine((val) => !val.includes('CHANGE_ME'), `${name} must not be CHANGE_ME`);

export function loadConfig<T extends z.ZodTypeAny>(schema: T, env: Record<string, any> = process.env): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    console.error('Configuration validation failed:', parsed.error.format());
    throw new Error(`Configuration validation error: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}
