import { readFile } from 'node:fs/promises';
import DOMMatrixShim from '@thednp/dommatrix';
import { DOCUMENT_INTELLIGENCE_LIMITS } from '@scli/domain';
import {
  assessNativeTextQuality,
  type NativeTextQualityAssessment,
} from './NativeTextQualityGate.js';

let parserModule: Promise<typeof import('pdf-parse')> | null = null;
async function loadParser(): Promise<typeof import('pdf-parse')> {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    Object.defineProperty(globalThis, 'DOMMatrix', {
      value: DOMMatrixShim as unknown as typeof globalThis.DOMMatrix,
      configurable: true,
      writable: true,
    });
  }
  parserModule ??= import('pdf-parse');
  return parserModule;
}

export interface ExtractedPdfPage {
  ocrNumericReviews?: import('./NumericOcrReview.js').NumericOcrReview[];
  pageNumber: number;
  text: string;
  usableTextCharacters: number;
  needsOcr: boolean;
  /**
   * Deterministic native-text quality assessment from the universal quality
   * gate. Present whenever the adapter extracted the page natively; absent
   * only for synthetic hand-built pages in tests.
   */
  nativeQuality?: NativeTextQualityAssessment;
  ocrRegions?: ReadonlyArray<{
    text: string;
    confidence: number;
    region: Readonly<{ x: number; y: number; width: number; height: number }>;
  }>;
  /**
   * Best-effort structured table evidence preserved from the native PDF stack.
   * Each entry is a table: an array of rows, each row an array of cell strings.
   * Only present when the PDF exposes vector-drawn table grids. The flattened
   * page text remains the primary evidence; this is supplementary structure.
   */
  tables?: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>;
}

export interface ExtractedPdfDocument {
  pageCount: number;
  capped: boolean;
  pages: ExtractedPdfPage[];
}

export class PdfExtractionAdapter {
  public async images(filePath: string, pageNumber: number) {
    const { PDFParse } = await loadParser();
    const parser = new PDFParse({ data: await readFile(filePath) });
    try {
      const result = await parser.getImage({
        partial: [pageNumber],
        imageThreshold: 80,
        imageBuffer: true,
        imageDataUrl: false,
      });
      return result.pages
        .flatMap((page) =>
          page.images.map((image) => ({
            pageNumber: page.pageNumber,
            width: image.width,
            height: image.height,
            bytes: Buffer.from(image.data),
          })),
        )
        .filter(
          (image) =>
            image.width * image.height <= DOCUMENT_INTELLIGENCE_LIMITS.previewPixels &&
            image.bytes.length <= 5_000_000,
        )
        .slice(0, 12);
    } finally {
      await parser.destroy();
    }
  }
  public static readonly version = 'pdf-parse-2.4.5:p5c-3';

  public async extract(filePath: string): Promise<ExtractedPdfDocument> {
    const buffer = await readFile(filePath);
    const { PDFParse } = await loadParser();
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText({ first: DOCUMENT_INTELLIGENCE_LIMITS.nativePages });
      const tablesByPage = new Map<number, ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>>();
      try {
        const tableResult = await parser.getTable({
          first: DOCUMENT_INTELLIGENCE_LIMITS.nativePages,
        });
        for (const page of tableResult.pages) {
          if (page.tables.length > 0) tablesByPage.set(page.num, page.tables);
        }
      } catch {
        // Table detection is best-effort; the flattened page text remains authoritative.
      }
      return {
        pageCount: result.total,
        capped: result.total > DOCUMENT_INTELLIGENCE_LIMITS.nativePages,
        pages: result.pages.map((page) => {
          const usableTextCharacters = page.text.replace(/\s+/g, '').length;
          const tables = tablesByPage.get(page.num);
          // Universal native-text quality gate: OCR must run when the text is
          // semantically unreadable, NOT merely when it is short. A page full
          // of undecodable glyph garbage (Type3 / no-ToUnicode encodings) has a
          // high character count but fails the quality gate.
          const nativeQuality = assessNativeTextQuality(page.text);
          return {
            pageNumber: page.num,
            text: page.text,
            usableTextCharacters,
            needsOcr: nativeQuality.decision === 'OCR_REQUIRED',
            nativeQuality,
            ...(tables ? { tables } : {}),
          };
        }),
      };
    } finally {
      await parser.destroy();
    }
  }

  public async renderPage(
    filePath: string,
    pageNumber: number,
    desiredWidth: number = DOCUMENT_INTELLIGENCE_LIMITS.previewWidth,
  ): Promise<{
    png: Buffer;
    width: number;
    height: number;
    pageNumber: number;
  }> {
    const buffer = await readFile(filePath);
    const { PDFParse } = await loadParser();
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getScreenshot({
        partial: [pageNumber],
        desiredWidth: Math.max(
          600,
          Math.min(desiredWidth, DOCUMENT_INTELLIGENCE_LIMITS.previewWidth),
        ),
        imageBuffer: true,
        imageDataUrl: false,
      });
      const page = result.pages[0];
      if (!page || page.width * page.height > DOCUMENT_INTELLIGENCE_LIMITS.previewPixels) {
        throw new Error('The requested preview exceeds the bounded raster limit.');
      }
      return {
        png: Buffer.from(page.data),
        width: page.width,
        height: page.height,
        pageNumber: page.pageNumber,
      };
    } finally {
      await parser.destroy();
    }
  }
}
