/**
 * V4 project status display formatter (pure, framework-agnostic).
 *
 * Humanizes canonical enum-like Project.status labels for presentation WITHOUT
 * mutating the canonical domain value. The source value is never changed.
 *
 * Examples:
 *   InProgress        -> In Progress
 *   OnHold            -> On Hold
 *   AwaitingReview    -> Awaiting Review
 *   ReadyToIssue      -> Ready to Issue
 *   WaitingForSales   -> Waiting For Sales
 *
 * Unknown/empty values pass through unchanged (truthful, never invented).
 */
import type { V4StatusPillVariant } from '../common/V4StatusPill';

export function formatProjectStatus(status: string | null | undefined): string {
  if (!status) return '';
  if (status === 'ReadyToIssue') return 'Ready to Issue';
  // Insert a space before each embedded uppercase letter that follows a
  // lowercase letter or digit (camelCase boundary), then trim.
  return status
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical Project.status -> semantic tone mapping (shared presentation rule).
 *
 * Completed / Issued are SUCCESS; they must NEVER follow the product Accent.
 * The mapping is the single source of truth reused by the projects list and
 * the sidebar status chip so no semantic status leaks into the Accent.
 */
export function projectStatusTone(status: string | null | undefined): V4StatusPillVariant {
  if (!status) return 'neutral';
  if (status === 'Completed' || status === 'Issued') return 'success';
  if (status === 'Archived' || status === 'Cancelled') return 'neutral';
  if (status === 'RevisionRequired' || status === 'WaitingForInformation') return 'warning';
  if (status === 'OnHold' || status === 'WaitingForSales') return 'neutral';
  if (status === 'ClientReview' || status === 'InternalReview') return 'info';
  return 'info';
}
