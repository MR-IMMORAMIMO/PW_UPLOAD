import { deflateSync, inflateSync } from 'node:zlib';
import type {
  ResolvedDatasheetRegisterRow,
  ResolvedOutputEnvelope,
  ResolvedTechnicalScheduleLayout,
  ResolvedTechnicalScheduleRow,
} from '@scli/domain';
import { technicalScheduleCellValue } from '@scli/domain';

type PdfImage = {
  width: number;
  height: number;
  bytes: Buffer;
  filter: '/DCTDecode' | '/FlateDecode';
};
type Draw = {
  text?: string;
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
  image?: PdfImage;
  width?: number;
  height?: number;
};

function escapePdf(value: string): string {
  const windows1252 = new Map<number, number>([
    [0x20ac, 0x80],
    [0x201a, 0x82],
    [0x0192, 0x83],
    [0x201e, 0x84],
    [0x2026, 0x85],
    [0x2020, 0x86],
    [0x2021, 0x87],
    [0x02c6, 0x88],
    [0x2030, 0x89],
    [0x0160, 0x8a],
    [0x2039, 0x8b],
    [0x0152, 0x8c],
    [0x017d, 0x8e],
    [0x2018, 0x91],
    [0x2019, 0x92],
    [0x201c, 0x93],
    [0x201d, 0x94],
    [0x2022, 0x95],
    [0x2013, 0x96],
    [0x2014, 0x97],
    [0x02dc, 0x98],
    [0x2122, 0x99],
    [0x0161, 0x9a],
    [0x203a, 0x9b],
    [0x0153, 0x9c],
    [0x017e, 0x9e],
    [0x0178, 0x9f],
  ]);
  const encoded = Array.from(value.normalize('NFC'), (character) => {
    const code = character.codePointAt(0)!;
    if (code <= 0xff) return character;
    const mapped = windows1252.get(code);
    return mapped === undefined ? '?' : String.fromCharCode(mapped);
  }).join('');
  return encoded
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll(/[\r\n\t]+/g, ' ');
}

function clipped(value: unknown, length = 80): string {
  const text = String(value ?? '').trim() || '—';
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function technicalLabel(label: 'CRI' | 'IP', value: unknown): string {
  const text = clipped(value);
  return text.toUpperCase().startsWith(label) ? text : `${label} ${text}`;
}

function jpeg(data: Buffer): PdfImage | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1]!;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        width: data.readUInt16BE(offset + 7),
        height: data.readUInt16BE(offset + 5),
        bytes: data,
        filter: '/DCTDecode',
      };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function png(data: Buffer): PdfImage | null {
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
      interlace = chunk[12]!;
    }
    if (type === 'IDAT') idat.push(chunk);
    if (type === 'IEND') break;
    offset += length + 12;
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgb = Buffer.alloc(width * height * 3);
  let source = 0;
  let target = 0;
  let prior = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source++]!;
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source++]!;
      const left = x >= channels ? row[x - channels]! : 0;
      const up = prior[x]!;
      const upperLeft = x >= channels ? prior[x - channels]! : 0;
      row[x] =
        (value +
          (filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : filter === 4
                  ? paeth(left, up, upperLeft)
                  : 0)) &
        255;
    }
    for (let x = 0; x < width; x += 1) {
      const alpha = channels === 4 ? row[x * channels + 3]! / 255 : 1;
      for (let c = 0; c < 3; c += 1)
        rgb[target++] = Math.round(row[x * channels + c]! * alpha + 255 * (1 - alpha));
    }
    prior = row;
  }
  return { width, height, bytes: deflateSync(rgb), filter: '/FlateDecode' };
}

function imageFromDataUrl(value: string | null): PdfImage | null {
  if (!value) return null;
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[2]!, 'base64');
  return match[1] === 'image/png' ? png(bytes) : jpeg(bytes);
}

function rowText(
  row: ResolvedTechnicalScheduleRow,
  layout: ResolvedTechnicalScheduleLayout,
  lineLength: number,
): string[] {
  const lines = [
    `TYPE / IDENTITY: ${row.tag} | ${clipped(row.category, 28)}`,
    ...layout.groups.map(
      (group) =>
        `${group.label.toUpperCase()}: ${group.columns
          .map(
            (column) =>
              `${column.label} ${String(
                technicalScheduleCellValue(row, column.fieldKey) || '—',
              ).trim()}`,
          )
          .join(' | ')}`,
    ),
  ];
  return lines.flatMap((line) => {
    const wrapped: string[] = [];
    let remainder = line;
    while (remainder.length > lineLength) {
      const boundary = remainder.lastIndexOf(' ', lineLength);
      const splitAt = boundary > lineLength * 0.6 ? boundary : lineLength;
      wrapped.push(remainder.slice(0, splitAt).trimEnd());
      remainder = remainder.slice(splitAt).trimStart();
    }
    wrapped.push(remainder);
    return wrapped;
  });
}

