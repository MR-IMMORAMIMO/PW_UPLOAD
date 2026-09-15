import type { WorkSession } from '@scli/domain';

/**
 * P2.8B — Pure WorkSession time-presentation helpers.
 *
 * These are display-only utilities. The database row is the authority for
 * session state; the UI clock only refreshes presentation. Duration is never
 * persisted and never derived from actualHours.
 */

/** Compact professional duration format, e.g. 00:42 or 01:17:24. */
export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remaining = safe % 60;
  if (hours > 0) {
    return [hours, minutes, remaining].map((value) => String(value).padStart(2, '0')).join(':');
  }
  return [minutes, remaining].map((value) => String(value).padStart(2, '0')).join(':');
}

/** Human-readable tracked total, e.g. "1h 05m" or "0h 00m". */
export function formatTrackedTotal(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * Elapsed active-work seconds for a completed session
 * ((endedAt - startedAt - accumulatedPausedMs) / 1000), clamped to 0. Paused
 * time never counts as active work.
 */
export function completedSessionSeconds(session: WorkSession): number {
  if (session.endedAt === null) return 0;
  return Math.max(
    0,
    (Date.parse(session.endedAt) -
      Date.parse(session.startedAt) -
      (session.accumulatedPausedMs ?? 0)) /
      1_000,
  );
}

/**
 * Elapsed active-work seconds for an active session, clamped to 0 so a
 * temporarily skewed local clock never shows a negative timer.
 *
 * RUNNING: (now - startedAt - accumulatedPausedMs) / 1000
 * PAUSED:  (pausedAt - startedAt - accumulatedPausedMs) / 1000  (frozen)
 *
 * Paused time never counts as active work.
 */
export function activeSessionSeconds(session: WorkSession, now: number): number {
  const boundaryMs = session.pausedAt !== null ? Date.parse(session.pausedAt) : now;
  return Math.max(
    0,
    (boundaryMs - Date.parse(session.startedAt) - (session.accumulatedPausedMs ?? 0)) / 1_000,
  );
}

/**
 * Project tracked total derived ONLY from WorkSession rows. Completed sessions
 * use endedAt - startedAt - accumulatedPausedMs; an active session for this
 * project contributes the paused-aware elapsed (frozen at pausedAt when
 * PAUSED, else live). Never uses actualHours.
 */
export function projectTrackedSeconds(sessions: WorkSession[], now: number): number {
  return sessions.reduce((total, session) => {
    if (session.endedAt !== null) return total + completedSessionSeconds(session);
    return total + activeSessionSeconds(session, now);
  }, 0);
}
