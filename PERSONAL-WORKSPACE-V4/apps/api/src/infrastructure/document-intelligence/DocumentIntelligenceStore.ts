import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  DocumentAdmissionRead,
  DocumentAssociationEvidenceRead,
  DocumentConflictSourceValueRead,
  DocumentDecisionRead,
  DocumentExtractionValueRead,
  DocumentFindingRead,
  DocumentListQuery,
  DocumentRelationshipRead,
  DocumentRoutingProposalRead,
  DocumentVersionRead,
  IntelligenceDocumentRead,
  OwnerDocumentDecisionInput,
  ProcessingAttemptRead,
} from '@scli/contracts';
import {
  canonicalRelationshipEndpoints,
  canTransitionDocumentLifecycle,
  DOCUMENT_INTELLIGENCE_LIMITS,
  DomainError,
  type DocumentActor,
  type DocumentClassification,
  type DocumentExtractionValue,
  type DocumentFindingCode,
  type DocumentFindingSeverity,
  type DocumentLifecycle,
  type DocumentProcessingState,
  type DocumentRelationshipType,
  type ProjectAssociationState,
} from '@scli/domain';
import type { AdmittedDocumentBytes } from './DocumentSourceAdmission.js';

type Row = Record<string, unknown>;
const EXTRACTOR_FINGERPRINT = createHash('sha256')
  .update(
    'p5c-document-intelligence-v8|luminaire-datasheet-semantic-v11|pdf-parse-2.4.5:p5c-4|generic-ocr-layout-v2|ocr-contrast-sparse-v1|numeric-second-reading-v1',
  )
  .digest('hex');
const crossDocumentConflictCodes = new Set<DocumentFindingCode>([
  'LUMINAIRE_QUANTITY_CONFLICT',
  'ORDERING_CODE_CONFLICT',
  'MANUFACTURER_CONFLICT',
  'WATTAGE_CONFLICT',
  'CCT_CONFLICT',
  'BEAM_CONFLICT',
  'VALUE_BASIS_CONFLICT',
]);

const text = (row: Row, key: string): string => String(row[key]);
const nullableText = (row: Row, key: string): string | null =>
  row[key] === null || row[key] === undefined ? null : String(row[key]);
const numeric = (row: Row, key: string): number => Number(row[key]);
const bool = (row: Row, key: string): boolean => Number(row[key]) === 1;
function json<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === 'string' ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export interface CreateAdmissionInput {
  bytes: AdmittedDocumentBytes;
  admissionMechanism: 'GLOBAL_SELECT' | 'PROJECT_SELECT';
  projectContextId: string | null;
  idempotencyKey: string;
}

export interface CreateArtifactAdmissionInput {
  artifactVersionId: string;
  projectId: string;
  sha256: string;
  sizeBytes: number;
  originalFileName: string;
  idempotencyKey: string;
}

export interface CreateLuminaireAssetAdmissionInput {
  luminaireAssetVersionId: string;
  projectId: string;
  luminaireId: string;
  sha256: string;
  sizeBytes: number;
  originalFileName: string;
  idempotencyKey: string;
}

export interface SourceForProcessing {
  sourceId: string;
  managedLocator: string | null;
  artifactVersionId: string | null;
  luminaireAssetVersionId: string | null;
  sha256: string;
  sizeBytes: number;
  originalFileName: string;
  documentId: string;
  versionId: string;
  projectContextId: string | null;
  stageCheckpoint: string;
}

export class DocumentIntelligenceStore {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public createAdmission(input: CreateAdmissionInput): DocumentAdmissionRead {
    const previous = this.database
      .prepare(
        `SELECT a.attempt_id,a.state,v.version_id,v.document_id,v.source_id
         FROM document_processing_attempts a
         JOIN document_versions v ON v.version_id=a.version_id
         WHERE a.idempotency_key=?`,
      )
      .get(input.idempotencyKey) as Row | undefined;
    if (previous) {
      return {
        documentId: text(previous, 'document_id'),
        documentVersionId: text(previous, 'version_id'),
        sourceId: text(previous, 'source_id'),
        processingAttemptId: text(previous, 'attempt_id'),
        processingState: text(previous, 'state') as DocumentProcessingState,
        duplicateSource: true,
      };
    }

    const at = this.now().toISOString();
    const documentId = randomUUID();
    const versionId = randomUUID();
    const attemptId = randomUUID();
    const existingSource = this.database
      .prepare(
        `SELECT source_id FROM document_sources
         WHERE sha256=? AND storage_mode='DOCUMENT_STORE' AND storage_state='AVAILABLE'`,
      )
      .get(input.bytes.sha256) as Row | undefined;
    const sourceId = existingSource ? text(existingSource, 'source_id') : randomUUID();

    this.transaction(() => {
      if (!existingSource) {
        this.database
          .prepare(
            `INSERT INTO document_sources
             (source_id,storage_mode,storage_state,managed_locator,artifact_version_id,sha256,
              size_bytes,media_type,original_file_name,admission_mechanism,admitted_at,finalized_at)
             VALUES (?,'DOCUMENT_STORE','AVAILABLE',?,NULL,?,?,'application/pdf',?,?,?,?)`,
          )
          .run(
            sourceId,
            input.bytes.managedLocator,
            input.bytes.sha256,
            input.bytes.sizeBytes,
            input.bytes.originalFileName,
            input.admissionMechanism,
            at,
            at,
          );
      }
      this.database
        .prepare(
          `INSERT INTO intelligence_documents
           (document_id,lifecycle,confirmed_project_id,association_state,classification,
            classification_confidence,active_version_id,comparison_enabled,row_version,created_at,updated_at)
           VALUES (?,'ADMITTED',NULL,?,'UNKNOWN',0,NULL,0,1,?,?)`,
        )
        .run(documentId, input.projectContextId ? 'LIKELY' : 'UNRESOLVED', at, at);
      this.database
        .prepare(
          `INSERT INTO document_versions
           (version_id,document_id,version_sequence,source_id,admission_provenance_json,
            initial_project_context_id,processing_state,admitted_at)
           VALUES (?,?,1,?,?,?,?,?)`,
        )
        .run(
          versionId,
          documentId,
          sourceId,
          JSON.stringify({
            mechanism: input.admissionMechanism,
            originalFileName: input.bytes.originalFileName,
            pathRetained: false,
          }),
          input.projectContextId,
          'QUEUED',
          at,
        );
      this.database
        .prepare('UPDATE intelligence_documents SET active_version_id=? WHERE document_id=?')
        .run(versionId, documentId);
      this.database
        .prepare(
          `INSERT INTO document_processing_attempts
           (attempt_id,version_id,state,stage_checkpoint,extractor_fingerprint,idempotency_key,
            created_at,updated_at)
           VALUES (?,?,'QUEUED','ADMITTED',?,?,?,?)`,
        )
        .run(attemptId, versionId, EXTRACTOR_FINGERPRINT, input.idempotencyKey, at, at);
      if (existingSource) this.proposeExactDuplicate(documentId, versionId, sourceId, at);
    });
    return {
      documentId,
      documentVersionId: versionId,
      sourceId,
      processingAttemptId: attemptId,
      processingState: 'QUEUED',
      duplicateSource: Boolean(existingSource),
    };
  }

