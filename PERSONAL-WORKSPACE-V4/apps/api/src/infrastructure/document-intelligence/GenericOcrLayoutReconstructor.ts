/**
 * Generic OCR Layout Reconstructor (P5C universal PDF normalization, final delta).
 *
 * Turns tesseract.js word-level geometry into a safe structured representation
 * that lets the EXISTING generic semantic engine recover label/value
 * relationships from common multi-column and table-style technical Datasheets.
 *
 * This component is MANUFACTURER-AGNOSTIC: it consumes only word text,
 * confidence, bounding boxes and page dimensions. There is no filename,
 * manufacturer, or product vocabulary anywhere in this module. It owns WHERE
 * text belongs, never WHAT an engineering field means (the semantic rules
 * keep that authority).
 *
 * Pipeline per OCR page:
 *   words -> visual lines (vertical-overlap grouping)
 *         -> cells (split at significant horizontal gaps)
 *         -> column bands (recurring x-start alignment)
 *         -> table rows (label/value pairs or header/row tables)
 *         -> canonical lines (pipe-joined cells for table rows)
 *
 * The canonical lines feed the existing semantic engine; the original flat
 * OCR text is preserved untouched for backward compatibility.
 */

import type { OcrRegion, OcrWord } from './LocalOcrAdapter.js';

export interface ReconstructedOcrCell {
  /** Cell text: words joined with single spaces. */
  text: string;
  /** Minimum word confidence inside the cell (0..100). */
  confidence: number;
  bbox: OcrRegion;
}

export interface ReconstructedOcrLine {
  /** Original words ordered left-to-right. */
  words: readonly OcrWord[];
  bbox: OcrRegion;
  /** Minimum word confidence on the line (0..100). */
  confidence: number;
  /** Space-joined original text of the line (unchanged words). */
  text: string;
  /** Cells split at significant horizontal gaps. */
  cells: readonly ReconstructedOcrCell[];
  /** True when the line was emitted as a structured table row (pipe-joined). */
  tableRow: boolean;
  /**
   * Canonical line text: cells joined with " | " for table rows, otherwise
   * the words joined with single spaces. This is what the semantic engine
   * consumes instead of the flattened merged OCR line.
   */
  canonical: string;
}

export interface ReconstructedOcrColumnBand {
  /** Representative x start (px) of the band. */
  xStart: number;
  /** Representative x end (px) of the band. */
  xEnd: number;
  /** Number of cells aligned to this band at distinct y positions. */
  occurrences: number;
}

export interface ReconstructedOcrPage {
  pageNumber: number;
  width: number;
  height: number;
  method: 'OCR';
  lines: readonly ReconstructedOcrLine[];
  columnBands: readonly ReconstructedOcrColumnBand[];
  /** Number of lines emitted as structured table rows. */
  tableRows: number;
}

/** Gaps above this share of page width always split cells. */
const MAX_CELL_GAP_RATIO = 0.03;
/** Gap multiplier relative to the line's median word width. */
const CELL_GAP_WIDTH_MULTIPLIER = 1.2;
/** x-start clustering tolerance as a share of page width. */
const BAND_TOLERANCE_RATIO = 0.02;
/** Minimum distinct-y occurrences for a column band to exist. */
const BAND_MIN_OCCURRENCES = 2;
/** Minimum y separation (as share of page height) for distinct occurrences. */
const BAND_Y_SEPARATION_RATIO = 0.015;
/** y-window (as share of page height) for header/row table neighbors. */
const TABLE_NEIGHBOR_WINDOW_RATIO = 0.05;
/** Confidence below which a word is treated as unreliable for pairing. */
const LOW_CONFIDENCE_THRESHOLD = 40;
/** Maximum visual line height as a share of page height. Prevents cascading
 * merges of words from parallel rows whose y-ranges overlap slightly. */
const LINE_HEIGHT_CAP_RATIO = 0.04;
/** Multiplier on the median word height for the line height cap. */
const LINE_HEIGHT_CAP_MULTIPLIER = 3.5;
/** OCR noise characters stripped from cell text to improve label matching.
 *  Trademark/copyright symbols are OCR misreads of graphic icons. The degree
 *  symbol (°) is NOT stripped — it is structurally meaningful for beam/field
 *  angles and temperature values. */
