import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useBlocker, useLocation } from 'react-router-dom';
import { useV4Overlay } from './V4OverlayProvider';

type DirtyReason = 'route-change' | 'desktop-close';
type DirtyEntry = {
  id: string;
  requestDiscard: (reason: DirtyReason, proceed: () => void, cancel: () => void) => void;
};

type DirtyContextValue = {
  register: (entry: DirtyEntry) => () => void;
};

const DirtyContext = createContext<DirtyContextValue | null>(null);

export function V4DirtyGuardProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<DirtyEntry[]>([]);
  const entriesRef = useRef(entries);
  const handledBlockerRef = useRef<string | null>(null);
  const location = useLocation();
  const { closeTransientLayers } = useV4Overlay();
  const blocker = useBlocker(entries.length > 0);

  useLayoutEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const register = useCallback((entry: DirtyEntry) => {
    setEntries((current) => [...current.filter((item) => item.id !== entry.id), entry]);
    return () => setEntries((current) => current.filter((item) => item.id !== entry.id));
  }, []);

  const requestTop = useCallback(
    (reason: DirtyReason, proceed: () => void, cancel: () => void = () => undefined) => {
      const entry = entriesRef.current.at(-1);
      if (!entry) {
        proceed();
        return;
      }
      entry.requestDiscard(reason, proceed, cancel);
    },
    [],
  );

  useEffect(() => {
    closeTransientLayers();
  }, [closeTransientLayers, location.key]);

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      handledBlockerRef.current = null;
      return;
    }
    if (handledBlockerRef.current === blocker.location.key) return;
    handledBlockerRef.current = blocker.location.key;
    requestTop(
      'route-change',
      () => {
        closeTransientLayers();
        blocker.proceed();
      },
      () => blocker.reset(),
    );
  }, [blocker, closeTransientLayers, requestTop]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!entriesRef.current.length) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    const desktop = window.scliDesktop;
    if (!desktop?.onCloseRequested || !desktop.respondToClose) return undefined;
    return desktop.onCloseRequested(() => {
      requestTop(
        'desktop-close',
        () => desktop.respondToClose?.(true),
        () => desktop.respondToClose?.(false),
      );
    });
  }, [requestTop]);

  const value = useMemo(() => ({ register }), [register]);
  return <DirtyContext.Provider value={value}>{children}</DirtyContext.Provider>;
}

export function useV4DirtySurface(
  active: boolean,
  requestDiscard: (reason: DirtyReason, proceed: () => void, cancel: () => void) => void,
) {
  const id = useId();
  const context = useContext(DirtyContext);
  const requestRef = useRef(requestDiscard);
  useLayoutEffect(() => {
    requestRef.current = requestDiscard;
  }, [requestDiscard]);
  useEffect(() => {
    if (!active || !context) return undefined;
    return context.register({
      id,
      requestDiscard: (reason, proceed, cancel) => requestRef.current(reason, proceed, cancel),
    });
  }, [active, context, id]);
}
