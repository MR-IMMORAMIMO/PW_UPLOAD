/**
 * V4 project navigation group expand/collapse state (pure, framework-agnostic).
 *
 * Owner-locked H1 behavior:
 *   - each group header is independently expandable/collapsible
 *   - NOT an exclusive accordion — multiple groups MAY be open
 *   - collapsing one must not force another closed
 *   - the group containing the ACTIVE section auto-opens
 *   - the active item must never be hidden after active-section change
 *
 * Group state is presentation-only and is NOT persisted in canonical data.
 */
import type { V4NavGroup } from '../navigation/navModel';

/** groupId -> open (true) / collapsed (false). */
export type V4GroupState = Record<string, boolean>;

/** The group id that contains a given nav item id, or null. */
export function groupIdForItem(groups: V4NavGroup[], itemId: string | null): string | null {
  if (!itemId) return null;
  for (const group of groups) {
    if (group.items.some((item) => item.id === itemId)) return group.id;
  }
  return null;
}

/**
 * Build the initial group state: every group collapsed EXCEPT the group that
 * contains the active item (which auto-opens).
 */
export function initialGroupState(groups: V4NavGroup[], activeItemId: string | null): V4GroupState {
  const activeGroup = groupIdForItem(groups, activeItemId);
  const state: V4GroupState = {};
  for (const group of groups) state[group.id] = group.id === activeGroup;
  return state;
}

/**
 * Toggle one group open/closed (non-exclusive). Other groups are untouched.
 */
export function toggleGroup(state: V4GroupState, groupId: string): V4GroupState {
  return { ...state, [groupId]: !state[groupId] };
}

/**
 * Ensure the group containing the active item is open. Returns a new state
 * when a change is needed, otherwise the same reference.
 */
export function ensureActiveGroupOpen(
  state: V4GroupState,
  groups: V4NavGroup[],
  activeItemId: string | null,
): V4GroupState {
  const activeGroup = groupIdForItem(groups, activeItemId);
  if (!activeGroup) return state;
  if (state[activeGroup]) return state;
  return { ...state, [activeGroup]: true };
}
