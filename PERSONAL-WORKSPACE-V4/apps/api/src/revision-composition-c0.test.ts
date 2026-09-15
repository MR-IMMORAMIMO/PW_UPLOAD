/**
 * V4-REVISION-COMPOSITION-C0 — Revision Composition Durability & Reservation Safety.
 *
 * Proves the C0 foundation that C1 targeted generation will rely on:
 *
 *  F-0   a PREPARING MANUAL_DELIVERABLES Revision is a long-lived composed design
 *        draft and survives application restart as PREPARING;
 *  §3    composition-aware Output reconciliation: a hash-proven reservation is
 *        finalized, an unproven reservation is discarded, and neither fails the
 *        parent Revision, touches a DocumentSnapshot, or touches an unrelated
 *        FINALIZED Output;
 *  §4/§5 the narrow proof-guarded reservation-discard authority and every DB
 *        invariant that must reject;
 *  §7    owned-temp-only cleanup — a proven final artifact is never deleted;
 *  §8/§9 Resume Revision (FAILED_RECOVERABLE -> PREPARING) never emerges into
 *        another permanently unfinalizable draft;
 *  F-1   finalization requires physical presence for canonical GeneratedOutput
 *        Deliverables, symmetrically with DocumentSnapshots, without
 *        retroactively invalidating historically FINALIZED Revisions;
 *  §17   GENERATED_OUTPUTS and REGISTER_ONLY restart behavior is unchanged.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { createCanonicalOutputSchema } from '@scli/contracts';
import type {
  AppUser,
  CanonicalOutputRecord,
  CanonicalRevisionRecord,
  OutputFamily,
  Project,
} from '@scli/domain';
import { seedProjects, seedUserIds, seedUsers } from '@scli/test-data';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import {
  PRODUCTION_SCHEMA_TARGET_VERSION,
  PRODUCTION_V4_DDL,
  PRODUCTION_V13_DDL,
  PRODUCTION_V14_DDL,
  PRODUCTION_V15_DDL,
  applyV12IssueAuditColumns,
  applyV15SnapshotProvenanceColumn,
  applyV16SnapshotRebuild,
  applyV17RevisionDeleteTable,
} from './infrastructure/migration/registry/production-migration-registry';
import { CanonicalArtifactReconciler } from './infrastructure/output-registry/CanonicalArtifactReconciler';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';
import {
  outputTemporaryPath,
  resolveCanonicalArtifactPath,
  sha256File,
} from './infrastructure/output-registry/canonical-artifact-files';

const actor = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;

const stores: PersonalWorkspaceStore[] = [];
const temporaryRoots: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
  while (stores.length) stores.pop()?.close();
  while (temporaryRoots.length) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

interface Harness {
  root: string;
  projectRoot: string;
  store: PersonalWorkspaceStore;
  registry: CanonicalOutputRegistryStore;
  service: RevisionDeliverableService;
  project: Project;
  database: DatabaseSync;
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-composition-c0-'));
  temporaryRoots.push(root);
  const projectRoot = path.join(root, 'project');
  mkdirSync(projectRoot);
  const config = loadConfig({
    APP_MODE: 'mock',
    WORKSPACE_VARIANT: 'personal',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
  const store = new PersonalWorkspaceStore(config);
  stores.push(store);
  const project = structuredClone(seedProjects[0]!);
  store.initializeProject(
    project.id,
    ['LuminaireSchedule', 'TechnicalBoq'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
  store.setFolderPath(project.id, projectRoot);
  const database = store.getSharedDatabase();
  for (const statement of PRODUCTION_V4_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V13_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V14_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V15_DDL) database.exec(statement);
  applyV12IssueAuditColumns(database);
  applyV15SnapshotProvenanceColumn(database);
  applyV16SnapshotRebuild(database);
  applyV17RevisionDeleteTable(database);
  // Enforce referential integrity so a discard can never rely on FK laxity.
  database.exec('PRAGMA foreign_keys = ON');
  const registry = new CanonicalOutputRegistryStore(database, undefined, 'CANONICAL');
  registry.registerBuiltInTemplateVersions();
  const service = new RevisionDeliverableService(store, registry);
  return { root, projectRoot, store, registry, service, project, database };
}

function createReconciler(harness: Harness): CanonicalArtifactReconciler {
  return new CanonicalArtifactReconciler(harness.registry, (projectId) =>
    harness.store.getProjectFolderPath(projectId),
  );
}

async function createAppFor(harness: Harness): Promise<FastifyInstance> {
  const app = await createApp({
    config: loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    }),
    provider: new MockDataProvider(),
    personalStore: harness.store,
    canonicalOutputRegistry: harness.registry,
  });
  apps.push(app);
  return app;
}

function countRows(harness: Harness, table: string): number {
  const row = harness.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return Number(row.count);
}

/** A composed B0 design draft: CANONICAL + MANUAL_DELIVERABLES + PREPARING. */
function prepareManualRevision(harness: Harness): CanonicalRevisionRecord {
  return harness.service.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
  );
}

