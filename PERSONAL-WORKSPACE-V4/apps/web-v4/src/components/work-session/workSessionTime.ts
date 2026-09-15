import type { WorkSession } from '@scli/domain';

/** Display-only elapsed time derived from the authoritative WorkSession row. */
export function workSessionElapsedSeconds(session: WorkSession, now: number): number {
  const boundary = session.pausedAt ? Date.parse(session.pausedAt) : now;
  return Math.max(
    0,
    Math.floor(
      (boundary - Date.parse(session.startedAt) - (session.accumulatedPausedMs ?? 0)) / 1_000,
    ),
  );
}

/** V4's approved Work Session clock always uses HH:MM:SS. */
export function formatWorkSessionElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remaining = safe % 60;
  return [hours, minutes, remaining].map((value) => String(value).padStart(2, '0')).join(':');
}
