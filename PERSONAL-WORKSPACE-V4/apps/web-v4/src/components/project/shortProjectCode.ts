/**
 * V4 short project-code display helper (pure, framework-agnostic).
 *
 * Derives a compact presentation-only short code from a canonical Project.code
 * WITHOUT mutating the canonical value. For a code like:
 *
 *   `001_SCT260809_TEST`
 *
 * it returns `001` (the leading token before the first underscore).
 *
 * This is a DISPLAY helper only. It never writes to the database, never creates
 * a new identity field, and never treats the short code as a primary key or as
 * the canonical Project UUID / Project.code.
 *
 * If no usable leading token can be derived (empty/whitespace code, or no
 * non-empty leading underscore segment), it returns `null` so callers can show
 * the identity without fabricating a number.
 */
export function deriveShortProjectCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const leading = code.split('_')[0];
  if (!leading || leading.trim().length === 0) return null;
  return leading;
}
