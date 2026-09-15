import { describe, expect, it } from 'vitest';
import { LuminaireDatasheetSemanticExtractionService } from '../LuminaireDatasheetSemanticExtractionService';
import type { ExtractedPdfPage } from '../PdfExtractionAdapter';
import { ERCO_LAYOUT_FIXTURES } from './ErcoLayoutFixture';

const service = new LuminaireDatasheetSemanticExtractionService();

function extract(lines: readonly string[]) {
  const text = lines.join('\n');
  const page: ExtractedPdfPage = {
    pageNumber: 1,
    text,
    usableTextCharacters: text.replace(/\s+/g, '').length,
    needsOcr: false,
  };
  return service.extract([page], new Map([[1, 'NATIVE_TEXT']]));
}

describe('synthetic ERCO-layout fixtures', () => {
  for (const fixture of ERCO_LAYOUT_FIXTURES) {
    it(`fixture ${fixture.key}: ${fixture.description}`, () => {
      const values = extract(fixture.lines);
      const actual = values.map((item) => ({
        field: item.canonicalField,
        value: item.normalizedValue,
        unit: item.unit,
      }));
      // Each expected value must be present (the fixture may also emit
      // supporting evidence such as MANUFACTURER from the brand signature).
      for (const expected of fixture.expected) {
        expect(actual).toContainEqual({
          field: expected.field,
          value: expected.value,
          unit: expected.unit ?? null,
        });
      }
    });
  }

  it('does not activate the ERCO adapter from a single weak signature', () => {
    const values = extract(['Fresnel lens wide flood']);
    expect(values.some((item) => item.canonicalField === 'LIGHT_DISTRIBUTION')).toBe(false);
  });

  it('does not activate the ERCO adapter from filename or manufacturer alone', () => {
    const values = extract(['Manufacturer: ERCO']);
    expect(values.some((item) => item.canonicalField === 'LIGHT_DISTRIBUTION')).toBe(false);
  });
});
