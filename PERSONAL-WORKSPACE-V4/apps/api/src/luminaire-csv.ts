import type { LuminaireImportPatch } from '@scli/contracts';
import { DomainError } from '@scli/domain';

function normalize(value: string): string {
  return value.trim().toUpperCase().split(/\s+/).join(' ');
}

type CsvDelimiter = ',' | '\t' | ';';

const dialuxInternalHeaders = new Set([
  'NUMBERTEXT',
  'MANUFNAMETEXT',
  'ARTICLENUMBERTEXT',
  'ARTICLENAMETEXT',
  'LUMINAIRELUMINOUSFLUXTEXT',
  'CONNECTEDLOADTEXT',
  'CCTTEXT',
  'CRITEXT',
]);

function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>([
    [',', 0],
    ['\t', 0],
    [';', 0],
  ]);
  let quoted = false;

  // Delimiters are selected from the first logical record, outside quoted
  // fields. This keeps detection source-driven and avoids decimal commas or
  // delimiters embedded in quoted product names influencing later rows.
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && character === '\n') break;
    else if (!quoted && counts.has(character as CsvDelimiter)) {
      const delimiter = character as CsvDelimiter;
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }

  return [...counts.entries()].reduce(
    (selected, candidate) => (candidate[1] > selected[1] ? candidate : selected),
    [',', 0] as [CsvDelimiter, number],
  )[0];
}

function parseRows(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += character;
    } else if (character === '"') quoted = true;
    else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') field += character;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim()));
}

function isNativeDialux(headers: Map<string, number>, delimiter: CsvDelimiter): boolean {
  if (delimiter !== ';' || !headers.has('TAGTEXT')) return false;
  let recognizedInternalHeaders = 0;
  for (const header of dialuxInternalHeaders) {
    if (headers.has(header)) recognizedInternalHeaders += 1;
  }
  return recognizedInternalHeaders >= 2;
}

function isDialuxNoValue(value: string): boolean {
  return value === '' || /^(?:-|[\u2013\u2014])$/u.test(value);
}

function normalizeDialuxCct(value: string): string {
  return value.replace(/^(\d{3,5})\s*K$/i, '$1K');
}

/**
 * Presence-aware luminaire import parser.
 *
 * Returns one patch per source row. A field is included in the patch ONLY when
 * the corresponding column exists in the source header. Absent columns are
 * omitted entirely so an import update can never clear a field the source did
 * not supply. An explicitly blank value in a present column is preserved as an
 * empty string so it remains distinguishable from an absent column.
 */