  public createArtifactAdmission(input: CreateArtifactAdmissionInput): DocumentAdmissionRead {
    const previous = this.database
      .prepare(
        `SELECT a.attempt_id,a.state,v.version_id,v.document_id,v.source_id FROM document_processing_attempts a JOIN document_versions v ON v.version_id=a.version_id WHERE a.idempotency_key=?`,
      )
      .get(input.idempotencyKey) as Row | undefined;
    if (previous)
      return {
        documentId: text(previous, 'document_id'),
        documentVersionId: text(previous, 'version_id'),
        sourceId: text(previous, 'source_id'),
        processingAttemptId: text(previous, 'attempt_id'),
        processingState: text(previous, 'state') as DocumentProcessingState,
        duplicateSource: true,
      };
    const existingSource = this.database
      .prepare(`SELECT source_id FROM document_sources WHERE artifact_version_id=?`)
      .get(input.artifactVersionId) as Row | undefined;
    const sourceId = existingSource ? text(existingSource, 'source_id') : randomUUID();
    const documentId = randomUUID();
    const versionId = randomUUID();
    const attemptId = randomUUID();
    const at = this.now().toISOString();
    this.transaction(() => {
      if (!existingSource)
        this.database
          .prepare(
            `INSERT INTO document_sources (source_id,storage_mode,storage_state,managed_locator,artifact_version_id,sha256,size_bytes,media_type,original_file_name,admission_mechanism,admitted_at,finalized_at) VALUES (?,'MANAGED_ARTIFACT_VERSION','AVAILABLE',NULL,?,?,?,'application/pdf',?,'PHASE4_ARTIFACT',?,?)`,
          )
          .run(
            sourceId,
            input.artifactVersionId,
            input.sha256,
            input.sizeBytes,
            input.originalFileName,
            at,
            at,
          );
      this.database
        .prepare(
          `INSERT INTO intelligence_documents (document_id,lifecycle,confirmed_project_id,association_state,classification,classification_confidence,active_version_id,comparison_enabled,row_version,created_at,updated_at) VALUES (?,'ADMITTED',?,'CONFIRMED','UNKNOWN',0,NULL,0,1,?,?)`,
        )
        .run(documentId, input.projectId, at, at);
      this.database
        .prepare(
          `INSERT INTO document_versions (version_id,document_id,version_sequence,source_id,admission_provenance_json,initial_project_context_id,processing_state,admitted_at) VALUES (?,?,1,?,?,?,'QUEUED',?)`,
        )
        .run(
          versionId,
          documentId,
          sourceId,
          JSON.stringify({
            mechanism: 'PHASE4_ARTIFACT',
            artifactVersionId: input.artifactVersionId,
            pathRetained: false,
          }),
          input.projectId,
          at,
        );
      this.database
        .prepare(`UPDATE intelligence_documents SET active_version_id=? WHERE document_id=?`)
        .run(versionId, documentId);
      this.database
        .prepare(
          `INSERT INTO document_processing_attempts (attempt_id,version_id,state,stage_checkpoint,extractor_fingerprint,idempotency_key,created_at,updated_at) VALUES (?,?,'QUEUED','ARTIFACT_REFERENCE_ADMITTED',?,?,?,?)`,
        )
        .run(attemptId, versionId, EXTRACTOR_FINGERPRINT, input.idempotencyKey, at, at);
      if (existingSource) this.proposeExactDuplicate(documentId, versionId, sourceId, at);
    });
    return {
      documentId,
      documentVersionId: versionId,
      sourceId,
      processingAttemptId: attemptId,
      processingState: 'QUEUED',
      duplicateSource: Boolean(existingSource),
    };
  }

  public readLuminaireAssetAdmission(
    input: CreateLuminaireAssetAdmissionInput,
  ): DocumentAdmissionRead | null {
    const previous = this.database
      .prepare(
        `SELECT a.attempt_id,a.state,v.version_id,v.document_id,v.source_id
         FROM document_processing_attempts a
         JOIN document_versions v ON v.version_id=a.version_id
         WHERE a.idempotency_key=?`,
      )
      .get(input.idempotencyKey) as Row | undefined;
    if (previous) {
      return {
        documentId: text(previous, 'document_id'),
        documentVersionId: text(previous, 'version_id'),
        sourceId: text(previous, 'source_id'),
        processingAttemptId: text(previous, 'attempt_id'),
        processingState: text(previous, 'state') as DocumentProcessingState,
        duplicateSource: true,
      };
    }
    const reusable = this.database
      .prepare(
        `SELECT a.attempt_id,a.state,v.version_id,v.document_id,v.source_id
         FROM document_sources s
         JOIN document_versions v ON v.source_id=s.source_id
         JOIN intelligence_documents d ON d.document_id=v.document_id
         JOIN document_processing_attempts a ON a.version_id=v.version_id
         WHERE s.luminaire_asset_version_id=? AND s.sha256=?
           AND d.confirmed_project_id=? AND a.extractor_fingerprint=?
           AND a.state IN ('COMPLETE','INCOMPLETE')
         ORDER BY a.completed_at DESC LIMIT 1`,
      )
      .get(input.luminaireAssetVersionId, input.sha256, input.projectId, EXTRACTOR_FINGERPRINT) as
      Row | undefined;
    if (reusable) {
      return {
        documentId: text(reusable, 'document_id'),
        documentVersionId: text(reusable, 'version_id'),
        sourceId: text(reusable, 'source_id'),
        processingAttemptId: text(reusable, 'attempt_id'),
        processingState: text(reusable, 'state') as DocumentProcessingState,
        duplicateSource: true,
      };
    }
    return null;
  }

