import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { PRODUCTION_SCHEMA_TARGET_VERSION } from '../infrastructure/migration/registry/production-migration-registry.js';
import { CanonicalOutputRegistryStore } from '../infrastructure/output-registry/CanonicalOutputRegistryStore.js';
import { IssueHistoryService } from '../infrastructure/output-registry/IssueHistoryService.js';
import { PackageReproducibilityService } from '../infrastructure/output-registry/PackageReproducibilityService.js';
import { canonicalPackageManifestSchema } from '../infrastructure/output-registry/CanonicalIssuePackageService.js';
import {
  GOLDEN_UAT_CRM_REFERENCE,
  GOLDEN_UAT_IDEMPOTENCY_KEY,
  GOLDEN_UAT_PROJECT_NAME,
} from './golden-uat-types.js';
import {
  GOLDEN_V19_IDS,
  GOLDEN_V19_INTERNAL_NOTE,
  GOLDEN_V19_PROJECT_CODE,
  GOLDEN_V19_PROJECT_ID,
  GOLDEN_V19_PURPOSE,
  GOLDEN_V19_REUSE_REASON,
  goldenV19GeneratedOutputFiles,
  goldenV19SourceFiles,
  type GoldenV19FixtureFile,
  type GoldenV19OwnershipClass,
} from './golden-v19-fixture.js';
import { REVISION_DELETE_UAT_TEST_PROJECT_ID } from '../scripts/revision-delete-uat-preparer.js';
import { classifyGoldenV19State } from './golden-v19-upgrade.js';
import {
  inspectGoldenV19XlsxSemantics,
  type GoldenV19XlsxKind,
} from './golden-v19-xlsx-semantics.js';

export type GoldenV19VerificationStatus =
  'PASS' | 'MISSING' | 'CONFLICT' | 'HASH_MISMATCH' | 'IDENTITY_MISMATCH' | 'SCHEMA_MISMATCH';

export interface GoldenV19VerificationCheck {
  code: string;
  status: GoldenV19VerificationStatus;
  detail: string;
}

export interface GoldenV19OwnedFileEvidence {
  logicalId: string;
  relativePath: string;
  role: string;
  sizeBytes: number;
  sha256: string;
  ownershipClass: GoldenV19OwnershipClass;
}

export interface GoldenV19VerificationReport {
  status: GoldenV19VerificationStatus;
  databasePath: string;
  sourceRoot: string;
  projectRoot: string | null;
  checks: GoldenV19VerificationCheck[];
  ownershipManifest: GoldenV19OwnedFileEvidence[];
}

export interface GoldenV19Plan {
  status: 'READY' | 'NO_CHANGES' | 'CONFLICT';
  operations: string[];
  checks: GoldenV19VerificationCheck[];
}

const statusRank: Record<GoldenV19VerificationStatus, number> = {
  PASS: 6,
  MISSING: 5,
  CONFLICT: 4,
  HASH_MISMATCH: 3,
  IDENTITY_MISMATCH: 2,
  SCHEMA_MISMATCH: 1,
};

function overall(checks: readonly GoldenV19VerificationCheck[]): GoldenV19VerificationStatus {
  return (
    [...checks].sort((left, right) => statusRank[left.status] - statusRank[right.status])[0]
      ?.status ?? 'PASS'
  );
}

