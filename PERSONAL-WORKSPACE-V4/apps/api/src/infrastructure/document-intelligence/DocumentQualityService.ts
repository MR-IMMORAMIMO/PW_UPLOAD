import type { DocumentClassification, ProjectAssociationState } from '@scli/domain';
import type { DocumentIntelligenceStore } from './DocumentIntelligenceStore.js';

export class DocumentQualityService {
  public constructor(private readonly store: DocumentIntelligenceStore) {}

  public generate(input: {
    documentId: string;
    versionId: string;
    classification: DocumentClassification;
    associationState: ProjectAssociationState;
    pageCount: number;
    capped: boolean;
    ocrPages: number;
    lowConfidenceOcr: boolean;
    nativeCorruptedPages: number;
    valueFields: readonly string[];
  }): void {
    const seed = { versionId: input.versionId, engine: 'p5c-quality-v1' };
    if (input.capped)
      this.store.addFinding(
        input.documentId,
        input.versionId,
        'PAGE_LIMIT_REACHED',
        'WARNING',
        'Page processing limit reached',
        'Only the first 200 pages were processed.',
        'Review the unprocessed pages manually.',
        {},
        seed,
      );
    if (input.nativeCorruptedPages > 0)
      this.store.addFinding(
        input.documentId,
        input.versionId,
        'NATIVE_TEXT_UNREADABLE',
        'WARNING',
        'Native PDF text is unreadable',
        `${input.nativeCorruptedPages} page(s) had undecodable native text (quality gate failed) and required OCR normalization.`,
        'Review OCR-derived evidence before acceptance.',
        { nativeCorruptedPages: input.nativeCorruptedPages },
        seed,
      );
    if (input.ocrPages > 0)
      this.store.addFinding(
        input.documentId,
        input.versionId,
        'OCR_REQUIRED',
        'INFO',
        'OCR fallback used',
        `${input.ocrPages} deficient page(s) required local OCR.`,
        'Review OCR-derived evidence before acceptance.',
        { ocrPages: input.ocrPages },
        seed,
      );
    if (input.lowConfidenceOcr)
      this.store.addFinding(
        input.documentId,
        input.versionId,
        'OCR_LOW_CONFIDENCE',
        'WARNING',
        'Low-confidence OCR evidence',
        'One or more OCR pages produced confidence below 80.',
        'Compare the highlighted evidence with the source page.',
        {},
        seed,
      );
    if (input.associationState === 'AMBIGUOUS')
      this.store.addFinding(
        input.documentId,
        input.versionId,
        'PROJECT_ASSOCIATION_AMBIGUOUS',
        'BLOCKING',
        'Project association is ambiguous',
        'More than one plausible Project identity was found.',
        'The Owner must confirm the intended Project.',
        {},
        seed,
      );
    if (input.associationState === 'CONFLICTING')
      this.store.addFinding(
        input.documentId,
        input.versionId,
        'PROJECT_ASSOCIATION_CONFLICT',
        'BLOCKING',
        'Project association conflict',
        'Strong extracted identity contradicts the controlled admission context.',
        'Resolve the Project identity before comparison or routing.',
        {},
        seed,
      );
    if (input.classification === 'UNKNOWN')
      this.store.addFinding(
        input.documentId,
        input.versionId,
        'UNSUPPORTED_DOCUMENT_TYPE',
        'WARNING',
        'Document type is unknown',
        'No deterministic Phase 5C classifier signature was strong enough.',
        'Review and override classification if appropriate.',
        {},
        seed,
      );
    if (
      input.classification === 'DIALUX_CALCULATION_REPORT' &&
      !input.valueFields.some((field) => field.startsWith('ILLUMINANCE_'))
    )
      this.store.addFinding(
        input.documentId,
        input.versionId,
        'EXPECTED_DIALUX_RESULTS_MISSING',
        'WARNING',
        'Expected DIALux results are missing',
        'A DIALux signature was found but no labelled illuminance result was extracted.',
        'Inspect the calculation-result pages.',
        {},
        seed,
      );
    if (
      input.classification === 'DIALUX_CALCULATION_REPORT' &&
      !input.valueFields.includes('MAINTENANCE_FACTOR')
    )
      this.store.addFinding(
        input.documentId,
        input.versionId,
        'MAINTENANCE_FACTOR_MISSING',
        'WARNING',
        'Maintenance factor is missing',
        'No explicitly labelled maintenance factor was extracted.',
        'Confirm the report basis before relying on results.',
        {},
        seed,
      );
    if (
      input.classification === 'DIALUX_CALCULATION_REPORT' &&
      !input.valueFields.includes('QUANTITY')
    )
      this.store.addFinding(
        input.documentId,
        input.versionId,
        'LUMINAIRE_SCHEDULE_MISSING',
        'WARNING',
        'Luminaire schedule evidence is missing',
        'No recognized luminaire quantity row was extracted from the DIALux-like report.',
        'Review the source luminaire schedule pages.',
        {},
        seed,
      );
  }
}
