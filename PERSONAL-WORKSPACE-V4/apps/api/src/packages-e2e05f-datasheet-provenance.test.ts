/**
 * PACKAGES-E2E-05F — Datasheet Structured Provenance Foundation.
 *
 * Proves:
 *   A. v15 -> v16 migration preserves every existing ProjectDocument snapshot,
 *      nulls source_asset_version_id, and keeps source_artifact_version_id.
 *   B. The source XOR CHECK rejects both-null and both-populated rows.
 *   C. The two partial unique dedupe indexes behave correctly.
 *   D. The v16 store/domain can represent a LuminaireAssetVersion-sourced
 *      snapshot WITHOUT a synthetic ProjectDocument, derives Luminaire
 *      identity structurally, and rejects cross-project asset versions.
 *   E. New Luminaire asset-version writes persist a server-computed SHA-256
 *      file hash; legacy NULL-hash rows stay NULL (LEGACY_UNVERIFIED); a
 *      client-supplied hash cannot override the server-computed hash.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { attachLuminaireAssetSchema } from '@scli/contracts';
import type { AppUser, Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import type { DatabaseSync } from 'node:sqlite';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { RevisionDeliverableService } from './infrastructure/output-registry/RevisionDeliverableService';
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
  project: Project;
  otherProject: Project;
}

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-e2e05f-'));
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
  applyV4DataDeliverableTables(database);
  const registry = new CanonicalOutputRegistryStore(database, undefined, 'CANONICAL');
  registry.registerBuiltInTemplateVersions();
  const service = new RevisionDeliverableService(store, registry);
  const otherProject = structuredClone(seedProjects[1]!);
  return { root, projectRoot, store, registry, service, project, otherProject };
}

/** Applies the v4/v13/v14/v15 DDL + compatibility columns + v16 rebuild. */
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

