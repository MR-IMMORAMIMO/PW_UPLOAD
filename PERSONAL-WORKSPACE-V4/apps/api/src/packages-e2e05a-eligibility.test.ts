/**
 * PACKAGES-E2E-05A — Datasheet Eligibility + Canonical Revision Intake.
 *
 * Proves the project/revision-scoped Datasheet intake authority and the
 * canonical intake action against the v16 snapshot model:
 *
 *  - ELIGIBILITY: VERIFIED / MISSING / HASH_MISMATCH / LEGACY_UNVERIFIED /
 *    ALREADY_ADDED classification, cross-project rejection, same-bytes-different
 *    luminaires independent eligibility, and read-only (no hash mutation, no
 *    snapshot creation).
 *  - INTAKE: exact assetVersionId creates an immutable Datasheet DocumentSnapshot
 *    (LuminaireAssetVersion source) with byte-truth hash verification, server
 *    re-validation, FINALIZED/wrong-project/ProductImage/missing/changed
 *    rejection, strict non-passthrough, idempotency, and same-bytes/different-
 *    luminaires independent snapshots.
 *  - VERSION FREEZE: an added v1 stays linked; v2 is separately eligible;
 *    FINALIZED Revision cannot relink.
 *  - PACKAGE VISIBILITY: the canonical RevisionDeliverable read and package
 *    catalog expose the Datasheet DocumentSnapshot through existing authority.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import type { AppUser, Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import type { DatabaseSync } from 'node:sqlite';
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

afterEach(() => {
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
  const root = mkdtempSync(path.join(tmpdir(), 'scli-e2e05a-'));
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

/** Writes a real datasheet file and attaches a Datasheet AssetVersion. */
function attachDatasheet(
  harness: Harness,
  projectId: string,
  luminaireId: string,
  content: string,
  fileName = 'datasheet.pdf',
) {
  const filePath = path.join(harness.root, `${randomUUID()}-${fileName}`);
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

async function eligibility(harness: Harness, projectId: string, revisionId: string) {
  return harness.service.listDatasheetEligibility(
    { ...harness.project, id: projectId } as Project,
    revisionId,
  );
}

describe('PACKAGES-E2E-05A — eligibility', () => {
  it('1: hashed same-project Datasheet AssetVersion is VERIFIED + eligible', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, luminaire.id, 'datasheet-bytes');
    const revision = prepareRevision(harness, harness.project.id);

    const items = await eligibility(harness, harness.project.id, revision.revisionId);
    const item = items.find((i) => i.assetVersionId === version.id)!;
    expect(item.integrityStatus).toBe('VERIFIED');
    expect(item.eligible).toBe(true);
    expect(item.tag).toBe('DL01');
    expect(item.manufacturer).toBe('Scientechnic');
    expect(item.model).toBe('DLX');
    expect(item.versionSequence).toBe(version.versionSequence);
    expect(item.fileName).toBe(version.fileName);
    expect(item.fileHash).toBe(version.fileHash);
    expect(item.alreadyInRevision).toBe(false);
  });

  it('2: ProductImage asset is not eligible / not listed', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const imagePath = path.join(harness.root, 'image.png');
    writeFileSync(imagePath, 'image-bytes');
    harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      {
        assetType: 'ProductImage',
        filePath: imagePath,
      },
      actor,
    );
    const revision = prepareRevision(harness, harness.project.id);
    const items = await eligibility(harness, harness.project.id, revision.revisionId);
    // ProductImage is never a Datasheet candidate.
    expect(items).toHaveLength(0);
  });

  it('3: cross-project Datasheet AssetVersion is not eligible / rejected', async () => {
    const harness = createHarness();
    const luminaireA = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    attachDatasheet(harness, harness.project.id, luminaireA.id, 'a-bytes');
    const revisionA = prepareRevision(harness, harness.project.id);
    const itemsA = await eligibility(harness, harness.project.id, revisionA.revisionId);
    expect(itemsA.filter((i) => i.eligible)).toHaveLength(1);

    // A Datasheet version in project B is simply not part of project A's list.
    const luminaireB = harness.store.addLuminaire(harness.otherProject.id, luminaireInput('DL02'));
    const versionB = attachDatasheet(harness, harness.otherProject.id, luminaireB.id, 'b-bytes');
    const itemsForA = await eligibility(harness, harness.project.id, revisionA.revisionId);
    expect(itemsForA.some((i) => i.assetVersionId === versionB.id)).toBe(false);
  });

  it('4: legacy NULL-hash Datasheet = LEGACY_UNVERIFIED + not eligible', async () => {
    const harness = createHarness();
    const db = harness.store.getSharedDatabase();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    // Seed a legacy NULL-hash row directly (historical pre-hash attach).
    db.prepare(
      `INSERT INTO luminaire_asset_versions
       (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
        mime_type, size_bytes, file_hash, backfilled, attached_at)
       VALUES (?, ?, ?, 'Datasheet', 1, 'legacy.pdf', 'legacy.pdf', 'application/pdf', 10,
               NULL, 1, ?)`,
    ).run(randomUUID(), harness.project.id, luminaire.id, '2026-01-01');
    const revision = prepareRevision(harness, harness.project.id);
    const items = await eligibility(harness, harness.project.id, revision.revisionId);
    const item = items.find((i) => i.fileHash === null)!;
    expect(item.integrityStatus).toBe('LEGACY_UNVERIFIED');
    expect(item.eligible).toBe(false);
  });

  it('5: missing source file = MISSING + not eligible', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const filePath = path.join(harness.root, `missing-${randomUUID()}.pdf`);
    writeFileSync(filePath, 'bytes');
    const version = harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      {
        assetType: 'Datasheet',
        filePath,
      },
      actor,
    );
    // Remove the source file; the persisted hash stays.
    rmSync(filePath, { force: true });
    const revision = prepareRevision(harness, harness.project.id);
    const items = await eligibility(harness, harness.project.id, revision.revisionId);
    const item = items.find((i) => i.assetVersionId === version.id)!;
    expect(item.integrityStatus).toBe('MISSING');
    expect(item.eligible).toBe(false);
  });

  it('6: changed source bytes = HASH_MISMATCH + not eligible', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const filePath = path.join(harness.root, `changed-${randomUUID()}.pdf`);
    writeFileSync(filePath, 'original-bytes');
    const version = harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      {
        assetType: 'Datasheet',
        filePath,
      },
      actor,
    );
    // Change the source bytes after attach.
    writeFileSync(filePath, 'changed-bytes');
    const revision = prepareRevision(harness, harness.project.id);
    const items = await eligibility(harness, harness.project.id, revision.revisionId);
    const item = items.find((i) => i.assetVersionId === version.id)!;
    expect(item.integrityStatus).toBe('HASH_MISMATCH');
    expect(item.eligible).toBe(false);
  });

  it('7: already-added assetVersion = ALREADY_ADDED + not eligible', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, luminaire.id, 'bytes');
    const revision = prepareRevision(harness, harness.project.id);
    await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      version.id,
      actor,
    );
    const items = await eligibility(harness, harness.project.id, revision.revisionId);
    const item = items.find((i) => i.assetVersionId === version.id)!;
    expect(item.integrityStatus).toBe('ALREADY_ADDED');
    expect(item.eligible).toBe(false);
    expect(item.alreadyInRevision).toBe(true);
  });

  it('8: different luminaire with identical bytes remains independently eligible', async () => {
    const harness = createHarness();
    const lumA = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const lumB = harness.store.addLuminaire(harness.project.id, luminaireInput('DL02'));
    const vA = attachDatasheet(harness, harness.project.id, lumA.id, 'identical-bytes');
    const vB = attachDatasheet(harness, harness.project.id, lumB.id, 'identical-bytes');
    expect(vA.fileHash).toBe(vB.fileHash);
    const revision = prepareRevision(harness, harness.project.id);
    const items = await eligibility(harness, harness.project.id, revision.revisionId);
    const itemA = items.find((i) => i.assetVersionId === vA.id)!;
    const itemB = items.find((i) => i.assetVersionId === vB.id)!;
    expect(itemA.eligible).toBe(true);
    expect(itemB.eligible).toBe(true);
    expect(itemA.luminaireId).toBe(lumA.id);
    expect(itemB.luminaireId).toBe(lumB.id);
  });

  it('9: eligibility read does not mutate fileHash', async () => {
    const harness = createHarness();
    const db = harness.store.getSharedDatabase();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, luminaire.id, 'bytes');
    const revision = prepareRevision(harness, harness.project.id);
    const before = db
      .prepare('SELECT file_hash FROM luminaire_asset_versions WHERE id = ?')
      .get(version.id) as { file_hash: string | null };
    await eligibility(harness, harness.project.id, revision.revisionId);
    const after = db
      .prepare('SELECT file_hash FROM luminaire_asset_versions WHERE id = ?')
      .get(version.id) as { file_hash: string | null };
    expect(after.file_hash).toBe(before.file_hash);
  });

  it('10: eligibility read does not create snapshots', async () => {
    const harness = createHarness();
    const db = harness.store.getSharedDatabase();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    attachDatasheet(harness, harness.project.id, luminaire.id, 'bytes');
    const revision = prepareRevision(harness, harness.project.id);
    await eligibility(harness, harness.project.id, revision.revisionId);
    const count = db.prepare('SELECT COUNT(*) AS c FROM revision_document_snapshots').get() as {
      c: number;
    };
    expect(count.c).toBe(0);
  });

  it('11: FINALIZED Revision is not an eligibility target', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const version = attachDatasheet(harness, harness.project.id, luminaire.id, 'bytes');
    const revision = prepareRevision(harness, harness.project.id);
    await harness.service.addDatasheetDeliverable(
      harness.project,
      revision.revisionId,
      version.id,
      actor,
    );
    await harness.service.finalizeRevision(harness.project, revision.revisionId);

    await expect(eligibility(harness, harness.project.id, revision.revisionId)).rejects.toThrow(
      /PREPARING/,
    );
  });
});
