import { formatInTimeZone } from 'date-fns-tz';

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

/**
 * Formats a date into Asia/Kolkata timezone (e.g. "20 Nov 2026")
 */
export function formatDate(date: string | Date | number, formatStr = 'dd MMM yyyy'): string {
  if (!date) return '';
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return formatInTimeZone(d, BUSINESS_TIMEZONE, formatStr);
}

/**
 * Formats a time into Asia/Kolkata timezone (e.g. "09:30 AM")
 */
export function formatTime(date: string | Date | number, formatStr = 'hh:mm a'): string {
  if (!date) return '';
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return formatInTimeZone(d, BUSINESS_TIMEZONE, formatStr);
}

/**
 * Formats a full date and time into Asia/Kolkata timezone (e.g. "20 Nov 2026, 09:30 AM")
 */
export function formatDateTime(
  date: string | Date | number,
  formatStr = 'dd MMM yyyy, hh:mm a'
): string {
  if (!date) return '';
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return formatInTimeZone(d, BUSINESS_TIMEZONE, formatStr);
}
