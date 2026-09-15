import { useId, type ReactNode, type RefObject } from 'react';
import { X } from './SctIcons';
import { V4ModalLayer } from '../interaction/V4ModalLayer';
import type { V4CloseReason } from '../interaction/V4OverlayProvider';
import { V4Button } from './V4Button';
import { V4FloatingWorkspace } from './V4FloatingWorkspace';

export interface V4DrawerProps {
  open: boolean;
  title: string;
  onClose?: (() => void) | undefined;
  onRequestClose?: ((reason: V4CloseReason) => void) | undefined;
  children: ReactNode;
  footer?: ReactNode;
  description?: string;
  'aria-label'?: string;
  className?: string;
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  presentation?: 'drawer' | 'float';
}

/** Shared modal drawer with real exit presence and one close-policy contract. */
export function V4Drawer({
  open,
  title,
  onClose,
  onRequestClose,
  children,
  footer,
  description,
  'aria-label': ariaLabel,
  className,
  dismissible = true,
  initialFocusRef,
  returnFocusRef,
  presentation = 'drawer',
}: V4DrawerProps) {
  const titleId = useId();
  const requestClose = (reason: V4CloseReason) => {
    if (onRequestClose) onRequestClose(reason);
    else onClose?.();
  };
  if (presentation === 'float')
    return (
      <V4FloatingWorkspace
        open={open}
        title={title}
        ariaLabel={ariaLabel}
        {...(description ? { description } : {})}
        onRequestClose={requestClose}
        footer={footer}
        dismissible={dismissible}
        initialFocusRef={initialFocusRef}
        returnFocusRef={returnFocusRef}
        panelClassName={`v4-editor-float${className ? ` ${className}` : ''}`}
      >
        {children}
      </V4FloatingWorkspace>
    );
  return (
    <V4ModalLayer
      open={open}
      className="v4-drawer__layer"
      backdropClassName="v4-drawer__backdrop"
      panelClassName={`v4-drawer${className ? ` ${className}` : ''}`}
      dismissible={dismissible}
      initialFocusRef={initialFocusRef}
      returnFocusRef={returnFocusRef}
      onRequestClose={requestClose}
      role="dialog"
      ariaLabel={ariaLabel}
      ariaLabelledBy={ariaLabel ? undefined : titleId}
      testId="v4-drawer-layer"
      panelTestId="v4-drawer"
      backdropTestId="v4-drawer-backdrop"
    >
      <header className="v4-drawer__header">
        <div className="v4-drawer__heading">
          <h2 id={titleId} className="v4-drawer__title">
            {title}
          </h2>
          {description ? <p className="v4-drawer__description">{description}</p> : null}
        </div>
        <V4Button
          variant="icon"
          size="compact"
          className="v4-drawer__close"
          aria-label="Close"
          disabled={!dismissible}
          onClick={() => requestClose('close-button')}
        >
          <X aria-hidden="true" />
        </V4Button>
      </header>
      <div className="v4-drawer__body">{children}</div>
      {footer ? <footer className="v4-drawer__footer">{footer}</footer> : null}
    </V4ModalLayer>
  );
}
