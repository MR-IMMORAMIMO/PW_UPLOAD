import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  localAiReportSchema,
  type LocalAiReport,
  type LocalAiPageReading,
  type LocalAiFinding,
} from '@scli/contracts';
import { DomainError } from '@scli/domain';
import { PdfExtractionAdapter } from '../document-intelligence/PdfExtractionAdapter.js';
import { exactTechnicalNumber } from '../document-intelligence/ExactTechnicalValue.js';
import { LOCAL_VISION_MODEL, type LocalVisionPort } from './LocalVisionAdapter.js';

const normalized = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function containsExactText(source: string, value: string) {
  const text = normalized(source);
  const target = normalized(value);
  if (!target) return false;
  let index = text.indexOf(target);
  while (index >= 0) {
    if (
      !/[a-z0-9]/.test(text[index - 1] ?? '') &&
      !/[a-z0-9]/.test(text[index + target.length] ?? '')
    )
      return true;
    index = text.indexOf(target, index + 1);
  }
  return false;
}
const fieldEvidence: Record<LocalAiFinding['field'], RegExp> = {
  manufacturer: /manufacturer|brand/i,
  orderingCode: /ordering|order code|product code|article|catalog|part no/i,
  model: /model|type|product/i,
  wattage:
    /(?:system|luminaire|total|input)\s+(?:rated\s+)?power|power\s+(?:of the\s+)?(?:system|luminaire)/i,
  lumens: /(?:luminaire|delivered|system|total).*flux|flux.*(?:luminaire|delivered|system)/i,
  lightColor: /cct|colou?r temperature/i,
  cri: /cri|colou?r rendering|\bra\b/i,
  beamAngle: /beam|angle/i,
  ipRating: /\bip\s*\d{2}|ingress/i,
  control: /control|dimming|dali|phase|0.?10/i,
  driver: /driver|gear/i,
  dimensions: /dimensions|length|width|height|diameter/i,
  cutout: /cut.?out|ceiling opening|recess opening/i,
  mounting: /mount|installation/i,
  bodyColorFinish: /finish|body colou?r|housing colou?r/i,
  emergency: /emergency|battery|duration/i,
};
export function compareReading(
  reading: LocalAiPageReading,
  text: string,
  snapshot: Record<string, string>,
): LocalAiFinding[] {
  const identity = Boolean(
    snapshot.orderingCode &&
    normalized(reading.productCode) === normalized(snapshot.orderingCode) &&
    containsExactText(text, snapshot.orderingCode),
  );
  return reading.fields.map((field) => {
    const projectValue = snapshot[field.field] ?? '';
    const grounded =
      containsExactText(text, field.quote) && containsExactText(field.quote, field.value);
    let result: LocalAiFinding['result'] = 'NEEDS_REVIEW';
    let reason = 'AI suggestion only. Confirm product identity and the quoted page evidence.';
    const basisSupported = fieldEvidence[field.field].test(field.quote);
    if (!basisSupported)
      reason =
        'The quote does not establish this field or technical basis. The small model may have misclassified it; verify manually.';
    if (identity && grounded && basisSupported && projectValue) {
      const numeric = ['wattage', 'lumens', 'lightColor', 'cri', 'beamAngle'].includes(field.field);
      const left = numeric
        ? exactTechnicalNumber(field.field, projectValue)
        : normalized(projectValue);
      const right = numeric
        ? exactTechnicalNumber(field.field, field.value)
        : normalized(field.value);
      if (left !== null && right !== null) {
        result = left === right ? 'CONSISTENT_EVIDENCE' : 'DIFFERENT_EVIDENCE';
        reason =
          'Comparison of quoted evidence only; model association and technical basis still require your review.';
      }
    }
    return { ...field, projectValue, result, reason };
  });
}

