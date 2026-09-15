import path from 'node:path';
import { WorkSessionAttributionStore } from './infrastructure/final-ui/WorkSessionAttributionStore';
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  lstatSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { AppConfig } from '@scli/config';
import {
  DomainError,
  buildFolderProfile,
  builtInCodesFromScopeItems,
  canonicalizeLuminaireTag,
  folderProfileToPreset,
  dedupeScopeItems,
  normalizeScopeItemInputs,
  normalizeLuminaireTag,
  parseScopeItems,
  projectFolderFileCategories,
  projectStorageMarkerFileName,
  projectServiceLabels,
  scopeItemsFromServices,
  normalizeProfileName,
  presetToFolderProfileDraft,
  serializeScopeItems,
  type FolderProfile,
  type FolderProfilePreset,
  type ProjectScopeItem,
  type ProjectScopeItemInput,
  type BackupRecord,
  type CanonicalOutputRecord,
  type CanonicalRevisionRecord,
  type FolderNodePreset,
  type LuminaireInputMode,
  type LuminaireAssetSummary,
  type LuminaireAssetType,
  type LuminaireAssetVersion,
  type LuminaireRecord,
  type AppUser,
  type OutputColumn,
  type PersonalWorkspaceSettings,
  type ProjectDeliverable,
  type ProjectExportRecord,
  type ProjectFileCenterItem,
  type ProjectFolderFileCategory,
  type ProjectFolderFileItem,
  type ProjectFolderIndex,
  type ProjectLightingPackage,
  type ProjectRevision,
  type ProjectOutputFolders,
  type RevisionPackageManifestItem,
  type RevisionPackageComparison,
  type RevisionLuminaireSnapshot,
  type RevisionPackageOutputMode,
  type RevisionPackageRecord,
  type ProjectServiceCode,
  type ProjectWorkspace,
  type FolderProfileCatalog,
  type WorkflowTransitionRecord,
  type RevisionCycle,
  type RevisionCycleStatus,
  type ProjectStatus,
  type WorkSession,
  assertValidWorkflowTransitionRecord,
  assertValidRevisionCycle,
  assertValidWorkSession,
  duplicateLuminaireTagMessage,
} from '@scli/domain';
import { folderProfileCatalogSchema, projectStorageMarkerSchema } from '@scli/contracts';
import type {
  LuminaireRecordInput,
  AttachLuminaireAssetInput,
  PersonalSettingsInput,
  ProjectRevisionInput,
  SaveFolderProfileInput,
  UpdateDeliverableInput,
  UpdateLightingPackageInput,
} from '@scli/contracts';
import {
  adaptLegacyFolderStructure,
  adaptLegacyOutputMappings,
  buildOutputMappings,
  buildProjectFolderSnapshot,
  folderConfigurationFingerprint,
  folderProfileStructuralFingerprint,
  folderStructureFromSnapshot,
  instantiateProjectFolderDraft,
  legacyOutputFoldersView,
  lostFolderIds,
  outputFoldersFromMappings,
  rebuildFolderSnapshot,
  rebuildOutputMappings,
  resolveLegacyOutputDestination,
  sanitizeLegacyPath,
  validateFolderSnapshot,
  validateProjectFolderDraft,
  type FolderProfileSource,
  type ProjectFolderDraft,
  type OutputMapping,
  type ProjectFolderSnapshot,
  type ProjectOutputMappings,
} from '@scli/domain';
import { projectFolderSnapshotSchema, projectOutputMappingsSchema } from '@scli/contracts';
import { validateFolderConfiguration } from './project-folder-service.js';
import { PersonalOperationsStore } from './personal-operations-store.js';
import { resolveCanonicalArtifactPath } from './infrastructure/output-registry/canonical-artifact-files.js';
import {
  LEGACY_SELF_MANAGED,
  DEFAULT_SCHEMA_MANAGEMENT_MODE,
  EXTERNALLY_MIGRATED,
  verifyExternalSchemaReadiness,
  type SchemaManagementMode,
} from './infrastructure/migration/registry/production-migration-registry';
import { ProjectLuminaireWriteStore } from './infrastructure/project-luminaires/ProjectLuminaireWriteStore';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

export interface WorkspaceWithScope extends ProjectWorkspace {
  scopeItems: ProjectScopeItem[];
  folderSnapshot: ProjectFolderSnapshot;
  outputMappings: OutputMapping[];
  folderConfigurationFingerprint: string;
}

export interface ManagedProjectLuminaireAssetInput {
  assetVersionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  locatorValue: string;
  absolutePath: string;
}

/** app_state key holding the P2.4B3A user Folder Profile catalog JSON document. */
const FOLDER_PROFILE_CATALOG_STATE_KEY = 'folder_profile_catalog';

function verifiedWorkspaceRoot(projectId: string, value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const root = path.resolve(value);
  try {
    const metadata = lstatSync(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return null;
    if (path.resolve(realpathSync.native(root)).toLowerCase() !== root.toLowerCase()) return null;
    const marker = projectStorageMarkerSchema.parse(
      JSON.parse(readFileSync(path.join(root, projectStorageMarkerFileName), 'utf8')),
    );
    return marker.projectId === projectId ? root : null;
  } catch {
    return null;
  }
}

export const builtInFolderProfiles: FolderProfilePreset[] = [
  {
    name: 'Full Lighting Design',
    description: 'Complete design, calculations, drawings, presentations, BOQ, and datasheets.',
    builtIn: true,
    factoryProfileKey: 'full-lighting-design',
    source: 'factory',
    outputFolders: {
      scheduleExcel: '06_LUMINAIRE_SCHEDULE/EXCEL',
      schedulePdf: '06_LUMINAIRE_SCHEDULE/PDF',
      boqExcel: '07_BOQ/EXCEL',
      boqPdf: '07_BOQ/PDF',
      datasheets: '08_DATASHEETS',
    },
    additionalOutputDefaults: {
      dialuxReport: '02_DESIGN/DIALUX',
      cadLayoutPdf: '03_DRAWINGS/PDF',
      cadWorkingDrawing: '03_DRAWINGS/WORKING',
    },
    folders: [
      {
        name: '01_INPUT',
        children: [
          { name: 'CAD', children: [] },
          { name: 'ARCHITECTURE', children: [] },
          { name: 'CLIENT_BRIEF', children: [] },
        ],
      },
      {
        name: '02_DESIGN',
        children: [
          { name: 'DIALUX', children: [] },
          { name: 'CALCULATIONS', children: [] },
          { name: 'CONCEPT', children: [] },
        ],
      },
      {
        name: '03_DRAWINGS',
        children: [
          { name: 'WORKING', children: [] },
          { name: 'PDF', children: [] },
          { name: 'ISSUED', children: [] },
        ],
      },
      {
        name: '04_3D_VISUALIZATION',
        children: [
          { name: 'MODELS', children: [] },
          { name: 'RENDERS', children: [] },
        ],
      },
      { name: '05_PRESENTATION', children: [] },
      {
        name: '06_LUMINAIRE_SCHEDULE',
        children: [
          { name: 'EXCEL', children: [] },
          { name: 'PDF', children: [] },
          { name: 'IMAGES', children: [] },
        ],
      },
      {
        name: '07_BOQ',
        children: [
          { name: 'EXCEL', children: [] },
          { name: 'PDF', children: [] },
        ],
      },
      { name: '08_DATASHEETS', children: [] },
      { name: '09_CORRESPONDENCE', children: [] },
      { name: '10_ARCHIVE', children: [] },
    ],
  },
  {
    name: 'Classic SCLI',
    description: 'Balanced SCLI project structure for typical villa and commercial work.',
    builtIn: true,
    factoryProfileKey: 'classic-scli',
    source: 'factory',
    outputFolders: {
      scheduleExcel: '04_LUMINAIRE_SCHEDULE',
      schedulePdf: '04_LUMINAIRE_SCHEDULE',
      boqExcel: '05_BOQ',
      boqPdf: '05_BOQ',
      datasheets: '06_DATASHEETS',
    },
    additionalOutputDefaults: {
      dialuxReport: '03_SUBMITTAL/REPORTS',
      cadLayoutPdf: '03_SUBMITTAL/DRAWINGS',
      cadWorkingDrawing: '02_WORKING/CAD',
    },
    folders: [
      {
        name: '01_RECEIVED',
        children: [
          { name: 'DRAWINGS', children: [] },
          { name: 'DOCUMENTS', children: [] },
        ],
      },
      {
        name: '02_WORKING',
        children: [
          { name: 'CAD', children: [] },
          { name: 'DIALUX', children: [] },
          { name: '3D', children: [] },
        ],
      },
      {
        name: '03_SUBMITTAL',
        children: [
          { name: 'DRAWINGS', children: [] },
          { name: 'REPORTS', children: [] },
          { name: 'PRESENTATION', children: [] },
        ],
      },
      { name: '04_LUMINAIRE_SCHEDULE', children: [] },
      { name: '05_BOQ', children: [] },
      { name: '06_DATASHEETS', children: [] },
      { name: '07_REVISIONS', children: [] },
    ],
  },
  {
    name: 'DIALux + CAD Layout',
    description: 'Focused structure for calculations, report, and lighting layout projects.',
    builtIn: true,
    factoryProfileKey: 'dialux-cad-layout',
    source: 'factory',
    outputFolders: {
      scheduleExcel: '04_LUMINAIRE_SCHEDULE',
      schedulePdf: '04_LUMINAIRE_SCHEDULE',
      boqExcel: '05_BOQ',
      boqPdf: '05_BOQ',
      datasheets: '06_DATASHEETS',
    },
    additionalOutputDefaults: {
      dialuxReport: '02_DIALUX/REPORT',
      cadLayoutPdf: '03_CAD_LAYOUT/PDF',
      cadWorkingDrawing: '03_CAD_LAYOUT/WORKING',
    },
    folders: [
      { name: '01_INPUT', children: [] },
      {
        name: '02_DIALUX',
        children: [
          { name: 'MODEL', children: [] },
          { name: 'REPORT', children: [] },
        ],
      },
      {
        name: '03_CAD_LAYOUT',
        children: [
          { name: 'WORKING', children: [] },
          { name: 'PDF', children: [] },
        ],
      },
      { name: '04_LUMINAIRE_SCHEDULE', children: [] },
      { name: '05_BOQ', children: [] },
      { name: '06_DATASHEETS', children: [] },
    ],
  },
  {
    name: 'Essential',
    description: 'Compact structure for fast, smaller deliverables.',
    builtIn: true,
    factoryProfileKey: 'essential',
    source: 'factory',
    outputFolders: {
      scheduleExcel: '04_LUMINAIRE_SCHEDULE',
      schedulePdf: '04_LUMINAIRE_SCHEDULE',
      boqExcel: '05_BOQ',
      boqPdf: '05_BOQ',
      datasheets: '06_DATASHEETS',
    },
    additionalOutputDefaults: {
      dialuxReport: '03_OUTPUT',
      cadLayoutPdf: '03_OUTPUT',
      cadWorkingDrawing: '02_WORKING',
    },
    folders: [
      { name: '01_INPUT', children: [] },
      { name: '02_WORKING', children: [] },
      { name: '03_OUTPUT', children: [] },
      { name: '04_LUMINAIRE_SCHEDULE', children: [] },
      { name: '05_BOQ', children: [] },
      { name: '06_DATASHEETS', children: [] },
    ],
  },
  {
    name: 'Tender + BOQ',
    description: 'Tender drawings, technical BOQ, luminaire schedule, and datasheets.',
    builtIn: true,
    factoryProfileKey: 'tender-boq',
    source: 'factory',
    outputFolders: {
      scheduleExcel: '03_LUMINAIRE_SCHEDULE',
      schedulePdf: '03_LUMINAIRE_SCHEDULE',
      boqExcel: '04_TECHNICAL_BOQ',
      boqPdf: '04_TECHNICAL_BOQ',
      datasheets: '05_DATASHEETS',
    },
    folders: [
      { name: '01_TENDER_INPUT', children: [] },
      { name: '02_DRAWINGS', children: [] },
      { name: '03_LUMINAIRE_SCHEDULE', children: [] },
      { name: '04_TECHNICAL_BOQ', children: [] },
      { name: '05_DATASHEETS', children: [] },
      { name: '06_ISSUED', children: [] },
    ],
  },
  {
    name: 'Site + Commissioning',
    description: 'Site records, approvals, commissioning, and final documentation.',
    builtIn: true,
    factoryProfileKey: 'site-commissioning',
    source: 'factory',
    outputFolders: {
      scheduleExcel: '04_AS_BUILT',
      schedulePdf: '04_AS_BUILT',
      boqExcel: '05_FINAL_BOQ',
      boqPdf: '05_FINAL_BOQ',
      datasheets: '06_DATASHEETS',
    },
    folders: [
      { name: '01_APPROVED_DOCUMENTS', children: [] },
      {
        name: '02_SITE_RECORDS',
        children: [
          { name: 'PHOTOS', children: [] },
          { name: 'MARKUPS', children: [] },
        ],
      },
      { name: '03_COMMISSIONING', children: [] },
      { name: '04_AS_BUILT', children: [] },
      { name: '05_FINAL_BOQ', children: [] },
      { name: '06_DATASHEETS', children: [] },
    ],
  },
];

const scheduleColumns: OutputColumn[] = (
  [
    ['tag', 'Type'],
    ['imagePath', 'Image'],
    ['description', 'Description'],
    ['manufacturer', 'Manufacturer'],
    ['model', 'Model'],
    ['wattage', 'Wattage'],
    ['lumens', 'Lumens'],
    ['lightColor', 'Light Colour'],
    ['cri', 'CRI'],
    ['beamAngle', 'Beam Angle'],
    ['ipRating', 'IP Rating'],
    ['mounting', 'Mounting'],
    ['cutout', 'Cut-out'],
    ['dimensions', 'Dimensions'],
    ['bodyColorFinish', 'Finish'],
    ['control', 'Control'],
    ['emergency', 'Emergency'],
    ['datasheetPath', 'Datasheet'],
    ['unit', 'Unit'],
    ['quantity', 'Quantity'],
    ['notes', 'Notes'],
  ] as Array<[string, string]>
).map(([fieldKey, header], sortOrder) => ({
  fieldKey,
  header,
  visible: true,
  sortOrder,
  width: fieldKey === 'description' ? 280 : fieldKey === 'imagePath' ? 160 : 140,
  compareInRevision: fieldKey !== 'imagePath',
  requiredForIssue: ['tag', 'description', 'unit'].includes(fieldKey),
  internalOnly: false,
}));

const boqColumns: OutputColumn[] = (
  [
    ['tag', 'Type'],
    ['category', 'Category'],
    ['description', 'Description'],
    ['manufacturer', 'Manufacturer'],
    ['model', 'Model'],
    ['unit', 'Unit'],
    ['quantity', 'Quantity'],
    ['location', 'Location'],
    ['notes', 'Notes'],
  ] as Array<[string, string]>
).map(([fieldKey, header], sortOrder) => ({
  fieldKey,
  header,
  visible: true,
  sortOrder,
  width: fieldKey === 'description' ? 300 : 140,
  compareInRevision: true,
  requiredForIssue: ['tag', 'description', 'unit'].includes(fieldKey),
  internalOnly: false,
}));

type Row = Record<string, unknown>;

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Maps a workflow_transitions SQLite row to the canonical domain model.
 * Validates the persisted row and fails closed (500) on corrupt history rather
 * than returning an unchecked cast from arbitrary DB rows.
 */
function transitionFromRow(row: Row): WorkflowTransitionRecord {
  const record: WorkflowTransitionRecord = {
    transitionId: String(row.transition_id),
    projectId: String(row.project_id),
    sequence: Number(row.sequence),
    fromStatus: String(row.from_status) as ProjectStatus,
    toStatus: String(row.to_status) as ProjectStatus,
    occurredAt: String(row.occurred_at),
    actorId: row.actor_id === null || row.actor_id === undefined ? null : String(row.actor_id),
    reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    revisionCycleId:
      row.revision_cycle_id === null || row.revision_cycle_id === undefined
        ? null
        : String(row.revision_cycle_id),
  };
  try {
    assertValidWorkflowTransitionRecord(record);
  } catch {
    throw new DomainError('VALIDATION_ERROR', 'Stored workflow transition record is invalid.', 500);
  }
  return record;
}

/**
 * Maps a revision_cycles SQLite row to the canonical domain model.
 * Validates the persisted row and fails closed (500) on corrupt data rather
 * than returning an unchecked cast from arbitrary DB rows.
 */
function cycleFromRow(row: Row): RevisionCycle {
  const cycle: RevisionCycle = {
    revisionCycleId: String(row.revision_cycle_id),
    projectId: String(row.project_id),
    cycleNumber: Number(row.cycle_number),
    status: String(row.status) as RevisionCycleStatus,
    openedAt: String(row.opened_at),
    openedByTransitionId: String(row.opened_by_transition_id),
    feedbackSummary: String(row.feedback_summary),
    workStartedAt:
      row.work_started_at === null || row.work_started_at === undefined
        ? null
        : String(row.work_started_at),
    returnedToClientAt:
      row.returned_to_client_at === null || row.returned_to_client_at === undefined
        ? null
        : String(row.returned_to_client_at),
    cancelledAt:
      row.cancelled_at === null || row.cancelled_at === undefined ? null : String(row.cancelled_at),
  };
  try {
    assertValidRevisionCycle(cycle);
  } catch {
    throw new DomainError('VALIDATION_ERROR', 'Stored revision cycle is invalid.', 500);
  }
  return cycle;
}

function isCanonicalObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).schemaVersion === 'string'
  );
}

