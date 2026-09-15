import { createHash } from 'node:crypto';
import { DOCUMENT_INTELLIGENCE_LIMITS } from '@scli/domain';
import type { DocumentIntelligenceStore } from './DocumentIntelligenceStore.js';
import type { DocumentSourceAdmission } from './DocumentSourceAdmission.js';
import { PdfExtractionAdapter, type ExtractedPdfPage } from './PdfExtractionAdapter.js';
import { LocalOcrAdapter } from './LocalOcrAdapter.js';
import { DocumentClassificationService } from './DocumentClassificationService.js';
import { ProjectAssociationService } from './ProjectAssociationService.js';
import { LightingDocumentExtractionService } from './LightingDocumentExtractionService.js';
import { DocumentQualityService } from './DocumentQualityService.js';
import { LuminaireDatasheetSemanticExtractionService } from './LuminaireDatasheetSemanticExtractionService.js';
import { assessNativeTextQuality } from './NativeTextQualityGate.js';
import { GenericOcrLayoutReconstructor } from './GenericOcrLayoutReconstructor.js';

function processingFailure(error: unknown, stage: string) {
  const message = error instanceof Error ? error.message : 'PROCESSING_FAILED';
  if (/connected, verified Project folder|STORAGE_UNVERIFIED/i.test(message)) {
    return {
      code: 'STORAGE_UNVERIFIED',
      title: 'Project storage is not verified',
      explanation:
        'The source was blocked before PDF parsing because Project storage is not verified.',
      action: 'Connect / verify the Project folder before processing.',
    };
  }
  if (/SOURCE_FILE_MISSING|ENOENT/i.test(message)) {
    return {
      code: 'SOURCE_FILE_MISSING',
      title: 'Datasheet source file is missing',
      explanation: 'The exact managed source could not be opened.',
      action: 'Restore the exact managed Datasheet source before retrying.',
    };
  }
  if (/SOURCE_HASH_MISMATCH|SOURCE_INTEGRITY/i.test(message)) {
    return {
      code: 'SOURCE_HASH_MISMATCH',
      title: 'Datasheet source hash mismatch',
      explanation: 'The source bytes do not match their persisted authority.',
      action: 'Restore or reattach the correct managed Datasheet bytes.',
    };
  }
  if (/PDF_VALIDATION_FAILED/i.test(message)) {
    return {
      code: 'PDF_VALIDATION_FAILED',
      title: 'Datasheet PDF validation failed',
      explanation: 'The source reached PDF validation but is not an eligible PDF.',
      action: 'Attach a valid managed PDF Datasheet.',
    };
  }
  if (stage === 'OCR') {
    return {
      code: 'OCR_FAILED',
      title: 'Datasheet OCR failed',
      explanation: 'The PDF reached OCR, but OCR processing failed.',
      action: 'Review the OCR runtime and retry this managed Datasheet.',
    };
  }
  if (stage === 'NATIVE_EXTRACTION') {
    return {
      code: 'NATIVE_EXTRACTION_FAILED',
      title: 'Native PDF extraction failed',
      explanation: 'The managed PDF reached native text extraction, but extraction failed.',
      action: 'Inspect the PDF structure before retrying.',
    };
  }
  if (stage === 'STRUCTURED_EXTRACTION') {
    return {
      code: 'SEMANTIC_EXTRACTION_FAILED',
      title: 'Datasheet semantic extraction failed',
      explanation: 'PDF text was available, but technical field extraction failed.',
      action: 'Review the semantic extraction finding before retrying.',
    };
  }
  return {
    code: message.slice(0, 80),
    title: 'Document processing failed',
    explanation: 'The source remains available and the attempt can be retried.',
    action: 'Retry processing or inspect the source document.',
  };
}

function targetedTechnicalRegion(
  regions: ReadonlyArray<{
    text: string;
    region: { x: number; y: number; width: number; height: number };
  }>,
) {
  const technical = regions.filter((item) =>
    /ordering|system\s+power|luminaire\s+flux|beam\s+angle|\bcct\b|\bcri\b|\bip\s*rating/i.test(
      item.text,
    ),
  );
  if (!technical.length) return null;
  const x = Math.max(0, Math.min(...technical.map((item) => item.region.x)) - 24);
  const y = Math.max(0, Math.min(...technical.map((item) => item.region.y)) - 24);
  const right = Math.max(...technical.map((item) => item.region.x + item.region.width)) + 24;
  const bottom = Math.max(...technical.map((item) => item.region.y + item.region.height)) + 24;
  return { x, y, width: right - x, height: bottom - y };
}

