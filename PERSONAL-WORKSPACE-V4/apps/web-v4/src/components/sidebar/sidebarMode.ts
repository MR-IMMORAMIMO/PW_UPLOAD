/**
 * V4 sidebar presentation-mode persistence.
 *
 * The Extended/Minimal sidebar mode is a LOCAL presentation preference and is
 * NEVER persisted in project canonical data (owner-locked). Storage key is
 * V4-owned: `scli.v4.sidebar.mode`.
 */
export const SIDEBAR_MODE_STORAGE_KEY = 'scli.v4.sidebar.mode';

export type SidebarMode = 'extended' | 'minimal';

export function isSidebarMode(value: unknown): value is SidebarMode {
  return value === 'extended' || value === 'minimal';
}

/** Default presentation mode when nothing has been stored. */
export const DEFAULT_SIDEBAR_MODE: SidebarMode = 'extended';

/** Read the stored sidebar mode (safe when storage is unavailable). */
export function readStoredSidebarMode(storage: Pick<Storage, 'getItem'>): SidebarMode {
  try {
    const stored = storage.getItem(SIDEBAR_MODE_STORAGE_KEY);
    return isSidebarMode(stored) ? stored : DEFAULT_SIDEBAR_MODE;
  } catch {
    return DEFAULT_SIDEBAR_MODE;
  }
}

/** Persist the sidebar mode (safe when storage is unavailable). */
export function writeStoredSidebarMode(storage: Pick<Storage, 'setItem'>, mode: SidebarMode): void {
  try {
    storage.setItem(SIDEBAR_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable — the in-memory mode still applies this session.
  }
}
