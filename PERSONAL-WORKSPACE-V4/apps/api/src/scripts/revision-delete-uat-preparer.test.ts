import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { AppUser, Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { PersonalWorkspaceStore } from '../personal-workspace-store';
import { CanonicalOutputRegistryStore } from '../infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeleteService } from '../infrastructure/output-registry/RevisionDeleteService';
import { RevisionDeliverableService } from '../infrastructure/output-registry/RevisionDeliverableService';
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
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from '../infrastructure/migration/registry/production-migration-registry';
import {
  assertRevisionDeleteUatCliIntent,
  assertRevisionDeleteUatSchema,
  parseRevisionDeleteUatArgs,
} from './revision-delete-uat-prepare-cli';
import {
  REVISION_DELETE_UAT_CONFIRMATION,
  REVISION_DELETE_UAT_GOLDEN_PROJECT_ID,
  REVISION_DELETE_UAT_TEST_PROJECT_CODE,
  REVISION_DELETE_UAT_TEST_PROJECT_ID,
  RevisionDeleteUatPreparer,
} from './revision-delete-uat-preparer';

const actor = seedUsers.find((candidate) => candidate.role === 'Admin') as AppUser;
const temporaryRoots: string[] = [];
const stores: PersonalWorkspaceStore[] = [];

afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (temporaryRoots.length) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

interface Harness {
  readonly root: string;
  readonly projectRoot: string;
  readonly project: Project;
  readonly store: PersonalWorkspaceStore;
  readonly registry: CanonicalOutputRegistryStore;
  readonly deliverables: RevisionDeliverableService;
  readonly preparer: RevisionDeleteUatPreparer;
}

function applySchema(database: DatabaseSync): void {
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
  database.exec(
    `PRAGMA user_version = ${PRODUCTION_SCHEMA_TARGET_VERSION}; PRAGMA foreign_keys = ON;`,
  );
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    ...structuredClone(seedProjects[0]!),
    id: REVISION_DELETE_UAT_TEST_PROJECT_ID,
    projectCode: REVISION_DELETE_UAT_TEST_PROJECT_CODE,
    ...overrides,
  };
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-revdelete-uat-'));
  temporaryRoots.push(root);
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
  applySchema(store.getSharedDatabase());
  const project = makeProject();
  store.initializeProject(
    project.id,
    ['LuminaireSchedule', 'TechnicalBoq'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
  store.setFolderPath(project.id, projectRoot);
  const registry = new CanonicalOutputRegistryStore(
    store.getSharedDatabase(),
    undefined,
    'CANONICAL',
  );
  const deliverables = new RevisionDeliverableService(store, registry);
  const deletion = new RevisionDeleteService(
    store,
    registry,
    () => new Date('2026-08-22T12:00:00.000Z'),
  );
  return {
    root,
    projectRoot,
    project,
    store,
    registry,
    deliverables,
    preparer: new RevisionDeleteUatPreparer(registry, deletion),
  };
}

function prepareRevision(harness: Harness, project = harness.project) {
  return harness.deliverables.prepareRevision(
    project,
    harness.store.getWorkspace(project.id),
    actor,
  );
}

describe('Revision Delete UAT CLI guards', () => {
  it('uses the current production schema target instead of a duplicated version literal', () => {
    expect(() =>
      assertRevisionDeleteUatSchema({
        schemaAtTarget: true,
        detectedSchemaVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
      }),
    ).not.toThrow();
    expect(() =>
      assertRevisionDeleteUatSchema({ schemaAtTarget: false, detectedSchemaVersion: 18 }),
    ).toThrow(`requires schema v${PRODUCTION_SCHEMA_TARGET_VERSION}`);
  });

  it('accepts only the exact TEST UUID, explicit Revision UUID, confirmation, and non-production environment', () => {
    const args = parseRevisionDeleteUatArgs([
      '--project-id',
      REVISION_DELETE_UAT_TEST_PROJECT_ID,
      '--revision-id',
      'c2000000-0000-4000-8000-000000000001',
      `--confirm=${REVISION_DELETE_UAT_CONFIRMATION}`,
    ]);
    expect(() => assertRevisionDeleteUatCliIntent(args, { NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertRevisionDeleteUatCliIntent(args, { NODE_ENV: 'production' })).toThrow(
      /unavailable under NODE_ENV=production/,
    );
  });

  it('hard-rejects Golden and arbitrary projects before database startup', () => {
    const revisionId = 'c2000000-0000-4000-8000-000000000001';
    const golden = parseRevisionDeleteUatArgs([
      '--project-id',
      REVISION_DELETE_UAT_GOLDEN_PROJECT_ID,
      '--revision-id',
      revisionId,
      `--confirm=${REVISION_DELETE_UAT_CONFIRMATION}`,
    ]);
    expect(() => assertRevisionDeleteUatCliIntent(golden, { NODE_ENV: 'test' })).toThrow(
      /Golden project is hard-rejected/,
    );

    const arbitrary = parseRevisionDeleteUatArgs([
      '--project-id',
      'c2000000-0000-4000-8000-000000000099',
      '--revision-id',
      revisionId,
      `--confirm=${REVISION_DELETE_UAT_CONFIRMATION}`,
    ]);
    expect(() => assertRevisionDeleteUatCliIntent(arbitrary, { NODE_ENV: 'test' })).toThrow(
      /--project-id must be exactly/,
    );
  });
});

describe('Revision Delete UAT preparation', () => {
  it('uses the real operation and manifest, archives members, and stops exactly at ARCHIVED', async () => {
    const harness = createHarness();
    const sourceRelative = 'Drawings/UAT-Source.pdf';
    const sourcePath = path.join(harness.projectRoot, sourceRelative);
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, 'uat-source-bytes');
    const document = harness.store.operations.createDocument(harness.project.id, {
      category: 'Drawing',
      documentNumber: '',
      title: 'UAT Source',
      revision: 'A',
      status: 'Working',
      filePath: sourceRelative,
      issuedTo: '',
      issueDate: null,
      notes: '',
    });
    const revision = prepareRevision(harness);
    const snapshot = await harness.deliverables.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id, title: 'UAT Snapshot' },
    );
    const ownedPath = path.join(harness.projectRoot, snapshot.locatorValue);
    const beforeSchema = (
      harness.store.getSharedDatabase().prepare('PRAGMA user_version').get() as {
        user_version: number;
      }
    ).user_version;

    const result = await harness.preparer.prepare(harness.project, revision.revisionId, actor);

    expect(result).toMatchObject({
      projectId: REVISION_DELETE_UAT_TEST_PROJECT_ID,
      revisionId: revision.revisionId,
      operationState: 'ARCHIVED',
      archivedMemberCount: 1,
      nextRequiredStep: 'RESTART DESKTOP APPLICATION',
    });
    const operation = harness.registry.getRevisionDeleteOperation(result.operationId);
    expect(operation.state).toBe('ARCHIVED');
    expect(operation.failureReason).toBeNull();
    expect(operation.artifactManifest).toEqual({
      revisionId: revision.revisionId,
      items: [
        expect.objectContaining({
          rowId: snapshot.deliverableId,
          locatorValue: snapshot.locatorValue,
          contentHash: snapshot.contentHash,
          archiveDestination: expect.stringMatching(
            new RegExp(`^INTERNAL/REVISION_DELETE_ARCHIVE/${result.operationId}/`),
          ),
        }),
      ],
    });
    const archivedPath = path.join(
      harness.projectRoot,
      operation.artifactManifest.items[0]!.archiveDestination,
    );
    expect(existsSync(ownedPath)).toBe(false);
    expect(readFileSync(archivedPath, 'utf8')).toBe('uat-source-bytes');
    expect(readFileSync(sourcePath, 'utf8')).toBe('uat-source-bytes');
    expect(harness.registry.getRevision(revision.revisionId).revisionId).toBe(revision.revisionId);
    expect(harness.registry.getDocumentSnapshot(snapshot.deliverableId).deliverableId).toBe(
      snapshot.deliverableId,
    );
    expect(
      (
        harness.store.getSharedDatabase().prepare('PRAGMA user_version').get() as {
          user_version: number;
        }
      ).user_version,
    ).toBe(beforeSchema);

    await expect(
      harness.preparer.prepare(harness.project, revision.revisionId, actor),
    ).rejects.toThrow(/already has operation .* state ARCHIVED/);
    expect(harness.registry.listRevisionDeleteOperations(harness.project.id)).toHaveLength(1);
    expect(readdirSync(path.dirname(archivedPath))).toHaveLength(1);
  });

  it('rejects wrong-project Revision UUIDs and ordinary Safe Delete blockers', async () => {
    const harness = createHarness();
    const otherProject = makeProject({
      id: 'c2000000-0000-4000-8000-000000000020',
      projectCode: 'OTHER_PROJECT',
    });
    harness.store.initializeProject(
      otherProject.id,
      ['LuminaireSchedule'],
      'Full Lighting Design',
      'Manual',
      otherProject.requiredDeliveryDate,
    );
    harness.store.setFolderPath(otherProject.id, path.join(harness.root, 'other-project'));
    mkdirSync(path.join(harness.root, 'other-project'));
    const foreignRevision = prepareRevision(harness, otherProject);
    await expect(
      harness.preparer.prepare(harness.project, foreignRevision.revisionId, actor),
    ).rejects.toThrow(/does not belong to the allowlisted TEST project/);

    const ineligible = prepareRevision(harness);
    harness.store.operations.recordCanonicalRevisionProjection(
      harness.project.id,
      ineligible.revisionId,
      ineligible.revisionSequence,
      {
        revisionNumber: ineligible.revisionSequence,
        reissueNumber: 0,
        title: 'UAT blocker',
        status: 'Draft',
        receivedAt: null,
        dueDate: null,
        issuedAt: null,
        summary: '',
        changeLog: '',
        sourceType: 'Manual',
        sourceReference: '',
      },
      ineligible.createdAt,
    );
    await expect(
      harness.preparer.prepare(harness.project, ineligible.revisionId, actor),
    ).rejects.toThrow(/COMPATIBILITY_HISTORY_EXISTS/);

    const unsafeSourceRelative = 'Drawings/Missing-Owned-Copy.pdf';
    const unsafeSourcePath = path.join(harness.projectRoot, unsafeSourceRelative);
    mkdirSync(path.dirname(unsafeSourcePath), { recursive: true });
    writeFileSync(unsafeSourcePath, 'source-remains-safe');
    const unsafeDocument = harness.store.operations.createDocument(harness.project.id, {
      category: 'Drawing',
      documentNumber: '',
      title: 'Missing owned copy',
      revision: 'A',
      status: 'Working',
      filePath: unsafeSourceRelative,
      issuedTo: '',
      issueDate: null,
      notes: '',
    });
    const unsafeRevision = prepareRevision(harness);
    const unsafeSnapshot = await harness.deliverables.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      unsafeRevision.revisionId,
      { sourceDocumentId: unsafeDocument.id, title: 'Missing owned copy' },
    );
    rmSync(path.join(harness.projectRoot, unsafeSnapshot.locatorValue), { force: true });
    await expect(
      harness.preparer.prepare(harness.project, unsafeRevision.revisionId, actor),
    ).rejects.toThrow(/ARTIFACT_OWNERSHIP_UNPROVEN/);
    expect(readFileSync(unsafeSourcePath, 'utf8')).toBe('source-remains-safe');
    expect(harness.registry.listRevisionDeleteOperations(harness.project.id)).toHaveLength(0);
  });

  it('independently rejects Golden, arbitrary, mismatched-code, and invalid Revision inputs', async () => {
    const harness = createHarness();
    const revisionId = 'c2000000-0000-4000-8000-000000000001';
    await expect(
      harness.preparer.prepare(
        makeProject({ id: REVISION_DELETE_UAT_GOLDEN_PROJECT_ID }),
        revisionId,
        actor,
      ),
    ).rejects.toThrow(/Golden project is hard-rejected/);
    await expect(
      harness.preparer.prepare(
        makeProject({ id: 'c2000000-0000-4000-8000-000000000099' }),
        revisionId,
        actor,
      ),
    ).rejects.toThrow(/allowlisted only for the TEST project/);
    await expect(
      harness.preparer.prepare(makeProject({ projectCode: 'WRONG_CODE' }), revisionId, actor),
    ).rejects.toThrow(/project code does not match/);
    await expect(harness.preparer.prepare(harness.project, 'REV_01', actor)).rejects.toThrow(
      /valid Revision UUID/,
    );
  });
});
