/**
 * V4SidebarEdgeToggle — floating circular sidebar-edge mode control (H2).
 *
 * Owner-locked geometry:
 *   - visually attached to the Sidebar's RIGHT OUTER EDGE
 *   - approximately HALF inside the Sidebar, HALF protruding outside
 *   - moves with the Sidebar edge during Extended<->Minimal morph
 *   - never fixed to the viewport independently
 *
 * Icons:
 *   Extended -> ChevronLeft
 *   Minimal  -> ChevronRight
 *
 * Visual: a small circular background matching the Sidebar surface color, only
 * slightly larger than the Chevron icon. The VISUAL circle stays small, but the
 * interactive hit area is larger (~32px) so the user does not have to precisely
 * click an 18px icon.
 */
import { ChevronLeft, ChevronRight } from '../common/SctIcons';
import type { SidebarMode } from './sidebarMode';

export interface V4SidebarEdgeToggleProps {
  mode: SidebarMode;
  onToggle: () => void;
}

export function V4SidebarEdgeToggle({ mode, onToggle }: V4SidebarEdgeToggleProps) {
  const isExtended = mode === 'extended';
  const label = isExtended ? 'Collapse sidebar to minimal' : 'Expand sidebar to extended';
  return (
    <button
      type="button"
      className="v4-sidebar-edge-toggle"
      onClick={onToggle}
      aria-label={label}
      title={label}
      data-mode={mode}
    >
      <span className="v4-sidebar-edge-toggle__hit" aria-hidden="true" />
      <span className="v4-sidebar-edge-toggle__circle" aria-hidden="true">
        {isExtended ? (
          <ChevronLeft className="v4-sidebar-edge-toggle__icon" strokeWidth={2} />
        ) : (
          <ChevronRight className="v4-sidebar-edge-toggle__icon" strokeWidth={2} />
        )}
      </span>
    </button>
  );
}
