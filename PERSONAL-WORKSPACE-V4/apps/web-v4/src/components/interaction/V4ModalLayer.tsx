import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useV4Presence } from './useV4Presence';
import {
  ensureV4OverlayRoot,
  V4ParentLayer,
  V4OverlayProvider,
  useV4Overlay,
  useV4OverlayOptional,
  useV4ParentLayerId,
  type V4CloseReason,
} from './V4OverlayProvider';

export interface V4ModalLayerProps {
  open: boolean;
  kind?: 'modal' | 'nested-dialog';
  dismissible?: boolean;
  className: string;
  backdropClassName?: string;
  panelClassName: string;
  panelRef?: RefObject<HTMLElement | null> | undefined;
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  fallbackFocusRef?: RefObject<HTMLElement | null> | undefined;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  onRequestClose: (reason: V4CloseReason) => void;
  onAfterExit?: (() => void) | undefined;
  children: ReactNode;
  testId?: string;
  panelTestId?: string | undefined;
  backdropTestId?: string | undefined;
  role?: 'dialog' | 'alertdialog' | undefined;
  ariaLabel?: string | undefined;
  ariaLabelledBy?: string | undefined;
  ariaDescribedBy?: string | undefined;
  restoreFocus?: boolean | undefined;
}

export function V4ModalLayer(props: V4ModalLayerProps) {
  const overlay = useV4OverlayOptional();
  if (!overlay) {
    return (
      <V4OverlayProvider>
        <V4ModalLayerInner {...props} />
      </V4OverlayProvider>
    );
  }
  return <V4ModalLayerInner {...props} />;
}

function V4ModalLayerInner({
  open,
  kind = 'modal',
  dismissible = true,
  className,
  backdropClassName,
  panelClassName,
  panelRef,
  initialFocusRef,
  fallbackFocusRef,
  returnFocusRef,
  onRequestClose,
  onAfterExit,
  children,
  testId,
  panelTestId,
  backdropTestId,
  role,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  restoreFocus = true,
}: V4ModalLayerProps) {
  const id = useId();
  const parentId = useV4ParentLayerId();
  const internalPanelRef = useRef<HTMLElement | null>(null);
  const requestCloseRef = useRef(onRequestClose);
  const dismissibleRef = useRef(dismissible);
  const restoreFocusRef = useRef(restoreFocus);
  const { layers, register } = useV4Overlay();
  const presence = useV4Presence(open);
  const wasMountedRef = useRef(presence.mounted);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = returnFocusRef?.current ?? document.activeElement;
    if (
      trigger instanceof HTMLElement &&
      trigger !== document.body &&
      !internalPanelRef.current?.contains(trigger)
    ) {
      const rect = trigger.getBoundingClientRect();
      originRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    const panel = internalPanelRef.current;
    if (panel && originRef.current) {
      const previous = panel.style.transform;
      panel.style.transform = 'none';
      const rect = panel.getBoundingClientRect();
      panel.style.transform = previous;
      panel.style.setProperty(
        '--v4-unfold-x',
        `${originRef.current.x - rect.left - rect.width / 2}px`,
      );
      panel.style.setProperty(
        '--v4-unfold-y',
        `${originRef.current.y - rect.top - rect.height / 2}px`,
      );
    }
  }, [open, presence.mounted, returnFocusRef]);

  useLayoutEffect(() => {
    requestCloseRef.current = onRequestClose;
    dismissibleRef.current = dismissible;
    restoreFocusRef.current = restoreFocus;
  }, [dismissible, onRequestClose, restoreFocus]);

  useEffect(() => {
    if (wasMountedRef.current && !presence.mounted) onAfterExit?.();
    wasMountedRef.current = presence.mounted;
  }, [onAfterExit, presence.mounted]);

  useEffect(() => {
    if (!presence.mounted) return undefined;
    return register({
      id,
      parentId,
      kind,
      dismissible: true,
      panelRef: internalPanelRef,
      initialFocusRef,
      fallbackFocusRef,
      returnFocusRef,
      requestClose: (reason) => {
        if (dismissibleRef.current) requestCloseRef.current(reason);
      },
      shouldRestoreFocus: () => restoreFocusRef.current,
    });
  }, [
    fallbackFocusRef,
    id,
    initialFocusRef,
    kind,
    parentId,
    presence.mounted,
    register,
    returnFocusRef,
  ]);

  if (!presence.mounted) return null;
  const hasChild = layers.some((layer) => layer.parentId === id);
  const setPanel = (node: HTMLElement | null) => {
    internalPanelRef.current = node;
    if (panelRef) panelRef.current = node;
    presence.ref(node);
  };
  const requestBackdropClose = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (dismissible) onRequestClose('backdrop');
  };

  return createPortal(
    <div
      className={className}
      data-v4-layer={kind}
      data-v4-presence={presence.state}
      data-testid={testId}
    >
      {backdropClassName ? (
        <button
          type="button"
          className={backdropClassName}
          aria-label="Close"
          tabIndex={-1}
          disabled={!dismissible}
          data-testid={backdropTestId}
          onClick={requestBackdropClose}
        />
      ) : null}
      <V4ParentLayer id={id}>
        <div
          ref={setPanel}
          className={panelClassName}
          data-v4-unfold="true"
          role={role}
          aria-modal={role ? 'true' : undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          tabIndex={role ? -1 : undefined}
          data-v4-presence={presence.state}
          data-testid={panelTestId}
          inert={hasChild ? true : undefined}
          aria-hidden={hasChild ? true : undefined}
          onTransitionEnd={presence.onTransitionEnd}
          onAnimationEnd={presence.onAnimationEnd}
        >
          {children}
        </div>
      </V4ParentLayer>
    </div>,
    ensureV4OverlayRoot(),
  );
}
