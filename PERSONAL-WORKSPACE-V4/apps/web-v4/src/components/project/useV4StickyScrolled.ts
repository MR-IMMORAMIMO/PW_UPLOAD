/**
 * V4 sticky scrolled-state hook (H1-D1).
 *
 * Structural hook for the sticky Project Context Header. It reports whether
 * the page content has scrolled underneath the header so the header can apply
 * a subtle structural divider/edge state (NOT Phase-3 shadow polish).
 *
 * The hook observes the header element's position relative to the viewport:
 * once the header's bottom edge rises above its natural resting position (i.e.
 * content has scrolled under it), `scrolled` becomes true.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';

export interface UseV4StickyScrolledOptions {
  /** How far the header must rise before it is considered "scrolled". */
  threshold?: number;
}

export interface UseV4StickyScrolledResult {
  /** Ref to attach to the sticky header element. */
  ref: RefObject<HTMLElement | null>;
  /** True once page content has scrolled underneath the header. */
  scrolled: boolean;
}

export function useV4StickyScrolled(
  options: UseV4StickyScrolledOptions = {},
): UseV4StickyScrolledResult {
  const { threshold = 1 } = options;
  const ref = useRef<HTMLElement | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      // The header is "scrolled" when its bottom edge has risen above its
      // natural top position by more than the threshold (content slid under).
      setScrolled(rect.top < threshold);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [threshold]);

  return { ref, scrolled };
}
