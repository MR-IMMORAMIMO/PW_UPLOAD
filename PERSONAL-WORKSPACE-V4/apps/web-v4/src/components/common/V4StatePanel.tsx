import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type V4StatePanelTone = 'empty' | 'info' | 'warning' | 'error';

export interface V4StatePanelProps {
  icon?: LucideIcon;
  title: string;
  message: string;
  action?: ReactNode;
  tone?: V4StatePanelTone;
  compact?: boolean;
}

export function V4StatePanel({
  icon: Icon,
  title,
  message,
  action,
  tone = 'empty',
  compact = false,
}: V4StatePanelProps) {
  return (
    <div
      className="v4-state-panel"
      data-tone={tone}
      data-compact={compact || undefined}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {Icon ? <Icon className="v4-state-panel__icon" aria-hidden="true" /> : null}
      <strong>{title}</strong>
      <p>{message}</p>
      {action ? <div className="v4-state-panel__action">{action}</div> : null}
    </div>
  );
}
