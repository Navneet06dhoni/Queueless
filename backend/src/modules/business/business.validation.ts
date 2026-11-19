import { z } from 'zod';
import { DateTime } from 'luxon';

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const createBusinessSchema = z.object({
  name: z.string({ required_error: 'Business name is required' }).trim().min(2).max(255),
  category: z.string({ required_error: 'Category is required' }).trim().min(2).max(100),
  address: z.string({ required_error: 'Address is required' }).trim().min(3),
  city: z.string({ required_error: 'City is required' }).trim().min(2).max(100),
  phone: z.string({ required_error: 'Phone number is required' }).trim().min(8).max(30),
});

export const updateBusinessSchema = createBusinessSchema.partial();

export const businessQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  city: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const createServiceSchema = z.object({
  name: z.string({ required_error: 'Service name is required' }).trim().min(2).max(255),
  duration_minutes: z.coerce
    .number({ required_error: 'Duration in minutes is required' })
    .int()
    .min(5, 'Duration must be at least 5 minutes')
    .max(480, 'Duration cannot exceed 480 minutes (8 hours)'),
  price: z.coerce
    .number({ required_error: 'Price is required' })
    .min(0, 'Price must be greater than or equal to 0'),
});

export const updateServiceSchema = createServiceSchema.partial();

export const workingHourItemSchema = z
  .object({
    day_of_week: z.coerce.number().int().min(0).max(6),
    open_time: z.string().regex(timeRegex, 'Open time must be in HH:MM format'),
    close_time: z.string().regex(timeRegex, 'Close time must be in HH:MM format'),
  })
  .refine(
    (data) => {
      return data.close_time > data.open_time;
    },
    {
      message: 'close_time must be later than open_time',
      path: ['close_time'],
    }
  );

export const workingHoursSchema = z
  .array(workingHourItemSchema)
  .refine(
    (items) => {
      const days = items.map((i) => i.day_of_week);
      return new Set(days).size === days.length;
    },
    {
      message: 'Duplicate days of the week are not allowed in the schedule',
    }
  );

export const generateSlotsSchema = z
  .object({
    service_id: z.string().uuid('Valid service UUID is required'),
    from_date: z.string().regex(dateRegex, 'from_date must be in YYYY-MM-DD format'),
    to_date: z.string().regex(dateRegex, 'to_date must be in YYYY-MM-DD format'),
  })
  .refine(
    (data) => {
      const start = DateTime.fromISO(data.from_date);
      const end = DateTime.fromISO(data.to_date);
      return end >= start;
    },
    {
      message: 'to_date must be greater than or equal to from_date',
      path: ['to_date'],
    }
  )
  .refine(
    (data) => {
      const start = DateTime.fromISO(data.from_date);
      const end = DateTime.fromISO(data.to_date);
      const diff = end.diff(start, 'days').days;
      return diff <= 30;
    },
    {
      message: 'Date range cannot exceed 30 days per generation request',
      path: ['to_date'],
    }
  );

export const slotsQuerySchema = z.object({
  date: z.string().regex(dateRegex, 'date must be in YYYY-MM-DD format'),
  service_id: z.string().uuid().optional(),
});

export const adminStatusSchema = z.object({
  status: z.enum(['approved', 'rejected'], {
    errorMap: () => ({ message: 'Status must be either "approved" or "rejected"' }),
  }),
});

export const adminBusinessQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
