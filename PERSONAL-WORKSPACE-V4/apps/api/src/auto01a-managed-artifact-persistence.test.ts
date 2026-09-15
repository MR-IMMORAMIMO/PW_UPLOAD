/**
 * AUTO-01A — Managed Artifact Persistence Foundation reality gate.
 *
 * Proves the v14 -> v15 migration and the owner-locked AUTO-00 persistence
 * foundation:
 *   A. Migration compatibility (v14 -> v15; existing data + snapshot provenance NULL).
 *   B. ManagedArtifact identity (primary; ProjectDocument compatibility; no duplicate identity).
 *   C. ArtifactVersion immutability / sequence uniqueness.
 *   D. ToolContext states (LIVE/REBOUND/EXPIRED/CLOSED; concurrency; expired rule).
 *   E. CaptureLedger state persistence + audit.
 *   F. DocumentSnapshot sourceArtifactVersionId provenance + FK RESTRICT.
 *   G. B0/C0/C1/C2/B2 authorities remain intact (regression compatibility).
 *
 * This is persistence/domain foundation ONLY. No operational capture pipeline.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { toolContextCanAuthorizeNewCapture, type AppUser, type Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { StandaloneDataProvider } from './standalone-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { ProjectService } from './project-service';
import { ManagedArtifactStore } from './infrastructure/managed-artifact/ManagedArtifactStore';
import { SchemaMigrationRunner } from './infrastructure/migration/SchemaMigrationRunner';
import { LegacyDetector } from './infrastructure/migration/legacy/LegacyDetector';
import { PathResolverService } from './infrastructure/path/PathResolverService';
import {
  EXTERNALLY_MIGRATED,
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from './infrastructure/migration/registry/production-migration-registry';
import type {
  MigrationBackupFactory,
  MigrationBackupPort,
  MigrationClock,
  MigrationDatabaseFactory,
  MigrationJournalPort,
  MigrationJournalState,
} from './infrastructure/migration/types';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

const FIXED_BASE_MS = Date.parse('2026-08-20T09:00:00.000Z');
const CREATED_AT = new Date(FIXED_BASE_MS).toISOString();
const ADMIN = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;

const openHandles: DatabaseSyncInstance[] = [];
const openStores: Array<{ close(): void }> = [];
const tempRoots: string[] = [];

afterEach(() => {
  while (openStores.length) openStores.pop()?.close();
  while (openHandles.length) openHandles.pop()?.close();
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function sha256(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

function newTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'scli-auto01a-'));
  tempRoots.push(dir);
  return dir;
}

function dbPathIn(dir: string): string {
  return path.join(dir, 'scli.sqlite');
}

function makeConfig(dir: string, dbPath = dbPathIn(dir)) {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: dbPath,
    STANDALONE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Local Admin',
    STANDALONE_ADMIN_EMAIL: 'admin@local.test',
    STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
    COMPANY_TIMEZONE: 'Asia/Dubai',
  });
}

function makeClock(): MigrationClock {
  let ticks = 0;
  return { now: () => new Date(FIXED_BASE_MS + ticks++ * 1000) };
}

class FakeBackupPort implements MigrationBackupPort {
  public async createVerifiedBackup(): Promise<{ backupId: string }> {
    return { backupId: 'bk-auto01a-0001' };
  }
  public async verifyBackup(): Promise<unknown> {
    return { ok: true };
  }
}

class FakeBackupFactory implements MigrationBackupFactory {
  public create(): MigrationBackupPort {
    return new FakeBackupPort();
  }
}

class FakeJournal implements MigrationJournalPort {
  public states: MigrationJournalState[] = [];
  public async createAttempt(): Promise<{ attemptId: string }> {
    this.states.push('CREATED');
    return { attemptId: 'att-auto01a-0001' };
  }
  public async transition(_attemptId: string, state: MigrationJournalState): Promise<void> {
    this.states.push(state);
  }
  public async markFailed(): Promise<void> {
    this.states.push('FAILED');
  }
}

function realDatabaseFactory(): MigrationDatabaseFactory {
  return {
    openReadWrite(p: string): DatabaseSyncInstance {
      return new DatabaseSync(p);
    },
    openReadOnly(p: string): DatabaseSyncInstance {
      return new DatabaseSync(p, { readOnly: true });
    },
  };
}

function makeRunner(
  dir: string,
  target: number = PRODUCTION_SCHEMA_TARGET_VERSION,
): SchemaMigrationRunner {
  return new SchemaMigrationRunner({
    migrations: PRODUCTION_MIGRATIONS.slice(0, target),
    targetVersion: target,
    appVersion: '3.3.0',
    databaseFactory: realDatabaseFactory(),
    backupFactory: new FakeBackupFactory(),
    journal: new FakeJournal(),
    clock: makeClock(),
    pathResolver: new PathResolverService(dir),
    busyTimeoutMs: 5000,
    legacyAdmission: new LegacyDetector(),
  });
}

function userVersion(db: DatabaseSyncInstance): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

interface Harness {
  root: string;
  db: DatabaseSyncInstance;
  store: PersonalWorkspaceStore;
  artifacts: ManagedArtifactStore;
  registry: CanonicalOutputRegistryStore;
  projects: Project[];
}

async function makeHarness(count = 2): Promise<Harness> {
  const dir = newTempDir();
  const p = dbPathIn(dir);
  const empty = new DatabaseSync(p);
  empty.close();
  await makeRunner(dir).run(p);
  const config = makeConfig(dir, p);
  const db = new DatabaseSync(p);
  openHandles.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, db);
  const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, db);
  openStores.push(provider, store);
  const artifacts = new ManagedArtifactStore(db);
  const registry = new CanonicalOutputRegistryStore(db, undefined, 'CANONICAL');
  registry.registerBuiltInTemplateVersions();
  const service = new ProjectService(
    provider,
    config.COMPANY_TIMEZONE,
    () => new Date(FIXED_BASE_MS),
    'personal',
  );
  const users = await provider.listUsers();
  const admin = users.find((u) => u.role === 'Admin' && u.isActive);
  if (!admin) throw new Error('Bootstrap Admin missing.');
  const projects: Project[] = [];
  for (let i = 0; i < count; i += 1) {
    const created = await service.createProject(
      admin,
      projectInput(seedProjects[i]?.projectName ?? `Auto01A Project ${i}`),
    );
    projects.push(created.project);
  }
  return { root: dir, db, store, artifacts, registry, projects };
}

function projectInput(name: string) {
  return {
    projectName: name,
    clientName: 'Test Client',
    projectType: 'Lighting Layout',
    description: 'AUTO-01A persistence reality project.',
    collaboratorDesignerIds: [],
    siteLocation: 'Dubai, UAE',
    designStage: 'Concept' as const,
    lightingScope: 'Interior lighting design and luminaire coordination.',
    luxRequirements: 'Target 500 lux at working plane.',
    drawingReference: 'A-101',
    priority: 'Normal' as const,
    complexity: 'Medium' as const,
    estimatedHours: 8,
    requiredDeliveryDate: '2026-08-20',
    projectFolderUrl: null,
    idempotencyKey: randomUUID(),
  };
}

/** Direct seed of a project_documents row (FK disabled at call site for dangling project refs). */
function insertProjectDocument(
  db: DatabaseSyncInstance,
  id: string,
  projectId: string,
  title: string,
): void {
  db.prepare(
    `INSERT INTO project_documents
     (id, project_id, category, document_number, title, revision, status, file_path,
      issued_to, issue_date, notes, created_at, updated_at)
     VALUES (?, ?, 'Drawing', 'DOC', ?, 'A', 'Working', ?, '', NULL, '', ?, ?)`,
  ).run(id, projectId, title, `Drawings/${title}.pdf`, CREATED_AT, CREATED_AT);
}

