// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { WorkSession } from '@scli/domain';
import {
  activeSessionSeconds,
  completedSessionSeconds,
  formatElapsed,
  projectTrackedSeconds,
} from './work-session-time';

function makeSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'bbbbbbbb-0000-4000-8000-0000000000b1',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    startedAt: '2026-08-01T08:00:00.000Z',
    endedAt: null,
    pausedAt: null,
    accumulatedPausedMs: 0,
    createdAt: '2026-08-01T08:00:00.000Z',
    ...overrides,
  };
}

const NOW_MS = Date.parse('2026-08-01T11:00:00.000Z');

describe('paused-aware WorkSession time helpers', () => {
  it('RUNNING active elapsed = now - startedAt - accumulatedPausedMs', () => {
    // 08:00 -> 11:00 = 3h = 10800s, minus 30m accumulated = 2h30m = 9000s.
    const seconds = activeSessionSeconds(
      makeSession({ accumulatedPausedMs: 30 * 60 * 1000 }),
      NOW_MS,
    );
    expect(seconds).toBe(9000);
  });

  it('PAUSED active elapsed is frozen at pausedAt (not wall clock)', () => {
    // Paused at 10:00; wall clock 11:00. Elapsed frozen at 10:00-08:00 = 2h.
    const seconds = activeSessionSeconds(
      makeSession({ pausedAt: '2026-08-01T10:00:00.000Z' }),
      NOW_MS,
    );
    expect(seconds).toBe(2 * 60 * 60);
  });

  it('PAUSED active elapsed subtracts accumulated paused time', () => {
    // Paused at 10:00 with 30m accumulated: frozen at 10:00-08:00 - 30m = 1h30m.
    const seconds = activeSessionSeconds(
      makeSession({ pausedAt: '2026-08-01T10:00:00.000Z', accumulatedPausedMs: 30 * 60 * 1000 }),
      NOW_MS,
    );
    expect(seconds).toBe(90 * 60);
  });

  it('completed elapsed subtracts accumulated paused time', () => {
    // 08:00 -> 12:00 = 4h, minus 40m accumulated = 3h20m = 12000s.
    const seconds = completedSessionSeconds(
      makeSession({
        endedAt: '2026-08-01T12:00:00.000Z',
        accumulatedPausedMs: 40 * 60 * 1000,
      }),
    );
    expect(seconds).toBe(3 * 60 * 60 + 20 * 60);
  });

  it('completed session with zero pause returns full elapsed', () => {
    const seconds = completedSessionSeconds(makeSession({ endedAt: '2026-08-01T10:00:00.000Z' }));
    expect(seconds).toBe(2 * 60 * 60);
  });

  it('elapsed clamps to 0 for negative results', () => {
    const seconds = completedSessionSeconds(
      makeSession({
        endedAt: '2026-08-01T09:00:00.000Z',
        accumulatedPausedMs: 2 * 60 * 60 * 1000,
      }),
    );
    expect(seconds).toBe(0);
  });

  it('projectTrackedSeconds excludes paused time across completed + active', () => {
    const sessions: WorkSession[] = [
      // completed: 08:00->10:00 = 2h minus 30m paused = 1h30m
      makeSession({
        id: 's1',
        startedAt: '2026-08-01T08:00:00.000Z',
        endedAt: '2026-08-01T10:00:00.000Z',
        accumulatedPausedMs: 30 * 60 * 1000,
      }),
      // active RUNNING: 08:00->11:00 = 3h minus 1h paused = 2h
      makeSession({
        id: 's2',
        startedAt: '2026-08-01T08:00:00.000Z',
        accumulatedPausedMs: 60 * 60 * 1000,
      }),
    ];
    expect(projectTrackedSeconds(sessions, NOW_MS)).toBe(1.5 * 60 * 60 + 2 * 60 * 60);
  });

  it('formatElapsed stays stable', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(3725)).toBe('01:02:05');
  });
});
