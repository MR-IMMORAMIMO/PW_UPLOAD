import { createPortal } from 'react-dom';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { useV4Presence } from './useV4Presence';
import {
  V4OverlayProvider,
  useV4Overlay,
  useV4OverlayOptional,
  useV4ParentLayerId,
} from './V4OverlayProvider';

export interface V4AnchoredSurfaceProps {
  open: boolean;
  anchorToTrigger?: boolean;
  onRequestClose: () => void;
  ownerRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null> | undefined;
  className: string;
  children: ReactNode;
  id?: string | undefined;
  role?: string | undefined;
  ariaLabel?: string | undefined;
  style?: CSSProperties | undefined;
  returnFocus?: boolean;
  ignoreOutside?: ((target: EventTarget | null) => boolean) | undefined;
  testId?: string | undefined;
  dataGroupId?: string | undefined;
  dataState?: string | undefined;
  ariaModal?: boolean | undefined;
}

export function V4AnchoredSurface({ ...props }: V4AnchoredSurfaceProps) {
  const overlay = useV4OverlayOptional();
  if (!overlay) {
    return (
      <V4OverlayProvider>
        <V4AnchoredSurfaceInner {...props} />
      </V4OverlayProvider>
    );
  }
  return <V4AnchoredSurfaceInner {...props} />;
}

function V4AnchoredSurfaceInner({
  open,
  anchorToTrigger = false,
  onRequestClose,
  ownerRef,
  triggerRef,
  className,
  children,
  id: explicitId,
  role,
  ariaLabel,
  style,
  returnFocus = true,
  ignoreOutside,
  testId,
  dataGroupId,
  dataState,
  ariaModal,
}: V4AnchoredSurfaceProps) {
  const generatedId = useId();
  const id = explicitId ?? generatedId;
  const parentId = useV4ParentLayerId();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const onRequestCloseRef = useRef(onRequestClose);
  const { register } = useV4Overlay();
  const presence = useV4Presence(open);
  const [position, setPosition] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!presence.mounted || !anchorToTrigger) return;
    const update = () => {
      const trigger = triggerRef?.current ?? ownerRef.current;
      const anchor = trigger?.getBoundingClientRect();
      const panel = surfaceRef.current;
      if (!anchor || !panel) return;
      // A portaled listbox loses its modal's stacking context. Keep it immediately
      // above its owning layer; page popovers must still remain below unrelated modals.
      const ownerLayer = trigger?.closest<HTMLElement>('[data-v4-layer]');
      const ownerZ = ownerLayer
        ? Number.parseInt(window.getComputedStyle(ownerLayer).zIndex, 10)
        : NaN;
      const width = Math.min(Math.max(anchor.width, 176), 280, window.innerWidth - 24);
      const below = window.innerHeight - anchor.bottom - 18;
      const above = anchor.top - 18;
      const up = below < Math.min(panel.scrollHeight, 248) && above > below;
      const height = Math.max(40, Math.min(248, up ? above : below));
      setPosition({
        position: 'fixed',
        zIndex: Number.isFinite(ownerZ) ? ownerZ + 1 : undefined,
        width,
        minWidth: width,
        maxWidth: width,
        maxHeight: height,
        left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)),
        top: up
          ? Math.max(12, anchor.top - Math.min(panel.scrollHeight, height) - 6)
          : anchor.bottom + 6,
        bottom: 'auto',
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [presence.mounted, anchorToTrigger, triggerRef, ownerRef]);

  useLayoutEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (!presence.mounted) return undefined;
    return register({
      id,
      parentId,
      kind: 'popover',
      dismissible: true,
      panelRef: surfaceRef,
      returnFocusRef: returnFocus ? triggerRef : undefined,
      requestClose: () => onRequestCloseRef.current(),
      shouldRestoreFocus: () => returnFocus,
    });
  }, [id, parentId, presence.mounted, register, returnFocus, triggerRef]);

  useEffect(() => {
    if (!presence.mounted) return undefined;
    const closeFromOutside = (event: PointerEvent) => {
      if (ignoreOutside?.(event.target)) return;
      const target = event.target as Node;
      if (!ownerRef.current?.contains(target) && !surfaceRef.current?.contains(target)) {
        onRequestCloseRef.current();
      }
    };
    window.addEventListener('pointerdown', closeFromOutside);
    return () => window.removeEventListener('pointerdown', closeFromOutside);
  }, [ignoreOutside, ownerRef, presence.mounted]);

  if (!presence.mounted) return null;
  const setSurface = (node: HTMLDivElement | null) => {
    surfaceRef.current = node;
    presence.ref(node);
  };
  const content = (
    <div
      ref={setSurface}
      id={id}
      className={className}
      role={role}
      aria-label={ariaLabel}
      style={{ ...style, ...position }}
      data-v4-layer="popover"
      data-v4-presence={presence.state}
      data-testid={testId}
      data-group-id={dataGroupId}
      data-state={dataState}
      aria-modal={ariaModal}
      onTransitionEnd={presence.onTransitionEnd}
      onAnimationEnd={presence.onAnimationEnd}
    >
      {children}
    </div>
  );
  return anchorToTrigger
    ? createPortal(content, document.getElementById('v4-overlay-root') ?? document.body)
    : content;
}
