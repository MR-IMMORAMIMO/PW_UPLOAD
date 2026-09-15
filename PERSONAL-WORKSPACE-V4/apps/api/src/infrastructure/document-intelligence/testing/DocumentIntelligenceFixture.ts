import { deflateSync } from 'node:zlib';

export type FixtureKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';
export interface SyntheticDocumentFixture {
  key: FixtureKey;
  description: string;
  documents: Array<{ fileName: string; bytes: Buffer; projectContextId?: string }>;
  expected: readonly string[];
}
const projectA = '11111111-1111-4111-8111-111111111111';
const projectB = '22222222-2222-4222-8222-222222222222';

export function createDocumentIntelligenceFixture(
  projectIdentities: { projectAId?: string; projectBId?: string } = {},
): SyntheticDocumentFixture[] {
  const projectAId = projectIdentities.projectAId ?? projectA;
  const projectBId = projectIdentities.projectBId ?? projectB;
  const a = textPdf([
    'DIALux evo Calculation Report',
    'Project Name: Alpha Palace',
    'Maintenance Factor: 0.80',
    'Average Illuminance: 500 lx',
    'Tag: DL01',
    'Quantity: 22',
  ]);
  return [
    {
      key: 'A',
      description: 'Searchable native-text DIALux-like PDF',
      documents: [{ fileName: 'Alpha Palace REV 01.pdf', bytes: a, projectContextId: projectAId }],
      expected: ['NATIVE_TEXT', 'DIALUX_CALCULATION_REPORT', 'NO_OCR'],
    },
    {
      key: 'B',
      description: 'Image-only scanned DIALux-like report',
      documents: [
        {
          fileName: 'Scanned Report.pdf',
          bytes: createImageOnlyDocumentPdf(
            'DIALUX REPORT MAINTENANCE FACTOR 0 8 ILLUMINANCE 500 LX',
          ),
        },
      ],
      expected: ['OCR', 'PAGE_EVIDENCE', 'CONFIDENCE'],
    },
    {
      key: 'C',
      description: 'Exact duplicate bytes',
      documents: [{ fileName: 'Duplicate.pdf', bytes: Buffer.from(a) }],
      expected: ['EXACT_DUPLICATE', 'NO_AUTOMATIC_REVISION'],
    },
    {
      key: 'D',
      description: 'Different bytes with a plausible explicit revision marker',
      documents: [
        {
          fileName: 'Alpha Palace REV 02.pdf',
          bytes: textPdf([
            'DIALux evo Calculation Report',
            'Project Name: Alpha Palace',
            'Revision: 02',
            'Maintenance Factor: 0.80',
            'Average Illuminance: 510 lx',
          ]),
          projectContextId: projectAId,
        },
      ],
      expected: ['POSSIBLE_REVISION', 'OWNER_REVIEW'],
    },
    {
      key: 'E',
      description: 'Controlled Project context contradicted by an explicit UUID',
      documents: [
        {
          fileName: 'Wrong Project.pdf',
          bytes: textPdf([`Project UUID: ${projectBId}`, 'DIALux Calculation Report']),
          projectContextId: projectAId,
        },
      ],
      expected: ['CONFLICTING', 'NO_ROUTING'],
    },
    {
      key: 'F',
      description: 'Two exact plausible Project names',
      documents: [
        {
          fileName: 'Ambiguous.pdf',
          bytes: textPdf(['Alpha Palace', 'Beta Palace', 'Lighting reference document']),
        },
      ],
      expected: ['AMBIGUOUS', 'OWNER_CONFIRMATION'],
    },
    {
      key: 'G',
      description: 'Client reference PDF',
      documents: [
        {
          fileName: 'Client Reference.pdf',
          bytes: textPdf([
            'FOR REFERENCE',
            'Client reference document',
            'No generated output authority',
          ]),
        },
      ],
      expected: ['REFERENCE_DOCUMENT'],
    },
    {
      key: 'H',
      description: 'BOQ and Schedule quantity 24 versus DIALux quantity 22',
      documents: [
        { fileName: 'BOQ.pdf', bytes: textPdf(['BOQ', 'Tag: DL01', 'Quantity: 24']) },
        {
          fileName: 'Schedule.pdf',
          bytes: textPdf(['Luminaire Schedule', 'Tag: DL01', 'Quantity: 24']),
        },
        {
          fileName: 'DIALux.pdf',
          bytes: textPdf(['DIALux Calculation Report', 'Tag: DL01', 'Quantity: 22']),
        },
      ],
      expected: ['LUMINAIRE_QUANTITY_CONFLICT', 'ALL_SOURCE_VALUES'],
    },
    {
      key: 'I',
      description: 'Ordering Code, Wattage, CCT and Beam mismatches',
      documents: [
        {
          fileName: 'I-BOQ.pdf',
          bytes: textPdf([
            'BOQ',
            'Tag: DL01',
            'Ordering Code: A100',
            'Wattage: 12 W',
            'CCT: 3000 K',
            'Beam: 24 deg',
          ]),
        },
        {
          fileName: 'I-Schedule.pdf',
          bytes: textPdf([
            'Luminaire Schedule',
            'Tag: DL01',
            'Ordering Code: A200',
            'Wattage: 15 W',
            'CCT: 4000 K',
            'Beam: 36 deg',
          ]),
        },
      ],
      expected: ['ORDERING_CODE_CONFLICT', 'WATTAGE_CONFLICT', 'CCT_CONFLICT', 'BEAM_CONFLICT'],
    },
    {
      key: 'J',
      description: 'Unknown but valid PDF',
      documents: [{ fileName: 'Unknown.pdf', bytes: textPdf(['Synthetic undecorated content']) }],
      expected: ['UNKNOWN', 'UNSUPPORTED_DOCUMENT_TYPE'],
    },
    {
      key: 'K',
      description: 'Malformed parser-failure PDF with a valid admission signature',
      documents: [{ fileName: 'Malformed.pdf', bytes: Buffer.from('%PDF-1.4\n1 0 obj\nBROKEN') }],
      expected: ['FAILED_RETRYABLE', 'SOURCE_PRESERVED'],
    },
    {
      key: 'L',
      description: 'Clean controlled technical document',
      documents: [
        {
          fileName: 'Controlled Technical.pdf',
          bytes: textPdf([
            'Technical Submittal',
            'Project Name: Alpha Palace',
            'Product Datasheet',
            'Manufacturer: Synthetic Lighting',
            'Ordering Code: SL-100',
          ]),
          projectContextId: projectAId,
        },
      ],
      expected: ['ACCEPTABLE', 'ROUTING_ELIGIBLE_AFTER_OWNER_REVIEW'],
    },
  ];
}
export const SYNTHETIC_PROJECTS = [
  {
    id: projectA,
    projectCode: 'SYN-A',
    projectName: 'Alpha Palace',
    clientName: 'Synthetic Client A',
    siteLocation: 'Synthetic Site A',
  },
  {
    id: projectB,
    projectCode: 'SYN-B',
    projectName: 'Beta Palace',
    clientName: 'Synthetic Client B',
    siteLocation: 'Synthetic Site B',
  },
] as const;