function openReadOnly(databasePath: string): DatabaseSync {
  const uri = `${pathToFileURL(databasePath).href}?immutable=1`;
  return new DatabaseSync(uri, { readOnly: true });
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function projectState(db: DatabaseSync): Array<Record<string, unknown>> {
  const row = db.prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'").get() as
    { json_value?: unknown } | undefined;
  if (typeof row?.json_value !== 'string') return [];
  const parsed = JSON.parse(row.json_value) as { projects?: Array<Record<string, unknown>> };
  return parsed.projects ?? [];
}

function add(
  checks: GoldenV19VerificationCheck[],
  code: string,
  pass: boolean,
  failure: GoldenV19VerificationStatus,
  detail: string,
): void {
  checks.push({ code, status: pass ? 'PASS' : failure, detail });
}

function verifyFile(
  checks: GoldenV19VerificationCheck[],
  manifest: GoldenV19OwnedFileEvidence[],
  root: string,
  file: GoldenV19FixtureFile,
): void {
  const target = path.resolve(root, file.relativePath);
  manifest.push({
    logicalId: file.logicalId,
    relativePath: file.relativePath,
    role: file.role,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    ownershipClass: file.ownershipClass,
  });
  if (!contained(root, target)) {
    add(checks, `file:${file.logicalId}:containment`, false, 'CONFLICT', target);
    return;
  }
  if (!existsSync(target)) {
    add(checks, `file:${file.logicalId}`, false, 'MISSING', target);
    return;
  }
  const stats = lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    add(checks, `file:${file.logicalId}`, false, 'CONFLICT', 'Not an owned regular file.');
    return;
  }
  const actual = sha256(readFileSync(target));
  add(
    checks,
    `file:${file.logicalId}`,
    actual === file.sha256 && stats.size === file.sizeBytes,
    'HASH_MISMATCH',
    `${file.relativePath} size=${stats.size} sha256=${actual}`,
  );
}

interface InspectedGeneratedOutput {
  sha256: string;
  sizeBytes: number;
}

