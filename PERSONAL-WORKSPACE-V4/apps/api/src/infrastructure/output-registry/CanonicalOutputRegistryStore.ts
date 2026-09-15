import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  canonicalLuminaireSnapshotSchema,
  canonicalProjectSnapshotSchema,
  createCanonicalIssuePackageSchema,
  createCanonicalOutputSchema,
  createCanonicalRevisionSchema,
  duplicateRevisionSchema,
  type DuplicateRevisionInput,
  outputTemplateSelectionSchema,
  outputTemplateOverrideSchema,
  resolvedOutputTemplateSchema,
  updateRevisionMetadataSchema,
  type CreateCanonicalIssuePackageInput,
  type CreateCanonicalOutputInput,
  type CreateCanonicalRevisionInput,
  type OutputTemplateSelectionInput,
  type UpdateRevisionMetadataInput,
} from '@scli/contracts';
import {
  DomainError,
  currentBuiltInTemplateVersions,
  familiesCompatible,
  outputFamilies,
  outputRegistryLifecycleStates,
  outputRegistryProvenanceClassifications,
  resolveOutputTemplate,
  templateOrigins,
  templateStates,
  technicalBoqTemplateVersion,
  validateTemplateVersion,
  type CanonicalIssuePackageRecord,
  type CanonicalOutputRecord,
  type CanonicalPackageOutputRecord,
  type CanonicalRevisionRecord,
  type OutputFamily,
  type OutputRegistryLifecycleState,
  type OutputRegistryProvenanceClassification,
  type OutputTemplateDefinition,
  type OutputTemplateOverride,
  type OutputTemplateRecord,
  type OutputTemplateSelectionRecord,
  type OutputTemplateVersionRecord,
  type ResolvedOutputTemplate,
  type RevisionDeleteCounts,
  type RevisionDeleteManifest,
  type RevisionDeleteOperationRecord,
  type RevisionDeleteState,
  type RevisionReuseCandidate,
  type RevisionDocumentSnapshotRecord,
  type RevisionPackageDeliverableRecord,
  type TemplateState,
} from '@scli/domain';

type Row = Record<string, unknown>;

export interface OutputRegistryClock {
  now(): Date;
}

/**
 * Server-side identity seam for deterministic fixture/tooling construction.
 * Production callers omit it and retain cryptographically random UUIDs. The
 * seam is deliberately attached to the persistence authority rather than any
 * request contract, so a client can never choose canonical identities.
 */
export interface CanonicalRegistryIdentityFactory {
  revisionId(): string;
  outputId(): string;
  documentSnapshotId(): string;
}

/**
 * Aggregate writes stay dormant while the pre-v4 export/package writers are live. P2-FND-05 may
 * activate this store only after those compatibility writers delegate to the canonical workflow.
 */
export type CanonicalRegistryAuthorityMode = 'LEGACY_COMPATIBILITY' | 'CANONICAL';

const systemClock: OutputRegistryClock = { now: () => new Date() };
const randomIdentityFactory: CanonicalRegistryIdentityFactory = {
  revisionId: randomUUID,
  outputId: randomUUID,
  documentSnapshotId: randomUUID,
};
const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultTemplateSelection: Readonly<
  Record<OutputFamily, { readonly templateId: string; readonly versionId: string }>
> = Object.freeze({
  LuminaireSchedule: Object.freeze({
    templateId: 'schedule.technical-modern',
    versionId: 'v2',
  }),
  TechnicalBoq: Object.freeze({
    templateId: 'boq.technical-approved',
    versionId: 'v2',
  }),
  PresentationSchedule: Object.freeze({
    templateId: 'schedule.presentation',
    versionId: 'v2',
  }),
  DatasheetRegister: Object.freeze({
    templateId: 'datasheet.register',
    versionId: 'v1',
  }),
});

function validationError(message: string): DomainError {
  return new DomainError('VALIDATION_ERROR', message, 400);
}

function conflict(message: string): DomainError {
  return new DomainError('CONFLICT', message, 409);
}

function notFound(message: string): DomainError {
  return new DomainError('NOT_FOUND', message, 404);
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw validationError('Persisted JSON numbers must be finite.');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value !== 'object') {
    throw validationError('Persisted registry values must be JSON-compatible.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw validationError('Persisted registry objects must be plain JSON objects.');
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined) {
      throw validationError('Persisted registry values must not contain undefined.');
    }
    result[key] = canonicalize(item);
  }
  return result;
}

export function canonicalRegistryJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalRegistryHash(value: unknown): string {
  return createHash('sha256').update(canonicalRegistryJson(value), 'utf8').digest('hex');
}

function parseJson<T>(raw: unknown, parser: { parse(value: unknown): T }, label: string): T {
  if (typeof raw !== 'string') throw conflict(`Persisted ${label} is not text.`);
  try {
    return parser.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw conflict(`Persisted ${label} is invalid.`);
  }
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw conflict(`Persisted ${label} is invalid.`);
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw conflict(`Persisted ${label} is invalid.`);
  return parsed;
}

function lifecycle(value: unknown): OutputRegistryLifecycleState {
  if (
    typeof value !== 'string' ||
    !outputRegistryLifecycleStates.includes(value as OutputRegistryLifecycleState)
  ) {
    throw conflict('Persisted registry lifecycle is invalid.');
  }
  return value as OutputRegistryLifecycleState;
}

function provenance(value: unknown): OutputRegistryProvenanceClassification {
  if (
    typeof value !== 'string' ||
    !outputRegistryProvenanceClassifications.includes(
      value as OutputRegistryProvenanceClassification,
    )
  ) {
    throw conflict('Persisted registry provenance is invalid.');
  }
  return value as OutputRegistryProvenanceClassification;
}

function normalizeUuid(value: string, label: string): string {
  if (!canonicalUuidPattern.test(value)) throw validationError(`${label} requires a UUID.`);
  return value.toLowerCase();
}

export function normalizeCanonicalProjectRelativePath(value: string): string {
  const normalized = value.normalize('NFC').replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[a-zA-Z]:/.test(normalized) ||
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f || codePoint === 0x7f;
    }) ||
    normalized.includes(':')
  ) {
    throw validationError('Canonical artifact locators must be project-relative paths.');
  }
  const parts = normalized.split('/');
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[ .]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  ) {
    throw validationError('Canonical artifact locators must not escape the project root.');
  }
  return parts.join('/');
}

function persistedProjectRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string') throw conflict(`Persisted ${label} is invalid.`);
  try {
    const normalized = normalizeCanonicalProjectRelativePath(value);
    if (normalized !== value) throw new Error('not canonical');
    return normalized;
  } catch {
    throw conflict(`Persisted ${label} is not a canonical project-relative path.`);
  }
}

function assertResolvedFromRegisteredVersion(
  resolved: ResolvedOutputTemplate,
  registered: ResolvedOutputTemplate,
  currentState: TemplateState,
): void {
  if (
    resolved.templateId !== registered.templateId ||
    resolved.versionId !== registered.versionId ||
    resolved.family !== registered.family ||
    resolved.origin !== registered.origin ||
    resolved.displayName !== registered.displayName ||
    resolved.nonPriced !== registered.nonPriced ||
    resolved.state !== currentState
  ) {
    throw validationError('Resolved Template identity does not match its registered Version.');
  }

  const registeredSections = new Map(
    registered.sections.map((section) => [section.sectionId, section] as const),
  );
  if (
    resolved.sections.length !== registered.sections.length ||
    resolved.sections.some(
      (section) => registeredSections.get(section.sectionId)?.mandatory !== section.mandatory,
    )
  ) {
    throw validationError('Resolved Template sections do not match the registered structure.');
  }

  const registeredGroups = new Set(registered.columnGroups.map((group) => group.groupId));
  if (
    resolved.columnGroups.length !== registered.columnGroups.length ||
    resolved.columnGroups.some((group) => !registeredGroups.has(group.groupId))
  ) {
    throw validationError('Resolved Template column groups do not match the registered structure.');
  }

  const registeredColumns = new Map(
    registered.columns.map((column) => [column.columnId, column] as const),
  );
  if (
    resolved.columns.length !== registered.columns.length ||
    resolved.columns.some((column) => {
      const base = registeredColumns.get(column.columnId);
      return !base || base.fieldKey !== column.fieldKey || base.groupId !== column.groupId;
    })
  ) {
    throw validationError('Resolved Template columns do not match the registered structure.');
  }
}

function revisionFromRow(row: Row): CanonicalRevisionRecord {
  const projectSnapshot =
    row.project_snapshot_json === null
      ? null
      : parseJson(
          row.project_snapshot_json,
          canonicalProjectSnapshotSchema,
          'Revision project snapshot',
        );
  const luminaireSnapshot =
    row.luminaire_snapshot_json === null
      ? null
      : parseJson(
          row.luminaire_snapshot_json,
          {
            parse: (value) => {
              if (!Array.isArray(value)) throw new Error('not an array');
              return value.map((item) => canonicalLuminaireSnapshotSchema.parse(item));
            },
          },
          'Revision Luminaire snapshot',
        );
  const record: CanonicalRevisionRecord = {
    revisionId: requiredText(row.revision_id, 'Revision ID'),
    projectId: requiredText(row.project_id, 'Revision Project ID'),
    revisionSequence: requiredNumber(row.revision_sequence, 'Revision sequence'),
    revisionLabel: requiredText(row.revision_label, 'Revision label'),
    purpose: nullableText(row.purpose),
    internalNote: nullableText(row.internal_note),
    lifecycleState: lifecycle(row.lifecycle_state),
    projectSnapshot,
    luminaireSnapshot,
    snapshotHash: nullableText(row.snapshot_hash),
    createdById: nullableText(row.created_by_id),
    createdByName: nullableText(row.created_by_name),
    provenanceClassification: provenance(row.provenance_classification),
    legacySourceId: nullableText(row.legacy_source_id),
    failureReason: nullableText(row.failure_reason),
    createdAt: requiredText(row.created_at, 'Revision created timestamp'),
    finalizedAt: nullableText(row.finalized_at),
    updatedAt: requiredText(row.updated_at, 'Revision updated timestamp'),
  };
  if (
    record.provenanceClassification === 'CANONICAL' &&
    record.snapshotHash !==
      canonicalRegistryHash({
        project: record.projectSnapshot,
        luminaires: record.luminaireSnapshot,
      })
  ) {
    throw conflict('Persisted Revision snapshot failed its immutable fingerprint.');
  }
  return record;
}

function outputFromRow(row: Row): CanonicalOutputRecord {
  const snapshot =
    row.resolved_template_snapshot_json === null
      ? null
      : parseJson(
          row.resolved_template_snapshot_json,
          resolvedOutputTemplateSchema,
          'Output resolved template snapshot',
        );
  if (snapshot) validateTemplateVersion(snapshot);
  const family = nullableText(row.output_family);
  if (family !== null && !outputFamilies.includes(family as OutputFamily)) {
    throw conflict('Persisted Output family is invalid.');
  }
  if (
    snapshot &&
    (row.template_id !== snapshot.templateId ||
      row.template_version_id !== snapshot.versionId ||
      family === null ||
      !familiesCompatible(family as OutputFamily, snapshot.family))
  ) {
    throw conflict('Persisted Output Template provenance does not match its stored snapshot.');
  }
  if (snapshot && row.resolved_template_snapshot_hash !== canonicalRegistryHash(snapshot)) {
    throw conflict('Persisted Output template snapshot failed its immutable fingerprint.');
  }
  const locatorKind = requiredText(row.locator_kind, 'Output locator kind');
  if (
    locatorKind !== 'PROJECT_RELATIVE' &&
    locatorKind !== 'LEGACY_ABSOLUTE' &&
    locatorKind !== 'LEGACY_UNKNOWN'
  ) {
    throw conflict('Persisted Output locator kind is invalid.');
  }
  const locatorValue =
    locatorKind === 'PROJECT_RELATIVE'
      ? persistedProjectRelativePath(row.locator_value, 'Output locator')
      : nullableText(row.locator_value);
  const templateProvenance = requiredText(row.template_provenance, 'template provenance');
  if (templateProvenance !== 'RESOLVED' && templateProvenance !== 'LEGACY_UNKNOWN') {
    throw conflict('Persisted template provenance is invalid.');
  }
  return {
    outputId: requiredText(row.output_id, 'Output ID'),
    projectId: requiredText(row.project_id, 'Output Project ID'),
    revisionId: nullableText(row.revision_id),
    outputFamily: family as OutputFamily | null,
    outputFormat: requiredText(row.output_format, 'Output format'),
    locatorKind: locatorKind as CanonicalOutputRecord['locatorKind'],
    locatorValue,
    legacyAbsolutePath: nullableText(row.legacy_absolute_path),
    contentHash: nullableText(row.content_hash),
    templateId: nullableText(row.template_id),
    templateVersionId: nullableText(row.template_version_id),
    resolvedTemplateSnapshot: snapshot,
    resolvedTemplateSnapshotHash: nullableText(row.resolved_template_snapshot_hash),
    lifecycleState: lifecycle(row.lifecycle_state),
    provenanceClassification: provenance(row.provenance_classification),
    legacySourceId: nullableText(row.legacy_source_id),
    legacySourceField: nullableText(row.legacy_source_field),
    templateProvenance,
    failureReason: nullableText(row.failure_reason),
    createdAt: requiredText(row.created_at, 'Output created timestamp'),
    finalizedAt: nullableText(row.finalized_at),
    updatedAt: requiredText(row.updated_at, 'Output updated timestamp'),
  };
}