function baseProjectSnapshot(harness: Harness) {
  return {
    id: harness.project.id,
    projectCode: harness.project.projectCode,
    projectName: harness.project.projectName,
    clientName: harness.project.clientName,
    projectType: harness.project.projectType,
    status: harness.project.status,
    updatedAt: harness.project.updatedAt,
  };
}

/** A canonical Revision created by a non-composition operation authority. */
function createOperationRevision(
  harness: Harness,
  canonicalOperation: 'GENERATED_OUTPUTS' | 'REGISTER_ONLY',
): CanonicalRevisionRecord {
  return harness.registry.createRevision({
    projectId: harness.project.id,
    projectSnapshot: { ...baseProjectSnapshot(harness), canonicalOperation },
    luminaires: [],
    createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
  });
}

function reserveOutput(
  harness: Harness,
  revisionId: string,
  relativePath: string,
  outputFamily: OutputFamily = 'LuminaireSchedule',
  outputFormat = 'XLSX',
): CanonicalOutputRecord {
  return harness.registry.createOutput({
    revisionId,
    outputFamily,
    outputFormat,
    relativePath,
    contentHash: null,
    resolvedTemplate: harness.registry.resolveEffectiveTemplate(harness.project.id, outputFamily),
  });
}

function finalArtifactPath(harness: Harness, output: CanonicalOutputRecord): string {
  return resolveCanonicalArtifactPath(harness.projectRoot, output.locatorValue!);
}

/** Writes the real final artifact and persists its true SHA-256 (hash-proven). */
async function writeProvenArtifact(
  harness: Harness,
  output: CanonicalOutputRecord,
): Promise<string> {
  const finalPath = finalArtifactPath(harness, output);
  mkdirSync(path.dirname(finalPath), { recursive: true });
  writeFileSync(finalPath, `final-bytes:${output.outputId}`);
  harness.registry.setOutputContentHash(output.outputId, await sha256File(finalPath));
  return finalPath;
}

/** The outputId-keyed temp sidecar canonical generation owns for this Output. */
function writeOwnedTemporary(harness: Harness, output: CanonicalOutputRecord): string {
  const temporaryPath = outputTemporaryPath(finalArtifactPath(harness, output), output.outputId);
  mkdirSync(path.dirname(temporaryPath), { recursive: true });
  writeFileSync(temporaryPath, `temp-bytes:${output.outputId}`);
  return temporaryPath;
}

