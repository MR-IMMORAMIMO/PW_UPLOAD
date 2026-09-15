import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useOptionalV4WorkSession } from '../work-session/WorkSessionProvider';
import { V4WorkSessionTray } from '../work-session/WorkSessionSurfaces';
import { V4AnchoredSurface } from '../interaction/V4AnchoredSurface';
import { ensureV4OverlayRoot } from '../interaction/V4OverlayProvider';

export function FinalSessionControl({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: (
    props: HTMLAttributes<HTMLDivElement> & {
      ref: RefObject<HTMLDivElement | null>;
      'data-state': string;
      'data-mode': string;
    },
  ) => ReactNode;
}) {
  const session = useOptionalV4WorkSession();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const open = session?.trayOpen ?? false;
  useLayoutEffect(() => {
    if (!open) return;
    const sync = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(328, window.innerWidth - 24);
      setPosition({
        width,
        left: Math.max(12, Math.min(rect.left + 12, window.innerWidth - width - 12)),
        bottom: Math.max(12, window.innerHeight - rect.top + 8),
      });
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [open, collapsed]);
  const toggle = () => session?.setTrayOpen(!open);
  return (
    <>
      {children({
        ref: anchorRef,
        'data-state': session?.state ?? 'INACTIVE',
        'data-mode': collapsed ? 'minimal' : 'extended',
        role: 'button',
        tabIndex: 0,
        'aria-label': collapsed
          ? `Work Session, ${session?.state?.toLowerCase() ?? 'inactive'}`
          : 'Work Session',
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        onClick: toggle,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        },
      })}
      {session
        ? createPortal(
            <V4AnchoredSurface
              open={open}
              ownerRef={anchorRef}
              triggerRef={anchorRef}
              onRequestClose={() => session.setTrayOpen(false)}
              className="v4-work-session-tray"
              role="dialog"
              ariaLabel="Work Session"
              style={position}
              testId="v4-work-session-tray"
              dataState={session.state ?? 'INACTIVE'}
              ariaModal={false}
            >
              <V4WorkSessionTray onClose={() => session.setTrayOpen(false)} />
            </V4AnchoredSurface>,
            ensureV4OverlayRoot(),
          )
        : null}
    </>
  );
}
