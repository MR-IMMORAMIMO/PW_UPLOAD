import { createHash, randomUUID } from 'node:crypto';
import { exactTechnicalNumber } from './ExactTechnicalValue.js';
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import type { ImportSparseChange, ConfirmDatasheetFieldInput } from '@scli/contracts';
import { DatasheetConfirmationStore } from './DatasheetConfirmationStore.js';
import { ProjectFieldReviewStore } from './ProjectFieldReviewStore.js';
import type { KeepProjectFieldInput } from '@scli/contracts';
import {
  DomainError,
  type DatasheetComparisonField,
  type DatasheetComparisonStatus,
  type DatasheetVerificationResult,
  type LocalIntelligenceFieldKey,
  type LuminaireDatasheetBatchOutcome,
  type LuminaireDatasheetBatchResult,
  type LuminaireDatasheetAnalysis,
  type LuminaireRecord,
} from '@scli/domain';
import type { DocumentIntelligenceStore } from './DocumentIntelligenceStore.js';
import type { DocumentProcessingWorker } from './DocumentProcessingWorker.js';
import { LUMINAIRE_DATASHEET_SEMANTIC_MAPPING_VERSION } from './LuminaireDatasheetSemanticExtractionService.js';
import { ProjectLuminaireWriteStore } from '../project-luminaires/ProjectLuminaireWriteStore.js';

type Row = Readonly<Record<string, unknown>>;

const ENGINE = 'SCLI P5C Datasheet Verification 1.0' as const;
const comparisonFields: ReadonlyArray<{
  fieldKey: LocalIntelligenceFieldKey;
  label: string;
  canonicalField: string;
  /**
   * When the Project value is a recognized qualitative optic/distribution term
   * (rather than a numeric angle), compare it against this canonical field
   * instead of `canonicalField`. Used to keep LIGHT_DISTRIBUTION distinct from
   * numeric BEAM_ANGLE.
   */
  qualitativeCanonicalField?: string;
  /**
   * Capability-only evidence (optional/accessory/compatible language) is
   * never a hard Project configuration fact. When the Project value is a
   * configuration choice (e.g. Emergency = No) and the Datasheet only proves
   * capability, the result stays UNVERIFIED instead of CONFLICT.
   */
  capabilitySafe?: boolean;
}> = Object.freeze([
  { fieldKey: 'manufacturer', label: 'Manufacturer', canonicalField: 'MANUFACTURER' },
  { fieldKey: 'orderingCode', label: 'Ordering Code', canonicalField: 'ORDERING_CODE' },
  { fieldKey: 'model', label: 'Model', canonicalField: 'MODEL' },
  { fieldKey: 'wattage', label: 'System Power', canonicalField: 'SYSTEM_POWER' },
  { fieldKey: 'lumens', label: 'Luminaire Flux', canonicalField: 'LUMINAIRE_FLUX' },
  { fieldKey: 'lightColor', label: 'CCT', canonicalField: 'CCT' },
  { fieldKey: 'cri', label: 'CRI', canonicalField: 'CRI' },
  {
    fieldKey: 'beamAngle',
    label: 'Beam Angle',
    canonicalField: 'BEAM_ANGLE',
    qualitativeCanonicalField: 'LIGHT_DISTRIBUTION',
  },
  { fieldKey: 'ipRating', label: 'IP Rating', canonicalField: 'IP_RATING' },
  { fieldKey: 'cutout', label: 'Cutout', canonicalField: 'CUTOUT' },
  { fieldKey: 'dimensions', label: 'Dimensions', canonicalField: 'DIMENSIONS' },
  { fieldKey: 'bodyColorFinish', label: 'Body Color / Finish', canonicalField: 'BODY_COLOR' },
  {
    fieldKey: 'control',
    label: 'Control / Dimming',
    canonicalField: 'CONTROL',
    capabilitySafe: true,
  },
  { fieldKey: 'driver', label: 'Driver', canonicalField: 'DRIVER', capabilitySafe: true },
  { fieldKey: 'emergency', label: 'Emergency', canonicalField: 'EMERGENCY', capabilitySafe: true },
]);

function text(row: Row, key: string): string {
  return String(row[key] ?? '');
}

function normalizeIdentity(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleUpperCase('en')
    .replaceAll(/[^A-Z0-9]+/g, '');
}

function normalizeTechnical(field: LocalIntelligenceFieldKey, value: unknown): string {
  const source = String(value ?? '').replaceAll(',', '');
  if (['wattage', 'lumens', 'lightColor', 'beamAngle'].includes(field)) {
    const number = source.match(/[0-9]+(?:\.[0-9]+)?/)?.[0];
    return number ? String(Number(number)) : '';
  }
  if (field === 'cri') return source.match(/[0-9]{2,3}/)?.[0] ?? '';
  if (field === 'ipRating') return normalizeIdentity(source.replace(/^IP/i, ''));
  return normalizeIdentity(source);
}

/**
 * Recognized qualitative optic / distribution terms. When the Project beam
 * field holds one of these (rather than a numeric angle), it must be compared
 * against LIGHT_DISTRIBUTION evidence, never against numeric BEAM_ANGLE.
 */
