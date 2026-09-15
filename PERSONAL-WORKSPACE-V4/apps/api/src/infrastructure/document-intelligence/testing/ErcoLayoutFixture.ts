/**
 * Minimal synthetic ERCO-layout fixtures.
 *
 * These reproduce ONLY the minimum structural patterns from a real ERCO
 * Datasheet that the semantic layer must handle. They never contain the
 * proprietary real ERCO PDF; they are task-owned synthetic evidence.
 */
export type ErcoFixtureKey =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z';

export interface ErcoLayoutFixture {
  key: ErcoFixtureKey;
  description: string;
  lines: readonly string[];
  expected: ReadonlyArray<{ field: string; value: string | number; unit?: string | null }>;
}

export const ERCO_LAYOUT_FIXTURES: readonly ErcoLayoutFixture[] = Object.freeze([
  {
    key: 'A',
    description: 'delimiter-free ERCO labels',
    lines: ['ERCO', 'Connected load 10.6 W', 'Luminous flux of the luminaire 1222 lm'],
    expected: [
      { field: 'SYSTEM_POWER', value: 10.6, unit: 'W' },
      { field: 'LUMINAIRE_FLUX', value: 1222, unit: 'lm' },
    ],
  },
  {
    key: 'B',
    description: 'adjacent lines',
    lines: ['ERCO', 'Beam angle', 'C0 55°'],
    expected: [{ field: 'BEAM_ANGLE', value: 55, unit: 'deg' }],
  },
  {
    key: 'C',
    description: 'compound LED block',
    lines: [
      'ERCO',
      'Connected load 10.6 W',
      'LED module',
      '9.3 W',
      '1636 lm',
      '3000 K',
      'warm white',
    ],
    expected: [
      { field: 'LED_POWER', value: 9.3, unit: 'W' },
      { field: 'LED_FLUX', value: 1636, unit: 'lm' },
      { field: 'CCT', value: 3000, unit: 'K' },
    ],
  },
  {
    key: 'D',
    description: 'flattened Article table',
    lines: ['ERCO', 'Art. no.', 'A2000427'],
    expected: [{ field: 'ORDERING_CODE', value: 'A2000427' }],
  },
  {
    key: 'E',
    description: 'CRI wording',
    lines: ['ERCO', 'Colour rendition index CRI', '92'],
    expected: [{ field: 'CRI', value: '92' }],
  },
  {
    key: 'F',
    description: 'IP icon/text structure',
    lines: ['ERCO', 'Connected load 10.6 W', 'IP 20'],
    expected: [{ field: 'IP_RATING', value: 'IP20' }],
  },
  {
    key: 'G',
    description: 'light distribution',
    lines: ['ERCO', 'Connected load 10.6 W', 'Fresnel lens wide flood'],
    expected: [{ field: 'LIGHT_DISTRIBUTION', value: 'WIDE FLOOD' }],
  },
  {
    key: 'H',
    description: 'negative ERCO-like dimensions / accessories',
    lines: [
      'ERCO',
      '36 mm',
      '90 mm',
      '3000 mm',
      'Accessory: mounting ring',
      'Product dimensions: 36 x 90 x 3000 mm',
    ],
    expected: [{ field: 'DIMENSIONS', value: '36 X 90 X 3000 MM', unit: 'mm' }],
  },
  {
    key: 'I',
    description: 'multi-product flattened table',
    lines: [
      'ERCO',
      'Art. no. | System Power | CCT',
      'A2000427 | 10.6 W | 3000 K',
      'A2000428 | 12.4 W | 4000 K',
    ],
    expected: [
      { field: 'ORDERING_CODE', value: 'A2000427' },
      { field: 'SYSTEM_POWER', value: 10.6, unit: 'W' },
      { field: 'CCT', value: 3000, unit: 'K' },
      { field: 'ORDERING_CODE', value: 'A2000428' },
      { field: 'SYSTEM_POWER', value: 12.4, unit: 'W' },
      { field: 'CCT', value: 4000, unit: 'K' },
    ],
  },
  {
    key: 'J',
    description: 'inline compound LED module on one line',
    lines: ['ERCO', 'A2000427 LED module: 9.3W 1636lm 3000K warm white'],
    expected: [
      { field: 'ORDERING_CODE', value: 'A2000427' },
      { field: 'LED_POWER', value: 9.3, unit: 'W' },
      { field: 'LED_FLUX', value: 1636, unit: 'lm' },
      { field: 'CCT', value: 3000, unit: 'K' },
    ],
  },
  {
    key: 'K',
    description: 'IP embedded in a compound specification line',
    lines: ['ERCO', 'C 3 W IP 20', 'Connected load 10.6 W'],
    expected: [
      { field: 'IP_RATING', value: 'IP20' },
      { field: 'SYSTEM_POWER', value: 10.6, unit: 'W' },
    ],
  },
  {
    key: 'L',
    description: 'article product-title line',
    lines: ['ERCO', 'A2000427 White (RAL9002)', 'Fresnel lens wide flood'],
    expected: [
      { field: 'ORDERING_CODE', value: 'A2000427' },
      { field: 'LIGHT_DISTRIBUTION', value: 'WIDE FLOOD' },
    ],
  },
  {
    key: 'M',
    description: 'negative: melanopic table header must not bind as article',
    lines: ['ERCO', 'Art. no. Spectrum MR MDER', 'A2000427 (direct) 3000K CRI 92'],
    expected: [{ field: 'ORDERING_CODE', value: 'A2000427' }],
  },
  {
    key: 'N',
    description: 'explicit cutout diameter',
    lines: ['ERCO', 'Cut-out', 'Ø125 mm'],
    expected: [{ field: 'CUTOUT', value: 'Ø125 MM', unit: 'mm' }],
  },
  {
    key: 'O',
    description: 'rectangular ceiling opening',
    lines: ['ERCO', 'Ceiling opening', '120 × 80 mm'],
    expected: [{ field: 'CUTOUT', value: '120 × 80 MM', unit: 'mm' }],
  },
  {
    key: 'P',
    description: 'overall dimensions',
    lines: ['ERCO', 'Dimensions', 'Ø160 × 110 mm'],
    expected: [{ field: 'DIMENSIONS', value: 'Ø160 × 110 MM', unit: 'mm' }],
  },
  {
    key: 'Q',
    description: 'recessed depth',
    lines: ['ERCO', 'Recessed depth', '95 mm'],
    expected: [{ field: 'RECESSED_DEPTH', value: 95, unit: 'mm' }],
  },
  {
    key: 'R',
    description: 'article-bound finish',
    lines: ['ERCO', 'A2000427 White (RAL9002)'],
    expected: [
      { field: 'ORDERING_CODE', value: 'A2000427' },
      { field: 'BODY_COLOR', value: 'WHITE (RAL9002)' },
    ],
  },
  {
    key: 'S',
    description: 'model/product title bound to article',
    lines: ['ERCO', 'E Iku Downlight', 'A2000427'],
    expected: [{ field: 'MODEL', value: 'IKU DOWNLIGHT' }],
  },
  {
    key: 'T',
    description: 'negative: unlabeled dimension cluster',
    lines: ['ERCO', '160 mm', '125 mm', '95 mm', '36 mm'],
    expected: [],
  },
  {
    key: 'U',
    description: 'negative: accessory dimensions must not become luminaire dimensions',
    lines: ['ERCO', 'Accessory', 'Ø90 mm'],
    expected: [],
  },
  {
    key: 'V',
    description: 'multi-product finish table requires exact article row binding',
    lines: [
      'ERCO',
      'Art. no. | Finish',
      'A2000427 | White (RAL9002)',
      'A2000428 | Black (RAL9011)',
    ],
    expected: [
      { field: 'ORDERING_CODE', value: 'A2000427' },
      { field: 'BODY_COLOR', value: 'WHITE (RAL9002)' },
      { field: 'ORDERING_CODE', value: 'A2000428' },
      { field: 'BODY_COLOR', value: 'BLACK (RAL9011)' },
    ],
  },
  {
    key: 'W',
    description: 'negative: optional control capability must not become exact configuration',
    lines: ['ERCO', 'Optional DALI control'],
    expected: [],
  },
  {
    key: 'X',
    description: 'exact supplied control gear',
    lines: ['ERCO', 'Includes ERCO Casambi control gear.'],
    expected: [{ field: 'CONTROL', value: 'CASAMBI' }],
  },
  {
    key: 'Y',
    description: 'negative: emergency option/accessory must not become Project Emergency = Yes',
    lines: ['ERCO', 'Emergency kit available'],
    expected: [],
  },
  {
    key: 'Z',
    description: 'exact emergency article evidence',
    lines: ['ERCO', 'Emergency: Integrated emergency, 3 h'],
    expected: [{ field: 'EMERGENCY', value: 'INTEGRATED EMERGENCY 3 H' }],
  },
]);