export function importLuminaireCsv(text: string): LuminaireImportPatch[] {
  const sourceText = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(sourceText);
  const rows = parseRows(sourceText, delimiter);
  if (rows.length < 2)
    throw new DomainError('VALIDATION_ERROR', 'The CSV has no luminaire rows.', 400);
  const headers = new Map<string, number>();
  rows[0]?.forEach((header, index) => headers.set(normalize(header), index));
  const nativeDialux = isNativeDialux(headers, delimiter);
  if (!headers.has('TAG') && !headers.has('TAGTEXT'))
    throw new DomainError(
      'VALIDATION_ERROR',
      'No supported luminaire Tag column was found. Accepted aliases: TAG, TAGText.',
      400,
    );

  // Returns the raw cell value when the column is present, or undefined when
  // the column is absent from the source header. This is the presence signal
  // that must survive parsing through preview and apply.
  const cell = (row: string[], names: string[], omitDialuxNoValue = false): string | undefined => {
    for (const name of names) {
      const index = headers.get(normalize(name));
      if (index !== undefined) {
        const value = row[index]?.trim() ?? '';
        return nativeDialux && omitDialuxNoValue && isDialuxNoValue(value) ? undefined : value;
      }
    }
    return undefined;
  };

  const records = rows.slice(nativeDialux ? 2 : 1).flatMap((row): LuminaireImportPatch[] => {
    const tag = cell(row, ['TAG', 'TAGText'], true);
    if (!tag) return [];

    const patch: LuminaireImportPatch = { tag };

    const category = cell(row, ['CATEGORY']);
    if (category !== undefined) patch.category = category;

    const imagePath = cell(row, ['IMAGE / REF', 'IMAGE']);
    if (imagePath !== undefined) patch.imagePath = imagePath;

    const description = cell(
      row,
      nativeDialux ? ['ArticleNameText'] : ['DESCRIPTION'],
      nativeDialux,
    );
    if (description !== undefined) patch.description = description;

    const manufacturer = cell(
      row,
      nativeDialux ? ['ManufNameText'] : ['MANUFACTURER'],
      nativeDialux,
    );
    if (manufacturer !== undefined) patch.manufacturer = manufacturer;

    const model = cell(
      row,
      nativeDialux ? ['ArticleNumberText'] : ['MODEL', 'MODEL NUMBER'],
      nativeDialux,
    );
    if (model !== undefined) patch.model = model;

    const wattage = cell(row, nativeDialux ? ['ConnectedLoadText'] : ['WATTAGE'], nativeDialux);
    if (wattage !== undefined) patch.wattage = wattage;

    const lumens = cell(
      row,
      nativeDialux ? ['LuminaireLuminousFluxText'] : ['LUMENS'],
      nativeDialux,
    );
    if (lumens !== undefined) patch.lumens = lumens;

    const lightColor = cell(
      row,
      nativeDialux ? ['CCTText'] : ['CCT / LIGHT COLOR', 'CCT', 'LIGHT COLOR'],
      nativeDialux,
    );
    if (lightColor !== undefined)
      patch.lightColor = nativeDialux ? normalizeDialuxCct(lightColor) : lightColor;

    const cri = cell(row, nativeDialux ? ['CRIText'] : ['CRI'], nativeDialux);
    if (cri !== undefined) patch.cri = cri;

    const beamAngle = cell(row, ['BEAM ANGLE']);
    if (beamAngle !== undefined) patch.beamAngle = beamAngle;

    const ipRating = cell(row, ['IP RATING', 'IP']);
    if (ipRating !== undefined) patch.ipRating = ipRating;

    const mounting = cell(row, ['MOUNTING']);
    if (mounting !== undefined) patch.mounting = mounting;

    const cutout = cell(row, ['CUTOUT']);
    if (cutout !== undefined) patch.cutout = cutout;

    const driver = cell(row, ['DRIVER']);
    if (driver !== undefined) patch.driver = driver;

    const control = cell(row, ['DIMMING / CONTROL', 'CONTROL']);
    if (control !== undefined) patch.control = control;

    const emergency = cell(row, ['EMERGENCY']);
    if (emergency !== undefined) patch.emergency = emergency;

    const datasheetPath = cell(row, ['DATASHEET LINK', 'DATASHEET']);
    if (datasheetPath !== undefined) patch.datasheetPath = datasheetPath;

    const location = cell(row, ['LOCATION / LEVEL', 'LOCATION']);
    if (location !== undefined) patch.location = location;

    const unit = cell(row, ['UNIT', 'UOM', 'UNIT OF MEASURE']);
    if (nativeDialux) patch.unit = 'No.';
    else if (unit !== undefined) patch.unit = unit || 'No.';

    const rawQuantity = cell(
      row,
      nativeDialux ? ['NumberText'] : ['QUANTITY', 'QTY'],
      nativeDialux,
    );
    if (rawQuantity !== undefined) {
      const quantity = Number.parseFloat(rawQuantity.replace(',', '.'));
      if (Number.isFinite(quantity)) patch.quantity = Math.max(0, quantity);
      else if (!nativeDialux) patch.quantity = 0;
    }

    const notes = cell(row, ['NOTES', 'REMARKS']);
    if (notes !== undefined) patch.notes = notes;

    const sourceName = cell(
      row,
      nativeDialux ? ['ArticleNameText'] : ['SOURCE NAME', 'SOURCE'],
      nativeDialux,
    );
    if (sourceName !== undefined) patch.sourceName = sourceName;

    const dimensions = cell(row, ['DIMENSIONS', 'SIZE']);
    if (dimensions !== undefined) patch.dimensions = dimensions;

    const bodyColorFinish = cell(row, ['BODY COLOR / FINISH', 'BODY COLOR', 'FINISH']);
    if (bodyColorFinish !== undefined) patch.bodyColorFinish = bodyColorFinish;

    return [patch];
  });
  if (!records.length)
    throw new DomainError('VALIDATION_ERROR', 'No valid TAG values were found.', 400);
  return records;
}