function addDocument(harness: Harness, relativePath: string, content: string) {
  const filePath = path.join(harness.projectRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return harness.store.operations.createDocument(harness.project.id, {
    category: 'Drawing',
    documentNumber: '',
    title: relativePath,
    revision: 'A',
    status: 'Working',
    filePath: relativePath,
    issuedTo: '',
    issueDate: null,
    notes: '',
  });
}

async function addSnapshot(harness: Harness, revisionId: string, relativePath: string) {
  const document = addDocument(harness, relativePath, `source:${relativePath}`);
  return await harness.service.createDocumentSnapshot(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    actor,
    revisionId,
    { sourceDocumentId: document.id },
  );
}

function snapshotArtifactPath(harness: Harness, snapshot: { locatorValue: string }): string {
  return resolveCanonicalArtifactPath(harness.projectRoot, snapshot.locatorValue);
}

// ---------------------------------------------------------------------------
// 2 — F-0 MANUAL REVISION RESTART SURVIVAL
// ---------------------------------------------------------------------------

describe('C0 F-0 — composed manual Revision restart survival', () => {
  it('1 + 2 + 3: a PREPARING MANUAL_DELIVERABLES Revision survives reconcile() with its snapshots and finalized Outputs intact', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const layout = await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    const dialux = await addSnapshot(harness, revision.revisionId, 'Drawings/DIALux.pdf');
    const finalized = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/done.xlsx');
    const finalizedPath = await writeProvenArtifact(harness, finalized);
    harness.registry.setOutputLifecycle(finalized.outputId, 'FINALIZED');
    const finalizedHash = harness.registry.getOutput(finalized.outputId).contentHash;

    const report = await createReconciler(harness).reconcile();

    // 1 — the composed draft is NOT an interrupted operation.
    const reconciled = harness.registry.getRevision(revision.revisionId);
    expect(reconciled.lifecycleState).toBe('PREPARING');
    expect(reconciled.failureReason).toBeNull();
    expect(report.failedRevisions).toBe(0);
    expect(report.discardedOutputReservations).toBe(0);
    expect(
      report.issues.filter(
        (issue) => issue.entityType === 'REVISION' && issue.entityId === revision.revisionId,
      ),
    ).toEqual([]);

    // 2 — DocumentSnapshots are untouched, rows and artifacts alike.
    const snapshots = harness.registry.listDocumentSnapshotsForRevision(revision.revisionId);
    expect(snapshots.map((item) => item.deliverableId).sort()).toEqual(
      [layout.deliverableId, dialux.deliverableId].sort(),
    );
    for (const snapshot of snapshots) {
      expect(existsSync(snapshotArtifactPath(harness, snapshot))).toBe(true);
    }

    // 3 — an existing FINALIZED Output keeps its lifecycle, hash and artifact.
    expect(harness.registry.getOutput(finalized.outputId)).toMatchObject({
      lifecycleState: 'FINALIZED',
      contentHash: finalizedHash,
    });
    expect(existsSync(finalizedPath)).toBe(true);

    // Restart is idempotent: a second startup pass changes nothing.
    const second = await createReconciler(harness).reconcile();
    expect(second).toMatchObject({
      finalizedOutputs: 0,
      failedOutputs: 0,
      discardedOutputReservations: 0,
      failedRevisions: 0,
    });
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
    expect(countRows(harness, 'revision_document_snapshots')).toBe(2);
    expect(countRows(harness, 'canonical_outputs')).toBe(1);
  });

  it('4: an interrupted GENERATED_OUTPUTS Revision still follows the previous recovery/failure behavior', async () => {
    const harness = createHarness();
    const revision = createOperationRevision(harness, 'GENERATED_OUTPUTS');
    const recovered = reserveOutput(harness, revision.revisionId, 'RECOVERY/REV_01/schedule.xlsx');
    const lost = reserveOutput(
      harness,
      revision.revisionId,
      'RECOVERY/REV_01/boq.xlsx',
      'TechnicalBoq',
    );
    const recoveredPath = await writeProvenArtifact(harness, recovered);
    const lostTemporary = writeOwnedTemporary(harness, lost);

    const report = await createReconciler(harness).reconcile();

    // Unchanged generated-operation semantics: prove-or-fail per Output and an
    // explicit identity-preserving retry for the Revision.
    expect(harness.registry.getOutput(recovered.outputId).lifecycleState).toBe('FINALIZED');
    expect(harness.registry.getOutput(lost.outputId).lifecycleState).toBe('FAILED_RECOVERABLE');
    const failedRevision = harness.registry.getRevision(revision.revisionId);
    expect(failedRevision.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(failedRevision.failureReason).toBe(
      'One or more canonical Revision Outputs require recovery attention.',
    );
    expect(report).toMatchObject({
      finalizedOutputs: 1,
      failedOutputs: 1,
      failedRevisions: 1,
      discardedOutputReservations: 0,
    });
    // No generated Output row is ever discarded by reconciliation.
    expect(countRows(harness, 'canonical_outputs')).toBe(2);
    expect(existsSync(recoveredPath)).toBe(true);
    expect(existsSync(lostTemporary)).toBe(true);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: lost.outputId, code: 'TEMP_ARTIFACT_REMAINS' }),
        expect.objectContaining({ entityId: revision.revisionId, code: 'RECOVERY_ATTENTION' }),
      ]),
    );
    expect(report.issues.some((issue) => issue.code === 'RESERVATION_DISCARDED')).toBe(false);
  });

  it('5: an interrupted REGISTER_ONLY Revision still becomes FAILED_RECOVERABLE for its own explicit retry', async () => {
    const harness = createHarness();
    const revision = createOperationRevision(harness, 'REGISTER_ONLY');

    const report = await createReconciler(harness).reconcile();

    const failed = harness.registry.getRevision(revision.revisionId);
    expect(failed.lifecycleState).toBe('FAILED_RECOVERABLE');
    expect(failed.failureReason).toBe(
      'Interrupted canonical Revision has no complete reserved Output set.',
    );
    expect(report).toMatchObject({ failedRevisions: 1, discardedOutputReservations: 0 });
    expect(countRows(harness, 'canonical_revisions')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3 — COMPOSITION-AWARE OUTPUT RECONCILIATION (R3 crash/restart safety)
// ---------------------------------------------------------------------------

describe('C0 composition-aware Output reconciliation', () => {
  it('6 + 8 + 9: a hash-proven composition reservation finalizes while the Revision stays PREPARING', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const snapshot = await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    const untouched = reserveOutput(
      harness,
      revision.revisionId,
      'DELIVERABLES/REV_01/existing.xlsx',
    );
    const untouchedPath = await writeProvenArtifact(harness, untouched);
    harness.registry.setOutputLifecycle(untouched.outputId, 'FINALIZED');
    const untouchedBefore = harness.registry.getOutput(untouched.outputId);
    const reservation = reserveOutput(
      harness,
      revision.revisionId,
      'DELIVERABLES/REV_01/schedule.xlsx',
    );
    const reservationPath = await writeProvenArtifact(harness, reservation);

    const report = await createReconciler(harness).reconcile();

    // 6 — proven artifact promoted through the existing proof authority.
    expect(harness.registry.getOutput(reservation.outputId).lifecycleState).toBe('FINALIZED');
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
    expect(report).toMatchObject({ finalizedOutputs: 1, discardedOutputReservations: 0 });
    expect(readFileSync(reservationPath, 'utf8')).toBe(`final-bytes:${reservation.outputId}`);

    // 8 — no DocumentSnapshot row or artifact is removed.
    expect(countRows(harness, 'revision_document_snapshots')).toBe(1);
    expect(existsSync(snapshotArtifactPath(harness, snapshot))).toBe(true);

    // 9 — the unrelated FINALIZED Output is byte-for-byte and row-for-row unchanged.
    expect(harness.registry.getOutput(untouched.outputId)).toEqual(untouchedBefore);
    expect(existsSync(untouchedPath)).toBe(true);
  });

  it('7 + 8 + 9 + 16: an unproven composition reservation is discarded with only its owned temp removed', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const snapshot = await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    const proven = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/existing.xlsx');
    const provenPath = await writeProvenArtifact(harness, proven);
    harness.registry.setOutputLifecycle(proven.outputId, 'FINALIZED');
    const provenTemporary = writeOwnedTemporary(harness, proven);
    const reservation = reserveOutput(
      harness,
      revision.revisionId,
      'DELIVERABLES/REV_01/schedule.xlsx',
    );
    const reservationTemporary = writeOwnedTemporary(harness, reservation);
    const strayPath = path.join(harness.projectRoot, 'DELIVERABLES', 'REV_01', 'unrelated.txt');
    writeFileSync(strayPath, 'unrelated-existing-file');

    const report = await createReconciler(harness).reconcile();

    // 7 — the reservation row is gone and the parent draft stays PREPARING.
    expect(() => harness.registry.getOutput(reservation.outputId)).toThrow(/not found/i);
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
    expect(report).toMatchObject({ discardedOutputReservations: 1, failedRevisions: 0 });
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'OUTPUT',
          entityId: reservation.outputId,
          code: 'RESERVATION_DISCARDED',
        }),
      ]),
    );

    // 16 — ONLY the discarded reservation's owned temp sidecar is removed.
    expect(existsSync(reservationTemporary)).toBe(false);
    expect(existsSync(provenTemporary)).toBe(true);
    expect(existsSync(provenPath)).toBe(true);
    expect(readFileSync(strayPath, 'utf8')).toBe('unrelated-existing-file');

    // 8 + 9 — snapshots and the unrelated FINALIZED Output survive.
    expect(countRows(harness, 'revision_document_snapshots')).toBe(1);
    expect(existsSync(snapshotArtifactPath(harness, snapshot))).toBe(true);
    expect(harness.registry.getOutput(proven.outputId).lifecycleState).toBe('FINALIZED');
  });

  it('17: an unproven reservation whose final path holds a file it cannot claim is discarded without deleting that file', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const reservation = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/boq.xlsx');
    const collisionPath = finalArtifactPath(harness, reservation);
    mkdirSync(path.dirname(collisionPath), { recursive: true });
    writeFileSync(collisionPath, 'pre-existing-unrelated-bytes');
    harness.registry.setOutputContentHash(reservation.outputId, 'a'.repeat(64));

    const report = await createReconciler(harness).reconcile();

    expect(() => harness.registry.getOutput(reservation.outputId)).toThrow(/not found/i);
    expect(report.discardedOutputReservations).toBe(1);
    // The file at the final path was never proven to be ours, so it stays.
    expect(readFileSync(collisionPath, 'utf8')).toBe('pre-existing-unrelated-bytes');
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
  });

  it('REV_12 crash scenario: targeted reservation loss leaves a finalizable composed draft after restart', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const layout = await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    const dialux = await addSnapshot(harness, revision.revisionId, 'Drawings/DIALux.pdf');
    // A targeted Schedule generation reserved two Outputs, then the app crashed:
    // one artifact had been proven and promoted, the other had not.
    const promoted = reserveOutput(
      harness,
      revision.revisionId,
      'DELIVERABLES/REV_01/schedule.xlsx',
    );
    await writeProvenArtifact(harness, promoted);
    const lost = reserveOutput(
      harness,
      revision.revisionId,
      'DELIVERABLES/REV_01/schedule.pdf',
      'LuminaireSchedule',
      'PDF',
    );
    harness.registry.setOutputLifecycle(
      lost.outputId,
      'FAILED_RECOVERABLE',
      'Injected targeted generation interruption.',
    );

    const report = await createReconciler(harness).reconcile();

    // A — the proven Output finalizes. B/C — the unproven reservation is gone.
    expect(harness.registry.getOutput(promoted.outputId).lifecycleState).toBe('FINALIZED');
    expect(() => harness.registry.getOutput(lost.outputId)).toThrow(/not found/i);
    expect(report).toMatchObject({ finalizedOutputs: 1, discardedOutputReservations: 1 });
    // D — the Revision remains PREPARING. E — snapshots remain.
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
    expect(harness.registry.listDocumentSnapshotsForRevision(revision.revisionId)).toHaveLength(2);
    expect(existsSync(snapshotArtifactPath(harness, layout))).toBe(true);
    expect(existsSync(snapshotArtifactPath(harness, dialux))).toBe(true);
    // No residue blocks the user: the draft can finalize immediately.
    await expect(
      harness.service.finalizeRevision(harness.project, revision.revisionId),
    ).resolves.toMatchObject({ lifecycleState: 'FINALIZED' });
  });
});