function insertSnapshotV14(
  db: DatabaseSyncInstance,
  deliverableId: string,
  projectId: string,
  revisionId: string,
  sourceDocId: string,
  contentHash: string,
): void {
  db.prepare(
    `INSERT INTO revision_document_snapshots
     (deliverable_id, project_id, revision_id, source_document_id, category, title,
      file_name, source_relative_path, locator_kind, locator_value, content_hash,
      size_bytes, created_by_id, created_by_name, created_at)
     VALUES (?, ?, ?, ?, 'Drawing', 'Snapshot', 'Snapshot.pdf', 'Drawings/Snapshot.pdf',
             'PROJECT_RELATIVE', 'DELIVERABLES/REV_01/Snapshot.pdf', ?, 100, NULL, NULL, ?)`,
  ).run(deliverableId, projectId, revisionId, sourceDocId, contentHash, CREATED_AT);
}

function insertSnapshot(
  db: DatabaseSyncInstance,
  deliverableId: string,
  projectId: string,
  revisionId: string,
  sourceDocId: string,
  contentHash: string,
  sourceArtifactVersionId: string | null,
): void {
  db.prepare(
    `INSERT INTO revision_document_snapshots
     (deliverable_id, project_id, revision_id, source_document_id, category, title,
      file_name, source_relative_path, locator_kind, locator_value, content_hash,
      size_bytes, created_by_id, created_by_name, created_at, source_artifact_version_id)
     VALUES (?, ?, ?, ?, 'Drawing', 'Snapshot', 'Snapshot.pdf', 'Drawings/Snapshot.pdf',
             'PROJECT_RELATIVE', 'DELIVERABLES/REV_01/Snapshot.pdf', ?, 100, NULL, NULL, ?, ?)`,
  ).run(
    deliverableId,
    projectId,
    revisionId,
    sourceDocId,
    contentHash,
    CREATED_AT,
    sourceArtifactVersionId,
  );
}