const OCR_NOISE = /[\u00ae\u00a9\u2122]/g;

/** Value-like cell typing: digit-leading values, units, yes/no, IP codes. */
const VALUE_LIKE = /^[>≥]?\s*\d[\d.,\s°-]*[a-zA-Zµ%°/]*$/;
const VALUE_WORD =
  /^(?:yes|no|none|black|white|grey|gray|silver|bronze|gold|clear|dali|casambi|bluetooth|dimmed|non|symmetric|asymmetric|direct|indirect|wide\s+flood|narrow\s+flood|extra\s+wide\s+flood|medium\s+flood|flood|wide|narrow|narrow\s+spot|very\s+narrow\s+spot|spot|wall\s+wash|wallwasher|batwing)$/i;
const IP_VALUE = /^ip\s*\d{2,3}$/i;

export function isValueLikeCell(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (VALUE_LIKE.test(trimmed)) return true;
  if (VALUE_WORD.test(trimmed)) return true;
  if (IP_VALUE.test(trimmed)) return true;
  return false;
}

/** Text-like cell typing: contains at least two letters (a label, not a value). */
export function isTextLikeCell(text: string): boolean {
  return /[A-Za-z]{2,}/.test(text.trim());
}

/**
 * A cell is label-like for table-row purposes when it reads as a label and
 * is not a URL/footer artifact. URLs (long, contain ://) and oversized cells
 * never become table labels.
 */