type Context = {
  projectId: string;
  luminaireId: string;
  assetVersionId: string;
  sourceHash: string;
  actorId: string;
  file: string;
  snapshot: Record<string, string>;
};
export class LocalAiReview {
  private active: { report: LocalAiReport; controller: AbortController } | null = null;
  private pending: Promise<void> | null = null;
  private readonly directory: string;
  public constructor(
    root: string,
    private readonly vision: LocalVisionPort,
    private readonly pdf = new PdfExtractionAdapter(),
  ) {
    this.directory = path.join(root, 'local-ai-reviews');
  }
  private file(projectId: string, luminaireId: string) {
    return path.join(this.directory, `${projectId}-${luminaireId}.json`);
  }
  private async save(report: LocalAiReport) {
    await mkdir(this.directory, { recursive: true });
    const file = this.file(report.projectId, report.luminaireId);
    const temporary = `${file}.${report.id}.tmp`;
    await writeFile(temporary, JSON.stringify(localAiReportSchema.parse(report)), { mode: 0o600 });
    await rename(temporary, file);
    if (report.state !== 'RUNNING') {
      await writeFile(path.join(this.directory, `${report.id}.json`), JSON.stringify(report), {
        mode: 0o600,
      });
    }
  }
  public async current(projectId: string, luminaireId: string): Promise<LocalAiReport | null> {
    if (
      this.active?.report.projectId === projectId &&
      this.active.report.luminaireId === luminaireId
    )
      return structuredClone(this.active.report);
    try {
      const report = localAiReportSchema.parse(
        JSON.parse(await readFile(this.file(projectId, luminaireId), 'utf8')),
      );
      if (report.projectId !== projectId || report.luminaireId !== luminaireId)
        throw new Error('Review ownership mismatch.');
      if (report.state === 'RUNNING')
        return {
          ...report,
          state: 'FAILED',
          error: 'The application stopped before this scan finished. Start a new scan.',
          finishedAt: new Date().toISOString(),
        };
      return report;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    }
  }
  public async start(context: Context) {
    if (this.active)
      throw new DomainError(
        'CONFLICT',
        'A local scan is already running. Wait or cancel it first.',
        409,
      );
    const report: LocalAiReport = {
      stale: false,
      id: randomUUID(),
      projectId: context.projectId,
      luminaireId: context.luminaireId,
      assetVersionId: context.assetVersionId,
      sourceHash: context.sourceHash,
      actorId: context.actorId,
      model: LOCAL_VISION_MODEL,
      modelDigest: '',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      state: 'RUNNING',
      totalPages: 0,
      completedPages: 0,
      error: null,
      projectSnapshot: context.snapshot,
      pages: [],
    };
    const controller = new AbortController();
    this.active = { report, controller };
    try {
      await this.save(report);
    } catch (error) {
      this.active = null;
      throw error;
    }
    this.pending = this.run(context, report, controller).finally(() => {
      this.active = null;
      this.pending = null;
    });
    return structuredClone(report);
  }
  public cancel(projectId: string, luminaireId: string) {
    if (
      this.active?.report.projectId === projectId &&
      this.active.report.luminaireId === luminaireId
    )
      this.active.controller.abort();
  }
  public async close() {
    this.active?.controller.abort();
    await this.pending;
  }
  private async verifyBytes(context: Context) {
    const hash = createHash('sha256')
      .update(await readFile(context.file))
      .digest('hex');
    if (hash !== context.sourceHash)
      throw new Error('The Datasheet bytes changed. Attach a verified Datasheet and scan again.');
  }
  private async run(context: Context, report: LocalAiReport, controller: AbortController) {
    try {
      report.modelDigest = (await this.vision.check()).digest;
      await this.verifyBytes(context);
      const document = await this.pdf.extract(context.file);
      if (document.capped || document.pageCount > 200 || !document.pages.length)
        throw new Error('This scan supports 1–200 pages. Split larger documents before scanning.');
      report.totalPages = document.pageCount;
      await this.save(report);
      for (const page of document.pages) {
        controller.signal.throwIfAborted();
        await this.verifyBytes(context);
        const image = await this.pdf.renderPage(context.file, page.pageNumber, 1000);
        const reading = await this.vision.readPage(
          image.png,
          page.text,
          context.snapshot.orderingCode ?? '',
          controller.signal,
        );
        controller.signal.throwIfAborted();
        report.pages.push({
          pageNumber: page.pageNumber,
          summary: reading.summary,
          observations: reading.observations,
          productCode: reading.productCode,
          findings: compareReading(reading, page.text, context.snapshot),
        });
        report.completedPages++;
        await this.save(report);
      }
      await this.verifyBytes(context);
      report.state = 'COMPLETED';
    } catch (error) {
      report.state = controller.signal.aborted ? 'CANCELLED' : 'FAILED';
      report.error = controller.signal.aborted
        ? 'Scan cancelled. Completed pages remain available.'
        : (error instanceof Error ? error.message : 'Local scan failed.').slice(0, 500);
    } finally {
      report.finishedAt = new Date().toISOString();
      await this.save(report).catch(() => {
        report.state = 'FAILED';
        report.error = 'The review could not be saved. Check free disk space.';
      });
      await this.vision.unload().catch(() => undefined);
    }
  }
}
