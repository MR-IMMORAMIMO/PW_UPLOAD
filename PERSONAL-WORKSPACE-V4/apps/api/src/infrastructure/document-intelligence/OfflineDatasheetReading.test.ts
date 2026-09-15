import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { LuminaireDatasheetSemanticExtractionService } from './LuminaireDatasheetSemanticExtractionService';
import { assessNativeTextQuality } from './NativeTextQualityGate';
import { prepareOcrImage } from './OcrImagePreparation';

function extract(texts: string[], ocr = false) {
  return new LuminaireDatasheetSemanticExtractionService().extract(
    texts.map((text, index) => ({
      pageNumber: index + 1,
      text,
      needsOcr: false,
      usableTextCharacters: text.length,
      ocrRegions: text.split('\n').map((line, y) => ({
        text: line,
        confidence: 98,
        region: { x: 0, y: y * 20, width: 300, height: 20 },
      })),
    })),
    new Map(texts.map((_, index) => [index + 1, ocr ? 'OCR' : 'NATIVE_TEXT'])),
  );
}

describe('offline printed datasheet reading', () => {
  it('keeps intact native specifications despite a long letter-spaced footer', () => {
    const footer = 'Technical information subject to change without prior notice '
      .repeat(20)
      .split('')
      .join(' ');
    expect(
      assessNativeTextQuality(
        `${footer}\nManufacturer: Example Lighting\nSystem power: 14.5 W\nLumen output: 897 lm\nLight distribution: Symmetric\nColour: Anthracite`,
      ).decision,
    ).toBe('NATIVE_GOOD');
    expect(assessNativeTextQuality(footer).decision).toBe('OCR_REQUIRED');
  });
  it('darkens faint gray labels without changing geometry or transparent backgrounds', () => {
    const png = new PNG({ width: 2, height: 1 });
    png.data.set([210, 210, 210, 255, 0, 0, 0, 0]);
    const prepared = PNG.sync.read(prepareOcrImage(PNG.sync.write(png)));
    expect([prepared.width, prepared.height]).toEqual([2, 1]);
    expect([...prepared.data]).toEqual([30, 30, 30, 255, 255, 255, 255, 255]);
  });
  it('reads full flux values and distinct source/system values from FLOS labels', () => {
    const values = extract([
      'professional.flos.com\nMain specifications\nPower (W) 15\nSystem power (W) 14.5\nSource flux (lm) 1200\nLumen Output (lm) 897\nIP internal 66',
    ]);
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalField: 'LED_POWER', normalizedValue: 15 }),
        expect.objectContaining({ canonicalField: 'SYSTEM_POWER', normalizedValue: 14.5 }),
        expect.objectContaining({ canonicalField: 'LUMINAIRE_FLUX', normalizedValue: 897 }),
        expect.objectContaining({ canonicalField: 'LED_FLUX', normalizedValue: 1200 }),
        expect.objectContaining({ canonicalField: 'IP_RATING', normalizedValue: 'IP66' }),
      ]),
    );
    expect(values.find((item) => item.canonicalField === 'SYSTEM_POWER')?.warnings).toContain(
      'SOURCE_POWER_EXCEEDS_SYSTEM_POWER',
    );
    expect(values.find((item) => item.canonicalField === 'SYSTEM_POWER')?.confidence).toBeLessThan(
      85,
    );
  });
  it('never imports accessories or replacement instructions as the product identity or driver', () => {
    const values = extract([
      'Manufacturer: Example\nOrdering Code: X100\nSystem Power: 15 W\nColour deviation 1.5 SDCM\nDimming range 1%-100%\ngear by a professional',
      'Accessories & Power Supply\nOrdering Code: Z900\nSystem Power: 90 W\nIP rating: IP68',
    ]);
    expect(
      values
        .filter((v) => ['ORDERING_CODE', 'SYSTEM_POWER'].includes(v.canonicalField))
        .map((v) => v.normalizedValue),
    ).toEqual(['X100', 15]);
    expect(
      values.some((v) => ['BODY_COLOR', 'DRIVER', 'DIMMING_METHOD'].includes(v.canonicalField)),
    ).toBe(false);
  });
  it('keeps a high-confidence OCR integer requiring review instead of guessing a missing decimal', () => {
    const values = extract(['System Power: 134 W\nOrdering Code: X100'], true);
    expect(values.find((v) => v.canonicalField === 'SYSTEM_POWER')).toMatchObject({
      normalizedValue: 134,
      confidence: 75,
    });
    expect(values.every((v) => v.confidence < 85)).toBe(true);
    expect(values[0]?.warnings).toContain('OCR_VALUE_REQUIRES_VISUAL_REVIEW');
  });
  it('preserves catalogue row identity and never borrows merged power or assumes flux basis', () => {
    const values = extract([
      '# Color Lumen LED Watt Power Beam\nX.100.01 3000K warm white 135 lm\n1 LED total 2 W CC 350 mA 10° spot\nX.100.02 6000K cold white 165 lm',
    ]);
    expect(
      values
        .filter((v) => v.canonicalField === 'CCT')
        .map((v) => [v.normalizedValue, v.warnings.find((w) => w.startsWith('PRODUCT_ROW:'))]),
    ).toEqual([
      [3000, 'PRODUCT_ROW:X.100.01'],
      [6000, 'PRODUCT_ROW:X.100.02'],
    ]);
    expect(
      values
        .filter((v) => v.canonicalField === 'LUMINAIRE_FLUX')
        .every((v) => v.confidence < 85 && v.basis === 'UNSPECIFIED'),
    ).toBe(true);
    expect(values.some((v) => v.canonicalField === 'SYSTEM_POWER')).toBe(false);
  });
  it('keeps contradictory driver locations as alternatives and driver choices below verified confidence', () => {
    const values = extract([
      'professional.flos.com\nIntegrated 110/240V power supply.',
      'Power supply Remote included\nPower supply type Non Dimmable,\nDimmable DALI 2,',
    ]);
    expect(
      values.filter((v) => v.canonicalField === 'DRIVER').map((v) => v.normalizedValue),
    ).toEqual(['INTEGRATED', 'REMOTE INCLUDED']);
    expect(values.find((v) => v.canonicalField === 'CONTROL')?.confidence).toBe(60);
  });
});

it('flags engineering flux and conflicting driver evidence without correcting either', () => {
  const values = extract([
    'Manufacturer: Example Lighting\nSource flux (lm): 1000\nLuminaire flux: 1200 lm\nDriver: Included\nDriver: Excluded',
  ]);
  const flux = values.find((v) => v.canonicalField === 'LUMINAIRE_FLUX');
  expect(flux?.normalizedValue).toBe(1200);
  expect(flux?.warnings).toContain('ENGINEERING_LUMINAIRE_FLUX_EXCEEDS_SOURCE');
  expect(flux?.confidence).toBeLessThan(85);
  const drivers = values.filter((v) => v.canonicalField === 'DRIVER');
  expect(drivers.length).toBeGreaterThanOrEqual(2);
  expect(
    drivers.every(
      (v) => v.warnings.includes('ENGINEERING_DRIVER_LOCATIONS_DISAGREE') && v.confidence < 85,
    ),
  ).toBe(true);
});
