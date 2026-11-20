import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatDate, formatTime, formatDateTime } from '../utils/date';

describe('Date & Time Formatting Helpers (Asia/Kolkata)', () => {
  const originalTZ = process.env.TZ;

  beforeEach(() => {
    // Explicitly simulate a different client timezone like America/New_York
    process.env.TZ = 'America/New_York';
  });

  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it('renders correct IST time from UTC timestamp regardless of client timezone', () => {
    // 04:30 UTC = 10:00 AM IST (UTC + 05:30)
    const utcTimestamp = '2026-11-20T04:30:00.000Z';
    const formatted = formatTime(utcTimestamp);
    expect(formatted).toBe('10:00 AM');
  });

  it('renders correct IST date from UTC timestamp across date boundaries', () => {
    // 19:00 UTC on Nov 19 = 00:30 AM IST on Nov 20
    const utcTimestamp = '2026-11-19T19:00:00.000Z';
    const formattedDate = formatDate(utcTimestamp);
    expect(formattedDate).toBe('20 Nov 2026');
  });

  it('renders full formatDateTime in Asia/Kolkata timezone', () => {
    // 09:15 UTC = 02:45 PM IST
    const utcTimestamp = '2026-11-20T09:15:00.000Z';
    const formatted = formatDateTime(utcTimestamp);
    expect(formatted).toBe('20 Nov 2026, 02:45 PM');
  });

  it('handles empty or invalid inputs gracefully', () => {
    expect(formatDate('')).toBe('');
    expect(formatTime('')).toBe('');
    expect(formatDateTime('')).toBe('');
  });
});