function documentSnapshotFromRow(row: Row): RevisionDocumentSnapshotRecord {
  const locatorKind = requiredText(row.locator_kind, 'Snapshot locator kind');
  if (
    locatorKind !== 'PROJECT_RELATIVE' &&
    locatorKind !== 'LEGACY_ABSOLUTE' &&
    locatorKind !== 'LEGACY_UNKNOWN'
  ) {
    throw conflict('Persisted Snapshot locator kind is invalid.');
  }
  const locatorValue =
    locatorKind === 'PROJECT_RELATIVE'
      ? persistedProjectRelativePath(row.locator_value, 'Snapshot locator')
      : requiredText(row.locator_value, 'Snapshot locator');
  const contentHash = requiredText(row.content_hash, 'Snapshot content hash').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    throw conflict('Persisted Snapshot content hash is invalid.');
  }
  const base = {
    deliverableId: requiredText(row.deliverable_id, 'Snapshot deliverable ID'),
    projectId: requiredText(row.project_id, 'Snapshot Project ID'),
    revisionId: requiredText(row.revision_id, 'Snapshot Revision ID'),
    category: requiredText(row.category, 'Snapshot category'),
    title: requiredText(row.title, 'Snapshot title'),
    fileName: requiredText(row.file_name, 'Snapshot file name'),
    sourceRelativePath: requiredText(row.source_relative_path, 'Snapshot source path'),
    locatorKind: locatorKind as RevisionDocumentSnapshotRecord['locatorKind'],
    locatorValue,
    contentHash,
    sizeBytes: requiredNumber(row.size_bytes, 'Snapshot size'),
    createdById: nullableText(row.created_by_id),
    createdByName: nullableText(row.created_by_name),
    createdAt: requiredText(row.created_at, 'Snapshot created timestamp'),
    sourceArtifactVersionId: nullableText(row.source_artifact_version_id),
  };
  const sourceDocumentId = nullableText(row.source_document_id);
  const sourceAssetVersionId = nullableText(row.source_asset_version_id);
  if (sourceDocumentId !== null && sourceAssetVersionId === null) {
    return { ...base, sourceType: 'ProjectDocument', sourceDocumentId, sourceAssetVersionId: null };
  }
  if (sourceDocumentId === null && sourceAssetVersionId !== null) {
    return {
      ...base,
      sourceType: 'LuminaireAssetVersion',
      sourceDocumentId: null,
      sourceAssetVersionId,
    };
  }
  throw conflict('Persisted Snapshot has an invalid source authority (source XOR invariant).');
}

function packageFromRow(row: Row): CanonicalIssuePackageRecord {
  const artifactLocatorKind = requiredText(row.artifact_locator_kind, 'Package locator kind');
  const manifestLocatorKind = nullableText(row.manifest_locator_kind);
  const validKinds = new Set(['PROJECT_RELATIVE', 'LEGACY_ABSOLUTE', 'LEGACY_UNKNOWN']);
  if (
    !validKinds.has(artifactLocatorKind) ||
    (manifestLocatorKind && !validKinds.has(manifestLocatorKind))
  ) {
    throw conflict('Persisted Package locator kind is invalid.');
  }
  const rawArtifactLocatorValue = nullableText(row.artifact_locator_value);
  const artifactLocatorValue =
    artifactLocatorKind === 'PROJECT_RELATIVE' && rawArtifactLocatorValue !== null
      ? persistedProjectRelativePath(rawArtifactLocatorValue, 'Package artifact locator')
      : rawArtifactLocatorValue;
  const rawManifestLocatorValue = nullableText(row.manifest_locator_value);
  const manifestLocatorValue =
    manifestLocatorKind === 'PROJECT_RELATIVE'
      ? persistedProjectRelativePath(rawManifestLocatorValue, 'Package manifest locator')
      : rawManifestLocatorValue;
  return {
    packageId: requiredText(row.package_id, 'Package ID'),
    projectId: requiredText(row.project_id, 'Package Project ID'),
    revisionId: nullableText(row.revision_id),
    packageSequence:
      row.package_sequence === null
        ? null
        : requiredNumber(row.package_sequence, 'Package sequence'),
    label: requiredText(row.label, 'Package label'),
    artifactLocatorKind: artifactLocatorKind as CanonicalIssuePackageRecord['artifactLocatorKind'],
    artifactLocatorValue,
    legacyAbsolutePath: nullableText(row.legacy_absolute_path),
    manifestLocatorKind: manifestLocatorKind as CanonicalIssuePackageRecord['manifestLocatorKind'],
    manifestLocatorValue,
    lifecycleState: lifecycle(row.lifecycle_state),
    provenanceClassification: provenance(row.provenance_classification),
    legacySourceId: nullableText(row.legacy_source_id),
    failureReason: nullableText(row.failure_reason),
    issuedById: nullableText(row.issued_by_id),
    issuedByName: nullableText(row.issued_by_name),
    issuedAt: nullableText(row.issued_at),
    createdAt: requiredText(row.created_at, 'Package created timestamp'),
    finalizedAt: nullableText(row.finalized_at),
    updatedAt: requiredText(row.updated_at, 'Package updated timestamp'),
  };
}

/**
 * The sole persistence authority for NEW canonical Revision/Output/Issue Package records.
 *
 * Existing project_revisions/project_exports/revision_packages writers remain a deliberately
 * separate legacy compatibility boundary until P2-FND-05 can reserve a Revision before any
 * filesystem work. This store never dual-writes those tables.
 */
