import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

export type V4CloseReason = 'escape' | 'backdrop' | 'close-button' | 'action' | 'route-change';
export type V4LayerKind = 'modal' | 'nested-dialog' | 'popover' | 'nonmodal';

type LayerEntry = {
  id: string;
  parentId: string | null;
  kind: V4LayerKind;
  dismissible: boolean;
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  fallbackFocusRef?: RefObject<HTMLElement | null> | undefined;
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
  previousFocus: HTMLElement | null;
  requestClose: (reason: V4CloseReason) => void;
  shouldRestoreFocus: () => boolean;
};

type OverlayContextValue = {
  layers: readonly LayerEntry[];
  register: (entry: Omit<LayerEntry, 'previousFocus'>) => () => void;
  closeTransientLayers: () => void;
};

const OverlayContext = createContext<OverlayContextValue | null>(null);
const ParentLayerContext = createContext<string | null>(null);

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let overlayRoot: HTMLDivElement | null = null;

export function ensureV4OverlayRoot(): HTMLDivElement {
  if (overlayRoot?.isConnected) return overlayRoot;
  const existing = document.getElementById('v4-overlay-root');
  if (existing instanceof HTMLDivElement) {
    overlayRoot = existing;
    return existing;
  }
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'v4-overlay-root';
  overlayRoot.dataset.v4OverlayRoot = '';
  document.body.append(overlayRoot);
  return overlayRoot;
}

function focusableWithin(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute('aria-hidden') !== 'true' &&
      !element.closest('[inert]'),
  );
}

function restoreFocus(entry: LayerEntry, remaining: readonly LayerEntry[]) {
  const explicit = entry.returnFocusRef?.current;
  const previous = entry.previousFocus;
  const stable = entry.fallbackFocusRef?.current;
  const target =
    (explicit?.isConnected ? explicit : null) ??
    (previous?.isConnected ? previous : null) ??
    (stable?.isConnected ? stable : null);
  if (target) target.focus();
  else remaining.at(-1)?.panelRef.current?.focus();
}

export function V4OverlayProvider({ children }: { children: ReactNode }) {
  const [layers, setLayers] = useState<LayerEntry[]>([]);
  const layersRef = useRef(layers);
  const pendingFocusRestoreRef = useRef<LayerEntry | null>(null);

  useLayoutEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useLayoutEffect(() => {
    ensureV4OverlayRoot();
  }, []);

  const register = useCallback((input: Omit<LayerEntry, 'previousFocus'>) => {
    const entry: LayerEntry = {
      ...input,
      previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    setLayers((current) => {
      const next = current.filter((item) => item.id !== entry.id);
      const childIndex = next.findIndex((item) => item.parentId === entry.id);
      if (childIndex < 0) return [...next, entry];
      next.splice(childIndex, 0, entry);
      return next;
    });
    (entry.initialFocusRef?.current ?? entry.panelRef.current)?.focus();
    return () => {
      if (entry.shouldRestoreFocus()) pendingFocusRestoreRef.current = entry;
      setLayers((current) => {
        return current.filter((item) => item.id !== entry.id);
      });
    };
  }, []);

  const closeTransientLayers = useCallback(() => {
    const transient = [...layersRef.current]
      .reverse()
      .find((layer) => layer.kind === 'popover' || layer.kind === 'nonmodal');
    transient?.requestClose('route-change');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const top = layersRef.current.at(-1);
      if (!top) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (top.dismissible) top.requestClose('escape');
        return;
      }
      if (event.key !== 'Tab' || (top.kind !== 'modal' && top.kind !== 'nested-dialog')) return;
      const panel = top.panelRef.current;
      if (!panel) return;
      const focusable = focusableWithin(panel);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (
        event.shiftKey &&
        (document.activeElement === first || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useLayoutEffect(() => {
    const modalCount = layers.filter(
      (layer) => layer.kind === 'modal' || layer.kind === 'nested-dialog',
    ).length;
    if (!modalCount) return undefined;
    const root = ensureV4OverlayRoot();
    const background = Array.from(document.body.children)
      .filter((node) => node !== root)
      .map((node) => ({
        node,
        inert: node.getAttribute('inert'),
        ariaHidden: node.getAttribute('aria-hidden'),
      }));
    for (const { node } of background) {
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    }
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = document.documentElement.clientWidth
      ? Math.max(0, window.innerWidth - document.documentElement.clientWidth)
      : 0;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      for (const { node, inert, ariaHidden } of background) {
        if (inert === null) node.removeAttribute('inert');
        else node.setAttribute('inert', inert);
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      }
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [layers]);

  useLayoutEffect(() => {
    const entry = pendingFocusRestoreRef.current;
    if (!entry) return;
    pendingFocusRestoreRef.current = null;
    restoreFocus(entry, layers);
  }, [layers]);

  const value = useMemo(
    () => ({ layers, register, closeTransientLayers }),
    [closeTransientLayers, layers, register],
  );
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

export function useV4Overlay() {
  const value = useContext(OverlayContext);
  if (!value) throw new Error('V4 interaction surfaces require V4OverlayProvider.');
  return value;
}

export function useV4OverlayOptional() {
  return useContext(OverlayContext);
}

export function useV4ParentLayerId() {
  return useContext(ParentLayerContext);
}

export function V4ParentLayer({ id, children }: { id: string; children: ReactNode }) {
  return <ParentLayerContext.Provider value={id}>{children}</ParentLayerContext.Provider>;
}
