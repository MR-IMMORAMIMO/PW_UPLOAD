import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '@scli/config';
import type { AppUser, Project, RevisionDeleteState } from '@scli/domain';
import { seedProjects, seedUserIds, seedUsers } from '@scli/test-data';
import type { DatabaseSync } from 'node:sqlite';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeleteService } from './infrastructure/output-registry/RevisionDeleteService';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';
import { RevisionReuseService } from './infrastructure/output-registry/RevisionReuseService';
import {
  PRODUCTION_V4_DDL,
  PRODUCTION_V13_DDL,
  PRODUCTION_V14_DDL,
  PRODUCTION_V15_DDL,
  applyV12IssueAuditColumns,
  applyV15SnapshotProvenanceColumn,
  applyV16SnapshotRebuild,
  applyV17RevisionDeleteTable,
  applyV18RevisionReuseColumns,
  applyV19RevisionMetadataColumns,
} from './infrastructure/migration/registry/production-migration-registry';

const owner = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;
const unauthorized = seedUsers.find((candidate) => candidate.role === 'Designer') as AppUser;
const NOW = '2026-08-22T08:00:00.000Z';

interface Harness {
  root: string;
  store: PersonalWorkspaceStore;
  database: DatabaseSync;
  registry: CanonicalOutputRegistryStore;
  deliverables: RevisionDeliverableService;
  deletion: RevisionDeleteService;
  reuse: RevisionReuseService;
  project: Project;
}

const stores: PersonalWorkspaceStore[] = [];
const roots: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) await apps.pop()?.close();
  while (stores.length) stores.pop()?.close();
  while (roots.length) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-revreuse-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  mkdirSync(projectRoot);
  const store = new PersonalWorkspaceStore(
    loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    }),
  );
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
  applyV18RevisionReuseColumns(database);
  applyV19RevisionMetadataColumns(database);
  database.exec('PRAGMA foreign_keys = ON');
  const registry = new CanonicalOutputRegistryStore(
    database,
    { now: () => new Date(NOW) },
    'CANONICAL',
  );
  registry.registerBuiltInTemplateVersions();
  const deliverables = new RevisionDeliverableService(store, registry);
  const deletion = new RevisionDeleteService(store, registry, () => new Date(NOW));
  const reuse = new RevisionReuseService(store, registry, () => new Date(NOW));
  return { root, store, database, registry, deliverables, deletion, reuse, project };
}

function prepare(harness: Harness) {
  return harness.deliverables.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    owner,
  );
}

async function safelyDelete(harness: Harness, revisionId: string) {
  const result = await harness.deletion.deleteRevision(harness.project, revisionId, owner);
  expect(result.outcome).toBe('DELETED');
  return result.operation;
}

function claim(harness: Harness, operationId: string, reason = 'Accidental duplicate') {
  return harness.reuse.reuseRevision(harness.project, owner, {
    deleteOperationId: operationId,
    reason,
  });
}

