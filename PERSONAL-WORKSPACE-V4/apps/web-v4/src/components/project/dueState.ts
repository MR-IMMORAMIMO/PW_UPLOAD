/**
 * V4 due-date semantic state derivation (pure, framework-agnostic).
 *
 * Locked grammar:
 *   - due soon -> amber semantic state
 *   - overdue  -> red semantic state
 *   - otherwise -> neutral
 *
 * Exact Phase-3 colors are NOT finalized here; the consumer applies semantic
 * classes/tokens (`v4-due--neutral` / `v4-due--soon` / `v4-due--overdue`).
 */
import { businessCalendarDayDifference, businessTodayKey } from '../../date-time/businessDateTime';

export type V4DueState = 'neutral' | 'soon' | 'overdue';

/** Default number of days before a due date that counts as "due soon". */
export const DEFAULT_DUE_SOON_DAYS = 7;

/**
 * Derive the semantic due state for a given due date and "now".
 *
 * A missing/null due date is neutral. "Due soon" is defined as the due date
 * falling within the inclusive `soonDays` window starting from today and not
 * yet past. Overdue means the due date is strictly before today (UTC date
 * comparison, so a due date of today is never flagged overdue).
 */
export function deriveDueState(
  dueDate: string | null | undefined,
  now: Date,
  soonDays = DEFAULT_DUE_SOON_DAYS,
): V4DueState {
  if (!dueDate) return 'neutral';

  const daysUntil = businessCalendarDayDifference(dueDate.slice(0, 10), businessTodayKey(now));
  if (daysUntil === null) return 'neutral';
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= soonDays) return 'soon';
  return 'neutral';
}
