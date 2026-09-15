import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { prepareOcrImage } from './OcrImagePreparation.js';
import { PNG } from 'pngjs';
import {
  numericReviewTargets,
  enlargedNumberCrop,
  compareNumericReadings,
  type NumericOcrReview,
} from './NumericOcrReview.js';
import { DOCUMENT_INTELLIGENCE_LIMITS } from '@scli/domain';

export interface OcrRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrRegion;
}

export interface OcrPageResult {
  numericReviews?: NumericOcrReview[];
  text: string;
  confidence: number;
  regions: Array<{ text: string; confidence: number; region: OcrRegion }>;
  /**
   * Word-level geometry from tesseract.js (present when the recognition
   * output exposed words). Used by the generic OCR layout reconstructor to
   * rebuild lines/columns/table rows from positional evidence instead of
   * relying on the flattened merged text.
   */
  words?: Array<OcrWord>;
}

export interface OcrRuntimePaths {
  workerPath: string;
  corePath: string;
  langPath: string;
}

const localRequire = createRequire(import.meta.url);

export function resolveOcrRuntimePaths(runtimeRoot?: string): OcrRuntimePaths {
  const packagedRoot =
    runtimeRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'ocr-runtime');
  if (existsSync(path.join(packagedRoot, 'offline-worker.cjs'))) {
    return {
      workerPath: path.join(packagedRoot, 'offline-worker.cjs'),
      corePath: path.join(packagedRoot, 'node_modules', 'tesseract.js-core'),
      langPath: path.join(packagedRoot, 'lang'),
    };
  }
  const tesseractRoot = path.dirname(localRequire.resolve('tesseract.js/package.json'));
  const packageNodeModules = path.dirname(tesseractRoot);
  const langRoot = path.dirname(localRequire.resolve('@tesseract.js-data/eng/package.json'));
  return {
    workerPath: path.join(tesseractRoot, 'src', 'worker-script', 'node', 'index.js'),
    corePath: path.join(packageNodeModules, 'tesseract.js-core'),
    langPath: path.join(langRoot, '4.0.0_best_int'),
  };
}

export class LocalOcrAdapter {
  public static readonly version = 'tesseract.js-7.0.0:eng-1.0.0:numeric-review-1';
  private workerPromise: Promise<Worker> | null = null;
  private chain: Promise<void> = Promise.resolve();

  public constructor(private readonly paths: OcrRuntimePaths = resolveOcrRuntimePaths()) {}

  public async recognize(png: Buffer, region?: OcrRegion): Promise<OcrPageResult> {
    let result: OcrPageResult | undefined;
    let failure: unknown;
    this.chain = this.chain.then(async () => {
      try {
        const worker = await this.worker();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let recognition;
        try {
          recognition = await Promise.race([
            worker.recognize(
              prepareOcrImage(png),
              region
                ? {
                    rectangle: {
                      left: region.x,
                      top: region.y,
                      width: region.width,
                      height: region.height,
                    },
                  }
                : {},
              { text: true, blocks: true },
            ),
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new Error('OCR_PAGE_TIMEOUT')),
                DOCUMENT_INTELLIGENCE_LIMITS.ocrPageTimeoutMs,
              );
            }),
          ]);
        } catch (error) {
          if (error instanceof Error && error.message === 'OCR_PAGE_TIMEOUT') {
            await worker.terminate().catch(() => undefined);
            this.workerPromise = null;
          }
          throw error;
        } finally {
          if (timeout) clearTimeout(timeout);
        }
        result = {
          text: recognition.data.text,
          confidence: recognition.data.confidence,
          regions: (recognition.data.blocks ?? []).flatMap((block) =>
            block.paragraphs.flatMap((paragraph) =>
              paragraph.lines.map((line) => ({
                text: line.text.trim(),
                confidence: line.confidence,
                region: {
                  x: line.bbox.x0,
                  y: line.bbox.y0,
                  width: line.bbox.x1 - line.bbox.x0,
                  height: line.bbox.y1 - line.bbox.y0,
                },
              })),
            ),
          ),
          // Word-level geometry is exposed by tesseract.js when the blocks
          // output is requested; it is the input for generic OCR layout
          // reconstruction (lines/columns/table rows from positions).
          words: (recognition.data.blocks ?? []).flatMap((block) =>
            block.paragraphs.flatMap((paragraph) =>
              paragraph.lines.flatMap((line) =>
                (line.words ?? []).map((word) => ({
                  text: word.text,
                  confidence: word.confidence,
                  bbox: {
                    x: word.bbox.x0,
                    y: word.bbox.y0,
                    width: word.bbox.x1 - word.bbox.x0,
                    height: word.bbox.y1 - word.bbox.y0,
                  },
                })),
              ),
            ),
          ),
        };
        const targets = numericReviewTargets(result.words ?? []);
        result.numericReviews = [];
        if (targets.length && !region) {
          const original = PNG.sync.read(png);
          const deadline = Date.now() + 10_000;
          let terminated = false;
          try {
            await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
            for (const target of targets) {
              if (Date.now() > deadline) break;
              // Read the enlarged ORIGINAL pixels; contrast and segmentation differ from pass one.
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                const second = await Promise.race([
                  worker.recognize(enlargedNumberCrop(original, target.bbox)),
                  new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(
                      () => reject(new Error('OCR_NUMERIC_TIMEOUT')),
                      Math.max(1, deadline - Date.now()),
                    );
                  }),
                ]);
                result.numericReviews.push(
                  compareNumericReadings(target.text, second.data.text, target.bbox),
                );
              } catch {
                result.numericReviews.push(compareNumericReadings(target.text, '', target.bbox));
                await worker.terminate().catch(() => undefined);
                this.workerPromise = null;
                terminated = true;
                break;
              } finally {
                if (timer) clearTimeout(timer);
              }
            }
          } finally {
            if (!terminated) await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
          }
        }
      } catch (error) {
        failure = error;
      }
    });
    await this.chain;
    if (failure) throw failure;
    return result!;
  }

  public async smoke(): Promise<void> {
    const required = [this.paths.workerPath, this.paths.corePath, this.paths.langPath];
    if (required.some((candidate) => !existsSync(candidate))) {
      throw new Error('OCR_RUNTIME_ASSET_MISSING');
    }
    await this.worker();
  }

  public async terminate(): Promise<void> {
    const worker = await this.workerPromise;
    this.workerPromise = null;
    if (worker) await worker.terminate();
  }

  private worker(): Promise<Worker> {
    this.workerPromise ??= createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: this.paths.workerPath,
      corePath: this.paths.corePath,
      langPath: this.paths.langPath,
      gzip: true,
      cacheMethod: 'none',
      logger: () => undefined,
      errorHandler: () => undefined,
    }).then(async (worker) => {
      // Technical sheets contain several independent columns and thin table rules.
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        user_defined_dpi: '200',
      });
      return worker;
    });
    return this.workerPromise;
  }
}
