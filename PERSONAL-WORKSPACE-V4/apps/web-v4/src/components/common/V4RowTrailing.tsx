import type { ReactNode } from 'react';

export interface V4RowTrailingProps {
  children: ReactNode;
}

/** Stable right-edge slot for a row's dominant state and contextual action. */
export function V4RowTrailing({ children }: V4RowTrailingProps) {
  return <div className="v4-row-trailing">{children}</div>;
}
