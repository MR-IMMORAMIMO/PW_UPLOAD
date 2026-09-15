import type { HTMLAttributes, ReactNode } from 'react';

export interface V4ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  left?: ReactNode;
  middle?: ReactNode;
  right?: ReactNode;
  className?: string;
  label?: string;
}

export function V4Toolbar({
  left,
  middle,
  right,
  className,
  label = 'Page tools',
  ...props
}: V4ToolbarProps) {
  return (
    <div
      className={`v4-toolbar${className ? ` ${className}` : ''}`}
      role="toolbar"
      aria-label={label}
      {...props}
    >
      {left ? <div className="v4-toolbar__left">{left}</div> : null}
      {middle ? <div className="v4-toolbar__middle">{middle}</div> : null}
      {right ? <div className="v4-toolbar__right">{right}</div> : null}
    </div>
  );
}
