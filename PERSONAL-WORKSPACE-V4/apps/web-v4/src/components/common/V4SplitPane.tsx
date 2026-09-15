import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useV4InspectorPresence } from '../interaction/V4InspectorPresence';

const DEFAULT_RATIO = 66;
const MIN_TIMELINE_RATIO = 55;
const MIN_INSPECTOR_WIDTH = 320;

export interface V4SplitPaneProps {
  timeline: ReactNode;
  inspector: ReactNode;
  collapsed: boolean;
  label?: string;
  initialRatio?: number;
}

/** A focused, in-memory desktop splitter for owning-page inspector layouts. */
export function V4SplitPane({
  timeline,
  inspector,
  collapsed,
  label = 'Resize timeline and event details',
  initialRatio = DEFAULT_RATIO,
}: V4SplitPaneProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(initialRatio);
  const [dragging, setDragging] = useState(false);
  const [containerWidth, setContainerWidth] = useState(1200);
  const inspectorPresence = useV4InspectorPresence(!collapsed);
  const inspectorCollapsed = !inspectorPresence.mounted;
  const setInspectorPresenceNode = (node: HTMLDivElement | null) => inspectorPresence.ref(node);

  const splitBounds = useMemo(() => {
    const maximum = Math.max(
      MIN_TIMELINE_RATIO,
      100 - (MIN_INSPECTOR_WIDTH / containerWidth) * 100,
    );
    return { min: MIN_TIMELINE_RATIO, max: maximum };
  }, [containerWidth]);
  useEffect(() => {
    const element = paneRef.current;
    if (!element) return undefined;
    const updateWidth = (width: number) => {
      if (width > 0) setContainerWidth(Math.max(width, MIN_INSPECTOR_WIDTH));
    };
    updateWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => updateWidth(element.getBoundingClientRect().width);
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const observer = new ResizeObserver((entries) =>
      updateWidth(entries[0]?.contentRect.width ?? 0),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const clamp = useCallback(
    (value: number) => {
      const { min, max } = splitBounds;
      return Math.min(max, Math.max(min, value));
    },
    [splitBounds],
  );
  const resizeFromPointer = useCallback(
    (clientX: number) => {
      const rect = paneRef.current?.getBoundingClientRect();
      if (!rect?.width) return;
      setRatio(clamp(((clientX - rect.left) / rect.width) * 100));
    },
    [clamp],
  );
  const stopDragging = useCallback((target: HTMLElement, pointerId: number) => {
    setDragging(false);
    try {
      if (target.hasPointerCapture?.(pointerId)) {
        target.releasePointerCapture?.(pointerId);
      }
    } catch {
      // The browser may have already released pointer ownership.
    }
  }, []);

  return (
    <div
      ref={paneRef}
      className={`v4-split-pane${inspectorCollapsed ? ' v4-split-pane--collapsed' : ''}${dragging ? ' v4-split-pane--dragging' : ''}`}
      data-testid="v4-split-pane"
      style={
        {
          '--v4-split-timeline-ratio': `${ratio}fr`,
          '--v4-split-inspector-ratio': `${100 - ratio}fr`,
        } as CSSProperties
      }
    >
      <div className="v4-split-pane__primary">{timeline}</div>
      {inspectorPresence.mounted ? (
        <div
          className="v4-split-pane__separator"
          role="slider"
          aria-orientation="horizontal"
          aria-label={label}
          aria-valuemin={Math.round(splitBounds.min)}
          aria-valuemax={Math.round(splitBounds.max)}
          aria-valuenow={Math.round(ratio)}
          aria-valuetext={`Timeline ${Math.round(ratio)}%, event details ${100 - Math.round(ratio)}%`}
          tabIndex={0}
          onDoubleClick={() => setRatio(DEFAULT_RATIO)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setRatio((current) => clamp(current - 2));
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              setRatio((current) => clamp(current + 2));
            }
            if (event.key === 'Home') {
              event.preventDefault();
              setRatio(splitBounds.min);
            }
            if (event.key === 'End') {
              event.preventDefault();
              setRatio(splitBounds.max);
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDragging(true);
            resizeFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (dragging) resizeFromPointer(event.clientX);
          }}
          onPointerUp={(event) => {
            stopDragging(event.currentTarget, event.pointerId);
          }}
          onPointerCancel={(event) => stopDragging(event.currentTarget, event.pointerId)}
        />
      ) : null}
      {inspectorPresence.mounted ? (
        <div
          ref={setInspectorPresenceNode}
          className="v4-split-pane__inspector v4-inspector-presence"
          data-v4-presence={inspectorPresence.state}
          onTransitionEnd={inspectorPresence.onTransitionEnd}
          onAnimationEnd={inspectorPresence.onAnimationEnd}
        >
          {inspector}
        </div>
      ) : null}
    </div>
  );
}