/**
 * Maps a work_sessions SQLite row to the canonical domain model.
 * Validates the persisted row and fails closed (500) on corrupt history rather
 * than returning an unchecked cast from arbitrary DB rows.
 */
function workSessionFromRow(row: Row): WorkSession {
  const session: WorkSession = {
    id: String(row.id),
    projectId: String(row.project_id),
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : String(row.ended_at),
    pausedAt: row.paused_at === null || row.paused_at === undefined ? null : String(row.paused_at),
    accumulatedPausedMs:
      row.accumulated_paused_ms === null || row.accumulated_paused_ms === undefined
        ? 0
        : Number(row.accumulated_paused_ms),
    createdAt: String(row.created_at),
  };
  try {
    assertValidWorkSession(session);
  } catch {
    throw new DomainError('VALIDATION_ERROR', 'Stored work session is invalid.', 500);
  }
  return session;
}

function readFolderSnapshot(
  projectId: string,
  raw: unknown,
  fallback: FolderNodePreset[],
): ProjectFolderSnapshot {
  const parsed = json<unknown>(raw, null);
  if (isCanonicalObject(parsed)) {
    const validated = projectFolderSnapshotSchema.safeParse(parsed);
    if (!validated.success) {
      throw new DomainError('VALIDATION_ERROR', 'Stored project folder snapshot is invalid.', 500);
    }
    validateFolderSnapshot(validated.data);
    return validated.data;
  }
  return adaptLegacyFolderStructure(projectId, parsed, fallback);
}

function readOutputState(
  raw: unknown,
  snapshot: ProjectFolderSnapshot,
  fallback: ProjectOutputFolders,
): { mappings: OutputMapping[]; outputFolders: ProjectOutputFolders } {
  const parsed = json<unknown>(raw, null);
  if (isCanonicalObject(parsed)) {
    const validated = projectOutputMappingsSchema.safeParse(parsed);
    if (!validated.success) {
      throw new DomainError('VALIDATION_ERROR', 'Stored output mappings are invalid.', 500);
    }
    const mappings = validated.data.mappings.map((mapping) => {
      if (mapping.unresolved || !mapping.destinationFolderId) return mapping;
      const folderExists = snapshot.folders.some(
        (folder) => folder.folderId === mapping.destinationFolderId,
      );
      if (folderExists) return mapping;
      return {
        ...mapping,
        destinationFolderId: null,
        unresolved: true,
        legacyPath: mapping.legacyPath ?? null,
      };
    });
    return {
      mappings,
      outputFolders: outputFoldersFromMappings(mappings, snapshot, fallback),
    };
  }
  const record = legacyOutputRecord(parsed, fallback);
  return {
    mappings: adaptLegacyOutputMappings(record, snapshot, fallback),
    outputFolders: legacyOutputFoldersView(record, fallback),
  };
}

/** Rejects identity-changing structural edits on canonical snapshots through legacy write paths. */
function assertCanonicalIdentityPreserved(
  storedRaw: unknown,
  current: ProjectFolderSnapshot,
  rebuilt: ProjectFolderSnapshot,
): void {
  if (!isCanonicalObject(storedRaw)) return;
  const lost = lostFolderIds(current, rebuilt);
  if (lost.length > 0) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Renaming, moving, or deleting existing folders through workspace setup is not supported yet. Use the folder editor (P2.4B2) to change folder identity.',
      400,
    );
  }
}

function legacyOutputRecord(raw: unknown, fallback: ProjectOutputFolders): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.trim()) record[key] = value.trim();
    }
    return record;
  }
  return { ...fallback };
}

function luminaireFromRow(row: Row): LuminaireRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    tag: String(row.tag),
    category: String(row.category),
    imagePath: String(row.image_path),
    description: String(row.description),
    manufacturer: String(row.manufacturer),
    model: String(row.model),
    productType: String(row.product_type ?? ''),
    variantLabel: String(row.variant_label ?? ''),
    orderingCode: String(row.ordering_code ?? ''),
    wattage: String(row.wattage),
    lumens: String(row.lumens),
    lightColor: String(row.light_color),
    cri: String(row.cri),
    beamAngle: String(row.beam_angle),
    ipRating: String(row.ip_rating),
    mounting: String(row.mounting),
    cutout: String(row.cutout),
    driver: String(row.driver),
    control: String(row.control),
    emergency: String(row.emergency),
    datasheetPath: String(row.datasheet_path),
    location: String(row.location),
    unit: String(row.unit),
    quantity: Number(row.quantity),
    notes: String(row.notes),
    sourceName: String(row.source_name),
    dimensions: String(row.dimensions),
    bodyColorFinish: String(row.body_color_finish),
    rowVersion: Number(row.row_version ?? 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function luminaireAssetVersionFromRow(row: Row): LuminaireAssetVersion {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    luminaireId: String(row.luminaire_id),
    assetType: String(row.asset_type) as LuminaireAssetType,
    versionSequence: Number(row.version_sequence),
    filePath: String(row.file_path),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    fileHash: row.file_hash === null ? null : String(row.file_hash),
    backfilled: Number(row.backfilled) === 1,
    attachedAt: String(row.attached_at),
    attachedById: row.attached_by_id === null ? null : String(row.attached_by_id),
    attachedByNameSnapshot:
      row.attached_by_name_snapshot === null ? null : String(row.attached_by_name_snapshot),
    locatorKind: String(row.locator_kind ?? 'LEGACY_PATH') as 'LEGACY_PATH' | 'DATA_ROOT_RELATIVE',
    locatorValue: String(row.locator_value ?? row.file_path),
    sourceLibraryAssetVersionId:
      row.source_library_asset_version_id === null ||
      row.source_library_asset_version_id === undefined
        ? null
        : String(row.source_library_asset_version_id),
  };
}

function assetMimeType(assetType: LuminaireAssetType, filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (assetType === 'Datasheet') {
    if (extension !== '.pdf') {
      throw new DomainError('VALIDATION_ERROR', 'Datasheets must be PDF files.', 400);
    }
    return 'application/pdf';
  }
  const imageTypes: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  const mimeType = imageTypes[extension];
  if (!mimeType) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Product Images must be PNG, JPG, JPEG, or WebP files.',
      400,
    );
  }
  return mimeType;
}

function assetMimeTypeForLegacy(assetType: LuminaireAssetType, filePath: string): string {
  if (assetType === 'Datasheet') return 'application/pdf';
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Computes the SHA-256 hex digest of a file's current bytes using a synchronous
 * streaming read. This is the server-side file-hash authority for Luminaire
 * asset versions (PACKAGES-E2E-05F). It never trusts a client-supplied hash and
 * reflects the actual on-disk bytes at attach time.
 */
function sha256FileSync(filePath: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best-effort descriptor release; the hash is already computed or failed.
      }
    }
  }
}

export class PersonalWorkspaceStore {
  private readonly database: DatabaseSyncInstance;
  private readonly ownsDatabase: boolean;
  private readonly backupRoot: string;
  private readonly pendingRestorePath: string;
  public readonly operations: PersonalOperationsStore;

