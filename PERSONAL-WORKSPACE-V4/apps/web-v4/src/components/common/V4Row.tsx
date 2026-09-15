import type { HTMLAttributes, ReactNode } from 'react';

export type V4RowDensity = 'compact' | 'standard' | 'rich';

export interface V4RowProps extends HTMLAttributes<HTMLDivElement> {
  density?: V4RowDensity;
  selected?: boolean;
  metadata?: ReactNode;
  trailing?: ReactNode;
}

/** Shared collection-row grammar; page markup and domain content stay local. */
export function V4Row({
  density = 'standard',
  selected = false,
  metadata,
  trailing,
  className,
  children,
  ...props
}: V4RowProps) {
  return (
    <div
      className={`v4-row v4-row--${density}${className ? ` ${className}` : ''}`}
      data-selected={selected || undefined}
      {...props}
    >
      <div className="v4-row__content">
        {children}
        {metadata ? <div className="v4-row__metadata">{metadata}</div> : null}
      </div>
      {trailing ? <div className="v4-row__trailing">{trailing}</div> : null}
    </div>
  );
}