export function createSearchableDocumentPdf(lines: readonly string[]): Buffer {
  return textPdf(lines);
}

/**
 * Synthetic bad-encoding PDF: paints a large quantity of native text through
 * a Type3 font with a broken glyph mapping (simulating missing ToUnicode /
 * custom encodings). Native extraction yields a HIGH character count whose
 * content is glyph soup and control codes - the exact case the universal
 * native-text quality gate must catch. Mirrors the real FLOS failure.
 */
export function createCorruptedEncodingDocumentPdf(): Buffer {
  const corrupted = String.fromCharCode(
    0x00,
    0x02,
    0x02,
    0x03,
    0x04,
    0x05,
    0x06,
    0x06,
    0x03,
    0x07,
    0x08,
    0x04,
    0x04,
    0x08,
    0x0e,
    0x0f,
    0x10,
    0x08,
    0x04,
    0x0f,
    0x11,
    0x08,
    0x12,
    0x06,
    0x06,
    0x13,
    0x0e,
    0x08,
    0x14,
    0x0e,
    0x06,
    0x03,
    0x07,
    0x08,
    0x15,
    0x16,
    0x11,
    0x02,
    0x06,
    0x04,
    0x17,
    0x18,
    0x19,
    0x03,
    0x18,
    0x1a,
    0x1b,
    0x18,
    0x03,
    0x0e,
    0x16,
    0x04,
    0x18,
    0x1c,
    0x1d,
    0x15,
    0x18,
    0x08,
    0x03,
    0x02,
    0x11,
    0x18,
    0x12,
    0x15,
    0x16,
    0x12,
    0x18,
    0x1b,
    0x1e,
    0x0f,
    0x1f,
    0x21,
    0x1b,
    0x0f,
    0x1f,
    0x06,
    0x1b,
    0x1e,
    0x0f,
    0x1f,
    0x21,
    0x1b,
    0x0f,
    0x1f,
    0x22,
    0x23,
    0x1b,
    0x23,
    0x23,
    0x24,
    0x25,
    0x0e,
    0x08,
    0x04,
    0x24,
    0x18,
    0x24,
    0x26,
    0x0f,
    0x27,
    0x28,
    0x29,
    0x24,
    0x1b,
    0x1b,
    0x23,
    0x2a,
    0x1b,
    0x1a,
    0x23,
    0x1b,
    0x2b,
    0x1f,
    0x24,
    0x18,
    0x24,
    0x2b,
    0x23,
    0x06,
    0x1e,
    0x06,
    0x23,
    0x1b,
    0x23,
    0x1e,
    0x03,
    0x07,
    0x08,
    0x04,
    0x04,
    0x08,
    0x0e,
    0x0f,
    0x10,
    0x08,
    0x04,
    0x0f,
    0x11,
    0x08,
    0x12,
    0x24,
    0x2c,
    0x24,
    0x08,
    0x2d,
    0x10,
    0x08,
    0x04,
    0x0f,
    0x11,
    0x08,
    0x12,
    0x24,
    0x2b,
    0x06,
    0x1b,
    0x1e,
    0x0f,
    0x1f,
    0x21,
    0x1b,
    0x0f,
    0x1f,
    0x2e,
    0x0e,
    0x11,
    0x19,
    0x2f,
    0x30,
    0x31,
    0x32,
    0x24,
    0x33,
    0x30,
    0x34,
    0x24,
    0x35,
    0x24,
    0x36,
    0x37,
    0x24,
    0x38,
    0x39,
    0x3a,
    0x31,
    0x24,
    0x3b,
    0x3c,
    0x3d,
    0x3e,
    0x3f,
    0x24,
    0x40,
    0x34,
    0x41,
    0x3c,
    0x42,
    0x24,
    0x43,
    0x3e,
    0x3f,
    0x3c,
    0x3a,
    0x44,
    0x45,
    0x46,
    0x47,
    0x48,
    0x49,
    0x4a,
    0x46,
    0x4b,
    0x24,
    0x4c,
    0x4d,
    0x24,
    0x4e,
    0x4f,
    0x50,
    0x51,
    0x24,
    0x52,
    0x53,
    0x54,
    0x55,
    0x48,
    0x56,
    0x46,
    0x54,
    0x56,
    0x57,
    0x53,
    0x58,
    0x59,
    0x20,
    0x5a,
    0x24,
    0x5b,
    0x5c,
    0x5d,
    0x5e,
    0x5f,
    0x60,
    0x61,
    0x24,
    0x18,
    0x5f,
    0x60,
    0x61,
    0x07,
    0x07,
    0x17,
    0x24,
    0x18,
    0x2b,
    0x21,
    0x62,
    0x24,
    0x18,
    0x1a,
    0x23,
    0x23,
    0x0e,
    0x12,
    0x24,
    0x18,
    0x21,
    0x1b,
    0x1b,
    0x24,
    0x18,
    0x64,
    0x65,
    0x27,
    0x66,
    0x24,
    0x2a,
    0x1b,
    0x24,
    0x18,
    0x2e,
    0x12,
    0x67,
    0x24,
    0x23,
    0x1e,
    0x65,
    0x11,
    0x04,
    0x04,
    0x15,
    0x24,
    0x0e,
    0x16,
    0x12,
    0x07,
    0x24,
    0x68,
    0x02,
    0x00,
    0x5f,
    0x60,
    0x61,
    0x24,
    0x0e,
    0x13,
    0x00,
    0x02,
    0x24,
    0x04,
    0x08,
    0x16,
    0x07,
    0x11,
    0x0f,
    0x24,
    0x26,
    0x08,
    0x68,
    0x07,
    0x24,
    0x04,
    0x16,
    0x03,
    0x03,
    0x0e,
    0x17,
    0x24,
    0x08,
    0x02,
    0x24,
    0x11,
    0x0e,
    0x16,
    0x15,
    0x15,
    0x0f,
    0x24,
    0x27,
    0x04,
    0x02,
    0x0e,
    0x0a,
  );
  const lines = Array.from({ length: 3 }, () => corrupted);
  const escaped = lines
    .map((line, index) => `BT /F1 13 Tf 56 ${740 - index * 24} Td (${escapePdf(line)}) Tj ET`)
    .join('\n');
  return pdf([
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    },
    {
      body: `<< /Length ${Buffer.byteLength(escaped, 'binary')} >>\nstream\n${escaped}\nendstream`,
    },
    {
      body: '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 800] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << >> /Encoding << /Type /Encoding /Differences [0 /a /b /c /d /e /f /g /h /i /j /k /l /m /n /o /p /q /r /s /t /u /v /w /x /y /z] >> >>',
    },
  ]);
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
export function createImageOnlyDocumentPdf(text: string): Buffer {
  const width = 1200,
    height = 320,
    scale = 12,
    pixels = Buffer.alloc(width * height, 255);
  let x = 24;
  const y = 80;
  for (const character of text.toUpperCase()) {
    if (character === ' ') {
      x += scale * 3;
      continue;
    }
    const glyph = GLYPHS[character] ?? GLYPHS['?']!;
    for (let row = 0; row < 7; row += 1)
      for (let column = 0; column < 5; column += 1)
        if (glyph[row]![column] === '1')
          for (let dy = 0; dy < scale; dy += 1)
            for (let dx = 0; dx < scale; dx += 1) {
              const px = x + column * scale + dx,
                py = y + row * scale + dy;
              if (px < width && py < height) pixels[py * width + px] = 0;
            }
    x += scale * 6;
  }
  const image = deflateSync(pixels);
  const content = 'q 1200 0 0 320 0 230 cm /Im0 Do Q';
  return pdf([
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 780] /Contents 5 0 R /Resources << /XObject << /Im0 4 0 R >> >> >>',
    },
    {
      prefix: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`,
      binary: image,
      suffix: '\nendstream',
    },
    { body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` },
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
const GLYPHS: Record<string, readonly string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '?': ['01110', '10001', '00010', '00100', '00100', '00000', '00100'],
};
