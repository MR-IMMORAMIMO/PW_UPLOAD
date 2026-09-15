import { describe, expect, it } from 'vitest';
import { MEETING_TIME_ZONE, meetingCalendarDay } from './personal';

describe('Meeting calendar authority', () => {
  it('uses Asia/Dubai calendar days rather than the device-local day', () => {
    expect(MEETING_TIME_ZONE).toBe('Asia/Dubai');
    // 20:30 UTC is still the same UTC date but already tomorrow in Dubai (UTC+4).
    expect(meetingCalendarDay('2026-08-10T20:30:00.000Z')).toBe('2026-08-11');
    expect(meetingCalendarDay('2026-08-10T19:59:59.000Z')).toBe('2026-08-10');
  });

  it('keeps past, today, tomorrow, and future date primitives stable', () => {
    expect(meetingCalendarDay('2026-08-09T20:30:00.000Z')).toBe('2026-08-10');
    expect(meetingCalendarDay('2026-08-10T20:30:00.000Z')).toBe('2026-08-11');
    expect(meetingCalendarDay('2026-08-14T20:30:00.000Z')).toBe('2026-08-15');
  });
});
