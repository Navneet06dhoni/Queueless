import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  role: z.enum(['customer', 'owner', 'admin']).optional(),
  q: z.string().trim().optional(),
  blocked: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? Math.max(1, parseInt(val, 10) || 1) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(100, Math.max(1, parseInt(val, 10) || 10)) : 10)),
});

export const blockUserBodySchema = z.object({
  blocked: z.boolean({ required_error: 'blocked boolean is required' }),
  reason: z.string().trim().max(500).optional(),
});

export const auditLogQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? Math.max(1, parseInt(val, 10) || 1) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(100, Math.max(1, parseInt(val, 10) || 20)) : 20)),
});
