import { describe, expect, it } from 'vitest';
import { LuminaireDatasheetSemanticExtractionService } from './LuminaireDatasheetSemanticExtractionService';
import type { ExtractedPdfPage } from './PdfExtractionAdapter';

const service = new LuminaireDatasheetSemanticExtractionService();

function extract(text: string, method: 'NATIVE_TEXT' | 'OCR' = 'NATIVE_TEXT') {
  const page: ExtractedPdfPage = {
    pageNumber: 1,
    text,
    usableTextCharacters: text.replace(/\s+/g, '').length,
    needsOcr: false,
    ...(method === 'OCR'
      ? {
          ocrRegions: [
            {
              text: text.split('\n')[0] ?? text,
              confidence: 82,
              region: { x: 10, y: 20, width: 300, height: 30 },
            },
          ],
        }
      : {}),
  };
  return service.extract([page], new Map([[1, method]]));
}

function fields(text: string) {
  return extract(text).map((item) => item.canonicalField);
}

describe('Luminaire Datasheet semantic extraction', () => {
  it('binds a clean searchable technical block with labels, units, basis, and context', () => {
    const values = extract(`Manufacturer: Acme Lighting
Ordering Code: A100
System Power: 15 W
Luminaire Flux: 1200 lm
CCT: 3000 K
Beam Angle: 36°
CRI: >90
IP Rating: IP65`);
    expect(values.map((item) => item.canonicalField)).toEqual([
      'MANUFACTURER',
      'ORDERING_CODE',
      'SYSTEM_POWER',
      'LUMINAIRE_FLUX',
      'CCT',
      'BEAM_ANGLE',
      'CRI',
      'IP_RATING',
    ]);
    expect(values.find((item) => item.canonicalField === 'SYSTEM_POWER')).toMatchObject({
      normalizedValue: 15,
      unit: 'W',
      basis: 'LUMINAIRE_SYSTEM',
      method: 'NATIVE_TEXT',
      confidence: 94,
    });
    expect(
      values.every((item) => item.warnings.some((warning) => warning.startsWith('LABEL:'))),
    ).toBe(true);
  });

  it('preserves OCR evidence but caps numeric confidence pending visual review', () => {
    const [value] = extract('System Power: 15 W', 'OCR');
    expect(value).toMatchObject({
      canonicalField: 'SYSTEM_POWER',
      method: 'OCR',
      confidence: 75,
      region: { x: 10, y: 20, width: 300, height: 30 },
    });
  });

  it('rejects isolated and dimension numbers as technical truth', () => {
    expect(
      fields(`36 mm
90 mm
3000 mm
Product dimensions: 36 x 90 x 3000 mm`),
    ).toEqual(['DIMENSIONS']);
  });

  it('keeps system, LED, input, and linear power distinct', () => {
    const values = extract(`System Power: 15 W
LED Power: 12 W
Input Power: 16 W
Power per metre: 15 W/m`);
    expect(values.map((item) => [item.canonicalField, item.unit, item.basis])).toEqual([
      ['SYSTEM_POWER', 'W', 'LUMINAIRE_SYSTEM'],
      ['LED_POWER', 'W', 'LIGHT_SOURCE'],
      ['INPUT_POWER', 'W', 'INPUT'],
      ['POWER_PER_METRE', 'W/m', 'LINEAR'],
    ]);
  });

  it('keeps delivered, source, and linear flux distinct', () => {
    const values = extract(`Luminaire Flux: 1200 lm
LED Flux: 1500 lm
Flux per metre: 1200 lm/m`);
    expect(values.map((item) => [item.canonicalField, item.unit, item.basis])).toEqual([
      ['LUMINAIRE_FLUX', 'lm', 'LUMINAIRE_DELIVERED'],
      ['LED_FLUX', 'lm', 'LIGHT_SOURCE'],
      ['FLUX_PER_METRE', 'lm/m', 'LINEAR'],
    ]);
  });

  it('keeps beam, field, and tilt angles distinct', () => {
    expect(
      fields(`Beam Angle: 36°
Field Angle: 60°
Tilt Angle: 30°`),
    ).toEqual(['BEAM_ANGLE', 'FIELD_ANGLE', 'TILT_ANGLE']);
  });

  it('binds every technical value to its exact ordering-code table row', () => {
    const values = extract(`Ordering Code | System Power | CCT | Beam Angle
A100 | 15 W | 3000 K | 36°
B200 | 12 W | 4000 K | 24°`);
    const a100 = values.filter((item) => item.warnings.includes('PRODUCT_ROW:A100'));
    const b200 = values.filter((item) => item.warnings.includes('PRODUCT_ROW:B200'));
    expect(a100.map((item) => [item.canonicalField, item.normalizedValue])).toEqual([
      ['ORDERING_CODE', 'A100'],
      ['SYSTEM_POWER', 15],
      ['CCT', 3000],
      ['BEAM_ANGLE', 36],
    ]);
    expect(b200.map((item) => [item.canonicalField, item.normalizedValue])).toEqual([
      ['ORDERING_CODE', 'B200'],
      ['SYSTEM_POWER', 12],
      ['CCT', 4000],
      ['BEAM_ANGLE', 24],
    ]);
  });

  it('marks unresolved multi-option values ambiguous and never upgrades them to high confidence', () => {
    const values = extract(`CCT: 3000 K / 4000 K
Beam Angle: 24° / 36° / 60°`);
    expect(values).toHaveLength(2);
    expect(values.every((item) => item.confidence === 65)).toBe(true);
    expect(
      values.every((item) =>
        item.warnings.some((warning) => warning.startsWith('AMBIGUOUS_OPTIONS:')),
      ),
    ).toBe(true);
  });

  it('does not fuzzy-match or infer an unlabeled ordering code', () => {
    expect(fields('A10O may resemble A100 but is only marketing copy.')).toEqual([]);
  });

  it('extracts same-line delimiter-free ERCO labels', () => {
    const values = extract(`Connected load 10.6 W
Luminous flux of the luminaire 1222 lm`);
    expect(values.map((item) => [item.canonicalField, item.normalizedValue, item.unit])).toEqual([
      ['SYSTEM_POWER', 10.6, 'W'],
      ['LUMINAIRE_FLUX', 1222, 'lm'],
    ]);
  });

  it('extracts adjacent-line label/value pairs', () => {
    const values = extract(`Beam angle
C0 55°`);
    expect(values.map((item) => [item.canonicalField, item.normalizedValue, item.unit])).toEqual([
      ['BEAM_ANGLE', 55, 'deg'],
    ]);
  });

  it('extracts a single-column flattened article table', () => {
    const values = extract(`Art. no.
A2000427`);
    expect(values.map((item) => [item.canonicalField, item.normalizedValue])).toEqual([
      ['ORDERING_CODE', 'A2000427'],
    ]);
    expect(values[0]?.warnings.some((warning) => warning.startsWith('PRODUCT_ROW:'))).toBe(true);
  });

  it('extracts CRI from the ERCO "Colour rendition index CRI" wording', () => {
    const values = extract(`Colour rendition index CRI
92`);
    expect(values.map((item) => [item.canonicalField, item.normalizedValue])).toEqual([
      ['CRI', '92'],
    ]);
  });

  it('extracts ERCO light distribution as a qualitative term distinct from beam angle', () => {
    const values = extract(`ERCO
Connected load 10.6 W
Fresnel lens wide flood`);
    expect(
      values
        .filter((item) => item.canonicalField === 'LIGHT_DISTRIBUTION')
        .map((item) => [item.canonicalField, item.normalizedValue, item.basis]),
    ).toEqual([['LIGHT_DISTRIBUTION', 'WIDE FLOOD', 'OPTIC']]);
  });

  it('keeps ERCO LED power, LED flux, and CCT distinct within the compound LED module block', () => {
    const values = extract(`ERCO
Connected load 10.6 W
LED module
9.3 W
1636 lm
3000 K
warm white`);
    expect(
      values
        .filter((item) => ['LED_POWER', 'LED_FLUX', 'CCT'].includes(item.canonicalField))
        .map((item) => [item.canonicalField, item.normalizedValue, item.unit]),
    ).toEqual([
      ['LED_POWER', 9.3, 'W'],
      ['LED_FLUX', 1636, 'lm'],
      ['CCT', 3000, 'K'],
    ]);
  });

  it('does not treat ERCO-like dimensions or accessories as technical truth', () => {
    expect(
      fields(`36 mm
90 mm
3000 mm
Accessory: mounting ring
Product dimensions: 36 x 90 x 3000 mm`),
    ).toEqual(['DIMENSIONS']);
  });

  it('binds each product row in a multi-product flattened table to its exact article', () => {
    const values = extract(`Art. no. | System Power | CCT
A2000427 | 10.6 W | 3000 K
A2000428 | 12.4 W | 4000 K`);
    const a2000427 = values.filter((item) => item.warnings.includes('PRODUCT_ROW:A2000427'));
    const a2000428 = values.filter((item) => item.warnings.includes('PRODUCT_ROW:A2000428'));
    expect(a2000427.map((item) => [item.canonicalField, item.normalizedValue])).toEqual([
      ['ORDERING_CODE', 'A2000427'],
      ['SYSTEM_POWER', 10.6],
      ['CCT', 3000],
    ]);
    expect(a2000428.map((item) => [item.canonicalField, item.normalizedValue])).toEqual([
      ['ORDERING_CODE', 'A2000428'],
      ['SYSTEM_POWER', 12.4],
      ['CCT', 4000],
    ]);
  });

  it('never binds a multi-word trailing phrase as an ordering code', () => {
    // The real ERCO melanopic table header "Art. no. Spectrum MR MDER" is a
    // column header, not an article identity. It must not be extracted.
    const values = extract(`ERCO
Art. no. Spectrum MR MDER
A2000427 (direct) 3000K CRI 92`);
    const codes = values.filter((item) => item.canonicalField === 'ORDERING_CODE');
    expect(codes.map((item) => item.normalizedValue)).toEqual(['A2000427']);
  });

  it('extracts the ERCO inline compound LED module from a single line', () => {
    const values = extract(`ERCO
A2000427 LED module: 9.3W 1636lm 3000K warm white`);
    expect(
      values
        .filter((item) => ['LED_POWER', 'LED_FLUX', 'CCT'].includes(item.canonicalField))
        .map((item) => [item.canonicalField, item.normalizedValue, item.unit]),
    ).toEqual([
      ['LED_POWER', 9.3, 'W'],
      ['LED_FLUX', 1636, 'lm'],
      ['CCT', 3000, 'K'],
    ]);
  });

  it('extracts IP embedded in a compound ERCO specification line', () => {
    const values = extract(`ERCO
C 3 W IP 20
Connected load 10.6 W`);
    expect(
      values
        .filter((item) => item.canonicalField === 'IP_RATING')
        .map((item) => [item.canonicalField, item.normalizedValue]),
    ).toEqual([['IP_RATING', 'IP20']]);
  });

  it('extracts the ERCO article from a product-title line', () => {
    const values = extract(`ERCO
A2000427 White (RAL9002)
Fresnel lens wide flood`);
    expect(
      values
        .filter((item) => item.canonicalField === 'ORDERING_CODE')
        .map((item) => [item.canonicalField, item.normalizedValue, item.basis]),
    ).toEqual([['ORDERING_CODE', 'A2000427', 'PRODUCT_IDENTITY']]);
  });

  it('extracts Model from an explicit label, never from the filename', () => {
    const values = extract(`Model: Iku Downlight
Ordering Code: A2000427`);
    expect(
      values
        .filter((item) => item.canonicalField === 'MODEL')
        .map((item) => [item.canonicalField, item.normalizedValue, item.basis]),
    ).toEqual([['MODEL', 'IKU DOWNLIGHT', 'PRODUCT_IDENTITY']]);
  });

  it('never binds a regulatory Model identifier as commercial Model evidence', () => {
    const values = extract(`Model identifier: 3000073333
Model: Iku Downlight`);
    expect(
      values
        .filter((item) => item.canonicalField === 'MODEL')
        .map((item) => [item.canonicalField, item.normalizedValue]),
    ).toEqual([['MODEL', 'IKU DOWNLIGHT']]);
  });

  it('extracts article-bound Body Color / Finish only from explicit labels', () => {
    const values = extract(`Body color: White (RAL9002)
Finish: Black (RAL9011)`);
    expect(
      values
        .filter((item) => item.canonicalField === 'BODY_COLOR')
        .map((item) => [item.canonicalField, item.normalizedValue]),
    ).toEqual([
      ['BODY_COLOR', 'WHITE (RAL9002)'],
      ['BODY_COLOR', 'BLACK (RAL9011)'],
    ]);
  });

  it('extracts Cutout only from explicit cutout vocabulary', () => {
    const values = extract(`Cut-out: Ø125 mm
Ceiling opening: 120 × 80 mm`);
    expect(
      values
        .filter((item) => item.canonicalField === 'CUTOUT')
        .map((item) => [item.canonicalField, item.normalizedValue, item.unit]),
    ).toEqual([
      ['CUTOUT', 'Ø125 MM', 'mm'],
      ['CUTOUT', '120 × 80 MM', 'mm'],
    ]);
  });

  it('never maps unlabeled mm values to Cutout or Dimensions', () => {
    expect(
      fields(`36 mm
90 mm
125 mm
160 mm`),
    ).toEqual([]);
  });

  it('extracts Recessed Depth as a numeric subtype distinct from Dimensions', () => {
    const values = extract(`Recessed depth: 95 mm
Dimensions: Ø160 × 110 mm`);
    expect(
      values
        .filter((item) => item.canonicalField === 'RECESSED_DEPTH')
        .map((item) => [item.canonicalField, item.normalizedValue, item.unit]),
    ).toEqual([['RECESSED_DEPTH', 95, 'mm']]);
  });

  it('never extracts optional control capability as exact configuration', () => {
    // "Optional DALI control" is capability language, not an exact supplied
    // configuration. It must not be extracted as CONTROL evidence at all.
    expect(fields(`Optional DALI control`)).toEqual([]);
  });

  it('keeps exact supplied control evidence at full confidence', () => {
    const values = extract(`Control gear: Casambi Bluetooth`);
    const control = values.find((item) => item.canonicalField === 'CONTROL');
    expect(control).toMatchObject({
      canonicalField: 'CONTROL',
      normalizedValue: 'CASAMBI BLUETOOTH',
      confidence: 94,
    });
    expect(control?.warnings).not.toContain('CAPABILITY_ONLY');
  });

  it('marks emergency approval as capability-only, never exact configuration', () => {
    // The ERCO adapter owns the emergency-approval structure; it activates
    // from the ERCO vocabulary signatures and emits CAPABILITY_ONLY evidence.
    const values = extract(`ERCO
Connected load 10.6 W
Approved for use as emergency lighting according to IEC / EN 60598-2-22`);
    const emergency = values.find((item) => item.canonicalField === 'EMERGENCY');
    expect(emergency).toBeDefined();
    expect(emergency?.warnings).toContain('CAPABILITY_ONLY');
    expect(emergency?.confidence).toBeLessThan(85);
  });

  it('keeps exact emergency article evidence at full confidence', () => {
    const values = extract(`Emergency: Integrated emergency, 3 h`);
    const emergency = values.find((item) => item.canonicalField === 'EMERGENCY');
    expect(emergency).toMatchObject({
      canonicalField: 'EMERGENCY',
      normalizedValue: 'INTEGRATED EMERGENCY 3 H',
      confidence: 94,
    });
    expect(emergency?.warnings).not.toContain('CAPABILITY_ONLY');
  });

  it('deduplicates identical native and OCR evidence, preferring higher-confidence evidence', () => {
    const text = 'System Power: 15 W\nLuminaire Flux: 1200 lm';
    const nativePage: ExtractedPdfPage = {
      pageNumber: 1,
      text,
      usableTextCharacters: text.replace(/\s+/g, '').length,
      needsOcr: false,
    };
    const ocrPage: ExtractedPdfPage = {
      pageNumber: 2,
      text,
      usableTextCharacters: text.replace(/\s+/g, '').length,
      needsOcr: false,
      ocrRegions: [
        {
          text: 'System Power: 15 W',
          confidence: 82,
          region: { x: 10, y: 20, width: 300, height: 30 },
        },
      ],
    };
    const values = service.extract(
      [nativePage, ocrPage],
      new Map([
        [1, 'NATIVE_TEXT'],
        [2, 'OCR'],
      ]),
    );
    // Same field+value across both sources is never duplicated.
    expect(values.filter((item) => item.canonicalField === 'SYSTEM_POWER')).toHaveLength(1);
    expect(values.filter((item) => item.canonicalField === 'LUMINAIRE_FLUX')).toHaveLength(1);
    // Higher-confidence evidence wins: the healthy native page (94) outranks
    // the OCR page (capped at 82), preserving provenance.
    const systemPower = values.find((item) => item.canonicalField === 'SYSTEM_POWER');
    expect(systemPower?.method).toBe('NATIVE_TEXT');
    expect(systemPower?.normalizedValue).toBe(15);
  });

  it('prefers OCR evidence deterministically when native and OCR confidence tie', () => {
    // Ambiguous values cap both native and OCR confidence to 65, producing a
    // deterministic tie. On a tie the OCR-sourced evidence wins.
    const text = 'System Power: 15 W / 16 W';
    const nativePage: ExtractedPdfPage = {
      pageNumber: 1,
      text,
      usableTextCharacters: text.replace(/\s+/g, '').length,
      needsOcr: false,
    };
    const ocrPage: ExtractedPdfPage = {
      pageNumber: 2,
      text,
      usableTextCharacters: text.replace(/\s+/g, '').length,
      needsOcr: false,
      ocrRegions: [
        {
          text: 'System Power: 15 W',
          confidence: 82,
          region: { x: 10, y: 20, width: 300, height: 30 },
        },
      ],
    };
    const values = service.extract(
      [nativePage, ocrPage],
      new Map([
        [1, 'NATIVE_TEXT'],
        [2, 'OCR'],
      ]),
    );
    const systemPower = values.find((item) => item.canonicalField === 'SYSTEM_POWER');
    expect(systemPower).toBeDefined();
    expect(systemPower?.method).toBe('OCR');
    expect(systemPower?.confidence).toBe(65);
  });

  it('binds unit-in-label rows ("CCT (K) | 3000") via the relaxed value pattern only when the label carries the unit', () => {
    const values = extract(`CCT (K) | 3000\nCRI | 90\nRecessed depth (mm) | 150`);
    expect(values.find((item) => item.canonicalField === 'CCT')).toMatchObject({
      normalizedValue: 3000,
      unit: 'K',
      method: 'NATIVE_TEXT',
    });
    expect(values.find((item) => item.canonicalField === 'CCT')?.warnings).toContain(
      'UNIT_IN_LABEL',
    );
    expect(values.find((item) => item.canonicalField === 'CRI')).toMatchObject({
      normalizedValue: '90',
    });
    expect(values.find((item) => item.canonicalField === 'RECESSED_DEPTH')).toMatchObject({
      normalizedValue: 150,
      unit: 'mm',
    });
  });

  it('binds delimiter-free unit-in-label rows ("CCT (K) 3000") safely', () => {
    const values = extract(`CCT (K) 3000\nBeam angle (°) 25`);
    expect(values.find((item) => item.canonicalField === 'CCT')).toMatchObject({
      normalizedValue: 3000,
    });
    expect(values.find((item) => item.canonicalField === 'BEAM_ANGLE')).toMatchObject({
      normalizedValue: 25,
    });
  });

  it('never binds a bare number without a unit-bearing label to dimension fields', () => {
    // No label carries (mm): bare "150" must NOT become RECESSED_DEPTH.
    const values = extract(`Recessed depth | 150`);
    expect(values.find((item) => item.canonicalField === 'RECESSED_DEPTH')).toBeUndefined();
    expect(values.find((item) => item.canonicalField === 'CUTOUT')).toBeUndefined();
  });

  it('recovers photometric rows from reconstructed two-column OCR evidence without cross-column contamination', () => {
    // Simulates GenericOcrLayoutReconstructor output for a real two-column
    // table page: canonical lines with per-cell provenance.
    const text = [
      'CCT (K) | 3000',
      'CRI | 90',
      'Forward voltage (V) | 17.8',
      'LED current (mA) | 700',
    ].join('\n');
    const page: ExtractedPdfPage = {
      pageNumber: 1,
      text,
      usableTextCharacters: text.replace(/\s+/g, '').length,
      needsOcr: false,
      ocrRegions: [
        { text: 'CCT (K)', confidence: 92, region: { x: 99, y: 748, width: 67, height: 18 } },
        { text: '3000', confidence: 96, region: { x: 355, y: 747, width: 50, height: 18 } },
        { text: 'CRI', confidence: 92, region: { x: 99, y: 803, width: 28, height: 18 } },
        { text: '90', confidence: 96, region: { x: 355, y: 803, width: 24, height: 18 } },
        {
          text: 'Forward voltage (V)',
          confidence: 92,
          region: { x: 648, y: 752, width: 169, height: 18 },
        },
        { text: '17.8', confidence: 93, region: { x: 888, y: 747, width: 40, height: 18 } },
        {
          text: 'LED current (mA)',
          confidence: 93,
          region: { x: 643, y: 807, width: 147, height: 18 },
        },
        { text: '700', confidence: 96, region: { x: 887, y: 803, width: 37, height: 18 } },
      ],
    };
    const values = service.extract([page], new Map([[1, 'OCR']]));
    const cct = values.find((item) => item.canonicalField === 'CCT');
    const cri = values.find((item) => item.canonicalField === 'CRI');
    expect(cct).toMatchObject({ normalizedValue: 3000, method: 'OCR' });
    expect(cri).toMatchObject({ normalizedValue: '90', method: 'OCR' });
    // The right-column Electrical values are present as evidence but never
    // bound to photometric fields (CCT stays 3000, not 17.8 or 700).
    expect(values.find((item) => item.canonicalField === 'CCT')?.normalizedValue).toBe(3000);
    // No cross-column contamination: no CRI candidate can be 700 or 17.8.
    expect(cri?.warnings.some((warning) => warning.includes('700'))).toBe(false);
  });

  it('binds Label: Value with conventional colon delimiter', () => {
    const values = extract('Beam Angle: 25°');
    expect(values.find((item) => item.canonicalField === 'BEAM_ANGLE')).toMatchObject({
      normalizedValue: 25,
      unit: 'deg',
    });
  });

  it('binds Label : Value with spaced colon delimiter', () => {
    const values = extract('Beam Angle : 25°');
    expect(values.find((item) => item.canonicalField === 'BEAM_ANGLE')).toMatchObject({
      normalizedValue: 25,
    });
  });

  it('binds Colour as Body Color / Finish from a generic Colour label', () => {
    const values = extract('Colour: Black');
    expect(values.find((item) => item.canonicalField === 'BODY_COLOR')).toMatchObject({
      normalizedValue: 'BLACK',
      basis: 'ENCLOSURE',
    });
  });

  it('binds Color (American spelling) as Body Color / Finish', () => {
    const values = extract('Color: White');
    expect(values.find((item) => item.canonicalField === 'BODY_COLOR')).toMatchObject({
      normalizedValue: 'WHITE',
    });
  });

  it('extracts a product identity block from a bounded header with title + code', () => {
    const text = [
      'Wl 05743074 pay',
      'Easy Kap Ø 80 Plus Fixed Optic Medium',
      'Designed by FLOS Architectural, 2019',
      'Some technical description follows here',
      'More content',
      'Footer text ©2022',
    ].join('\n');
    const values = extract(text);
    const model = values.find((item) => item.canonicalField === 'MODEL');
    const code = values.find((item) => item.canonicalField === 'ORDERING_CODE');
    expect(model).toMatchObject({
      canonicalField: 'MODEL',
      normalizedValue: 'EASY KAP Ø 80 PLUS FIXED OPTIC MEDIUM',
      basis: 'PRODUCT_IDENTITY',
    });
    expect(code).toMatchObject({
      canonicalField: 'ORDERING_CODE',
      basis: 'PRODUCT_IDENTITY',
    });
  });

  it('does NOT extract a product identity block when no code-like sibling exists', () => {
    // A section heading without a code sibling must not become MODEL.
    const text = ['Schematic light drawing', 'Ecodesign and Energy labelling', 'More content'].join(
      '\n',
    );
    const values = extract(text);
    expect(values.find((item) => item.canonicalField === 'MODEL')).toBeUndefined();
    expect(values.find((item) => item.canonicalField === 'ORDERING_CODE')).toBeUndefined();
  });

  it('rejects footer page numbers and copyright as product identity codes', () => {
    const text = [
      'Easy Kap Ø 80 Plus Fixed Optic Medium',
      '©2022 Flos - P.IVA 00290820174',
      'https://professional.flos.com 05.7430.74 1/4',
      'More content',
    ].join('\n');
    const values = extract(text);
    // The footer URL line with the code must NOT be bound as identity.
    // The title has no non-footer code sibling → no MODEL.
    expect(values.find((item) => item.canonicalField === 'MODEL')).toBeUndefined();
  });

  it('extracts compound summary segments (CRI, Beam, CCT from dash-separated line)', () => {
    const values = extract('LED- LED array - 13W - 822lm - 3000K - CRI> 90 - Beam 25');
    const cri = values.find((item) => item.canonicalField === 'CRI');
    const beam = values.find((item) => item.canonicalField === 'BEAM_ANGLE');
    expect(cri).toMatchObject({ normalizedValue: '90' });
    expect(beam).toMatchObject({ normalizedValue: 25 });
  });

  it('extracts CCT from an OCR label with missing closing parenthesis (CCT (K | 3000)', () => {
    const values = extract('CCT (K | 3000', 'OCR');
    expect(values.find((item) => item.canonicalField === 'CCT')).toMatchObject({
      normalizedValue: 3000,
      unit: 'K',
    });
  });

  it('extracts CRI from OCR label "CR" (missing I)', () => {
    const values = extract('CR | 90', 'OCR');
    expect(values.find((item) => item.canonicalField === 'CRI')).toMatchObject({
      normalizedValue: '90',
    });
  });

  it('keeps Power and System Power distinct on adjacent colon rows', () => {
    const values = extract(`Power: 13 W
System Power: 13.4 W`);
    const system = values.find((item) => item.canonicalField === 'SYSTEM_POWER');
    // "Power" alone does not match LED_POWER (label is "LED Power" or "Source Power")
    // but "System Power" matches SYSTEM_POWER.
    expect(system).toMatchObject({ normalizedValue: 13.4, unit: 'W' });
  });

  it('keeps Source Flux and Luminaire Flux distinct on adjacent colon rows', () => {
    const values = extract(`Source Flux: 1397 lm
Luminaire Flux: 822 lm`);
    const source = values.find((item) => item.canonicalField === 'LED_FLUX');
    const luminaire = values.find((item) => item.canonicalField === 'LUMINAIRE_FLUX');
    expect(source).toMatchObject({ normalizedValue: 1397, unit: 'lm', basis: 'LIGHT_SOURCE' });
    expect(luminaire).toMatchObject({
      normalizedValue: 822,
      unit: 'lm',
      basis: 'LUMINAIRE_DELIVERED',
    });
  });

  it('prevents two-column cross-contamination in a four-cell Photometric/Electrical row', () => {
    // Simulates a reconstructed four-cell row that splits into two label/value
    // pairs: CCT | 3000 and Forward voltage | 17.8
    const text = 'CCT (K | 3000\norward voltage (V) | 17.8';
    const page: ExtractedPdfPage = {
      pageNumber: 1,
      text,
      usableTextCharacters: text.replace(/\s+/g, '').length,
      needsOcr: false,
      ocrRegions: [
        { text: 'CCT (K', confidence: 81, region: { x: 102, y: 769, width: 61, height: 16 } },
        { text: '3000', confidence: 96, region: { x: 365, y: 769, width: 52, height: 17 } },
      ],
    };
    const values = service.extract([page], new Map([[1, 'OCR']]));
    const cct = values.find((item) => item.canonicalField === 'CCT');
    expect(cct).toMatchObject({ normalizedValue: 3000, method: 'OCR' });
    // The electrical column value 17.8 must NOT contaminate CCT.
    expect(cct?.normalizedValue).not.toBe(17.8);
  });

  it('excludes drawing annotations from specification rows', () => {
    // Bare drawing numbers without labels must not become specifications.
    const values = extract('Ø75\n95\nØ80\n275');
    expect(values.filter((item) => item.canonicalField === 'CUTOUT')).toHaveLength(0);
    expect(values.filter((item) => item.canonicalField === 'DIMENSIONS')).toHaveLength(0);
    expect(values.filter((item) => item.canonicalField === 'RECESSED_DEPTH')).toHaveLength(0);
  });

  it('binds a product title with @ OCR noise as Ø in MODEL', () => {
    const text = [
      'Wl 05743074 pay',
      'Easy Kap @ 80 Plus Fixed Optic Medium L=—]',
      'Designed by FLOS Architectural, 2019',
      'More content here',
      'More content',
    ].join('\n');
    const values = extract(text);
    const model = values.find((item) => item.canonicalField === 'MODEL');
    expect(model?.normalizedValue).toBe('EASY KAP Ø 80 PLUS FIXED OPTIC MEDIUM');
  });

  it('preserves IP internal and IP external as separate evidence rows', () => {
    // IP internal/external are separate structured supporting evidence.
    const values = extract(`IP internal: 20
IP external: 54`);
    // Both are present as supporting evidence (not collapsed into one IP value).
    expect(values.filter((v) => v.canonicalField === 'IP_RATING')).toHaveLength(0);
    // IP internal | 20 and IP external | 54 are distinct rows in the layout.
    // The semantic engine does not have separate IP_INTERNAL/IP_EXTERNAL fields
    // (DOMAIN_IP_INTERNAL_EXTERNAL_LIMITATION debt).
  });
});
