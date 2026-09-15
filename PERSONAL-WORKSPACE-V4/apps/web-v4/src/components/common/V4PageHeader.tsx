/**
 * V4PageHeader — reusable page header.
 *
 * Supports a page title, a short operational description, an optional icon,
 * and optional primary/secondary action slots. Phase 3C owns the compact
 * 22/28 title band and 20px semantic glyph through shared tokens.
 *
 * Reusable: it does NOT hard-code page-specific text.
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface V4PageHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Right-side primary/secondary action slots. */
  actions?: ReactNode;
}

export function V4PageHeader({ title, description, icon: Icon, actions }: V4PageHeaderProps) {
  return (
    <header className="v4-page-header" data-testid="v4-page-header">
      <div className="v4-page-header__title-row">
        {Icon ? (
          <span className="v4-page-header__icon">
            <Icon aria-hidden="true" strokeWidth={1.75} />
          </span>
        ) : null}
        <h1 className="v4-page-header__title">{title}</h1>
      </div>
      {description ? (
        <p className="v4-page-header__description" data-testid="v4-page-header-desc">
          {description}
        </p>
      ) : null}
      {actions ? <div className="v4-page-header__actions">{actions}</div> : null}
    </header>
  );
}