// ---------------------------------------------------------------------------
// 4 + 5 — DISCARD RESERVED OUTPUT AUTHORITY AND ITS DB GUARDS
// ---------------------------------------------------------------------------

describe('C0 discard reservation authority', () => {
  it('10: an unproven reservation under a valid MANUAL_DELIVERABLES PREPARING Revision may be discarded', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const preparing = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/a.xlsx');
    const failed = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/b.xlsx');
    harness.registry.setOutputLifecycle(failed.outputId, 'FAILED_RECOVERABLE', 'Injected failure.');

    expect(
      harness.registry.discardUnprovenOutputReservation({
        outputId: preparing.outputId,
        projectId: harness.project.id,
        revisionId: revision.revisionId,
      }),
    ).toMatchObject({ outputId: preparing.outputId, locatorValue: preparing.locatorValue });
    expect(
      harness.registry.discardUnprovenOutputReservation({
        outputId: failed.outputId,
        projectId: harness.project.id,
        revisionId: revision.revisionId,
      }),
    ).toMatchObject({ outputId: failed.outputId });

    expect(countRows(harness, 'canonical_outputs')).toBe(0);
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
  });

  it('11: a FINALIZED Output cannot be discarded', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const output = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/a.xlsx');
    await writeProvenArtifact(harness, output);
    harness.registry.setOutputLifecycle(output.outputId, 'FINALIZED');

    expect(() =>
      harness.registry.discardUnprovenOutputReservation({
        outputId: output.outputId,
        projectId: harness.project.id,
        revisionId: revision.revisionId,
      }),
    ).toThrow(/unproven canonical Output reservation can be discarded/);
    expect(harness.registry.getOutput(output.outputId).lifecycleState).toBe('FINALIZED');
  });

  it('12: a LEGACY_IMPORTED / non-CANONICAL Output cannot be discarded', () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const legacyOutputId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const now = new Date('2026-08-10T09:00:00.000Z').toISOString();
    harness.database
      .prepare(
        `INSERT INTO canonical_outputs
         (output_id, project_id, revision_id, output_family, output_format, locator_kind,
          locator_value, legacy_absolute_path, content_hash, template_id, template_version_id,
          resolved_template_snapshot_json, resolved_template_snapshot_hash, lifecycle_state,
          provenance_classification, legacy_source_id, legacy_source_field, template_provenance,
          failure_reason, created_at, finalized_at, updated_at)
         VALUES (?, ?, ?, NULL, 'PDF', 'LEGACY_UNKNOWN', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                 'LEGACY_IMPORTED', 'LEGACY_VERIFIED', 'legacy-import-1', 'schedulePdfPath',
                 'LEGACY_UNKNOWN', NULL, ?, NULL, ?)`,
      )
      .run(legacyOutputId, harness.project.id, revision.revisionId, now, now);

    expect(() =>
      harness.registry.discardUnprovenOutputReservation({
        outputId: legacyOutputId,
        projectId: harness.project.id,
        revisionId: revision.revisionId,
      }),
    ).toThrow(/Only a canonical Output reservation can be discarded/);
    expect(harness.registry.getOutput(legacyOutputId).provenanceClassification).toBe(
      'LEGACY_VERIFIED',
    );
  });

  it('13: an Output under a GENERATED_OUTPUTS Revision cannot be discarded through this authority', () => {
    const harness = createHarness();
    const revision = createOperationRevision(harness, 'GENERATED_OUTPUTS');
    const output = reserveOutput(harness, revision.revisionId, 'OUTPUTS/REV_01/schedule.xlsx');

    expect(() =>
      harness.registry.discardUnprovenOutputReservation({
        outputId: output.outputId,
        projectId: harness.project.id,
        revisionId: revision.revisionId,
      }),
    ).toThrow(/composed manual Deliverables Revision/);
    expect(harness.registry.getOutput(output.outputId).lifecycleState).toBe('PREPARING');
  });

  it('14: an Output under a FINALIZED Revision cannot be discarded', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const output = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/a.xlsx');
    await writeProvenArtifact(harness, output);
    harness.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
    await harness.service.finalizeRevision(harness.project, revision.revisionId);
    // Force the ONLY remaining discriminator to be the parent Revision lifecycle.
    harness.database
      .prepare(
        `UPDATE canonical_outputs SET lifecycle_state = 'PREPARING', finalized_at = NULL
         WHERE output_id = ?`,
      )
      .run(output.outputId);

    expect(() =>
      harness.registry.discardUnprovenOutputReservation({
        outputId: output.outputId,
        projectId: harness.project.id,
        revisionId: revision.revisionId,
      }),
    ).toThrow(/only while its Revision is PREPARING/);
    expect(countRows(harness, 'canonical_outputs')).toBe(1);
  });

  it('15: a package-referenced Output cannot be discarded even when every other invariant holds', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const output = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/a.xlsx');
    await writeProvenArtifact(harness, output);
    harness.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
    await harness.service.finalizeRevision(harness.project, revision.revisionId);
    const issuePackage = harness.registry.createIssuePackage({
      revisionId: revision.revisionId,
      label: 'REV_01 Package',
      artifactRelativePath: 'ISSUED/REV_01',
      manifestRelativePath: 'ISSUED/REV_01/SCLI_PACKAGE_MANIFEST.json',
      issuedBy: null,
      issuedAt: null,
    });
    harness.registry.addOutputToPackage(issuePackage.packageId, output.outputId);
    // Force every other invariant to pass so membership is the only rejection.
    harness.database
      .prepare(
        `UPDATE canonical_revisions SET lifecycle_state = 'PREPARING', finalized_at = NULL
         WHERE revision_id = ?`,
      )
      .run(revision.revisionId);
    harness.database
      .prepare(
        `UPDATE canonical_outputs SET lifecycle_state = 'PREPARING', finalized_at = NULL
         WHERE output_id = ?`,
      )
      .run(output.outputId);

    expect(() =>
      harness.registry.discardUnprovenOutputReservation({
        outputId: output.outputId,
        projectId: harness.project.id,
        revisionId: revision.revisionId,
      }),
    ).toThrow(/referenced by an Issue Package/);
    expect(countRows(harness, 'canonical_outputs')).toBe(1);
    expect(countRows(harness, 'revision_package_deliverables')).toBe(1);
  });

  it('rejects a cross-project or cross-revision discard attempt', () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const other = prepareManualRevision(harness);
    const output = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/a.xlsx');

    expect(() =>
      harness.registry.discardUnprovenOutputReservation({
        outputId: output.outputId,
        projectId: seedProjects[1]!.id,
        revisionId: revision.revisionId,
      }),
    ).toThrow(/does not belong to this Project and Revision/);
    expect(() =>
      harness.registry.discardUnprovenOutputReservation({
        outputId: output.outputId,
        projectId: harness.project.id,
        revisionId: other.revisionId,
      }),
    ).toThrow(/does not belong to this Project and Revision/);
    expect(countRows(harness, 'canonical_outputs')).toBe(1);
  });

  it('rejects an unknown Output identity instead of silently succeeding', () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);

    expect(() =>
      harness.registry.discardUnprovenOutputReservation({
        outputId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        projectId: harness.project.id,
        revisionId: revision.revisionId,
      }),
    ).toThrow(/Canonical Output not found/);
  });
});

