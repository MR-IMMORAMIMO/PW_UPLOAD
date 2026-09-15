/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasFileBridge, openRegisteredFile, pickWorkingFile, revealRegisteredFile } from './files';

function installBridge(overrides: Partial<Window['scliDesktop']> = {}) {
  window.scliDesktop = {
    selectFile: vi.fn().mockResolvedValue('C:\\Projects\\L-101.dwg'),
    openPath: vi.fn().mockResolvedValue(''),
    revealInFolder: vi.fn().mockResolvedValue(''),
    ...overrides,
  };
}

afterEach(() => {
  delete window.scliDesktop;
  vi.restoreAllMocks();
});

describe('desktop files bridge', () => {
  it('pickWorkingFile returns the selected absolute path', async () => {
    installBridge();
    const selected = await pickWorkingFile();
    expect(selected).toBe('C:\\Projects\\L-101.dwg');
  });

  it('pickWorkingFile returns null when the user cancels or the bridge is absent', async () => {
    installBridge({ selectFile: vi.fn().mockResolvedValue(null) });
    expect(await pickWorkingFile()).toBeNull();
    delete window.scliDesktop;
    expect(await pickWorkingFile()).toBeNull();
  });

  it('openRegisteredFile invokes only the registered resolved path', async () => {
    const openPath = vi.fn().mockResolvedValue('');
    installBridge({ openPath });
    const result = await openRegisteredFile('C:\\Projects\\L-101.dwg');
    expect(result.ok).toBe(true);
    expect(openPath).toHaveBeenCalledWith('C:\\Projects\\L-101.dwg');
  });

  it('openRegisteredFile rejects non-absolute paths without invoking the bridge', async () => {
    const openPath = vi.fn();
    installBridge({ openPath });
    const result = await openRegisteredFile('relative/path.dwg');
    expect(result.ok).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('revealRegisteredFile invokes only the registered resolved path', async () => {
    const revealInFolder = vi.fn().mockResolvedValue('');
    installBridge({ revealInFolder });
    const result = await revealRegisteredFile('C:\\Projects\\L-101.dwg');
    expect(result.ok).toBe(true);
    expect(revealInFolder).toHaveBeenCalledWith('C:\\Projects\\L-101.dwg');
  });

  it('revealRegisteredFile rejects non-absolute paths without invoking the bridge', async () => {
    const revealInFolder = vi.fn();
    installBridge({ revealInFolder });
    const result = await revealRegisteredFile('relative/path.dwg');
    expect(result.ok).toBe(false);
    expect(revealInFolder).not.toHaveBeenCalled();
  });

  it('reports bridge-unavailable when the desktop bridge is missing', async () => {
    delete window.scliDesktop;
    expect(await openRegisteredFile('C:\\a.dwg')).toEqual({
      ok: false,
      reason: 'bridge-unavailable',
    });
    expect(await revealRegisteredFile('C:\\a.dwg')).toEqual({
      ok: false,
      reason: 'bridge-unavailable',
    });
    expect(hasFileBridge()).toBe(false);
  });

  it('hasFileBridge is true only when the required methods exist', () => {
    installBridge();
    expect(hasFileBridge()).toBe(true);
    installBridge();
    delete window.scliDesktop?.openPath;
    expect(hasFileBridge()).toBe(false);
  });
});
