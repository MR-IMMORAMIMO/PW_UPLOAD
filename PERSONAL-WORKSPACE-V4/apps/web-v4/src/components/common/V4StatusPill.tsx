import type { ReactNode } from 'react';

export type V4StatusPillVariant =
  'neutral' | 'info' | 'success' | 'warning' | 'critical' | 'inactive' | 'danger';

export interface V4StatusPillProps {
  children: ReactNode;
  variant: V4StatusPillVariant;
}

/** Presentational status treatment; canonical-to-semantic mapping stays at the caller. */
export function V4StatusPill({ children, variant }: V4StatusPillProps) {
  return (
    <span className="v4-status-pill" data-variant={variant}>
      {children}
    </span>
  );
}