describe('P2C-04 Revision Number Reuse', () => {
  it('offers only the latest completed tombstone and creates a fresh empty manual Revision', async () => {
    const harness = createHarness();
    const deleted = prepare(harness);
    const operation = await safelyDelete(harness, deleted.revisionId);

    expect(harness.reuse.eligibility(harness.project, owner).candidate).toEqual({
      deleteOperationId: operation.operationId,
      revisionSequence: deleted.revisionSequence,
      revisionLabel: deleted.revisionLabel,
      deletedRevisionId: deleted.revisionId,
      deletedAt: NOW,
    });

    const replacement = claim(harness, operation.operationId, '  Accidental duplicate  ');
    expect(replacement.revisionId).not.toBe(deleted.revisionId);
    expect(replacement.revisionSequence).toBe(deleted.revisionSequence);
    expect(replacement.revisionLabel).toBe(deleted.revisionLabel);
    expect(replacement.lifecycleState).toBe('PREPARING');
    expect(replacement.projectSnapshot?.canonicalOperation).toBe('MANUAL_DELIVERABLES');
    expect(replacement.purpose).toBeNull();
    expect(replacement.internalNote).toBeNull();
    expect(harness.registry.listOutputsForRevision(replacement.revisionId)).toEqual([]);
    expect(harness.registry.listDocumentSnapshotsForRevision(replacement.revisionId)).toEqual([]);

    const claimed = harness.registry.getRevisionDeleteOperation(operation.operationId);
    expect(claimed.state).toBe('COMPLETED');
    expect(claimed.reusedByRevisionId).toBe(replacement.revisionId);
    expect(claimed.reusedAt).toBe(NOW);
    expect(claimed.reusedByActorId).toBe(owner.id);
    expect(claimed.reusedByActorName).toBe(owner.displayName);
    expect(claimed.reuseReason).toBe('Accidental duplicate');
    expect(harness.reuse.eligibility(harness.project, owner).candidate).toBeNull();
    const activity = harness.database
      .prepare("SELECT * FROM workspace_activity WHERE action = 'REV_SEQUENCE_REUSED'")
      .get() as Record<string, unknown>;
    expect(activity.entity_id).toBe(replacement.revisionId);
  });

  it('supports repeated immediate reuse with one claim per delete operation', async () => {
    const harness = createHarness();
    const a = prepare(harness);
    const operationA = await safelyDelete(harness, a.revisionId);
    const b = claim(harness, operationA.operationId, 'Replace A');
    const operationB = await safelyDelete(harness, b.revisionId);
    const c = claim(harness, operationB.operationId, 'Replace B');

    expect(new Set([a.revisionId, b.revisionId, c.revisionId]).size).toBe(3);
    expect([a.revisionSequence, b.revisionSequence, c.revisionSequence]).toEqual([1, 1, 1]);
    expect(
      harness.registry.getRevisionDeleteOperation(operationA.operationId).reusedByRevisionId,
    ).toBe(b.revisionId);
    expect(
      harness.registry.getRevisionDeleteOperation(operationB.operationId).reusedByRevisionId,
    ).toBe(c.revisionId);
    expect(harness.registry.listRevisionDeleteOperations(harness.project.id)).toHaveLength(2);
    expect(() => claim(harness, operationA.operationId, 'Claim again')).toThrow(
      /no longer reusable/i,
    );
  });

  it('normal Create remains max-plus-one and immediately closes the reuse window', async () => {
    const harness = createHarness();
    const first = prepare(harness);
    const operation = await safelyDelete(harness, first.revisionId);
    expect(harness.reuse.eligibility(harness.project, owner).candidate?.revisionSequence).toBe(1);

    const normal = prepare(harness);
    expect(normal.revisionSequence).toBe(2);
    expect(normal.lifecycleState).toBe('PREPARING');
    expect(harness.reuse.eligibility(harness.project, owner).candidate).toBeNull();
    expect(() => claim(harness, operation.operationId, 'Stale claim')).toThrow(
      /no longer reusable/i,
    );
  });

  it('never offers an old gap after the project high-water has advanced', async () => {
    const harness = createHarness();
    const first = prepare(harness);
    const operation = await safelyDelete(harness, first.revisionId);
    prepare(harness);
    prepare(harness);
    expect(
      harness.registry.listRevisions(harness.project.id).map((r) => r.revisionSequence),
    ).toEqual([3, 2]);
    expect(harness.reuse.eligibility(harness.project, owner).candidate).toBeNull();
    expect(() => claim(harness, operation.operationId)).toThrow(/no longer reusable/i);
  });

  it.each<RevisionDeleteState>([
    'PLANNED',
    'ARCHIVING',
    'ARCHIVED',
    'DB_COMMITTED',
    'FAILED_RECOVERABLE',
  ])('%s delete state is never reusable', async (state) => {
    const harness = createHarness();
    const revision = prepare(harness);
    const operation = await safelyDelete(harness, revision.revisionId);
    harness.database
      .prepare('UPDATE revision_delete_operations SET state = ? WHERE operation_id = ?')
      .run(state, operation.operationId);
    expect(harness.reuse.eligibility(harness.project, owner).candidate).toBeNull();
    expect(() => claim(harness, operation.operationId)).toThrow(/no longer reusable/i);
  });

  it('fails closed for project_revisions, project_exports, and revision_packages sequence history', async () => {
    for (const authority of [
      'project_revisions',
      'project_exports',
      'revision_packages',
    ] as const) {
      const harness = createHarness();
      const revision = prepare(harness);
      const operation = await safelyDelete(harness, revision.revisionId);
      if (authority === 'project_revisions') {
        harness.database
          .prepare(
            `INSERT INTO project_revisions
             (id, project_id, revision_number, title, status, summary, change_log, source_type,
              source_reference, created_at, updated_at)
             VALUES (?, ?, 1, 'Legacy', 'Draft', '', '', 'Legacy', '', ?, ?)`,
          )
          .run('a0000000-0000-4000-8000-000000000101', harness.project.id, NOW, NOW);
      } else if (authority === 'project_exports') {
        harness.database
          .prepare(
            `INSERT INTO project_exports
             (id, project_id, revision, excel_path, pdf_path, datasheet_folder, created_at)
             VALUES (?, ?, 1, '', '', '', ?)`,
          )
          .run('a0000000-0000-4000-8000-000000000102', harness.project.id, NOW);
      } else {
        harness.database
          .prepare(
            `INSERT INTO revision_packages
             (id, project_id, revision_number, label, output_mode, folder_path, zip_path,
              item_count, total_bytes, package_hash, warning_override_reason, manifest_json,
              created_at)
             VALUES (?, ?, 1, 'Legacy', 'Folder', '', '', 0, 0, '', '', '[]', ?)`,
          )
          .run('a0000000-0000-4000-8000-000000000103', harness.project.id, NOW);
      }
      expect(harness.reuse.eligibility(harness.project, owner).candidate).toBeNull();
      expect(() => claim(harness, operation.operationId)).toThrow(/no longer reusable/i);
    }
  });

  it('enforces Owner/Manager authorization and a non-blank reason', async () => {
    const harness = createHarness();
    const revision = prepare(harness);
    const operation = await safelyDelete(harness, revision.revisionId);
    expect(() => harness.reuse.eligibility(harness.project, unauthorized)).toThrow(
      /authorization is required/i,
    );
    expect(() =>
      harness.reuse.reuseRevision(harness.project, unauthorized, {
        deleteOperationId: operation.operationId,
        reason: 'Unauthorized',
      }),
    ).toThrow(/authorization is required/i);
    expect(() => claim(harness, operation.operationId, '   ')).toThrow(/1 to 500/i);
    expect(
      harness.registry.getRevisionDeleteOperation(operation.operationId).reusedByRevisionId,
    ).toBeNull();
  });

  it('serializes a double claim so exactly one succeeds', async () => {
    const harness = createHarness();
    const revision = prepare(harness);
    const operation = await safelyDelete(harness, revision.revisionId);
    const attempts = await Promise.allSettled([
      Promise.resolve().then(() => claim(harness, operation.operationId, 'First')),
      Promise.resolve().then(() => claim(harness, operation.operationId, 'Second')),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(harness.registry.listRevisions(harness.project.id)).toHaveLength(1);
  });

  it.each([
    {
      name: 'Revision insert',
      trigger:
        "CREATE TRIGGER test_reuse_insert BEFORE INSERT ON canonical_revisions BEGIN SELECT RAISE(ABORT, 'insert failure'); END",
    },
    {
      name: 'tombstone provenance update',
      trigger:
        "CREATE TRIGGER test_reuse_claim BEFORE UPDATE OF reused_by_revision_id ON revision_delete_operations BEGIN SELECT RAISE(ABORT, 'claim failure'); END",
    },
    {
      name: 'activity write',
      trigger:
        "CREATE TRIGGER test_reuse_activity BEFORE INSERT ON workspace_activity WHEN NEW.action = 'REV_SEQUENCE_REUSED' BEGIN SELECT RAISE(ABORT, 'activity failure'); END",
    },
  ])(
    '$name failure rolls back the entire claim and leaves the sequence reusable',
    async ({ trigger }) => {
      const harness = createHarness();
      const revision = prepare(harness);
      const operation = await safelyDelete(harness, revision.revisionId);
      harness.database.exec(trigger);
      expect(() => claim(harness, operation.operationId)).toThrow();
      expect(harness.registry.listRevisions(harness.project.id)).toEqual([]);
      expect(
        harness.registry.getRevisionDeleteOperation(operation.operationId).reusedByRevisionId,
      ).toBeNull();
      expect(harness.reuse.eligibility(harness.project, owner).candidate?.deleteOperationId).toBe(
        operation.operationId,
      );
    },
  );

  it('persists eligibility and claim state across service/registry restart boundaries', async () => {
    const harness = createHarness();
    const revision = prepare(harness);
    const operation = await safelyDelete(harness, revision.revisionId);
    const restartedRegistry = new CanonicalOutputRegistryStore(
      harness.database,
      { now: () => new Date(NOW) },
      'CANONICAL',
    );
    const restarted = new RevisionReuseService(
      harness.store,
      restartedRegistry,
      () => new Date(NOW),
    );
    expect(restarted.eligibility(harness.project, owner).candidate?.deleteOperationId).toBe(
      operation.operationId,
    );
    const replacement = restarted.reuseRevision(harness.project, owner, {
      deleteOperationId: operation.operationId,
      reason: 'Restart proof',
    });
    const afterRestart = new RevisionReuseService(
      harness.store,
      new CanonicalOutputRegistryStore(harness.database, { now: () => new Date(NOW) }, 'CANONICAL'),
      () => new Date(NOW),
    );
    expect(afterRestart.eligibility(harness.project, owner).candidate).toBeNull();
    expect(
      harness.registry.getRevisionDeleteOperation(operation.operationId).reusedByRevisionId,
    ).toBe(replacement.revisionId);
  });

  it('exposes strict project-scoped API contracts and rejects direct unauthorized calls', async () => {
    const harness = createHarness();
    const revision = prepare(harness);
    const operation = await safelyDelete(harness, revision.revisionId);
    const config = loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'false',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      COMPANY_TIMEZONE: 'Asia/Dubai',
    });
    const app = await createApp({
      config,
      provider: new MockDataProvider(),
      personalStore: harness.store,
      canonicalOutputRegistry: harness.registry,
      revisionDeliverableService: harness.deliverables,
      revisionDeleteService: harness.deletion,
      revisionReuseService: harness.reuse,
      clock: () => new Date(NOW),
    });
    apps.push(app);

    const deniedRead = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.project.id}/revisions/reuse-eligibility`,
      headers: { 'x-mock-user-id': seedUserIds.designerOne },
    });
    expect(deniedRead.statusCode).toBe(403);
    const deniedMutation = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/revisions/reuse`,
      headers: { 'x-mock-user-id': seedUserIds.designerOne },
      payload: { deleteOperationId: operation.operationId, reason: 'Direct call' },
    });
    expect(deniedMutation.statusCode).toBe(403);

    const eligibility = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.project.id}/revisions/reuse-eligibility`,
      headers: { 'x-mock-user-id': seedUserIds.admin },
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json().data.candidate.deleteOperationId).toBe(operation.operationId);

    const overPosted = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/revisions/reuse`,
      headers: { 'x-mock-user-id': seedUserIds.admin },
      payload: {
        deleteOperationId: operation.operationId,
        reason: 'Attempted override',
        revisionSequence: 99,
      },
    });
    expect(overPosted.statusCode).toBe(400);
    expect(
      harness.registry.getRevisionDeleteOperation(operation.operationId).reusedByRevisionId,
    ).toBeNull();

    const reused = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/revisions/reuse`,
      headers: { 'x-mock-user-id': seedUserIds.admin },
      payload: { deleteOperationId: operation.operationId, reason: 'API approved reuse' },
    });
    expect(reused.statusCode).toBe(201);
    expect(reused.json().data).toMatchObject({
      revisionSequence: revision.revisionSequence,
      revisionLabel: revision.revisionLabel,
      lifecycleState: 'PREPARING',
    });
    expect(reused.json().data.revisionId).not.toBe(revision.revisionId);
  });
});
