import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { X } from './SctIcons';
import { V4ModalLayer } from '../interaction/V4ModalLayer';
import type { V4CloseReason } from '../interaction/V4OverlayProvider';
import { V4Button } from './V4Button';

export interface V4FloatingWorkspaceProps {
  open: boolean;
  title: string;
  ariaLabel?: string | undefined;
  description?: string;
  onRequestClose: (reason: V4CloseReason) => void;
  children: ReactNode;
  footer: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  dismissible?: boolean;
  onAfterExit?: (() => void) | undefined;
  bodyClassName?: string | undefined;
  panelClassName?: string | undefined;
  /** Optional actions rendered in the header band (before the close control). */
  headerActions?: ReactNode | undefined;
}

/** Near-full-screen workspace backed by the shared modal/presence authority. */
export function V4FloatingWorkspace({
  open,
  title,
  ariaLabel,
  description,
  onRequestClose,
  children,
  footer,
  initialFocusRef,
  returnFocusRef,
  dismissible = true,
  onAfterExit,
  bodyClassName,
  panelClassName,
  headerActions,
}: V4FloatingWorkspaceProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  return (
    <V4ModalLayer
      open={open}
      className="v4-floating-workspace__layer"
      backdropClassName="v4-floating-workspace__backdrop"
      panelClassName={
        panelClassName ? `v4-floating-workspace ${panelClassName}` : 'v4-floating-workspace'
      }
      panelRef={panelRef}
      initialFocusRef={initialFocusRef}
      returnFocusRef={returnFocusRef}
      dismissible={dismissible}
      onRequestClose={onRequestClose}
      onAfterExit={onAfterExit}
      role="dialog"
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabel ? undefined : titleId}
      ariaDescribedBy={description ? descriptionId : undefined}
      testId="v4-floating-workspace-layer"
      panelTestId="v4-floating-workspace"
    >
      <header className="v4-floating-workspace__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        {headerActions ? (
          <div className="v4-floating-workspace__header-actions">{headerActions}</div>
        ) : null}
        <V4Button
          variant="icon"
          size="compact"
          aria-label="Close"
          disabled={!dismissible}
          onClick={() => onRequestClose('close-button')}
        >
          <X aria-hidden="true" />
        </V4Button>
      </header>
      <div
        className={
          bodyClassName
            ? `v4-floating-workspace__body ${bodyClassName}`
            : 'v4-floating-workspace__body'
        }
      >
        {children}
      </div>
      <footer className="v4-floating-workspace__footer">{footer}</footer>
    </V4ModalLayer>
  );
}