export class CanonicalOutputRegistryStore {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly clock: OutputRegistryClock = systemClock,
    private readonly authorityMode: CanonicalRegistryAuthorityMode = 'LEGACY_COMPATIBILITY',
    private readonly identities: CanonicalRegistryIdentityFactory = randomIdentityFactory,
  ) {
    const row = this.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'canonical_revisions'",
      )
      .get() as { name?: string } | undefined;
    if (!row) throw conflict('Canonical Output Registry schema is not available.');
  }

  /** Read-only authority-mode probe used by production Personal bootstrap fail-closed checks. */
  public isCanonicalAuthority(): boolean {
    return this.authorityMode === 'CANONICAL';
  }

  private assertCanonicalAggregateWritesActive(): void {
    if (this.authorityMode !== 'CANONICAL') {
      throw conflict(
        'Canonical aggregate writes are dormant until P2-FND-05 disables the legacy compatibility writers.',
      );
    }
  }

  private transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      this.database.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the primary error; the SQLite handle reports transaction state separately.
      }
      throw error;
    }
  }

  public registerBuiltInTemplateVersions(createdBy = 'SYSTEM_P2_FND_04'): void {
    const templateTable = this.database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'output_templates'")
      .get() as { sql?: string | null } | undefined;
    const datasheetRegisterSupported = templateTable?.sql?.includes('DatasheetRegister') ?? false;
    for (const definition of currentBuiltInTemplateVersions) {
      // Compatibility-only startup against a not-yet-migrated v20 test/runtime
      // graph must not try to insert the v21-only family. Production startup
      // migrates first; v21 stores always register the complete current set.
      if (definition.family === 'DatasheetRegister' && !datasheetRegisterSupported) continue;
      this.registerTemplateVersion(definition, createdBy);
    }
  }

  public registerTechnicalBoqTemplateVersion(
    createdBy = 'SYSTEM_OUTPUT_REGISTRY_STARTUP',
  ): OutputTemplateVersionRecord {
    return this.registerTemplateVersion(technicalBoqTemplateVersion, createdBy);
  }

  public registerTemplateVersion(
    input: OutputTemplateDefinition,
    createdBy: string,
  ): OutputTemplateVersionRecord {
    const definition = resolvedOutputTemplateSchema.parse(input) as ResolvedOutputTemplate;
    validateTemplateVersion(definition);
    const definitionJson = canonicalRegistryJson(definition);
    const definitionHash = canonicalRegistryHash(definition);
    const now = this.clock.now().toISOString();
    return this.transaction(() => {
      const template = this.database
        .prepare('SELECT * FROM output_templates WHERE template_id = ?')
        .get(definition.templateId) as Row | undefined;
      if (template) {
        if (template.family !== definition.family || template.origin !== definition.origin) {
          throw conflict('A Template ID cannot change family or origin.');
        }
      } else {
        this.database
          .prepare(
            `INSERT INTO output_templates
             (template_id, family, origin, state, display_name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            definition.templateId,
            definition.family,
            definition.origin,
            definition.state,
            definition.displayName,
            now,
            now,
          );
      }

      const existing = this.database
        .prepare(
          `SELECT * FROM output_template_versions
           WHERE template_id = ? AND version_id = ?`,
        )
        .get(definition.templateId, definition.versionId) as Row | undefined;
      if (existing) {
        if (
          existing.definition_hash !== definitionHash ||
          existing.definition_json !== definitionJson
        ) {
          throw conflict(
            'Template version identity already exists with a different immutable definition.',
          );
        }
        return this.getTemplateVersion(definition.templateId, definition.versionId);
      }

      this.database
        .prepare(
          `INSERT INTO output_template_versions
           (template_id, version_id, definition_json, definition_hash, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          definition.templateId,
          definition.versionId,
          definitionJson,
          definitionHash,
          now,
          createdBy,
        );
      return this.getTemplateVersion(definition.templateId, definition.versionId);
    });
  }

  public getTemplate(templateId: string): OutputTemplateRecord {
    const row = this.database
      .prepare('SELECT * FROM output_templates WHERE template_id = ?')
      .get(templateId) as Row | undefined;
    if (!row) throw notFound('Output template not found.');
    const family = requiredText(row.family, 'Template family');
    const origin = requiredText(row.origin, 'Template origin');
    const state = requiredText(row.state, 'Template state');
    if (!outputFamilies.includes(family as OutputFamily))
      throw conflict('Template family is invalid.');
    if (!templateOrigins.includes(origin as (typeof templateOrigins)[number])) {
      throw conflict('Template origin is invalid.');
    }
    if (!templateStates.includes(state as TemplateState))
      throw conflict('Template state is invalid.');
    return {
      templateId: requiredText(row.template_id, 'Template ID'),
      family: family as OutputFamily,
      origin: origin as OutputTemplateRecord['origin'],
      state: state as TemplateState,
      displayName: requiredText(row.display_name, 'Template display name'),
      createdAt: requiredText(row.created_at, 'Template created timestamp'),
      updatedAt: requiredText(row.updated_at, 'Template updated timestamp'),
    };
  }

  public getTemplateVersion(templateId: string, versionId: string): OutputTemplateVersionRecord {
    const row = this.database
      .prepare(
        `SELECT * FROM output_template_versions
         WHERE template_id = ? AND version_id = ?`,
      )
      .get(templateId, versionId) as Row | undefined;
    if (!row) throw notFound('Output template version not found.');
    const definition = parseJson(
      row.definition_json,
      resolvedOutputTemplateSchema,
      'Template version definition',
    ) as ResolvedOutputTemplate;
    validateTemplateVersion(definition);
    const expectedHash = canonicalRegistryHash(definition);
    if (
      row.definition_hash !== expectedHash ||
      row.definition_json !== canonicalRegistryJson(definition)
    ) {
      throw conflict('Persisted Template version definition failed its immutable fingerprint.');
    }
    return {
      templateId,
      versionId,
      definition,
      definitionHash: expectedHash,
      createdAt: requiredText(row.created_at, 'Template version created timestamp'),
      createdBy: requiredText(row.created_by, 'Template version creator'),
    };
  }

  /** Active immutable versions for one exact family; schedule-type compatibility is not applied. */
  public listActiveTemplateVersions(outputFamily: OutputFamily): OutputTemplateVersionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT version.template_id, version.version_id
         FROM output_template_versions AS version
         INNER JOIN output_templates AS template ON template.template_id = version.template_id
         WHERE template.family = ? AND template.state = 'active'
         ORDER BY template.display_name, version.created_at, version.version_id`,
      )
      .all(outputFamily) as Array<{ template_id: unknown; version_id: unknown }>;
    return rows.map((row) =>
      this.getTemplateVersion(
        requiredText(row.template_id, 'Template ID'),
        requiredText(row.version_id, 'Template version ID'),
      ),
    );
  }

  public setTemplateState(templateId: string, state: TemplateState): OutputTemplateRecord {
    if (!templateStates.includes(state)) throw validationError('Unknown Template state.');
    const now = this.clock.now().toISOString();
    const result = this.database
      .prepare('UPDATE output_templates SET state = ?, updated_at = ? WHERE template_id = ?')
      .run(state, now, templateId);
    if (result.changes !== 1) throw notFound('Output template not found.');
    return this.getTemplate(templateId);
  }

  private validateSelection(input: OutputTemplateSelectionInput): {
    selection: OutputTemplateSelectionInput;
    resolved: ResolvedOutputTemplate;
  } {
    const selection = outputTemplateSelectionSchema.parse(input);
    const template = this.getTemplate(selection.templateId);
    const version = this.getTemplateVersion(selection.templateId, selection.versionId);
    const currentDefinition = { ...version.definition, state: template.state };
    const resolved = resolveOutputTemplate({
      templateId: selection.templateId,
      versionId: selection.versionId,
      requestedFamily: selection.outputFamily,
      globalConfig: selection.config,
      registry: [currentDefinition],
    });
    return { selection, resolved };
  }

  public setGlobalDefault(input: OutputTemplateSelectionInput): OutputTemplateSelectionRecord {
    const { selection } = this.validateSelection(input);
    const now = this.clock.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO global_output_template_defaults
         (output_family, template_id, version_id, config_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(output_family) DO UPDATE SET
           template_id = excluded.template_id,
           version_id = excluded.version_id,
           config_json = excluded.config_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        selection.outputFamily,
        selection.templateId,
        selection.versionId,
        canonicalRegistryJson(selection.config),
        now,
      );
    return this.getGlobalDefault(selection.outputFamily)!;
  }

  public getGlobalDefault(outputFamily: OutputFamily): OutputTemplateSelectionRecord | null {
    const row = this.database
      .prepare('SELECT * FROM global_output_template_defaults WHERE output_family = ?')
      .get(outputFamily) as Row | undefined;
    return row ? this.selectionFromRow(row, null) : null;
  }

  public setProjectOverride(
    projectId: string,
    input: OutputTemplateSelectionInput,
  ): OutputTemplateSelectionRecord {
    const normalizedProjectId = normalizeUuid(projectId, 'Project Template override');
    const { selection } = this.validateSelection(input);
    const now = this.clock.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_output_template_overrides
         (project_id, output_family, template_id, version_id, config_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, output_family) DO UPDATE SET
           template_id = excluded.template_id,
           version_id = excluded.version_id,
           config_json = excluded.config_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        normalizedProjectId,
        selection.outputFamily,
        selection.templateId,
        selection.versionId,
        canonicalRegistryJson(selection.config),
        now,
      );
    return this.getProjectOverride(normalizedProjectId, selection.outputFamily)!;
  }

  /** Technical-output write boundary with exact-family validation. */
  public setTechnicalOutputProjectOverride(
    projectId: string,
    outputFamily: 'LuminaireSchedule' | 'TechnicalBoq',
    input: Omit<OutputTemplateSelectionInput, 'outputFamily'>,
  ): OutputTemplateSelectionRecord {
    const template = this.getTemplate(input.templateId);
    if (template.family !== outputFamily) {
      throw validationError(`Technical output requires a ${outputFamily} template.`);
    }
    if (template.state !== 'active') {
      throw validationError('Inactive Templates cannot be selected for technical output.');
    }
    this.getTemplateVersion(input.templateId, input.versionId);
    return this.setProjectOverride(projectId, {
      outputFamily,
      ...input,
    });
  }

  public setTechnicalScheduleProjectOverride(
    projectId: string,
    input: Omit<OutputTemplateSelectionInput, 'outputFamily'>,
  ): OutputTemplateSelectionRecord {
    return this.setTechnicalOutputProjectOverride(projectId, 'LuminaireSchedule', input);
  }

  public setTechnicalBoqProjectOverride(
    projectId: string,
    input: Omit<OutputTemplateSelectionInput, 'outputFamily'>,
  ): OutputTemplateSelectionRecord {
    return this.setTechnicalOutputProjectOverride(projectId, 'TechnicalBoq', input);
  }

  public getProjectOverride(
    projectId: string,
    outputFamily: OutputFamily,
  ): OutputTemplateSelectionRecord | null {
    const normalizedProjectId = normalizeUuid(projectId, 'Project Template override');
    const row = this.database
      .prepare(
        `SELECT * FROM project_output_template_overrides
         WHERE project_id = ? AND output_family = ?`,
      )
      .get(normalizedProjectId, outputFamily) as Row | undefined;
    return row ? this.selectionFromRow(row, normalizedProjectId) : null;
  }

  private selectionFromRow(row: Row, projectId: string | null): OutputTemplateSelectionRecord {
    const family = requiredText(row.output_family, 'selection Output family');
    if (!outputFamilies.includes(family as OutputFamily)) {
      throw conflict('Persisted Template selection family is invalid.');
    }
    return {
      projectId,
      outputFamily: family as OutputFamily,
      templateId: requiredText(row.template_id, 'selection Template ID'),
      versionId: requiredText(row.version_id, 'selection Template version ID'),
      config: parseJson(row.config_json, outputTemplateOverrideSchema, 'Template selection config'),
      updatedAt: requiredText(row.updated_at, 'Template selection updated timestamp'),
    };
  }

  public resolveEffectiveTemplate(
    projectId: string,
    outputFamily: OutputFamily,
    generationOverride?: OutputTemplateOverride,
  ): ResolvedOutputTemplate {
    const global = this.getGlobalDefault(outputFamily);
    const project = this.getProjectOverride(projectId, outputFamily);
    const effective = project ??
      global ?? {
        projectId: null,
        outputFamily,
        ...defaultTemplateSelection[outputFamily],
        config: {},
        updatedAt: '',
      };
    const template = this.getTemplate(effective.templateId);
    const version = this.getTemplateVersion(effective.templateId, effective.versionId);
    const sameGlobalPair =
      global?.templateId === effective.templateId && global.versionId === effective.versionId;
    return resolveOutputTemplate({
      templateId: effective.templateId,
      versionId: effective.versionId,
      requestedFamily: outputFamily,
      globalConfig: sameGlobalPair ? global?.config : undefined,
      projectOverride: project?.config,
      generationOverride,
      registry: [{ ...version.definition, state: template.state }],
    });
  }

  public resolveEffectiveTechnicalScheduleTemplate(projectId: string): ResolvedOutputTemplate {
    const resolved = this.resolveEffectiveTemplate(projectId, 'LuminaireSchedule');
    if (resolved.family !== 'LuminaireSchedule') {
      throw conflict('Effective Technical Schedule selection is not a LuminaireSchedule template.');
    }
    return resolved;
  }

  public resolveEffectiveTechnicalBoqTemplate(projectId: string): ResolvedOutputTemplate {
    const hasCanonicalSelection =
      this.getProjectOverride(projectId, 'TechnicalBoq') !== null ||
      this.getGlobalDefault('TechnicalBoq') !== null;
    // The BOQ-only authority adopts the approved template until a canonical selection exists.
    // Generic resolution deliberately retains the legacy full-package fallback; after any explicit
    // BOQ selection/config write, both paths consume the same canonical project/global selection.
    const resolved = hasCanonicalSelection
      ? this.resolveEffectiveTemplate(projectId, 'TechnicalBoq')
      : resolveOutputTemplate({
          templateId: 'boq.technical-approved',
          versionId: 'v2',
          requestedFamily: 'TechnicalBoq',
          registry: [this.getTemplateVersion('boq.technical-approved', 'v2').definition],
        });
    if (resolved.family !== 'TechnicalBoq') {
      throw conflict('Effective Technical BOQ selection is not a TechnicalBoq template.');
    }
    return resolved;
  }

  public createRevision(input: CreateCanonicalRevisionInput): CanonicalRevisionRecord {
    this.assertCanonicalAggregateWritesActive();
    const projectId = createCanonicalRevisionSchema.parse(input).projectId;
    return this.transaction(() => {
      const revisionSequence = this.nextRevisionSequence(projectId);
      return this.insertCanonicalRevisionAtSequence(input, revisionSequence);
    });
  }

  private nextRevisionSequence(projectId: string): number {
    const row = this.database
      .prepare(
        `SELECT MAX(sequence_value) AS latest FROM (
             SELECT revision_sequence AS sequence_value
             FROM canonical_revisions WHERE project_id = ?
             UNION ALL
             SELECT revision_number AS sequence_value
             FROM project_revisions WHERE project_id = ?
             UNION ALL
             SELECT revision_sequence AS sequence_value
             FROM revision_delete_operations WHERE project_id = ?
           )`,
      )
      .get(projectId, projectId, projectId) as { latest?: number | null } | undefined;
    const revisionSequence = Number(row?.latest ?? 0) + 1;
    if (!Number.isSafeInteger(revisionSequence) || revisionSequence < 1) {
      throw conflict('Canonical Revision sequence authority is outside its safe range.');
    }
    return revisionSequence;
  }

  /** Copy only immutable snapshot authority; historical outputs remain owned by their source. */
  public duplicateRevision(
    projectId: string,
    sourceRevisionId: string,
    input: DuplicateRevisionInput,
    createdBy: CreateCanonicalRevisionInput['createdBy'],
  ): CanonicalRevisionRecord {
    this.assertCanonicalAggregateWritesActive();
    const parsed = duplicateRevisionSchema.parse(input);
    const owner = normalizeUuid(projectId, 'Project identity');
    return this.transaction(() => {
      const source = this.getRevision(sourceRevisionId);
      if (source.projectId !== owner) throw notFound('Source Revision not found in this Project.');
      const previous = this.listRevisions(owner).find(
        (item) => item.projectSnapshot?.duplicationRequestId === parsed.requestId,
      );
      if (previous) {
        if (
          previous.projectSnapshot?.duplicatedFromRevisionId !== source.revisionId ||
          previous.projectSnapshot?.duplicatedFromSnapshotHash !== parsed.expectedSnapshotHash
        )
          throw conflict('This duplication request was already used for another source.');
        return previous;
      }
      if (
        source.provenanceClassification !== 'CANONICAL' ||
        source.lifecycleState !== 'FINALIZED' ||
        !source.projectSnapshot ||
        !source.luminaireSnapshot
      )
        throw conflict(
          'Only a finalized canonical Revision with preserved snapshots can be duplicated.',
        );
      if (source.snapshotHash !== parsed.expectedSnapshotHash)
        throw conflict('The source Revision snapshot has changed. Reload before duplicating.');
      const snapshot = canonicalProjectSnapshotSchema.parse({
        ...source.projectSnapshot,
        canonicalOperation: 'MANUAL_DELIVERABLES',
        duplicatedFromRevisionId: source.revisionId,
        duplicatedFromSnapshotHash: source.snapshotHash,
        duplicationRequestId: parsed.requestId,
      });
      return this.insertCanonicalRevisionAtSequence(
        {
          projectId: owner,
          projectSnapshot: snapshot,
          luminaires: source.luminaireSnapshot,
          purpose: source.purpose,
          internalNote: source.internalNote,
          createdBy,
        },
        this.nextRevisionSequence(owner),
      );
    });
  }

  /** Transaction-neutral exact-sequence insert used only by the explicit P2C-04 claim. */
  private insertCanonicalRevisionAtSequence(
    input: CreateCanonicalRevisionInput,
    revisionSequence: number,
  ): CanonicalRevisionRecord {
    const parsed = createCanonicalRevisionSchema.parse(input);
    if (parsed.projectSnapshot.id !== parsed.projectId) {
      throw validationError('Revision Project snapshot identity does not match Project ownership.');
    }
    if (!Number.isSafeInteger(revisionSequence) || revisionSequence < 1) {
      throw validationError('Revision sequence must be a positive safe integer.');
    }
    const luminaireIds = new Set<string>();
    for (const luminaire of parsed.luminaires) {
      if (luminaireIds.has(luminaire.luminaireId)) {
        throw validationError('Revision Luminaire snapshot contains a duplicate UUID.');
      }
      luminaireIds.add(luminaire.luminaireId);
    }
    const projectSnapshotJson = canonicalRegistryJson(parsed.projectSnapshot);
    const luminaireSnapshotJson = canonicalRegistryJson(parsed.luminaires);
    const snapshotHash = canonicalRegistryHash({
      project: parsed.projectSnapshot,
      luminaires: parsed.luminaires,
    });
    const revisionId = normalizeUuid(this.identities.revisionId(), 'Canonical Revision identity');
    const now = this.clock.now().toISOString();
    const revisionLabel = `REV_${String(revisionSequence).padStart(2, '0')}`;
    this.database
      .prepare(
        `INSERT INTO canonical_revisions
         (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
          project_snapshot_json, luminaire_snapshot_json, snapshot_hash,
          created_by_id, created_by_name, provenance_classification, legacy_source_id,
          failure_reason, created_at, finalized_at, updated_at)
         VALUES (?, ?, ?, ?, 'PREPARING', ?, ?, ?, ?, ?, 'CANONICAL', NULL, NULL, ?, NULL, ?)`,
      )
      .run(
        revisionId,
        parsed.projectId,
        revisionSequence,
        revisionLabel,
        projectSnapshotJson,
        luminaireSnapshotJson,
        snapshotHash,
        parsed.createdBy.actorId,
        parsed.createdBy.actorNameSnapshot,
        now,
        now,
      );
    if (parsed.purpose !== null || parsed.internalNote !== null) {
      this.database
        .prepare(
          `UPDATE canonical_revisions
           SET purpose = ?, internal_note = ?, updated_at = ?
           WHERE revision_id = ? AND project_id = ?`,
        )
        .run(parsed.purpose, parsed.internalNote, now, revisionId, parsed.projectId);
    }
    return this.getRevision(revisionId);
  }

  public getRevision(revisionId: string): CanonicalRevisionRecord {
    const normalizedRevisionId = normalizeUuid(revisionId, 'Canonical Revision lookup');
    const row = this.database
      .prepare('SELECT * FROM canonical_revisions WHERE revision_id = ?')
      .get(normalizedRevisionId) as Row | undefined;
    if (!row) throw notFound('Canonical Revision not found.');
    return revisionFromRow(row);
  }

  public createOutput(input: CreateCanonicalOutputInput): CanonicalOutputRecord {
    this.assertCanonicalAggregateWritesActive();
    const parsed = createCanonicalOutputSchema.parse(input);
    const revision = this.getRevision(parsed.revisionId);
    if (revision.provenanceClassification !== 'CANONICAL') {
      throw validationError('New canonical Outputs require a canonical source Revision.');
    }
    if (revision.lifecycleState !== 'PREPARING') {
      throw conflict('New canonical Outputs require a PREPARING source Revision.');
    }
    const relativePath = normalizeCanonicalProjectRelativePath(parsed.relativePath);
    const resolved = resolvedOutputTemplateSchema.parse(
      parsed.resolvedTemplate,
    ) as ResolvedOutputTemplate;
    validateTemplateVersion(resolved);
    if (!familiesCompatible(parsed.outputFamily, resolved.family)) {
      throw validationError('Resolved Template family is incompatible with the Output family.');
    }
    const template = this.getTemplate(resolved.templateId);
    const registeredVersion = this.getTemplateVersion(resolved.templateId, resolved.versionId);
    if (template.state !== 'active') {
      throw validationError('Inactive Templates cannot be used for new Outputs.');
    }
    assertResolvedFromRegisteredVersion(resolved, registeredVersion.definition, template.state);
    const snapshotJson = canonicalRegistryJson(resolved);
    const snapshotHash = canonicalRegistryHash(resolved);
    const outputId = normalizeUuid(this.identities.outputId(), 'Canonical Output identity');
    const now = this.clock.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO canonical_outputs
         (output_id, project_id, revision_id, output_family, output_format,
          locator_kind, locator_value, legacy_absolute_path, content_hash,
          template_id, template_version_id, resolved_template_snapshot_json,
          resolved_template_snapshot_hash, lifecycle_state, provenance_classification,
          legacy_source_id, legacy_source_field, template_provenance, failure_reason,
          created_at, finalized_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PROJECT_RELATIVE', ?, NULL, ?, ?, ?, ?, ?,
                 'PREPARING', 'CANONICAL', NULL, NULL, 'RESOLVED', NULL, ?, NULL, ?)`,
      )
      .run(
        outputId,
        revision.projectId,
        revision.revisionId,
        parsed.outputFamily,
        parsed.outputFormat.toUpperCase(),
        relativePath,
        parsed.contentHash?.toLowerCase() ?? null,
        resolved.templateId,
        resolved.versionId,
        snapshotJson,
        snapshotHash,
        now,
        now,
      );
    return this.getOutput(outputId);
  }

  /** Reserves one generation operation's complete Output identity set in one short DB boundary. */
  public createOutputs(inputs: readonly CreateCanonicalOutputInput[]): CanonicalOutputRecord[] {
    this.assertCanonicalAggregateWritesActive();
    if (inputs.length === 0) {
      throw validationError('Canonical Output reservation requires at least one Output.');
    }
    return this.transaction(() => inputs.map((input) => this.createOutput(input)));
  }

  /** Historical reads return the stored resolved snapshot and never invoke today's resolver. */
  public getOutput(outputId: string): CanonicalOutputRecord {
    const normalizedOutputId = normalizeUuid(outputId, 'Canonical Output lookup');
    const row = this.database
      .prepare('SELECT * FROM canonical_outputs WHERE output_id = ?')
      .get(normalizedOutputId) as Row | undefined;
    if (!row) throw notFound('Canonical Output not found.');
    return outputFromRow(row);
  }

  public listRevisions(projectId?: string): CanonicalRevisionRecord[] {
    const rows = projectId
      ? (this.database
          .prepare(
            `SELECT * FROM canonical_revisions
             WHERE project_id = ? ORDER BY revision_sequence DESC, created_at DESC`,
          )
          .all(normalizeUuid(projectId, 'Canonical Revision Project lookup')) as Row[])
      : (this.database
          .prepare(
            `SELECT * FROM canonical_revisions
             ORDER BY project_id, revision_sequence DESC, created_at DESC`,
          )
          .all() as Row[]);
    return rows.map(revisionFromRow);
  }

  /**
   * Updates only canonical PREPARING Revision metadata. The lifecycle and exact
   * project/revision binding are re-read after BEGIN IMMEDIATE so stale UI state
   * can never mutate a Revision that was finalized concurrently.
   */
  public updateRevisionMetadata(
    projectId: string,
    revisionId: string,
    input: UpdateRevisionMetadataInput,
  ): CanonicalRevisionRecord {
    this.assertCanonicalAggregateWritesActive();
    const parsed = updateRevisionMetadataSchema.parse(input);
    const normalizedProjectId = normalizeUuid(projectId, 'Revision metadata Project');
    const normalizedRevisionId = normalizeUuid(revisionId, 'Revision metadata Revision');
    return this.transaction(() => {
      const revision = this.getRevision(normalizedRevisionId);
      if (
        revision.projectId !== normalizedProjectId ||
        revision.provenanceClassification !== 'CANONICAL'
      ) {
        throw notFound('Canonical Revision not found in this Project.');
      }
      if (revision.lifecycleState !== 'PREPARING') {
        throw conflict('Revision metadata can be edited only while the Revision is PREPARING.');
      }
      const assignments: string[] = [];
      const values: Array<string | null> = [];
      if (parsed.purpose !== undefined) {
        assignments.push('purpose = ?');
        values.push(parsed.purpose);
      }
      if (parsed.internalNote !== undefined) {
        assignments.push('internal_note = ?');
        values.push(parsed.internalNote);
      }
      const now = this.clock.now().toISOString();
      assignments.push('updated_at = ?');
      values.push(now);
      const result = this.database
        .prepare(
          `UPDATE canonical_revisions SET ${assignments.join(', ')}
           WHERE revision_id = ? AND project_id = ? AND lifecycle_state = 'PREPARING'`,
        )
        .run(...values, normalizedRevisionId, normalizedProjectId);
      if (result.changes !== 1) {
        throw conflict('Revision metadata could not be updated because its state changed.');
      }
      return this.getRevision(normalizedRevisionId);
    });
  }

  public getRevisionByCompatibilityId(compatibilityId: string): CanonicalRevisionRecord {
    const normalized = canonicalUuidPattern.test(compatibilityId)
      ? compatibilityId.toLowerCase()
      : compatibilityId;
    const row = this.database
      .prepare(
        `SELECT * FROM canonical_revisions
         WHERE revision_id = ? OR legacy_source_id = ?
         ORDER BY CASE WHEN revision_id = ? THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(normalized, compatibilityId, normalized) as Row | undefined;
    if (!row) throw notFound('Canonical Revision mapping not found.');
    return revisionFromRow(row);
  }

  public listOutputsForRevision(revisionId: string): CanonicalOutputRecord[] {
    const normalizedRevisionId = normalizeUuid(revisionId, 'Canonical Output Revision lookup');
    return (
      this.database
        .prepare(
          `SELECT * FROM canonical_outputs
           WHERE revision_id = ? ORDER BY output_family, output_format, output_id`,
        )
        .all(normalizedRevisionId) as Row[]
    ).map(outputFromRow);
  }

  public listOutputs(projectId?: string): CanonicalOutputRecord[] {
    const rows = projectId
      ? (this.database
          .prepare(
            `SELECT * FROM canonical_outputs
             WHERE project_id = ? ORDER BY created_at, output_id`,
          )
          .all(normalizeUuid(projectId, 'Canonical Output Project lookup')) as Row[])
      : (this.database
          .prepare('SELECT * FROM canonical_outputs ORDER BY project_id, created_at, output_id')
          .all() as Row[]);
    return rows.map(outputFromRow);
  }

  public updateOutputLocator(outputId: string, relativePath: string): CanonicalOutputRecord {
    this.assertCanonicalAggregateWritesActive();
    const normalizedOutputId = normalizeUuid(outputId, 'Canonical Output update');
    const normalized = normalizeCanonicalProjectRelativePath(relativePath);
    const now = this.clock.now().toISOString();
    const result = this.database
      .prepare(
        `UPDATE canonical_outputs
         SET locator_kind = 'PROJECT_RELATIVE', locator_value = ?, updated_at = ?
         WHERE output_id = ? AND provenance_classification = 'CANONICAL'
           AND lifecycle_state IN ('PREPARING', 'FAILED_RECOVERABLE')`,
      )
      .run(normalized, now, normalizedOutputId);
    if (result.changes !== 1) throw notFound('Canonical Output not found.');
    return this.getOutput(normalizedOutputId);
  }

  public setOutputContentHash(outputId: string, contentHash: string | null): CanonicalOutputRecord {
    this.assertCanonicalAggregateWritesActive();
    const normalizedOutputId = normalizeUuid(outputId, 'Canonical Output hash update');
    const normalizedHash = contentHash?.toLowerCase() ?? null;
    if (normalizedHash !== null && !/^[a-f0-9]{64}$/.test(normalizedHash)) {
      throw validationError('Canonical Output content hash must be a SHA-256 hex digest.');
    }
    const now = this.clock.now().toISOString();
    const result = this.database
      .prepare(
        `UPDATE canonical_outputs SET content_hash = ?, updated_at = ?
         WHERE output_id = ? AND provenance_classification = 'CANONICAL'
           AND lifecycle_state IN ('PREPARING', 'FAILED_RECOVERABLE')`,
      )
      .run(normalizedHash, now, normalizedOutputId);
    if (result.changes !== 1) {
      throw conflict('Only recoverable or preparing Outputs may change their content hash.');
    }
    return this.getOutput(normalizedOutputId);
  }

  /**
   * C0 — discards ONE UNPROVEN canonical Output reservation from a
   * MANUAL_DELIVERABLES composition draft.
   *
   * This is deliberately NOT a generic "delete Output" API. It exists so a
   * targeted generation that failed against a composed design draft leaves no
   * permanently attached, unfinalizable Output row behind (R3).
   *
   * The caller MUST have already proven the reservation is unproven against the
   * filesystem — this boundary is the DB invariant authority only and never
   * claims to know physical artifact truth. Every invariant below is re-checked
   * here independently of the caller so no caller can widen the authority:
   *
   *  - the Output exists and is CANONICAL provenance;
   *  - its lifecycle is an unproven reservation lifecycle (never FINALIZED,
   *    never LEGACY_IMPORTED);
   *  - it belongs to the caller's Project AND Revision;
   *  - the parent Revision exists, is CANONICAL and still PREPARING;
   *  - the parent Revision's creation provenance is MANUAL_DELIVERABLES;
   *  - no Issue Package membership references the Output.
   *
   * Any failed invariant rejects. A forbidden discard never silently succeeds.
   */
  public discardUnprovenOutputReservation(input: {
    outputId: string;
    projectId: string;
    revisionId: string;
  }): { outputId: string; projectId: string; revisionId: string; locatorValue: string | null } {
    this.assertCanonicalAggregateWritesActive();
    const outputId = normalizeUuid(input.outputId, 'Canonical Output reservation discard');
    const projectId = normalizeUuid(input.projectId, 'Canonical Output reservation Project');
    const revisionId = normalizeUuid(input.revisionId, 'Canonical Output reservation Revision');
    return this.transaction(() => {
      const output = this.getOutput(outputId);
      if (output.provenanceClassification !== 'CANONICAL') {
        throw conflict('Only a canonical Output reservation can be discarded.');
      }
      if (output.lifecycleState !== 'PREPARING' && output.lifecycleState !== 'FAILED_RECOVERABLE') {
        throw conflict(
          'Only an unproven canonical Output reservation can be discarded. A finalized Output is immutable.',
        );
      }
      if (output.projectId !== projectId || output.revisionId !== revisionId) {
        throw validationError(
          'The canonical Output reservation does not belong to this Project and Revision.',
        );
      }
      const revision = this.getRevision(revisionId);
      if (revision.provenanceClassification !== 'CANONICAL') {
        throw conflict('Only a canonical Revision can discard an Output reservation.');
      }
      if (revision.projectId !== projectId) {
        throw validationError('The canonical Revision does not belong to this Project.');
      }
      if (revision.lifecycleState !== 'PREPARING') {
        throw conflict(
          'An Output reservation can be discarded only while its Revision is PREPARING.',
        );
      }
      if (revision.projectSnapshot?.canonicalOperation !== 'MANUAL_DELIVERABLES') {
        throw conflict(
          'Only a composed manual Deliverables Revision can discard an Output reservation. Generated Revisions keep their explicit identity-preserving retry.',
        );
      }
      const membership = this.database
        .prepare(
          `SELECT COUNT(*) AS total FROM revision_package_deliverables
           WHERE source_type = 'GeneratedOutput' AND source_id = ?`,
        )
        .get(outputId) as { total: number };
      if (Number(membership.total) > 0) {
        throw conflict('An Output referenced by an Issue Package cannot be discarded.');
      }
      const result = this.database
        .prepare(
          `DELETE FROM canonical_outputs
           WHERE output_id = ? AND project_id = ? AND revision_id = ?
             AND provenance_classification = 'CANONICAL'
             AND lifecycle_state IN ('PREPARING', 'FAILED_RECOVERABLE')`,
        )
        .run(outputId, projectId, revisionId);
      if (result.changes !== 1) {
        throw conflict('The canonical Output reservation changed concurrently.');
      }
      return { outputId, projectId, revisionId, locatorValue: output.locatorValue };
    });
  }

  public createIssuePackage(input: CreateCanonicalIssuePackageInput): CanonicalIssuePackageRecord {
    this.assertCanonicalAggregateWritesActive();
    const parsed = createCanonicalIssuePackageSchema.parse(input);
    const revision = this.getRevision(parsed.revisionId);
    if (revision.provenanceClassification !== 'CANONICAL') {
      throw validationError('New Issue Packages require a canonical source Revision.');
    }
    if (revision.lifecycleState !== 'FINALIZED') {
      throw conflict('New Issue Packages require a FINALIZED source Revision.');
    }
    const artifactLocator = parsed.artifactRelativePath
      ? normalizeCanonicalProjectRelativePath(parsed.artifactRelativePath)
      : null;
    const manifestLocator = parsed.manifestRelativePath
      ? normalizeCanonicalProjectRelativePath(parsed.manifestRelativePath)
      : null;
    return this.transaction(() => {
      const latest = this.database
        .prepare(
          `SELECT MAX(package_sequence) AS latest
           FROM canonical_issue_packages WHERE revision_id = ?`,
        )
        .get(revision.revisionId) as { latest?: number | null } | undefined;
      const packageSequence = Number(latest?.latest ?? 0) + 1;
      if (!Number.isSafeInteger(packageSequence) || packageSequence < 1) {
        throw conflict('Issue Package sequence authority is outside its safe range.');
      }
      const packageId = parsed.packageId
        ? normalizeUuid(parsed.packageId, 'Canonical Issue Package identity')
        : randomUUID();
      const now = this.clock.now().toISOString();
      this.database
        .prepare(
          `INSERT INTO canonical_issue_packages
           (package_id, project_id, revision_id, package_sequence, label,
            artifact_locator_kind, artifact_locator_value, legacy_absolute_path,
            manifest_locator_kind, manifest_locator_value, lifecycle_state,
            provenance_classification, legacy_source_id, failure_reason,
            issued_by_id, issued_by_name, issued_at,
            created_at, finalized_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'PROJECT_RELATIVE', ?, NULL, ?, ?, 'PREPARING',
                   'CANONICAL', NULL, NULL, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          packageId,
          revision.projectId,
          revision.revisionId,
          packageSequence,
          parsed.label,
          artifactLocator,
          manifestLocator ? 'PROJECT_RELATIVE' : null,
          manifestLocator,
          parsed.issuedBy?.actorId ?? null,
          parsed.issuedBy?.actorNameSnapshot ?? null,
          parsed.issuedAt,
          now,
          now,
        );
      return this.getIssuePackage(packageId);
    });
  }

  public getIssuePackage(packageId: string): CanonicalIssuePackageRecord {
    const normalizedPackageId = normalizeUuid(packageId, 'Canonical Issue Package lookup');
    const row = this.database
      .prepare('SELECT * FROM canonical_issue_packages WHERE package_id = ?')
      .get(normalizedPackageId) as Row | undefined;
    if (!row) throw notFound('Canonical Issue Package not found.');
    return packageFromRow(row);
  }

  public listIssuePackages(projectId?: string): CanonicalIssuePackageRecord[] {
    const rows = projectId
      ? (this.database
          .prepare(
            `SELECT * FROM canonical_issue_packages
             WHERE project_id = ? ORDER BY created_at, package_id`,
          )
          .all(normalizeUuid(projectId, 'Canonical Issue Package Project lookup')) as Row[])
      : (this.database
          .prepare(
            `SELECT * FROM canonical_issue_packages
             ORDER BY project_id, created_at, package_id`,
          )
          .all() as Row[]);
    return rows.map(packageFromRow);
  }

  public addOutputToPackage(
    packageId: string,
    outputId: string,
    position?: number,
  ): CanonicalPackageOutputRecord {
    this.assertCanonicalAggregateWritesActive();
    const normalizedPackageId = normalizeUuid(packageId, 'Canonical Issue Package relation');
    const normalizedOutputId = normalizeUuid(outputId, 'Canonical Output relation');
    const issuePackage = this.getIssuePackage(normalizedPackageId);
    const output = this.getOutput(normalizedOutputId);
    if (
      issuePackage.provenanceClassification !== 'CANONICAL' ||
      output.provenanceClassification !== 'CANONICAL'
    ) {
      throw validationError('New canonical Package relations require canonical parent records.');
    }
    if (issuePackage.lifecycleState !== 'PREPARING') {
      throw conflict('Deliverables can be added only while an Issue Package is PREPARING.');
    }
    if (output.lifecycleState !== 'FINALIZED' || !output.contentHash) {
      throw validationError('Issue Packages may contain only finalized, hashed Outputs.');
    }
    if (!issuePackage.revisionId || !output.revisionId) {
      throw validationError('Canonical Package relations require verified Revision UUIDs.');
    }
    if (
      issuePackage.revisionId !== output.revisionId ||
      issuePackage.projectId !== output.projectId
    ) {
      throw validationError('An Issue Package cannot contain Outputs from another Revision.');
    }
    const resolvedPosition =
      position ??
      requiredNumber(
        (
          this.database
            .prepare(
              'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM revision_package_deliverables WHERE package_id = ?',
            )
            .get(normalizedPackageId) as Row
        ).next_position,
        'Package Deliverable position',
      );
    if (!Number.isInteger(resolvedPosition) || resolvedPosition < 0) {
      throw validationError('Package Deliverable position must be a non-negative integer.');
    }
    const now = this.clock.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO revision_package_deliverables
         (package_id, source_type, source_id, revision_id, position, provenance_classification, created_at)
         VALUES (?, 'GeneratedOutput', ?, ?, ?, 'CANONICAL', ?)`,
      )
      .run(normalizedPackageId, normalizedOutputId, issuePackage.revisionId, resolvedPosition, now);
    return {
      packageId: normalizedPackageId,
      outputId: normalizedOutputId,
      revisionId: issuePackage.revisionId,
      position: resolvedPosition,
      provenanceClassification: 'CANONICAL',
      createdAt: now,
    };
  }

  /** Adds a Package's complete ordered Output relation set in one short DB transaction. */
  public addOutputsToPackage(
    packageId: string,
    outputIds: readonly string[],
  ): CanonicalPackageOutputRecord[] {
    this.assertCanonicalAggregateWritesActive();
    if (outputIds.length === 0) {
      throw validationError('A canonical Issue Package requires at least one Output.');
    }
    return this.transaction(() =>
      outputIds.map((outputId, position) => this.addOutputToPackage(packageId, outputId, position)),
    );
  }

  /**
   * B2 — generic immutable package deliverable membership.
   *
   * Adds one member of exactly one supported immutable source type to a
   * PREPARING canonical package. The member must exist, belong to the same
   * Project, and belong to the package's exact canonical Revision. Mutable
   * ProjectDocuments are never members: DocumentSnapshot members must reference
   * an existing immutable snapshot row. Duplicate (source_type, source_id)
   * members and position collisions are rejected by table constraints.
   */
  public addPackageDeliverable(
    packageId: string,
    sourceType: 'GeneratedOutput' | 'DocumentSnapshot',
    sourceId: string,
    position?: number,
  ): RevisionPackageDeliverableRecord {
    this.assertCanonicalAggregateWritesActive();
    const normalizedPackageId = normalizeUuid(packageId, 'Canonical Issue Package relation');
    const normalizedSourceId = normalizeUuid(sourceId, 'Package Deliverable source');
    const issuePackage = this.getIssuePackage(normalizedPackageId);
    if (issuePackage.provenanceClassification !== 'CANONICAL') {
      throw validationError('New canonical Package relations require a canonical parent record.');
    }
    if (issuePackage.lifecycleState !== 'PREPARING') {
      throw conflict('Deliverables can be added only while an Issue Package is PREPARING.');
    }
    if (!issuePackage.revisionId) {
      throw validationError('Canonical Package relations require a verified Revision UUID.');
    }
    const revisionId = issuePackage.revisionId;
    if (sourceType === 'GeneratedOutput') {
      const output = this.getOutput(normalizedSourceId);
      if (output.projectId !== issuePackage.projectId || output.revisionId !== revisionId) {
        throw validationError('An Issue Package cannot contain Outputs from another Revision.');
      }
      if (output.lifecycleState !== 'FINALIZED' || !output.contentHash) {
        throw validationError('Issue Packages may contain only finalized, hashed Outputs.');
      }
    } else {
      const snapshot = this.getDocumentSnapshot(normalizedSourceId);
      if (snapshot.projectId !== issuePackage.projectId || snapshot.revisionId !== revisionId) {
        throw validationError(
          'An Issue Package cannot contain Document Snapshots from another Revision.',
        );
      }
    }
    const resolvedPosition =
      position ??
      requiredNumber(
        (
          this.database
            .prepare(
              'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM revision_package_deliverables WHERE package_id = ?',
            )
            .get(normalizedPackageId) as Row
        ).next_position,
        'Package Deliverable position',
      );
    if (!Number.isInteger(resolvedPosition) || resolvedPosition < 0) {
      throw validationError('Package Deliverable position must be a non-negative integer.');
    }
    const now = this.clock.now().toISOString();
    this.database
      .prepare(
        `INSERT INTO revision_package_deliverables
         (package_id, source_type, source_id, revision_id, position, provenance_classification, created_at)
         VALUES (?, ?, ?, ?, ?, 'CANONICAL', ?)`,
      )
      .run(normalizedPackageId, sourceType, normalizedSourceId, revisionId, resolvedPosition, now);
    return {
      packageId: normalizedPackageId,
      sourceType,
      sourceId: normalizedSourceId,
      revisionId,
      position: resolvedPosition,
      provenanceClassification: 'CANONICAL',
      createdAt: now,
    };
  }

  /** Adds a Package's complete ordered generic Deliverable set in one short DB transaction. */
  public addPackageDeliverables(
    packageId: string,
    members: Array<{
      sourceType: 'GeneratedOutput' | 'DocumentSnapshot';
      sourceId: string;
    }>,
  ): RevisionPackageDeliverableRecord[] {
    this.assertCanonicalAggregateWritesActive();
    if (members.length === 0) {
      throw validationError('A canonical Issue Package requires at least one Deliverable.');
    }
    return this.transaction(() =>
      members.map((member, position) =>
        this.addPackageDeliverable(packageId, member.sourceType, member.sourceId, position),
      ),
    );
  }

  /**
   * B2 — canonical Output membership read over the single generic authority.
   *
   * Only GeneratedOutput members are projected (legacy relations in
   * canonical_package_outputs are not canonical authority). Migrated historical
   * packages keep their rows in the generic table after v14.
   */
  public listPackageOutputs(packageId: string): CanonicalPackageOutputRecord[] {
    const normalizedPackageId = normalizeUuid(packageId, 'Canonical Issue Package lookup');
    return (
      this.database
        .prepare(
          `SELECT * FROM revision_package_deliverables
           WHERE package_id = ? AND source_type = 'GeneratedOutput'
           ORDER BY position, source_id`,
        )
        .all(normalizedPackageId) as Row[]
    ).map((row) => ({
      packageId: requiredText(row.package_id, 'Package ID'),
      outputId: requiredText(row.source_id, 'Output ID'),
      revisionId: requiredText(row.revision_id, 'Revision ID'),
      position: requiredNumber(row.position, 'Package Output position'),
      provenanceClassification: provenance(row.provenance_classification),
      createdAt: requiredText(row.created_at, 'Package Output created timestamp'),
    }));
  }

  /** B2 — full generic membership read over the single generic authority. */
  public listPackageDeliverables(packageId: string): RevisionPackageDeliverableRecord[] {
    const normalizedPackageId = normalizeUuid(packageId, 'Canonical Issue Package lookup');
    return (
      this.database
        .prepare(
          `SELECT * FROM revision_package_deliverables
           WHERE package_id = ? ORDER BY position, source_type, source_id`,
        )
        .all(normalizedPackageId) as Row[]
    ).map((row) => {
      const sourceType = requiredText(row.source_type, 'Package Deliverable source type');
      if (sourceType !== 'GeneratedOutput' && sourceType !== 'DocumentSnapshot') {
        throw conflict('Persisted Package Deliverable source type is invalid.');
      }
      return {
        packageId: requiredText(row.package_id, 'Package ID'),
        sourceType,
        sourceId: requiredText(row.source_id, 'Package Deliverable source ID'),
        revisionId: requiredText(row.revision_id, 'Package Deliverable Revision ID'),
        position: requiredNumber(row.position, 'Package Deliverable position'),
        provenanceClassification: provenance(row.provenance_classification),
        createdAt: requiredText(row.created_at, 'Package Deliverable created timestamp'),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // B0 — immutable Revision Document Snapshot deliverable persistence
  // ---------------------------------------------------------------------------

  public createDocumentSnapshot(input: {
    projectId: string;
    revisionId: string;
    category: string;
    title: string;
    fileName: string;
    sourceRelativePath: string;
    locatorValue: string;
    contentHash: string;
    sizeBytes: number;
    createdBy: { actorId: string; actorNameSnapshot: string } | null;
    /** AUTO-01A (AUTO-D02): optional immutable ArtifactVersion UUID provenance. */
    sourceArtifactVersionId?: string | null;
    /** ProjectDocument-sourced snapshot (one source authority required). */
    sourceDocumentId?: string | null;
    /** LuminaireAssetVersion-sourced snapshot (one source authority required). */
    sourceAssetVersionId?: string | null;
  }): RevisionDocumentSnapshotRecord {
    this.assertCanonicalAggregateWritesActive();
    const projectId = normalizeUuid(input.projectId, 'Snapshot Project');
    const revisionId = normalizeUuid(input.revisionId, 'Snapshot Revision');
    const sourceDocumentIdRaw = nullableText(input.sourceDocumentId ?? null);
    const sourceAssetVersionIdRaw = nullableText(input.sourceAssetVersionId ?? null);
    if ((sourceDocumentIdRaw === null) === (sourceAssetVersionIdRaw === null)) {
      throw validationError(
        'A Document Snapshot must have exactly one source authority: a Project Document or a Luminaire Asset Version.',
      );
    }
    let sourceDocumentId: string | null = null;
    let sourceAssetVersionId: string | null = null;
    if (sourceDocumentIdRaw !== null) {
      sourceDocumentId = normalizeUuid(sourceDocumentIdRaw, 'Snapshot source document');
    } else {
      sourceAssetVersionId = normalizeUuid(
        sourceAssetVersionIdRaw!,
        'Snapshot source asset version',
      );
      // Same-project provenance (PACKAGES-E2E-05F): the referenced
      // LuminaireAssetVersion must belong to the SAME project as the snapshot.
      // Luminaire identity is derived structurally (source_asset_version_id ->
      // luminaire_asset_versions.luminaire_id -> project_luminaires.id).
      const assetProject = this.database
        .prepare(
          `SELECT pl.project_id AS project_id
           FROM luminaire_asset_versions lav
           INNER JOIN project_luminaires pl ON pl.id = lav.luminaire_id
           WHERE lav.id = ?`,
        )
        .get(sourceAssetVersionId) as { project_id?: unknown } | undefined;
      if (!assetProject) {
        throw validationError(
          'The source Luminaire Asset Version does not exist or has no Luminaire lineage.',
        );
      }
      if (assetProject.project_id !== projectId) {
        throw validationError(
          'A Document Snapshot may only reference a Luminaire Asset Version in the same project.',
        );
      }
    }
    if (input.sourceArtifactVersionId) {
      const sourceArtifactVersionId = normalizeUuid(
        input.sourceArtifactVersionId,
        'Snapshot source artifact version',
      );
      // Same-project provenance (AUTO-D02): the referenced ArtifactVersion must
      // belong to the SAME project as the snapshot. Resolve the lineage
      // ArtifactVersion -> ManagedArtifact -> projectId and require a match.
      const versionProject = this.database
        .prepare(
          `SELECT ma.project_id AS project_id
           FROM artifact_versions av
           INNER JOIN managed_artifacts ma ON ma.artifact_id = av.artifact_id
           WHERE av.version_id = ?`,
        )
        .get(sourceArtifactVersionId) as { project_id?: unknown } | undefined;
      if (!versionProject) {
        throw validationError(
          'The source Artifact Version does not exist or has no managed artifact lineage.',
        );
      }
      if (versionProject.project_id !== projectId) {
        throw validationError(
          'A Document Snapshot may only reference an Artifact Version in the same project.',
        );
      }
    }
    const revision = this.getRevision(revisionId);
    if (revision.projectId !== projectId || revision.provenanceClassification !== 'CANONICAL') {
      throw validationError(
        'A Document Snapshot requires a canonical source Revision in this Project.',
      );
    }
    if (revision.lifecycleState !== 'PREPARING') {
      throw conflict('A Document Snapshot can be added only while its Revision is PREPARING.');
    }
    if (!/^[0-9a-f]{64}$/.test(input.contentHash.toLowerCase())) {
      throw validationError(
        'A Document Snapshot content hash must be a 64-char SHA-256 hex digest.',
      );
    }
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
      throw validationError('A Document Snapshot size must be a non-negative safe integer.');
    }
    const relativePath = normalizeCanonicalProjectRelativePath(input.locatorValue);
    const now = this.clock.now().toISOString();
    const deliverableId = normalizeUuid(
      this.identities.documentSnapshotId(),
      'Document Snapshot identity',
    );
    return this.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO revision_document_snapshots
           (deliverable_id, project_id, revision_id, source_document_id, source_asset_version_id,
            category, title, file_name, source_relative_path, locator_kind, locator_value,
            content_hash, size_bytes, created_by_id, created_by_name, created_at,
            source_artifact_version_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROJECT_RELATIVE', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          deliverableId,
          projectId,
          revisionId,
          sourceDocumentId,
          sourceAssetVersionId,
          input.category,
          input.title,
          input.fileName,
          input.sourceRelativePath,
          relativePath,
          input.contentHash.toLowerCase(),
          input.sizeBytes,
          input.createdBy?.actorId ?? null,
          input.createdBy?.actorNameSnapshot ?? null,
          now,
          input.sourceArtifactVersionId ?? null,
        );
      return this.getDocumentSnapshot(deliverableId);
    });
  }

  public getDocumentSnapshot(deliverableId: string): RevisionDocumentSnapshotRecord {
    const normalized = normalizeUuid(deliverableId, 'Document Snapshot lookup');
    const row = this.database
      .prepare('SELECT * FROM revision_document_snapshots WHERE deliverable_id = ?')
      .get(normalized) as Row | undefined;
    if (!row) throw notFound('Document Snapshot not found.');
    return documentSnapshotFromRow(row);
  }

  public listDocumentSnapshotsForRevision(revisionId: string): RevisionDocumentSnapshotRecord[] {
    const normalized = normalizeUuid(revisionId, 'Document Snapshot Revision lookup');
    return (
      this.database
        .prepare(
          `SELECT * FROM revision_document_snapshots
           WHERE revision_id = ? ORDER BY created_at, deliverable_id`,
        )
        .all(normalized) as Row[]
    ).map(documentSnapshotFromRow);
  }

  public listDocumentSnapshots(projectId?: string): RevisionDocumentSnapshotRecord[] {
    const rows = projectId
      ? (this.database
          .prepare(
            `SELECT * FROM revision_document_snapshots
             WHERE project_id = ? ORDER BY created_at, deliverable_id`,
          )
          .all(normalizeUuid(projectId, 'Document Snapshot Project lookup')) as Row[])
      : (this.database
          .prepare('SELECT * FROM revision_document_snapshots ORDER BY created_at, deliverable_id')
          .all() as Row[]);
    return rows.map(documentSnapshotFromRow);
  }

  public removeDocumentSnapshotScoped(
    projectId: string,
    revisionId: string,
    deliverableId: string,
  ): {
    locatorValue: string;
    projectId: string;
    revisionId: string;
  } {
    this.assertCanonicalAggregateWritesActive();
    const normalizedProjectId = normalizeUuid(projectId, 'Document Snapshot removal Project');
    const normalizedRevisionId = normalizeUuid(revisionId, 'Document Snapshot removal Revision');
    const normalizedDeliverableId = normalizeUuid(deliverableId, 'Document Snapshot removal');
    return this.transaction(() => {
      const snapshot = this.getDocumentSnapshot(normalizedDeliverableId);
      if (
        snapshot.projectId !== normalizedProjectId ||
        snapshot.revisionId !== normalizedRevisionId
      ) {
        throw validationError(
          'The Document Snapshot does not belong to this Project and Revision.',
        );
      }
      const revision = this.getRevision(normalizedRevisionId);
      if (revision.projectId !== normalizedProjectId) {
        throw validationError('The Revision does not belong to this Project.');
      }
      if (revision.lifecycleState !== 'PREPARING') {
        throw conflict('A Document Snapshot can be removed only while its Revision is PREPARING.');
      }
      const result = this.database
        .prepare(
          `DELETE FROM revision_document_snapshots
           WHERE deliverable_id = ? AND project_id = ? AND revision_id = ?
             AND EXISTS (
               SELECT 1 FROM canonical_revisions
               WHERE revision_id = ? AND project_id = ? AND lifecycle_state = 'PREPARING'
             )`,
        )
        .run(
          normalizedDeliverableId,
          normalizedProjectId,
          normalizedRevisionId,
          normalizedRevisionId,
          normalizedProjectId,
        );
      if (result.changes !== 1) {
        throw conflict('The Document Snapshot removal scope changed concurrently.');
      }
      return {
        locatorValue: snapshot.locatorValue,
        projectId: snapshot.projectId,
        revisionId: snapshot.revisionId,
      };
    });
  }

  public setRevisionLifecycle(
    revisionId: string,
    state: Exclude<OutputRegistryLifecycleState, 'LEGACY_IMPORTED'>,
    failureReason: string | null = null,
  ): CanonicalRevisionRecord {
    this.assertCanonicalAggregateWritesActive();
    const normalizedRevisionId = normalizeUuid(revisionId, 'Canonical Revision update');
    this.updateLifecycle(
      'canonical_revisions',
      'revision_id',
      normalizedRevisionId,
      state,
      failureReason,
    );
    return this.getRevision(normalizedRevisionId);
  }

  /**
   * Commits one synchronous compatibility projection and canonical Revision finalization on the
   * shared SQLite handle. Filesystem artifacts are already finalized before entering this boundary.
   */
  public finalizeRevisionWithCompatibilityProjection<T>(
    revisionId: string,
    projectCompatibility: () => T,
  ): { revision: CanonicalRevisionRecord; projection: T } {
    this.assertCanonicalAggregateWritesActive();
    return this.transaction(() => {
      const projection = projectCompatibility();
      const revision = this.setRevisionLifecycle(revisionId, 'FINALIZED');
      return { revision, projection };
    });
  }

  /**
   * REV-01B — atomic Revision finalization boundary with the ManagedArtifact
   * freeze. The lifecycle flip and the freeze of every artifact referenced by
   * the Revision's immutable Document Snapshots commit together on the shared
   * handle: a throwing freeze rolls the WHOLE boundary back (the Revision
   * stays PREPARING), so a FINALIZED Revision is never observable with a
   * still-ACTIVE referenced artifact. The freeze side effect is supplied by
   * the caller (the service that owns the ManagedArtifactStore); this
   * registry stays artifact-agnostic — same shape as the compatibility
   * projection boundary above. `at` is the persisted finalization timestamp
   * (registry clock), so the freeze stamp equals the finalization stamp.
   */
  public finalizeRevisionWithArtifactFreeze(
    revisionId: string,
    freeze: (revisionId: string, at: string) => void,
  ): CanonicalRevisionRecord {
    this.assertCanonicalAggregateWritesActive();
    return this.transaction(() => {
      this.setRevisionLifecycle(revisionId, 'FINALIZED');
      const at = this.getRevision(revisionId).finalizedAt ?? this.clock.now().toISOString();
      freeze(revisionId, at);
      return this.getRevision(revisionId);
    });
  }

  public setOutputLifecycle(
    outputId: string,
    state: Exclude<OutputRegistryLifecycleState, 'LEGACY_IMPORTED'>,
    failureReason: string | null = null,
  ): CanonicalOutputRecord {
    this.assertCanonicalAggregateWritesActive();
    const normalizedOutputId = normalizeUuid(outputId, 'Canonical Output update');
    this.updateLifecycle(
      'canonical_outputs',
      'output_id',
      normalizedOutputId,
      state,
      failureReason,
    );
    return this.getOutput(normalizedOutputId);
  }

  public setPackageLifecycle(
    packageId: string,
    state: Exclude<OutputRegistryLifecycleState, 'LEGACY_IMPORTED'>,
    failureReason: string | null = null,
  ): CanonicalIssuePackageRecord {
    this.assertCanonicalAggregateWritesActive();
    const normalizedPackageId = normalizeUuid(packageId, 'Canonical Issue Package update');
    this.updateLifecycle(
      'canonical_issue_packages',
      'package_id',
      normalizedPackageId,
      state,
      failureReason,
    );
    return this.getIssuePackage(normalizedPackageId);
  }

  private updateLifecycle(
    table: 'canonical_revisions' | 'canonical_outputs' | 'canonical_issue_packages',
    idColumn: 'revision_id' | 'output_id' | 'package_id',
    id: string,
    state: Exclude<OutputRegistryLifecycleState, 'LEGACY_IMPORTED'>,
    failureReason: string | null,
  ): void {
    if (state !== 'PREPARING' && state !== 'FINALIZED' && state !== 'FAILED_RECOVERABLE') {
      throw validationError('Unknown canonical registry lifecycle state.');
    }
    if (state === 'FAILED_RECOVERABLE' && !failureReason?.trim()) {
      throw validationError('Recoverable failure state requires a bounded failure reason.');
    }
    if (failureReason && failureReason.length > 2_000) {
      throw validationError('Failure reason is too long.');
    }
    const current = this.database
      .prepare(
        `SELECT * FROM ${table}
         WHERE ${idColumn} = ? AND provenance_classification = 'CANONICAL'`,
      )
      .get(id) as Row | undefined;
    if (!current) throw notFound('Canonical registry entity not found.');
    const currentState = lifecycle(current.lifecycle_state);
    if (currentState === state) {
      if (
        state !== 'FAILED_RECOVERABLE' ||
        nullableText(current.failure_reason) === failureReason?.trim()
      ) {
        return;
      }
    }
    const allowed =
      (currentState === 'PREPARING' && (state === 'FINALIZED' || state === 'FAILED_RECOVERABLE')) ||
      (currentState === 'FAILED_RECOVERABLE' && state === 'PREPARING');
    if (!allowed) {
      throw conflict(`Canonical lifecycle cannot transition from ${currentState} to ${state}.`);
    }

    if (state === 'FINALIZED' && table === 'canonical_outputs' && current.content_hash === null) {
      throw conflict('A canonical Output cannot finalize before its content hash is persisted.');
    }
    if (state === 'FINALIZED' && table === 'canonical_revisions') {
      const counts = this.database
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN lifecycle_state = 'FINALIZED' THEN 0 ELSE 1 END) AS incomplete
           FROM canonical_outputs WHERE revision_id = ? AND provenance_classification = 'CANONICAL'`,
        )
        .get(id) as { total: number; incomplete: number | null };
      const snapshot = parseJson(
        current.project_snapshot_json,
        canonicalProjectSnapshotSchema,
        'Revision project snapshot',
      ) as Record<string, unknown>;
      const registerOnly = snapshot.canonicalOperation === 'REGISTER_ONLY';
      if (registerOnly) {
        // Historical/legacy register-only revisions remain valid with zero deliverables.
      } else if (snapshot.canonicalOperation === 'MANUAL_DELIVERABLES') {
        // B0 manual workflow: require at least one immutable Deliverable — a
        // finalized canonical Output OR an immutable Document Snapshot.
        const snapshotCount = this.database
          .prepare(
            `SELECT COUNT(*) AS total FROM revision_document_snapshots
             WHERE revision_id = ? AND project_id = ?`,
          )
          .get(id, nullableText(current.project_id)) as { total: number };
        if (Number(counts.total) === 0 && Number(snapshotCount.total) === 0) {
          throw conflict(
            'A canonical Revision cannot finalize with zero Deliverables. Add a generated Output or an immutable Document Snapshot first.',
          );
        }
        if (Number(counts.incomplete ?? 0) > 0) {
          throw conflict(
            'A canonical Revision cannot finalize before every expected Output finalizes.',
          );
        }
      } else if (Number(counts.total) === 0 || Number(counts.incomplete ?? 0) > 0) {
        throw conflict(
          'A canonical Revision cannot finalize before every expected Output finalizes.',
        );
      }
    }
    if (state === 'FINALIZED' && table === 'canonical_issue_packages') {
      // B2 — a canonical package finalizes with >= 1 generic Deliverable and
      // every GeneratedOutput member finalized. DocumentSnapshot members carry
      // their own immutable proof and have no lifecycle.
      const memberCount = this.database
        .prepare(
          `SELECT COUNT(*) AS total FROM revision_package_deliverables
           WHERE package_id = ? AND provenance_classification = 'CANONICAL'`,
        )
        .get(id) as { total: number };
      if (Number(memberCount.total) === 0) {
        throw conflict('A canonical Issue Package cannot finalize without Deliverables.');
      }
      const outputCounts = this.database
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN o.lifecycle_state = 'FINALIZED' AND o.content_hash IS NOT NULL
                           THEN 0 ELSE 1 END) AS incomplete
           FROM revision_package_deliverables rpd
           INNER JOIN canonical_outputs o ON o.output_id = rpd.source_id
           WHERE rpd.package_id = ? AND rpd.source_type = 'GeneratedOutput'
             AND rpd.provenance_classification = 'CANONICAL'`,
        )
        .get(id) as { total: number; incomplete: number | null };
      if (Number(outputCounts.total) > 0 && Number(outputCounts.incomplete ?? 0) > 0) {
        throw conflict(
          'A canonical Issue Package cannot finalize with an unfinalized Output Deliverable.',
        );
      }
    }
    const now = this.clock.now().toISOString();
    const finalizedAt = state === 'FINALIZED' ? now : null;
    const result = this.database
      .prepare(
        `UPDATE ${table}
         SET lifecycle_state = ?, failure_reason = ?, finalized_at = ?, updated_at = ?
         WHERE ${idColumn} = ? AND provenance_classification = 'CANONICAL'
           AND lifecycle_state = ?`,
      )
      .run(
        state,
        state === 'FAILED_RECOVERABLE' ? failureReason!.trim() : null,
        finalizedAt,
        now,
        id,
        currentState,
      );
    if (result.changes !== 1) throw conflict('Canonical registry lifecycle changed concurrently.');
  }

  // ---------------------------------------------------------------------------
  // P2C-03 — Safe Revision Delete aggregate
  // ---------------------------------------------------------------------------

  /** Exposes the shared SQLite handle so the delete authority can run the archive-first, then DB-commit sequence atomically. */
  public getSharedDatabase(): DatabaseSync {
    return this.database;
  }

  public listRevisionDeleteOperations(projectId?: string): RevisionDeleteOperationRecord[] {
    const rows = projectId
      ? (this.database
          .prepare(
            `SELECT * FROM revision_delete_operations
             WHERE project_id = ? ORDER BY created_at, operation_id`,
          )
          .all(normalizeUuid(projectId, 'Revision Delete Operation Project lookup')) as Row[])
      : (this.database
          .prepare('SELECT * FROM revision_delete_operations ORDER BY created_at, operation_id')
          .all() as Row[]);
    return rows.map(revisionDeleteOperationFromRow);
  }

  public getRevisionDeleteOperation(operationId: string): RevisionDeleteOperationRecord {
    const normalized = normalizeUuid(operationId, 'Revision Delete Operation lookup');
    const row = this.database
      .prepare('SELECT * FROM revision_delete_operations WHERE operation_id = ?')
      .get(normalized) as Row | undefined;
    if (!row) throw notFound('Revision Delete Operation not found.');
    return revisionDeleteOperationFromRow(row);
  }

  public getRevisionDeleteOperationByRevision(
    revisionId: string,
  ): RevisionDeleteOperationRecord | null {
    const normalized = normalizeUuid(revisionId, 'Revision Delete Operation Revision lookup');
    const row = this.database
      .prepare('SELECT * FROM revision_delete_operations WHERE revision_id = ?')
      .get(normalized) as Row | undefined;
    if (!row) return null;
    return revisionDeleteOperationFromRow(row);
  }

  /** Exact aggregate lookup used by read and mutation recovery authority. */
  public getRevisionDeleteOperationByProjectRevision(
    projectId: string,
    revisionId: string,
  ): RevisionDeleteOperationRecord | null {
    const normalizedProjectId = normalizeUuid(
      projectId,
      'Revision Delete Operation Project lookup',
    );
    const normalizedRevisionId = normalizeUuid(
      revisionId,
      'Revision Delete Operation Revision lookup',
    );
    const row = this.database
      .prepare(
        `SELECT * FROM revision_delete_operations
         WHERE project_id = ? AND revision_id = ?`,
      )
      .get(normalizedProjectId, normalizedRevisionId) as Row | undefined;
    if (!row) return null;
    return revisionDeleteOperationFromRow(row);
  }

  /**
   * P2C-04 eligibility authority. Returns only the single unused COMPLETED
   * tombstone at the current project high-water boundary, after fail-closed
   * compatibility and exact-UUID history checks.
   */
  public findReusableRevisionCandidate(projectId: string): RevisionReuseCandidate | null {
    return this.resolveReusableRevisionCandidate(projectId, null);
  }

  /**
   * Atomically creates a fresh canonical Revision at the claimed presentation
   * sequence, records immutable reuse provenance, and appends activity through
   * the supplied shared-connection writer. Every authority check is repeated
   * after BEGIN IMMEDIATE; any thrown write rolls the entire claim back.
   */
  public reuseRevisionNumber(
    input: CreateCanonicalRevisionInput,
    deleteOperationId: string,
    reason: string,
    reusedAt: string,
    activityWriter: (revision: CanonicalRevisionRecord) => void,
  ): CanonicalRevisionRecord {
    this.assertCanonicalAggregateWritesActive();
    const normalizedReason = reason.trim();
    if (!normalizedReason || normalizedReason.length > 500) {
      throw validationError('Revision reuse reason must contain 1 to 500 characters.');
    }
    return this.transaction(() => {
      const candidate = this.resolveReusableRevisionCandidate(input.projectId, deleteOperationId);
      if (!candidate) {
        throw conflict('The deleted Revision number is no longer reusable.');
      }
      const revision = this.insertCanonicalRevisionAtSequence(input, candidate.revisionSequence);
      const result = this.database
        .prepare(
          `UPDATE revision_delete_operations
           SET reused_by_revision_id = ?, reused_at = ?, reused_by_actor_id = ?,
               reused_by_actor_name = ?, reuse_reason = ?, updated_at = ?
           WHERE operation_id = ? AND project_id = ? AND state = 'COMPLETED'
             AND reused_by_revision_id IS NULL`,
        )
        .run(
          revision.revisionId,
          reusedAt,
          input.createdBy.actorId,
          input.createdBy.actorNameSnapshot,
          normalizedReason,
          reusedAt,
          candidate.deleteOperationId,
          input.projectId,
        );
      if (result.changes !== 1) {
        throw conflict('The Revision reuse operation was claimed concurrently.');
      }
      activityWriter(revision);
      return revision;
    });
  }

  private resolveReusableRevisionCandidate(
    projectId: string,
    requestedOperationId: string | null,
  ): RevisionReuseCandidate | null {
    const normalizedProjectId = normalizeUuid(projectId, 'Revision reuse Project lookup');
    const normalizedOperationId = requestedOperationId
      ? normalizeUuid(requestedOperationId, 'Revision reuse operation lookup')
      : null;
    const highWaterRow = this.database
      .prepare(
        `SELECT MAX(sequence_value) AS high_water FROM (
           SELECT revision_sequence AS sequence_value FROM canonical_revisions WHERE project_id = ?
           UNION ALL SELECT revision_number FROM project_revisions WHERE project_id = ?
           UNION ALL SELECT revision FROM project_exports WHERE project_id = ?
           UNION ALL SELECT revision_number FROM revision_packages WHERE project_id = ?
           UNION ALL SELECT revision_sequence FROM revision_delete_operations WHERE project_id = ?
         )`,
      )
      .get(
        normalizedProjectId,
        normalizedProjectId,
        normalizedProjectId,
        normalizedProjectId,
        normalizedProjectId,
      ) as { high_water?: number | null } | undefined;
    const highWater = Number(highWaterRow?.high_water ?? 0);
    if (!Number.isSafeInteger(highWater) || highWater < 1) return null;

    const rows = this.database
      .prepare(
        `SELECT * FROM revision_delete_operations
         WHERE project_id = ? AND revision_sequence = ? AND state = 'COMPLETED'
           AND reused_by_revision_id IS NULL
         ORDER BY completed_at DESC, created_at DESC, operation_id DESC`,
      )
      .all(normalizedProjectId, highWater) as Row[];
    // More than one unused operation at the same boundary is corrupt/ambiguous.
    if (rows.length !== 1) return null;
    const operation = revisionDeleteOperationFromRow(rows[0]!);
    if (normalizedOperationId && operation.operationId !== normalizedOperationId) return null;

    const expectedLabel = `REV_${String(operation.revisionSequence).padStart(2, '0')}`;
    const manifestCounts = {
      documentSnapshots: operation.artifactManifest.items.filter(
        (item) => item.sourceType === 'DocumentSnapshot',
      ).length,
      datasheetSnapshots: operation.artifactManifest.items.filter(
        (item) => item.sourceType === 'Datasheet',
      ).length,
      generatedOutputs: operation.artifactManifest.items.filter(
        (item) => item.sourceType === 'GeneratedOutput',
      ).length,
    };
    if (
      operation.revisionSequence !== highWater ||
      operation.revisionLabel !== expectedLabel ||
      operation.artifactManifest.revisionId !== operation.revisionId ||
      operation.dbCommittedAt === null ||
      operation.completedAt === null ||
      operation.failureReason !== null ||
      operation.actorId === null ||
      operation.actorNameSnapshot === null ||
      operation.documentSnapshotCount !== manifestCounts.documentSnapshots ||
      operation.datasheetSnapshotCount !== manifestCounts.datasheetSnapshots ||
      operation.generatedOutputCount !== manifestCounts.generatedOutputs
    ) {
      return null;
    }

    const sequenceBound = this.database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM canonical_revisions WHERE project_id = ? AND revision_sequence = ?) +
           (SELECT COUNT(*) FROM project_revisions WHERE project_id = ? AND revision_number = ?) +
           (SELECT COUNT(*) FROM project_exports WHERE project_id = ? AND revision = ?) +
           (SELECT COUNT(*) FROM revision_packages WHERE project_id = ? AND revision_number = ?)
           AS total`,
      )
      .get(
        normalizedProjectId,
        highWater,
        normalizedProjectId,
        highWater,
        normalizedProjectId,
        highWater,
        normalizedProjectId,
        highWater,
      ) as { total: number };
    if (Number(sequenceBound.total) !== 0) return null;

    const unresolved = this.database
      .prepare(
        `SELECT COUNT(*) AS total FROM revision_delete_operations
         WHERE project_id = ? AND state <> 'COMPLETED'`,
      )
      .get(normalizedProjectId) as { total: number };
    if (Number(unresolved.total) !== 0) return null;

    const exactHistory = this.database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM canonical_revisions WHERE revision_id = ?) +
           (SELECT COUNT(*) FROM canonical_outputs WHERE revision_id = ?) +
           (SELECT COUNT(*) FROM canonical_issue_packages WHERE revision_id = ?) +
           (SELECT COUNT(*) FROM canonical_package_outputs WHERE revision_id = ?) +
           (SELECT COUNT(*) FROM revision_document_snapshots WHERE revision_id = ?) +
           (SELECT COUNT(*) FROM revision_package_deliverables WHERE revision_id = ?)
           AS total`,
      )
      .get(
        operation.revisionId,
        operation.revisionId,
        operation.revisionId,
        operation.revisionId,
        operation.revisionId,
        operation.revisionId,
      ) as { total: number };
    if (Number(exactHistory.total) !== 0) return null;

    return {
      deleteOperationId: operation.operationId,
      revisionSequence: operation.revisionSequence,
      revisionLabel: operation.revisionLabel,
      deletedRevisionId: operation.revisionId,
      deletedAt: operation.completedAt,
    };
  }

  /**
   * Creates (or, when an operation already exists for the Revision, returns the
   * EXISTING one) the durable delete operation. One Revision UUID has at most
   * ONE durable delete operation; retry reuses the same operation id and
   * manifest. This method is transaction-neutral: the caller owns the open
   * transaction so the operation insert and the later DB commit are atomic.
   */
  public createOrReuseRevisionDeleteOperation(input: {
    operationId: string;
    projectId: string;
    revisionId: string;
    revisionSequence: number;
    revisionLabel: string;
    actorId: string | null;
    actorNameSnapshot: string | null;
    manifest: RevisionDeleteManifest;
    counts: RevisionDeleteCounts;
    createdAt: string;
  }): RevisionDeleteOperationRecord {
    this.assertCanonicalAggregateWritesActive();
    const existing = this.database
      .prepare('SELECT * FROM revision_delete_operations WHERE revision_id = ?')
      .get(input.revisionId) as Row | undefined;
    if (existing) {
      if (requiredText(existing.project_id, 'Operation Project ID') !== input.projectId) {
        throw conflict(
          'A Revision Delete Operation already exists for this Revision in another Project.',
        );
      }
      return revisionDeleteOperationFromRow(existing);
    }
    const operationId = input.operationId;
    const manifestJson = canonicalRegistryJson(input.manifest);
    this.database
      .prepare(
        `INSERT INTO revision_delete_operations
         (operation_id, project_id, revision_id, revision_sequence, revision_label,
          actor_id, actor_name_snapshot, state, failure_reason, artifact_manifest_json,
          document_snapshot_count, datasheet_snapshot_count, generated_output_count,
          created_at, archive_started_at, db_committed_at, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PLANNED', NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
      )
      .run(
        operationId,
        input.projectId,
        input.revisionId,
        input.revisionSequence,
        input.revisionLabel,
        input.actorId,
        input.actorNameSnapshot,
        manifestJson,
        input.counts.documentSnapshots,
        input.counts.datasheetSnapshots,
        input.counts.generatedOutputs,
        input.createdAt,
        input.createdAt,
      );
    return this.getRevisionDeleteOperation(operationId);
  }

  public setRevisionDeleteOperationState(
    operationId: string,
    state: RevisionDeleteState,
    fields: {
      failureReason?: string | null;
      archiveStartedAt?: string | null;
      dbCommittedAt?: string | null;
      completedAt?: string | null;
      updatedAt: string;
    },
  ): RevisionDeleteOperationRecord {
    const operation = this.getRevisionDeleteOperation(operationId);
    this.database
      .prepare(
        `UPDATE revision_delete_operations
         SET state = ?, failure_reason = ?, archive_started_at = ?, db_committed_at = ?,
             completed_at = ?, updated_at = ?
         WHERE operation_id = ?`,
      )
      .run(
        state,
        fields.failureReason === undefined ? operation.failureReason : fields.failureReason,
        fields.archiveStartedAt === undefined
          ? operation.archiveStartedAt
          : fields.archiveStartedAt,
        fields.dbCommittedAt === undefined ? operation.dbCommittedAt : fields.dbCommittedAt,
        fields.completedAt === undefined ? operation.completedAt : fields.completedAt,
        fields.updatedAt,
        operationId,
      );
    return this.getRevisionDeleteOperation(operationId);
  }

  /**
   * Dependency proofs for the delete aggregate. Every proof is read from the
   * persisted canonical authority (never a client-provided value).
   */
  public countIssuePackagesForRevision(revisionId: string): number {
    return Number(
      (
        this.database
          .prepare('SELECT COUNT(*) AS total FROM canonical_issue_packages WHERE revision_id = ?')
          .get(normalizeUuid(revisionId, 'Issue Package Revision lookup')) as { total: number }
      ).total,
    );
  }

  public countCompatibilityRevisionsForProject(projectId: string, revisionId: string): number {
    return Number(
      (
        this.database
          .prepare(
            `SELECT COUNT(*) AS total FROM project_revisions
             WHERE project_id = ? AND (id = ? OR revision_number = (SELECT revision_sequence FROM canonical_revisions WHERE revision_id = ?))`,
          )
          .get(projectId, revisionId, revisionId) as { total: number }
      ).total,
    );
  }

  /**
   * H3 — Direct fail-closed probe of the legacy `revision_packages` authority.
   *
   * Independent review found compatibility checks relied primarily on
   * `project_revisions` and canonical `canonical_issue_packages` rows. A legacy
   * package may semantically reference the Revision sequence/project even when
   * a compatibility `project_revisions` row is unexpectedly absent, so this
   * direct probe blocks deletion in that case. Legacy rows are NEVER deleted
   * here — their presence only blocks eligibility.
   */
  public countLegacyRevisionPackageDependenciesForProject(
    projectId: string,
    revisionSequence: number,
  ): number {
    return Number(
      (
        this.database
          .prepare(
            `SELECT COUNT(*) AS total FROM revision_packages
             WHERE project_id = ? AND revision_number = ?`,
          )
          .get(projectId, revisionSequence) as { total: number }
      ).total,
    );
  }

  /**
   * H1 — FULL in-transaction eligibility recheck.
   *
   * Runs inside the caller's open transaction immediately before the
   * destructive canonical deletes. It re-reads the Revision from the persisted
   * authority (never trusting an earlier GET or earlier service eligibility
   * result) and re-validates every fail-closed invariant. If ANY state changed
   * (or the Revision is gone), it throws a typed DomainError so the caller can
   * ROLLBACK, keep the Revision intact, mark the operation FAILED_RECOVERABLE,
   * and surface a truthful conflict. A Revision that became FINALIZED between
   * eligibility and commit is never deleted.
   */
  public assertRevisionDeleteStillEligible(
    projectId: string,
    revisionId: string,
    revisionSequence: number,
  ): void {
    const revision = this.getRevision(revisionId);
    if (revision.projectId !== projectId) {
      throw conflict('The Revision is no longer attached to this Project and cannot be deleted.');
    }
    if (revision.lifecycleState === 'FINALIZED') {
      throw conflict('This Revision became FINALIZED after eligibility and cannot be deleted.');
    }
    if (revision.lifecycleState !== 'PREPARING') {
      throw conflict('This Revision is no longer PREPARING and cannot be deleted.');
    }
    const operation = revision.projectSnapshot?.canonicalOperation;
    if (operation !== 'MANUAL_DELIVERABLES') {
      throw conflict(
        'This Revision is no longer a canonical manual deliverable and cannot be deleted.',
      );
    }
    if (this.countIssuePackagesForRevision(revisionId) > 0) {
      throw conflict('This Revision acquired Issue Package history and cannot be deleted.');
    }
    if (this.countCompatibilityRevisionsForProject(projectId, revisionId) > 0) {
      throw conflict(
        'This Revision acquired compatibility Revision history and cannot be deleted.',
      );
    }
    if (this.countLegacyRevisionPackageDependenciesForProject(projectId, revisionSequence) > 0) {
      throw conflict('This Revision acquired a legacy Package dependency and cannot be deleted.');
    }
  }

  /**
   * Atomically deletes the Revision-owned canonical rows and the canonical
   * Revision row. Only PREPARING-owned children already proven safe are
   * removed. Package / ManagedArtifact / LuminaireAssetVersion rows are never
   * deleted here — their presence blocks eligibility before this is reached.
   * Runs inside the caller's transaction (transaction-neutral).
   */
  public deleteCanonicalRevisionRows(revisionId: string): void {
    this.database
      .prepare('DELETE FROM revision_document_snapshots WHERE revision_id = ?')
      .run(revisionId);
    this.database.prepare('DELETE FROM canonical_outputs WHERE revision_id = ?').run(revisionId);
    const result = this.database
      .prepare('DELETE FROM canonical_revisions WHERE revision_id = ?')
      .run(revisionId);
    if (result.changes !== 1) throw notFound('Canonical Revision not found.');
  }
}

