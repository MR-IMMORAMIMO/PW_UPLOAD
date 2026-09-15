import { describe, expect, it, vi } from 'vitest';
import { defaultDeliveryDate, draftFromPreset, parseCommercialValue } from './newProjectModel';

describe('newProjectModel', () => {
  it('converts decimal commercial value to safe minor units and enforces the atomic pair', () => {
    expect(parseCommercialValue('2500.75', 'aed')).toEqual({
      ok: true,
      value: { commercialValueMinor: 250075, commercialCurrency: 'AED' },
    });
    expect(parseCommercialValue('2500', '').ok).toBe(false);
    expect(parseCommercialValue('', 'AED').ok).toBe(false);
  });

  it('uses Dubai date-only semantics for the default delivery date', () => {
    expect(defaultDeliveryDate(new Date('2026-08-17T21:00:00Z'))).toBe('2026-09-01');
  });

  it('materializes a canonical folder draft from a real profile', () => {
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValueOnce('a').mockReturnValueOnce('b'),
    });
    const draft = draftFromPreset({
      name: 'Test',
      description: '',
      builtIn: true,
      folders: [{ name: 'Design', children: [{ name: 'Drawings', children: [] }] }],
      outputFolders: {
        scheduleExcel: 'Design/Drawings',
        schedulePdf: '',
        boqExcel: '',
        boqPdf: '',
        datasheets: '',
      },
    });
    expect(draft.folders).toHaveLength(2);
    expect(draft.outputMappings).toEqual([
      { outputTypeId: 'scheduleExcel', destinationDraftFolderId: 'b' },
    ]);
    vi.unstubAllGlobals();
  });
});