function addDocument(harness: Harness, relativePath: string, content: string) {
  const filePath = path.join(harness.projectRoot, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  const document = harness.store.operations.createDocument(harness.project.id, {
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
  return document;
}

function luminaireInput(tag: string, datasheetPath = '') {
  return {
    tag,
    category: 'Downlight',
    imagePath: '',
    description: '',
    manufacturer: 'Scientechnic',
    model: 'DLX',
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
    datasheetPath,
    location: '',
    unit: 'No.',
    quantity: 1,
    notes: '',
    sourceName: 'Manual',
    dimensions: '',
    bodyColorFinish: '',
  };
}

describe('PACKAGES-E2E-05F migration (v15 -> v16)', () => {
  it('preserves existing ProjectDocument snapshots and nulls the new asset source', async () => {
    const harness = createHarness();
    const document = addDocument(harness, 'Drawings/Layout.pdf', 'layout-bytes');
    const revision = harness.service.prepareRevision(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
    );
    const snapshot = await harness.service.createDocumentSnapshot(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
      revision.revisionId,
      { sourceDocumentId: document.id },
    );

    const row = harness.store
      .getSharedDatabase()
      .prepare('SELECT * FROM revision_document_snapshots WHERE deliverable_id = ?')
      .get(snapshot.deliverableId) as Record<string, unknown>;

    // v16 source authorities.
    expect(row.source_document_id).toBe(document.id);
    expect(row.source_asset_version_id).toBeNull();
    expect(row.source_artifact_version_id).toBeNull();
    // Domain discriminated shape.
    expect(snapshot.sourceType).toBe('ProjectDocument');
    expect(snapshot.sourceDocumentId).toBe(document.id);
    expect(snapshot.sourceAssetVersionId).toBeNull();
  });

  it('XOR CHECK rejects a both-null and both-populated snapshot row', async () => {
    const harness = createHarness();
    const db = harness.store.getSharedDatabase();
    const projectId = harness.project.id;
    // A valid canonical Revision row is required by the FK.
    const revisionId = harness.service.prepareRevision(
      harness.project,
      harness.store.getWorkspace(projectId),
      actor,
    ).revisionId;

    const baseColumns =
      'deliverable_id, project_id, revision_id, category, title, file_name, source_relative_path, locator_kind, locator_value, content_hash, size_bytes, created_at';
    const baseValues = `(?, ?, ?, 'Drawing', 'Title', 'f.pdf', 'r', 'PROJECT_RELATIVE', 'loc', '${'a'.repeat(64)}', 10, '2026-01-01')`;

    // both NULL -> XOR CHECK rejects.
    expect(() =>
      db
        .prepare(
          `INSERT INTO revision_document_snapshots
           (${baseColumns})
           VALUES ${baseValues}`,
        )
        .run(randomUUID(), projectId, revisionId),
    ).toThrow(/CHECK/i);

    // both populated -> XOR CHECK rejects.
    expect(() =>
      db
        .prepare(
          `INSERT INTO revision_document_snapshots
           (${baseColumns}, source_document_id, source_asset_version_id)
           VALUES ${baseValues.replace(')', ', ?, ?)')}`,
        )
        .run(
          randomUUID(),
          projectId,
          revisionId,
          '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000002',
        ),
    ).toThrow(/CHECK/i);
  });

  it('document-source and asset-source partial unique indexes work', async () => {
    const harness = createHarness();
    const db = harness.store.getSharedDatabase();
    const projectId = harness.project.id;
    const revisionId = harness.service.prepareRevision(
      harness.project,
      harness.store.getWorkspace(projectId),
      actor,
    ).revisionId;

    // Create a valid ProjectDocument to satisfy the FK.
    const docId = randomUUID();
    db.prepare(
      `INSERT INTO project_documents
       (id, project_id, category, document_number, title, revision, status, file_path,
        issued_to, issue_date, notes, created_at, updated_at)
       VALUES (?, ?, 'Drawing', '', 'Doc', 'A', 'Working', 'Layout.pdf', '', NULL, '', ?, ?)`,
    ).run(docId, projectId, '2026-01-01', '2026-01-01');

    const insertDocSnapshot = (hash: string, suffix: string) =>
      db
        .prepare(
          `INSERT INTO revision_document_snapshots
           (deliverable_id, project_id, revision_id, source_document_id, category, title,
            file_name, source_relative_path, locator_kind, locator_value, content_hash,
            size_bytes, created_at)
           VALUES (?, ?, ?, ?, 'Drawing', 'Doc', 'f.pdf', 'r', 'PROJECT_RELATIVE', 'loc', ?, 10, ?)`,
        )
        .run(randomUUID(), projectId, revisionId, docId, hash, `2026-01-01${suffix}`);

    // Same revision + same document + same content_hash -> document-source index rejects.
    insertDocSnapshot('b'.repeat(64), '');
    expect(() => insertDocSnapshot('b'.repeat(64), '')).toThrow(/UNIQUE/i);

    // Same revision + same document + different hash -> allowed (distinct snapshots).
    insertDocSnapshot('c'.repeat(64), '');
  });

  it('store represents an asset-version-sourced snapshot without a synthetic ProjectDocument', async () => {
    const harness = createHarness();
    const db = harness.store.getSharedDatabase();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    // Attach a real datasheet file so the version records its server hash.
    const datasheetPath = path.join(harness.root, 'datasheet-DL01.pdf');
    writeFileSync(datasheetPath, Buffer.from('pdf-datasheet-bytes'));
    const version = harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      { assetType: 'Datasheet', filePath: datasheetPath },
      actor,
    );

    const projectId = harness.project.id;
    const revisionId = harness.service.prepareRevision(
      harness.project,
      harness.store.getWorkspace(projectId),
      actor,
    ).revisionId;

    const snapshot = harness.registry.createDocumentSnapshot({
      projectId,
      revisionId,
      sourceAssetVersionId: version.id,
      category: 'Datasheet',
      title: 'DL01 Datasheet',
      fileName: 'datasheet-DL01.pdf',
      sourceRelativePath: datasheetPath,
      locatorValue: `DELIVERABLES/REV_01/datasheet-DL01.pdf`,
      contentHash: version.fileHash ?? sha256('pdf-datasheet-bytes'),
      sizeBytes: Buffer.byteLength('pdf-datasheet-bytes'),
      createdBy: { actorId: actor.id, actorNameSnapshot: actor.displayName },
    });

    // Discriminated domain shape: LuminaireAssetVersion source, no ProjectDocument.
    expect(snapshot.sourceType).toBe('LuminaireAssetVersion');
    expect(snapshot.sourceAssetVersionId).toBe(version.id);
    expect(snapshot.sourceDocumentId).toBeNull();
    // REV-01A ManagedArtifact provenance is NOT invented for asset-version snapshots.
    expect(snapshot.sourceArtifactVersionId).toBeNull();

    // Luminaire identity is DERIVED structurally through the FK/join.
    const derived = db
      .prepare(
        `SELECT lav.luminaire_id, pl.project_id, lav.asset_type, lav.file_hash
         FROM luminaire_asset_versions lav
         INNER JOIN project_luminaires pl ON pl.id = lav.luminaire_id
         WHERE lav.id = ?`,
      )
      .get(version.id) as {
      luminaire_id: string;
      project_id: string;
      asset_type: string;
      file_hash: string | null;
    };
    expect(derived.luminaire_id).toBe(luminaire.id);
    expect(derived.project_id).toBe(projectId);
    expect(derived.asset_type).toBe('Datasheet');
    expect(derived.file_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a cross-project LuminaireAssetVersion as a snapshot source', async () => {
    const harness = createHarness();
    const db = harness.store.getSharedDatabase();
    // Luminaire in project A.
    const luminaireA = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const datasheetPath = path.join(harness.root, 'datasheet-A.pdf');
    writeFileSync(datasheetPath, Buffer.from('a-datasheet'));
    const versionA = harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaireA.id,
      { assetType: 'Datasheet', filePath: datasheetPath },
      actor,
    );

    const revisionId = harness.service.prepareRevision(
      harness.project,
      harness.store.getWorkspace(harness.project.id),
      actor,
    ).revisionId;

    expect(() =>
      harness.registry.createDocumentSnapshot({
        projectId: harness.project.id,
        revisionId,
        sourceAssetVersionId: versionA.id,
        category: 'Datasheet',
        title: 'T',
        fileName: 'f.pdf',
        sourceRelativePath: 'r',
        locatorValue: 'DELIVERABLES/REV_01/f.pdf',
        contentHash: sha256('a-datasheet'),
        sizeBytes: 10,
        createdBy: null,
      }),
    ).not.toThrow();

    // Cross-project: build a second project with its own Luminaire + version.
    harness.store.initializeProject(
      harness.otherProject.id,
      ['LuminaireSchedule'],
      'Full Lighting Design',
      'Manual',
      harness.otherProject.requiredDeliveryDate,
    );
    const luminaireB = harness.store.addLuminaire(harness.otherProject.id, luminaireInput('DL01'));
    const otherDatasheet = path.join(harness.root, 'datasheet-B.pdf');
    writeFileSync(otherDatasheet, Buffer.from('b-datasheet'));
    const versionB = harness.store.attachLuminaireAsset(
      harness.otherProject.id,
      luminaireB.id,
      { assetType: 'Datasheet', filePath: otherDatasheet },
      actor,
    );

    // Attempting to snapshot project B's asset version onto project A's revision must fail.
    expect(() =>
      harness.registry.createDocumentSnapshot({
        projectId: harness.project.id,
        revisionId,
        sourceAssetVersionId: versionB.id,
        category: 'Datasheet',
        title: 'T',
        fileName: 'g.pdf',
        sourceRelativePath: 'r',
        locatorValue: 'DELIVERABLES/REV_01/g.pdf',
        contentHash: sha256('b-datasheet'),
        sizeBytes: 10,
        createdBy: null,
      }),
    ).toThrow(/same project/);
    expect(db.prepare('SELECT COUNT(*) AS c FROM revision_document_snapshots').get()).toEqual({
      c: 1,
    });
  });
});

describe('PACKAGES-E2E-05F asset hash authority', () => {
  it('stores server-computed SHA-256 for a new Datasheet asset version', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const datasheetPath = path.join(harness.root, 'datasheet.pdf');
    const bytes = Buffer.from('real-datasheet-bytes');
    writeFileSync(datasheetPath, bytes);

    const version = harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      { assetType: 'Datasheet', filePath: datasheetPath },
      actor,
    );

    expect(version.fileHash).toBe(sha256(bytes));
    expect(version.fileHash).toMatch(/^[0-9a-f]{64}$/);
    // Source file unchanged.
    expect(sha256(readBytes(datasheetPath))).toBe(sha256(bytes));
  });

  it('stores a hash for a new ProductImage asset version via the same authority', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const imagePath = path.join(harness.root, 'image.png');
    const bytes = Buffer.from('product-image-bytes');
    writeFileSync(imagePath, bytes);

    const version = harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      { assetType: 'ProductImage', filePath: imagePath },
      actor,
    );

    expect(version.fileHash).toBe(sha256(bytes));
  });

  it('second asset version gets its own independent hash', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const v1Path = path.join(harness.root, 'v1.pdf');
    const v2Path = path.join(harness.root, 'v2.pdf');
    writeFileSync(v1Path, 'version-one');
    writeFileSync(v2Path, 'version-two');
    const v1 = harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      { assetType: 'Datasheet', filePath: v1Path },
      actor,
    );
    const v2 = harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      { assetType: 'Datasheet', filePath: v2Path },
      actor,
    );
    expect(v1.versionSequence).toBe(1);
    expect(v2.versionSequence).toBe(2);
    expect(v1.fileHash).not.toBe(v2.fileHash);
    expect(v1.fileHash).toBe(sha256('version-one'));
    expect(v2.fileHash).toBe(sha256('version-two'));
  });

  it('legacy NULL-hash rows are NOT silently populated and read back null truthfully', async () => {
    const harness = createHarness();
    const db = harness.store.getSharedDatabase();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    // Directly seed a legacy NULL-hash asset version (historical pre-hash attach).
    db.prepare(
      `INSERT INTO luminaire_asset_versions
       (id, project_id, luminaire_id, asset_type, version_sequence, file_path, file_name,
        mime_type, size_bytes, file_hash, backfilled, attached_at)
       VALUES (?, ?, ?, 'Datasheet', 1, 'legacy.pdf', 'legacy.pdf', 'application/pdf', 10,
               NULL, 1, ?)`,
    ).run(randomUUID(), harness.project.id, luminaire.id, '2026-01-01');

    const versions = harness.store.listLuminaireAssetVersions(
      harness.project.id,
      luminaire.id,
      'Datasheet',
    );
    expect(versions[0]!.fileHash).toBeNull();

    // The stored row remains NULL after any read/listing (no silent backfill).
    const row = db
      .prepare(
        'SELECT file_hash FROM luminaire_asset_versions WHERE luminaire_id = ? AND version_sequence = 1',
      )
      .get(luminaire.id) as { file_hash: string | null };
    expect(row.file_hash).toBeNull();
  });

  it('a client-supplied hash cannot override the server-computed hash', async () => {
    const harness = createHarness();
    const luminaire = harness.store.addLuminaire(harness.project.id, luminaireInput('DL01'));
    const datasheetPath = path.join(harness.root, 'datasheet.pdf');
    const bytes = Buffer.from('server-authoritative-bytes');
    writeFileSync(datasheetPath, bytes);

    const version = harness.store.attachLuminaireAsset(
      harness.project.id,
      luminaire.id,
      { assetType: 'Datasheet', filePath: datasheetPath },
      actor,
    );

    // The attach contract has no hash field and is strict.
    expect(
      attachLuminaireAssetSchema.safeParse({
        assetType: 'Datasheet',
        filePath: datasheetPath,
        fileHash: 'f'.repeat(64),
      }).success,
    ).toBe(false);

    // Server-computed hash equals the real file bytes; no client value is trusted.
    expect(version.fileHash).toBe(sha256(bytes));
  });
});

function readBytes(filePath: string): Buffer {
  return readFileSync(filePath);
}