function isLabelLikeCell(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return false;
  if (/:\/\//.test(trimmed)) return false;
  return isTextLikeCell(trimmed);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function regionWidth(region: OcrRegion): number {
  return Math.max(1, region.width);
}

export class GenericOcrLayoutReconstructor {
  public static readonly version = 'generic-ocr-layout-v2';

  /** Normalized cell text: OCR noise stripped for label matching. */
  private normalizeCellText(text: string): string {
    return text.replace(OCR_NOISE, '').replace(/\s+/g, ' ').trim();
  }

  public reconstruct(input: {
    pageNumber: number;
    width: number;
    height: number;
    words: readonly OcrWord[];
  }): ReconstructedOcrPage {
    const { pageNumber, width, height, words } = input;
    const usable = words.filter((word) => word.text.trim().length > 0);

    // 1. Visual lines: group words whose vertical ranges overlap, bounded by
    //    a height cap so parallel rows with slight y-overlap don't cascade.
    const rawLines: Array<Omit<ReconstructedOcrLine, 'tableRow' | 'canonical'>> = [];
    const sorted = [...usable].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    const medianHeight = median(sorted.map((w) => Math.max(1, w.bbox.height)));
    const lineCap = Math.max(
      LINE_HEIGHT_CAP_RATIO * height,
      LINE_HEIGHT_CAP_MULTIPLIER * medianHeight,
    );
    let current: OcrWord[] = [];
    let currentTop = 0;
    let currentBottom = 0;
    const flush = () => {
      if (current.length === 0) return;
      const ordered = [...current].sort((a, b) => a.bbox.x - b.bbox.x);
      rawLines.push(this.buildLine(ordered, width));
      current = [];
    };
    for (const word of sorted) {
      const top = word.bbox.y;
      const bottom = word.bbox.y + word.bbox.height;
      const wouldHeight = Math.max(bottom, currentBottom) - Math.min(top, currentTop);
      // Reject a word that would inflate the line beyond the height cap, even
      // if its y-range overlaps the current line. This prevents cascading merges
      // of parallel rows from different visual bands.
      if (current.length > 0 && wouldHeight > lineCap) {
        flush();
      } else if (
        current.length > 0 &&
        (top > currentBottom || bottom < currentTop) &&
        Math.min(bottom, currentBottom) - Math.max(top, currentTop) <= 0
      ) {
        flush();
      }
      if (current.length === 0) {
        currentTop = top;
        currentBottom = bottom;
      } else {
        currentTop = Math.min(currentTop, top);
        currentBottom = Math.max(currentBottom, bottom);
      }
      current.push(word);
    }
    flush();

    // 2. Column bands: cluster cell x-starts across the page at distinct y.
    const bands = this.detectColumnBands(rawLines, width, height);

    // 3. Table row reconstruction (canonical text + structured flag).
    const lines: ReconstructedOcrLine[] = rawLines.map((line) => {
      const canonical = this.canonicalForLine(line, rawLines, width, height);
      return { ...line, canonical: canonical.text, tableRow: canonical.tableRow };
    });
    // tableRows counts the EMITTED rows (a four-cell line emits two rows).
    const tableRows = lines.reduce(
      (total, line) =>
        total + (line.tableRow ? line.canonical.split('\n').filter(Boolean).length : 0),
      0,
    );

    return {
      pageNumber,
      width,
      height,
      method: 'OCR',
      lines,
      columnBands: bands,
      tableRows,
    };
  }

  private buildLine(words: readonly OcrWord[], pageWidth: number): ReconstructedOcrLine {
    const x0 = Math.min(...words.map((w) => w.bbox.x));
    const y0 = Math.min(...words.map((w) => w.bbox.y));
    const x1 = Math.max(...words.map((w) => w.bbox.x + w.bbox.width));
    const y1 = Math.max(...words.map((w) => w.bbox.y + w.bbox.height));
    const bbox = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const confidence = Math.min(...words.map((w) => w.confidence));
    const rawText = words
      .map((w) => w.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Normalize OCR noise (trademark/copyright symbols) from the line text
    // so the semantic engine receives clean labels and values. The degree
    // symbol (°) is preserved as it is structurally meaningful.
    const text = this.normalizeCellText(rawText);

    // Cells: split at significant horizontal gaps.
    const widths = words.map((w) => regionWidth(w.bbox));
    const gapThreshold = Math.max(
      MAX_CELL_GAP_RATIO * pageWidth,
      CELL_GAP_WIDTH_MULTIPLIER * median(widths),
    );
    const cells: ReconstructedOcrCell[] = [];
    let cellWords: OcrWord[] = [];
    let cellX1 = 0;
    for (const word of words) {
      if (cellWords.length === 0) {
        cellWords.push(word);
        cellX1 = word.bbox.x + word.bbox.width;
        continue;
      }
      const gap = word.bbox.x - cellX1;
      if (gap > gapThreshold) {
        cells.push(this.buildCell(cellWords));
        cellWords = [word];
      } else {
        cellWords.push(word);
      }
      cellX1 = word.bbox.x + word.bbox.width;
    }
    if (cellWords.length > 0) cells.push(this.buildCell(cellWords));

    return { words, bbox, confidence, text, cells, tableRow: false, canonical: text };
  }

  private buildCell(words: readonly OcrWord[]): ReconstructedOcrCell {
    const x0 = Math.min(...words.map((w) => w.bbox.x));
    const y0 = Math.min(...words.map((w) => w.bbox.y));
    const x1 = Math.max(...words.map((w) => w.bbox.x + w.bbox.width));
    const y1 = Math.max(...words.map((w) => w.bbox.y + w.bbox.height));
    const raw = words
      .map((w) => w.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      text: this.normalizeCellText(raw),
      confidence: Math.min(...words.map((w) => w.confidence)),
      bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    };
  }

  private detectColumnBands(
    lines: ReadonlyArray<Omit<ReconstructedOcrLine, 'canonical' | 'tableRow'>>,
    pageWidth: number,
    pageHeight: number,
  ): ReconstructedOcrColumnBand[] {
    const tolerance = Math.max(BAND_TOLERANCE_RATIO * pageWidth, 30);
    const minYSeparation = BAND_Y_SEPARATION_RATIO * pageHeight;
    const occurrences = new Map<number, Array<{ y: number; xEnd: number }>>();
    const order: number[] = [];
    for (const line of lines) {
      for (const cell of line.cells) {
        const y = cell.bbox.y + cell.bbox.height / 2;
        // Nearest existing cluster.
        let bestKey: number | undefined;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const key of order) {
          const distance = Math.abs(key - cell.bbox.x);
          if (distance <= tolerance && distance < bestDistance) {
            bestKey = key;
            bestDistance = distance;
          }
        }
        if (bestKey === undefined) {
          bestKey = cell.bbox.x;
          order.push(bestKey);
          occurrences.set(bestKey, []);
        }
        const bucket = occurrences.get(bestKey)!;
        // Distinct y occurrences only.
        if (!bucket.some((entry) => Math.abs(entry.y - y) < minYSeparation)) {
          bucket.push({ y, xEnd: cell.bbox.x + cell.bbox.width });
        }
      }
    }
    const bands: ReconstructedOcrColumnBand[] = [];
    for (const key of order) {
      const bucket = occurrences.get(key)!;
      if (bucket.length >= BAND_MIN_OCCURRENCES) {
        bands.push({
          xStart: key,
          xEnd: Math.max(...bucket.map((entry) => entry.xEnd)),
          occurrences: bucket.length,
        });
      }
    }
    return bands.sort((a, b) => a.xStart - b.xStart);
  }

  /**
   * Emits the canonical text for a line:
   * - exactly 2 cells with a value-like right cell -> "label | value" row
   * - exactly 4 cells alternating text/value -> two "label | value" rows
   * - 3+ cells aligned with neighboring lines at the same bands -> pipe-joined table rows
   * - otherwise the plain space-joined words (never a structured row)
   */
  private canonicalForLine(
    line: Omit<ReconstructedOcrLine, 'canonical' | 'tableRow'>,
    allLines: ReadonlyArray<Omit<ReconstructedOcrLine, 'canonical' | 'tableRow'>>,
    pageWidth: number,
    pageHeight: number,
  ): { text: string; tableRow: boolean } {
    const cells = line.cells;
    if (cells.length === 2) {
      const [left, right] = cells as [ReconstructedOcrCell, ReconstructedOcrCell];
      if (
        isLabelLikeCell(left.text) &&
        isValueLikeCell(right.text) &&
        right.confidence >= LOW_CONFIDENCE_THRESHOLD
      ) {
        return { text: `${left.text} | ${right.text}`, tableRow: true };
      }
      return { text: line.text, tableRow: false };
    }
    if (cells.length >= 4 && cells.length % 2 === 0) {
      const pairs = Array.from(
        { length: cells.length / 2 },
        (_, index) => [cells[index * 2]!, cells[index * 2 + 1]!] as const,
      );
      if (
        pairs.every(
          ([left, right]) =>
            isLabelLikeCell(left.text) &&
            isValueLikeCell(right.text) &&
            right.confidence >= LOW_CONFIDENCE_THRESHOLD,
        )
      ) {
        return {
          text: pairs.map(([left, right]) => `${left.text} | ${right.text}`).join('\n'),
          tableRow: true,
        };
      }
      return { text: line.text, tableRow: false };
    }
    if (cells.length >= 3) {
      // Header/row table: does a neighboring line share >= 2 of these bands?
      const xStarts = cells.map((cell) => cell.bbox.x);
      const yCenter = line.bbox.y + line.bbox.height / 2;
      const windowY = TABLE_NEIGHBOR_WINDOW_RATIO * pageHeight;
      const neighbors = allLines.filter(
        (candidate) =>
          candidate !== line &&
          Math.abs(candidate.bbox.y + candidate.bbox.height / 2 - yCenter) <= windowY,
      );
      const shared = (candidate: Omit<ReconstructedOcrLine, 'canonical' | 'tableRow'>) => {
        const candidateStarts = new Set(candidate.cells.map((cell) => cell.bbox.x));
        return xStarts.filter((x) =>
          [...candidateStarts].some(
            (other) => Math.abs(other - x) <= Math.max(BAND_TOLERANCE_RATIO * pageWidth, 30),
          ),
        ).length;
      };
      if (neighbors.some((candidate) => shared(candidate) >= 2)) {
        return {
          text: cells.map((cell) => cell.text).join(' | '),
          tableRow: true,
        };
      }
    }
    return { text: line.text, tableRow: false };
  }
}
