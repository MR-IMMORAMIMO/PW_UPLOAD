import { V4StatusPill, type V4StatusPillVariant } from './V4StatusPill';

export type V4VerificationState =
  'VERIFIED' | 'LEGACY_UNVERIFIED' | 'MISSING' | 'UNAVAILABLE' | 'HASH_MISMATCH';

const VERIFICATION_VARIANT: Record<V4VerificationState, V4StatusPillVariant> = {
  VERIFIED: 'success',
  LEGACY_UNVERIFIED: 'warning',
  MISSING: 'inactive',
  UNAVAILABLE: 'critical',
  HASH_MISMATCH: 'critical',
};

export function V4VerificationStatePill({ state }: { state: V4VerificationState }) {
  return <V4StatusPill variant={VERIFICATION_VARIANT[state]}>{state}</V4StatusPill>;
}