  /**
   * schemaManagementMode defaults to LEGACY_SELF_MANAGED as a temporary transition: it preserves
   * the currently runnable application until production startup wiring explicitly selects
   * EXTERNALLY_MIGRATED. LEGACY_SELF_MANAGED is not safe for final production and its removal is
   * deferred until the End-to-End Reality Gate passes.
   *
   * When `database` is supplied the store uses that shared handle and does NOT own it (close() is
   * a no-op for the connection). When omitted the store opens and owns its own connection.
   */
  public constructor(
    config: AppConfig,
    schemaManagementMode: SchemaManagementMode = DEFAULT_SCHEMA_MANAGEMENT_MODE,
    database?: DatabaseSyncInstance,
  ) {
    const ownsDatabase = database === undefined;
    const databasePath =
      config.APP_MODE === 'standalone'
        ? path.resolve(process.cwd(), config.STANDALONE_DB_PATH)
        : ':memory:';
    const databaseDirectory =
      databasePath === ':memory:'
        ? path.resolve(process.cwd(), 'data')
        : path.dirname(databasePath);
    this.backupRoot = path.join(databaseDirectory, 'backups');
    this.pendingRestorePath = path.join(databaseDirectory, 'restore-pending.sqlite');
    if (databasePath !== ':memory:' && ownsDatabase) {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.database = database ?? new DatabaseSync(databasePath);
    this.ownsDatabase = ownsDatabase;
    if (schemaManagementMode === EXTERNALLY_MIGRATED) {
      this.database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
      `);
      // Post-migration readiness assertion: no schema creation, alteration, or repair.
      try {
        verifyExternalSchemaReadiness(this.database, 'PersonalWorkspaceStore');
      } catch (error) {
        if (ownsDatabase) this.database.close();
        throw error;
      }
    } else {
      if (databasePath !== ':memory:') {
        const hasExistingWorkspace = this.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_workspaces'",
          )
          .get();
        const hasRevisionPackages = this.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'revision_packages'",
          )
          .get();
        const hasFolderIndex = this.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_file_index'",
          )
          .get();
        const outputColumns = this.database
          .prepare('PRAGMA table_info(project_output_columns)')
          .all() as Row[];
        const settingsColumns = this.database
          .prepare('PRAGMA table_info(personal_settings)')
          .all() as Row[];
        const hasV3Schema =
          Boolean(hasRevisionPackages) &&
          outputColumns.some((column) => column.name === 'required_for_issue') &&
          settingsColumns.some((column) => column.name === 'backup_retention');
        if (hasExistingWorkspace && (!hasV3Schema || !hasFolderIndex)) {
          const backupRoot = path.join(path.dirname(databasePath), 'backups');
          mkdirSync(backupRoot, { recursive: true });
          const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
          const backupPath = path.join(backupRoot, `SCLI_PRE_V3_1_${stamp}.sqlite`);
          this.database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
        }
      }
      this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS app_state (
        state_key TEXT PRIMARY KEY,
        json_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS personal_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1), project_root TEXT NOT NULL,
        default_folder_profile TEXT NOT NULL, default_input_mode TEXT NOT NULL,
        auto_open_project_folder INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_workspaces (
        project_id TEXT PRIMARY KEY, folder_path TEXT, folder_profile TEXT NOT NULL,
        services_json TEXT NOT NULL, input_mode TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_deliverables (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, service_code TEXT NOT NULL,
        title TEXT NOT NULL, status TEXT NOT NULL, progress_percent INTEGER NOT NULL,
        required INTEGER NOT NULL, due_date TEXT, sort_order INTEGER NOT NULL,
        updated_at TEXT NOT NULL, UNIQUE(project_id, service_code)
      );
      CREATE TABLE IF NOT EXISTS project_luminaires (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, tag TEXT NOT NULL,
        category TEXT NOT NULL, image_path TEXT NOT NULL, description TEXT NOT NULL,
        manufacturer TEXT NOT NULL, model TEXT NOT NULL, wattage TEXT NOT NULL,
        lumens TEXT NOT NULL, light_color TEXT NOT NULL, cri TEXT NOT NULL,
        beam_angle TEXT NOT NULL, ip_rating TEXT NOT NULL, mounting TEXT NOT NULL,
        cutout TEXT NOT NULL, driver TEXT NOT NULL, control TEXT NOT NULL,
        emergency TEXT NOT NULL, datasheet_path TEXT NOT NULL, location TEXT NOT NULL,
        unit TEXT NOT NULL, quantity REAL NOT NULL, notes TEXT NOT NULL,
        source_name TEXT NOT NULL, dimensions TEXT NOT NULL, body_color_finish TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(project_id, tag)
      );
      CREATE TABLE IF NOT EXISTS luminaire_asset_versions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, luminaire_id TEXT NOT NULL,
        asset_type TEXT NOT NULL CHECK(asset_type IN ('Datasheet', 'ProductImage')),
        version_sequence INTEGER NOT NULL CHECK(version_sequence > 0),
        file_path TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
        size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0), file_hash TEXT,
        backfilled INTEGER NOT NULL DEFAULT 0 CHECK(backfilled IN (0, 1)),
        attached_at TEXT NOT NULL, attached_by_id TEXT, attached_by_name_snapshot TEXT,
        UNIQUE(luminaire_id, asset_type, version_sequence),
        FOREIGN KEY(luminaire_id) REFERENCES project_luminaires(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS ix_luminaire_asset_versions_project
        ON luminaire_asset_versions(project_id, luminaire_id, asset_type, version_sequence DESC);
      CREATE INDEX IF NOT EXISTS ix_luminaire_asset_versions_luminaire
        ON luminaire_asset_versions(luminaire_id, asset_type, version_sequence DESC);
      CREATE TABLE IF NOT EXISTS project_output_columns (
        project_id TEXT NOT NULL, output_type TEXT NOT NULL, field_key TEXT NOT NULL,
        header TEXT NOT NULL, visible INTEGER NOT NULL, sort_order INTEGER NOT NULL,
        PRIMARY KEY(project_id, output_type, field_key)
      );
      CREATE TABLE IF NOT EXISTS project_exports (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision INTEGER NOT NULL,
        excel_path TEXT NOT NULL, pdf_path TEXT NOT NULL, datasheet_folder TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS custom_folder_profiles (
        name TEXT PRIMARY KEY COLLATE NOCASE, description TEXT NOT NULL,
        folders_json TEXT NOT NULL, output_folders_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revision_packages (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
        reissue_number INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Draft', output_mode TEXT NOT NULL,
        folder_path TEXT NOT NULL, zip_path TEXT NOT NULL, item_count INTEGER NOT NULL,
        total_bytes INTEGER NOT NULL, package_hash TEXT NOT NULL,
        warning_override_reason TEXT NOT NULL, manifest_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_revision_packages_project
        ON revision_packages(project_id, revision_number DESC, reissue_number DESC, created_at DESC);
      CREATE TABLE IF NOT EXISTS project_file_index (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, category TEXT NOT NULL,
        file_name TEXT NOT NULL, relative_path TEXT NOT NULL, file_path TEXT NOT NULL,
        extension TEXT NOT NULL, size_bytes INTEGER NOT NULL, modified_at TEXT,
        availability TEXT NOT NULL, confidence INTEGER NOT NULL, indexed_at TEXT NOT NULL,
        UNIQUE(project_id, relative_path)
      );
      CREATE TABLE IF NOT EXISTS project_file_index_runs (
        project_id TEXT PRIMARY KEY, folder_path TEXT NOT NULL, indexed_at TEXT NOT NULL,
        file_count INTEGER NOT NULL, total_bytes INTEGER NOT NULL,
        one_drive_managed INTEGER NOT NULL, truncated INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_file_index_project_category
        ON project_file_index(project_id, category, modified_at DESC);
      CREATE TABLE IF NOT EXISTS workflow_transitions (
        transition_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        sequence INTEGER NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL,
        occurred_at TEXT NOT NULL, actor_id TEXT, reason TEXT, revision_cycle_id TEXT,
        UNIQUE(project_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS ix_workflow_transitions_project
        ON workflow_transitions(project_id, sequence);
      CREATE TABLE IF NOT EXISTS revision_cycles (
        revision_cycle_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        cycle_number INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('Open', 'ReturnedToClient', 'Cancelled')),
        opened_at TEXT NOT NULL, opened_by_transition_id TEXT NOT NULL,
        feedback_summary TEXT NOT NULL, work_started_at TEXT,
        returned_to_client_at TEXT, cancelled_at TEXT,
        UNIQUE(project_id, cycle_number),
        FOREIGN KEY (opened_by_transition_id) REFERENCES workflow_transitions(transition_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_revision_cycles_one_open
        ON revision_cycles(project_id) WHERE status = 'Open';
      CREATE TABLE IF NOT EXISTS work_sessions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT, active_key INTEGER,
        created_at TEXT NOT NULL,
        CHECK (
          (ended_at IS NULL AND active_key IS 1)
          OR
          (ended_at IS NOT NULL AND active_key IS NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS ix_work_sessions_project
        ON work_sessions(project_id, started_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_work_sessions_one_active
        ON work_sessions(active_key) WHERE active_key IS NOT NULL;
    `);
      this.ensureColumn('project_workspaces', 'folders_json', "TEXT NOT NULL DEFAULT '[]'");
      this.ensureColumn('project_workspaces', 'output_folders_json', "TEXT NOT NULL DEFAULT '{}'");
      this.ensureColumn('project_workspaces', 'pdf_paper_size', "TEXT NOT NULL DEFAULT 'Auto'");
      this.ensureColumn('personal_settings', 'designer_name', "TEXT NOT NULL DEFAULT 'Mohamed'");
      this.ensureColumn(
        'personal_settings',
        'company_name',
        "TEXT NOT NULL DEFAULT 'SCIENTECHNIC'",
      );
      this.ensureColumn('personal_settings', 'company_logo_path', "TEXT NOT NULL DEFAULT ''");
      this.ensureColumn('personal_settings', 'accent_color', "TEXT NOT NULL DEFAULT '#008C95'");
      this.ensureColumn(
        'personal_settings',
        'time_zone',
        `TEXT NOT NULL DEFAULT '${config.COMPANY_TIMEZONE.replaceAll("'", "''")}'`,
      );
      this.ensureColumn('personal_settings', 'backup_retention', 'INTEGER NOT NULL DEFAULT 20');
      this.ensureColumn('project_exports', 'schedule_excel_path', "TEXT NOT NULL DEFAULT ''");
      this.ensureColumn('project_exports', 'schedule_pdf_path', "TEXT NOT NULL DEFAULT ''");
      this.ensureColumn('project_exports', 'boq_excel_path', "TEXT NOT NULL DEFAULT ''");
      this.ensureColumn('project_exports', 'boq_pdf_path', "TEXT NOT NULL DEFAULT ''");
      this.ensureColumn('project_luminaires', 'product_type', "TEXT NOT NULL DEFAULT ''");
      this.ensureColumn('project_luminaires', 'variant_label', "TEXT NOT NULL DEFAULT ''");
      this.ensureColumn('project_luminaires', 'ordering_code', "TEXT NOT NULL DEFAULT ''");
      this.ensureColumn(
        'project_luminaires',
        'row_version',
        'INTEGER NOT NULL DEFAULT 1 CHECK(row_version >= 1)',
      );
      this.ensureColumn('project_output_columns', 'width', 'INTEGER NOT NULL DEFAULT 140');
      this.ensureColumn(
        'project_output_columns',
        'compare_in_revision',
        'INTEGER NOT NULL DEFAULT 1',
      );
      this.ensureColumn(
        'project_output_columns',
        'required_for_issue',
        'INTEGER NOT NULL DEFAULT 0',
      );
      this.ensureColumn('project_output_columns', 'internal_only', 'INTEGER NOT NULL DEFAULT 0');
      this.ensureColumn('revision_packages', 'status', "TEXT NOT NULL DEFAULT 'Draft'");
      this.ensureColumn(
        'revision_packages',
        'luminaire_snapshot_json',
        "TEXT NOT NULL DEFAULT '[]'",
      );
      // P2-TIMER-FND-01: schema v5 additive pause/resume columns. The self-managed
      // mirror must stay semantically aligned with the production V5 migration.
      this.ensureColumn('work_sessions', 'paused_at', 'TEXT');
      this.ensureColumn('work_sessions', 'accumulated_paused_ms', 'INTEGER NOT NULL DEFAULT 0');
      this.ensureColumn(
        'luminaire_asset_versions',
        'backfilled',
        'INTEGER NOT NULL DEFAULT 0 CHECK(backfilled IN (0, 1))',
      );
      this.backfillLuminaireAssetVersions();
      // V4-ISSUE-A0: schema v12 additive Issue audit columns. The self-managed
      // mirror must stay semantically aligned with the production 11 -> 12
      // migration: nullable, no default, no backfill. The canonical registry
      // table may not exist yet in non-production harnesses that apply the v4
      // registry DDL after store construction, so the columns are only ensured
      // when the table is present.
      if (
        this.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'canonical_issue_packages'",
          )
          .get()
      ) {
        this.ensureColumn('canonical_issue_packages', 'issued_by_id', 'TEXT');
        this.ensureColumn('canonical_issue_packages', 'issued_by_name', 'TEXT');
        this.ensureColumn('canonical_issue_packages', 'issued_at', 'TEXT');
      }
      this.ensureColumn('revision_packages', 'issued_by_id', 'TEXT');
      this.ensureColumn('revision_packages', 'issued_by_name', 'TEXT');
      this.ensureColumn('revision_packages', 'issued_at', 'TEXT');
    }
    this.database.exec('PRAGMA optimize;');
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
      INSERT OR IGNORE INTO personal_settings
      (id, project_root, default_folder_profile, default_input_mode, auto_open_project_folder, updated_at)
      VALUES (1, ?, ?, 'Later', 1, ?)
    `,
      )
      .run(config.PERSONAL_PROJECT_ROOT, config.PERSONAL_DEFAULT_FOLDER_PROFILE, now);
    const hasOperationsSchema = this.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_requirements'",
      )
      .get();
    const workspaceCount = this.database
      .prepare('SELECT COUNT(*) AS count FROM project_workspaces')
      .get() as { count: number };
    if (
      schemaManagementMode === LEGACY_SELF_MANAGED &&
      databasePath !== ':memory:' &&
      !hasOperationsSchema &&
      Number(workspaceCount.count) > 0
    ) {
      const backupRoot = path.join(path.dirname(databasePath), 'backups');
      mkdirSync(backupRoot, { recursive: true });
      const stamp = now.replaceAll(':', '-').replaceAll('.', '-');
      const backupPath = path.join(backupRoot, `SCLI_PRE_V2_${stamp}.sqlite`);
      this.database.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    }
    this.operations = new PersonalOperationsStore(
      this.database,
      config.COMPANY_TIMEZONE,
      schemaManagementMode,
    );
  }

  public close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  public getSettings(): PersonalWorkspaceSettings {
    const row = this.database.prepare('SELECT * FROM personal_settings WHERE id = 1').get() as Row;
    return {
      projectRoot: String(row.project_root),
      defaultFolderProfile: String(row.default_folder_profile),
      defaultInputMode: String(row.default_input_mode) as LuminaireInputMode,
      autoOpenProjectFolder: Boolean(row.auto_open_project_folder),
      designerName: String(row.designer_name ?? 'Mohamed'),
      companyName: String(row.company_name ?? 'SCIENTECHNIC'),
      companyLogoPath: String(row.company_logo_path ?? ''),
      accentColor: String(row.accent_color ?? '#008C95'),
      timeZone: String(row.time_zone ?? 'Asia/Dubai'),
      backupRetention: Number(row.backup_retention ?? 20),
      updatedAt: String(row.updated_at),
    };
  }

  public updateSettings(input: PersonalSettingsInput): PersonalWorkspaceSettings {
    const current = this.getSettings();
    const next: PersonalWorkspaceSettings = {
      projectRoot: input.projectRoot ?? current.projectRoot,
      defaultFolderProfile: input.defaultFolderProfile ?? current.defaultFolderProfile,
      defaultInputMode: input.defaultInputMode ?? current.defaultInputMode,
      autoOpenProjectFolder: input.autoOpenProjectFolder ?? current.autoOpenProjectFolder,
      designerName: input.designerName ?? current.designerName,
      companyName: input.companyName ?? current.companyName,
      companyLogoPath: input.companyLogoPath ?? current.companyLogoPath,
      accentColor: input.accentColor ?? current.accentColor,
      timeZone: input.timeZone ?? current.timeZone,
      backupRetention: input.backupRetention ?? current.backupRetention,
      updatedAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        `
      UPDATE personal_settings SET project_root = ?, default_folder_profile = ?,
      default_input_mode = ?, auto_open_project_folder = ?, designer_name = ?, company_name = ?,
      company_logo_path = ?, accent_color = ?, time_zone = ?, backup_retention = ?,
      updated_at = ? WHERE id = 1
    `,
      )
      .run(
        next.projectRoot,
        next.defaultFolderProfile,
        next.defaultInputMode,
        next.autoOpenProjectFolder ? 1 : 0,
        next.designerName,
        next.companyName,
        next.companyLogoPath,
        next.accentColor,
        next.timeZone,
        next.backupRetention,
        next.updatedAt,
      );
    return next;
  }

  public listFolderProfiles(): FolderProfilePreset[] {
    const catalog = this.readFolderProfileCatalog();
    const catalogNames = new Set(
      catalog.profiles.map((profile) => normalizeProfileName(profile.name)),
    );
    const catalogPresets = catalog.profiles
      .map((profile) => ({
        ...folderProfileToPreset(profile, builtInFolderProfiles[0]!.outputFolders),
        source: 'user' as const,
        profileId: profile.profileId,
      }))
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
      );
    const historical = (
      this.database
        .prepare('SELECT * FROM custom_folder_profiles ORDER BY name COLLATE NOCASE')
        .all() as Row[]
    )
      .map((row): FolderProfilePreset => ({
        name: String(row.name),
        description: String(row.description),
        folders: json<FolderNodePreset[]>(row.folders_json, []),
        outputFolders: json<ProjectOutputFolders>(
          row.output_folders_json,
          builtInFolderProfiles[0]!.outputFolders,
        ),
        builtIn: false,
        source: 'legacy',
      }))
      .filter((preset) => !catalogNames.has(normalizeProfileName(preset.name)));
    return structuredClone([...builtInFolderProfiles, ...catalogPresets, ...historical]);
  }

  public saveFolderProfile(input: SaveFolderProfileInput): FolderProfilePreset {
    if (
      builtInFolderProfiles.some(
        (profile) => profile.name.toLowerCase() === input.name.toLowerCase(),
      )
    ) {
      throw new DomainError('CONFLICT', 'Built-in folder profiles cannot be overwritten.', 409);
    }
    const outputFolders = validateFolderConfiguration(input.folders, input.outputFolders);
    const catalog = this.readFolderProfileCatalog();
    const normalizedName = normalizeProfileName(input.name);
    const existingIndex = catalog.profiles.findIndex(
      (profile) => normalizeProfileName(profile.name) === normalizedName,
    );
    const existing = existingIndex >= 0 ? catalog.profiles[existingIndex]! : null;
    const draft = presetToFolderProfileDraft(
      {
        name: input.name,
        description: input.description,
        folders: input.folders,
        outputFolders,
      },
      existing,
    );
    const now = new Date().toISOString();
    let saved: FolderProfile;
    if (existing) {
      saved = buildFolderProfile(
        draft,
        new Map(existing.folders.map((node) => [node.profileFolderId, node])),
        randomUUID,
        now,
        existing.profileId,
      );
      saved.createdAt = existing.createdAt;
      catalog.profiles[existingIndex] = saved;
    } else {
      saved = buildFolderProfile(draft, new Map(), randomUUID, now, randomUUID());
      catalog.profiles.push(saved);
    }
    this.writeFolderProfileCatalog(catalog);
    return folderProfileToPreset(saved, builtInFolderProfiles[0]!.outputFolders);
  }
  // -------------------------------------------------------------------------
  // P2.4B3A - Folder Profile catalog persistence (JSON-backed app_state)
  // -------------------------------------------------------------------------

  /** Reads the persisted user Folder Profile catalog, defaulting to an empty catalog. */
  public readFolderProfileCatalog(): FolderProfileCatalog {
    const row = this.database
      .prepare('SELECT json_value FROM app_state WHERE state_key = ?')
      .get(FOLDER_PROFILE_CATALOG_STATE_KEY) as { json_value: string } | undefined;
    if (!row) {
      return { schemaVersion: '1.0', profiles: [], defaultProfileRef: { kind: 'blank' } };
    }
    return folderProfileCatalogSchema.parse(JSON.parse(row.json_value));
  }

  /** Persists the user Folder Profile catalog as a single JSON app-state document. */
  public writeFolderProfileCatalog(
    catalog: FolderProfileCatalog,
    persistBlankDefault = false,
  ): void {
    this.database
      .prepare(
        `INSERT INTO app_state (state_key, json_value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           json_value = excluded.json_value,
           updated_at = excluded.updated_at`,
      )
      .run(
        FOLDER_PROFILE_CATALOG_STATE_KEY,
        this.serializeFolderProfileCatalog(catalog, persistBlankDefault),
        new Date().toISOString(),
      );
  }

  /**
   * Serializes the catalog. A blank canonical default is persisted as the old
   * defaultProfileId: null shape until it is explicitly set (setDefaultBlank);
   * this preserves the distinction between "no canonical default chosen" (legacy
   * compatibility resolution may apply) and "canonical blank chosen" (blank
   * wins over any legacy mirror).
   */
  private serializeFolderProfileCatalog(
    catalog: FolderProfileCatalog,
    persistBlankDefault: boolean,
  ): string {
    if (
      catalog.defaultProfileRef.kind === 'blank' &&
      !persistBlankDefault &&
      !this.hasCanonicalDefault()
    ) {
      return JSON.stringify({
        schemaVersion: catalog.schemaVersion,
        profiles: catalog.profiles,
        defaultProfileId: null,
      });
    }
    return JSON.stringify(catalog);
  }

  /** True when the persisted catalog carries an explicit canonical default. */
  public hasCanonicalDefault(): boolean {
    const row = this.database
      .prepare('SELECT json_value FROM app_state WHERE state_key = ?')
      .get(FOLDER_PROFILE_CATALOG_STATE_KEY) as { json_value: string } | undefined;
    if (!row) return false;
    try {
      const parsed = JSON.parse(row.json_value) as Record<string, unknown>;
      if (parsed.defaultProfileRef !== undefined) return true;
      return parsed.defaultProfileId !== undefined && parsed.defaultProfileId !== null;
    } catch {
      return false;
    }
  }

  /** Reads one historical custom_folder_profiles row without canonical fallbacks. */
  public readHistoricalFolderProfile(name: string): {
    name: string;
    description: string;
    folders: FolderNodePreset[];
    outputFolders: Record<string, string>;
  } | null {
    const row = this.database
      .prepare('SELECT * FROM custom_folder_profiles WHERE name = ? COLLATE NOCASE')
      .get(name) as Row | undefined;
    if (!row) return null;
    return {
      name: String(row.name),
      description: String(row.description),
      folders: json<FolderNodePreset[]>(row.folders_json, []),
      outputFolders: json<Record<string, string>>(row.output_folders_json, {}),
    };
  }

  /** P2.4B3B1A: mirrors a canonical factory/user default into the legacy name-based setting. */
  public mirrorDefaultFolderProfile(name: string): void {
    this.database
      .prepare(
        `UPDATE personal_settings SET default_folder_profile = ?, updated_at = ? WHERE id = 1`,
      )
      .run(name, new Date().toISOString());
  }
  public createBackup(reason = 'MANUAL'): string {
    mkdirSync(this.backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const safeReason = reason
      .toUpperCase()
      .replaceAll(/[^A-Z0-9_-]/g, '_')
      .slice(0, 40);
    const backupPath = path.join(this.backupRoot, `SCLI_${safeReason}_${stamp}.sqlite`);
    const escaped = backupPath.replaceAll("'", "''");
    this.database.exec(`VACUUM INTO '${escaped}'`);
    const retention = this.getSettings().backupRetention;
    const backups = this.listBackups();
    for (const backup of backups.slice(retention)) {
      const resolved = path.resolve(backup.filePath);
      const safeRoot = `${this.backupRoot}${path.sep}`.toLowerCase();
      if (
        `${resolved}${path.sep}`.toLowerCase().startsWith(safeRoot) &&
        path.extname(resolved).toLowerCase() === '.sqlite'
      ) {
        unlinkSync(resolved);
      }
    }
    return backupPath;
  }

  public listBackups(): BackupRecord[] {
    mkdirSync(this.backupRoot, { recursive: true });
    return readdirSync(this.backupRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sqlite'))
      .map((entry) => {
        const filePath = path.join(this.backupRoot, entry.name);
        const stats = statSync(filePath);
        const reason =
          /^SCLI_([^_]+(?:_[^_]+)*)_\d{4}-\d{2}-\d{2}T/i.exec(entry.name)?.[1] ?? 'BACKUP';
        return {
          fileName: entry.name,
          filePath,
          sizeBytes: stats.size,
          createdAt: stats.birthtime.toISOString(),
          reason: reason.replaceAll('_', ' '),
        };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  public scheduleRestore(backupPath: string): string {
    const backup = this.listBackups().find(
      (record) =>
        path.resolve(record.filePath).toLowerCase() === path.resolve(backupPath).toLowerCase(),
    );
    if (!backup) throw new DomainError('NOT_FOUND', 'Backup file was not found.', 404);
    const checkDatabase = new DatabaseSync(backup.filePath, { readOnly: true });
    try {
      const check = checkDatabase.prepare('PRAGMA quick_check').get() as { quick_check: string };
      if (check.quick_check !== 'ok') {
        throw new DomainError('VALIDATION_ERROR', 'Backup integrity check failed.', 400);
      }
    } finally {
      checkDatabase.close();
    }
    if (existsSync(this.pendingRestorePath)) {
      throw new DomainError(
        'CONFLICT',
        'A restore is already waiting for application restart.',
        409,
      );
    }
    copyFileSync(backup.filePath, this.pendingRestorePath, constants.COPYFILE_EXCL);
    return this.pendingRestorePath;
  }

  public initializeProject(
    projectId: string,
    services: ProjectServiceCode[],
    folderProfile: string,
    inputMode: LuminaireInputMode,
    dueDate: string | null,
    folderStructure?: FolderNodePreset[],
    outputFolders?: ProjectOutputFolders,
    scopeItems?: ProjectScopeItemInput[],
  ): WorkspaceWithScope {
    const profile = this.listFolderProfiles().find((candidate) => candidate.name === folderProfile);
    if (!profile) {
      throw new DomainError('VALIDATION_ERROR', 'Unknown project folder profile.', 400);
    }
    const selectedFolders = structuredClone(folderStructure ?? profile.folders);
    const selectedOutputFolders = validateFolderConfiguration(
      selectedFolders,
      structuredClone(outputFolders ?? profile.outputFolders),
    );
    const existing = this.database
      .prepare(
        'SELECT folders_json, output_folders_json FROM project_workspaces WHERE project_id = ?',
      )
      .get(projectId) as Row | undefined;
    let snapshot: ProjectFolderSnapshot;
    let mappings: OutputMapping[];
    if (existing) {
      // Idempotent retry: preserve already-persisted folder identities and source metadata.
      const rawFolders = existing.folders_json;
      const currentSnapshot = readFolderSnapshot(projectId, rawFolders, profile.folders);
      snapshot = rebuildFolderSnapshot(currentSnapshot, selectedFolders, randomUUID);
      assertCanonicalIdentityPreserved(json<unknown>(rawFolders, null), currentSnapshot, snapshot);
      const currentOutput = readOutputState(
        existing.output_folders_json,
        currentSnapshot,
        profile.outputFolders,
      );
      mappings = rebuildOutputMappings(currentOutput.mappings, snapshot, selectedOutputFolders);
    } else {
      const sourceProfile: FolderProfileSource = {
        profileId: profile.builtIn ? null : profile.name,
        profileName: profile.name,
        profileRevision: null,
        structuralFingerprint: folderProfileStructuralFingerprint(
          profile.folders,
          profile.outputFolders,
        ),
      };
      snapshot = buildProjectFolderSnapshot(selectedFolders, sourceProfile, randomUUID);
      mappings = buildOutputMappings(selectedOutputFolders, snapshot);
    }
    const persistedMappings: ProjectOutputMappings = { schemaVersion: '1.0', mappings };
    const selected = scopeItems
      ? dedupeScopeItems(normalizeScopeItemInputs(scopeItems))
      : scopeItemsFromServices(services);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `
      INSERT INTO project_workspaces
      (project_id, folder_path, folder_profile, folders_json, output_folders_json,
       services_json, input_mode, pdf_paper_size, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?, 'Auto', ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET folder_profile = excluded.folder_profile,
      folders_json = excluded.folders_json, output_folders_json = excluded.output_folders_json,
      services_json = excluded.services_json, input_mode = excluded.input_mode,
      updated_at = excluded.updated_at
    `,
      )
      .run(
        projectId,
        folderProfile,
        JSON.stringify(snapshot),
        JSON.stringify(persistedMappings),
        JSON.stringify(serializeScopeItems(selected)),
        inputMode,
        now,
        now,
      );
    builtInCodesFromScopeItems(selected).forEach((serviceCode, sortOrder) => {
      this.database
        .prepare(
          `
        INSERT OR IGNORE INTO project_deliverables
        (id, project_id, service_code, title, status, progress_percent, required, due_date, sort_order, updated_at)
        VALUES (?, ?, ?, ?, 'NotStarted', 0, 1, ?, ?, ?)
      `,
        )
        .run(
          randomUUID(),
          projectId,
          serviceCode,
          projectServiceLabels[serviceCode],
          dueDate,
          sortOrder,
          now,
        );
    });
    this.ensureColumns(projectId, 'schedule', scheduleColumns);
    this.ensureColumns(projectId, 'boq', boqColumns);
    return this.getWorkspace(projectId);
  }

  /**
   * P2.4B3B2A - canonical project folder draft initialization. Validates the
   * reviewed draft, instantiates one canonical snapshot with fresh project
   * folder IDs, and persists it before any physical folder creation. Retries
   * with the same projectId keep the already-persisted snapshot and mappings
   * exactly, so repeated same-idempotency-key creates never regenerate IDs.
   */
  public initializeCanonicalProject(
    projectId: string,
    draft: ProjectFolderDraft,
    folderProfileName: string,
    services: ProjectServiceCode[],
    inputMode: LuminaireInputMode,
    dueDate: string | null,
    scopeItems?: ProjectScopeItemInput[],
  ): WorkspaceWithScope {
    validateProjectFolderDraft(draft);
    const existing = this.database
      .prepare(
        'SELECT folders_json, output_folders_json FROM project_workspaces WHERE project_id = ?',
      )
      .get(projectId) as Row | undefined;
    let snapshot: ProjectFolderSnapshot;
    let mappings: OutputMapping[];
    if (existing) {
      // Idempotent retry: preserve the persisted canonical snapshot and mappings.
      const currentSnapshot = readFolderSnapshot(projectId, existing.folders_json, []);
      snapshot = currentSnapshot;
      mappings = readOutputState(
        existing.output_folders_json,
        currentSnapshot,
        builtInFolderProfiles[0]!.outputFolders,
      ).mappings;
    } else {
      const instantiated = instantiateProjectFolderDraft(draft, randomUUID);
      snapshot = instantiated.snapshot;
      mappings = [...instantiated.outputMappings.mappings];
      // P4B factory defaults are applied only while instantiating a NEW
      // Project. Existing Projects, custom mappings, and retry-loaded snapshots
      // are never backfilled or overwritten.
      const factory = builtInFolderProfiles.find((profile) => profile.name === folderProfileName);
      for (const [outputTypeId, destinationPath] of Object.entries(
        factory?.additionalOutputDefaults ?? {},
      )) {
        if (mappings.some((mapping) => mapping.outputTypeId === outputTypeId)) continue;
        const destination = resolveLegacyOutputDestination(snapshot, destinationPath);
        if (!destination) continue;
        mappings.push({
          outputTypeId,
          destinationFolderId: destination.folderId,
          unresolved: false,
          legacyPath: null,
        });
      }
    }
    const persistedMappings: ProjectOutputMappings = { schemaVersion: '1.0', mappings };
    const selected = scopeItems
      ? dedupeScopeItems(normalizeScopeItemInputs(scopeItems))
      : scopeItemsFromServices(services);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_workspaces
         (project_id, folder_path, folder_profile, folders_json, output_folders_json,
          services_json, input_mode, pdf_paper_size, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, 'Auto', ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET folder_profile = excluded.folder_profile,
         folders_json = excluded.folders_json, output_folders_json = excluded.output_folders_json,
         services_json = excluded.services_json, input_mode = excluded.input_mode,
         updated_at = excluded.updated_at`,
      )
      .run(
        projectId,
        folderProfileName,
        JSON.stringify(snapshot),
        JSON.stringify(persistedMappings),
        JSON.stringify(serializeScopeItems(selected)),
        inputMode,
        now,
        now,
      );
    builtInCodesFromScopeItems(selected).forEach((serviceCode, sortOrder) => {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO project_deliverables
           (id, project_id, service_code, title, status, progress_percent, required, due_date, sort_order, updated_at)
           VALUES (?, ?, ?, ?, 'NotStarted', 0, 1, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          projectId,
          serviceCode,
          projectServiceLabels[serviceCode],
          dueDate,
          sortOrder,
          now,
        );
    });
    this.ensureColumns(projectId, 'schedule', scheduleColumns);
    this.ensureColumns(projectId, 'boq', boqColumns);
    return this.getWorkspace(projectId);
  }

