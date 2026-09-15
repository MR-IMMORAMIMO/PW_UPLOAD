/**
 * V4MinimalProjectFlyout — contextual child panel for Minimal Project mode.
 *
 * H13: the child panel is an OVERLAY anchored to the open group's flow-owned
 * subtree lane. The lane (rendered in the Sidebar nav flow) owns the real
 * vertical height of the child stack, so the next primary group follows it
 * naturally. The panel itself extends horizontally over the Main Workspace and
 * is NOT clipped by the 76px rail.
 *
 * Requirements:
 *   - overlay/floating surface; does NOT resize or push main content
 *   - anchored to the open group's subtree lane (not a fixed screen position)
 *   - child rows only; NO parent group title
 *   - rounded contextual surface, restrained elevation
 *   - active child clearly marked
 *   - click is the PRIMARY open behavior (hover only highlights)
 *   - opening another group replaces the previous panel
 *   - clicking a child performs the diagnostic active-section behavior
 *   - clicking outside closes it; Escape closes it
 *   - mode switch / context switch closes it (handled by parent unmount)
 *
 * This remains F2 diagnostic navigation behavior — no product route ownership.
 */
import { useRef, type RefObject } from 'react';
import type { V4NavGroup } from '../navigation/navModel';
import { V4AnchoredSurface } from '../interaction/V4AnchoredSurface';

export interface V4MinimalProjectFlyoutProps {
  group: V4NavGroup;
  activeChildId: string | null;
  /** Vertical offset (px) of the open group's subtree lane relative to the
   *  Sidebar shell. Anchors the overlay panel. */
  top: number | null;
  onSelectChild: (childId: string) => void;
  onClose: () => void;
  /**
   * H10: predicate deciding whether a pointerdown target is one of the Minimal
   * group TRIGGERS. A trigger is NOT an outside click — its own onClick owns
   * the group switch/toggle, so the outside-close handler must ignore them.
   */
  isTrigger?: (target: EventTarget | null) => boolean;
  triggerRef?: RefObject<HTMLElement | null> | undefined;
}

export function V4MinimalProjectFlyout({
  group,
  activeChildId,
  top,
  onSelectChild,
  onClose,
  isTrigger,
  triggerRef,
}: V4MinimalProjectFlyoutProps) {
  const ownerRef = useRef<HTMLElement | null>(null);

  return (
    <V4AnchoredSurface
      open
      id="v4-minimal-flyout"
      className="v4-minimal-flyout"
      role="menu"
      ariaLabel={group.label}
      ownerRef={ownerRef}
      triggerRef={triggerRef}
      onRequestClose={onClose}
      ignoreOutside={isTrigger}
      testId="v4-minimal-flyout"
      dataGroupId={group.id}
      style={{ top: top ?? 0 }}
    >
      <div className="v4-minimal-flyout__items">
        {group.items.map((item) => {
          const active = item.id === activeChildId;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-child-id={item.id}
              disabled={item.disabled}
              className={
                active
                  ? 'v4-minimal-flyout__item v4-minimal-flyout__item--active v4-active-child'
                  : 'v4-minimal-flyout__item'
              }
              aria-current={active ? 'page' : undefined}
              onClick={() => onSelectChild(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </V4AnchoredSurface>
  );
}
