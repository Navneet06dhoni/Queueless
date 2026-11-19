import { z } from 'zod';
import { DateTime } from 'luxon';
import { config } from '../../config';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const summaryQuerySchema = z
  .object({
    from: z
      .string()
      .regex(DATE_REGEX, 'from date must be in YYYY-MM-DD format')
      .optional(),
    to: z
      .string()
      .regex(DATE_REGEX, 'to date must be in YYYY-MM-DD format')
      .optional(),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return data.to >= data.from;
      }
      return true;
    },
    {
      message: '"to" date must not be before "from" date',
      path: ['to'],
    }
  )
  .refine(
    (data) => {
      if (data.from && data.to) {
        const fromDt = DateTime.fromISO(data.from, { zone: config.BUSINESS_TIMEZONE });
        const toDt = DateTime.fromISO(data.to, { zone: config.BUSINESS_TIMEZONE });
        const diffDays = toDt.diff(fromDt, 'days').days;
        return diffDays <= 90;
      }
      return true;
    },
    {
      message: 'Date range must not exceed 90 days',
      path: ['to'],
    }
  );