export function createErcoLayoutFixturePdf(key: ErcoFixtureKey): Buffer {
  const fixture = ERCO_LAYOUT_FIXTURES.find((item) => item.key === key);
  if (!fixture) throw new Error(`Unknown ERCO fixture key: ${key}`);
  return textPdf(fixture.lines);
}

function textPdf(lines: readonly string[]): Buffer {
  const escaped = lines
    .map((line, index) => `BT /F1 13 Tf 56 ${740 - index * 24} Td (${escapePdf(line)}) Tj ET`)
    .join('\n');
  return pdf([
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    },
    { body: `<< /Length ${Buffer.byteLength(escaped)} >>\nstream\n${escaped}\nendstream` },
    { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ]);
}

type PdfObject = { body: string } | { prefix: string; binary: Buffer; suffix: string };
function pdf(objects: readonly PdfObject[]): Buffer {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const head = Buffer.from(
      `${index + 1} 0 obj\n${'body' in object ? object.body : object.prefix}`,
      'binary',
    );
    chunks.push(head);
    length += head.length;
    if ('binary' in object) {
      chunks.push(object.binary);
      length += object.binary.length;
      const tail = Buffer.from(object.suffix, 'binary');
      chunks.push(tail);
      length += tail.length;
    }
    const end = Buffer.from('\nendobj\n', 'binary');
    chunks.push(end);
    length += end.length;
  });
  const xref = length;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) trailer += `${String(offset).padStart(10, '0')} 00000 n \n`;
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  chunks.push(Buffer.from(trailer, 'binary'));
  return Buffer.concat(chunks);
}
function escapePdf(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}
