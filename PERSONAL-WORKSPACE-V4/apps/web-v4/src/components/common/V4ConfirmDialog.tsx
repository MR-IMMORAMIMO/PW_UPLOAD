import { useId, useRef, type RefObject, type ReactNode } from 'react';
import { V4ModalLayer } from '../interaction/V4ModalLayer';
import { V4Button } from './V4Button';

export interface V4ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  destructive?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  onAfterExit?: (() => void) | undefined;
  restoreFocus?: boolean | undefined;
  additionalAction?: ReactNode;
}

export function V4ConfirmDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  pending = false,
  destructive = false,
  returnFocusRef,
  onAfterExit,
  restoreFocus = true,
  additionalAction,
}: V4ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <V4ModalLayer
      open={open}
      kind="nested-dialog"
      dismissible={!pending}
      className="v4-confirm-dialog__layer"
      backdropClassName="v4-confirm-dialog__backdrop"
      panelClassName="v4-confirm-dialog"
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
      onRequestClose={onCancel}
      onAfterExit={onAfterExit}
      restoreFocus={restoreFocus}
      testId="v4-confirm-dialog-layer"
    >
      <section
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-describedby={descriptionId}
        aria-label={title.replace(/\?$/, '')}
        tabIndex={-1}
      >
        <h3 id={titleId}>{title}</h3>
        <p id={descriptionId}>{description}</p>
        <div className="v4-confirm-dialog__actions">
          <V4Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </V4Button>
          {additionalAction}
          <V4Button
            variant={destructive ? 'danger' : 'primary'}
            className={destructive ? 'v4-confirm-dialog__destructive' : undefined}
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {confirmLabel}
          </V4Button>
        </div>
      </section>
    </V4ModalLayer>
  );
}