const QUALITATIVE_DISTRIBUTION_TERMS: ReadonlyArray<string> = Object.freeze([
  'wide flood',
  'narrow flood',
  'extra wide flood',
  'medium flood',
  'flood',
  'wide',
  'narrow spot',
  'very narrow spot',
  'spot',
  'narrow',
  'asymmetric',
  'symmetric',
  'wall wash',
  'wallwasher',
  'batwing',
  'linear',
]);

function isQualitativeDistribution(value: string): boolean {
  const normalized = value.toLocaleLowerCase('en').replaceAll(/\s+/g, ' ').trim();
  return QUALITATIVE_DISTRIBUTION_TERMS.some((term) => normalized.includes(term));
}

function legacyStatus(result: DatasheetVerificationResult): DatasheetComparisonStatus {
  if (result === 'MATCH') return 'Matched';
  if (result === 'CONFLICT') return 'Mismatch';
  if (result === 'MISSING_IN_TABLE') return 'MissingSchedule';
  if (result === 'MISSING_IN_DATASHEET') return 'MissingDatasheet';
  return 'NeedsReview';
}

function emptyCounts(): Record<DatasheetComparisonStatus, number> {
  return {
    Matched: 0,
    Mismatch: 0,
    MissingSchedule: 0,
    MissingDatasheet: 0,
    NeedsReview: 0,
  };
}