function title(envelope: ResolvedOutputEnvelope): string {
  return (
    {
      LuminaireSchedule: 'TECHNICAL LUMINAIRE SCHEDULE',
      PresentationSchedule: 'PRESENTATION LUMINAIRE SCHEDULE',
      TechnicalBoq: 'TECHNICAL LIGHTING BOQ / QUANTITY TAKE-OFF',
      DatasheetRegister: 'DATASHEET REGISTER',
    } as const
  )[envelope.outputKind];
}

function pageDraws(
  envelope: ResolvedOutputEnvelope,
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
): Draw[] {
  const page = envelope.pages[pageIndex]!;
  const draws: Draw[] = [];
  const header = `${title(envelope)}  ·  ${envelope.project.projectCode}  ·  ${envelope.project.projectName}`;
  if (envelope.template.headerSettings.visible)
    draws.push({ text: header, x: 36, y: pageHeight - 36, size: 13, bold: true });
  const logo = envelope.template.logoVisible
    ? imageFromDataUrl(envelope.branding.logoDataUrl)
    : null;
  if (logo && envelope.template.headerSettings.visible)
    draws.push({ image: logo, x: pageWidth - 126, y: pageHeight - 58, width: 90, height: 30 });
  draws.push({
    text: `Client: ${clipped(envelope.project.clientName)}   Issue: ${clipped(envelope.issueStatus)}   Date: ${envelope.issueDate}   ${envelope.revision.revisionLabel}   ${envelope.template.displayName} ${envelope.template.versionId}`,
    x: 36,
    y: pageHeight - 54,
    size: 8,
  });
  let y = pageHeight - 82;
  if (page.kind === 'LuminaireSchedule') {
    const rowHeight = (pageHeight - 130) / Math.max(1, page.rows.length);
    for (const row of page.rows) {
      const picture = imageFromDataUrl(row.image.dataUrl);
      const imageWidth = Math.min(92, Math.max(58, page.layout.imageWidth));
      if (picture && page.layout.showImage)
        draws.push({ image: picture, x: 40, y: y - 70, width: imageWidth, height: 62 });
      let lineY = y;
      for (const [index, line] of rowText(
        row,
        page.layout,
        page.layout.showImage ? 148 : 172,
      ).entries()) {
        draws.push({
          text: line,
          x: page.layout.showImage ? 148 : 40,
          y: lineY,
          size: index === 0 ? 9 : 6.9,
          bold: index === 0,
        });
        lineY -= 12;
      }
      y -= rowHeight;
    }
  } else if (page.kind === 'PresentationSchedule') {
    const cardHeight = (pageHeight - 120) / Math.max(1, page.products.length);
    for (const row of page.products) {
      const picture = imageFromDataUrl(row.image.dataUrl);
      if (picture)
        draws.push({
          image: picture,
          x: 44,
          y: y - cardHeight + 18,
          width: Math.min(210, pageWidth * 0.32),
          height: cardHeight - 26,
        });
      draws.push({
        text: `${row.tag}  ${row.manufacturer} ${row.model}`,
        x: pageWidth * 0.39,
        y: y - 10,
        size: 12,
        bold: true,
      });
      draws.push({ text: clipped(row.description, 95), x: pageWidth * 0.39, y: y - 30, size: 8 });
      draws.push({
        text: `${clipped(row.wattage)} · ${clipped(row.lumens)} · ${clipped(row.lightColor)} · ${technicalLabel('CRI', row.cri)} · ${clipped(row.beamAngle)}`,
        x: pageWidth * 0.39,
        y: y - 48,
        size: 8,
      });
      draws.push({
        text: `${clipped(row.mounting)} · ${clipped(row.control)} · ${technicalLabel('IP', row.ipRating)} · Qty ${row.quantity} · ${clipped(row.location)}`,
        x: pageWidth * 0.39,
        y: y - 66,
        size: 8,
      });
      y -= cardHeight;
    }
  } else if (page.kind === 'TechnicalBoq') {
    draws.push({
      text: 'Type / Tag     Manufacturer / Model                              Unit       Quantity',
      x: 36,
      y,
      size: 7.2,
      bold: true,
    });
    y -= 18;
    for (const group of page.groups) {
      draws.push({ text: group.category, x: 36, y, size: 9, bold: true });
      y -= 15;
      for (const row of group.rows) {
        draws.push({
          text: `${clipped(row.tag, 14).padEnd(15)} ${clipped(`${row.manufacturer} ${row.model}`, 42).padEnd(43)} ${clipped(row.unit, 8).padEnd(9)} ${row.quantity}`,
          x: 36,
          y,
          size: 7,
        });
        y -= 11;
        draws.push({
          text: `Description: ${clipped(row.description, 48)} | Technical: ${clipped(`${row.wattage} ${row.lumens} ${row.lightColor} ${technicalLabel('CRI', row.cri)} ${row.beamAngle} ${row.mounting} ${row.control} ${technicalLabel('IP', row.ipRating)}`, 78)} | Location: ${clipped(row.location, 28)} | Notes: ${clipped(row.notes, 35)}`,
          x: 52,
          y,
          size: 6.4,
        });
        y -= 14;
      }
      for (const [unit, total] of Object.entries(group.totalsByUnit)) {
        draws.push({
          text: `${group.category} subtotal: ${total} ${unit}`,
          x: 52,
          y,
          size: 7,
          bold: true,
        });
        y -= 13;
      }
    }
    if (pageIndex === envelope.pages.length - 1) {
      for (const [unit, total] of Object.entries(envelope.unitTotals)) {
        draws.push({
          text: `FINAL QUANTITY TOTAL: ${total} ${unit}`,
          x: 36,
          y,
          size: 8,
          bold: true,
        });
        y -= 14;
      }
    }
  } else {
    draws.push({
      text: 'Type / Tag        Manufacturer / Model                                Registered datasheet                                 Status',
      x: 36,
      y,
      size: 8,
      bold: true,
    });
    y -= 20;
    for (const row of page.rows as ResolvedDatasheetRegisterRow[]) {
      draws.push({
        text: `${clipped(row.tag, 16).padEnd(18)} ${clipped(`${row.manufacturer} ${row.model}`, 42).padEnd(44)} ${clipped(row.datasheet.fileName, 48).padEnd(50)} ${row.datasheet.status}`,
        x: 36,
        y,
        size: 7.2,
      });
      y -= 17;
      if (row.notes.trim()) {
        draws.push({ text: `Notes: ${clipped(row.notes, 110)}`, x: 52, y, size: 6.5 });
        y -= 11;
      }
    }
  }
  if (envelope.template.footerSettings.visible)
    draws.push({
      text: `${envelope.branding.companyName || 'SCIENTECHNIC LIGHTING'}  ·  ${envelope.branding.designerName || 'Lighting Design'}  ·  Page ${pageIndex + 1} of ${envelope.pages.length}`,
      x: 36,
      y: 24,
      size: 7,
    });
  return draws;
}

