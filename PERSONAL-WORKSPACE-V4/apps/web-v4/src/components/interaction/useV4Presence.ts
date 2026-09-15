import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
  type TransitionEvent,
} from 'react';

export type V4PresenceState = 'entering' | 'open' | 'exiting';

const MAX_FALLBACK_MS = 300;

function timeToMs(value: string): number {
  const trimmed = value.trim();
  if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed) || 0;
  if (trimmed.endsWith('s')) return (Number.parseFloat(trimmed) || 0) * 1000;
  return 0;
}

function longestTime(durations: string, delays: string): number {
  const durationList = durations.split(',').map(timeToMs);
  const delayList = delays.split(',').map(timeToMs);
  return durationList.reduce(
    (longest, duration, index) =>
      Math.max(longest, duration + (delayList[index % Math.max(delayList.length, 1)] ?? 0)),
    0,
  );
}

function computedMotionMs(node: HTMLElement | null): number {
  if (!node || typeof window === 'undefined') return 0;
  const style = window.getComputedStyle(node);
  return Math.min(
    MAX_FALLBACK_MS,
    Math.max(
      longestTime(style.transitionDuration, style.transitionDelay),
      longestTime(style.animationDuration, style.animationDelay),
    ),
  );
}

export function useV4Presence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<V4PresenceState>(open ? 'entering' : 'exiting');
  const nodeRef = useRef<HTMLElement | null>(null);
  const generationRef = useRef(0);
  const fallbackRef = useRef<number | null>(null);

  const clearFallback = useCallback(() => {
    if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
    fallbackRef.current = null;
  }, []);

  const finishExit = useCallback(
    (generation = generationRef.current) => {
      if (generation !== generationRef.current) return;
      clearFallback();
      setMounted(false);
    },
    [clearFallback],
  );

  useLayoutEffect(() => {
    const generation = ++generationRef.current;
    clearFallback();
    if (open) {
      setMounted(true);
      setState('entering');
      const firstFrame = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (generation === generationRef.current) setState('open');
        });
      });
      return () => window.cancelAnimationFrame(firstFrame);
    }

    if (!mounted) return undefined;
    setState('exiting');
    return undefined;
  }, [clearFallback, mounted, open]);

  useEffect(() => {
    if (open || !mounted || state !== 'exiting') return undefined;
    const generation = generationRef.current;
    const duration = computedMotionMs(nodeRef.current);
    if (duration === 0) {
      finishExit(generation);
      return undefined;
    }
    fallbackRef.current = window.setTimeout(() => finishExit(generation), duration + 34);
    return clearFallback;
  }, [clearFallback, finishExit, mounted, open, state]);

  useEffect(() => clearFallback, [clearFallback]);

  const ref = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  const onTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLElement>) => {
      if (state === 'exiting' && event.target === nodeRef.current) finishExit();
    },
    [finishExit, state],
  );

  const onAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLElement>) => {
      if (state === 'exiting' && event.target === nodeRef.current) finishExit();
    },
    [finishExit, state],
  );

  return { mounted, state, ref, onTransitionEnd, onAnimationEnd, finishExit };
}
