import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { AppUser, Project } from '@scli/domain';
import { seedProjects, seedUserIds, seedUsers } from '@scli/test-data';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
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
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { IssueHistoryService } from './infrastructure/output-registry/IssueHistoryService';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';

const project = structuredClone(
  seedProjects.find((candidate) => candidate.salesOwnerId === seedUserIds.salesOne)!,
);
const owner = seedUsers.find((candidate) => candidate.id === seedUserIds.salesOne) as AppUser;
const NOW = '2026-08-22T09:00:00.000Z';

interface Harness {
  store: PersonalWorkspaceStore;
  project: Project;
  registry: CanonicalOutputRegistryStore;
  deliverables: RevisionDeliverableService;
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
  const root = mkdtempSync(path.join(tmpdir(), 'scli-p2c07-'));
  roots.push(root);
  const store = new PersonalWorkspaceStore(
    loadConfig({
      APP_MODE: 'standalone',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      STANDALONE_DB_PATH: path.join(root, 'workspace.sqlite'),
    }),
  );
  stores.push(store);
  store.initializeProject(
    project.id,
    ['LuminaireSchedule', 'TechnicalBoq'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
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
  const registry = new CanonicalOutputRegistryStore(
    database,
    { now: () => new Date(NOW) },
    'CANONICAL',
  );
  registry.registerBuiltInTemplateVersions();
  const deliverables = new RevisionDeliverableService(store, registry);
  return { store, project, registry, deliverables };
}

function prepare(
  harness: Harness,
  metadata: { purpose?: string | null; internalNote?: string | null } = {},
) {
  return harness.deliverables.prepareRevision(
    harness.project,
    harness.store.getWorkspace(harness.project.id),
    owner,
    metadata,
  );
}

function markFinalized(harness: Harness, revisionId: string): void {
  harness.store
    .getSharedDatabase()
    .prepare(
      `UPDATE canonical_revisions
       SET lifecycle_state = 'FINALIZED', finalized_at = ?, updated_at = ?
       WHERE revision_id = ?`,
    )
    .run(NOW, NOW, revisionId);
}

describe('P2C-07 canonical Revision metadata', () => {
  it('creates optional normalized metadata and persists NULL for absence', () => {
    const harness = createHarness();
    const withMetadata = prepare(harness, {
      purpose: '  Tender issue  ',
      internalNote: '  Check wall-washer setback.\nWaiting for IES.  ',
    });
    expect(withMetadata).toMatchObject({
      purpose: 'Tender issue',
      internalNote: 'Check wall-washer setback.\nWaiting for IES.',
      lifecycleState: 'PREPARING',
    });

    const empty = prepare(harness, { purpose: '   ', internalNote: '\n\t' });
    expect(empty.purpose).toBeNull();
    expect(empty.internalNote).toBeNull();
  });

  it('updates one or both fields, preserves omissions, and clears blank values to NULL', () => {
    const harness = createHarness();
    const revision = prepare(harness, { purpose: 'Tender', internalNote: 'Private' });
    expect(
      harness.registry.updateRevisionMetadata(harness.project.id, revision.revisionId, {
        purpose: '  Client comments  ',
      }),
    ).toMatchObject({ purpose: 'Client comments', internalNote: 'Private' });
    expect(
      harness.registry.updateRevisionMetadata(harness.project.id, revision.revisionId, {
        internalNote: '  Line one\nLine two  ',
      }),
    ).toMatchObject({ purpose: 'Client comments', internalNote: 'Line one\nLine two' });
    expect(
      harness.registry.updateRevisionMetadata(harness.project.id, revision.revisionId, {
        purpose: ' ',
        internalNote: null,
      }),
    ).toMatchObject({ purpose: null, internalNote: null });
  });

  it('fails closed for wrong Project, wrong Revision UUID, finalized, failed and legacy records', () => {
    const harness = createHarness();
    const revision = prepare(harness);
    expect(() =>
      harness.registry.updateRevisionMetadata(
        '00000000-0000-4000-8000-000000000099',
        revision.revisionId,
        { purpose: 'Wrong project' },
      ),
    ).toThrow(/not found in this Project/i);
    expect(() =>
      harness.registry.updateRevisionMetadata(
        harness.project.id,
        '00000000-0000-4000-8000-000000000098',
        { purpose: 'Wrong revision' },
      ),
    ).toThrow(/not found/i);

    markFinalized(harness, revision.revisionId);
    expect(() =>
      harness.registry.updateRevisionMetadata(harness.project.id, revision.revisionId, {
        purpose: 'Stale update',
      }),
    ).toThrow(/only while.*PREPARING/i);

    const failed = prepare(harness);
    harness.registry.setRevisionLifecycle(failed.revisionId, 'FAILED_RECOVERABLE', 'Interrupted');
    expect(() =>
      harness.registry.updateRevisionMetadata(harness.project.id, failed.revisionId, {
        internalNote: 'Bypass',
      }),
    ).toThrow(/only while.*PREPARING/i);

    const legacyId = 'c0000000-0000-4000-8000-000000000011';
    harness.store
      .getSharedDatabase()
      .prepare(
        `INSERT INTO canonical_revisions
         (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
          project_snapshot_json, luminaire_snapshot_json, snapshot_hash, created_by_id,
          created_by_name, provenance_classification, legacy_source_id, failure_reason,
          created_at, finalized_at, updated_at, purpose, internal_note)
         VALUES (?, ?, 50, 'REV_50', 'LEGACY_IMPORTED', NULL, NULL, NULL, NULL, NULL,
                 'LEGACY_UNVERIFIED', 'legacy-50', NULL, ?, NULL, ?, NULL, NULL)`,
      )
      .run(legacyId, harness.project.id, NOW, NOW);
    expect(() =>
      harness.registry.updateRevisionMetadata(harness.project.id, legacyId, {
        purpose: 'Fabricated history',
      }),
    ).toThrow(/not found in this Project/i);
  });

  it('projects Purpose but never Internal Note into Issue History/package context', () => {
    const harness = createHarness();
    const revision = prepare(harness, {
      purpose: 'Facade coordination update',
      internalNote: 'PRIVATE: wait for manufacturer response',
    });
    markFinalized(harness, revision.revisionId);
    harness.registry.createIssuePackage({
      revisionId: revision.revisionId,
      label: 'Tender package',
      artifactRelativePath: null,
      manifestRelativePath: null,
      issuedBy: null,
      issuedAt: null,
    });
    const history = new IssueHistoryService(harness.registry).list(harness.project.id);
    expect(history[0]?.revision.purpose).toBe('Facade coordination update');
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain('internalNote');
    expect(serialized).not.toContain('PRIVATE: wait for manufacturer response');
  });

  it('supports authorized create/update routes and rejects an unrelated Sales actor', async () => {
    const harness = createHarness();
    const app = await createApp({
      config: loadConfig({
        APP_MODE: 'mock',
        WORKSPACE_VARIANT: 'personal',
        PERSONAL_AUTO_LOGIN: 'false',
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        WEB_ORIGIN: 'http://127.0.0.1:5173',
      }),
      provider: new MockDataProvider(),
      personalStore: harness.store,
      canonicalOutputRegistry: harness.registry,
      revisionDeliverableService: harness.deliverables,
      clock: () => new Date(NOW),
    });
    apps.push(app);

    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/revisions/prepare`,
      headers: { 'x-mock-user-id': seedUserIds.salesOne },
      payload: { purpose: '  Client update  ', internalNote: '  Private line  ' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      purpose: 'Client update',
      internalNote: 'Private line',
    });
    const revisionId = created.json().data.revisionId as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${harness.project.id}/revisions/${revisionId}/metadata`,
      headers: { 'x-mock-user-id': seedUserIds.salesOne },
      payload: { purpose: 'Tender issue' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      revisionId,
      purpose: 'Tender issue',
      internalNote: 'Private line',
    });

    const workspaceResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.project.id}/revisions`,
      headers: { 'x-mock-user-id': seedUserIds.salesOne },
    });
    expect(workspaceResponse.statusCode).toBe(200);
    expect(workspaceResponse.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revisionId,
          purpose: 'Tender issue',
          internalNote: 'Private line',
        }),
      ]),
    );

    const packageResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.project.id}/package-revisions`,
      headers: { 'x-mock-user-id': seedUserIds.salesOne },
    });
    expect(packageResponse.statusCode).toBe(200);
    expect(packageResponse.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revisionId,
          revisionSequence: expect.any(Number),
          revisionLabel: expect.any(String),
          purpose: 'Tender issue',
          lifecycleState: 'PREPARING',
          finalizedAt: null,
          luminaireCount: expect.any(Number),
        }),
      ]),
    );
    const serializedPackageResponse = JSON.stringify(packageResponse.json().data);
    expect(serializedPackageResponse).not.toContain('internalNote');
    expect(serializedPackageResponse).not.toContain('Private line');

    const denied = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${harness.project.id}/revisions/${revisionId}/metadata`,
      headers: { 'x-mock-user-id': seedUserIds.salesTwo },
      payload: { purpose: 'Unauthorized' },
    });
    expect(denied.statusCode).toBe(403);
    expect(harness.registry.getRevision(revisionId).purpose).toBe('Tender issue');
  });
});