async function verifyGeneratedOutputFile(
  checks: GoldenV19VerificationCheck[],
  manifest: GoldenV19OwnedFileEvidence[],
  root: string,
  file: GoldenV19FixtureFile,
): Promise<InspectedGeneratedOutput | null> {
  const target = path.resolve(root, file.relativePath);
  if (!contained(root, target)) {
    add(checks, `file:${file.logicalId}:containment`, false, 'CONFLICT', target);
    return null;
  }
  if (!existsSync(target)) {
    add(checks, `file:${file.logicalId}`, false, 'MISSING', target);
    return null;
  }
  const stats = lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    add(checks, `file:${file.logicalId}`, false, 'CONFLICT', 'Not an owned regular file.');
    return null;
  }
  const bytes = readFileSync(target);
  const actualHash = sha256(bytes);
  manifest.push({
    logicalId: file.logicalId,
    relativePath: file.relativePath,
    role: file.role,
    sizeBytes: stats.size,
    sha256: actualHash,
    ownershipClass: file.ownershipClass,
  });
  const xlsxKind: GoldenV19XlsxKind | null =
    file.logicalId === 'output-schedule-xlsx'
      ? 'SCHEDULE'
      : file.logicalId === 'output-boq-xlsx'
        ? 'TECHNICAL_BOQ'
        : null;
  if (xlsxKind) {
    try {
      const semantics = await inspectGoldenV19XlsxSemantics(bytes, xlsxKind);
      add(
        checks,
        `file:${file.logicalId}`,
        semantics.matches,
        'HASH_MISMATCH',
        `semantic-sha256=${semantics.actualFingerprint}`,
      );
    } catch (error) {
      add(
        checks,
        `file:${file.logicalId}`,
        false,
        'HASH_MISMATCH',
        `XLSX parse failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    add(
      checks,
      `file:${file.logicalId}`,
      actualHash === file.sha256 && stats.size === file.sizeBytes,
      'HASH_MISMATCH',
      `${file.relativePath} size=${stats.size} sha256=${actualHash}`,
    );
  }
  return { sha256: actualHash, sizeBytes: stats.size };
}

function rawCount(
  db: DatabaseSync,
  sql: string,
  ...values: Array<string | number | bigint | null | Uint8Array>
): number {
  const row = db.prepare(sql).get(...values) as { total?: unknown } | undefined;
  return Number(row?.total ?? 0);
}

function dynamicFile(
  logicalId: string,
  root: string,
  absolutePath: string,
  role: string,
  ownershipClass: GoldenV19OwnershipClass,
): GoldenV19OwnedFileEvidence {
  if (!contained(root, absolutePath)) {
    throw new Error(`Fixture-owned path escapes project root: ${absolutePath}`);
  }
  const bytes = readFileSync(absolutePath);
  return {
    logicalId,
    relativePath: path.relative(root, absolutePath).replaceAll('\\', '/'),
    role,
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
    ownershipClass,
  };
}

/** Strict semantic verifier. It opens SQLite immutable/read-only and never starts production. */
export async function verifyGoldenV19Reality(
  databasePathInput: string,
  sourceRootInput: string,
): Promise<GoldenV19VerificationReport> {
  const databasePath = path.resolve(databasePathInput);
  const sourceRoot = path.resolve(sourceRootInput);
  const checks: GoldenV19VerificationCheck[] = [];
  const ownershipManifest: GoldenV19OwnedFileEvidence[] = [];
  if (!existsSync(databasePath)) {
    return {
      status: 'MISSING',
      databasePath,
      sourceRoot,
      projectRoot: null,
      checks: [{ code: 'database', status: 'MISSING', detail: databasePath }],
      ownershipManifest,
    };
  }
  const db = openReadOnly(databasePath);
  let projectRoot: string | null = null;
  try {
    const schema = Number(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
    add(
      checks,
      'schema',
      schema === PRODUCTION_SCHEMA_TARGET_VERSION,
      'SCHEMA_MISMATCH',
      `detected=v${schema} expected=v${PRODUCTION_SCHEMA_TARGET_VERSION}`,
    );
    const projects = projectState(db);
    const exact = projects.filter((project) => project.id === GOLDEN_V19_PROJECT_ID);
    const markers = projects.filter((project) => project.crmReference === GOLDEN_UAT_CRM_REFERENCE);
    const project = exact[0];
    const identityPass =
      exact.length === 1 &&
      markers.length === 1 &&
      markers[0]?.id === GOLDEN_V19_PROJECT_ID &&
      project?.projectCode === GOLDEN_V19_PROJECT_CODE &&
      project?.projectName === GOLDEN_UAT_PROJECT_NAME &&
      String(project.id) !== REVISION_DELETE_UAT_TEST_PROJECT_ID;
    add(
      checks,
      'golden-identity',
      identityPass,
      'IDENTITY_MISMATCH',
      'UUID/code/name/marker and explicit TEST rejection.',
    );
    const idempotency = db
      .prepare('SELECT project_id FROM idempotency_keys WHERE idempotency_key = ?')
      .get(GOLDEN_UAT_IDEMPOTENCY_KEY) as { project_id?: unknown } | undefined;
    add(
      checks,
      'fixture-idempotency',
      idempotency?.project_id === GOLDEN_V19_PROJECT_ID,
      'IDENTITY_MISMATCH',
      String(idempotency?.project_id ?? 'missing'),
    );
    const workspace = db
      .prepare('SELECT folder_path FROM project_workspaces WHERE project_id = ?')
      .get(GOLDEN_V19_PROJECT_ID) as { folder_path?: unknown } | undefined;
    projectRoot =
      typeof workspace?.folder_path === 'string' && workspace.folder_path
        ? path.resolve(workspace.folder_path)
        : null;
    add(
      checks,
      'project-root',
      projectRoot !== null,
      'MISSING',
      projectRoot ?? 'No connected business folder.',
    );

    for (const file of goldenV19SourceFiles())
      verifyFile(checks, ownershipManifest, sourceRoot, file);
    const generatedFiles = await goldenV19GeneratedOutputFiles();
    const generatedInspections = new Map<string, InspectedGeneratedOutput>();
    if (projectRoot) {
      for (const file of generatedFiles) {
        const inspected = await verifyGeneratedOutputFile(
          checks,
          ownershipManifest,
          projectRoot,
          file,
        );
        if (inspected) generatedInspections.set(file.logicalId, inspected);
      }
    }

    const registry = new CanonicalOutputRegistryStore(db, undefined, 'LEGACY_COMPATIBILITY');
    const revisions = registry.listRevisions(GOLDEN_V19_PROJECT_ID);
    const lasting = revisions.find(
      (revision) => revision.revisionId === GOLDEN_V19_IDS.lastingRevision,
    );
    add(
      checks,
      'revision:rev03',
      lasting?.revisionSequence === 3 &&
        lasting.revisionLabel === 'REV_03' &&
        lasting.lifecycleState === 'FINALIZED' &&
        lasting.provenanceClassification === 'CANONICAL' &&
        lasting.projectSnapshot?.canonicalOperation === 'MANUAL_DELIVERABLES',
      lasting ? 'CONFLICT' : 'MISSING',
      lasting
        ? JSON.stringify({
            id: lasting.revisionId,
            sequence: lasting.revisionSequence,
            lifecycle: lasting.lifecycleState,
          })
        : 'Missing lasting REV_03.',
    );
    add(
      checks,
      'revision:metadata',
      lasting?.purpose === GOLDEN_V19_PURPOSE && lasting.internalNote === GOLDEN_V19_INTERNAL_NOTE,
      lasting ? 'CONFLICT' : 'MISSING',
      'Purpose and private Internal Note remain canonical Revision-workspace metadata.',
    );
    const canonicalMax = Math.max(0, ...revisions.map((revision) => revision.revisionSequence));
    const compatibilityRow = db
      .prepare('SELECT MAX(revision_number) AS latest FROM project_revisions WHERE project_id = ?')
      .get(GOLDEN_V19_PROJECT_ID) as { latest?: unknown };
    const compatibilityMax = Number(compatibilityRow.latest ?? 0);
    add(
      checks,
      'current-revision-authority',
      canonicalMax === 3 && compatibilityMax === 2,
      'CONFLICT',
      `canonical=${canonicalMax} compatibility=${compatibilityMax}`,
    );
    add(
      checks,
      'rev03-no-compatibility',
      rawCount(
        db,
        'SELECT COUNT(*) AS total FROM project_revisions WHERE project_id = ? AND revision_number = 3',
        GOLDEN_V19_PROJECT_ID,
      ) === 0,
      'CONFLICT',
      'Compatibility projection must remain sparse at sequence 3.',
    );

    const expectedOutputs = new Map(generatedFiles.map((file) => [file.logicalId, file]));
    const outputExpectations = [
      [GOLDEN_V19_IDS.scheduleXlsx, 'output-schedule-xlsx', 'LuminaireSchedule', 'XLSX'],
      [GOLDEN_V19_IDS.schedulePdf, 'output-schedule-pdf', 'LuminaireSchedule', 'PDF'],
      [GOLDEN_V19_IDS.boqXlsx, 'output-boq-xlsx', 'TechnicalBoq', 'XLSX'],
      [GOLDEN_V19_IDS.boqPdf, 'output-boq-pdf', 'TechnicalBoq', 'PDF'],
    ] as const;
    for (const [id, logicalId, family, format] of outputExpectations) {
      let identityPass = false;
      let persistencePass = false;
      try {
        const output = registry.getOutput(id);
        const file = expectedOutputs.get(logicalId)!;
        const inspected = generatedInspections.get(logicalId);
        identityPass =
          output.projectId === GOLDEN_V19_PROJECT_ID &&
          output.revisionId === GOLDEN_V19_IDS.lastingRevision &&
          output.outputFamily === family &&
          output.outputFormat === format &&
          output.lifecycleState === 'FINALIZED' &&
          output.locatorValue === file.relativePath &&
          typeof output.contentHash === 'string' &&
          /^[a-f0-9]{64}$/.test(output.contentHash);
        persistencePass =
          Boolean(inspected) && output.contentHash === inspected?.sha256 && inspected.sizeBytes > 0;
      } catch {
        identityPass = false;
        persistencePass = false;
      }
      add(checks, `output:${logicalId}`, identityPass, 'MISSING', id);
      add(
        checks,
        `output:${logicalId}:persistence`,
        persistencePass,
        generatedInspections.has(logicalId) ? 'HASH_MISMATCH' : 'MISSING',
        id,
      );
    }

    const snapshots = registry.listDocumentSnapshotsForRevision(GOLDEN_V19_IDS.lastingRevision);
    const drawing = snapshots.find((item) => item.deliverableId === GOLDEN_V19_IDS.drawingSnapshot);
    const dialux = snapshots.find((item) => item.deliverableId === GOLDEN_V19_IDS.dialuxSnapshot);
    const datasheet = snapshots.find(
      (item) => item.deliverableId === GOLDEN_V19_IDS.datasheetSnapshot,
    );
    add(
      checks,
      'snapshot:drawing',
      drawing?.category === 'Drawing' && drawing.sourceType === 'ProjectDocument',
      drawing ? 'CONFLICT' : 'MISSING',
      drawing?.locatorValue ?? 'missing',
    );
    add(
      checks,
      'snapshot:dialux',
      dialux?.category === 'LuxReport' && dialux.sourceType === 'ProjectDocument',
      dialux ? 'CONFLICT' : 'MISSING',
      dialux?.locatorValue ?? 'missing',
    );
    add(
      checks,
      'snapshot:datasheet-provenance',
      datasheet?.category === 'Datasheet' &&
        datasheet.sourceType === 'LuminaireAssetVersion' &&
        Boolean(datasheet.sourceAssetVersionId),
      datasheet ? 'CONFLICT' : 'MISSING',
      datasheet?.sourceAssetVersionId ?? 'missing',
    );
    if (projectRoot) {
      for (const [logicalId, snapshot] of [
        ['snapshot-drawing', drawing],
        ['snapshot-dialux', dialux],
        ['snapshot-datasheet', datasheet],
      ] as const) {
        if (!snapshot) continue;
        const snapshotPath = path.resolve(projectRoot, snapshot.locatorValue);
        const present =
          contained(projectRoot, snapshotPath) &&
          existsSync(snapshotPath) &&
          lstatSync(snapshotPath).isFile();
        const actual = present ? sha256(readFileSync(snapshotPath)) : null;
        add(
          checks,
          `${logicalId}:bytes`,
          present &&
            actual === snapshot.contentHash &&
            lstatSync(snapshotPath).size === snapshot.sizeBytes,
          present ? 'HASH_MISMATCH' : 'MISSING',
          snapshot.locatorValue,
        );
        if (present) {
          ownershipManifest.push(
            dynamicFile(
              logicalId,
              projectRoot,
              snapshotPath,
              'Canonical immutable Revision snapshot copy',
              'REVISION_SNAPSHOT_COPY',
            ),
          );
        }
      }
    }
    if (datasheet?.sourceAssetVersionId) {
      const asset = db
        .prepare(
          'SELECT file_hash, size_bytes, file_path FROM luminaire_asset_versions WHERE id = ? AND project_id = ?',
        )
        .get(datasheet.sourceAssetVersionId, GOLDEN_V19_PROJECT_ID) as
        Record<string, unknown> | undefined;
      const expected = goldenV19SourceFiles().find(
        (file) => file.logicalId === 'source-datasheet',
      )!;
      add(
        checks,
        'datasheet:asset-version-hash',
        asset?.file_hash === expected.sha256 && Number(asset?.size_bytes) === expected.sizeBytes,
        asset ? 'HASH_MISMATCH' : 'MISSING',
        String(asset?.file_path ?? 'missing'),
      );
    }

    const operation = registry
      .listRevisionDeleteOperations(GOLDEN_V19_PROJECT_ID)
      .find((item) => item.operationId === GOLDEN_V19_IDS.deleteOperation);
    add(
      checks,
      'delete-reuse',
      operation?.revisionId === GOLDEN_V19_IDS.deletedRevision &&
        operation.revisionSequence === 3 &&
        operation.state === 'COMPLETED' &&
        operation.reusedByRevisionId === GOLDEN_V19_IDS.lastingRevision &&
        operation.reuseReason === GOLDEN_V19_REUSE_REASON &&
        String(operation.revisionId) !== String(operation.reusedByRevisionId),
      operation ? 'CONFLICT' : 'MISSING',
      operation
        ? JSON.stringify({ state: operation.state, reusedBy: operation.reusedByRevisionId })
        : 'missing',
    );
    add(
      checks,
      'delete:no-failed-recoverable',
      registry
        .listRevisionDeleteOperations(GOLDEN_V19_PROJECT_ID)
        .every((item) => item.state !== 'FAILED_RECOVERABLE'),
      'CONFLICT',
      'No Golden FAILED_RECOVERABLE operation may exist.',
    );
    if (projectRoot && operation) {
      for (const [index, item] of operation.artifactManifest.items.entries()) {
        const archivedPath = path.resolve(projectRoot, item.archiveDestination);
        const present =
          contained(projectRoot, archivedPath) &&
          existsSync(archivedPath) &&
          lstatSync(archivedPath).isFile();
        const actual = present ? sha256(readFileSync(archivedPath)) : null;
        add(
          checks,
          `delete:archive:${index}`,
          present && actual === item.contentHash,
          present ? 'HASH_MISMATCH' : 'MISSING',
          item.archiveDestination,
        );
        if (present) {
          ownershipManifest.push(
            dynamicFile(
              `archive-${index}`,
              projectRoot,
              archivedPath,
              'Revision Delete archived member',
              'REVISION_DELETE_ARCHIVED_MEMBER',
            ),
          );
        }
      }
    }

    const packages = registry.listIssuePackages(GOLDEN_V19_PROJECT_ID);
    const expectedPackages = [GOLDEN_V19_IDS.initialPackage, GOLDEN_V19_IDS.reissuePackage];
    for (const [index, packageId] of expectedPackages.entries()) {
      const issuePackage = packages.find((item) => item.packageId === packageId);
      add(
        checks,
        `package:${index + 1}:identity`,
        issuePackage?.revisionId === GOLDEN_V19_IDS.lastingRevision &&
          issuePackage.packageSequence === index + 1 &&
          issuePackage.lifecycleState === 'FINALIZED',
        issuePackage ? 'CONFLICT' : 'MISSING',
        packageId,
      );
      if (projectRoot && issuePackage?.manifestLocatorValue && issuePackage.artifactLocatorValue) {
        const manifestPath = path.resolve(projectRoot, issuePackage.manifestLocatorValue);
        const clientRoot = path.resolve(projectRoot, issuePackage.artifactLocatorValue);
        const parsed = canonicalPackageManifestSchema.parse(
          JSON.parse(readFileSync(manifestPath, 'utf8')),
        );
        const groups = new Set(
          parsed.deliverables.map((item) => item.packageRelativePath.split('/')[0]),
        );
        add(
          checks,
          `package:${index + 1}:groups`,
          [
            '01_LIGHTING_LAYOUT',
            '02_DIALUX_REPORT',
            '03_LUMINAIRE_SCHEDULE',
            '04_TECHNICAL_BOQ',
            '05_DATASHEETS',
          ].every((group) => groups.has(group)),
          'CONFLICT',
          [...groups].sort().join(', '),
        );
        add(
          checks,
          `package:${index + 1}:manifest-separation`,
          !contained(clientRoot, manifestPath),
          'CONFLICT',
          issuePackage.manifestLocatorValue,
        );
        ownershipManifest.push(
          dynamicFile(
            `package-${index + 1}-manifest`,
            projectRoot,
            manifestPath,
            'Internal canonical Package manifest',
            'INTERNAL_PACKAGE_MANIFEST',
          ),
        );
        for (const [memberIndex, member] of parsed.deliverables.entries()) {
          const memberPath = path.resolve(clientRoot, member.packageRelativePath);
          if (existsSync(memberPath)) {
            ownershipManifest.push(
              dynamicFile(
                `package-${index + 1}-member-${memberIndex}`,
                projectRoot,
                memberPath,
                'Client Package member materialization',
                'PACKAGE_MEMBER_MATERIALIZATION',
              ),
            );
          }
        }
      }
    }
    if (projectRoot) {
      const packageVerifier = new PackageReproducibilityService(
        registry,
        () => projectRoot,
        () => new Date('2026-08-12T10:00:00.000Z'),
      );
      for (const packageId of expectedPackages) {
        const verification = await packageVerifier.verify(GOLDEN_V19_PROJECT_ID, packageId);
        add(
          checks,
          `package:${packageId}:verification`,
          verification?.status === 'VERIFIED',
          verification ? 'HASH_MISMATCH' : 'MISSING',
          verification?.status ?? 'missing',
        );
      }
    }

    const history = new IssueHistoryService(registry).list(GOLDEN_V19_PROJECT_ID);
    const serializedHistory = JSON.stringify(history);
    add(
      checks,
      'issue-history',
      history.length === 2 &&
        history[0]?.package.packageId === GOLDEN_V19_IDS.reissuePackage &&
        history[1]?.package.packageId === GOLDEN_V19_IDS.initialPackage &&
        history.every((item) => item.revision.revisionId === GOLDEN_V19_IDS.lastingRevision) &&
        serializedHistory.includes(GOLDEN_V19_PURPOSE) &&
        !serializedHistory.includes('internalNote') &&
        !serializedHistory.includes(GOLDEN_V19_INTERNAL_NOTE),
      'CONFLICT',
      'Initial issue and reissue are ordered, purpose-safe, and private-note-free.',
    );
    const packageProjection = lasting
      ? {
          revisionId: lasting.revisionId,
          revisionSequence: lasting.revisionSequence,
          revisionLabel: lasting.revisionLabel,
          purpose: lasting.purpose,
          lifecycleState: lasting.lifecycleState,
          finalizedAt: lasting.finalizedAt,
          luminaireCount: lasting.luminaireSnapshot?.length ?? 0,
        }
      : null;
    const serializedProjection = JSON.stringify(packageProjection);
    add(
      checks,
      'package-revision-privacy',
      Boolean(packageProjection) &&
        serializedProjection.includes(GOLDEN_V19_PURPOSE) &&
        !serializedProjection.includes('internalNote') &&
        !serializedProjection.includes(GOLDEN_V19_INTERNAL_NOTE),
      packageProjection ? 'CONFLICT' : 'MISSING',
      serializedProjection,
    );
  } catch (error) {
    checks.push({
      code: 'verifier-exception',
      status: 'CONFLICT',
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    db.close();
  }
  return {
    status: overall(checks),
    databasePath,
    sourceRoot,
    projectRoot,
    checks,
    ownershipManifest,
  };
}

/** Read-only v19 upgrade plan. It never starts production or creates files. */
export async function planGoldenV19Reality(
  databasePath: string,
  sourceRoot: string,
): Promise<GoldenV19Plan> {
  const report = await verifyGoldenV19Reality(databasePath, sourceRoot);
  if (report.status === 'PASS')
    return { status: 'NO_CHANGES', operations: [], checks: report.checks };
  const db = openReadOnly(path.resolve(databasePath));
  try {
    const schema = Number(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    );
    const projects = projectState(db);
    const exact = projects.filter((project) => project.id === GOLDEN_V19_PROJECT_ID);
    const markers = projects.filter((project) => project.crmReference === GOLDEN_UAT_CRM_REFERENCE);
    const identityReady =
      schema === PRODUCTION_SCHEMA_TARGET_VERSION &&
      exact.length === 1 &&
      markers.length === 1 &&
      exact[0]?.projectCode === GOLDEN_V19_PROJECT_CODE &&
      exact[0]?.projectName === GOLDEN_UAT_PROJECT_NAME &&
      markers[0]?.id === GOLDEN_V19_PROJECT_ID;
    if (!identityReady) {
      return { status: 'CONFLICT', operations: [], checks: report.checks };
    }
    const registry = new CanonicalOutputRegistryStore(db, undefined, 'LEGACY_COMPATIBILITY');
    try {
      const state = classifyGoldenV19State(registry);
      // A database-complete state whose full verifier is not PASS is partial or
      // filesystem-conflicting; it must never fall through to READY.
      if (state === 'COMPLETE') {
        return { status: 'CONFLICT', operations: [], checks: report.checks };
      }
    } catch (error) {
      return {
        status: 'CONFLICT',
        operations: [],
        checks: [
          ...report.checks,
          {
            code: 'allocation-authority',
            status: 'CONFLICT',
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  } finally {
    db.close();
  }
  const conflictFiles = report.checks.filter(
    (check) =>
      check.code.startsWith('file:') && check.status !== 'PASS' && check.status !== 'MISSING',
  );
  if (conflictFiles.length > 0)
    return { status: 'CONFLICT', operations: [], checks: report.checks };
  return {
    status: 'READY',
    operations: [
      'Write exact fixture source bytes with hash-before-overwrite protection.',
      'Create and safely delete temporary canonical sequence-3 Revision through Safe Delete.',
      'Reuse sequence 3 through P2C-04 and create lasting deterministic REV_03.',
      'Attach metadata, mixed immutable Deliverables, and finalize REV_03 without compatibility projection.',
      'Create and verify initial Issue Package plus reissue on the same REV_03 UUID.',
    ],
    checks: report.checks,
  };
}
