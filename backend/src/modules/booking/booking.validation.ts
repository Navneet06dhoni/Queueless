import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const bookAppointmentSchema = z.object({
  slot_id: z.string({ required_error: 'slot_id is required' }).uuid('Valid slot UUID is required'),
});

export const rescheduleAppointmentSchema = z.object({
  new_slot_id: z.string({ required_error: 'new_slot_id is required' }).uuid('Valid new_slot_id UUID is required'),
});

export const updateAppointmentStatusSchema = z.object({
  status: z.enum(['completed', 'no_show'], {
    errorMap: () => ({ message: 'Status must be either "completed" or "no_show"' }),
  }),
});

export const myAppointmentsQuerySchema = z.object({
  status: z.enum(['confirmed', 'cancelled', 'completed', 'no_show']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const businessAppointmentsQuerySchema = z.object({
  date: z.string({ required_error: 'date is required' }).regex(dateRegex, 'date must be in YYYY-MM-DD format'),
});
