/**
 * V4 project navigation group-state tests (pure).
 *
 *   H1: active group auto-opens; non-exclusive expansion; collapsing one does
 *       not collapse another; active group cannot remain hidden.
 */
import { describe, expect, it } from 'vitest';
import { PROJECT_NAV_GROUPS } from '../navigation/navModel';
import {
  ensureActiveGroupOpen,
  groupIdForItem,
  initialGroupState,
  toggleGroup,
} from './groupState';

describe('groupState', () => {
  it('groupIdForItem resolves the group containing an item', () => {
    expect(groupIdForItem(PROJECT_NAV_GROUPS, 'actions')).toBe('coordination');
    expect(groupIdForItem(PROJECT_NAV_GROUPS, 'summary')).toBe('overview');
    expect(groupIdForItem(PROJECT_NAV_GROUPS, 'files')).toBe('files-history');
    expect(groupIdForItem(PROJECT_NAV_GROUPS, 'unknown')).toBeNull();
    expect(groupIdForItem(PROJECT_NAV_GROUPS, null)).toBeNull();
  });

  it('initialGroupState opens only the active group (auto-open)', () => {
    const state = initialGroupState(PROJECT_NAV_GROUPS, 'actions');
    expect(state.coordination).toBe(true);
    expect(state.overview).toBe(false);
    expect(state['technical-workspace']).toBe(false);
  });

  it('initialGroupState collapses all groups when no active item', () => {
    const state = initialGroupState(PROJECT_NAV_GROUPS, null);
    for (const group of PROJECT_NAV_GROUPS) expect(state[group.id]).toBe(false);
  });

  it('toggleGroup is non-exclusive and independent', () => {
    const base = initialGroupState(PROJECT_NAV_GROUPS, 'actions');
    const withOverview = toggleGroup(base, 'overview');
    expect(withOverview.overview).toBe(true);
    expect(withOverview.coordination).toBe(true); // untouched
    const collapsed = toggleGroup(withOverview, 'overview');
    expect(collapsed.overview).toBe(false);
    expect(collapsed.coordination).toBe(true); // still open
  });

  it('ensureActiveGroupOpen reopens the active group when it was collapsed', () => {
    const allClosed = initialGroupState(PROJECT_NAV_GROUPS, null);
    const reopened = ensureActiveGroupOpen(allClosed, PROJECT_NAV_GROUPS, 'luminaires');
    expect(reopened['technical-workspace']).toBe(true);
  });

  it('ensureActiveGroupOpen is a no-op when the active group is already open', () => {
    const state = initialGroupState(PROJECT_NAV_GROUPS, 'actions');
    expect(ensureActiveGroupOpen(state, PROJECT_NAV_GROUPS, 'actions')).toBe(state);
  });
});
