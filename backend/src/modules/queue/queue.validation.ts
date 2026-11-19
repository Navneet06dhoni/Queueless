import { z } from 'zod';

export const checkInSchema = z.object({
  appointment_id: z.string().uuid('Invalid appointment ID format'),
});

export const skipSchema = z.object({
  requeue: z.boolean().optional().default(false),
});

export const walkInSchema = z.object({
  name: z.string().trim().min(1, 'Walk-in name is required').max(100),
});

export const toggleOpenSchema = z.object({
  open: z.boolean({ required_error: 'Open status is required' }),
});

export type CheckInInput = z.infer<typeof checkInSchema>;
export type SkipInput = z.infer<typeof skipSchema>;
export type WalkInInput = z.infer<typeof walkInSchema>;
export type ToggleOpenInput = z.infer<typeof toggleOpenSchema>;