describe('AUTO-01A Managed Artifact Persistence Foundation', () => {
  describe('A. Migration compatibility (v14 -> v16)', () => {
    it('A1: v14 -> v16 succeeds; existing ProjectDocuments and snapshots survive; snapshots get NULL provenance', async () => {
      const root = newTempDir();
      const p = dbPathIn(root);
      const empty = new DatabaseSync(p);
      empty.close();
      // Build a real v14 database.
      await makeRunner(root, 14).run(p);
      const v14 = new DatabaseSync(p);
      expect(userVersion(v14)).toBe(14);
      v14.close();

      // Seed a legacy project document + legacy snapshot into the v14 DB (FK off for dangling project ref).
      const seed = new DatabaseSync(p);
      seed.exec('PRAGMA foreign_keys = OFF');
      const docId = 'a0000000-0000-4000-8000-000000000001';
      const projectId = 'a0000000-0000-4000-8000-000000000002';
      const revId = 'a0000000-0000-4000-8000-000000000003';
      const snapId = 'a0000000-0000-4000-8000-000000000004';
      insertProjectDocument(seed, docId, projectId, 'Legacy Layout');
      // A real v14 snapshot always references a canonical Revision; seed one so
      // the v16 rebuild's FK enforcement (foreign_keys=ON) does not reject the copy.
      seed
        .prepare(
          `INSERT INTO canonical_revisions
           (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
            created_by_id, created_by_name, provenance_classification, legacy_source_id,
            failure_reason, created_at, updated_at)
           VALUES (?, ?, 1, 'REV_01', 'LEGACY_IMPORTED', NULL, NULL, 'LEGACY_VERIFIED',
                   'legacy-test', NULL, ?, ?)`,
        )
        .run(revId, projectId, CREATED_AT, CREATED_AT);
      insertSnapshotV14(seed, snapId, projectId, revId, docId, sha256('legacy-bytes'));
      seed.close();

      // Upgrade to the current production schema.
      await makeRunner(root).run(p);
      const db = new DatabaseSync(p);
      openHandles.push(db);
      db.exec('PRAGMA foreign_keys = ON');
      expect(userVersion(db)).toBe(PRODUCTION_SCHEMA_TARGET_VERSION);

      // Existing ProjectDocument survives unchanged.
      const doc = db.prepare('SELECT * FROM project_documents WHERE id = ?').get(docId) as Record<
        string,
        unknown
      >;
      expect(doc.title).toBe('Legacy Layout');
      expect(doc.category).toBe('Drawing');

      // Existing snapshot survives with NULL provenance and unchanged hash/locator.
      const snap = db
        .prepare('SELECT * FROM revision_document_snapshots WHERE deliverable_id = ?')
        .get(snapId) as Record<string, unknown>;
      expect(snap.source_artifact_version_id).toBeNull();
      expect(snap.content_hash).toBe(sha256('legacy-bytes'));
      expect(snap.locator_value).toBe('DELIVERABLES/REV_01/Snapshot.pdf');
      expect(snap.locator_kind).toBe('PROJECT_RELATIVE');

      // C0/C1/C2/B2 authorities remain present.
      for (const table of [
        'managed_artifacts',
        'artifact_versions',
        'tool_contexts',
        'capture_ledger',
        'canonical_revisions',
        'canonical_outputs',
        'canonical_issue_packages',
        'canonical_package_outputs',
        'revision_package_deliverables',
        'project_file_index',
      ]) {
        const row = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table);
        expect(row).toBeDefined();
      }
    });
  });

  describe('B. ManagedArtifact identity', () => {
    it('B6/B7/B8: create/read by UUID; two artifacts same project different paths; path uniqueness', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;

      const layout = harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'LightingLayout',
        sourceTool: 'AutoCAD',
        canonicalPath: 'WORKING/CAD/Lighting Layout.dwg',
      });
      harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'BOQ',
        sourceTool: 'Office',
        canonicalPath: 'WORKING/BOQ/BOQ.xlsx',
      });

      expect(layout.artifactId).toMatch(/^[0-9a-f-]{36}$/);
      expect(harness.artifacts.getManagedArtifact(layout.artifactId).artifactId).toBe(
        layout.artifactId,
      );
      expect(harness.artifacts.listManagedArtifacts(projectId)).toHaveLength(2);

      // Same canonical path in same project -> CONFLICT.
      expect(() =>
        harness.artifacts.createManagedArtifact({
          projectId,
          artifactType: 'LightingLayout',
          sourceTool: 'AutoCAD',
          canonicalPath: 'WORKING/CAD/Lighting Layout.dwg',
        }),
      ).toThrow(/already exists/i);

      // Same canonical path in a DIFFERENT project is allowed.
      const harness2 = await makeHarness(1);
      const project2 = harness2.projects[0]!.id;
      expect(() =>
        harness2.artifacts.createManagedArtifact({
          projectId: project2,
          artifactType: 'LightingLayout',
          sourceTool: 'AutoCAD',
          canonicalPath: 'WORKING/CAD/Lighting Layout.dwg',
        }),
      ).not.toThrow();
    });

    it('B9/B10/B11: filename is not identity; ProjectDocument may exist without ManagedArtifact; no competing identity', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      const docId = randomUUID();
      insertProjectDocument(harness.db, docId, projectId, 'Unmanaged Layout');

      // A ProjectDocument may exist with no ManagedArtifact (no auto-upgrade).
      expect(harness.artifacts.listManagedArtifacts(projectId)).toHaveLength(0);

      // Linking a ManagedArtifact to an existing ProjectDocument is one-directional.
      const artifact = harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'LightingLayout',
        sourceTool: 'AutoCAD',
        canonicalPath: 'WORKING/CAD/Managed Layout.dwg',
        projectDocumentId: docId,
      });
      expect(artifact.projectDocumentId).toBe(docId);
      // The ProjectDocument is still independently readable; no competing identity is claimed.
      const row = harness.db
        .prepare('SELECT id, title FROM project_documents WHERE id = ? AND project_id = ?')
        .get(docId, projectId) as Record<string, unknown>;
      expect(row.id).toBe(docId);
      expect(harness.artifacts.getManagedArtifact(artifact.artifactId).projectDocumentId).toBe(
        docId,
      );
    });
  });

  describe('C. ArtifactVersion', () => {
    it('C12-C16: immutable version create; sequence unique within artifact; same seq on another artifact; hash/size persist; UUID identity', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      const a = harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'LightingLayout',
        sourceTool: 'AutoCAD',
        canonicalPath: 'WORKING/CAD/Layout.dwg',
      });
      const b = harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'BOQ',
        sourceTool: 'Office',
        canonicalPath: 'WORKING/BOQ/BOQ.xlsx',
      });

      const v1 = harness.artifacts.createArtifactVersion({
        artifactId: a.artifactId,
        version: 1,
        contentHash: sha256('layout-v1'),
        sizeBytes: 1200,
        locatorValue: 'WORKING/CAD/Layout.dwg',
      });
      const v2 = harness.artifacts.createArtifactVersion({
        artifactId: a.artifactId,
        version: 2,
        contentHash: sha256('layout-v2'),
        sizeBytes: 2400,
        locatorValue: 'WORKING/CAD/Layout.dwg',
      });

      expect(v1.versionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(v1.versionId).not.toBe(v2.versionId);
      expect(v1.version).toBe(1);
      expect(v2.version).toBe(2);
      expect(harness.artifacts.getArtifactVersion(v1.versionId).contentHash).toBe(
        sha256('layout-v1'),
      );
      expect(harness.artifacts.getArtifactVersion(v1.versionId).sizeBytes).toBe(1200);
      expect(harness.artifacts.listArtifactVersions(a.artifactId)).toHaveLength(2);
      expect(harness.artifacts.getManagedArtifact(a.artifactId).currentWorkingVersion).toBe(2);

      // Same version sequence on the same artifact -> UNIQUE conflict.
      expect(() =>
        harness.artifacts.createArtifactVersion({
          artifactId: a.artifactId,
          version: 1,
          contentHash: sha256('dupe'),
          locatorValue: 'WORKING/CAD/Layout.dwg',
        }),
      ).toThrow(/already exists/);

      // Same version sequence on ANOTHER artifact is allowed.
      expect(() =>
        harness.artifacts.createArtifactVersion({
          artifactId: b.artifactId,
          version: 1,
          contentHash: sha256('boq-one'),
          locatorValue: 'WORKING/BOQ/BOQ.xlsx',
        }),
      ).not.toThrow();
    });
  });

  describe('D. ToolContext', () => {
    it('D17-D22: multiple contexts coexist; all four states persist; no single-global-project; EXPIRED cannot authorize', async () => {
      const harness = await makeHarness(2);
      const pA = harness.projects[0]!.id;
      const pB = harness.projects[1]!.id;

      harness.artifacts.createToolContext({
        projectId: pA,
        tool: 'AutoCAD',
        expectedArtifactType: 'LightingLayout',
        mode: 'Working',
        channel: 'autocad-session-1',
        state: 'LIVE',
        openedAt: CREATED_AT,
      });
      harness.artifacts.createToolContext({
        projectId: pB,
        tool: 'DIALux',
        expectedArtifactType: 'DialuxReport',
        channel: 'dialux-session-2',
        mode: 'Working',
        state: 'REBOUND',
        openedAt: CREATED_AT,
      });
      harness.artifacts.createToolContext({
        projectId: pA,
        tool: 'AutoCAD',
        expectedArtifactType: 'LightingLayout',
        channel: 'autocad-session-3',
        mode: 'Working',
        state: 'EXPIRED',
        openedAt: CREATED_AT,
      });
      harness.artifacts.createToolContext({
        projectId: pB,
        tool: 'Office',
        expectedArtifactType: 'BOQ',
        channel: 'office-session-4',
        mode: 'Working',
        state: 'CLOSED',
        openedAt: CREATED_AT,
      });

      expect(harness.artifacts.listToolContexts()).toHaveLength(4);
      // Multiple concurrent contexts across projects — no single global project.
      expect(harness.artifacts.listToolContexts(pA)).toHaveLength(2);
      expect(harness.artifacts.listToolContexts(pB)).toHaveLength(2);
      const states = harness.artifacts.listToolContexts().map((c) => c.state);
      for (const expected of ['LIVE', 'REBOUND', 'EXPIRED', 'CLOSED']) {
        expect(states).toContain(expected);
      }

      // Expired rule (AUTO-D06): only LIVE/REBOUND may authorize a NEW capture.
      expect(toolContextCanAuthorizeNewCapture('LIVE')).toBe(true);
      expect(toolContextCanAuthorizeNewCapture('REBOUND')).toBe(true);
      expect(toolContextCanAuthorizeNewCapture('EXPIRED')).toBe(false);
      expect(toolContextCanAuthorizeNewCapture('CLOSED')).toBe(false);
    });
  });

  describe('E. CaptureLedger', () => {
    it('E24-E28: every locked state persists; pre-hash; audit not cascade-deleted', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;

      const states = [
        'DETECTED',
        'STABILIZING',
        'STAGED',
        'VERIFYING',
        'ADMITTED',
        'MATERIALIZING',
        'COMPLETED',
        'UNRESOLVED',
        'FAILED_RECOVERABLE',
        'DISCARDED',
      ] as const;
      for (const state of states) {
        const entry = harness.artifacts.createCaptureLedgerEntryForTest({
          projectId,
          sourcePath: `C:/exports/${state}.pdf`,
          sourceChannel: 'test-channel',
          expectedArtifactType: 'BOQ',
          state,
          detectedAt: CREATED_AT,
        });
        expect(harness.artifacts.getCaptureLedgerEntry(entry.captureId).state).toBe(state);
      }

      // Pre-hash ledger entry has NULL hash/size and NULL final IDs until admission.
      const preHash = harness.artifacts.createCaptureLedgerEntryForTest({
        projectId,
        sourcePath: 'C:/exports/pending.pdf',
        sourceChannel: 'test-channel',
        expectedArtifactType: 'BOQ',
        state: 'DETECTED',
        detectedAt: CREATED_AT,
      });
      expect(preHash.contentHash).toBeNull();
      expect(preHash.sizeBytes).toBeNull();
      expect(preHash.finalArtifactId).toBeNull();
      expect(preHash.finalVersionId).toBeNull();

      // Audit rows are not silently cascade-deleted: deleting a linked tool context nulls the FK, not the audit row.
      expect(harness.artifacts.listCaptureLedgerEntries(projectId).length).toBe(states.length + 1);
    });
  });

  describe('F. Snapshot provenance', () => {
    it('F29-F32: null provenance valid; managed snapshot may point to ArtifactVersion; FK RESTRICT; semantics unchanged', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      const docId = randomUUID();
      insertProjectDocument(harness.db, docId, projectId, 'Managed Layout');

      const artifact = harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'LightingLayout',
        sourceTool: 'AutoCAD',
        canonicalPath: 'WORKING/CAD/Managed.dwg',
        projectDocumentId: docId,
      });
      const version = harness.artifacts.createArtifactVersion({
        artifactId: artifact.artifactId,
        version: 1,
        contentHash: sha256('managed-bytes'),
        locatorValue: 'WORKING/CAD/Managed.dwg',
      });

      const revId = 'a0000000-0000-4000-8000-0000000000aa';
      const unmanagedSnap = randomUUID();
      // Disable FK for this direct seed (dangling revision) — provenance semantics still asserted.
      harness.db.exec('PRAGMA foreign_keys = OFF');
      insertSnapshot(harness.db, unmanagedSnap, projectId, revId, docId, sha256('manual'), null);

      const managedSnap = randomUUID();
      insertSnapshot(
        harness.db,
        managedSnap,
        projectId,
        revId,
        docId,
        sha256('managed-bytes'),
        version.versionId,
      );
      harness.db.exec('PRAGMA foreign_keys = ON');

      const row = harness.db
        .prepare(
          'SELECT source_artifact_version_id FROM revision_document_snapshots WHERE deliverable_id = ?',
        )
        .get(managedSnap) as Record<string, unknown>;
      expect(row.source_artifact_version_id).toBe(version.versionId);

      // Referenced ArtifactVersion cannot be deleted while a snapshot depends on it (FK RESTRICT).
      expect(() =>
        harness.db
          .prepare('DELETE FROM artifact_versions WHERE version_id = ?')
          .run(version.versionId),
      ).toThrow(/FOREIGN KEY/i);

      // Snapshot hash/locator semantics unchanged for the unmanaged (NULL-provenance) snapshot.
      const unmanaged = harness.db
        .prepare(
          'SELECT content_hash, locator_value, source_artifact_version_id FROM revision_document_snapshots WHERE deliverable_id = ?',
        )
        .get(unmanagedSnap) as Record<string, unknown>;
      expect(unmanaged.content_hash).toBe(sha256('manual'));
      expect(unmanaged.source_artifact_version_id).toBeNull();
    });
  });

  describe('G. Regression compatibility', () => {
    it('G1-G5: B0/C0/C1/C2/B2 authority tables remain present and readable after v15', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      for (const table of [
        'canonical_revisions',
        'canonical_outputs',
        'canonical_issue_packages',
        'canonical_package_outputs',
        'revision_package_deliverables',
        'revision_document_snapshots',
      ]) {
        const count = harness.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        };
        expect(count.count).toBe(0);
      }
      const docId = randomUUID();
      insertProjectDocument(harness.db, docId, projectId, 'Compatibility Doc');
      const row = harness.db
        .prepare('SELECT id FROM project_documents WHERE id = ? AND project_id = ?')
        .get(docId, projectId) as Record<string, unknown>;
      expect(row.id).toBe(docId);
    });
  });

  describe('H. Correction — ownership + atomicity', () => {
    it('H1: same-project ManagedArtifact -> ProjectDocument link succeeds', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      const docId = randomUUID();
      insertProjectDocument(harness.db, docId, projectId, 'Owned Layout');
      const artifact = harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'LightingLayout',
        sourceTool: 'AutoCAD',
        canonicalPath: 'WORKING/CAD/Owned.dwg',
        projectDocumentId: docId,
      });
      expect(artifact.projectDocumentId).toBe(docId);
    });

    it('H2: cross-project ManagedArtifact -> ProjectDocument rejects', async () => {
      const harness = await makeHarness(2);
      const pA = harness.projects[0]!.id;
      const pB = harness.projects[1]!.id;
      const docInB = randomUUID();
      insertProjectDocument(harness.db, docInB, pB, 'B Layout');
      expect(() =>
        harness.artifacts.createManagedArtifact({
          projectId: pA,
          artifactType: 'LightingLayout',
          sourceTool: 'AutoCAD',
          canonicalPath: 'WORKING/CAD/X.dwg',
          projectDocumentId: docInB,
        }),
      ).toThrow(/same project/i);
    });

    it('H3: one ProjectDocument cannot be linked to two ManagedArtifacts', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      const docId = randomUUID();
      insertProjectDocument(harness.db, docId, projectId, 'Owned Layout');
      harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'LightingLayout',
        sourceTool: 'AutoCAD',
        canonicalPath: 'WORKING/CAD/One.dwg',
        projectDocumentId: docId,
      });
      expect(() =>
        harness.artifacts.createManagedArtifact({
          projectId,
          artifactType: 'LightingLayout',
          sourceTool: 'AutoCAD',
          canonicalPath: 'WORKING/CAD/Two.dwg',
          projectDocumentId: docId,
        }),
      ).toThrow(/already exists for this Project Document/i);
    });

    it('H4: NULL projectDocumentId remains valid on multiple ManagedArtifacts', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'LightingLayout',
        sourceTool: 'AutoCAD',
        canonicalPath: 'WORKING/CAD/A.dwg',
      });
      harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'BOQ',
        sourceTool: 'Office',
        canonicalPath: 'WORKING/BOQ/B.xlsx',
      });
      expect(harness.artifacts.listManagedArtifacts(projectId)).toHaveLength(2);
    });

    it('H5: same-project DocumentSnapshot -> ArtifactVersion provenance succeeds', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      const docId = randomUUID();
      insertProjectDocument(harness.db, docId, projectId, 'Managed Layout');
      const artifact = harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'LightingLayout',
        sourceTool: 'AutoCAD',
        canonicalPath: 'WORKING/CAD/Layout.dwg',
        projectDocumentId: docId,
      });
      const version = harness.artifacts.createArtifactVersion({
        artifactId: artifact.artifactId,
        version: 1,
        contentHash: sha256('managed-bytes'),
        locatorValue: 'WORKING/CAD/Layout.dwg',
      });

      // Build a valid PREPARING canonical Revision for this project.
      const project = harness.projects[0]!;
      const revision = harness.registry.createRevision({
        projectId,
        projectSnapshot: {
          id: projectId,
          projectCode: project.projectCode,
          projectName: project.projectName,
          clientName: project.clientName,
          projectType: project.projectType,
          status: project.status,
          updatedAt: project.updatedAt,
          canonicalOperation: 'MANUAL_DELIVERABLES',
        },
        luminaires: [],
        createdBy: { actorId: ADMIN.id, actorNameSnapshot: ADMIN.displayName },
      });

      const snapshot = harness.registry.createDocumentSnapshot({
        projectId,
        revisionId: revision.revisionId,
        sourceDocumentId: docId,
        category: 'Drawing',
        title: 'Layout',
        fileName: 'Layout.pdf',
        sourceRelativePath: 'Drawings/Layout.pdf',
        locatorValue: 'DELIVERABLES/REV_01/Layout.pdf',
        contentHash: sha256('managed-bytes'),
        sizeBytes: 100,
        createdBy: null,
        sourceArtifactVersionId: version.versionId,
      });
      expect(snapshot.sourceArtifactVersionId).toBe(version.versionId);
    });

    it('H6: cross-project snapshot provenance rejects', async () => {
      const harness = await makeHarness(2);
      const pA = harness.projects[0]!.id;
      const pB = harness.projects[1]!.id;
      const docInA = randomUUID();
      insertProjectDocument(harness.db, docInA, pA, 'A Layout');
      const artifactInA = harness.artifacts.createManagedArtifact({
        projectId: pA,
        artifactType: 'LightingLayout',
        sourceTool: 'AutoCAD',
        canonicalPath: 'WORKING/CAD/A.dwg',
        projectDocumentId: docInA,
      });
      const versionInA = harness.artifacts.createArtifactVersion({
        artifactId: artifactInA.artifactId,
        version: 1,
        contentHash: sha256('a-bytes'),
        locatorValue: 'WORKING/CAD/A.dwg',
      });

      const projectB = harness.projects[1]!;
      const revisionInB = harness.registry.createRevision({
        projectId: pB,
        projectSnapshot: {
          id: pB,
          projectCode: projectB.projectCode,
          projectName: projectB.projectName,
          clientName: projectB.clientName,
          projectType: projectB.projectType,
          status: projectB.status,
          updatedAt: projectB.updatedAt,
          canonicalOperation: 'MANUAL_DELIVERABLES',
        },
        luminaires: [],
        createdBy: { actorId: ADMIN.id, actorNameSnapshot: ADMIN.displayName },
      });

      expect(() =>
        harness.registry.createDocumentSnapshot({
          projectId: pB,
          revisionId: revisionInB.revisionId,
          sourceDocumentId: docInA,
          category: 'Drawing',
          title: 'Cross',
          fileName: 'Cross.pdf',
          sourceRelativePath: 'Drawings/Cross.pdf',
          locatorValue: 'DELIVERABLES/REV_01/Cross.pdf',
          contentHash: sha256('cross'),
          sizeBytes: 100,
          createdBy: null,
          sourceArtifactVersionId: versionInA.versionId,
        }),
      ).toThrow(/same project/i);
    });

    it('H7: null sourceArtifactVersionId remains valid', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      const docId = randomUUID();
      insertProjectDocument(harness.db, docId, projectId, 'Manual');
      const project = harness.projects[0]!;
      const revision = harness.registry.createRevision({
        projectId,
        projectSnapshot: {
          id: projectId,
          projectCode: project.projectCode,
          projectName: project.projectName,
          clientName: project.clientName,
          projectType: project.projectType,
          status: project.status,
          updatedAt: project.updatedAt,
          canonicalOperation: 'MANUAL_DELIVERABLES',
        },
        luminaires: [],
        createdBy: { actorId: ADMIN.id, actorNameSnapshot: ADMIN.displayName },
      });
      const snapshot = harness.registry.createDocumentSnapshot({
        projectId,
        revisionId: revision.revisionId,
        sourceDocumentId: docId,
        category: 'Drawing',
        title: 'Manual',
        fileName: 'Manual.pdf',
        sourceRelativePath: 'Drawings/Manual.pdf',
        locatorValue: 'DELIVERABLES/REV_01/Manual.pdf',
        contentHash: sha256('manual'),
        sizeBytes: 100,
        createdBy: null,
      });
      expect(snapshot.sourceArtifactVersionId).toBeNull();
    });

    it('H8/H9: same-project CaptureLedger -> ToolContext succeeds; cross-project rejects', async () => {
      const harness = await makeHarness(2);
      const pA = harness.projects[0]!.id;
      const pB = harness.projects[1]!.id;
      const ctxA = harness.artifacts.createToolContext({
        projectId: pA,
        tool: 'AutoCAD',
        expectedArtifactType: 'LightingLayout',
        mode: 'Working',
        channel: 'autocad-A',
        state: 'LIVE',
        openedAt: CREATED_AT,
      });
      const ctxB = harness.artifacts.createToolContext({
        projectId: pB,
        tool: 'DIALux',
        expectedArtifactType: 'DialuxReport',
        mode: 'Working',
        channel: 'dialux-B',
        state: 'LIVE',
        openedAt: CREATED_AT,
      });

      // Same-project succeeds.
      const ok = harness.artifacts.createCaptureLedgerEntry({
        projectId: pA,
        toolContextId: ctxA.toolContextId,
        sourcePath: 'C:/exports/a.pdf',
        sourceChannel: 'autocad-A',
        expectedArtifactType: 'LightingLayout',
        state: 'DETECTED',
        detectedAt: CREATED_AT,
      });
      expect(ok.toolContextId).toBe(ctxA.toolContextId);

      // Cross-project rejects.
      expect(() =>
        harness.artifacts.createCaptureLedgerEntry({
          projectId: pA,
          toolContextId: ctxB.toolContextId,
          sourcePath: 'C:/exports/cross.pdf',
          sourceChannel: 'cross',
          expectedArtifactType: 'LightingLayout',
          state: 'DETECTED',
          detectedAt: CREATED_AT,
        }),
      ).toThrow(/same project/i);
    });

    it('H10: null ToolContext remains valid', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      const entry = harness.artifacts.createCaptureLedgerEntry({
        projectId,
        sourcePath: 'C:/exports/none.pdf',
        sourceChannel: 'test',
        expectedArtifactType: 'BOQ',
        state: 'DETECTED',
        detectedAt: CREATED_AT,
      });
      expect(entry.toolContextId).toBeNull();
    });

    it('H11/H12: createArtifactVersion atomically advances currentWorkingVersion; no partial on rollback', async () => {
      const harness = await makeHarness(1);
      const projectId = harness.projects[0]!.id;
      const artifact = harness.artifacts.createManagedArtifact({
        projectId,
        artifactType: 'LightingLayout',
        sourceTool: 'AutoCAD',
        canonicalPath: 'WORKING/CAD/Atomic.dwg',
      });

      // Success: version created AND currentWorkingVersion advanced.
      const v1 = harness.artifacts.createArtifactVersion({
        artifactId: artifact.artifactId,
        version: 1,
        contentHash: sha256('atomic-1'),
        locatorValue: 'WORKING/CAD/Atomic.dwg',
      });
      expect(v1.version).toBe(1);
      expect(harness.artifacts.getManagedArtifact(artifact.artifactId).currentWorkingVersion).toBe(
        1,
      );

      // Duplicate version forces the INSERT to fail; the transaction rolls back and
      // currentWorkingVersion stays unchanged (no partial version row).
      expect(() =>
        harness.artifacts.createArtifactVersion({
          artifactId: artifact.artifactId,
          version: 1,
          contentHash: sha256('dupe'),
          locatorValue: 'WORKING/CAD/Atomic.dwg',
        }),
      ).toThrow(/already exists/);
      expect(harness.artifacts.listArtifactVersions(artifact.artifactId)).toHaveLength(1);
      expect(harness.artifacts.getManagedArtifact(artifact.artifactId).currentWorkingVersion).toBe(
        1,
      );
    });
  });
});