function revisionDeleteOperationFromRow(row: Row): RevisionDeleteOperationRecord {
  const state = deleteState(requiredText(row.state, 'Revision Delete Operation state'));
  const rawManifest = requiredText(
    row.artifact_manifest_json,
    'Revision Delete Operation manifest',
  );
  let artifactManifest: RevisionDeleteManifest;
  try {
    const parsed = JSON.parse(rawManifest) as RevisionDeleteManifest;
    artifactManifest = {
      revisionId: requiredText(parsed.revisionId, 'Revision Delete Operation manifest revision'),
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    throw conflict('Persisted Revision Delete Operation manifest is malformed.');
  }
  return {
    operationId: requiredText(row.operation_id, 'Operation ID'),
    projectId: requiredText(row.project_id, 'Operation Project ID'),
    revisionId: requiredText(row.revision_id, 'Operation Revision ID'),
    revisionSequence: requiredNumber(row.revision_sequence, 'Revision Delete Operation sequence'),
    revisionLabel: requiredText(row.revision_label, 'Revision Delete Operation label'),
    actorId: nullableText(row.actor_id),
    actorNameSnapshot: nullableText(row.actor_name_snapshot),
    state,
    failureReason: nullableText(row.failure_reason),
    artifactManifest,
    documentSnapshotCount: requiredNumber(row.document_snapshot_count, 'Document snapshot count'),
    datasheetSnapshotCount: requiredNumber(row.datasheet_snapshot_count, 'Datasheet count'),
    generatedOutputCount: requiredNumber(row.generated_output_count, 'Generated output count'),
    createdAt: requiredText(row.created_at, 'Operation created timestamp'),
    archiveStartedAt: nullableText(row.archive_started_at),
    dbCommittedAt: nullableText(row.db_committed_at),
    completedAt: nullableText(row.completed_at),
    reusedByRevisionId: nullableText(row.reused_by_revision_id),
    reusedAt: nullableText(row.reused_at),
    reusedByActorId: nullableText(row.reused_by_actor_id),
    reusedByActorName: nullableText(row.reused_by_actor_name),
    reuseReason: nullableText(row.reuse_reason),
    updatedAt: requiredText(row.updated_at, 'Operation updated timestamp'),
  };
}

function deleteState(value: unknown): RevisionDeleteState {
  const state = requiredText(value, 'Revision Delete Operation state');
  if (
    state !== 'PLANNED' &&
    state !== 'ARCHIVING' &&
    state !== 'ARCHIVED' &&
    state !== 'DB_COMMITTED' &&
    state !== 'COMPLETED' &&
    state !== 'FAILED_RECOVERABLE'
  ) {
    throw conflict('Persisted Revision Delete Operation state is invalid.');
  }
  return state;
}
