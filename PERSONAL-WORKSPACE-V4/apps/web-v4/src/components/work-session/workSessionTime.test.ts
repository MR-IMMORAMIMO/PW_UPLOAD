import { describe, expect, it } from 'vitest';
import type { WorkSession } from '@scli/domain';
import { formatWorkSessionElapsed, workSessionElapsedSeconds } from './workSessionTime';

const SESSION: WorkSession = {
  id: '10000000-0000-4000-8000-000000000001',
  projectId: '20000000-0000-4000-8000-000000000001',
  startedAt: '2026-08-17T06:00:00.000Z',
  endedAt: null,
  pausedAt: null,
  accumulatedPausedMs: 60_000,
  createdAt: '2026-08-17T06:00:00.000Z',
};

describe('V4 Work Session display time', () => {
  it('derives running elapsed from the authoritative row and current display clock', () => {
    expect(workSessionElapsedSeconds(SESSION, Date.parse('2026-08-17T07:24:37.000Z'))).toBe(5_017);
    expect(formatWorkSessionElapsed(5_017)).toBe('01:23:37');
  });

  it('freezes paused elapsed at pausedAt and ignores a later display clock', () => {
    const paused = { ...SESSION, pausedAt: '2026-08-17T07:24:37.000Z' };
    const first = workSessionElapsedSeconds(paused, Date.parse('2026-08-17T08:00:00.000Z'));
    const later = workSessionElapsedSeconds(paused, Date.parse('2026-08-17T12:00:00.000Z'));
    expect(first).toBe(5_017);
    expect(later).toBe(first);
    expect(formatWorkSessionElapsed(later)).toBe('01:23:37');
  });

  it('always formats approved HH:MM:SS geometry, including under one hour', () => {
    expect(formatWorkSessionElapsed(5)).toBe('00:00:05');
    expect(formatWorkSessionElapsed(3_605)).toBe('01:00:05');
  });
});
