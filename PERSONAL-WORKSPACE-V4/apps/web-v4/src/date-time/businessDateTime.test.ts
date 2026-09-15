import { describe, expect, it } from 'vitest';
import {
  addBusinessCalendarDays,
  businessCalendarDayDifference,
  businessTodayKey,
  formatBusinessDateOnly,
  formatBusinessDateTime,
  formatBusinessTime,
  isOverdueBusinessDate,
} from './businessDateTime';

describe('Asia/Dubai business date and time authority', () => {
  it('formats an instant as Dubai time independently of the host timezone', () => {
    const instant = '2026-08-24T16:45:00.000Z';
    expect(formatBusinessTime(instant)).toBe('08:45 PM');
    expect(formatBusinessDateTime(instant).toUpperCase()).toContain('08:45 PM');
  });

  it('keeps date-only values on their authored calendar day', () => {
    expect(formatBusinessDateOnly('2026-08-24')).toBe('24 Aug 2026');
    expect(formatBusinessDateOnly('2026-12-31')).toBe('31 Dec 2026');
  });

  it('derives today, overdue, upcoming, and near-midnight boundaries in Dubai', () => {
    const nearMidnight = new Date('2026-08-23T21:30:00.000Z');
    expect(businessTodayKey(nearMidnight)).toBe('2026-08-24');
    expect(isOverdueBusinessDate('2026-08-23', nearMidnight)).toBe(true);
    expect(isOverdueBusinessDate('2026-08-24', nearMidnight)).toBe(false);
    expect(businessCalendarDayDifference('2026-08-27', businessTodayKey(nearMidnight))).toBe(3);
    expect(addBusinessCalendarDays('2026-08-24', 7)).toBe('2026-08-31');
  });
});