  public setFolderPath(projectId: string, folderPath: string): WorkspaceWithScope {
    this.requireWorkspace(projectId);
    this.database
      .prepare('UPDATE project_workspaces SET folder_path = ?, updated_at = ? WHERE project_id = ?')
      .run(folderPath, new Date().toISOString(), projectId);
    return this.getWorkspace(projectId);
  }

  public getFolderIndex(projectId: string): ProjectFolderIndex {
    const workspace = this.requireWorkspace(projectId);
    const run = this.database
      .prepare('SELECT * FROM project_file_index_runs WHERE project_id = ?')
      .get(projectId) as Row | undefined;
    const rows = this.database
      .prepare(
        `SELECT * FROM project_file_index WHERE project_id = ?
         ORDER BY category, relative_path COLLATE NOCASE`,
      )
      .all(projectId) as Row[];
    const items: ProjectFolderFileItem[] = rows.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      category: String(row.category) as ProjectFolderFileCategory,
      fileName: String(row.file_name),
      relativePath: String(row.relative_path),
      filePath: String(row.file_path),
      extension: String(row.extension),
      sizeBytes: Number(row.size_bytes),
      modifiedAt: row.modified_at === null ? null : String(row.modified_at),
      availability: String(row.availability) as ProjectFolderFileItem['availability'],
      confidence: Number(row.confidence),
      indexedAt: String(row.indexed_at),
    }));
    const counts = Object.fromEntries(
      projectFolderFileCategories.map((category) => [
        category,
        items.filter((item) => item.category === category).length,
      ]),
    ) as Record<ProjectFolderFileCategory, number>;
    return {
      projectId,
      folderPath: run ? String(run.folder_path) : String(workspace.folder_path ?? ''),
      indexedAt: run ? String(run.indexed_at) : null,
      fileCount: run ? Number(run.file_count) : 0,
      totalBytes: run ? Number(run.total_bytes) : 0,
      oneDriveManaged: Boolean(run?.one_drive_managed),
      truncated: Boolean(run?.truncated),
      counts,
      items,
    };
  }

  public replaceFolderIndex(index: ProjectFolderIndex): ProjectFolderIndex {
    this.requireWorkspace(index.projectId);
    const indexedAt = index.indexedAt ?? new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare('DELETE FROM project_file_index WHERE project_id = ?')
        .run(index.projectId);
      const insert = this.database.prepare(`
        INSERT INTO project_file_index
        (id, project_id, category, file_name, relative_path, file_path, extension,
         size_bytes, modified_at, availability, confidence, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of index.items) {
        insert.run(
          item.id,
          index.projectId,
          item.category,
          item.fileName,
          item.relativePath,
          item.filePath,
          item.extension,
          item.sizeBytes,
          item.modifiedAt,
          item.availability,
          item.confidence,
          indexedAt,
        );
      }
      this.database
        .prepare(
          `INSERT INTO project_file_index_runs
           (project_id, folder_path, indexed_at, file_count, total_bytes,
            one_drive_managed, truncated)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET folder_path = excluded.folder_path,
           indexed_at = excluded.indexed_at, file_count = excluded.file_count,
           total_bytes = excluded.total_bytes,
           one_drive_managed = excluded.one_drive_managed, truncated = excluded.truncated`,
        )
        .run(
          index.projectId,
          index.folderPath,
          indexedAt,
          index.fileCount,
          index.totalBytes,
          index.oneDriveManaged ? 1 : 0,
          index.truncated ? 1 : 0,
        );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.touch(index.projectId, indexedAt);
    return this.getFolderIndex(index.projectId);
  }

  public removeProjectData(projectId: string): void {
    const tables = this.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const { name } of tables) {
        if (!/^[a-z_]+$/i.test(name)) continue;
        const columns = this.database.prepare(`PRAGMA table_info(${name})`).all() as Row[];
        if (columns.some((column) => column.name === 'project_id')) {
          this.database.prepare(`DELETE FROM ${name} WHERE project_id = ?`).run(projectId);
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public updateScope(projectId: string, scopeItems: ProjectScopeItemInput[]): WorkspaceWithScope {
    this.requireWorkspace(projectId);
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.applyProjectConfiguration(projectId, scopeItems, undefined, now);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.getWorkspace(projectId);
  }

  /**
   * Transaction-neutral Project configuration writer. The caller owns the
   * surrounding transaction when this is combined with the provider app_state
   * mutation. It intentionally changes only scope/services and input mode.
   */
  public applyProjectConfiguration(
    projectId: string,
    scopeItems: ProjectScopeItemInput[],
    inputMode: LuminaireInputMode | undefined,
    now: string,
  ): void {
    this.requireWorkspace(projectId);
    const selected = dedupeScopeItems(normalizeScopeItemInputs(scopeItems));
    this.database
      .prepare(
        `UPDATE project_workspaces
         SET services_json = ?, input_mode = COALESCE(?, input_mode), updated_at = ?
         WHERE project_id = ?`,
      )
      .run(JSON.stringify(serializeScopeItems(selected)), inputMode ?? null, now, projectId);
    this.database
      .prepare('UPDATE project_deliverables SET required = 0, updated_at = ? WHERE project_id = ?')
      .run(now, projectId);
    const insert = this.database.prepare(`
      INSERT INTO project_deliverables
      (id, project_id, service_code, title, status, progress_percent, required, due_date, sort_order, updated_at)
      VALUES (?, ?, ?, ?, 'NotStarted', 0, 1, NULL, ?, ?)
      ON CONFLICT(project_id, service_code) DO UPDATE SET required = 1,
        title = excluded.title, sort_order = excluded.sort_order, updated_at = excluded.updated_at
    `);
    builtInCodesFromScopeItems(selected).forEach((serviceCode, sortOrder) =>
      insert.run(
        randomUUID(),
        projectId,
        serviceCode,
        projectServiceLabels[serviceCode],
        sortOrder,
        now,
      ),
    );
  }

  public updateFolderConfiguration(
    projectId: string,
    folderProfile: string,
    folders: FolderNodePreset[],
    outputFolders: ProjectOutputFolders,
  ): ProjectWorkspace {
    this.requireWorkspace(projectId);
    const validatedOutputs = validateFolderConfiguration(folders, outputFolders);
    const row = this.database
      .prepare(
        'SELECT folders_json, output_folders_json FROM project_workspaces WHERE project_id = ?',
      )
      .get(projectId) as Row;
    const rawFolders = row.folders_json;
    const currentSnapshot = readFolderSnapshot(projectId, rawFolders, folders);
    const currentOutput = readOutputState(row.output_folders_json, currentSnapshot, outputFolders);
    const snapshot = rebuildFolderSnapshot(currentSnapshot, folders, randomUUID);
    assertCanonicalIdentityPreserved(json<unknown>(rawFolders, null), currentSnapshot, snapshot);
    const mappings = rebuildOutputMappings(currentOutput.mappings, snapshot, validatedOutputs);
    const persistedMappings: ProjectOutputMappings = { schemaVersion: '1.0', mappings };
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE project_workspaces
         SET folder_profile = ?, folders_json = ?, output_folders_json = ?, updated_at = ?
         WHERE project_id = ?`,
      )
      .run(
        folderProfile,
        JSON.stringify(snapshot),
        JSON.stringify(persistedMappings),
        updatedAt,
        projectId,
      );
    return this.getWorkspace(projectId);
  }

  /**
   * Persists a canonical folder snapshot and output mapping set. Used by the
   * controlled folder structure editor (P2.4B2) and by the first explicit
   * legacy canonicalization. Scope, deliverables, and all other workspace
   * data are untouched.
   */
  public persistFolderSnapshot(
    projectId: string,
    snapshot: ProjectFolderSnapshot,
    mappings: OutputMapping[],
  ): WorkspaceWithScope {
    this.requireWorkspace(projectId);
    const persistedMappings: ProjectOutputMappings = { schemaVersion: '1.0', mappings };
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE project_workspaces
         SET folders_json = ?, output_folders_json = ?, updated_at = ?
         WHERE project_id = ?`,
      )
      .run(JSON.stringify(snapshot), JSON.stringify(persistedMappings), updatedAt, projectId);
    return this.getWorkspace(projectId);
  }

  /** True when the stored folder state is already canonical (not legacy). */
  public hasCanonicalFolderSnapshot(projectId: string): boolean {
    const row = this.database
      .prepare('SELECT folders_json FROM project_workspaces WHERE project_id = ?')
      .get(projectId) as Row | undefined;
    if (!row) return false;
    return isCanonicalObject(json<unknown>(row.folders_json, null));
  }

  public getWorkspace(projectId: string): WorkspaceWithScope {
    const workspace = this.requireWorkspace(projectId);
    const deliverables = (
      this.database
        .prepare(
          'SELECT * FROM project_deliverables WHERE project_id = ? ORDER BY sort_order, title',
        )
        .all(projectId) as Row[]
    ).map((row): ProjectDeliverable => ({
      id: String(row.id),
      projectId: String(row.project_id),
      serviceCode: String(row.service_code) as ProjectServiceCode,
      title: String(row.title),
      status: String(row.status) as ProjectDeliverable['status'],
      progressPercent: Number(row.progress_percent),
      required: Boolean(row.required),
      dueDate: row.due_date === null ? null : String(row.due_date),
      sortOrder: Number(row.sort_order),
      updatedAt: String(row.updated_at),
    }));
    const luminaires = (
      this.database
        .prepare(
          'SELECT * FROM project_luminaires WHERE project_id = ? ORDER BY tag COLLATE NOCASE',
        )
        .all(projectId) as Row[]
    ).map(luminaireFromRow);
    const exports = (
      this.database
        .prepare(
          'SELECT * FROM project_exports WHERE project_id = ? ORDER BY revision DESC, created_at DESC',
        )
        .all(projectId) as Row[]
    ).map((row): ProjectExportRecord => ({
      id: String(row.id),
      projectId: String(row.project_id),
      revision: Number(row.revision),
      excelPath: String(row.excel_path),
      pdfPath: String(row.pdf_path),
      datasheetFolder: String(row.datasheet_folder),
      scheduleExcelPath: String(row.schedule_excel_path || row.excel_path),
      schedulePdfPath: String(row.schedule_pdf_path || row.pdf_path),
      boqExcelPath: String(row.boq_excel_path || row.excel_path),
      boqPdfPath: String(row.boq_pdf_path || row.pdf_path),
      createdAt: String(row.created_at),
    }));
    const profile = this.listFolderProfiles().find(
      (candidate) => candidate.name === String(workspace.folder_profile),
    );
    const fallbackProfile = profile ?? builtInFolderProfiles[0]!;
    const folderSnapshot = readFolderSnapshot(
      projectId,
      workspace.folders_json,
      fallbackProfile.folders,
    );
    const outputState = readOutputState(
      workspace.output_folders_json,
      folderSnapshot,
      fallbackProfile.outputFolders,
    );
    const outputMappings = outputState.mappings.map((mapping) => ({
      ...mapping,
      legacyPath: sanitizeLegacyPath(mapping.legacyPath),
    }));
    const scopeItems = parseScopeItems(json<unknown>(workspace.services_json, []));
    const services = builtInCodesFromScopeItems(scopeItems);
    const operations = this.operations.getProjectData(
      projectId,
      services,
      workspace.folder_path === null ? null : String(workspace.folder_path),
      luminaires,
      exports.length > 0,
    );
    const verifiedRoot = verifiedWorkspaceRoot(projectId, workspace.folder_path);
    const fileCenter = operations.documents.map((document): ProjectFileCenterItem => {
      const filePath = document.filePath.trim();
      const resolvedFilePath = path.isAbsolute(filePath)
        ? filePath
        : verifiedRoot === null || !filePath
          ? null
          : path.resolve(verifiedRoot, filePath);
      const oneDrive = /(^|[\\/])onedrive(?:\s*-\s*[^\\/]+)?([\\/]|$)/i.test(filePath);
      if (!filePath) {
        return {
          documentId: document.id,
          title: document.title,
          category: document.category,
          filePath,
          state: 'NotGenerated',
          sizeBytes: 0,
          modifiedAt: null,
          oneDrive,
          note: 'No file has been linked to this register item yet.',
        };
      }
      if (!resolvedFilePath || !existsSync(resolvedFilePath)) {
        return {
          documentId: document.id,
          title: document.title,
          category: document.category,
          filePath,
          state: 'Missing',
          sizeBytes: 0,
          modifiedAt: null,
          oneDrive,
          note: oneDrive
            ? 'The file is unavailable locally. Check OneDrive sync or make it available offline.'
            : path.isAbsolute(filePath)
              ? 'The registered path no longer exists.'
              : 'The managed file is unavailable while Project storage is disconnected.',
        };
      }
      try {
        const stats = statSync(resolvedFilePath);
        return {
          documentId: document.id,
          title: document.title,
          category: document.category,
          filePath,
          state: document.status === 'Superseded' ? 'Outdated' : 'Current',
          sizeBytes: stats.isFile() ? stats.size : 0,
          modifiedAt: stats.mtime.toISOString(),
          oneDrive,
          note:
            document.status === 'Superseded'
              ? 'A newer controlled version is expected.'
              : oneDrive
                ? 'Available locally and synchronized through OneDrive.'
                : 'Available locally.',
        };
      } catch {
        return {
          documentId: document.id,
          title: document.title,
          category: document.category,
          filePath,
          state: 'Missing',
          sizeBytes: 0,
          modifiedAt: null,
          oneDrive,
          note: 'The file could not be read from the registered path.',
        };
      }
    });
    return {
      projectId,
      folderPath: workspace.folder_path === null ? null : String(workspace.folder_path),
      folderConfigurationFingerprint: folderConfigurationFingerprint(
        folderSnapshot,
        outputMappings,
      ),
      folderProfile: String(workspace.folder_profile),
      folderStructure: folderStructureFromSnapshot(folderSnapshot),
      outputFolders: outputState.outputFolders,
      folderSnapshot,
      outputMappings,
      services,
      scopeItems,
      deliverables,
      lightingPackage: this.getLightingPackage(
        projectId,
        String(workspace.input_mode) as LuminaireInputMode,
      ),
      luminaires,
      exports,
      revisionPackages: this.listRevisionPackages(projectId),
      ...operations,
      fileCenter,
      updatedAt: String(workspace.updated_at),
    };
  }

  public updateDeliverable(
    projectId: string,
    deliverableId: string,
    input: UpdateDeliverableInput,
  ): ProjectDeliverable {
    const row = this.database
      .prepare('SELECT * FROM project_deliverables WHERE id = ? AND project_id = ?')
      .get(deliverableId, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Deliverable not found.', 404);
    const status = input.status ?? String(row.status);
    const progress =
      input.progressPercent ?? (status === 'Completed' ? 100 : Number(row.progress_percent));
    const dueDate =
      input.dueDate === undefined
        ? row.due_date === null
          ? null
          : String(row.due_date)
        : input.dueDate;
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `
      UPDATE project_deliverables SET status = ?, progress_percent = ?, due_date = ?, updated_at = ?
      WHERE id = ? AND project_id = ?
    `,
      )
      .run(status, progress, dueDate, updatedAt, deliverableId, projectId);
    this.touch(projectId, updatedAt);
    return this.getWorkspace(projectId).deliverables.find((item) => item.id === deliverableId)!;
  }

  public addLuminaire(
    projectId: string,
    input: LuminaireRecordInput,
    requestActor?: AppUser,
  ): LuminaireRecord {
    this.requireWorkspace(projectId);
    const now = new Date().toISOString();
    let created: LuminaireRecord;
    try {
      created = new ProjectLuminaireWriteStore(this.database).create(projectId, input, {
        createdAt: now,
      });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'IMPORT_PROJECT_TAG_CONFLICT') {
        throw new DomainError('CONFLICT', duplicateLuminaireTagMessage(input.tag), 409);
      }
      throw error;
    }
    const id = created.id;
    const canonicalInput = { ...input, tag: created.tag };
    this.appendCompatibilityAssetVersion(
      projectId,
      id,
      'Datasheet',
      canonicalInput.datasheetPath,
      now,
      requestActor,
    );
    this.appendCompatibilityAssetVersion(
      projectId,
      id,
      'ProductImage',
      canonicalInput.imagePath,
      now,
      requestActor,
    );
    this.touch(projectId, now);
    return this.getLuminaire(id, projectId);
  }

  public updateLuminaire(
    projectId: string,
    luminaireId: string,
    input: LuminaireRecordInput,
    requestActor?: AppUser,
  ): LuminaireRecord {
    const current = this.database
      .prepare(
        'SELECT created_at, tag, datasheet_path, image_path, row_version FROM project_luminaires WHERE id = ? AND project_id = ?',
      )
      .get(luminaireId, projectId) as
      | {
          created_at: string;
          tag: string;
          datasheet_path: string;
          image_path: string;
          row_version: number;
        }
      | undefined;
    if (!current) throw new DomainError('NOT_FOUND', 'Luminaire not found.', 404);
    const libraryBindingTable = this.database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'project_luminaire_library_bindings'",
      )
      .get();
    const linked = libraryBindingTable
      ? this.database
          .prepare(
            'SELECT 1 FROM project_luminaire_library_bindings WHERE project_id = ? AND luminaire_id = ?',
          )
          .get(projectId, luminaireId)
      : undefined;
    if (linked) {
      const stored = this.getLuminaire(luminaireId, projectId);
      const snapshotOwned = [
        'imagePath',
        'description',
        'manufacturer',
        'model',
        'productType',
        'variantLabel',
        'orderingCode',
        'wattage',
        'lumens',
        'lightColor',
        'cri',
        'beamAngle',
        'ipRating',
        'mounting',
        'cutout',
        'driver',
        'control',
        'emergency',
        'datasheetPath',
        'sourceName',
        'dimensions',
        'bodyColorFinish',
      ] as const;
      if (snapshotOwned.some((field) => (input[field] ?? '') !== (stored[field] ?? ''))) {
        throw new DomainError(
          'CONFLICT',
          'Library-linked technical fields are snapshot-owned. Use Compare/Update or the Project Description Override.',
          409,
        );
      }
    }
    const canonicalInput = { ...input, tag: canonicalizeLuminaireTag(input.tag) };
    const tagChanged = input.tag !== current.tag;
    // Full-record updates always carry a Tag. Preserve its exact stored form when
    // the caller did not change it so unrelated edits remain safe for historical
    // mixed-case duplicates. Actual Tag changes still canonicalize and re-enter
    // the uniqueness invariant before persistence.
    if (tagChanged) {
      this.assertUniqueLuminaireTag(projectId, canonicalInput.tag, luminaireId);
    }
    const persistedInput = tagChanged ? canonicalInput : { ...input, tag: current.tag };
    const now = new Date().toISOString();
    this.updateLuminaireRow(
      luminaireId,
      projectId,
      persistedInput,
      current.created_at,
      now,
      current.row_version,
    );
    if (persistedInput.datasheetPath.trim() !== current.datasheet_path.trim()) {
      this.appendCompatibilityAssetVersion(
        projectId,
        luminaireId,
        'Datasheet',
        persistedInput.datasheetPath,
        now,
        requestActor,
      );
    }
    if (persistedInput.imagePath.trim() !== current.image_path.trim()) {
      this.appendCompatibilityAssetVersion(
        projectId,
        luminaireId,
        'ProductImage',
        persistedInput.imagePath,
        now,
        requestActor,
      );
    }
    this.touch(projectId, now);
    return this.getLuminaire(luminaireId, projectId);
  }

  public listLuminaireAssetSummaries(projectId: string): LuminaireAssetSummary[] {
    this.requireWorkspace(projectId);
    const luminaires = this.database
      .prepare(
        'SELECT id, datasheet_path, image_path FROM project_luminaires WHERE project_id = ? ORDER BY created_at, rowid',
      )
      .all(projectId) as Array<{ id: string; datasheet_path: string; image_path: string }>;
    const latest = this.database
      .prepare(
        `SELECT v.* FROM luminaire_asset_versions v
         JOIN (
           SELECT luminaire_id, asset_type, MAX(version_sequence) AS version_sequence
           FROM luminaire_asset_versions WHERE project_id = ? GROUP BY luminaire_id, asset_type
         ) current ON current.luminaire_id = v.luminaire_id
           AND current.asset_type = v.asset_type
           AND current.version_sequence = v.version_sequence
         WHERE v.project_id = ?`,
      )
      .all(projectId, projectId)
      .map(luminaireAssetVersionFromRow);
    return luminaires.map((luminaire) => {
      const datasheet = latest.find(
        (version) => version.luminaireId === luminaire.id && version.assetType === 'Datasheet',
      );
      const productImage = latest.find(
        (version) => version.luminaireId === luminaire.id && version.assetType === 'ProductImage',
      );
      const ies = latest.find(
        (version) => version.luminaireId === luminaire.id && version.assetType === 'IES',
      );
      const ldt = latest.find(
        (version) => version.luminaireId === luminaire.id && version.assetType === 'LDT',
      );
      return {
        luminaireId: luminaire.id,
        datasheet:
          luminaire.datasheet_path.trim() &&
          datasheet?.filePath.trim() === luminaire.datasheet_path.trim()
            ? datasheet
            : null,
        productImage:
          luminaire.image_path.trim() &&
          productImage?.filePath.trim() === luminaire.image_path.trim()
            ? productImage
            : null,
        ies: ies ?? null,
        ldt: ldt ?? null,
      };
    });
  }

  public listLuminaireAssetVersions(
    projectId: string,
    luminaireId: string,
    assetType?: LuminaireAssetType,
  ): LuminaireAssetVersion[] {
    this.getLuminaire(luminaireId, projectId);
    const rows = assetType
      ? this.database
          .prepare(
            `SELECT * FROM luminaire_asset_versions
             WHERE project_id = ? AND luminaire_id = ? AND asset_type = ?
             ORDER BY version_sequence DESC`,
          )
          .all(projectId, luminaireId, assetType)
      : this.database
          .prepare(
            `SELECT * FROM luminaire_asset_versions
             WHERE project_id = ? AND luminaire_id = ?
             ORDER BY asset_type, version_sequence DESC`,
          )
          .all(projectId, luminaireId);
    return (rows as Row[]).map(luminaireAssetVersionFromRow);
  }

  /**
   * PACKAGES-E2E-05A — list every Datasheet AssetVersion across all Luminaires
   * of a single project, ordered deterministically (tag then version).
   */
  public listProjectDatasheetAssetVersions(projectId: string): LuminaireAssetVersion[] {
    this.requireWorkspace(projectId);
    const rows = this.database
      .prepare(
        `SELECT lav.* FROM luminaire_asset_versions lav
         INNER JOIN project_luminaires pl ON pl.id = lav.luminaire_id
         WHERE lav.project_id = ? AND lav.asset_type = 'Datasheet'
         ORDER BY pl.tag COLLATE NOCASE, lav.version_sequence DESC`,
      )
      .all(projectId) as Row[];
    return rows.map(luminaireAssetVersionFromRow);
  }

  /**
   * PACKAGES-E2E-05A — fetch one LuminaireAssetVersion by id. Throws NOT_FOUND
   * when absent, or when the owning Luminaire does not belong to projectId.
   */
  public getLuminaireAssetVersionById(
    projectId: string,
    assetVersionId: string,
  ): LuminaireAssetVersion {
    const row = this.database
      .prepare(
        `SELECT lav.* FROM luminaire_asset_versions lav
         INNER JOIN project_luminaires pl ON pl.id = lav.luminaire_id
         WHERE lav.id = ? AND lav.project_id = ?`,
      )
      .get(assetVersionId, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Luminaire Asset Version not found.', 404);
    return luminaireAssetVersionFromRow(row);
  }

  /** PACKAGES-E2E-05A — public project-scoped Luminaire lookup. */
  public getLuminaireRecord(id: string, projectId: string): LuminaireRecord {
    return this.getLuminaire(id, projectId);
  }

  public attachLuminaireAsset(
    projectId: string,
    luminaireId: string,
    input: AttachLuminaireAssetInput,
    requestActor: AppUser,
    managed?: ManagedProjectLuminaireAssetInput,
  ): LuminaireAssetVersion {
    return this.runInTransaction(() => {
      this.getLuminaire(luminaireId, projectId);
      const libraryBindingTable = this.database
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'project_luminaire_library_bindings'",
        )
        .get();
      if (
        libraryBindingTable &&
        this.database
          .prepare(
            'SELECT 1 FROM project_luminaire_library_bindings WHERE project_id = ? AND luminaire_id = ?',
          )
          .get(projectId, luminaireId)
      ) {
        throw new DomainError(
          'CONFLICT',
          'Library-linked assets are snapshot-owned. Publish a Library Version and use Compare/Update.',
          409,
        );
      }
      const now = new Date().toISOString();
      const version = managed
        ? this.appendManagedAssetVersion(
            projectId,
            luminaireId,
            input.assetType,
            managed,
            now,
            requestActor,
          )
        : this.appendCompatibilityAssetVersion(
            projectId,
            luminaireId,
            input.assetType,
            input.filePath,
            now,
            requestActor,
            true,
          );
      if (!version) {
        throw new DomainError('VALIDATION_ERROR', 'An asset file path is required.', 400);
      }
      const column = input.assetType === 'Datasheet' ? 'datasheet_path' : 'image_path';
      this.database
        .prepare(
          `UPDATE project_luminaires SET ${column} = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND project_id = ?`,
        )
        .run(version.filePath, now, luminaireId, projectId);
      this.touch(projectId, now);
      return version;
    });
  }

  public upsertLuminaire(projectId: string, input: LuminaireRecordInput): LuminaireRecord {
    const canonicalInput = { ...input, tag: canonicalizeLuminaireTag(input.tag) };
    const normalizedTag = normalizeLuminaireTag(canonicalInput.tag);
    const existing = (
      this.database
        .prepare(
          'SELECT id, tag FROM project_luminaires WHERE project_id = ? ORDER BY created_at, rowid',
        )
        .all(projectId) as Array<{ id: string; tag: string }>
    ).find((record) => normalizeLuminaireTag(record.tag) === normalizedTag);
    return existing
      ? this.updateLuminaire(projectId, existing.id, canonicalInput)
      : this.addLuminaire(projectId, canonicalInput);
  }

  public deleteLuminaire(projectId: string, luminaireId: string): void {
    const result = this.database
      .prepare('DELETE FROM project_luminaires WHERE id = ? AND project_id = ?')
      .run(luminaireId, projectId);
    if (!result.changes) throw new DomainError('NOT_FOUND', 'Luminaire not found.', 404);
    this.touch(projectId, new Date().toISOString());
  }

  public updateLightingPackage(
    projectId: string,
    input: UpdateLightingPackageInput,
  ): ProjectLightingPackage {
    const workspace = this.requireWorkspace(projectId);
    const now = new Date().toISOString();
    if (input.inputMode) {
      this.database
        .prepare(
          'UPDATE project_workspaces SET input_mode = ?, updated_at = ? WHERE project_id = ?',
        )
        .run(input.inputMode, now, projectId);
    }
    if (input.pdfPaperSize) {
      this.database
        .prepare(
          'UPDATE project_workspaces SET pdf_paper_size = ?, updated_at = ? WHERE project_id = ?',
        )
        .run(input.pdfPaperSize, now, projectId);
    }
    if (input.scheduleColumns) this.replaceColumns(projectId, 'schedule', input.scheduleColumns);
    if (input.boqColumns) this.replaceColumns(projectId, 'boq', input.boqColumns);
    this.touch(projectId, now);
    return this.getLightingPackage(
      projectId,
      input.inputMode ?? (String(workspace.input_mode) as LuminaireInputMode),
    );
  }

  /** Writes only a legacy/read-model projection of an already-reserved canonical Revision. */
  public recordCanonicalRevisionProjection(
    revision: CanonicalRevisionRecord,
    input: ProjectRevisionInput,
  ): ProjectRevision {
    this.requireWorkspace(revision.projectId);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const record = this.operations.recordCanonicalRevisionProjection(
        revision.projectId,
        revision.revisionId,
        revision.revisionSequence,
        { ...input, revisionNumber: revision.revisionSequence },
        revision.createdAt,
      );
      this.database.exec('COMMIT');
      return record;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the projection error; the connection exposes transaction state separately.
      }
      throw error;
    }
  }

  /**
   * Compatibility Revision/Document projection for a Schedule-only canonical generation.
   * The caller owns the shared SQLite transaction and finalizes the canonical Revision in it.
   */
  public recordCanonicalScheduleProjection(
    revision: CanonicalRevisionRecord,
    outputs: CanonicalOutputRecord[],
    issueStatus: string,
    issueDate: string,
  ): ProjectRevision {
    return this.recordCanonicalTechnicalOutputProjection(
      revision,
      outputs,
      issueStatus,
      issueDate,
      {
        family: 'LuminaireSchedule',
        title: 'Luminaire Schedule',
        summary: 'Luminaire Schedule output.',
      },
    );
  }

  /** BOQ-only compatibility projection; the caller owns the shared SQLite transaction. */
  public recordCanonicalBoqProjection(
    revision: CanonicalRevisionRecord,
    outputs: CanonicalOutputRecord[],
    issueStatus: string,
    issueDate: string,
  ): ProjectRevision {
    return this.recordCanonicalTechnicalOutputProjection(
      revision,
      outputs,
      issueStatus,
      issueDate,
      {
        family: 'TechnicalBoq',
        title: 'Technical BOQ',
        summary: 'Technical BOQ output.',
      },
    );
  }

  private recordCanonicalTechnicalOutputProjection(
    revision: CanonicalRevisionRecord,
    outputs: CanonicalOutputRecord[],
    issueStatus: string,
    issueDate: string,
    definition: {
      readonly family: 'LuminaireSchedule' | 'TechnicalBoq';
      readonly title: string;
      readonly summary: string;
    },
  ): ProjectRevision {
    const workspace = this.requireWorkspace(revision.projectId);
    if (workspace.folder_path === null) {
      throw new DomainError('CONFLICT', 'Canonical Project root is not connected.', 409);
    }
    const formats = new Set<string>();
    const documents = outputs.map((output) => {
      const format = output.outputFormat.toUpperCase();
      if (
        output.outputFamily !== definition.family ||
        output.revisionId !== revision.revisionId ||
        output.lifecycleState !== 'FINALIZED' ||
        !output.contentHash ||
        output.locatorKind !== 'PROJECT_RELATIVE' ||
        !output.locatorValue ||
        !['XLSX', 'PDF'].includes(format) ||
        formats.has(format)
      ) {
        throw new DomainError(
          'CONFLICT',
          `${definition.title} projection requires a unique finalized canonical Output set.`,
          409,
        );
      }
      formats.add(format);
      return {
        output,
        absolutePath: resolveCanonicalArtifactPath(
          String(workspace.folder_path),
          output.locatorValue,
        ),
      };
    });
    if (documents.length < 1 || documents.length > 2) {
      throw new DomainError(
        'CONFLICT',
        `${definition.title} projection requires one or two canonical Outputs.`,
        409,
      );
    }

    const status: ProjectRevision['status'] = /issued/i.test(issueStatus)
      ? 'Issued'
      : 'InternalReview';
    const projection = this.operations.recordCanonicalRevisionProjection(
      revision.projectId,
      revision.revisionId,
      revision.revisionSequence,
      {
        revisionNumber: revision.revisionSequence,
        reissueNumber: 0,
        title: `${definition.title} ${revision.revisionLabel}`,
        status,
        receivedAt: null,
        dueDate: null,
        issuedAt: status === 'Issued' ? issueDate : null,
        summary: definition.summary,
        changeLog: '',
        sourceType: 'Manual',
        sourceReference: revision.revisionId,
      },
      revision.createdAt,
    );
    for (const { output, absolutePath } of documents) {
      const existing = this.database
        .prepare('SELECT project_id, file_path FROM project_documents WHERE id = ?')
        .get(output.outputId) as Row | undefined;
      if (
        existing &&
        (String(existing.project_id) !== revision.projectId ||
          String(existing.file_path) !== absolutePath)
      ) {
        throw new DomainError(
          'CONFLICT',
          `Canonical ${definition.title} document identity is already owned.`,
          409,
        );
      }
      if (!existing) {
        this.database
          .prepare(
            `INSERT INTO project_documents
             (id, project_id, category, document_number, title, revision, status, file_path,
              issued_to, issue_date, notes, created_at, updated_at)
             VALUES (?, ?, ?, '', ?, ?, ?, ?, '', ?,
                     'Generated by SCT Workspace.', ?, ?)`,
          )
          .run(
            output.outputId,
            revision.projectId,
            definition.family,
            `${definition.title} ${output.outputFormat}`,
            revision.revisionLabel,
            status,
            absolutePath,
            status === 'Issued' ? issueDate : null,
            revision.createdAt,
            revision.createdAt,
          );
      }
    }
    this.touch(revision.projectId, new Date().toISOString());
    return projection;
  }

  /**
   * Compatibility read projection for a completed canonical generation. Revision/Export/Document
   * identifiers and the sequence are supplied by the canonical aggregate; no legacy allocator runs.
   */
  public recordCanonicalExportProjection(
    revision: CanonicalRevisionRecord,
    outputs: CanonicalOutputRecord[],
    datasheetFolder: string,
    issueStatus: string,
    issueDate: string,
  ): ProjectExportRecord {
    this.requireWorkspace(revision.projectId);
    const requireOutput = (family: 'LuminaireSchedule' | 'TechnicalBoq', format: string) => {
      const output = outputs.find(
        (candidate) =>
          candidate.outputFamily === family && candidate.outputFormat.toUpperCase() === format,
      );
      if (
        !output ||
        output.revisionId !== revision.revisionId ||
        output.lifecycleState !== 'FINALIZED' ||
        !output.contentHash ||
        output.locatorKind !== 'PROJECT_RELATIVE' ||
        !output.locatorValue
      ) {
        throw new DomainError(
          'CONFLICT',
          'Canonical export projection requires the complete finalized Output set.',
          409,
        );
      }
      const workspace = this.requireWorkspace(revision.projectId);
      if (workspace.folder_path === null) {
        throw new DomainError('CONFLICT', 'Canonical Project root is not connected.', 409);
      }
      const root = path.resolve(String(workspace.folder_path));
      const absolutePath = path.resolve(root, ...output.locatorValue.split('/'));
      const relative = path.relative(root, absolutePath);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new DomainError(
          'CONFLICT',
          'Canonical Output locator escaped the Project root.',
          409,
        );
      }
      return { output, absolutePath };
    };
    const scheduleExcel = requireOutput('LuminaireSchedule', 'XLSX');
    const schedulePdf = requireOutput('LuminaireSchedule', 'PDF');
    const boqExcel = requireOutput('TechnicalBoq', 'XLSX');
    const boqPdf = requireOutput('TechnicalBoq', 'PDF');
    const record: ProjectExportRecord = {
      id: revision.revisionId,
      projectId: revision.projectId,
      revision: revision.revisionSequence,
      excelPath: scheduleExcel.absolutePath,
      pdfPath: schedulePdf.absolutePath,
      datasheetFolder,
      scheduleExcelPath: scheduleExcel.absolutePath,
      schedulePdfPath: schedulePdf.absolutePath,
      boqExcelPath: boqExcel.absolutePath,
      boqPdfPath: boqPdf.absolutePath,
      createdAt: revision.createdAt,
    };

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.database
        .prepare('SELECT * FROM project_exports WHERE id = ?')
        .get(record.id) as Row | undefined;
      if (existing) {
        const expected = [
          ['project_id', record.projectId],
          ['revision', record.revision],
          ['excel_path', record.excelPath],
          ['pdf_path', record.pdfPath],
          ['datasheet_folder', record.datasheetFolder],
          ['schedule_excel_path', record.scheduleExcelPath],
          ['schedule_pdf_path', record.schedulePdfPath],
          ['boq_excel_path', record.boqExcelPath],
          ['boq_pdf_path', record.boqPdfPath],
        ] as const;
        if (
          expected.some(([column, value]) =>
            typeof value === 'number'
              ? Number(existing[column]) !== value
              : String(existing[column]) !== value,
          )
        ) {
          throw new DomainError(
            'CONFLICT',
            'Canonical Export compatibility identity already contains different data.',
            409,
          );
        }
      } else {
        this.database
          .prepare(
            `INSERT INTO project_exports
             (id, project_id, revision, excel_path, pdf_path, datasheet_folder,
              schedule_excel_path, schedule_pdf_path, boq_excel_path, boq_pdf_path, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            record.id,
            record.projectId,
            record.revision,
            record.excelPath,
            record.pdfPath,
            record.datasheetFolder,
            record.scheduleExcelPath,
            record.schedulePdfPath,
            record.boqExcelPath,
            record.boqPdfPath,
            record.createdAt,
          );
      }

      const status: ProjectRevision['status'] = /issued/i.test(issueStatus)
        ? 'Issued'
        : 'InternalReview';
      this.operations.recordCanonicalRevisionProjection(
        revision.projectId,
        revision.revisionId,
        revision.revisionSequence,
        {
          revisionNumber: revision.revisionSequence,
          reissueNumber: 0,
          title: `Luminaire package ${revision.revisionLabel}`,
          status,
          receivedAt: null,
          dueDate: null,
          issuedAt: status === 'Issued' ? issueDate : null,
          summary: 'Luminaire Schedule, Technical BOQ and Datasheets package.',
          changeLog: '',
          sourceType: 'Manual',
          sourceReference: revision.revisionId,
        },
        revision.createdAt,
      );

      const documentInputs = [scheduleExcel, schedulePdf, boqExcel, boqPdf];
      for (const { output, absolutePath } of documentInputs) {
        const category =
          output.outputFamily === 'LuminaireSchedule' ? 'LuminaireSchedule' : 'TechnicalBoq';
        const title = `${output.outputFamily === 'LuminaireSchedule' ? 'Luminaire Schedule' : 'Technical BOQ'} ${output.outputFormat}`;
        const existingDocument = this.database
          .prepare('SELECT project_id, file_path FROM project_documents WHERE id = ?')
          .get(output.outputId) as Row | undefined;
        if (
          existingDocument &&
          (String(existingDocument.project_id) !== revision.projectId ||
            String(existingDocument.file_path) !== absolutePath)
        ) {
          throw new DomainError(
            'CONFLICT',
            'Canonical Output compatibility document identity is already owned.',
            409,
          );
        }
        if (!existingDocument) {
          this.database
            .prepare(
              `INSERT INTO project_documents
               (id, project_id, category, document_number, title, revision, status, file_path,
                issued_to, issue_date, notes, created_at, updated_at)
               VALUES (?, ?, ?, '', ?, ?, ?, ?, '', ?, 'Generated by SCT Workspace.', ?, ?)`,
            )
            .run(
              output.outputId,
              revision.projectId,
              category,
              title,
              revision.revisionLabel,
              status,
              absolutePath,
              status === 'Issued' ? issueDate : null,
              revision.createdAt,
              revision.createdAt,
            );
        }
      }
      this.touch(revision.projectId, new Date().toISOString());
      this.database.exec('COMMIT');
      return record;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the primary compatibility projection error.
      }
      throw error;
    }
  }

  /**
   * Legacy compatibility writer retained for the current filesystem-first exporter.
   *
   * It must not dual-write canonical_revisions/canonical_outputs. P2-FND-05 will reserve one
   * canonical Revision UUID/sequence before generation and then switch the production authority.
   */
  public recordExport(
    projectId: string,
    scheduleExcelPath: string,
    schedulePdfPath: string,
    boqExcelPath: string,
    boqPdfPath: string,
    datasheetFolder: string,
    issueStatus = 'Preliminary',
    issueDate = new Date().toISOString().slice(0, 10),
  ): ProjectExportRecord {
    this.requireWorkspace(projectId);
    const latest = this.database
      .prepare('SELECT MAX(revision) AS revision FROM project_exports WHERE project_id = ?')
      .get(projectId) as { revision: number | null };
    const record: ProjectExportRecord = {
      id: randomUUID(),
      projectId,
      revision: (latest.revision ?? 0) + 1,
      excelPath: scheduleExcelPath,
      pdfPath: schedulePdfPath,
      datasheetFolder,
      scheduleExcelPath,
      schedulePdfPath,
      boqExcelPath,
      boqPdfPath,
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        `
      INSERT INTO project_exports
      (id, project_id, revision, excel_path, pdf_path, datasheet_folder,
       schedule_excel_path, schedule_pdf_path, boq_excel_path, boq_pdf_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        record.id,
        record.projectId,
        record.revision,
        record.excelPath,
        record.pdfPath,
        record.datasheetFolder,
        record.scheduleExcelPath,
        record.schedulePdfPath,
        record.boqExcelPath,
        record.boqPdfPath,
        record.createdAt,
      );
    this.touch(projectId, record.createdAt);
    this.operations.recordExport(projectId, record.revision, issueStatus, issueDate);
    return record;
  }

  public listRevisionPackages(projectId: string): RevisionPackageRecord[] {
    this.requireWorkspace(projectId);
    return (
      this.database
        .prepare(
          `SELECT * FROM revision_packages WHERE project_id = ?
           ORDER BY revision_number DESC, reissue_number DESC, created_at DESC`,
        )
        .all(projectId) as Row[]
    ).map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      revisionNumber: Number(row.revision_number),
      reissueNumber: Number(row.reissue_number),
      label: String(row.label),
      status: String(row.status) as RevisionPackageRecord['status'],
      outputMode: String(row.output_mode) as RevisionPackageOutputMode,
      folderPath: String(row.folder_path),
      zipPath: String(row.zip_path),
      itemCount: Number(row.item_count),
      totalBytes: Number(row.total_bytes),
      packageHash: String(row.package_hash),
      warningOverrideReason: String(row.warning_override_reason),
      manifest: json<RevisionPackageManifestItem[]>(row.manifest_json, []),
      luminaireSnapshot: json<RevisionLuminaireSnapshot[]>(row.luminaire_snapshot_json, []),
      issuedById:
        row.issued_by_id === null || row.issued_by_id === undefined
          ? null
          : String(row.issued_by_id),
      issuedByName:
        row.issued_by_name === null || row.issued_by_name === undefined
          ? null
          : String(row.issued_by_name),
      issuedAt:
        row.issued_at === null || row.issued_at === undefined ? null : String(row.issued_at),
      createdAt: String(row.created_at),
    }));
  }

  /**
   * Idempotent read-model projection for an Issue Package whose UUID, Revision sequence, and
   * package/reissue sequence were already allocated by canonical authority.
   */
  public recordCanonicalRevisionPackageProjection(
    record: RevisionPackageRecord,
  ): RevisionPackageRecord {
    this.requireWorkspace(record.projectId);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.database
        .prepare('SELECT * FROM revision_packages WHERE id = ?')
        .get(record.id) as Row | undefined;
      if (existing) {
        const matches =
          String(existing.project_id) === record.projectId &&
          Number(existing.revision_number) === record.revisionNumber &&
          Number(existing.reissue_number) === record.reissueNumber &&
          String(existing.folder_path) === record.folderPath &&
          String(existing.zip_path) === record.zipPath &&
          String(existing.package_hash) === record.packageHash &&
          String(existing.manifest_json) === JSON.stringify(record.manifest) &&
          String(existing.luminaire_snapshot_json) === JSON.stringify(record.luminaireSnapshot) &&
          // V4-ISSUE-A0: the Issue audit authority is part of the compatibility
          // identity. Recovery must never rewrite it, so a mismatch is a conflict.
          (existing.issued_by_id === null || existing.issued_by_id === undefined
            ? record.issuedById === null
            : String(existing.issued_by_id) === record.issuedById) &&
          (existing.issued_by_name === null || existing.issued_by_name === undefined
            ? record.issuedByName === null
            : String(existing.issued_by_name) === record.issuedByName) &&
          (existing.issued_at === null || existing.issued_at === undefined
            ? record.issuedAt === null
            : String(existing.issued_at) === record.issuedAt);
        if (!matches) {
          throw new DomainError(
            'CONFLICT',
            'Canonical Issue Package compatibility identity already contains different data.',
            409,
          );
        }
        const projected = this.listRevisionPackages(record.projectId).find(
          (item) => item.id === record.id,
        )!;
        this.database.exec('COMMIT');
        return projected;
      }
      const projected = this.recordRevisionPackage(record);
      this.database.exec('COMMIT');
      return projected;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the projection error; the connection exposes transaction state separately.
      }
      throw error;
    }
  }

  /**
   * Legacy compatibility writer retained until P2-FND-05 finalisation orchestration switches
   * package creation to CanonicalOutputRegistryStore. Numeric revision is not canonical identity.
   */
  public recordRevisionPackage(record: RevisionPackageRecord): RevisionPackageRecord {
    this.requireWorkspace(record.projectId);
    this.database
      .prepare(
        `INSERT INTO revision_packages
        (id, project_id, revision_number, reissue_number, label, status, output_mode, folder_path,
         zip_path, item_count, total_bytes, package_hash, warning_override_reason,
         manifest_json, luminaire_snapshot_json, issued_by_id, issued_by_name, issued_at,
         created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.projectId,
        record.revisionNumber,
        record.reissueNumber,
        record.label,
        record.status,
        record.outputMode,
        record.folderPath,
        record.zipPath,
        record.itemCount,
        record.totalBytes,
        record.packageHash,
        record.warningOverrideReason,
        JSON.stringify(record.manifest),
        JSON.stringify(record.luminaireSnapshot),
        record.issuedById,
        record.issuedByName,
        record.issuedAt,
        record.createdAt,
      );
    this.touch(record.projectId, record.createdAt);
    return record;
  }

  public compareRevisionPackages(
    projectId: string,
    fromPackageId: string,
    toPackageId: string,
  ): RevisionPackageComparison {
    const records = this.listRevisionPackages(projectId);
    const from = records.find((record) => record.id === fromPackageId);
    const to = records.find((record) => record.id === toPackageId);
    if (!from || !to) throw new DomainError('NOT_FOUND', 'Revision package not found.', 404);
    const items: RevisionPackageComparison['items'] = [];
    const unmatchedAfter = new Set(to.luminaireSnapshot.map((_, index) => index));
    for (const previous of from.luminaireSnapshot) {
      let nextIndex = previous.luminaireId
        ? to.luminaireSnapshot.findIndex(
            (candidate, index) =>
              unmatchedAfter.has(index) &&
              candidate.luminaireId?.toLowerCase() === previous.luminaireId?.toLowerCase(),
          )
        : -1;
      if (nextIndex < 0) {
        nextIndex = to.luminaireSnapshot.findIndex(
          (candidate, index) =>
            unmatchedAfter.has(index) &&
            normalizeLuminaireTag(candidate.tag) === normalizeLuminaireTag(previous.tag) &&
            (!previous.luminaireId || !candidate.luminaireId),
        );
      }
      if (nextIndex < 0) {
        items.push({ tag: previous.tag, status: 'Removed', changes: [] });
        continue;
      }
      unmatchedAfter.delete(nextIndex);
      const next = to.luminaireSnapshot[nextIndex]!;
      const fields = new Set([...Object.keys(previous.values), ...Object.keys(next.values)]);
      const changes = [...fields].flatMap((fieldKey) => {
        const beforeValue = previous.values[fieldKey] ?? '';
        const afterValue = next.values[fieldKey] ?? '';
        return String(beforeValue) === String(afterValue)
          ? []
          : [{ fieldKey, before: beforeValue, after: afterValue }];
      });
      if (changes.length) items.push({ tag: next.tag, status: 'Changed', changes });
    }
    for (const index of unmatchedAfter) {
      items.push({ tag: to.luminaireSnapshot[index]!.tag, status: 'Added', changes: [] });
    }
    items.sort((left, right) => left.tag.localeCompare(right.tag, undefined, { numeric: true }));
    return {
      fromPackageId,
      toPackageId,
      added: items.filter((item) => item.status === 'Added').length,
      removed: items.filter((item) => item.status === 'Removed').length,
      changed: items.filter((item) => item.status === 'Changed').length,
      items,
    };
  }

  // ---------------------------------------------------------------------------
  // P2.6B1 — Workflow history + Revision Cycle persistence primitives
  //
  // Transaction-neutral by design: these write methods execute on the shared
  // DatabaseSync handle but NEVER begin/commit/rollback. B2 owns the outer
  // BEGIN IMMEDIATE ... COMMIT transaction that also mutates app_state, so
  // individual inserts must not commit independently. Reads execute normally.
  // ---------------------------------------------------------------------------

  public getWorkflowTransition(transitionId: string): WorkflowTransitionRecord | null {
    const row = this.database
      .prepare('SELECT * FROM workflow_transitions WHERE transition_id = ?')
      .get(transitionId) as Row | undefined;
    return row ? transitionFromRow(row) : null;
  }

  public listWorkflowTransitions(projectId: string): WorkflowTransitionRecord[] {
    const rows = this.database
      .prepare('SELECT * FROM workflow_transitions WHERE project_id = ? ORDER BY sequence ASC')
      .all(projectId) as Row[];
    return rows.map(transitionFromRow);
  }

  public insertWorkflowTransition(record: WorkflowTransitionRecord): WorkflowTransitionRecord {
    assertValidWorkflowTransitionRecord(record);
    this.database
      .prepare(
        `INSERT INTO workflow_transitions
         (transition_id, project_id, sequence, from_status, to_status, occurred_at,
          actor_id, reason, revision_cycle_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.transitionId,
        record.projectId,
        record.sequence,
        record.fromStatus,
        record.toStatus,
        record.occurredAt,
        record.actorId,
        record.reason,
        record.revisionCycleId,
      );
    return record;
  }

  public getRevisionCycle(revisionCycleId: string): RevisionCycle | null {
    const row = this.database
      .prepare('SELECT * FROM revision_cycles WHERE revision_cycle_id = ?')
      .get(revisionCycleId) as Row | undefined;
    return row ? cycleFromRow(row) : null;
  }

  public listRevisionCycles(projectId: string): RevisionCycle[] {
    const rows = this.database
      .prepare('SELECT * FROM revision_cycles WHERE project_id = ? ORDER BY cycle_number ASC')
      .all(projectId) as Row[];
    return rows.map(cycleFromRow);
  }

  public getOpenRevisionCycle(projectId: string): RevisionCycle | null {
    const row = this.database
      .prepare("SELECT * FROM revision_cycles WHERE project_id = ? AND status = 'Open'")
      .get(projectId) as Row | undefined;
    return row ? cycleFromRow(row) : null;
  }

  public insertRevisionCycle(cycle: RevisionCycle): RevisionCycle {
    assertValidRevisionCycle(cycle);
    this.database
      .prepare(
        `INSERT INTO revision_cycles
         (revision_cycle_id, project_id, cycle_number, status, opened_at,
          opened_by_transition_id, feedback_summary, work_started_at,
          returned_to_client_at, cancelled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cycle.revisionCycleId,
        cycle.projectId,
        cycle.cycleNumber,
        cycle.status,
        cycle.openedAt,
        cycle.openedByTransitionId,
        cycle.feedbackSummary,
        cycle.workStartedAt,
        cycle.returnedToClientAt,
        cycle.cancelledAt,
      );
    return cycle;
  }

  /**
   * Minimal transaction-neutral lifecycle-row update primitive for B2.
   * Persists a fully validated canonical cycle row (business lifecycle
   * transitions are validated by B2 before calling). No generic arbitrary-field
   * patch, no delete, and terminal states are not exposed for generic mutation.
   */
  public persistRevisionCycleLifecycle(cycle: RevisionCycle): RevisionCycle {
    assertValidRevisionCycle(cycle);
    this.database
      .prepare(
        `UPDATE revision_cycles SET
          status = ?, feedback_summary = ?, work_started_at = ?,
          returned_to_client_at = ?, cancelled_at = ?
        WHERE revision_cycle_id = ?`,
      )
      .run(
        cycle.status,
        cycle.feedbackSummary,
        cycle.workStartedAt,
        cycle.returnedToClientAt,
        cycle.cancelledAt,
        cycle.revisionCycleId,
      );
    return cycle;
  }

  // ---------------------------------------------------------------------------
  // P2.8A — Personal WorkSession persistence primitives
  //
  // Transaction-neutral by design: these write methods execute on the shared
  // DatabaseSync handle but NEVER begin/commit/rollback. The Personal
  // WorkSession coordinator owns the outer BEGIN IMMEDIATE ... COMMIT
  // transaction, so individual inserts/updates must not commit independently.
  // Reads execute normally and never mutate state.
  // ---------------------------------------------------------------------------

  /** Constant non-null active key shared by every active WorkSession row. */
  public static readonly ACTIVE_SESSION_KEY = 1;
  private sessionWithAttribution(row: Row): WorkSession {
    const session = workSessionFromRow(row);
    const attribution = new WorkSessionAttributionStore(this.database).read(session.id);
    return attribution ? { ...session, attribution } : session;
  }

  /** Returns the single globally-active WorkSession, or null when none is active. */
  public getActiveWorkSession(): WorkSession | null {
    const row = this.database
      .prepare('SELECT * FROM work_sessions WHERE active_key IS NOT NULL LIMIT 1')
      .get() as Row | undefined;
    return row ? this.sessionWithAttribution(row) : null;
  }

  /** Returns a project's WorkSessions, newest first. Reads never mutate state. */
  public listWorkSessions(projectId: string): WorkSession[] {
    const rows = this.database
      .prepare('SELECT * FROM work_sessions WHERE project_id = ? ORDER BY started_at DESC')
      .all(projectId) as Row[];
    return rows.map((row) => this.sessionWithAttribution(row));
  }

  /** Returns a single WorkSession by id, or null. */
  public getWorkSession(id: string): WorkSession | null {
    const row = this.database.prepare('SELECT * FROM work_sessions WHERE id = ?').get(id) as
      Row | undefined;
    return row ? this.sessionWithAttribution(row) : null;
  }

  /**
   * Inserts a new active WorkSession row. The caller MUST be inside
   * runInTransaction. The global one-active partial UNIQUE index on active_key
   * is the database backstop: a second active row across any project throws.
   */
  public insertActiveWorkSession(session: WorkSession): WorkSession {
    assertValidWorkSession(session);
    if (session.endedAt !== null) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'insertActiveWorkSession requires an active (endedAt null) session.',
        400,
      );
    }
    this.database
      .prepare(
        `INSERT INTO work_sessions
         (id, project_id, started_at, ended_at, paused_at, accumulated_paused_ms, active_key, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, ?, ?)`,
      )
      .run(
        session.id,
        session.projectId,
        session.startedAt,
        PersonalWorkspaceStore.ACTIVE_SESSION_KEY,
        session.createdAt,
      );
    if (session.attribution)
      new WorkSessionAttributionStore(this.database).save(
        session.id,
        session.attribution,
        session.createdAt,
      );
    return session;
  }

  /**
   * Atomically closes an active WorkSession by setting endedAt and releasing
   * the active key. The caller MUST be inside runInTransaction. Returns the
   * completed session. A repeated stop is deterministic: if the row is already
   * ended, the existing endedAt is preserved (no second end is fabricated).
   *
   * If the session is PAUSED (pausedAt set), the open paused interval
   * [pausedAt, endedAt] is first accumulated into accumulated_paused_ms and
   * paused_at is cleared, so the paused minutes never count as active work.
   */
  public closeActiveWorkSession(id: string, endedAt: string): WorkSession {
    const existing = this.getWorkSession(id);
    if (!existing) {
      throw new DomainError('NOT_FOUND', 'Work session not found.', 404);
    }
    if (existing.endedAt !== null) {
      // Idempotent repeated stop: return the already-completed session.
      return existing;
    }
    if (existing.pausedAt !== null) {
      const pausedDelta = Math.max(0, Date.parse(endedAt) - Date.parse(existing.pausedAt));
      this.database
        .prepare(
          `UPDATE work_sessions
           SET ended_at = ?, paused_at = NULL,
               accumulated_paused_ms = accumulated_paused_ms + ?,
               active_key = NULL
           WHERE id = ?`,
        )
        .run(endedAt, pausedDelta, id);
      return {
        ...existing,
        pausedAt: null,
        endedAt,
        accumulatedPausedMs: existing.accumulatedPausedMs + pausedDelta,
      };
    }
    this.database
      .prepare('UPDATE work_sessions SET ended_at = ?, active_key = NULL WHERE id = ?')
      .run(endedAt, id);
    return { ...existing, endedAt };
  }

  /**
   * Pauses the active WorkSession (RUNNING -> PAUSED). The caller MUST be
   * inside runInTransaction. Requires the session to be RUNNING (pausedAt
   * null); otherwise throws a typed 409 INVALID_STATE. Returns the same
   * WorkSession UUID with pausedAt set.
   */
  public pauseActiveWorkSession(id: string, pausedAt: string): WorkSession {
    const existing = this.getWorkSession(id);
    if (!existing) {
      throw new DomainError('NOT_FOUND', 'Work session not found.', 404);
    }
    if (existing.endedAt !== null) {
      throw new DomainError('CONFLICT', 'Cannot pause a completed work session.', 409);
    }
    if (existing.pausedAt !== null) {
      throw new DomainError('CONFLICT', 'Work session is already paused.', 409);
    }
    this.database.prepare('UPDATE work_sessions SET paused_at = ? WHERE id = ?').run(pausedAt, id);
    return { ...existing, pausedAt };
  }

  /**
   * Resumes a PAUSED WorkSession (PAUSED -> RUNNING). The caller MUST be
   * inside runInTransaction. Requires the session to be PAUSED (pausedAt set);
   * otherwise throws a typed 409 INVALID_STATE. Accumulates the open paused
   * interval into accumulated_paused_ms and clears paused_at. Returns the same
   * WorkSession UUID in RUNNING state.
   */
  public resumeActiveWorkSession(id: string, resumedAt: string): WorkSession {
    const existing = this.getWorkSession(id);
    if (!existing) {
      throw new DomainError('NOT_FOUND', 'Work session not found.', 404);
    }
    if (existing.endedAt !== null) {
      throw new DomainError('CONFLICT', 'Cannot resume a completed work session.', 409);
    }
    if (existing.pausedAt === null) {
      throw new DomainError('CONFLICT', 'Work session is not paused.', 409);
    }
    const pausedDelta = Math.max(0, Date.parse(resumedAt) - Date.parse(existing.pausedAt));
    this.database
      .prepare(
        `UPDATE work_sessions
         SET paused_at = NULL, accumulated_paused_ms = accumulated_paused_ms + ?
         WHERE id = ?`,
      )
      .run(pausedDelta, id);
    return {
      ...existing,
      pausedAt: null,
      accumulatedPausedMs: existing.accumulatedPausedMs + pausedDelta,
    };
  }

  /**
   * P2.6B2A — synchronous durable transaction boundary on the shared connection.
   *
   * Runs `fn` inside a single BEGIN IMMEDIATE ... COMMIT transaction and ROLLBACK
   * on any thrown error. The whole body executes synchronously and non-yielding
   * on the caller's turn of the Node event loop, so no unrelated work can enter
   * the transaction on this connection. The caller is responsible for keeping
   * `fn` synchronous.
   */
  public runInTransaction<T>(fn: () => T): T {
    // Asset admission may participate in a larger project save. A savepoint
    // retains the outer transaction's atomicity without committing it early.
    const savepoint = this.database.isTransaction
      ? `nested_${randomUUID().replaceAll('-', '')}`
      : null;
    this.database.exec(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.database.exec(savepoint ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      if (savepoint) {
        this.database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } else this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * P2.6B2A — allocates the next per-project transition sequence inside the
   * open transaction (caller MUST be inside runInTransaction). The committed
   * UNIQUE(project_id, sequence) constraint is the backstop; no allocation
   * ever happens outside the transaction.
   */
  public nextWorkflowTransitionSequence(projectId: string): number {
    const row = this.database
      .prepare(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM workflow_transitions WHERE project_id = ?',
      )
      .get(projectId) as { next: number };
    return Number(row.next);
  }

  /**
   * P2.6B2B — allocates the next project-local cycle number inside the open
   * transaction (caller MUST be inside runInTransaction). Uses MAX(cycle_number)
   * + 1 so cancelled cycles keep their numbers and numbers are never reused.
   * Never exposed as a general standalone allocation API.
   */
  public nextCycleNumber(projectId: string): number {
    const row = this.database
      .prepare(
        'SELECT COALESCE(MAX(cycle_number), 0) + 1 AS next FROM revision_cycles WHERE project_id = ?',
      )
      .get(projectId) as { next: number };
    return Number(row.next);
  }

  /**
   * P2.6B2A — exposes the shared DatabaseSync handle to the Personal workflow
   * coordinator so it can run app_state writes and history inserts atomically.
   * Never exposed to route/UI callers; the coordinator is the only consumer.
   */
  /** Exact Project root lookup for canonical reconciliation; this performs no directory scan. */
  public getProjectFolderPath(projectId: string): string | null {
    const row = this.database
      .prepare('SELECT folder_path FROM project_workspaces WHERE project_id = ?')
      .get(projectId) as { folder_path?: unknown } | undefined;
    return typeof row?.folder_path === 'string' && row.folder_path ? row.folder_path : null;
  }

  public getSharedDatabase(): DatabaseSyncInstance {
    return this.database;
  }

  private requireWorkspace(projectId: string): Row {
    const row = this.database
      .prepare('SELECT * FROM project_workspaces WHERE project_id = ?')
      .get(projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Project workspace is not initialized.', 404);
    return row;
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some((item) => item.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private backfillLuminaireAssetVersions(): void {
    const observedAt = new Date().toISOString();
    const rows = this.database
      .prepare(
        'SELECT id, project_id, datasheet_path, image_path FROM project_luminaires ORDER BY project_id, id',
      )
      .all() as Array<{
      id: string;
      project_id: string;
      datasheet_path: string;
      image_path: string;
    }>;
    for (const row of rows) {
      this.appendCompatibilityAssetVersion(
        row.project_id,
        row.id,
        'Datasheet',
        row.datasheet_path,
        observedAt,
        undefined,
        false,
        true,
      );
      this.appendCompatibilityAssetVersion(
        row.project_id,
        row.id,
        'ProductImage',
        row.image_path,
        observedAt,
        undefined,
        false,
        true,
      );
    }
  }

  private appendCompatibilityAssetVersion(
    projectId: string,
    luminaireId: string,
    assetType: LuminaireAssetType,
    rawFilePath: string,
    attachedAt: string,
    requestActor?: AppUser,
    forceNew = false,
    backfilled = false,
  ): LuminaireAssetVersion | null {
    const filePath = rawFilePath.trim();
    if (!filePath) return null;
    const latest = this.database
      .prepare(
        `SELECT * FROM luminaire_asset_versions
         WHERE project_id = ? AND luminaire_id = ? AND asset_type = ?
         ORDER BY version_sequence DESC LIMIT 1`,
      )
      .get(projectId, luminaireId, assetType) as Row | undefined;
    if (!forceNew && latest && String(latest.file_path).trim() === filePath) {
      return luminaireAssetVersionFromRow(latest);
    }
    const mimeType = forceNew
      ? assetMimeType(assetType, filePath)
      : assetMimeTypeForLegacy(assetType, filePath);
    let sizeBytes: number | null = null;
    let fileHash: string | null = null;
    try {
      if (existsSync(filePath)) {
        const stats = statSync(filePath);
        if (stats.isFile()) sizeBytes = stats.size;
        // Server-side SHA-256 hash authority (PACKAGES-E2E-05F). Computed at
        // attach time from the real on-disk bytes; never trusts a client hash.
        fileHash = sha256FileSync(filePath);
      }
    } catch {
      sizeBytes = null;
      fileHash = null;
    }
    const next = latest ? Number(latest.version_sequence) + 1 : 1;
    const id = randomUUID();
    const values = [
      id,
      projectId,
      luminaireId,
      assetType,
      next,
      filePath,
      path.basename(filePath.replaceAll('\\', '/')),
      mimeType,
      sizeBytes,
      fileHash,
      backfilled ? 1 : 0,
      attachedAt,
      requestActor?.id ?? null,
      requestActor?.displayName ?? null,
    ] as const;
    const hasManagedLocator = (
      this.database.prepare('PRAGMA table_info(luminaire_asset_versions)').all() as Row[]
    ).some((column) => column.name === 'locator_kind');
    if (hasManagedLocator) {
      this.database
        .prepare(
          `INSERT INTO luminaire_asset_versions
           (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
            mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
            attached_by_name_snapshot, locator_kind, locator_value,
            source_library_asset_version_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LEGACY_PATH', ?, NULL)`,
        )
        .run(...values, filePath);
    } else {
      this.database
        .prepare(
          `INSERT INTO luminaire_asset_versions
         (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
          mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
          attached_by_name_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...values);
    }
    return luminaireAssetVersionFromRow(
      this.database.prepare('SELECT * FROM luminaire_asset_versions WHERE id = ?').get(id) as Row,
    );
  }

  private appendManagedAssetVersion(
    projectId: string,
    luminaireId: string,
    assetType: LuminaireAssetType,
    managed: ManagedProjectLuminaireAssetInput,
    attachedAt: string,
    requestActor: AppUser,
  ): LuminaireAssetVersion {
    const latest = this.database
      .prepare(
        `SELECT version_sequence FROM luminaire_asset_versions
         WHERE project_id = ? AND luminaire_id = ? AND asset_type = ?
         ORDER BY version_sequence DESC LIMIT 1`,
      )
      .get(projectId, luminaireId, assetType) as { version_sequence?: unknown } | undefined;
    const next = latest ? Number(latest.version_sequence) + 1 : 1;
    const values = [
      managed.assetVersionId,
      projectId,
      luminaireId,
      assetType,
      next,
      managed.absolutePath,
      managed.fileName,
      managed.mimeType,
      managed.sizeBytes,
      managed.contentHash,
      attachedAt,
      requestActor.id,
      requestActor.displayName,
    ] as const;
    const hasManagedLocator = (
      this.database.prepare('PRAGMA table_info(luminaire_asset_versions)').all() as Row[]
    ).some((column) => column.name === 'locator_kind');
    if (hasManagedLocator) {
      this.database
        .prepare(
          `INSERT INTO luminaire_asset_versions
           (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
            mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
            attached_by_name_snapshot, locator_kind, locator_value, source_library_asset_version_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'DATA_ROOT_RELATIVE', ?, NULL)`,
        )
        .run(...values, managed.locatorValue);
    } else {
      this.database
        .prepare(
          `INSERT INTO luminaire_asset_versions
           (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
            mime_type, size_bytes, file_hash, backfilled, attached_at, attached_by_id,
            attached_by_name_snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(...values);
    }
    return luminaireAssetVersionFromRow(
      this.database
        .prepare('SELECT * FROM luminaire_asset_versions WHERE id = ?')
        .get(managed.assetVersionId) as Row,
    );
  }

  private touch(projectId: string, updatedAt: string): void {
    this.database
      .prepare('UPDATE project_workspaces SET updated_at = ? WHERE project_id = ?')
      .run(updatedAt, projectId);
  }

  private ensureColumns(projectId: string, outputType: string, columns: OutputColumn[]): void {
    const count = this.database
      .prepare(
        'SELECT COUNT(*) AS count FROM project_output_columns WHERE project_id = ? AND output_type = ?',
      )
      .get(projectId, outputType) as { count: number };
    if (!count.count) this.replaceColumns(projectId, outputType, columns);
  }

  private replaceColumns(projectId: string, outputType: string, columns: OutputColumn[]): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare('DELETE FROM project_output_columns WHERE project_id = ? AND output_type = ?')
        .run(projectId, outputType);
      const statement = this.database.prepare(`
        INSERT INTO project_output_columns
        (project_id, output_type, field_key, header, visible, sort_order, width,
         compare_in_revision, required_for_issue, internal_only)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      columns.forEach((column) =>
        statement.run(
          projectId,
          outputType,
          column.fieldKey,
          column.header,
          column.visible ? 1 : 0,
          column.sortOrder,
          column.width,
          column.compareInRevision ? 1 : 0,
          column.requiredForIssue ? 1 : 0,
          column.internalOnly ? 1 : 0,
        ),
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private getLightingPackage(
    projectId: string,
    inputMode: LuminaireInputMode,
  ): ProjectLightingPackage {
    const rows = this.database
      .prepare(
        'SELECT * FROM project_output_columns WHERE project_id = ? ORDER BY output_type, sort_order',
      )
      .all(projectId) as Row[];
    const convert = (type: string): OutputColumn[] =>
      rows
        .filter((row) => row.output_type === type)
        .map((row) => ({
          fieldKey: String(row.field_key),
          header: String(row.header),
          visible: Boolean(row.visible),
          sortOrder: Number(row.sort_order),
          width: Number(row.width ?? 140),
          compareInRevision: Boolean(row.compare_in_revision ?? 1),
          requiredForIssue: Boolean(row.required_for_issue ?? 0),
          internalOnly: Boolean(row.internal_only ?? 0),
        }));
    const workspace = this.requireWorkspace(projectId);
    return {
      projectId,
      inputMode,
      pdfPaperSize: String(
        workspace.pdf_paper_size ?? 'Auto',
      ) as ProjectLightingPackage['pdfPaperSize'],
      scheduleColumns: convert('schedule'),
      boqColumns: convert('boq'),
      updatedAt: String(workspace.updated_at),
    };
  }

  private assertUniqueLuminaireTag(
    projectId: string,
    tag: string,
    excludedLuminaireId?: string,
  ): void {
    const normalizedTag = normalizeLuminaireTag(tag);
    const collision = (
      this.database
        .prepare(
          'SELECT id, tag FROM project_luminaires WHERE project_id = ? ORDER BY created_at, rowid',
        )
        .all(projectId) as Array<{ id: string; tag: string }>
    ).find(
      (record) =>
        record.id !== excludedLuminaireId && normalizeLuminaireTag(record.tag) === normalizedTag,
    );
    if (collision) {
      throw new DomainError('CONFLICT', duplicateLuminaireTagMessage(collision.tag), 409, {
        field: 'tag',
        normalizedTag,
        projectId,
      });
    }
  }

  /**
   * Updates an existing Luminaire row in place, scoped by BOTH the internal
   * Luminaire UUID and the owning project UUID. This is a true SQL UPDATE, not
   * a REPLACE (which would behave as DELETE + INSERT and break row/entity
   * continuity for future FK-backed children such as datasheet, master-library,
   * technical-document, and review relations).
   *
   * The row's id, project_id, and created_at are never rewritten, so the
   * internal UUID remains one stable entity throughout the project lifecycle.
   * updated_at is refreshed on every edit.
   *
   * Fails closed: if zero rows match the (id, project_id) scope the caller's
   * not-found / invalid-ownership semantics are preserved by throwing. This
   * method never silently inserts a missing row and never upserts.
   */
  private updateLuminaireRow(
    id: string,
    projectId: string,
    input: LuminaireRecordInput,
    createdAt: string,
    updatedAt: string,
    expectedRowVersion: number,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE project_luminaires SET
      tag = ?, category = ?, image_path = ?, description = ?, manufacturer = ?, model = ?,
      product_type = ?, variant_label = ?, ordering_code = ?,
      wattage = ?, lumens = ?, light_color = ?, cri = ?, beam_angle = ?, ip_rating = ?,
      mounting = ?, cutout = ?, driver = ?, control = ?, emergency = ?, datasheet_path = ?,
      location = ?, unit = ?, quantity = ?, notes = ?, source_name = ?, dimensions = ?,
      body_color_finish = ?, created_at = ?, row_version = row_version + 1, updated_at = ?
    WHERE id = ? AND project_id = ? AND row_version = ?`,
      )
      .run(
        input.tag,
        input.category,
        input.imagePath,
        input.description,
        input.manufacturer,
        input.model,
        input.productType ?? '',
        input.variantLabel ?? '',
        input.orderingCode ?? '',
        input.wattage,
        input.lumens,
        input.lightColor,
        input.cri,
        input.beamAngle,
        input.ipRating,
        input.mounting,
        input.cutout,
        input.driver,
        input.control,
        input.emergency,
        input.datasheetPath,
        input.location,
        input.unit,
        input.quantity,
        input.notes,
        input.sourceName,
        input.dimensions,
        input.bodyColorFinish,
        createdAt,
        updatedAt,
        id,
        projectId,
        expectedRowVersion,
      );
    if (result.changes !== 1) {
      throw new DomainError('CONFLICT', 'Luminaire changed before the update completed.', 409);
    }
  }

  private getLuminaire(id: string, projectId: string): LuminaireRecord {
    const row = this.database
      .prepare('SELECT * FROM project_luminaires WHERE id = ? AND project_id = ?')
      .get(id, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Luminaire not found.', 404);
    return luminaireFromRow(row);
  }
}
