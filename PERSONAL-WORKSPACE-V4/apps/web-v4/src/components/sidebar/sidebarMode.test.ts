/** @vitest-environment jsdom */
/**
 * Sidebar mode persistence tests (pure).
 *
 *   F. Sidebar preference persists locally (V4-owned key, not canonical data).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR_MODE,
  SIDEBAR_MODE_STORAGE_KEY,
  isSidebarMode,
  readStoredSidebarMode,
  writeStoredSidebarMode,
} from './sidebarMode';

describe('sidebarMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to extended when nothing is stored (C)', () => {
    expect(DEFAULT_SIDEBAR_MODE).toBe('extended');
    expect(readStoredSidebarMode(window.localStorage)).toBe('extended');
  });

  it('persists the mode to a V4-owned local key (F)', () => {
    writeStoredSidebarMode(window.localStorage, 'minimal');
    expect(window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY)).toBe('minimal');
    expect(readStoredSidebarMode(window.localStorage)).toBe('minimal');
  });

  it('round-trips extended as well (F)', () => {
    writeStoredSidebarMode(window.localStorage, 'extended');
    expect(readStoredSidebarMode(window.localStorage)).toBe('extended');
  });

  it('isSidebarMode validates only the two known modes', () => {
    expect(isSidebarMode('extended')).toBe(true);
    expect(isSidebarMode('minimal')).toBe(true);
    expect(isSidebarMode('wide')).toBe(false);
    expect(isSidebarMode(undefined)).toBe(false);
  });

  it('falls back to default for an unknown stored value', () => {
    window.localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, 'bogus');
    expect(readStoredSidebarMode(window.localStorage)).toBe('extended');
  });
});