export function serializeProfessionalPdf(envelope: ResolvedOutputEnvelope): Buffer {
  const size: [number, number] = envelope.pageSize === 'A3' ? [841.89, 1190.55] : [595.28, 841.89];
  const [pageWidth, pageHeight]: [number, number] =
    envelope.orientation === 'Landscape' ? [size[1], size[0]] : size;
  const objects: Buffer[] = [];
  const add = (value: Buffer | string): number => (
    objects.push(Buffer.isBuffer(value) ? value : Buffer.from(value, 'binary')),
    objects.length
  );
  const font = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const bold = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  const pagesRef = add('PAGES_PLACEHOLDER');
  const pageRefs: number[] = [];
  for (let index = 0; index < Math.max(1, envelope.pages.length); index += 1) {
    const draws = envelope.pages.length ? pageDraws(envelope, index, pageWidth, pageHeight) : [];
    const imageRefs: Array<{ name: string; ref: number; image: PdfImage }> = [];
    for (const draw of draws)
      if (draw.image) {
        const image = draw.image;
        const ref = add(
          Buffer.concat([
            Buffer.from(
              `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${image.filter} /Length ${image.bytes.length} >>\nstream\n`,
              'binary',
            ),
            image.bytes,
            Buffer.from('\nendstream', 'binary'),
          ]),
        );
        imageRefs.push({ name: `Im${imageRefs.length + 1}`, ref, image });
      }
    let imageCursor = 0;
    const commands: string[] = ['0.12 0.16 0.22 rg'];
    for (const draw of draws) {
      if (draw.image) {
        const item = imageRefs[imageCursor++]!;
        commands.push(
          `q ${draw.width} 0 0 ${draw.height} ${draw.x} ${draw.y} cm /${item.name} Do Q`,
        );
      } else
        commands.push(
          `BT /${draw.bold ? 'FB' : 'FR'} ${draw.size ?? 8} Tf 1 0 0 1 ${draw.x} ${draw.y} Tm (${escapePdf(draw.text ?? '')}) Tj ET`,
        );
    }
    const stream = Buffer.from(commands.join('\n'), 'binary');
    const content = add(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'binary'),
        stream,
        Buffer.from('\nendstream', 'binary'),
      ]),
    );
    const xobjects = imageRefs.length
      ? `/XObject << ${imageRefs.map((item) => `/${item.name} ${item.ref} 0 R`).join(' ')} >>`
      : '';
    pageRefs.push(
      add(
        `<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /FR ${font} 0 R /FB ${bold} 0 R >> ${xobjects} >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[pagesRef - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`,
    'binary',
  );
  const catalog = add(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);
  const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0];
  let cursor = chunks[0]!.length;
  objects.forEach((object, index) => {
    offsets.push(cursor);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'binary'),
      object,
      Buffer.from('\nendobj\n', 'binary'),
    ]);
    chunks.push(chunk);
    cursor += chunk.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
  ].join('');
  chunks.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${cursor}\n%%EOF`,
      'binary',
    ),
  );
  return Buffer.concat(chunks);
}
