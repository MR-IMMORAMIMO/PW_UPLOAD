import { useRef, useState, type ReactNode } from 'react';
import { V4AnchoredSurface } from '../interaction/V4AnchoredSurface';
import { SctMore } from './SctIcons';

/** Commands use menu semantics; arrow navigation never executes a command. */
export function V4ActionMenu({
  label,
  actions,
}: {
  label: string;
  actions: Array<{ label: string; icon?: ReactNode; run: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const owner = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div ref={owner}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          border: 0,
          background: 'transparent',
          color: 'var(--v4-text-primary)',
          padding: 6,
          cursor: 'pointer',
        }}
      >
        <SctMore size={16} />
      </button>
      <V4AnchoredSurface
        open={open}
        ownerRef={owner}
        triggerRef={trigger}
        anchorToTrigger
        onRequestClose={() => setOpen(false)}
        className="v4-action-menu"
        role="menu"
        ariaLabel={label}
        style={{
          background: 'var(--v4-surface-base)',
          border: '1px solid var(--v4-border)',
          borderRadius: 8,
          padding: 6,
          boxShadow: '0 4px 16px #0002',
        }}
      >
        {actions.map((action, index) => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            ref={
              index === 0
                ? (node) => {
                    node?.focus();
                  }
                : undefined
            }
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const buttons =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitem"]',
                  );
                buttons?.[
                  (index + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length
                ]?.focus();
              }
            }}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              action.run();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: 8,
              border: 0,
              background: 'transparent',
              color: 'var(--v4-text-primary)',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </V4AnchoredSurface>
    </div>
  );
}
