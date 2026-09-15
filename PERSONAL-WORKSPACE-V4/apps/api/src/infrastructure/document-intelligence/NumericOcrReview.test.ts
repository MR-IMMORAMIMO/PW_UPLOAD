import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import {
  compareNumericReadings,
  enlargedNumberCrop,
  numericReviewTargets,
} from './NumericOcrReview';
import { LuminaireDatasheetSemanticExtractionService } from './LuminaireDatasheetSemanticExtractionService';
const region = { x: 100, y: 20, width: 40, height: 20 };
describe('independent numeric OCR review', () => {
  it.each([
    ['134', '13.4', 'DISAGREE'],
    ['134', '134', 'AGREE'],
    ['13,4', '13.4', 'AGREE'],
    ['47', '', 'UNREADABLE'],
    ['23', '2 3', 'UNREADABLE'],
  ])('reports %s vs %s without guessing', (a, b, status) => {
    expect(compareNumericReadings(a!, b!, region)).toMatchObject({
      primary: a,
      secondary: b,
      status,
    });
  });
  it('only schedules bounded numeric cells beside a technical label', () => {
    const words = [
      { text: 'Power', confidence: 90, bbox: { ...region, x: 10 } },
      { text: '134', confidence: 96, bbox: region },
      { text: '999', confidence: 99, bbox: { ...region, y: 500 } },
    ];
    expect(numericReviewTargets(words).map((w) => w.text)).toEqual(['134']);
  });
  it('enlarges original pixels and rejects invalid crop bounds', () => {
    const png = new PNG({ width: 200, height: 100 });
    png.data.fill(255);
    expect(PNG.sync.read(enlargedNumberCrop(png, region)).width).toBe(168);
    expect(() => enlargedNumberCrop(png, { ...region, x: NaN })).toThrow('CROP_LIMIT');
    expect(() => enlargedNumberCrop(png, { ...region, x: 201 })).toThrow('CROP_LIMIT');
  });
  it.each(['134', '13.4'])(
    'never promotes agreement or disagreement to a certified value (%s)',
    (secondary) => {
      const text = 'System power: 134 W';
      const values = new LuminaireDatasheetSemanticExtractionService().extract(
        [
          {
            pageNumber: 1,
            text,
            needsOcr: false,
            usableTextCharacters: text.length,
            ocrRegions: [{ text, confidence: 99, region: { x: 0, y: 20, width: 200, height: 20 } }],
            ocrNumericReviews: [compareNumericReadings('134', secondary, region)],
          },
        ],
        new Map([[1, 'OCR']]),
      );
      const power = values.find((v) => v.canonicalField === 'SYSTEM_POWER');
      expect(power?.normalizedValue).toBe(134);
      expect(power?.confidence).toBeLessThan(85);
      expect(power?.warnings.some((w) => w.startsWith('OCR_SECOND_READING:'))).toBe(true);
    },
  );
});

it('does not locate 134 at an unrelated 1 or 23 inside 123', () => {
  for (const primary of ['134', '23']) {
    const text = `System power (W) ${primary}`;
    const values = new LuminaireDatasheetSemanticExtractionService().extract(
      [
        {
          pageNumber: 1,
          text,
          needsOcr: false,
          usableTextCharacters: text.length,
          ocrRegions: [
            {
              text: primary === '134' ? '1' : '123',
              confidence: 99,
              region: { x: 0, y: 0, width: 40, height: 20 },
            },
            { text: primary, confidence: 96, region },
          ],
          ocrNumericReviews: [
            compareNumericReadings(primary, primary === '134' ? '13.4' : '2.3', region),
          ],
        },
      ],
      new Map([[1, 'OCR']]),
    );
    const power = values.find((v) => v.canonicalField === 'SYSTEM_POWER');
    expect(power?.region).toEqual(region);
    expect(power?.warnings).toContain(
      `OCR_SECOND_READING:DISAGREE:${primary}:${primary === '134' ? '13.4' : '2.3'}`,
    );
  }
});
