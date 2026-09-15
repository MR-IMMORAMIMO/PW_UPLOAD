/**
 * C1 — the URL contract for the composition target.
 *
 * The ADDRESS is the single authority for "which Revision am I generating into":
 * it survives refresh, back/forward, and deep links. No router state, context, or
 * sessionStorage mirror of this value exists, so there is nothing that can
 * disagree with the address bar.
 *
 * A malformed reference is deliberately NOT forwarded to the server (which would
 * fail the whole workspace read); it is reported as an invalid target so the page
 * still renders and generation is still explicitly blocked.
 */
import type { TechnicalOutputRequestedTargetView } from '@scli/domain';

export const TARGET_REVISION_PARAM = 'targetRevisionId';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TargetRevisionParam {
  readonly raw: string;
  readonly wellFormed: boolean;
}

export function readTargetRevisionParam(params: URLSearchParams): TargetRevisionParam | null {
  const raw = params.get(TARGET_REVISION_PARAM)?.trim();
  if (!raw) return null;
  return { raw, wellFormed: uuidPattern.test(raw) };
}

/** The search string that carries a composition target on an existing route. */
export function targetRevisionSearch(revisionId: string): string {
  return `?${new URLSearchParams({ [TARGET_REVISION_PARAM]: revisionId }).toString()}`;
}

/** Local verdict for an address that cannot name a Revision at all. */
export function malformedTargetVerdict(raw: string): TechnicalOutputRequestedTargetView {
  return {
    revisionId: raw,
    eligible: false,
    rejection: 'TARGET_NOT_FOUND',
    message: 'The target Revision reference in the address is not a valid Revision identifier.',
    target: null,
  };
}
