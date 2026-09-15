import { describe, expect, it } from 'vitest';
import { legacyDatasheetAdoptionSchema } from './personal';

describe('legacyDatasheetAdoptionSchema', () => {
  it('accepts stable IDs only and rejects renderer-supplied filesystem authority', () => {
    const item = {
      luminaireId: '10000000-0000-4000-8000-000000000001',
      assetVersionId: '20000000-0000-4000-8000-000000000001',
    };
    expect(legacyDatasheetAdoptionSchema.parse({ items: [item] })).toEqual({ items: [item] });
    expect(
      legacyDatasheetAdoptionSchema.safeParse({
        items: [{ ...item, filePath: 'C:\\arbitrary\\outside.pdf' }],
      }).success,
    ).toBe(false);
  });
});