function displayEvidenceValue(item: {
  canonicalField: string;
  normalizedValue: unknown;
  unit?: string | null;
}): string {
  const value = String(item.normalizedValue ?? '').trim();
  if (!value) return '';
  if (item.canonicalField === 'BEAM_ANGLE') return `${value}°`;
  if (item.unit && !value.toLocaleLowerCase('en').endsWith(item.unit.toLocaleLowerCase('en'))) {
    return `${value} ${item.unit}`;
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

interface Actor {
  id: string;
  name: string;
}

interface VerificationProjection {
  verificationId: string;
  fingerprint: string;
  comparisons: DatasheetComparisonField[];
  analysis: LuminaireDatasheetAnalysis;
}

export class LuminaireDatasheetVerificationService {
  private readonly projectWrites: ProjectLuminaireWriteStore;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly store: DocumentIntelligenceStore,
    private readonly worker: DocumentProcessingWorker,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.projectWrites = new ProjectLuminaireWriteStore(database, now);
  }

  public async verify(projectId: string, luminaireId: string): Promise<LuminaireDatasheetAnalysis> {
    return (await this.project(projectId, luminaireId)).analysis;
  }

  public async confirmField(
    projectId: string,
    luminaireId: string,
    input: ConfirmDatasheetFieldInput,
    actor: Actor,
  ) {
    const current = await this.project(projectId, luminaireId);
    const assetId = current.analysis.datasheetAssetVersionId!;
    const confirmations = new DatasheetConfirmationStore(this.database);
    if (confirmations.existing(input, projectId, luminaireId, assetId)) return current.analysis;
    if (input.verificationFingerprint !== current.fingerprint)
      throw new DomainError(
        'CONFLICT',
        'The Datasheet or Project changed. Reopen the current evidence before confirming.',
        409,
      );
    if (
      input.pageNumber > current.analysis.pageCount ||
      !comparisonFields.some((field) => field.fieldKey === input.fieldKey)
    )
      throw new DomainError(
        'VALIDATION_ERROR',
        'Choose a supported field and a page in the current Datasheet.',
        400,
      );
    if (
      ['wattage', 'lumens', 'lightColor', 'beamAngle'].includes(input.fieldKey) &&
      exactTechnicalNumber(input.fieldKey, input.value) === null
    )
      throw new DomainError(
        'VALIDATION_ERROR',
        'Enter one exact value with the correct unit, not a range or a list.',
        400,
      );
    const asset = this.database
      .prepare(
        'SELECT file_hash FROM luminaire_asset_versions WHERE id=? AND project_id=? AND luminaire_id=?',
      )
      .get(assetId, projectId, luminaireId);
    if (!asset) throw new DomainError('CONFLICT', 'The attached Datasheet changed.', 409);
    // No await between the stale check and append. Review evidence never updates a Project field.
    confirmations.append({
      ...input,
      schemaVersion: 1,
      projectId,
      luminaireId,
      assetVersionId: assetId,
      fileHash: String(asset.file_hash),
      actorId: actor.id,
      actorName: actor.name,
      at: this.now().toISOString(),
    });
    return (await this.project(projectId, luminaireId)).analysis;
  }

  public async keepProjectField(
    projectId: string,
    luminaireId: string,
    input: KeepProjectFieldInput,
    actor: Actor,
  ) {
    const current = await this.project(projectId, luminaireId);
    if (current.fingerprint !== input.verificationFingerprint)
      throw new DomainError(
        'CONFLICT',
        'The Project or Datasheet changed. Review the current comparison.',
        409,
      );
    const row = current.comparisons.find((item) => item.fieldKey === input.fieldKey);
    if (!row || !current.analysis.datasheetAssetVersionId)
      throw new DomainError('VALIDATION_ERROR', 'Select a current technical comparison.', 400);
    new ProjectFieldReviewStore(this.database).append({
      ...input,
      projectId,
      luminaireId,
      assetVersionId: current.analysis.datasheetAssetVersionId,
      projectValue: row.scheduleValue,
      actorId: actor.id,
      actorName: actor.name,
      at: this.now().toISOString(),
    });
    return (await this.project(projectId, luminaireId)).analysis;
  }

  /** Reconstruct persisted comparisons without admitting files, processing, or writing history. */
  public async readBatch(
    projectId: string,
    luminaires: readonly LuminaireRecord[],
  ): Promise<LuminaireDatasheetBatchResult | null> {
    if (luminaires.some((item) => item.projectId !== projectId))
      throw new DomainError(
        'PERMISSION_DENIED',
        'Technical results must belong to the requested Project.',
        403,
      );
    const items: LuminaireDatasheetBatchOutcome[] = [];
    const marker = this.database
      .prepare('SELECT json_value FROM app_state WHERE state_key=?')
      .get(`technical-check:last-run:v1:${projectId}`);
    if (marker)
      z.object({ schemaVersion: z.literal(1), at: z.string().datetime() })
        .strict()
        .parse(JSON.parse(String(marker.json_value)));
    let hasHistory = Boolean(marker);
    for (const luminaire of luminaires) {
      const exists = this.database
        .prepare(
          'SELECT verification_id FROM luminaire_datasheet_verifications WHERE project_luminaire_id=? LIMIT 1',
        )
        .get(luminaire.id);
      hasHistory ||= Boolean(exists);
      const asset = this.database
        .prepare(
          "SELECT * FROM luminaire_asset_versions WHERE project_id=? AND luminaire_id=? AND asset_type='Datasheet' ORDER BY version_sequence DESC LIMIT 1",
        )
        .get(projectId, luminaire.id) as Row | undefined;
      if (!asset || !luminaire.datasheetPath.trim()) {
        items.push({
          luminaireId: luminaire.id,
          tag: luminaire.tag,
          status: 'MISSING_DATASHEET',
          reasonCode: 'MISSING_DATASHEET',
          message: 'Attach an official Datasheet to this Luminaire first.',
          analysis: null,
        });
        continue;
      }
      if (text(asset, 'locator_kind') === 'LEGACY_PATH') {
        items.push({
          luminaireId: luminaire.id,
          tag: luminaire.tag,
          status: 'NEEDS_ADOPTION',
          reasonCode: 'LEGACY_DATASHEET_REQUIRES_ADOPTION',
          message: 'The Datasheet must be adopted into verified Project storage before analysis.',
          analysis: null,
        });
        continue;
      }
      if (!exists) {
        const attempt = this.database
          .prepare(
            'SELECT a.state FROM document_sources s JOIN document_versions v ON v.source_id=s.source_id JOIN document_processing_attempts a ON a.version_id=v.version_id WHERE s.luminaire_asset_version_id=? ORDER BY a.created_at DESC LIMIT 1',
          )
          .get(text(asset, 'id'));
        hasHistory ||= Boolean(attempt);
        const failed =
          attempt && !['COMPLETE', 'INCOMPLETE', 'QUEUED'].includes(String(attempt.state));
        items.push({
          luminaireId: luminaire.id,
          tag: luminaire.tag,
          status: failed ? 'PROCESSING_FAILED' : 'UNVERIFIED',
          reasonCode: failed ? 'VERIFICATION_FAILED' : 'NONE',
          message: failed
            ? 'Saved document processing did not complete. Review the processing finding.'
            : 'No saved verification exists for this Datasheet. Run Technical Check.',
          analysis: null,
        });
        continue;
      }
      try {
        const analysis = (await this.project(projectId, luminaire.id, true)).analysis;
        items.push({
          luminaireId: luminaire.id,
          tag: luminaire.tag,
          status: analysis.status === 'Ready' ? 'VERIFIED' : 'UNVERIFIED',
          reasonCode: 'NONE',
          message: analysis.message,
          analysis,
        });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        items.push({
          luminaireId: luminaire.id,
          tag: luminaire.tag,
          status: 'UNVERIFIED',
          reasonCode: 'VERIFICATION_FAILED',
          message:
            'Saved verification is no longer current. Run Technical Check to verify the current record and Datasheet.',
          analysis: null,
        });
      }
    }
    if (!hasHistory) return null;
    return {
      projectId,
      items,
      summary: {
        total: luminaires.length,
        analyzed: items.filter((item) => item.analysis !== null).length,
        verified: items.filter((item) => item.status === 'VERIFIED').length,
        needsAdoption: items.filter((item) => item.status === 'NEEDS_ADOPTION').length,
        failed: items.filter((item) => item.status === 'PROCESSING_FAILED').length,
        unverified: items.filter((item) => item.status === 'UNVERIFIED').length,
      },
    };
  }

  public async verifyBatch(
    projectId: string,
    luminaires: readonly LuminaireRecord[],
  ): Promise<LuminaireDatasheetBatchResult> {
    if (luminaires.some((item) => item.projectId !== projectId))
      throw new DomainError(
        'PERMISSION_DENIED',
        'Technical checks must belong to the requested Project.',
        403,
      );
    const items: LuminaireDatasheetBatchOutcome[] = [];
    for (const luminaire of luminaires) {
      const asset = this.database
        .prepare(
          `SELECT * FROM luminaire_asset_versions
           WHERE project_id=? AND luminaire_id=? AND asset_type='Datasheet'
           ORDER BY version_sequence DESC LIMIT 1`,
        )
        .get(projectId, luminaire.id) as Row | undefined;
      if (!asset || !luminaire.datasheetPath.trim()) {
        items.push({
          luminaireId: luminaire.id,
          tag: luminaire.tag,
          status: 'MISSING_DATASHEET',
          reasonCode: 'MISSING_DATASHEET',
          message: 'Attach an official Datasheet to this Luminaire first.',
          analysis: null,
        });
        continue;
      }
      if (text(asset, 'locator_kind') === 'LEGACY_PATH') {
        items.push({
          luminaireId: luminaire.id,
          tag: luminaire.tag,
          status: 'NEEDS_ADOPTION',
          reasonCode: 'LEGACY_DATASHEET_REQUIRES_ADOPTION',
          message:
            'The Datasheet exists, but it must be adopted into verified Project storage before it can be analyzed.',
          analysis: null,
        });
        continue;
      }
      try {
        const analysis = await this.verify(projectId, luminaire.id);
        const verified = analysis.status === 'Ready';
        items.push({
          luminaireId: luminaire.id,
          tag: luminaire.tag,
          status: verified ? 'VERIFIED' : 'UNVERIFIED',
          reasonCode: 'NONE',
          message: analysis.message,
          analysis,
        });
      } catch (error) {
        const reasonCode = this.failureReason(text(asset, 'id'), error);
        items.push({
          luminaireId: luminaire.id,
          tag: luminaire.tag,
          status: 'PROCESSING_FAILED',
          reasonCode,
          message: this.failureMessage(reasonCode),
          analysis: null,
        });
      }
    }
    const at = this.now().toISOString();
    this.database
      .prepare(
        'INSERT INTO app_state(state_key,json_value,updated_at) VALUES(?,?,?) ON CONFLICT(state_key) DO UPDATE SET json_value=excluded.json_value,updated_at=excluded.updated_at',
      )
      .run(
        `technical-check:last-run:v1:${projectId}`,
        JSON.stringify({ schemaVersion: 1, at }),
        at,
      );
    return {
      projectId,
      items,
      summary: {
        total: items.length,
        analyzed: items.filter((item) => item.analysis !== null).length,
        verified: items.filter((item) => item.status === 'VERIFIED').length,
        needsAdoption: items.filter((item) => item.status === 'NEEDS_ADOPTION').length,
        failed: items.filter((item) => item.status === 'PROCESSING_FAILED').length,
        unverified: items.filter((item) => item.status === 'UNVERIFIED').length,
      },
    };
  }

  public async resolveProjectField(input: {
    projectId: string;
    luminaireId: string;
    fieldKey: LocalIntelligenceFieldKey;
    expectedRowVersion: number;
    verificationFingerprint: string;
    actor: Actor;
  }): Promise<LuminaireDatasheetAnalysis> {
    const current = await this.project(input.projectId, input.luminaireId);
    if (current.fingerprint !== input.verificationFingerprint) {
      throw new DomainError(
        'CONFLICT',
        'The Datasheet verification changed. Refresh before applying a value.',
        409,
      );
    }
    const binding = this.binding(input.projectId, input.luminaireId);
    if (binding) {
      throw new DomainError(
        'CONFLICT',
        'Library-linked technical truth cannot be changed in the Project. Create a Library correction Draft.',
        409,
      );
    }
    const comparison = current.comparisons.find((item) => item.fieldKey === input.fieldKey);
    if (
      !comparison ||
      !comparison.canUseDatasheetValue ||
      !['CONFLICT', 'MISSING_IN_TABLE'].includes(comparison.verificationResult ?? '')
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'This field does not have verified Datasheet evidence that can be adopted.',
        400,
      );
    }
    const before = this.projectWrites.get(input.projectId, input.luminaireId);
    if (before.rowVersion !== input.expectedRowVersion) {
      throw new DomainError('CONFLICT', 'The Project Luminaire changed after review.', 409);
    }
    const change: ImportSparseChange = {
      field: input.fieldKey as ImportSparseChange['field'],
      before: before[input.fieldKey] as string | number,
      after: comparison.value,
    };
    const after = this.projectWrites.patch(
      input.projectId,
      input.luminaireId,
      input.expectedRowVersion,
      before.tag,
      [change],
      false,
    );
    const at = this.now().toISOString();
    this.database
      .prepare(
        `UPDATE luminaire_datasheet_verifications
         SET state='STALE',row_version=row_version+1,updated_at=?
         WHERE verification_id=? AND state='CURRENT'`,
      )
      .run(at, current.verificationId);
    this.database
      .prepare(
        `INSERT INTO workspace_activity
         (id,project_id,entity_type,entity_id,action,title,detail,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        input.projectId,
        'Luminaire',
        input.luminaireId,
        'DATASHEET_VALUE_ADOPTED',
        `Datasheet ${comparison.label} adopted`,
        JSON.stringify({
          actorId: input.actor.id,
          actorName: input.actor.name,
          field: input.fieldKey,
          oldValue: change.before,
          newValue: change.after,
          sourceVerificationFingerprint: input.verificationFingerprint,
          resultingRowVersion: after.rowVersion,
        }),
        at,
      );
    return this.verify(input.projectId, input.luminaireId);
  }

  private async project(
    projectId: string,
    luminaireId: string,
    readOnly = false,
  ): Promise<VerificationProjection> {
    const luminaire = this.projectWrites.get(projectId, luminaireId);
    const asset = this.database
      .prepare(
        `SELECT * FROM luminaire_asset_versions
         WHERE project_id=? AND luminaire_id=? AND asset_type='Datasheet'
         ORDER BY version_sequence DESC LIMIT 1`,
      )
      .get(projectId, luminaireId) as Row | undefined;
    if (!asset) {
      throw new DomainError(
        'NOT_FOUND',
        'Attach an official Datasheet to this Luminaire first.',
        404,
      );
    }
    if (
      !luminaire.datasheetPath.trim() ||
      text(asset, 'file_path').trim() !== luminaire.datasheetPath.trim()
    ) {
      throw new DomainError(
        'CONFLICT',
        'The latest Datasheet AssetVersion does not match the Luminaire current attachment authority.',
        409,
      );
    }
    const fileHash = text(asset, 'file_hash');
    const sizeBytes = Number(asset.size_bytes);
    if (!/^[0-9a-f]{64}$/.test(fileHash) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw new DomainError(
        'CONFLICT',
        'The attached Datasheet AssetVersion does not have verified byte authority.',
        409,
      );
    }
    const binding = this.binding(projectId, luminaireId);
    const authorityKind = binding ? 'LIBRARY_VERSION' : 'PROJECT_ROW';
    const authorityVersion = binding
      ? text(binding, 'selected_version_id')
      : String(luminaire.rowVersion);
    const idempotencyKey = sha256({
      operation: 'LUMINAIRE_DATASHEET_VERIFICATION',
      projectId,
      luminaireId,
      authorityKind,
      authorityVersion,
      assetVersionId: text(asset, 'id'),
      fileHash,
      semantic: LUMINAIRE_DATASHEET_SEMANTIC_MAPPING_VERSION,
    });
    const admissionInput = {
      luminaireAssetVersionId: text(asset, 'id'),
      projectId,
      luminaireId,
      sha256: fileHash,
      sizeBytes,
      originalFileName: text(asset, 'file_name'),
      idempotencyKey,
    };
    const admission = readOnly
      ? this.store.readLuminaireAssetAdmission(admissionInput)
      : this.store.createLuminaireAssetAdmission(admissionInput);
    if (!admission)
      throw new DomainError(
        'CONFLICT',
        'No saved extraction matches the current Datasheet authority.',
        409,
      );
    const reusedExtraction = ['COMPLETE', 'INCOMPLETE'].includes(admission.processingState);
    if (readOnly && !reusedExtraction)
      throw new DomainError('CONFLICT', 'The saved extraction is not complete.', 409);
    if (!reusedExtraction) await this.worker.process(admission.processingAttemptId);
    const attempt = this.store.attempt(admission.processingAttemptId);
    if (!['COMPLETE', 'INCOMPLETE'].includes(attempt.state)) {
      throw new DomainError(
        'CONFLICT',
        'The attached Datasheet could not be verified. Review the P5C processing finding.',
        409,
      );
    }
    const firstEvidencePage = this.store.evidence(admission.documentVersionId, 0, 100);
    if (firstEvidencePage.totalCount > 5000)
      throw new DomainError(
        'CONFLICT',
        'The Datasheet has too many evidence values for a bounded verification. Split the document before verification.',
        409,
      );
    const allEvidence = [...firstEvidencePage.items];
    for (let page = 1; page * 100 < firstEvidencePage.totalCount; page += 1)
      allEvidence.push(...this.store.evidence(admission.documentVersionId, page, 100).items);
    let evidence = allEvidence.filter(
      (item) =>
        item.adapterId === 'LUMINAIRE_DATASHEET_SEMANTIC' || item.adapterId === 'ERCO_DATASHEET_V1',
    );
    const confirmations = new DatasheetConfirmationStore(this.database);
    for (const definition of comparisonFields) {
      const confirmed = confirmations.latest(
        projectId,
        luminaireId,
        text(asset, 'id'),
        fileHash,
        definition.fieldKey,
      );
      if (!confirmed) continue;
      const previous = evidence.find(
        (item) =>
          item.canonicalField === definition.canonicalField &&
          (definition.fieldKey !== 'orderingCode' ||
            normalizeIdentity(item.normalizedValue) === normalizeIdentity(confirmed.value)),
      );
      const numeric = exactTechnicalNumber(definition.fieldKey, confirmed.value);
      evidence = evidence.filter((item) => item.canonicalField !== definition.canonicalField);
      evidence.push({
        id: confirmed.operationId,
        versionId: admission.documentVersionId,
        pageNumber: confirmed.pageNumber,
        region: previous?.pageNumber === confirmed.pageNumber ? previous.region : null,
        rawValue: `Confirmed by ${confirmed.actorName} at ${confirmed.at}: ${confirmed.value}. ${confirmed.note}`,
        normalizedValue: numeric ?? confirmed.value.toUpperCase(),
        canonicalField: definition.canonicalField,
        unit:
          previous?.unit ??
          (
            { wattage: 'W', lumens: 'lm', lightColor: 'K', beamAngle: 'deg' } as Record<
              string,
              string
            >
          )[definition.fieldKey] ??
          null,
        basis: previous?.basis ?? 'OWNER_CONFIRMED',
        method: previous?.method ?? 'NATIVE_TEXT',
        confidence: 100,
        adapterId: 'OWNER_CONFIRMATION',
        extractorVersion: LUMINAIRE_DATASHEET_SEMANTIC_MAPPING_VERSION,
        warnings: [
          `OWNER_CONFIRMED:${confirmed.actorName}`,
          ...(confirmed.acceptIdentityMismatch ? ['OWNER_IDENTITY_CONFIRMED'] : []),
          `CONFIRMED_AT:${confirmed.at}`,
          ...(definition.fieldKey === 'orderingCode'
            ? (previous?.warnings.filter((w) => w.startsWith('PRODUCT_ROW:')) ?? [])
            : []),
        ],
      });
    }
    const expectedCode = luminaire.orderingCode?.trim() || luminaire.model.trim();
    const codeValues = evidence.filter((item) => item.canonicalField === 'ORDERING_CODE');
    const exactCode = codeValues.find(
      (item) => normalizeIdentity(item.normalizedValue) === normalizeIdentity(expectedCode),
    );
    const extractedManufacturers = evidence.filter(
      (item) => item.canonicalField === 'MANUFACTURER',
    );
    const manufacturerMatch = extractedManufacturers.some(
      (item) =>
        normalizeIdentity(item.normalizedValue) === normalizeIdentity(luminaire.manufacturer),
    );
    const libraryAssetIdentity = Boolean(asset.source_library_asset_version_id && binding);
    let identityResult: 'MATCH' | 'UNVERIFIED' | 'POSSIBLE_WRONG_DATASHEET';
    if (libraryAssetIdentity) identityResult = 'MATCH';
    else if (
      expectedCode &&
      exactCode &&
      exactCode.confidence >= 85 &&
      (!luminaire.manufacturer.trim() || manufacturerMatch)
    ) {
      identityResult = 'MATCH';
    } else if (
      (codeValues.some((item) => item.confidence >= 85) && expectedCode && !exactCode) ||
      (extractedManufacturers.length > 0 && luminaire.manufacturer.trim() && !manufacturerMatch)
    ) {
      identityResult = 'POSSIBLE_WRONG_DATASHEET';
    } else identityResult = 'UNVERIFIED';

    const exactRow = exactCode?.warnings
      .find((warning) => warning.startsWith('PRODUCT_ROW:'))
      ?.slice('PRODUCT_ROW:'.length);
    const rowCodes = new Set(
      evidence.flatMap((item) =>
        item.warnings
          .filter((warning) => warning.startsWith('PRODUCT_ROW:'))
          .map((warning) => warning.slice('PRODUCT_ROW:'.length)),
      ),
    );
    const eligibleEvidence = evidence.filter((item) => {
      const row = item.warnings
        .find((warning) => warning.startsWith('PRODUCT_ROW:'))
        ?.slice('PRODUCT_ROW:'.length);
      if (!row) return true;
      return Boolean(exactRow && normalizeIdentity(row) === normalizeIdentity(exactRow));
    });
    const counts = emptyCounts();
    const comparisons = comparisonFields.flatMap((definition): DatasheetComparisonField[] => {
      const scheduleValue = String(luminaire[definition.fieldKey] ?? '').trim();
      const qualitative =
        definition.qualitativeCanonicalField &&
        isQualitativeDistribution(scheduleValue) &&
        definition.fieldKey === 'beamAngle';
      const canonicalField = qualitative
        ? definition.qualitativeCanonicalField!
        : definition.canonicalField;
      const candidates = eligibleEvidence.filter((item) => item.canonicalField === canonicalField);
      if (!scheduleValue && candidates.length === 0) return [];
      // For capability-safe fields, exact-supplied evidence outranks
      // capability-only candidates. When at least one exact candidate exists,
      // capability-only items are excluded so they cannot create ambiguity.
      const exactCandidates = definition.capabilitySafe
        ? candidates.filter(
            (item) => !item.warnings.some((warning) => warning.startsWith('CAPABILITY_ONLY')),
          )
        : candidates;
      const rankedCandidates = exactCandidates.length > 0 ? exactCandidates : candidates;
      const best = [...rankedCandidates].sort(
        (left, right) => right.confidence - left.confidence,
      )[0];
      const unique = new Set(rankedCandidates.map((item) => String(item.normalizedValue)));
      const ambiguous =
        unique.size > 1 ||
        Boolean(best?.warnings.some((warning) => warning.startsWith('AMBIGUOUS_OPTIONS:'))) ||
        (rowCodes.size > 1 && !exactRow);
      // Capability-only evidence (optional/accessory/compatible/approved-for
      // language) proves what a product CAN do, never the exact supplied
      // Project configuration. It must never produce a hard conflict or be
      // adopted as Project truth.
      const capabilityOnly = Boolean(
        definition.capabilitySafe &&
        best?.warnings.some((warning) => warning.startsWith('CAPABILITY_ONLY')),
      );
      const ownerAcceptedIdentity =
        best?.adapterId === 'OWNER_CONFIRMATION' &&
        best.warnings.includes('OWNER_IDENTITY_CONFIRMED');
      let result: DatasheetVerificationResult;
      if (identityResult === 'POSSIBLE_WRONG_DATASHEET' && !ownerAcceptedIdentity)
        result = 'POSSIBLE_WRONG_DATASHEET';
      else if (capabilityOnly) result = 'UNVERIFIED';
      else if (
        (identityResult !== 'MATCH' && !ownerAcceptedIdentity) ||
        ambiguous ||
        (best && best.confidence < 85)
      ) {
        result = 'UNVERIFIED';
      } else if (!best) result = 'MISSING_IN_DATASHEET';
      else if (!scheduleValue) result = 'MISSING_IN_TABLE';
      else if (qualitative) {
        // Compare the qualitative Project distribution term against the
        // LIGHT_DISTRIBUTION evidence using identity normalization, never
        // against a numeric BEAM_ANGLE.
        result =
          normalizeIdentity(scheduleValue) === normalizeIdentity(best.normalizedValue)
            ? 'MATCH'
            : 'CONFLICT';
      } else if (
        ['wattage', 'lumens', 'lightColor', 'beamAngle', 'cri'].includes(definition.fieldKey)
      ) {
        const actual = exactTechnicalNumber(definition.fieldKey, scheduleValue);
        const expected = exactTechnicalNumber(definition.fieldKey, best.normalizedValue);
        result =
          actual === null || expected === null
            ? 'UNVERIFIED'
            : actual === expected
              ? 'MATCH'
              : 'CONFLICT';
      } else {
        result =
          normalizeTechnical(definition.fieldKey, scheduleValue) ===
          normalizeTechnical(definition.fieldKey, best.normalizedValue)
            ? 'MATCH'
            : 'CONFLICT';
      }
      const status = legacyStatus(result);
      counts[status] += 1;
      const confidence = best?.confidence ?? 0;
      return [
        {
          fieldKey: definition.fieldKey,
          label: definition.label,
          value: best ? displayEvidenceValue(best) : '',
          alternatives: [...unique].slice(0, 6),
          confidence,
          pageNumber: best?.pageNumber ?? 0,
          evidence:
            best?.rawValue ?? 'The semantic field was not found in the exact Datasheet evidence.',
          ambiguous,
          scheduleValue,
          status,
          verificationResult: result,
          ...(best ? { method: best.method } : {}),
          confidenceBand: confidence >= 85 ? 'HIGH' : confidence >= 65 ? 'MEDIUM' : 'LOW',
          unit: best?.unit ?? null,
          basis: best?.basis ?? null,
          region: best?.region ?? null,
          reviewNotes:
            best?.warnings.filter((warning) =>
              /OCR_|SOURCE_POWER_|FLUX_|CONFIGURATION_|OWNER_CONFIRMED|CONFIRMED_AT|ENGINEERING_/.test(
                warning,
              ),
            ) ?? [],
          canUseDatasheetValue:
            !binding &&
            ['CONFLICT', 'MISSING_IN_TABLE'].includes(result) &&
            confidence >= 85 &&
            !ambiguous,
        },
      ];
    });
    const comparisonFingerprint = sha256({
      projectLuminaireId: luminaireId,
      authorityKind,
      authorityVersion,
      assetVersionId: text(asset, 'id'),
      datasheetSha256: fileHash,
      documentVersionId: admission.documentVersionId,
      extractorFingerprint: attempt.extractorFingerprint,
      semanticMappingVersion: LUMINAIRE_DATASHEET_SEMANTIC_MAPPING_VERSION,
      identityResult,
      comparisons: comparisons.map((item) => ({
        field: item.fieldKey,
        current: item.scheduleValue,
        datasheet: item.value,
        result: item.verificationResult,
        evidence: item.evidence,
      })),
    });
    const current = this.database
      .prepare(
        `SELECT * FROM luminaire_datasheet_verifications
         WHERE project_luminaire_id=? AND state='CURRENT'`,
      )
      .get(luminaireId) as Row | undefined;
    if (readOnly && (!current || text(current, 'comparison_fingerprint') !== comparisonFingerprint))
      throw new DomainError(
        'CONFLICT',
        'The saved verification no longer matches current record or Datasheet evidence.',
        409,
      );
    let verificationId = current ? text(current, 'verification_id') : randomUUID();
    const at = this.now().toISOString();
    if (!current || text(current, 'comparison_fingerprint') !== comparisonFingerprint) {
      if (current) {
        this.database
          .prepare(
            `UPDATE luminaire_datasheet_verifications
             SET state=?,row_version=row_version+1,updated_at=? WHERE verification_id=?`,
          )
          .run(
            text(current, 'luminaire_asset_version_id') === text(asset, 'id')
              ? 'STALE'
              : 'SUPERSEDED',
            at,
            text(current, 'verification_id'),
          );
        verificationId = randomUUID();
      }
      this.database
        .prepare(
          `INSERT INTO luminaire_datasheet_verifications
           (verification_id,project_luminaire_id,luminaire_asset_version_id,document_version_id,
            luminaire_authority_kind,luminaire_authority_version,datasheet_sha256,
            extractor_fingerprint,semantic_mapping_version,comparison_fingerprint,state,
            row_version,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'CURRENT',1,?,?)`,
        )
        .run(
          verificationId,
          luminaireId,
          text(asset, 'id'),
          admission.documentVersionId,
          authorityKind,
          authorityVersion,
          fileHash,
          attempt.extractorFingerprint,
          LUMINAIRE_DATASHEET_SEMANTIC_MAPPING_VERSION,
          comparisonFingerprint,
          at,
          at,
        );
    }
    const pageCount = Math.max(0, ...evidence.map((item) => item.pageNumber));
    for (const review of new ProjectFieldReviewStore(this.database).list(
      projectId,
      luminaireId,
      comparisonFingerprint,
    )) {
      const comparison = comparisons.find((item) => item.fieldKey === review.fieldKey);
      if (comparison)
        comparison.reviewNotes = [
          ...(comparison.reviewNotes ?? []).filter(
            (note) => !note.startsWith('KEPT_PROJECT_VALUE:'),
          ),
          `KEPT_PROJECT_VALUE:${review.actorName} · ${review.at}`,
        ];
    }
    const needsReview = identityResult !== 'MATCH' || counts.NeedsReview > 0;
    const analysis: LuminaireDatasheetAnalysis = {
      luminaireId,
      tag: luminaire.tag,
      datasheetPath: '',
      fileName: text(asset, 'file_name'),
      analyzedAt: readOnly && current ? text(current, 'updated_at') : at,
      engine: ENGINE,
      privacyMode: 'LocalOnly',
      status: needsReview ? 'NeedsReview' : 'Ready',
      message:
        identityResult === 'POSSIBLE_WRONG_DATASHEET'
          ? 'Possible wrong Datasheet: exact product identity conflicts with the attached PDF.'
          : identityResult === 'UNVERIFIED'
            ? 'Datasheet product identity is not strong enough for hard technical comparison.'
            : `${comparisons.length} identity-bound technical field(s) were verified locally.`,
      pageCount,
      textAvailable: evidence.length > 0,
      comparisons,
      counts,
      verificationId,
      verificationFingerprint: comparisonFingerprint,
      verificationState: 'CURRENT',
      datasheetAssetVersionId: text(asset, 'id'),
      documentId: admission.documentId,
      documentVersionId: admission.documentVersionId,
      identityResult,
      authorityKind,
      reusedExtraction,
      libraryLinked: Boolean(binding),
    };
    return { verificationId, fingerprint: comparisonFingerprint, comparisons, analysis };
  }

  private binding(projectId: string, luminaireId: string): Row | undefined {
    return this.database
      .prepare(
        `SELECT * FROM project_luminaire_library_bindings
         WHERE project_id=? AND luminaire_id=?`,
      )
      .get(projectId, luminaireId) as Row | undefined;
  }

  private failureReason(
    assetVersionId: string,
    error: unknown,
  ): LuminaireDatasheetBatchOutcome['reasonCode'] {
    const attempt = this.database
      .prepare(
        `SELECT a.error_code FROM document_sources s
         JOIN document_versions v ON v.source_id=s.source_id
         JOIN document_processing_attempts a ON a.version_id=v.version_id
         WHERE s.luminaire_asset_version_id=?
         ORDER BY a.created_at DESC LIMIT 1`,
      )
      .get(assetVersionId) as { error_code?: unknown } | undefined;
    const message = `${String(attempt?.error_code ?? '')} ${error instanceof Error ? error.message : ''}`;
    if (/STORAGE_UNVERIFIED|connected, verified Project folder/i.test(message)) {
      return 'STORAGE_UNVERIFIED';
    }
    if (/SOURCE_FILE_MISSING|ENOENT/i.test(message)) return 'SOURCE_FILE_MISSING';
    if (/SOURCE_HASH_MISMATCH|SOURCE_INTEGRITY/i.test(message)) return 'SOURCE_HASH_MISMATCH';
    if (/PDF_VALIDATION_FAILED/i.test(message)) return 'PDF_VALIDATION_FAILED';
    if (/NATIVE_EXTRACTION/i.test(message)) return 'NATIVE_EXTRACTION_FAILED';
    if (/OCR_FAILED/i.test(message)) return 'OCR_FAILED';
    if (/SEMANTIC_EXTRACTION/i.test(message)) return 'SEMANTIC_EXTRACTION_FAILED';
    return 'VERIFICATION_FAILED';
  }

  private failureMessage(reason: LuminaireDatasheetBatchOutcome['reasonCode']): string {
    const messages: Record<LuminaireDatasheetBatchOutcome['reasonCode'], string> = {
      NONE: 'Datasheet verification completed.',
      LEGACY_DATASHEET_REQUIRES_ADOPTION: 'The legacy Datasheet must be adopted before analysis.',
      STORAGE_UNVERIFIED: 'Connect / verify the Project folder before processing this Datasheet.',
      SOURCE_FILE_MISSING: 'The managed Datasheet file is unavailable.',
      SOURCE_HASH_MISMATCH: 'The managed Datasheet bytes do not match their stored hash.',
      PDF_VALIDATION_FAILED: 'The managed attachment is not a valid PDF.',
      NATIVE_EXTRACTION_FAILED: 'Native PDF extraction failed.',
      OCR_FAILED: 'OCR failed after the PDF reached the OCR stage.',
      SEMANTIC_EXTRACTION_FAILED: 'Datasheet semantic extraction failed.',
      VERIFICATION_FAILED: 'Datasheet verification failed. Review the processing finding.',
      MISSING_DATASHEET: 'Attach an official Datasheet first.',
    };
    return messages[reason];
  }
}