export class DocumentProcessingWorker {
  public constructor(
    private readonly store: DocumentIntelligenceStore,
    private readonly admission: DocumentSourceAdmission,
    private readonly pdf = new PdfExtractionAdapter(),
    private readonly ocr = new LocalOcrAdapter(),
    private readonly classification = new DocumentClassificationService(),
    private readonly association = new ProjectAssociationService(),
    private readonly lighting = new LightingDocumentExtractionService(),
    private readonly quality = new DocumentQualityService(store),
    private readonly artifactSourceResolver?: (artifactVersionId: string) => Promise<string>,
    private readonly projectCandidates?: () => Promise<
      Array<{
        id: string;
        projectCode: string;
        projectName: string;
        clientName: string;
        siteLocation: string;
      }>
    >,
    private readonly luminaireAssetSourceResolver?: (
      luminaireAssetVersionId: string,
    ) => Promise<string>,
    private readonly datasheetSemantic = new LuminaireDatasheetSemanticExtractionService(),
    private readonly ocrLayout = new GenericOcrLayoutReconstructor(),
  ) {}

  public async process(attemptId: string): Promise<void> {
    const source = this.store.sourceForAttempt(attemptId);
    const deadlineAt = Date.now() + DOCUMENT_INTELLIGENCE_LIMITS.processingAttemptMs;
    try {
      this.guard(attemptId, deadlineAt);
      this.store.setAttemptState(attemptId, 'VALIDATING', 'SOURCE_HASH');
      const sourcePath = source.managedLocator
        ? this.admission.resolveManagedLocator(source.managedLocator)
        : source.artifactVersionId && this.artifactSourceResolver
          ? await this.artifactSourceResolver(source.artifactVersionId)
          : source.luminaireAssetVersionId && this.luminaireAssetSourceResolver
            ? await this.luminaireAssetSourceResolver(source.luminaireAssetVersionId)
            : (() => {
                throw new Error('MANAGED_SOURCE_RESOLUTION_REQUIRED');
              })();
      const { readFile } = await import('node:fs/promises');
      const buffer = await readFile(sourcePath);
      if (createHash('sha256').update(buffer).digest('hex') !== source.sha256) {
        throw new Error('SOURCE_HASH_MISMATCH');
      }

      this.guard(attemptId, deadlineAt);
      this.store.setAttemptState(attemptId, 'NATIVE_EXTRACTION', 'PDF_TEXT');
      const native = await this.pdf.extract(sourcePath);
      const pages: ExtractedPdfPage[] = native.pages.map((page) => ({ ...page }));
      const methods = new Map<number, 'NATIVE_TEXT' | 'OCR'>();
      for (const page of pages) methods.set(page.pageNumber, 'NATIVE_TEXT');

      const deficientPageCount = pages.filter((page) => page.needsOcr).length;
      const manualPages = source.stageCheckpoint.startsWith('MANUAL_OCR:')
        ? source.stageCheckpoint
            .slice('MANUAL_OCR:'.length)
            .split(',')
            .map(Number)
            .filter((page) => Number.isInteger(page))
        : [];
      const lifetimeRemaining = Math.max(
        0,
        DOCUMENT_INTELLIGENCE_LIMITS.lifetimeOcrPages - this.store.ocrPagesUsed(source.versionId),
      );
      const deficient = (
        manualPages.length > 0
          ? pages
              .filter((page) => manualPages.includes(page.pageNumber))
              .slice(0, DOCUMENT_INTELLIGENCE_LIMITS.manualOcrPagesPerRequest)
          : pages
              .filter((page) => page.needsOcr)
              .slice(0, DOCUMENT_INTELLIGENCE_LIMITS.automaticOcrPages)
      ).slice(0, lifetimeRemaining);
      let lowConfidenceOcr = false;
      if (deficient.length > 0) {
        this.store.setAttemptState(attemptId, 'OCR', 'TARGETED_OCR');
        for (const page of deficient) {
          this.guard(attemptId, deadlineAt);
          const image = await this.pdf.renderPage(sourcePath, page.pageNumber);
          this.guard(attemptId, deadlineAt);
          let result = await this.ocr.recognize(image.png);
          const target = result.confidence < 70 ? targetedTechnicalRegion(result.regions) : null;
          if (target) {
            const secondPass = await this.ocr.recognize(image.png, target);
            if (secondPass.confidence > result.confidence) result = secondPass;
          }
          page.ocrNumericReviews = result.numericReviews ?? [];
          this.guard(attemptId, deadlineAt);
          // Post-OCR sanity: never assume OCR success. If OCR output is still
          // poor, the page keeps the corrupted native text as evidence so the
          // semantic layer stays LOW confidence / UNVERIFIED.
          const postOcrQuality = assessNativeTextQuality(result.text);
          if (postOcrQuality.readingMode === 'NATIVE_GOOD') {
            // Generic OCR layout reconstruction: when tesseract exposed
            // word-level geometry, rebuild visual lines / column bands /
            // table rows and replace the flattened merged text with the
            // canonical structured representation. Manufacturer-agnostic.
            const reconstructed =
              result.words && result.words.length > 0
                ? this.ocrLayout.reconstruct({
                    pageNumber: page.pageNumber,
                    width: image.width,
                    height: image.height,
                    words: result.words,
                  })
                : null;
            page.text = reconstructed
              ? reconstructed.lines.map((line) => line.canonical).join('\n')
              : result.text;
            page.usableTextCharacters = page.text.replace(/\s+/g, '').length;
            page.needsOcr = false;
            // Cell-level provenance: when layout reconstruction produced
            // structured cells, their bboxes and confidences become the OCR
            // evidence regions the semantic layer uses for confidence and
            // highlighting. Falls back to the raw line regions otherwise.
            page.ocrRegions = reconstructed
              ? reconstructed.lines.flatMap((line) =>
                  line.cells.map((cell) => ({
                    text: cell.text,
                    confidence: cell.confidence,
                    region: cell.bbox,
                  })),
                )
              : result.regions;
            methods.set(page.pageNumber, 'OCR');
          } else {
            lowConfidenceOcr = true;
            page.ocrRegions = result.regions;
          }
          lowConfidenceOcr ||= result.confidence < 80;
          this.store.setAttemptState(attemptId, 'OCR', `OCR_PAGE_${page.pageNumber}`, {
            completedPages: page.pageNumber,
            ocrPages: [...methods.values()].filter((method) => method === 'OCR').length,
          });
        }
      }

      const joined = pages.map((page) => page.text).join('\n');
      this.guard(attemptId, deadlineAt);
      this.store.setAttemptState(attemptId, 'CLASSIFICATION', 'CLASSIFY');
      const classified = source.luminaireAssetVersionId
        ? {
            classification: 'PRODUCT_DATASHEET' as const,
            confidence: 100,
            evidence: ['Exact Luminaire Datasheet attachment context'],
            alternatives: [],
          }
        : this.classification.classify(joined);
      this.store.setAttemptState(attemptId, 'ASSOCIATION', 'PROJECT_FIREWALL');
      const associated = this.association.evaluate(
        joined,
        source.projectContextId,
        this.projectCandidates ? await this.projectCandidates() : [],
      );
      this.store.updateAnalysis(
        source.documentId,
        attemptId,
        classified.classification,
        classified.confidence,
        associated.state,
        associated.evidence,
        classified,
      );

      this.store.setAttemptState(attemptId, 'STRUCTURED_EXTRACTION', 'LIGHTING_FIELDS');
      const values = (
        source.luminaireAssetVersionId
          ? this.datasheetSemantic.extract(pages, methods)
          : this.lighting.extract(classified.classification, pages, methods)
      ).map((value) => ({ ...value, versionId: source.versionId }));
      this.store.replaceAttemptValues(attemptId, source.versionId, values);

      this.store.setAttemptState(attemptId, 'RELATIONSHIPS', 'RELATIONSHIP_RECONCILIATION');
      this.store.proposeRelationships(source.documentId, source.versionId);
      this.store.setAttemptState(attemptId, 'QUALITY', 'QUALITY_FINDINGS');
      this.quality.generate({
        documentId: source.documentId,
        versionId: source.versionId,
        classification: classified.classification,
        associationState: associated.state,
        pageCount: native.pageCount,
        capped: native.capped,
        ocrPages: deficient.length,
        lowConfidenceOcr,
        nativeCorruptedPages: pages.filter(
          (page) =>
            page.nativeQuality?.readingMode === 'NATIVE_CORRUPTED' ||
            page.nativeQuality?.readingMode === 'HYBRID',
        ).length,
        valueFields: values.map((value) => value.canonicalField),
      });
      const incomplete =
        native.capped || (manualPages.length === 0 && deficient.length < deficientPageCount);
      this.store.setAttemptState(
        attemptId,
        incomplete ? 'INCOMPLETE' : 'COMPLETE',
        incomplete ? 'BOUNDED_COMPLETE' : 'COMPLETE',
        { completedPages: pages.length, ocrPages: deficient.length },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PROCESSING_FAILED';
      const cancelled = message === 'PROCESSING_CANCELLED';
      const failedAt = this.store.attempt(attemptId).state;
      const failure = processingFailure(error, failedAt);
      this.store.setAttemptState(
        attemptId,
        cancelled ? 'CANCELLED' : 'FAILED_RETRYABLE',
        cancelled ? 'CANCELLED' : 'FAILED',
        {
          errorCode: cancelled ? message.slice(0, 80) : failure.code,
          errorSummary: cancelled
            ? 'Processing was cancelled at a safe boundary.'
            : 'Document processing failed without changing canonical Project data.',
        },
      );
      if (!cancelled)
        this.store.addFinding(
          source.documentId,
          source.versionId,
          'PARSER_FAILED',
          'WARNING',
          failure.title,
          failure.explanation,
          failure.action,
          { errorCode: failure.code },
          { attemptId, message },
        );
    }
  }

  public async smokeOcr(): Promise<void> {
    await this.ocr.smoke();
  }
  public async close(): Promise<void> {
    await this.ocr.terminate();
  }
  private guard(attemptId: string, deadlineAt: number): void {
    if (this.store.cancelRequested(attemptId)) throw new Error('PROCESSING_CANCELLED');
    if (Date.now() > deadlineAt) throw new Error('PROCESSING_ATTEMPT_TIMEOUT');
  }
}
