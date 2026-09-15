/**
 * V4 desktop file-operation bridge.
 *
 * Wraps the existing narrow Electron preload bridge (`window.scliDesktop`) for
 * the Project Files page. Only the exact operations the page needs are exposed:
 *
 *   - pickFile        -> native OS file picker (returns an absolute path or null)
 *   - openFile        -> open a registered path with the OS default application
 *   - revealInFolder  -> reveal/select a registered path in the OS file manager
 *
 * No arbitrary command execution, no unrestricted filesystem read/write, and no
 * raw path is ever executed. The bridge only accepts absolute paths and the
 * desktop main process owns the actual OS call.
 */
export type FileBridgeUnavailableReason = 'bridge-unavailable' | 'invalid-path';

export type FileBridgeResult =
  { ok: true; value: string } | { ok: false; reason: FileBridgeUnavailableReason };

function isAbsolutePath(value: string): boolean {
  // Windows absolute path (C:\... or C:/...) or a rooted POSIX path.
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/');
}

/** Open the native OS file picker. Returns the selected absolute path or null. */
export async function pickWorkingFile(
  filters?: Array<{ name: string; extensions: string[] }>,
): Promise<string | null> {
  const bridge = window.scliDesktop?.selectFile;
  if (!bridge) return null;
  try {
    const selected = await bridge(filters);
    return selected && isAbsolutePath(selected) ? selected : null;
  } catch {
    return null;
  }
}

/** Open a registered working file with the OS default application. */
export async function openRegisteredFile(path: string): Promise<FileBridgeResult> {
  const bridge = window.scliDesktop?.openPath;
  if (!bridge) return { ok: false, reason: 'bridge-unavailable' };
  if (!isAbsolutePath(path)) return { ok: false, reason: 'invalid-path' };
  try {
    const error = await bridge(path);
    return error ? { ok: false, reason: 'invalid-path' } : { ok: true, value: path };
  } catch {
    return { ok: false, reason: 'bridge-unavailable' };
  }
}

/** Reveal/select a registered working file in the OS file manager. */
export async function revealRegisteredFile(path: string): Promise<FileBridgeResult> {
  const bridge = window.scliDesktop?.revealInFolder;
  if (!bridge) return { ok: false, reason: 'bridge-unavailable' };
  if (!isAbsolutePath(path)) return { ok: false, reason: 'invalid-path' };
  try {
    const error = await bridge(path);
    return error ? { ok: false, reason: 'invalid-path' } : { ok: true, value: path };
  } catch {
    return { ok: false, reason: 'bridge-unavailable' };
  }
}

/** Whether the desktop bridge is available at all (for truthful UI states). */
export function hasFileBridge(): boolean {
  return Boolean(window.scliDesktop?.selectFile && window.scliDesktop?.openPath);
}
