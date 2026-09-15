/**
 * V4 active-navigation lighting-motion structural hook.
 *
 * Architectural-lighting-inspired active-nav motion (owner-locked):
 *
 *   select nav item -> ONE restrained perimeter light sweep (~600-900ms)
 *   -> settle into calm stable active state.
 *
 * F2 implementation level (per prompt §16):
 *   - A dedicated structural effect layer/hook so Phase-3 styling can be tuned
 *     WITHOUT restructuring nav markup.
 *   - ONE SHOT only; no continuous loop, no gaming RGB, no large glow.
 *   - `prefers-reduced-motion` disables the traveling sweep and shows the
 *     stable active state immediately (prompt §17).
 *
 * The hook exposes:
 *   - `activeId` (which item is active)
 *   - `select(id)` (choose an item, triggering one sweep)
 *   - `sweepKey` (increments on each new selection; drives a single CSS
 *     animation that resets per key)
 *   - `motionEnabled` (false when reduced-motion is active -> stable state)
 *
 * The concrete sweep VISUAL is intentionally restrained in F2. The final
 * colors/glow/easing are Phase-3 polish; the markup + hook contract is the F2
 * deliverable.
 */
import { useCallback, useMemo, useState } from 'react';
import { useV4Theme } from '../../theme/ThemeProvider';

export interface UseV4NavMotionOptions {
  /** Initially active item id (e.g. from a diagnostic query param). */
  initialActiveId?: string | null;
}

export interface UseV4NavMotionResult {
  /** Currently active nav item id. */
  activeId: string | null;
  /**
   * Increments on each selection. Used as a React `key` so the single sweep
   * CSS animation restarts cleanly. Null when reduced-motion is on.
   */
  sweepKey: number | null;
  /** False when the user has requested reduced motion. */
  motionEnabled: boolean;
  /** Select an item (no-op when it is already active). */
  select: (id: string) => void;
}

export function useV4NavMotion(options: UseV4NavMotionOptions = {}): UseV4NavMotionResult {
  const { reducedMotion } = useV4Theme();
  const [activeId, setActiveId] = useState<string | null>(options.initialActiveId ?? null);
  const [sweepCount, setSweepCount] = useState(0);

  const motionEnabled = !reducedMotion;

  const select = useCallback((id: string) => {
    setActiveId((current) => {
      if (current === id) return current;
      setSweepCount((count) => count + 1);
      return id;
    });
  }, []);

  // Only emit a sweep key when motion is enabled. Under reduced motion the
  // active state appears immediately with no traveling sweep.
  const sweepKey = useMemo(() => (motionEnabled ? sweepCount : null), [motionEnabled, sweepCount]);

  return { activeId, sweepKey, motionEnabled, select };
}