  public createLuminaireAssetAdmission(
    input: CreateLuminaireAssetAdmissionInput,
  ): DocumentAdmissionRead {
    const existing = this.readLuminaireAssetAdmission(input);
    if (existing) return existing;
    const at = this.now().toISOString();
    const documentId = randomUUID();
    const versionId = randomUUID();
    const attemptId = randomUUID();
    const existingSource = this.database
      .prepare('SELECT source_id FROM document_sources WHERE luminaire_asset_version_id=?')
      .get(input.luminaireAssetVersionId) as Row | undefined;
    const sourceId = existingSource ? text(existingSource, 'source_id') : randomUUID();
    this.transaction(() => {
      if (!existingSource) {
        this.database
          .prepare(
            `INSERT INTO document_sources
             (source_id,storage_mode,storage_state,managed_locator,artifact_version_id,
              luminaire_asset_version_id,sha256,size_bytes,media_type,original_file_name,
              admission_mechanism,admitted_at,finalized_at)
             VALUES (?,'LUMINAIRE_ASSET_VERSION','AVAILABLE',NULL,NULL,?,?,?,
                     'application/pdf',?,'LUMINAIRE_ATTACHMENT',?,?)`,
          )
          .run(
            sourceId,
            input.luminaireAssetVersionId,
            input.sha256,
            input.sizeBytes,
            input.originalFileName,
            at,
            at,
          );
      }
      this.database
        .prepare(
          `INSERT INTO intelligence_documents
           (document_id,lifecycle,confirmed_project_id,association_state,classification,
            classification_confidence,active_version_id,comparison_enabled,row_version,
            created_at,updated_at)
           VALUES (?,'ADMITTED',?,'CONFIRMED','PRODUCT_DATASHEET',100,NULL,1,1,?,?)`,
        )
        .run(documentId, input.projectId, at, at);
      this.database
        .prepare(
          `INSERT INTO document_versions
           (version_id,document_id,version_sequence,source_id,admission_provenance_json,
            initial_project_context_id,processing_state,admitted_at)
           VALUES (?,?,1,?,?,?,'QUEUED',?)`,
        )
        .run(
          versionId,
          documentId,
          sourceId,
          JSON.stringify({
            mechanism: 'LUMINAIRE_ATTACHMENT',
            luminaireId: input.luminaireId,
            luminaireAssetVersionId: input.luminaireAssetVersionId,
            pathRetained: false,
          }),
          input.projectId,
          at,
        );
      this.database
        .prepare('UPDATE intelligence_documents SET active_version_id=? WHERE document_id=?')
        .run(versionId, documentId);
      this.database
        .prepare(
          `INSERT INTO document_processing_attempts
           (attempt_id,version_id,state,stage_checkpoint,extractor_fingerprint,idempotency_key,
            created_at,updated_at)
           VALUES (?,?,'QUEUED','LUMINAIRE_ATTACHMENT',?,?,?,?)`,
        )
        .run(attemptId, versionId, EXTRACTOR_FINGERPRINT, input.idempotencyKey, at, at);
    });
    return {
      documentId,
      documentVersionId: versionId,
      sourceId,
      processingAttemptId: attemptId,
      processingState: 'QUEUED',
      duplicateSource: Boolean(existingSource),
    };
  }

