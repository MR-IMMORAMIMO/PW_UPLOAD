export const BUSINESS_TIME_ZONE = 'Asia/Dubai';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const normalized = { ...options, timeZone: BUSINESS_TIME_ZONE };
  const key = `${locale}:${JSON.stringify(normalized)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, normalized);
  formatterCache.set(key, created);
  return created;
}

function instant(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnlyInstant(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function formatBusinessDate(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
): string {
  const date = instant(value);
  return date ? formatter('en-GB', options).format(date) : '';
}

export function formatBusinessTime(value: string | Date): string {
  const date = instant(value);
  return date
    ? formatter('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).format(date)
    : '';
}

export function formatBusinessDateTime(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  },
): string {
  const date = instant(value);
  return date ? formatter('en-GB', options).format(date) : '';
}

/** Formats YYYY-MM-DD as a calendar value, never as a midnight UTC instant. */
export function formatBusinessDateOnly(
  value: string,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
): string {
  const date = dateOnlyInstant(value);
  return date ? formatter('en-GB', options).format(date) : '';
}

export function businessDateKey(value: string | Date): string {
  const date = instant(value);
  if (!date) return '';
  const parts = formatter('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function businessTodayKey(now: Date = new Date()): string {
  return businessDateKey(now);
}

export function addBusinessCalendarDays(dateKey: string, days: number): string {
  const date = dateOnlyInstant(dateKey);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function businessCalendarDayDifference(left: string, right: string): number | null {
  const leftDate = dateOnlyInstant(left);
  const rightDate = dateOnlyInstant(right);
  if (!leftDate || !rightDate) return null;
  return Math.round((leftDate.getTime() - rightDate.getTime()) / 86_400_000);
}

export function isOverdueBusinessDate(dateKey: string, now: Date = new Date()): boolean {
  const difference = businessCalendarDayDifference(dateKey, businessTodayKey(now));
  return difference !== null && difference < 0;
}
