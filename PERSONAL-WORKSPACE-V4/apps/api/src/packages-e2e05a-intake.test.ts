/**
 * PACKAGES-E2E-05A — Canonical Datasheet Intake, Version Freeze, Package
 * Visibility, and route-level mutation.
 *
 * Proves the canonical intake action end-to-end:
 *  - INTAKE: exact assetVersionId creates an immutable Datasheet DocumentSnapshot
 *    (LuminaireAssetVersion source) with byte-truth hash verification, server
 *    re-validation, FINALIZED/wrong-project/ProductImage/missing/changed
 *    rejection, strict non-passthrough (client cannot over-post), idempotency,
 *    and same-bytes/different-luminaires independent snapshots.
 *  - VERSION FREEZE: an added v1 stays linked to its exact assetVersionId; v2 is
 *    separately eligible for a PREPARING Revision; a FINALIZED Revision cannot
 *    switch/relink.
 *  - ROUTE: the GET datasheet-eligibility and POST datasheet-deliverables routes
 *    behave through Fastify app.inject with the shared canonical wiring.
 *  - PACKAGE VISIBILITY: the canonical RevisionDeliverables read and the package
 *    catalog expose the Datasheet DocumentSnapshot through existing authority
 *    (05_DATASHEETS mapping).
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { projectStorageMarkerFileName, type AppUser, type Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';
import { CanonicalIssuePackageService } from './infrastructure/output-registry/CanonicalIssuePackageService';
import {
  PRODUCTION_V4_DDL,
  PRODUCTION_V13_DDL,
  PRODUCTION_V14_DDL,
  PRODUCTION_V15_DDL,
  applyV12IssueAuditColumns,
  applyV15SnapshotProvenanceColumn,
  applyV16SnapshotRebuild,
  applyV17RevisionDeleteTable,
} from './infrastructure/migration/registry/production-migration-registry';

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
  packages: CanonicalIssuePackageService;
  project: Project;
  otherProject: Project;
}

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function applyV4DataDeliverableTables(database: DatabaseSync): void {
  for (const statement of PRODUCTION_V4_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V13_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V14_DDL) database.exec(statement);
  for (const statement of PRODUCTION_V15_DDL) database.exec(statement);
  applyV12IssueAuditColumns(database);
  applyV15SnapshotProvenanceColumn(database);
  applyV16SnapshotRebuild(database);
  applyV17RevisionDeleteTable(database);
  database.exec('PRAGMA foreign_keys = ON');
}

function initializeProject(store: PersonalWorkspaceStore, project: Project): void {
  store.initializeProject(
    project.id,
    ['LuminaireSchedule', 'TechnicalBoq'],
    'Full Lighting Design',
    'Manual',
    project.requiredDeliveryDate,
  );
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-e2e05a-intake-'));
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
  initializeProject(store, project);
  store.setFolderPath(project.id, projectRoot);
  writeFileSync(
    path.join(projectRoot, projectStorageMarkerFileName),
    JSON.stringify({
      schemaVersion: 1,
      projectId: project.id,
      createdAt: '2026-08-20T10:00:00.000Z',
      projectCodeSnapshot: project.projectCode,
    }),
  );
  const otherProject = structuredClone(seedProjects[1]!);
  initializeProject(store, otherProject);
  const database = store.getSharedDatabase();
  applyV4DataDeliverableTables(database);
  const registry = new CanonicalOutputRegistryStore(database, undefined, 'CANONICAL');
  registry.registerBuiltInTemplateVersions();
  const service = new RevisionDeliverableService(store, registry);
  const packages = new CanonicalIssuePackageService(
    store,
    registry,
    () => new Date('2026-08-20T10:00:00.000Z'),
  );
  return { root, projectRoot, store, registry, service, packages, project, otherProject };
}

function luminaireInput(tag: string, opts: { manufacturer?: string; model?: string } = {}) {
  return {
    tag,
    category: 'Downlight',
    imagePath: '',
    description: '',
    manufacturer: opts.manufacturer ?? 'Scientechnic',
    model: opts.model ?? 'DLX',
    wattage: '18W',
    lumens: '',
    lightColor: '3000K',
    cri: '',
    beamAngle: '',
    ipRating: '',
    mounting: '',
    cutout: '',
    driver: '',
    control: '',
    emergency: '',
    datasheetPath: '',
    location: '',
    unit: 'No.',
    quantity: 1,
    notes: '',
    sourceName: 'Manual',
    dimensions: '',
    bodyColorFinish: '',
  };
}

function attachDatasheet(
  harness: Harness,
  projectId: string,
  luminaireId: string,
  content: string,
  fileName = 'datasheet.pdf',
) {
  const sourceDirectory = path.join(harness.root, randomUUID());
  mkdirSync(sourceDirectory);
  const filePath = path.join(sourceDirectory, fileName);
  writeFileSync(filePath, content);
  return harness.store.attachLuminaireAsset(
    projectId,
    luminaireId,
    {
      assetType: 'Datasheet',
      filePath,
    },
    actor,
  );
}

function prepareRevision(harness: Harness, projectId: string) {
  return harness.service.prepareRevision(
    { ...harness.project, id: projectId } as Project,
    harness.store.getWorkspace(projectId),
    actor,
  );
}

async function createAppFor(
  harness: Harness,
  provider = new MockDataProvider(),
): Promise<FastifyInstance> {
  await provider.updateProject(harness.project.id, { projectFolderPath: harness.projectRoot });
  const app = await createApp({
    config: loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    }),
    provider,
    personalStore: harness.store,
    canonicalOutputRegistry: harness.registry,
  });
  apps.push(app);
  return app;
}

function setPersistedProjectRoot(harness: Harness, value: string | null): void {
  harness.store
    .getSharedDatabase()
    .prepare('UPDATE project_workspaces SET folder_path = ? WHERE project_id = ?')
    .run(value, harness.project.id);
}

function totalChanges(harness: Harness): number {
  const row = harness.store
    .getSharedDatabase()
    .prepare('SELECT total_changes() AS count')
    .get() as { count: number };
  return Number(row.count);
}

describe('PACKAGES-E2E-05A — canonical intake', () => {
  it('1-10: exact assetVersionId adds a Datasheet snapshot to a PREPARING Revision', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, luminaire.id, 'real-bytes');
    const sourcePath = version.filePath;
    const beforeSource = readFileSync(sourcePath);
    const revision = prepareRevision(harness, harness.project.id);

    const snapshot = await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      version.id,
      actor,
    );

    // 2-6: structured source provenance.
    expect(snapshot.sourceType).toBe('LuminaireAssetVersion');
    expect(snapshot.sourceDocumentId).toBeNull();
    expect(snapshot.sourceAssetVersionId).toBe(version.id);
    expect(snapshot.sourceArtifactVersionId).toBeNull();
    expect(snapshot.category).toBe('Datasheet');

    // 7: contentHash equals the persisted assetVersion.fileHash.
    expect(snapshot.contentHash).toBe(version.fileHash);

    // 8: copied bytes match source + stored hash.
    const copied = readFileSync(path.join(harness.projectRoot, snapshot.locatorValue));
    expect(sha256(copied)).toBe(version.fileHash);
    expect(sha256(copied)).toBe(sha256('real-bytes'));

    // 9: source bytes remain unchanged.
    expect(readFileSync(sourcePath)).toEqual(beforeSource);

    // 10: snapshot stored under DELIVERABLES/<revisionLabel>/ canonical location.
    expect(snapshot.locatorKind).toBe('PROJECT_RELATIVE');
    expect(snapshot.locatorValue.startsWith('DELIVERABLES/REV_')).toBe(true);
  });

  it('11: FINALIZED Revision rejects intake', async () => {
    const harness = createHarness();
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, lum.id, 'bytes');
    const revision = prepareRevision(harness, harness.project.id);
    await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      version.id,
      actor,
    );
    await harness.service.finalizeRevision(harness.project, revision.revisionId);

    await expect(
      harness.service.addDatasheetDeliverable(
        harness.project,
        revision.revisionId,
        version.id,
        actor,
      ),
    ).rejects.toThrow(/PREPARING/);
  });

  it('12: wrong-project asset rejects', async () => {
    const harness = createHarness();
    const lumB = harness.store.addLuminaire(harness.otherProject.id, luminaireInput('DL02'));
    const versionB = attachDatasheet(harness, harness.otherProject.id, lumB.id, 'b-bytes');
    const revisionA = prepareRevision(harness, harness.project.id);

    await expect(
      harness.service.addDatasheetDeliverable(
        harness.project,
        revisionA.revisionId,
        versionB.id,
        actor,
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('13: ProductImage asset rejects', async () => {
    const harness = createHarness();
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const imagePath = path.join(harness.root, 'image.png');
    writeFileSync(imagePath, 'image-bytes');
    const img = harness.store.attachLuminaireAsset(
      harness.project.id,
      lum.id,
      {
        assetType: 'ProductImage',
        filePath: imagePath,
      },
      actor,
    );
    const revision = prepareRevision(harness, harness.project.id);
    await expect(
      harness.service.addDatasheetDeliverable(harness.project, revision.revisionId, img.id, actor),
    ).rejects.toThrow(/Only a Datasheet asset/);
  });

  it('14: missing source rejects', async () => {
    const harness = createHarness();
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const filePath = path.join(harness.root, 'gone.pdf');
    writeFileSync(filePath, 'bytes');
    const version = harness.store.attachLuminaireAsset(
      harness.project.id,
      lum.id,
      {
        assetType: 'Datasheet',
        filePath,
      },
      actor,
    );
    rmSync(filePath, { force: true });
    const revision = prepareRevision(harness, harness.project.id);
    await expect(
      harness.service.addDatasheetDeliverable(
        harness.project,
        revision.revisionId,
        version.id,
        actor,
      ),
    ).rejects.toThrow(/missing/);
  });

  it('15: changed bytes / hash mismatch rejects', async () => {
    const harness = createHarness();
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const filePath = path.join(harness.root, 'changed.pdf');
    writeFileSync(filePath, 'original');
    const version = harness.store.attachLuminaireAsset(
      harness.project.id,
      lum.id,
      {
        assetType: 'Datasheet',
        filePath,
      },
      actor,
    );
    writeFileSync(filePath, 'modified');
    const revision = prepareRevision(harness, harness.project.id);
    await expect(
      harness.service.addDatasheetDeliverable(
        harness.project,
        revision.revisionId,
        version.id,
        actor,
      ),
    ).rejects.toThrow(/changed after it was hashed/);
  });

  it('16: forged filePath/hash/luminaire metadata is rejected as over-posting', async () => {
    const harness = createHarness();
    const app = await createAppFor(harness);
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, lum.id, 'real-bytes');
    const revision = prepareRevision(harness, harness.project.id);
    // Over-post forbidden fields. The strict request contract rejects them;
    // they never reach mutation authority.
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/datasheet-deliverables`,
      headers: { 'x-mock-user-id': actor.id },
      payload: {
        assetVersionId: version.id,
        filePath: 'forged.pdf',
        fileHash: 'f'.repeat(64),
        luminaireId: lum.id,
        tag: 'X',
        manufacturer: 'X',
        model: 'X',
        title: 'Forged title',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(harness.registry.listDocumentSnapshotsForRevision(revision.revisionId)).toHaveLength(0);
  });

  it('17: duplicate same Revision + same assetVersion does not duplicate', async () => {
    const harness = createHarness();
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, lum.id, 'bytes');
    const revision = prepareRevision(harness, harness.project.id);
    await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      version.id,
      actor,
    );
    await expect(
      harness.service.addDatasheetDeliverable(
        harness.project,
        revision.revisionId,
        version.id,
        actor,
      ),
    ).rejects.toThrow(/already/);
    expect(harness.registry.listDocumentSnapshotsForRevision(revision.revisionId)).toHaveLength(1);
  });

  it('18: identical bytes and filename / different luminaires create distinct snapshots', async () => {
    const harness = createHarness();
    const lumA = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const lumB = harness.store.addLuminaire(harness.project.id, luminaireInput('DL02'));
    const vA = attachDatasheet(harness, harness.project.id, lumA.id, 'same-bytes');
    const vB = attachDatasheet(harness, harness.project.id, lumB.id, 'same-bytes');
    expect(vA.fileHash).toBe(vB.fileHash);
    expect(vA.fileName).toBe(vB.fileName);
    const revision = prepareRevision(harness, harness.project.id);
    const snapA = await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      vA.id,
      actor,
    );
    const snapB = await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      vB.id,
      actor,
    );
    expect(snapA.deliverableId).not.toBe(snapB.deliverableId);
    expect(snapA.sourceAssetVersionId).toBe(vA.id);
    expect(snapB.sourceAssetVersionId).toBe(vB.id);
    expect(snapA.fileName).toBe(vA.fileName);
    expect(snapB.fileName).toBe(vB.fileName);
    expect(snapA.locatorValue).not.toBe(snapB.locatorValue);
    expect(harness.registry.listDocumentSnapshotsForRevision(revision.revisionId)).toHaveLength(2);
  });
});

describe('PACKAGES-E2E-05A — version freeze', () => {
  it('existing snapshot stays linked to v1; v2 separately eligible; FINALIZED cannot relink', async () => {
    const harness = createHarness();
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const v1Path = path.join(harness.root, 'v1.pdf');
    writeFileSync(v1Path, 'version-one');
    const v1 = harness.store.attachLuminaireAsset(
      harness.project.id,
      lum.id,
      {
        assetType: 'Datasheet',
        filePath: v1Path,
      },
      actor,
    );
    const revision = prepareRevision(harness, harness.project.id);
    const snap1 = await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      v1.id,
      actor,
    );
    expect(snap1.sourceAssetVersionId).toBe(v1.id);

    const v2Path = path.join(harness.root, 'v2.pdf');
    writeFileSync(v2Path, 'version-two');
    const v2 = harness.store.attachLuminaireAsset(
      harness.project.id,
      lum.id,
      {
        assetType: 'Datasheet',
        filePath: v2Path,
      },
      actor,
    );
    expect(v2.versionSequence).toBe(2);

    // No silent relink.
    const snap1After = harness.registry.getDocumentSnapshot(snap1.deliverableId);
    expect(snap1After.sourceAssetVersionId).toBe(v1.id);

    // v2 is separately eligible for a PREPARING Revision.
    const items = await harness.service.listDatasheetEligibility(
      harness.project,
      revision.revisionId,
    );
    const v2Item = items.find((i) => i.assetVersionId === v2.id)!;
    expect(v2Item.eligible).toBe(true);
    expect(v2Item.integrityStatus).toBe('VERIFIED');

    // FINALIZED Revision cannot switch/relink to v2.
    await harness.service.finalizeRevision(harness.project, revision.revisionId);
    await expect(
      harness.service.addDatasheetDeliverable(harness.project, revision.revisionId, v2.id, actor),
    ).rejects.toThrow(/PREPARING/);
  });
});

describe('PACKAGES-E2E-05A — routes (app.inject)', () => {
  it('GET datasheet-eligibility returns structured truth', async () => {
    const harness = createHarness();
    const app = await createAppFor(harness);
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, lum.id, 'bytes');
    const revision = prepareRevision(harness, harness.project.id);
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/datasheet-eligibility`,
      headers: { 'x-mock-user-id': actor.id },
    });
    expect(response.statusCode).toBe(200);
    const items = response.json().data as Array<{
      assetVersionId: string;
      integrityStatus: string;
      eligible: boolean;
      tag: string;
    }>;
    const item = items.find((i) => i.assetVersionId === version.id)!;
    expect(item.integrityStatus).toBe('VERIFIED');
    expect(item.eligible).toBe(true);
    expect(item.tag).toBe('DL01');
  });

  it('POST datasheet-deliverables admits the exact assetVersionId', async () => {
    const harness = createHarness();
    const app = await createAppFor(harness);
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, lum.id, 'bytes');
    const revision = prepareRevision(harness, harness.project.id);
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/datasheet-deliverables`,
      headers: { 'x-mock-user-id': actor.id },
      payload: { assetVersionId: version.id },
    });
    expect(response.statusCode).toBe(201);
    const snapshot = response.json().data;
    expect(snapshot.sourceType).toBe('LuminaireAssetVersion');
    expect(snapshot.sourceAssetVersionId).toBe(version.id);
    expect(snapshot.category).toBe('Datasheet');
  });

  it('POST datasheet-deliverables rejects every unverified root before copy or persistence', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL-ROOT-GUARD'),
    );
    const version = attachDatasheet(
      harness,
      harness.project.id,
      luminaire.id,
      'root-guard-source-bytes',
    );
    const sourceBytes = readFileSync(version.filePath);
    const revision = prepareRevision(harness, harness.project.id);
    const provider = new MockDataProvider();
    const app = await createAppFor(harness, provider);

    const expectRejectedWithoutSideEffects = async (storageState: string) => {
      const changesBefore = totalChanges(harness);
      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/datasheet-deliverables`,
        headers: { 'x-mock-user-id': actor.id },
        payload: { assetVersionId: version.id },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { details: { storageState } },
      });
      expect(totalChanges(harness)).toBe(changesBefore);
      expect(harness.registry.listDocumentSnapshotsForRevision(revision.revisionId)).toEqual([]);
      expect(existsSync(path.join(harness.projectRoot, 'DELIVERABLES'))).toBe(false);
      expect(readFileSync(version.filePath)).toEqual(sourceBytes);
      expect(harness.store.getLuminaireAssetVersionById(harness.project.id, version.id).id).toBe(
        version.id,
      );
    };

    setPersistedProjectRoot(harness, null);
    await provider.updateProject(harness.project.id, { projectFolderPath: null });
    await expectRejectedWithoutSideEffects('DISCONNECTED');

    harness.store.setFolderPath(harness.project.id, harness.projectRoot);
    await provider.updateProject(harness.project.id, {
      projectFolderPath: harness.projectRoot,
    });
    rmSync(path.join(harness.projectRoot, projectStorageMarkerFileName), { force: true });
    writeFileSync(
      path.join(harness.projectRoot, 'PROJECT_INFO.txt'),
      `Project Code: ${harness.project.projectCode}\n`,
    );
    await expectRejectedWithoutSideEffects('LEGACY_UNVERIFIED');

    writeFileSync(
      path.join(harness.projectRoot, projectStorageMarkerFileName),
      JSON.stringify({
        schemaVersion: 1,
        projectId: harness.otherProject.id,
        createdAt: '2026-08-20T10:00:00.000Z',
        projectCodeSnapshot: harness.otherProject.projectCode,
      }),
    );
    await expectRejectedWithoutSideEffects('NEEDS_RECONNECTION');
  });

  it('POST with FINALIZED Revision rejects via the route', async () => {
    const harness = createHarness();
    const app = await createAppFor(harness);
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, lum.id, 'bytes');
    const revision = prepareRevision(harness, harness.project.id);
    await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      version.id,
      actor,
    );
    await harness.service.finalizeRevision(harness.project, revision.revisionId);
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/datasheet-deliverables`,
      headers: { 'x-mock-user-id': actor.id },
      payload: { assetVersionId: version.id },
    });
    expect(response.statusCode).toBe(409);
  });

  it('DELETE rejects a foreign-Project Datasheet snapshot with zero persisted or filesystem mutation', async () => {
    const harness = createHarness();
    const otherProjectRoot = path.join(harness.root, 'other-project');
    mkdirSync(otherProjectRoot);
    harness.store.setFolderPath(harness.otherProject.id, otherProjectRoot);
    const luminaire = harness.store.addLuminaire(
      harness.otherProject.id,
      luminaireInput('DL-FOREIGN'),
    );
    const version = attachDatasheet(
      harness,
      harness.otherProject.id,
      luminaire.id,
      'foreign-datasheet-bytes',
    );
    const requestedRevision = prepareRevision(harness, harness.project.id);
    const foreignRevision = prepareRevision(harness, harness.otherProject.id);
    const snapshot = await harness.service.addDatasheetDeliverable(
      harness.otherProject,
      foreignRevision.revisionId,
      version.id,
      actor,
    );
    const artifactPath = path.join(otherProjectRoot, snapshot.locatorValue);
    const sourceBytesBefore = readFileSync(version.filePath);
    const before = {
      deliverableId: snapshot.deliverableId,
      projectId: snapshot.projectId,
      revisionId: snapshot.revisionId,
      locatorValue: snapshot.locatorValue,
      contentHash: snapshot.contentHash,
      sourceAssetVersionId: snapshot.sourceAssetVersionId,
      artifactHash: sha256(readFileSync(artifactPath)),
    };
    const app = await createAppFor(harness);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${harness.project.id}/revisions/${requestedRevision.revisionId}/deliverables/${snapshot.deliverableId}`,
      headers: { 'x-mock-user-id': actor.id },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    const rowCount = harness.store
      .getSharedDatabase()
      .prepare('SELECT COUNT(*) AS count FROM revision_document_snapshots WHERE deliverable_id = ?')
      .get(snapshot.deliverableId) as { count: number };
    expect(rowCount.count).toBe(1);
    const persisted = harness.registry.getDocumentSnapshot(snapshot.deliverableId);
    const after = {
      deliverableId: persisted.deliverableId,
      projectId: persisted.projectId,
      revisionId: persisted.revisionId,
      locatorValue: persisted.locatorValue,
      contentHash: persisted.contentHash,
      sourceAssetVersionId: persisted.sourceAssetVersionId,
      artifactHash: sha256(readFileSync(artifactPath)),
    };
    expect(after).toEqual(before);
    expect(existsSync(artifactPath)).toBe(true);
    expect(
      harness.store.getLuminaireAssetVersionById(harness.otherProject.id, version.id),
    ).toMatchObject({
      id: version.id,
      projectId: harness.otherProject.id,
      luminaireId: luminaire.id,
      fileHash: version.fileHash,
    });
    expect(readFileSync(version.filePath)).toEqual(sourceBytesBefore);
  });

  it('DELETE rejects a snapshot from another Revision in the same Project', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL-WRONG-REV'),
    );
    const version = attachDatasheet(
      harness,
      harness.project.id,
      luminaire.id,
      'same-project-bytes',
    );
    const requestedRevision = prepareRevision(harness, harness.project.id);
    const owningRevision = prepareRevision(harness, harness.project.id);
    const snapshot = await harness.service.addDatasheetDeliverable(
      harness.project,
      owningRevision.revisionId,
      version.id,
      actor,
    );
    const artifactPath = path.join(harness.projectRoot, snapshot.locatorValue);
    const app = await createAppFor(harness);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${harness.project.id}/revisions/${requestedRevision.revisionId}/deliverables/${snapshot.deliverableId}`,
      headers: { 'x-mock-user-id': actor.id },
    });

    expect(response.statusCode).toBe(400);
    expect(harness.registry.getDocumentSnapshot(snapshot.deliverableId)).toMatchObject({
      projectId: harness.project.id,
      revisionId: owningRevision.revisionId,
      sourceAssetVersionId: version.id,
    });
    expect(existsSync(artifactPath)).toBe(true);
  });

  it('DELETE removes the correctly scoped PREPARING snapshot and its owned copy only', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL-VALID'));
    const version = attachDatasheet(
      harness,
      harness.project.id,
      luminaire.id,
      'valid-delete-bytes',
    );
    const sourceBytesBefore = readFileSync(version.filePath);
    const revision = prepareRevision(harness, harness.project.id);
    const snapshot = await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      version.id,
      actor,
    );
    const artifactPath = path.join(harness.projectRoot, snapshot.locatorValue);
    const app = await createAppFor(harness);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/deliverables/${snapshot.deliverableId}`,
      headers: { 'x-mock-user-id': actor.id },
    });

    expect(response.statusCode).toBe(200);
    expect(() => harness.registry.getDocumentSnapshot(snapshot.deliverableId)).toThrow(
      /not found/i,
    );
    expect(existsSync(artifactPath)).toBe(false);
    expect(harness.store.getLuminaireAssetVersionById(harness.project.id, version.id).id).toBe(
      version.id,
    );
    expect(readFileSync(version.filePath)).toEqual(sourceBytesBefore);
  });

  it('DELETE preserves the row and both owned and source bytes when storage is not verified', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(
      harness.project.id,
      luminaireInput('DL-DELETE-GUARD'),
    );
    const version = attachDatasheet(
      harness,
      harness.project.id,
      luminaire.id,
      'delete-root-guard-bytes',
    );
    const sourceBytes = readFileSync(version.filePath);
    const revision = prepareRevision(harness, harness.project.id);
    const snapshot = await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      version.id,
      actor,
    );
    const artifactPath = path.join(harness.projectRoot, snapshot.locatorValue);
    const artifactBytes = readFileSync(artifactPath);
    const provider = new MockDataProvider();
    const app = await createAppFor(harness, provider);

    const expectRejectedWithoutSideEffects = async (storageState: string) => {
      const changesBefore = totalChanges(harness);
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/deliverables/${snapshot.deliverableId}`,
        headers: { 'x-mock-user-id': actor.id },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { details: { storageState } },
      });
      expect(totalChanges(harness)).toBe(changesBefore);
      expect(harness.registry.getDocumentSnapshot(snapshot.deliverableId)).toMatchObject({
        deliverableId: snapshot.deliverableId,
        revisionId: revision.revisionId,
        sourceAssetVersionId: version.id,
      });
      expect(readFileSync(artifactPath)).toEqual(artifactBytes);
      expect(readFileSync(version.filePath)).toEqual(sourceBytes);
      expect(harness.store.getLuminaireAssetVersionById(harness.project.id, version.id).id).toBe(
        version.id,
      );
    };

    setPersistedProjectRoot(harness, null);
    await provider.updateProject(harness.project.id, { projectFolderPath: null });
    await expectRejectedWithoutSideEffects('DISCONNECTED');

    const unavailableRoot = path.join(harness.root, 'unavailable-project-root');
    harness.store.setFolderPath(harness.project.id, unavailableRoot);
    await provider.updateProject(harness.project.id, { projectFolderPath: unavailableRoot });
    await expectRejectedWithoutSideEffects('UNAVAILABLE');

    harness.store.setFolderPath(harness.project.id, harness.projectRoot);
    await provider.updateProject(harness.project.id, {
      projectFolderPath: harness.projectRoot,
    });
    writeFileSync(
      path.join(harness.projectRoot, projectStorageMarkerFileName),
      JSON.stringify({
        schemaVersion: 1,
        projectId: harness.otherProject.id,
        createdAt: '2026-08-20T10:00:00.000Z',
        projectCodeSnapshot: harness.otherProject.projectCode,
      }),
    );
    await expectRejectedWithoutSideEffects('NEEDS_RECONNECTION');
  });

  it('DELETE preserves a correctly scoped snapshot on a FINALIZED Revision', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL-FINAL'));
    const version = attachDatasheet(harness, harness.project.id, luminaire.id, 'finalized-bytes');
    const revision = prepareRevision(harness, harness.project.id);
    const snapshot = await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      version.id,
      actor,
    );
    await harness.service.finalizeRevision(harness.project, revision.revisionId);
    const artifactPath = path.join(harness.projectRoot, snapshot.locatorValue);
    const app = await createAppFor(harness);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/deliverables/${snapshot.deliverableId}`,
      headers: { 'x-mock-user-id': actor.id },
    });

    expect(response.statusCode).toBe(409);
    expect(harness.registry.getDocumentSnapshot(snapshot.deliverableId).deliverableId).toBe(
      snapshot.deliverableId,
    );
    expect(existsSync(artifactPath)).toBe(true);
  });

  it('DELETE preserves bounded not-found behavior for an unknown snapshot UUID', async () => {
    const harness = createHarness();
    const revision = prepareRevision(harness, harness.project.id);
    const app = await createAppFor(harness);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${harness.project.id}/revisions/${revision.revisionId}/deliverables/${randomUUID()}`,
      headers: { 'x-mock-user-id': actor.id },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('PACKAGES-E2E-05A — package visibility', () => {
  it('RevisionDeliverables read and package catalog expose the Datasheet DocumentSnapshot', async () => {
    const harness = createHarness();
    const lum = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, lum.id, 'datasheet-bytes');
    const revision = prepareRevision(harness, harness.project.id);
    const snapshot = await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      version.id,
      actor,
    );

    // RevisionDeliverables read exposes the Datasheet DocumentSnapshot.
    const deliverables = await harness.service.listRevisionDeliverables(
      harness.project,
      revision.revisionId,
    );
    const member = deliverables.find(
      (d) => d.sourceType === 'DocumentSnapshot' && d.deliverableId === snapshot.deliverableId,
    )!;
    expect(member).toBeDefined();
    expect(member.category).toBe('Datasheet');

    // Finalize then build a package; the catalog sees the DocumentSnapshot.
    await harness.service.finalizeRevision(harness.project, revision.revisionId);
    const record = await harness.packages.create(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      {
        revisionNumber: revision.revisionSequence,
        reissueNumber: 0,
        label: 'E2E-05A Package',
        status: 'Draft',
        outputMode: 'Folder',
        relativeOutputFolder: 'ISSUED/REV_01_DS',
        selectedItemIds: [snapshot.deliverableId],
        warningOverrideReason: '',
      },
      [],
    );
    const locator = harness.registry.getIssuePackage(record.id).manifestLocatorValue!;
    const manifest = JSON.parse(readFileSync(path.join(harness.projectRoot, locator), 'utf8'));
    const ds = manifest.deliverables.find(
      (m: { deliverableId: string }) => m.deliverableId === snapshot.deliverableId,
    );
    expect(ds).toBeDefined();
    expect(ds.sourceType).toBe('DocumentSnapshot');
    expect(ds.packageRelativePath).toMatch(/^05_DATASHEETS\//);
  });
});