// ---------------------------------------------------------------------------
// 8 + 9 + 10 — RESUME REVISION
// ---------------------------------------------------------------------------

describe('C0 Resume Revision', () => {
  it('18 + 19 + 20 + 21: a FAILED_RECOVERABLE MANUAL_DELIVERABLES Revision resumes to PREPARING without identity, snapshot or finalized-Output change', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const layout = await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    const dialux = await addSnapshot(harness, revision.revisionId, 'Drawings/DIALux.pdf');
    const finalized = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/done.xlsx');
    await writeProvenArtifact(harness, finalized);
    harness.registry.setOutputLifecycle(finalized.outputId, 'FINALIZED');
    const finalizedBefore = harness.registry.getOutput(finalized.outputId);
    const snapshotsBefore = harness.registry.listDocumentSnapshotsForRevision(revision.revisionId);
    harness.registry.setRevisionLifecycle(
      revision.revisionId,
      'FAILED_RECOVERABLE',
      'Damaged by a previous startup reconciliation.',
    );

    const resumed = await harness.service.resumeRevision(harness.project, revision.revisionId);

    // 18 + 19 — lifecycle repaired, identity preserved, no new Revision.
    expect(resumed.lifecycleState).toBe('PREPARING');
    expect(resumed.revisionId).toBe(revision.revisionId);
    expect(resumed.revisionSequence).toBe(revision.revisionSequence);
    expect(resumed.revisionLabel).toBe(revision.revisionLabel);
    expect(resumed.snapshotHash).toBe(revision.snapshotHash);
    expect(resumed.failureReason).toBeNull();
    expect(countRows(harness, 'canonical_revisions')).toBe(1);

    // 20 — snapshots unchanged, rows and artifacts alike.
    expect(harness.registry.listDocumentSnapshotsForRevision(revision.revisionId)).toEqual(
      snapshotsBefore,
    );
    expect(existsSync(snapshotArtifactPath(harness, layout))).toBe(true);
    expect(existsSync(snapshotArtifactPath(harness, dialux))).toBe(true);

    // 21 — the finalized Output is untouched.
    expect(harness.registry.getOutput(finalized.outputId)).toEqual(finalizedBefore);
  });

  it('22: resume repairs unresolved Output residue so the draft is finalizable, never blindly PREPARING', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const snapshot = await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    const provable = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/proven.xlsx');
    await writeProvenArtifact(harness, provable);
    harness.registry.setOutputLifecycle(
      provable.outputId,
      'FAILED_RECOVERABLE',
      'Interrupted before promotion.',
    );
    const unproven = reserveOutput(
      harness,
      revision.revisionId,
      'DELIVERABLES/REV_01/unproven.xlsx',
    );
    const unprovenTemporary = writeOwnedTemporary(harness, unproven);
    harness.registry.setOutputLifecycle(
      unproven.outputId,
      'FAILED_RECOVERABLE',
      'Interrupted with no artifact.',
    );
    harness.registry.setRevisionLifecycle(
      revision.revisionId,
      'FAILED_RECOVERABLE',
      'Damaged draft.',
    );

    const resumed = await harness.service.resumeRevision(harness.project, revision.revisionId);

    expect(resumed.lifecycleState).toBe('PREPARING');
    // Hash-proven residue is reconciled forward; unproven residue is discarded.
    expect(harness.registry.getOutput(provable.outputId).lifecycleState).toBe('FINALIZED');
    expect(() => harness.registry.getOutput(unproven.outputId)).toThrow(/not found/i);
    expect(existsSync(unprovenTemporary)).toBe(false);
    expect(existsSync(snapshotArtifactPath(harness, snapshot))).toBe(true);
    // No blocking residue survives: the resumed draft finalizes immediately.
    await expect(
      harness.service.finalizeRevision(harness.project, revision.revisionId),
    ).resolves.toMatchObject({ lifecycleState: 'FINALIZED' });
  });

  it('23: a GENERATED_OUTPUTS Revision cannot use Resume Revision', () => {
    const harness = createHarness();
    const revision = createOperationRevision(harness, 'GENERATED_OUTPUTS');
    harness.registry.setRevisionLifecycle(
      revision.revisionId,
      'FAILED_RECOVERABLE',
      'Injected generation interruption.',
    );

    return expect(
      harness.service.resumeRevision(harness.project, revision.revisionId),
    ).rejects.toThrow(/Only a manual Deliverables Revision can be resumed/);
  });

  it('24: a REGISTER_ONLY Revision cannot use Resume Revision', async () => {
    const harness = createHarness();
    const revision = createOperationRevision(harness, 'REGISTER_ONLY');
    harness.registry.setRevisionLifecycle(
      revision.revisionId,
      'FAILED_RECOVERABLE',
      'Injected register projection interruption.',
    );

    await expect(
      harness.service.resumeRevision(harness.project, revision.revisionId),
    ).rejects.toThrow(/Only a manual Deliverables Revision can be resumed/);
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
  });

  it('25: a FINALIZED Revision cannot use Resume Revision', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    await harness.service.finalizeRevision(harness.project, revision.revisionId);

    await expect(
      harness.service.resumeRevision(harness.project, revision.revisionId),
    ).rejects.toThrow(/Only a failed recoverable manual Deliverables Revision can be resumed/);
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('FINALIZED');
  });

  it('26: a cross-project resume attempt is rejected', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    harness.registry.setRevisionLifecycle(
      revision.revisionId,
      'FAILED_RECOVERABLE',
      'Damaged draft.',
    );
    const otherProject = structuredClone(seedProjects[1]!);

    await expect(harness.service.resumeRevision(otherProject, revision.revisionId)).rejects.toThrow(
      /Revision does not belong to this Project/,
    );
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
  });

  it('refuses to resume into an unresolvable draft when a reservation can be neither proven nor disposed of', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/a.xlsx');
    harness.registry.setRevisionLifecycle(
      revision.revisionId,
      'FAILED_RECOVERABLE',
      'Damaged draft.',
    );
    harness.store.setFolderPath(harness.project.id, '');

    await expect(
      harness.service.resumeRevision(harness.project, revision.revisionId),
    ).rejects.toThrow(/cannot be resolved while the Project folder/);
    // The rejected repair left the Revision exactly as it was.
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
    expect(countRows(harness, 'canonical_outputs')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 11 + 12 + 13 — F-1 GENERATED OUTPUT PRESENCE GATE
// ---------------------------------------------------------------------------

describe('C0 F-1 GeneratedOutput presence finalization gate', () => {
  it('27: finalization blocks a Missing GeneratedOutput artifact', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    const output = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/a.xlsx');
    const artifact = await writeProvenArtifact(harness, output);
    harness.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
    rmSync(artifact);

    await expect(
      harness.service.finalizeRevision(harness.project, revision.revisionId),
    ).rejects.toThrow(/generated Output Deliverable artifact is missing/);
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
  });

  it('28: finalization blocks an Unavailable GeneratedOutput artifact', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    const output = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/a.xlsx');
    const artifact = await writeProvenArtifact(harness, output);
    harness.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
    rmSync(artifact);
    mkdirSync(artifact);

    await expect(
      harness.service.finalizeRevision(harness.project, revision.revisionId),
    ).rejects.toThrow(/generated Output Deliverable artifact is unavailable/);
    expect(statSync(artifact).isDirectory()).toBe(true);
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('PREPARING');
  });

  it('30: the existing DocumentSnapshot Missing / Unavailable gate still works', async () => {
    const harness = createHarness();
    const missing = createHarness();

    const revision = prepareManualRevision(harness);
    const snapshot = await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    rmSync(snapshotArtifactPath(harness, snapshot));
    await expect(
      harness.service.finalizeRevision(harness.project, revision.revisionId),
    ).rejects.toThrow(/Document Snapshot artifact is missing/);

    const other = prepareManualRevision(missing);
    const otherSnapshot = await addSnapshot(missing, other.revisionId, 'Drawings/Layout.pdf');
    const otherPath = snapshotArtifactPath(missing, otherSnapshot);
    rmSync(otherPath);
    mkdirSync(otherPath);
    await expect(
      missing.service.finalizeRevision(missing.project, other.revisionId),
    ).rejects.toThrow(/Document Snapshot artifact is unavailable/);
  });

  it('30: finalization succeeds when both Deliverable source types are Present and Output lifecycles are complete', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const snapshot = await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    const output = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/a.xlsx');
    const artifact = await writeProvenArtifact(harness, output);
    harness.registry.setOutputLifecycle(output.outputId, 'FINALIZED');

    await expect(
      harness.service.finalizeRevision(harness.project, revision.revisionId),
    ).resolves.toMatchObject({ lifecycleState: 'FINALIZED' });
    const deliverables = await harness.service.listRevisionDeliverables(
      harness.project,
      revision.revisionId,
    );
    expect(deliverables).toHaveLength(2);
    expect(deliverables.every((item) => item.presence === 'Present')).toBe(true);
    expect(existsSync(artifact)).toBe(true);
    expect(existsSync(snapshotArtifactPath(harness, snapshot))).toBe(true);
  });

  it('31: a historically FINALIZED Revision whose artifacts later disappear stays FINALIZED and readable', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    const snapshot = await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    const output = reserveOutput(harness, revision.revisionId, 'DELIVERABLES/REV_01/a.xlsx');
    const artifact = await writeProvenArtifact(harness, output);
    harness.registry.setOutputLifecycle(output.outputId, 'FINALIZED');
    await harness.service.finalizeRevision(harness.project, revision.revisionId);

    rmSync(artifact);
    rmSync(snapshotArtifactPath(harness, snapshot));
    const report = await createReconciler(harness).reconcile();

    // No retroactive invalidation, no rewrite, no backfill.
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe('FINALIZED');
    expect(harness.registry.getOutput(output.outputId).lifecycleState).toBe('FINALIZED');
    expect(report).toMatchObject({ failedRevisions: 0, discardedOutputReservations: 0 });
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityId: output.outputId, code: 'FINAL_ARTIFACT_MISSING' }),
      ]),
    );
    // Presence becomes Missing through the existing read authority.
    const deliverables = await harness.service.listRevisionDeliverables(
      harness.project,
      revision.revisionId,
    );
    expect(deliverables).toHaveLength(2);
    expect(deliverables.every((item) => item.presence === 'Missing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10 — RESUME API
// ---------------------------------------------------------------------------

describe('C0 Resume Revision API', () => {
  it('32 + 33: the route resumes the path revisionId and ignores client lifecycle/provenance fields', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    await addSnapshot(harness, revision.revisionId, 'Drawings/Layout.pdf');
    harness.registry.setRevisionLifecycle(
      revision.revisionId,
      'FAILED_RECOVERABLE',
      'Damaged draft.',
    );
    const bystander = prepareManualRevision(harness);
    const app = await createAppFor(harness);

    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/resume`,
      headers: { 'x-mock-user-id': actor.id },
      payload: {
        revisionId: bystander.revisionId,
        lifecycleState: 'FINALIZED',
        provenanceClassification: 'LEGACY_VERIFIED',
        projectId: seedProjects[1]!.id,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.revisionId).toBe(revision.revisionId);
    expect(body.lifecycleState).toBe('PREPARING');
    expect(body.provenanceClassification).toBe('CANONICAL');
    expect(body.projectId).toBe(harness.project.id);
    // The spoofed body identity was never used.
    expect(harness.registry.getRevision(bystander.revisionId).lifecycleState).toBe('PREPARING');
    expect(countRows(harness, 'canonical_revisions')).toBe(2);
  });

  it('34: the route enforces authenticated project authority', async () => {
    const harness = createHarness();
    const revision = prepareManualRevision(harness);
    harness.registry.setRevisionLifecycle(
      revision.revisionId,
      'FAILED_RECOVERABLE',
      'Damaged draft.',
    );
    const app = await createAppFor(harness);
    const url = `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/resume`;

    // Authentication: an inactive actor is rejected before any project authority.
    const inactive = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-mock-user-id': seedUserIds.inactive },
    });
    expect(inactive.statusCode).toBe(401);
    expect(inactive.json().error.code).toBe('AUTHENTICATION_REQUIRED');

    // Project authority: a Sales actor who does not own this project is denied.
    const denied = await app.inject({
      method: 'POST',
      url,
      headers: { 'x-mock-user-id': seedUserIds.salesTwo },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PERMISSION_DENIED');
    expect(harness.registry.getRevision(revision.revisionId).lifecycleState).toBe(
      'FAILED_RECOVERABLE',
    );
  });
});

// ---------------------------------------------------------------------------
// 14 + 16 — EXPLICIT C0 BOUNDARIES
// ---------------------------------------------------------------------------

describe('C0 boundaries', () => {
  it('35: C0 itself adds no migration beyond the current production target', () => {
    expect(PRODUCTION_SCHEMA_TARGET_VERSION).toBe(30);
  });

  it('36: no targetRevisionId composition contract exists yet', () => {
    const shape = Object.keys(createCanonicalOutputSchema.shape as Record<string, unknown>);
    expect(shape).toEqual(
      expect.arrayContaining(['revisionId', 'outputFamily', 'outputFormat', 'relativePath']),
    );
    expect(shape).not.toContain('targetRevisionId');
    expect(shape).not.toContain('composableTargets');
  });

  it('C0 adds no canonical registry table beyond the v13 surface', () => {
    const harness = createHarness();
    const tables = (
      harness.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'canonical_%'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(tables.sort()).toEqual([
      'canonical_issue_packages',
      'canonical_outputs',
      'canonical_package_outputs',
      'canonical_revisions',
    ]);
  });
});
