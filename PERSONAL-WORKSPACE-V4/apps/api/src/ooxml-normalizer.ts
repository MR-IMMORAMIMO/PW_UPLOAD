import JSZip from 'jszip';

/**
 * OOXML worksheet element order (CT_Worksheet): dimension, sheetViews,
 * sheetFormatPr, cols, sheetData, autoFilter, ... mergeCells, ... drawing.
 *
 * The local luminaire exporter emits `mergeCells` BEFORE `autoFilter`, which
 * violates this ordering. Microsoft Excel treats the package as corrupted and
 * shows the "We found a problem with some content" repair/recovery prompt.
 *
 * This module applies a surgical, order-only normalisation to the worksheet
 * parts of a generated workbook. All other ZIP entries are preserved
 * byte-for-byte so product behaviour (styles, images, drawings, print setup,
 * shared strings) is untouched.
 */

const WORKSHEET_PART = /^xl\/worksheets\/sheet\d+\.xml$/;

const MERGE_CELLS_RE = /<mergeCells\b[\s\S]*?<\/mergeCells>/;
const AUTO_FILTER_RE = /<autoFilter\b[^>]*\/?>/;

/**
 * Move `autoFilter` before `mergeCells` in a worksheet XML body when they are
 * out of order. Returns the original string unchanged if no reordering is
 * required or neither element is present.
 */
export function normalizeWorksheetOrdering(xml: string): string {
  const merge = xml.match(MERGE_CELLS_RE);
  const autoFilter = xml.match(AUTO_FILTER_RE);
  if (!merge || !autoFilter || merge.index === undefined || autoFilter.index === undefined) {
    return xml;
  }
  // Only reorder when mergeCells precedes autoFilter (invalid order).
  if (merge.index > autoFilter.index) {
    return xml;
  }
  // Remove mergeCells first (its index is the only one that stays valid).
  const withoutMerge = xml.slice(0, merge.index) + xml.slice(merge.index + merge[0].length);
  // Reinsert mergeCells immediately after autoFilter.
  const afPos = withoutMerge.indexOf(autoFilter[0], 0);
  if (afPos === -1) {
    return xml;
  }
  const insertAt = afPos + autoFilter[0].length;
  return withoutMerge.slice(0, insertAt) + merge[0] + withoutMerge.slice(insertAt);
}

/**
 * Rewrite the worksheet parts of an .xlsx file in place so `autoFilter`
 * precedes `mergeCells`. Other parts are preserved verbatim.
 */
export async function normalizeWorkbookOrdering(xlsxPath: string): Promise<void> {
  const data = await import('node:fs/promises').then(({ readFile }) => readFile(xlsxPath));
  const zip = await JSZip.loadAsync(data);

  let changed = false;
  for (const name of Object.keys(zip.files)) {
    if (!WORKSHEET_PART.test(name) || zip.files[name]!.dir) {
      continue;
    }
    const xml = await zip.files[name]!.async('string');
    const normalized = normalizeWorksheetOrdering(xml);
    if (normalized !== xml) {
      zip.file(name, normalized);
      changed = true;
    }
  }

  if (changed) {
    const out = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(xlsxPath, out);
  }
}

/**
 * Returns true when every worksheet part conforms to the autoFilter-before-
 * mergeCells ordering. Used as a deterministic, Excel-free validity assertion.
 */
export async function worksheetOrderingIsValid(xlsxPath: string): Promise<boolean> {
  const { readFile } = await import('node:fs/promises');
  const zip = await JSZip.loadAsync(await readFile(xlsxPath));
  let ok = true;
  for (const name of Object.keys(zip.files)) {
    if (!WORKSHEET_PART.test(name) || zip.files[name]!.dir) {
      continue;
    }
    const xml = await zip.files[name]!.async('string');
    if (normalizeWorksheetOrdering(xml) !== xml) {
      ok = false;
    }
  }
  return ok;
}