  public list(query: DocumentListQuery): {
    items: IntelligenceDocumentRead[];
    totalCount: number;
    page: number;
    pageSize: number;
  } {
    const where: string[] = [];
    const values: Array<string | number | null> = [];
    const add = (clause: string, value: string | number | null) => {
      where.push(clause);
      values.push(value);
    };
    if (query.projectId) add('d.confirmed_project_id=?', query.projectId);
    if (query.lifecycle) add('d.lifecycle=?', query.lifecycle);
    if (query.associationState) add('d.association_state=?', query.associationState);
    if (query.classification) add('d.classification=?', query.classification);
    if (query.processingState) add('v.processing_state=?', query.processingState);
    if (query.search) {
      add('LOWER(s.original_file_name) LIKE ?', `%${query.search.toLocaleLowerCase('en')}%`);
    }
    if (query.findingSeverity) {
      add(
        `EXISTS (SELECT 1 FROM document_quality_findings q
         WHERE q.document_id=d.document_id AND q.state='OPEN' AND q.severity=?)`,
        query.findingSeverity,
      );
    }
    if (query.findingCode) {
      add(
        `EXISTS (SELECT 1 FROM document_quality_findings qfc
         WHERE qfc.document_id=d.document_id AND qfc.finding_code=?
           AND qfc.state<>'SUPERSEDED')`,
        query.findingCode,
      );
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const joins = `FROM intelligence_documents d
      JOIN document_versions v ON v.version_id=d.active_version_id
      JOIN document_sources s ON s.source_id=v.source_id`;
    const count = this.database
      .prepare(`SELECT COUNT(*) AS count ${joins} ${clause}`)
      .get(...values) as Row;
    const rows = this.database
      .prepare(
        `SELECT d.*,v.version_sequence,v.processing_state,s.original_file_name,
         (SELECT COUNT(*) FROM document_quality_findings q
          WHERE q.document_id=d.document_id AND q.state='OPEN' AND q.severity='BLOCKING') blocking_findings,
         (SELECT COUNT(*) FROM document_quality_findings q
          WHERE q.document_id=d.document_id AND q.state='OPEN' AND q.severity='WARNING') warning_findings
         ${joins} ${clause}
         ORDER BY d.updated_at DESC,d.document_id LIMIT ? OFFSET ?`,
      )
      .all(...values, query.limit, query.page * query.limit) as Row[];
    return {
      items: rows.map((row) => this.readDocument(row)),
      totalCount: numeric(count, 'count'),
      page: query.page,
      pageSize: query.limit,
    };
  }

  public getDocument(documentId: string): IntelligenceDocumentRead {
    const row = this.database
      .prepare(
        `SELECT d.*,v.version_sequence,v.processing_state,s.original_file_name,
         (SELECT COUNT(*) FROM document_quality_findings q
          WHERE q.document_id=d.document_id AND q.state='OPEN' AND q.severity='BLOCKING') blocking_findings,
         (SELECT COUNT(*) FROM document_quality_findings q
          WHERE q.document_id=d.document_id AND q.state='OPEN' AND q.severity='WARNING') warning_findings
         FROM intelligence_documents d
         JOIN document_versions v ON v.version_id=d.active_version_id
         JOIN document_sources s ON s.source_id=v.source_id
         WHERE d.document_id=?`,
      )
      .get(documentId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Document was not found.', 404);
    return this.readDocument(row);
  }

  public versions(documentId: string): DocumentVersionRead[] {
    return (
      this.database
        .prepare(
          `SELECT v.*,s.sha256,s.size_bytes,s.original_file_name,s.admission_mechanism
           FROM document_versions v JOIN document_sources s ON s.source_id=v.source_id
           WHERE v.document_id=? ORDER BY v.version_sequence DESC`,
        )
        .all(documentId) as Row[]
    ).map((row) => ({
      id: text(row, 'version_id'),
      documentId: text(row, 'document_id'),
      sequence: numeric(row, 'version_sequence'),
      sourceId: text(row, 'source_id'),
      sourceSha256: text(row, 'sha256'),
      sourceSizeBytes: numeric(row, 'size_bytes'),
      originalFileName: text(row, 'original_file_name'),
      admissionMechanism: text(
        row,
        'admission_mechanism',
      ) as DocumentVersionRead['admissionMechanism'],
      initialProjectContextId: nullableText(row, 'initial_project_context_id'),
      processingState: text(row, 'processing_state') as DocumentProcessingState,
      admittedAt: text(row, 'admitted_at'),
    }));
  }

  public attempt(attemptId: string): ProcessingAttemptRead {
    const row = this.database
      .prepare('SELECT * FROM document_processing_attempts WHERE attempt_id=?')
      .get(attemptId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Processing attempt was not found.', 404);
    return this.readAttempt(row);
  }

  public activeAttempt(documentId: string): ProcessingAttemptRead {
    const row = this.database
      .prepare(
        `SELECT a.* FROM document_processing_attempts a
         JOIN document_versions v ON v.version_id=a.version_id
         JOIN intelligence_documents d ON d.active_version_id=v.version_id
         WHERE d.document_id=? ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(documentId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Processing attempt was not found.', 404);
    return this.readAttempt(row);
  }

  public queuedAttemptIds(limit = 10): string[] {
    return (
      this.database
        .prepare(
          `SELECT attempt_id FROM document_processing_attempts
           WHERE state='QUEUED' ORDER BY created_at LIMIT ?`,
        )
        .all(limit) as Row[]
    ).map((row) => text(row, 'attempt_id'));
  }

  public interruptStaleAttempts(): number {
    const at = this.now().toISOString();
    const result = this.database
      .prepare(
        `UPDATE document_processing_attempts
         SET state='INTERRUPTED',error_code='PROCESS_RESTART',
             error_summary='Processing was interrupted by application restart.',updated_at=?
         WHERE state IN ('VALIDATING','NATIVE_EXTRACTION','OCR','CLASSIFICATION','ASSOCIATION',
                         'STRUCTURED_EXTRACTION','RELATIONSHIPS','QUALITY')`,
      )
      .run(at);
    this.database.exec(
      `UPDATE document_versions SET processing_state='INTERRUPTED'
       WHERE version_id IN (SELECT version_id FROM document_processing_attempts WHERE state='INTERRUPTED')`,
    );
    return Number(result.changes);
  }

  public sourceForAttempt(attemptId: string): SourceForProcessing {
    const row = this.database
      .prepare(
        `SELECT s.*,v.version_id,v.document_id,v.initial_project_context_id,a.stage_checkpoint
         FROM document_processing_attempts a
         JOIN document_versions v ON v.version_id=a.version_id
         JOIN document_sources s ON s.source_id=v.source_id WHERE a.attempt_id=?`,
      )
      .get(attemptId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Document source was not found.', 404);
    return {
      sourceId: text(row, 'source_id'),
      managedLocator: nullableText(row, 'managed_locator'),
      artifactVersionId: nullableText(row, 'artifact_version_id'),
      luminaireAssetVersionId: nullableText(row, 'luminaire_asset_version_id'),
      sha256: text(row, 'sha256'),
      sizeBytes: numeric(row, 'size_bytes'),
      originalFileName: text(row, 'original_file_name'),
      documentId: text(row, 'document_id'),
      versionId: text(row, 'version_id'),
      projectContextId: nullableText(row, 'initial_project_context_id'),
      stageCheckpoint: text(row, 'stage_checkpoint'),
    };
  }

  public sourceForDocument(documentId: string): SourceForProcessing {
    const attempt = this.database
      .prepare(
        `SELECT a.attempt_id FROM intelligence_documents d JOIN document_processing_attempts a ON a.version_id=d.active_version_id WHERE d.document_id=? ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(documentId) as Row | undefined;
    if (!attempt) throw new DomainError('NOT_FOUND', 'Document source was not found.', 404);
    return this.sourceForAttempt(text(attempt, 'attempt_id'));
  }

  public setAttemptState(
    attemptId: string,
    state: DocumentProcessingState,
    checkpoint: string,
    details: {
      completedPages?: number;
      ocrPages?: number;
      errorCode?: string | null;
      errorSummary?: string | null;
    } = {},
  ): void {
    const at = this.now().toISOString();
    const terminal = [
      'COMPLETE',
      'INCOMPLETE',
      'FAILED_RETRYABLE',
      'CANCELLED',
      'INTERRUPTED',
    ].includes(state);
    const result = this.database
      .prepare(
        `UPDATE document_processing_attempts
         SET state=?,stage_checkpoint=?,completed_pages=COALESCE(?,completed_pages),
             ocr_pages=COALESCE(?,ocr_pages),error_code=?,error_summary=?,
             started_at=COALESCE(started_at,?),completed_at=?,updated_at=?
         WHERE attempt_id=?`,
      )
      .run(
        state,
        checkpoint,
        details.completedPages ?? null,
        details.ocrPages ?? null,
        details.errorCode ?? null,
        details.errorSummary ?? null,
        at,
        terminal ? at : null,
        at,
        attemptId,
      );
    if (result.changes !== 1) {
      throw new DomainError('NOT_FOUND', 'Processing attempt was not found.', 404);
    }
    this.database
      .prepare(
        `UPDATE document_versions SET processing_state=?
         WHERE version_id=(SELECT version_id FROM document_processing_attempts WHERE attempt_id=?)`,
      )
      .run(state, attemptId);
  }

  public cancelRequested(attemptId: string): boolean {
    const row = this.database
      .prepare('SELECT cancel_requested FROM document_processing_attempts WHERE attempt_id=?')
      .get(attemptId) as Row | undefined;
    return row ? bool(row, 'cancel_requested') : false;
  }

  public replaceAttemptValues(
    attemptId: string,
    versionId: string,
    values: readonly DocumentExtractionValue[],
  ): void {
    const at = this.now().toISOString();
    this.transaction(() => {
      this.database
        .prepare('DELETE FROM document_extraction_values WHERE attempt_id=?')
        .run(attemptId);
      const insert = this.database.prepare(
        `INSERT INTO document_extraction_values
         (value_id,attempt_id,version_id,page_number,region_json,raw_value,
          normalized_value_json,canonical_field,unit,basis,extraction_method,confidence,
          adapter_id,extractor_version,warnings_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const value of values) {
        insert.run(
          value.id,
          attemptId,
          versionId,
          value.pageNumber,
          value.region ? JSON.stringify(value.region) : null,
          value.rawValue,
          value.normalizedValue === null ? null : JSON.stringify(value.normalizedValue),
          value.canonicalField,
          value.unit,
          value.basis,
          value.method,
          value.confidence,
          value.adapterId,
          value.extractorVersion,
          JSON.stringify(value.warnings),
          at,
        );
      }
    });
  }

  public evidence(
    versionId: string,
    page: number,
    limit: number,
  ): { items: DocumentExtractionValueRead[]; totalCount: number } {
    const count = this.database
      .prepare('SELECT COUNT(*) count FROM document_extraction_values WHERE version_id=?')
      .get(versionId) as Row;
    const rows = this.database
      .prepare(
        `SELECT * FROM document_extraction_values WHERE version_id=?
         ORDER BY page_number,canonical_field,value_id LIMIT ? OFFSET ?`,
      )
      .all(versionId, limit, page * limit) as Row[];
    return {
      totalCount: numeric(count, 'count'),
      items: rows.map((row) => ({
        id: text(row, 'value_id'),
        versionId: text(row, 'version_id'),
        pageNumber: numeric(row, 'page_number'),
        region: json(row.region_json, null),
        rawValue: text(row, 'raw_value'),
        normalizedValue: json(row.normalized_value_json, null),
        canonicalField: text(row, 'canonical_field'),
        unit: nullableText(row, 'unit'),
        basis: nullableText(row, 'basis'),
        method: text(row, 'extraction_method') as DocumentExtractionValueRead['method'],
        confidence: numeric(row, 'confidence'),
        adapterId: text(row, 'adapter_id'),
        extractorVersion: text(row, 'extractor_version'),
        warnings: json(row.warnings_json, []),
      })),
    };
  }

  public associationEvidence(documentId: string): DocumentAssociationEvidenceRead[] {
    const row = this.database
      .prepare(
        `SELECT a.association_evidence_json FROM intelligence_documents d JOIN document_processing_attempts a ON a.version_id=d.active_version_id WHERE d.document_id=? ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(documentId) as Row | undefined;
    if (!row)
      throw new DomainError('NOT_FOUND', 'Document association evidence was not found.', 404);
    return json<DocumentAssociationEvidenceRead[]>(row.association_evidence_json, []);
  }

  public updateAnalysis(
    documentId: string,
    attemptId: string,
    classification: DocumentClassification,
    confidence: number,
    associationState: ProjectAssociationState,
    associationEvidence: unknown,
    classificationEvidence: unknown,
  ): void {
    const at = this.now().toISOString();
    this.transaction(() => {
      this.database
        .prepare(
          `UPDATE intelligence_documents
           SET classification=CASE WHEN EXISTS (
                 SELECT 1 FROM document_owner_decisions od
                 WHERE od.document_id=intelligence_documents.document_id
                   AND od.action_type='OVERRIDE_CLASSIFICATION')
               THEN classification ELSE ? END,
               classification_confidence=CASE WHEN EXISTS (
                 SELECT 1 FROM document_owner_decisions od
                 WHERE od.document_id=intelligence_documents.document_id
                   AND od.action_type='OVERRIDE_CLASSIFICATION')
               THEN classification_confidence ELSE ? END,
               association_state=CASE WHEN confirmed_project_id IS NOT NULL
                 THEN 'CONFIRMED' ELSE ? END,
               lifecycle='NEEDS_REVIEW',row_version=row_version+1,updated_at=?
           WHERE document_id=?`,
        )
        .run(classification, confidence, associationState, at, documentId);
      this.database
        .prepare(
          `UPDATE document_processing_attempts
           SET classification_evidence_json=?,association_evidence_json=?,updated_at=?
           WHERE attempt_id=?`,
        )
        .run(
          JSON.stringify(classificationEvidence),
          JSON.stringify(associationEvidence),
          at,
          attemptId,
        );
    });
  }

  public addFinding(
    documentId: string,
    versionId: string | null,
    code: DocumentFindingCode,
    severity: DocumentFindingSeverity,
    title: string,
    explanation: string,
    recommendedAction: string,
    evidence: unknown,
    fingerprintSeed: unknown,
    fieldKey: string | null = null,
    canonicalFingerprint = false,
  ): void {
    const fingerprint = canonicalFingerprint
      ? String(fingerprintSeed)
      : createHash('sha256').update(JSON.stringify(fingerprintSeed)).digest('hex');
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
      throw new DomainError('VALIDATION_ERROR', 'Finding fingerprint is invalid.', 400);
    }
    const at = this.now().toISOString();
    this.database
      .prepare(
        `INSERT OR IGNORE INTO document_quality_findings
         (finding_id,document_id,version_id,finding_code,severity,state,title,explanation,
          field_key,evidence_json,recommended_action,generation_fingerprint,row_version,created_at,updated_at)
         VALUES (?,?,?,?,?,'OPEN',?,?,?,?,?,?,1,?,?)`,
      )
      .run(
        randomUUID(),
        documentId,
        versionId,
        code,
        severity,
        title,
        explanation,
        fieldKey,
        JSON.stringify(evidence),
        recommendedAction,
        fingerprint,
        at,
        at,
      );
  }

  public findings(documentId: string): DocumentFindingRead[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM document_quality_findings
           WHERE document_id=? ORDER BY state,severity,updated_at DESC`,
        )
        .all(documentId) as Row[]
    ).map((row) => {
      const code = text(row, 'finding_code') as DocumentFindingCode;
      const competingValues = crossDocumentConflictCodes.has(code)
        ? json<Row[]>(row.evidence_json, []).flatMap(
            (source): DocumentConflictSourceValueRead[] => {
              const documentId = nullableText(source, 'document_id');
              const versionId = nullableText(source, 'active_version_id');
              const field = nullableText(source, 'canonical_field');
              if (!documentId || !versionId || !field) return [];
              return [
                {
                  documentId,
                  versionId,
                  field,
                  value: json<string | number | null>(source.normalized_value_json, null),
                  unit: nullableText(source, 'unit'),
                  basis: nullableText(source, 'basis'),
                  tag: json<string | number | null>(source.tag, null),
                },
              ];
            },
          )
        : undefined;
      return {
        id: text(row, 'finding_id'),
        documentId: text(row, 'document_id'),
        versionId: nullableText(row, 'version_id'),
        code,
        severity: text(row, 'severity') as DocumentFindingSeverity,
        state: text(row, 'state') as DocumentFindingRead['state'],
        title: text(row, 'title'),
        explanation: text(row, 'explanation'),
        recommendedAction: text(row, 'recommended_action'),
        generationFingerprint: text(row, 'generation_fingerprint'),
        rowVersion: numeric(row, 'row_version'),
        ...(competingValues ? { competingValues } : {}),
      };
    });
  }

  public relationships(documentId: string): DocumentRelationshipRead[] {
    return (
      this.database
        .prepare(
          `SELECT r.* FROM document_relationships r
           JOIN document_versions l ON l.version_id=r.left_version_id
           JOIN document_versions rr ON rr.version_id=r.right_version_id
           WHERE l.document_id=? OR rr.document_id=? ORDER BY r.updated_at DESC`,
        )
        .all(documentId, documentId) as Row[]
    ).map((row) => ({
      id: text(row, 'relationship_id'),
      leftVersionId: text(row, 'left_version_id'),
      rightVersionId: text(row, 'right_version_id'),
      type: text(row, 'relationship_type') as DocumentRelationshipType,
      state: text(row, 'state') as DocumentRelationshipRead['state'],
      evidence: json(row.evidence_json, []),
      confidence: numeric(row, 'confidence'),
      rowVersion: numeric(row, 'row_version'),
    }));
  }

  public decisions(documentId: string): DocumentDecisionRead[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM document_owner_decisions WHERE document_id=? ORDER BY decided_at DESC',
        )
        .all(documentId) as Row[]
    ).map((row) => ({
      id: text(row, 'decision_id'),
      documentId: text(row, 'document_id'),
      action: text(row, 'action_type') as DocumentDecisionRead['action'],
      actorId: text(row, 'actor_id'),
      actorName: text(row, 'actor_name'),
      reason: text(row, 'reason'),
      beforeProjection: json(row.before_projection_json, {}),
      afterProjection: json(row.after_projection_json, {}),
      decidedAt: text(row, 'decided_at'),
    }));
  }

  public applyDecision(
    documentId: string,
    input: OwnerDocumentDecisionInput,
    actor: DocumentActor,
  ): IntelligenceDocumentRead {
    const current = this.getDocument(documentId);
    if (current.rowVersion !== input.expectedRowVersion) {
      throw new DomainError('CONFLICT', 'Document review changed. Refresh before deciding.', 409, {
        reasonCode: 'STALE_DOCUMENT_DECISION',
      });
    }
    const before = {
      lifecycle: current.lifecycle,
      classification: current.classification,
      associationState: current.associationState,
      confirmedProjectId: current.confirmedProjectId,
      comparisonEnabled: current.comparisonEnabled,
      rowVersion: current.rowVersion,
    };
    let lifecycle = current.lifecycle as DocumentLifecycle;
    let classification = current.classification;
    let association = current.associationState;
    let projectId = current.confirmedProjectId;
    let comparison = current.comparisonEnabled;
    if (input.action === 'OVERRIDE_CLASSIFICATION') {
      if (!input.classification) {
        throw new DomainError('VALIDATION_ERROR', 'Classification is required.', 400);
      }
      classification = input.classification;
      lifecycle = 'NEEDS_REVIEW';
    }
    if (input.action === 'CONFIRM_PROJECT_ASSOCIATION') {
      if (!input.projectId) {
        throw new DomainError('VALIDATION_ERROR', 'Project identity is required.', 400);
      }
      association = 'CONFIRMED';
      projectId = input.projectId;
      lifecycle = 'NEEDS_REVIEW';
    }
    if (input.action === 'REJECT_PROJECT_ASSOCIATION') {
      association = 'UNRESOLVED';
      projectId = null;
      lifecycle = 'NEEDS_REVIEW';
    }
    if (input.action === 'ACCEPT_DOCUMENT' || input.action === 'ACCEPT_INCOMPLETE_INTELLIGENCE') {
      lifecycle = 'ACCEPTED';
    }
    if (input.action === 'EXCLUDE_DOCUMENT') lifecycle = 'EXCLUDED';
    if (input.action === 'SUPERSEDE_VERSION') lifecycle = 'SUPERSEDED';
    if (input.action === 'INCLUDE_COMPARISON') {
      if (association !== 'CONFIRMED' || lifecycle !== 'ACCEPTED') {
        throw new DomainError(
          'CONFLICT',
          'Only accepted documents with a confirmed Project can join consistency checks.',
          409,
        );
      }
      comparison = true;
    }
    if (input.action === 'EXCLUDE_COMPARISON') comparison = false;
    if (
      current.lifecycle !== lifecycle &&
      !canTransitionDocumentLifecycle(current.lifecycle, lifecycle)
    ) {
      throw new DomainError('CONFLICT', 'The document lifecycle transition is not allowed.', 409);
    }
    const after = {
      lifecycle,
      classification,
      associationState: association,
      confirmedProjectId: projectId,
      comparisonEnabled: comparison,
      rowVersion: current.rowVersion + 1,
    };
    const at = this.now().toISOString();
    this.transaction(() => {
      const updated = this.database
        .prepare(
          `UPDATE intelligence_documents
           SET lifecycle=?,classification=?,confirmed_project_id=?,association_state=?,
               comparison_enabled=?,row_version=row_version+1,updated_at=?
           WHERE document_id=? AND row_version=?`,
        )
        .run(
          lifecycle,
          classification,
          projectId,
          association,
          comparison ? 1 : 0,
          at,
          documentId,
          input.expectedRowVersion,
        );
      if (updated.changes !== 1) {
        throw new DomainError('CONFLICT', 'Document review changed. Refresh before deciding.', 409);
      }
      this.database
        .prepare(
          `INSERT INTO document_owner_decisions
           (decision_id,document_id,action_type,target_id,actor_id,actor_name,reason,
            before_projection_json,after_projection_json,evidence_fingerprint,
            expected_row_version,decided_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          randomUUID(),
          documentId,
          input.action,
          input.relationshipId ?? input.findingId ?? null,
          actor.id,
          actor.name,
          input.reason,
          JSON.stringify(before),
          JSON.stringify(after),
          input.fingerprint ?? null,
          input.expectedRowVersion,
          at,
        );
      if (
        input.findingId &&
        ['ACKNOWLEDGE_FINDING', 'RESOLVE_FINDING', 'DISMISS_FINDING'].includes(input.action)
      ) {
        if (!input.fingerprint) {
          throw new DomainError('VALIDATION_ERROR', 'Finding fingerprint is required.', 400);
        }
        this.updateFindingForDecision(
          documentId,
          input.findingId,
          input.fingerprint,
          input.action,
          input.reason,
        );
      }
      if (
        input.relationshipId &&
        ['CONFIRM_RELATIONSHIP', 'REJECT_RELATIONSHIP'].includes(input.action)
      ) {
        this.updateRelationshipForDecision(documentId, input.relationshipId, input.action);
      }
    });
    return this.getDocument(documentId);
  }

  public retry(
    documentId: string,
    expectedRowVersion: number,
    idempotencyKey: string,
    actor: DocumentActor,
  ): ProcessingAttemptRead {
    const document = this.getDocument(documentId);
    if (document.rowVersion !== expectedRowVersion) {
      throw new DomainError('CONFLICT', 'Document processing state changed.', 409);
    }
    const existing = this.database
      .prepare('SELECT * FROM document_processing_attempts WHERE idempotency_key=?')
      .get(idempotencyKey) as Row | undefined;
    if (existing) return this.readAttempt(existing);
    const beforeAttempt = this.activeAttempt(documentId);
    const attemptId = randomUUID();
    const at = this.now().toISOString();
    this.transaction(() => {
      this.database
        .prepare(
          `UPDATE document_processing_attempts
           SET state='INTERRUPTED',completed_at=?,updated_at=?
           WHERE version_id=? AND state IN ('QUEUED','VALIDATING','NATIVE_EXTRACTION','OCR',
             'CLASSIFICATION','ASSOCIATION','STRUCTURED_EXTRACTION','RELATIONSHIPS','QUALITY')`,
        )
        .run(at, at, document.activeVersionId);
      this.database
        .prepare(
          `INSERT INTO document_processing_attempts
           (attempt_id,version_id,state,stage_checkpoint,extractor_fingerprint,idempotency_key,created_at,updated_at)
           VALUES (?,?,'QUEUED','RETRY_QUEUED',?,?,?,?)`,
        )
        .run(attemptId, document.activeVersionId, EXTRACTOR_FINGERPRINT, idempotencyKey, at, at);
      this.insertOperationalDecision(
        documentId,
        'RETRY_PROCESSING',
        attemptId,
        actor,
        'Owner requested idempotent document processing retry.',
        { attemptId: beforeAttempt.id, state: beforeAttempt.state },
        { attemptId, state: 'QUEUED' },
        expectedRowVersion,
        createHash('sha256').update(idempotencyKey).digest('hex'),
        at,
      );
      this.database
        .prepare(`UPDATE document_versions SET processing_state='QUEUED' WHERE version_id=?`)
        .run(document.activeVersionId);
    });
    return this.attempt(attemptId);
  }

  public requestCancel(
    documentId: string,
    expectedRowVersion: number,
    actor: DocumentActor,
  ): ProcessingAttemptRead {
    const document = this.getDocument(documentId);
    if (document.rowVersion !== expectedRowVersion) {
      throw new DomainError('CONFLICT', 'Document processing state changed.', 409);
    }
    const attempt = this.activeAttempt(documentId);
    if (attempt.cancelRequested) return attempt;
    const at = this.now().toISOString();
    this.transaction(() => {
      this.database
        .prepare(
          'UPDATE document_processing_attempts SET cancel_requested=1,updated_at=? WHERE attempt_id=? AND cancel_requested=0',
        )
        .run(at, attempt.id);
      this.insertOperationalDecision(
        documentId,
        'CANCEL_PROCESSING',
        attempt.id,
        actor,
        'Owner requested cancellation at the next safe processing boundary.',
        { attemptId: attempt.id, cancelRequested: false, state: attempt.state },
        { attemptId: attempt.id, cancelRequested: true, state: attempt.state },
        expectedRowVersion,
        null,
        at,
      );
    });
    return this.attempt(attempt.id);
  }

  public requestManualOcr(
    documentId: string,
    expectedRowVersion: number,
    pageNumbers: readonly number[],
  ): ProcessingAttemptRead {
    const document = this.getDocument(documentId);
    if (document.rowVersion !== expectedRowVersion)
      throw new DomainError('CONFLICT', 'Document processing state changed.', 409);
    const pages = [...new Set(pageNumbers)].sort((a, b) => a - b);
    if (pages.length === 0 || pages.length > 10)
      throw new DomainError('VALIDATION_ERROR', 'Manual OCR accepts 1 to 10 distinct pages.', 400);
    const key = createHash('sha256')
      .update(`manual-ocr:${document.activeVersionId}:${pages.join(',')}`)
      .digest('hex');
    const existing = this.database
      .prepare(`SELECT * FROM document_processing_attempts WHERE idempotency_key=?`)
      .get(key) as Row | undefined;
    if (existing) return this.readAttempt(existing);
    if (
      this.ocrPagesUsed(document.activeVersionId) + pages.length >
      DOCUMENT_INTELLIGENCE_LIMITS.lifetimeOcrPages
    )
      throw new DomainError('CONFLICT', 'The lifetime OCR page ceiling would be exceeded.', 409);
    const attemptId = randomUUID();
    const at = this.now().toISOString();
    this.transaction(() => {
      this.database
        .prepare(
          `UPDATE document_processing_attempts SET state='INTERRUPTED',completed_at=?,updated_at=? WHERE version_id=? AND state IN ('QUEUED','VALIDATING','NATIVE_EXTRACTION','OCR','CLASSIFICATION','ASSOCIATION','STRUCTURED_EXTRACTION','RELATIONSHIPS','QUALITY')`,
        )
        .run(at, at, document.activeVersionId);
      this.database
        .prepare(
          `INSERT INTO document_processing_attempts (attempt_id,version_id,state,stage_checkpoint,extractor_fingerprint,idempotency_key,created_at,updated_at) VALUES (?,?,'QUEUED',?,?,?, ?,?)`,
        )
        .run(
          attemptId,
          document.activeVersionId,
          `MANUAL_OCR:${pages.join(',')}`,
          EXTRACTOR_FINGERPRINT,
          key,
          at,
          at,
        );
      this.database
        .prepare(`UPDATE document_versions SET processing_state='QUEUED' WHERE version_id=?`)
        .run(document.activeVersionId);
    });
    return this.attempt(attemptId);
  }

  public ocrPagesUsed(versionId: string): number {
    const row = this.database
      .prepare(
        'SELECT COALESCE(SUM(ocr_pages),0) used FROM document_processing_attempts WHERE version_id=?',
      )
      .get(versionId) as Row;
    return Number(row.used);
  }

  public routingProposals(documentId: string): DocumentRoutingProposalRead[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM document_routing_proposals WHERE document_id=? ORDER BY created_at DESC',
        )
        .all(documentId) as Row[]
    ).map((row) => ({
      id: text(row, 'proposal_id'),
      documentId: text(row, 'document_id'),
      versionId: text(row, 'version_id'),
      state: text(row, 'state') as DocumentRoutingProposalRead['state'],
      destinationMappingId: text(row, 'destination_mapping_id'),
      eligibilityFingerprint: text(row, 'eligibility_fingerprint'),
      rowVersion: numeric(row, 'row_version'),
      projectDocumentId: nullableText(row, 'project_document_id'),
      artifactVersionId: nullableText(row, 'artifact_version_id'),
    }));
  }

  public proposeRelationships(documentId: string, versionId: string): number {
    const current = this.database
      .prepare(
        `SELECT d.confirmed_project_id,d.classification,s.sha256,s.original_file_name FROM intelligence_documents d JOIN document_versions v ON v.version_id=d.active_version_id JOIN document_sources s ON s.source_id=v.source_id WHERE d.document_id=? AND v.version_id=?`,
      )
      .get(documentId, versionId) as Row | undefined;
    if (!current || current.confirmed_project_id === null) return 0;
    const candidates = this.database
      .prepare(
        `SELECT d.document_id,v.version_id,s.sha256,s.original_file_name FROM intelligence_documents d JOIN document_versions v ON v.version_id=d.active_version_id JOIN document_sources s ON s.source_id=v.source_id WHERE d.document_id<>? AND d.confirmed_project_id=? AND d.classification=? AND d.lifecycle<>'TOMBSTONED' ORDER BY d.updated_at DESC LIMIT 100`,
      )
      .all(
        documentId,
        String(current.confirmed_project_id),
        String(current.classification),
      ) as Row[];
    let created = 0;
    const at = this.now().toISOString();
    for (const candidate of candidates) {
      if (candidate.sha256 === current.sha256) continue;
      const leftName = relationshipName(text(current, 'original_file_name'));
      const rightName = relationshipName(text(candidate, 'original_file_name'));
      const revisionSignal =
        revisionMarker(text(current, 'original_file_name')) !== null &&
        revisionMarker(text(candidate, 'original_file_name')) !== null;
      const type: DocumentRelationshipType =
        leftName === rightName && revisionSignal ? 'POSSIBLE_REVISION' : 'RELATED_DOCUMENT';
      const endpoints = canonicalRelationshipEndpoints(versionId, text(candidate, 'version_id'));
      const fingerprint = createHash('sha256')
        .update(
          `${type}:${endpoints.leftVersionId}:${endpoints.rightVersionId}:${String(current.confirmed_project_id)}:${String(current.classification)}`,
        )
        .digest('hex');
      const result = this.database
        .prepare(
          `INSERT OR IGNORE INTO document_relationships (relationship_id,left_version_id,right_version_id,relationship_type,state,evidence_json,confidence,generation_fingerprint,row_version,created_at,updated_at) VALUES (?,?,?,?,'PROPOSED',?,?,?,1,?,?)`,
        )
        .run(
          randomUUID(),
          endpoints.leftVersionId,
          endpoints.rightVersionId,
          type,
          JSON.stringify([
            'Same confirmed Project',
            'Same deterministic classification',
            revisionSignal
              ? 'Distinct explicit filename revision markers'
              : 'Related technical-document scope',
          ]),
          type === 'POSSIBLE_REVISION' ? 78 : 65,
          fingerprint,
          at,
          at,
        );
      if (result.changes === 1) {
        created += 1;
        if (type === 'POSSIBLE_REVISION')
          this.addFinding(
            documentId,
            versionId,
            'POSSIBLE_DOCUMENT_REVISION',
            'WARNING',
            'Possible document revision',
            'Different PDF bytes share confirmed Project, classification, normalized title, and explicit revision markers.',
            'Owner review is required; no Project Revision is created.',
            { otherDocumentId: text(candidate, 'document_id') },
            fingerprint,
          );
      }
    }
    return created;
  }

  private proposeExactDuplicate(
    documentId: string,
    versionId: string,
    sourceId: string,
    at: string,
  ): void {
    const other = this.database
      .prepare(
        `SELECT version_id FROM document_versions
         WHERE source_id=? AND version_id<>? ORDER BY admitted_at LIMIT 1`,
      )
      .get(sourceId, versionId) as Row | undefined;
    if (!other) return;
    const endpoints = canonicalRelationshipEndpoints(versionId, text(other, 'version_id'));
    const fingerprint = createHash('sha256')
      .update(`EXACT_DUPLICATE:${endpoints.leftVersionId}:${endpoints.rightVersionId}`)
      .digest('hex');
    this.database
      .prepare(
        `INSERT OR IGNORE INTO document_relationships
         (relationship_id,left_version_id,right_version_id,relationship_type,state,evidence_json,
          confidence,generation_fingerprint,row_version,created_at,updated_at)
         VALUES (?,?,?,'EXACT_DUPLICATE','PROPOSED',?,100,?,1,?,?)`,
      )
      .run(
        randomUUID(),
        endpoints.leftVersionId,
        endpoints.rightVersionId,
        JSON.stringify(['Exact SHA-256 match']),
        fingerprint,
        at,
        at,
      );
    this.addFinding(
      documentId,
      versionId,
      'EXACT_DUPLICATE_DOCUMENT',
      'WARNING',
      'Exact duplicate document',
      'The admitted PDF bytes exactly match an existing version.',
      'Review the duplicate relationship; do not treat it as a revision automatically.',
      { sourceId },
      fingerprint,
    );
  }

  private updateFindingForDecision(
    documentId: string,
    findingId: string,
    fingerprint: string,
    action: string,
    reason: string,
  ): void {
    const state =
      action === 'ACKNOWLEDGE_FINDING'
        ? 'ACKNOWLEDGED'
        : action === 'RESOLVE_FINDING'
          ? 'RESOLVED'
          : 'DISMISSED_WITH_REASON';
    if (state === 'DISMISSED_WITH_REASON' && !reason.trim()) {
      throw new DomainError('VALIDATION_ERROR', 'A dismissal reason is required.', 400);
    }
    const result = this.database
      .prepare(
        `UPDATE document_quality_findings
         SET state=?,row_version=row_version+1,updated_at=?
         WHERE finding_id=? AND document_id=? AND generation_fingerprint=?
           AND state<>'SUPERSEDED'`,
      )
      .run(state, this.now().toISOString(), findingId, documentId, fingerprint);
    if (result.changes !== 1) {
      throw new DomainError('CONFLICT', 'Finding is unavailable or superseded.', 409);
    }
  }

  private updateRelationshipForDecision(documentId: string, id: string, action: string): void {
    const state = action === 'CONFIRM_RELATIONSHIP' ? 'CONFIRMED' : 'REJECTED';
    const result = this.database
      .prepare(
        `UPDATE document_relationships
         SET state=?,row_version=row_version+1,updated_at=?
         WHERE relationship_id=? AND state='PROPOSED'
           AND EXISTS (
             SELECT 1 FROM document_versions l, document_versions r
             WHERE l.version_id=document_relationships.left_version_id
               AND r.version_id=document_relationships.right_version_id
               AND (l.document_id=? OR r.document_id=?))`,
      )
      .run(state, this.now().toISOString(), id, documentId, documentId);
    if (result.changes !== 1) {
      throw new DomainError('CONFLICT', 'Relationship is unavailable or already decided.', 409);
    }
  }

  private insertOperationalDecision(
    documentId: string,
    action: 'RETRY_PROCESSING' | 'CANCEL_PROCESSING',
    targetId: string,
    actor: DocumentActor,
    reason: string,
    before: unknown,
    after: unknown,
    expectedRowVersion: number,
    fingerprint: string | null,
    at: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO document_owner_decisions
      (decision_id,document_id,action_type,target_id,actor_id,actor_name,reason,
       before_projection_json,after_projection_json,evidence_fingerprint,
       expected_row_version,decided_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        documentId,
        action,
        targetId,
        actor.id,
        actor.name,
        reason,
        JSON.stringify(before),
        JSON.stringify(after),
        fingerprint,
        expectedRowVersion,
        at,
      );
  }

  private readDocument(row: Row): IntelligenceDocumentRead {
    return {
      id: text(row, 'document_id'),
      originalFileName: text(row, 'original_file_name'),
      lifecycle: text(row, 'lifecycle') as IntelligenceDocumentRead['lifecycle'],
      processingState: text(row, 'processing_state') as DocumentProcessingState,
      classification: text(row, 'classification') as DocumentClassification,
      classificationConfidence: numeric(row, 'classification_confidence'),
      associationState: text(row, 'association_state') as ProjectAssociationState,
      confirmedProjectId: nullableText(row, 'confirmed_project_id'),
      activeVersionId: text(row, 'active_version_id'),
      activeVersionSequence: numeric(row, 'version_sequence'),
      comparisonEnabled: bool(row, 'comparison_enabled'),
      rowVersion: numeric(row, 'row_version'),
      blockingFindings: numeric(row, 'blocking_findings'),
      warningFindings: numeric(row, 'warning_findings'),
      admittedAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at'),
    };
  }

  private readAttempt(row: Row): ProcessingAttemptRead {
    return {
      id: text(row, 'attempt_id'),
      versionId: text(row, 'version_id'),
      state: text(row, 'state') as DocumentProcessingState,
      stageCheckpoint: text(row, 'stage_checkpoint'),
      completedPages: numeric(row, 'completed_pages'),
      ocrPages: numeric(row, 'ocr_pages'),
      cancelRequested: bool(row, 'cancel_requested'),
      extractorFingerprint: text(row, 'extractor_fingerprint'),
      errorCode: nullableText(row, 'error_code'),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at'),
    };
  }

  private transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function relationshipName(value: string): string {
  return path
    .basename(value, path.extname(value))
    .toLocaleUpperCase('en')
    .replace(/\b(?:REV(?:ISION)?|VER(?:SION)?)\s*[-_. ]?[A-Z0-9]+\b/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
function revisionMarker(value: string): string | null {
  return (
    /\b(?:REV(?:ISION)?|VER(?:SION)?)\s*[-_. ]?([A-Z0-9]+)\b/i
      .exec(value)?.[1]
      ?.toLocaleUpperCase('en') ?? null
  );
}
