/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executeHandoff,
  executeImportSourceHandoff,
  executeDocumentSourceHandoff,
  executeManualPickerHandoff,
  integrationStatuses,
} from './integrations';

afterEach(() => {
  delete window.scliDesktop;
});

describe('V4 integration bridge', () => {
  it('reports Desktop unavailable without throwing in browser mode', async () => {
    expect(await integrationStatuses()).toEqual([
      expect.objectContaining({ application: 'AUTOCAD', health: 'DESKTOP_UNAVAILABLE' }),
      expect.objectContaining({ application: 'DIALUX', health: 'DESKTOP_UNAVAILABLE' }),
    ]);
  });

  it('executes only an opaque bounded handoff and returns no local path', async () => {
    const executeDesktopHandoff = vi.fn().mockResolvedValue({ launchRequested: true });
    window.scliDesktop = { executeDesktopHandoff };
    const handoff = {
      handoffId: '11111111-1111-4111-8111-111111111111',
      action: 'TEST_LAUNCH' as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(await executeHandoff(handoff)).toBe(true);
    expect(executeDesktopHandoff).toHaveBeenCalledWith(handoff.handoffId, 'TEST_LAUNCH');
  });

  it('distinguishes a cancelled one-shot manual picker so its context can be closed', async () => {
    window.scliDesktop = {
      executeDesktopHandoff: vi.fn().mockResolvedValue({
        action: 'MANUAL_FILE_PICK',
        accepted: false,
      }),
    };
    expect(
      await executeManualPickerHandoff({
        handoffId: '11111111-1111-4111-8111-111111111111',
        action: 'MANUAL_FILE_PICK',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe('cancelled');
  });

  it('executes only the typed Smart Import source action and preserves cancellation', async () => {
    const executeDesktopHandoff = vi
      .fn()
      .mockResolvedValue({ action: 'SELECT_IMPORT_SOURCE', accepted: false });
    window.scliDesktop = { executeDesktopHandoff };
    const handoff = {
      handoffId: '11111111-1111-4111-8111-111111111111',
      action: 'SELECT_IMPORT_SOURCE' as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(await executeImportSourceHandoff(handoff)).toBe('cancelled');
    expect(executeDesktopHandoff).toHaveBeenCalledWith(handoff.handoffId, 'SELECT_IMPORT_SOURCE');
    expect(await executeImportSourceHandoff({ ...handoff, action: 'MANUAL_FILE_PICK' })).toBe(
      'failed',
    );
  });

  it('executes only an opaque PDF admission handoff and never exposes a selected path', async () => {
    const executeDesktopHandoff = vi.fn().mockResolvedValue({
      action: 'SELECT_DOCUMENT_PDF',
      accepted: true,
    });
    window.scliDesktop = { executeDesktopHandoff };
    const handoff = {
      handoffId: '11111111-1111-4111-8111-111111111111',
      action: 'SELECT_DOCUMENT_PDF' as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(await executeDocumentSourceHandoff(handoff)).toBe('accepted');
    expect(executeDesktopHandoff).toHaveBeenCalledWith(handoff.handoffId, 'SELECT_DOCUMENT_PDF');
    expect(JSON.stringify(executeDesktopHandoff.mock.calls)).not.toMatch(/[A-Z]:\\/i);
  });
});
