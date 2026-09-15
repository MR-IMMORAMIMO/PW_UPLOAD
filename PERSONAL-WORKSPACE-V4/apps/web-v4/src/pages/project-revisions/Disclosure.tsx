/**
 * Compact collapsible disclosure used by the technical inspectors.
 *
 * Accessible (button + aria-expanded), collapsible state lives in the parent
 * so tests can assert the default-collapsed contract and toggle behaviour.
 */
import { ChevronDown } from '../../components/common/SctIcons';
import type { ReactNode } from 'react';

export function Disclosure({
  title,
  open,
  onToggle,
  testId,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="v4-revisions__disclosure">
      <button
        type="button"
        className="v4-revisions__disclosure-toggle"
        aria-expanded={open}
        data-testid={`${testId}-toggle`}
        onClick={onToggle}
      >
        <ChevronDown size={14} className="v4-revisions__disclosure-caret" aria-hidden="true" />
        <span>{title}</span>
      </button>
      {open ? (
        <div className="v4-revisions__disclosure-body" data-testid={`${testId}-body`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
