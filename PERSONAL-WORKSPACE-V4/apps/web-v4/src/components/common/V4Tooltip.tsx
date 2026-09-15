/**
 * V4Tooltip — smallest V4-local tooltip for icon-only navigation.
 *
 * Owner-locked minimal tooltip grammar (H1-D1):
 *   - consistent tooltip for icon-only navigation
 *   - small intentional delay (~400ms) before showing
 *   - avoids tooltip spam during rapid pointer movement (immediate hide)
 *   - accessible aria-label remains present on the trigger regardless of the
 *     tooltip (the tooltip is a visual enhancement, never the only label)
 *
 * This is intentionally a tiny structural component — NOT a tooltip framework.
 * The bubble is positioned to the right of the trigger (the minimal rail is
 * icon-only, so the label appears beside the icon).
 */
import { useRef, useState, type ReactNode } from 'react';

export const V4_TOOLTIP_DELAY_MS = 400;

export interface V4TooltipProps {
  /** The accessible label shown in the bubble. */
  label: string;
  children: ReactNode;
}

export function V4Tooltip({ label, children }: V4TooltipProps) {
  const [visible, setVisible] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => setVisible(true), V4_TOOLTIP_DELAY_MS);
  };

  const hide = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = null;
    setVisible(false);
  };

  return (
    <span
      className="v4-tooltip"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible ? (
        <span className="v4-tooltip__bubble" role="tooltip">
          {label}
        </span>
      ) : null}
    </span>
  );
}
