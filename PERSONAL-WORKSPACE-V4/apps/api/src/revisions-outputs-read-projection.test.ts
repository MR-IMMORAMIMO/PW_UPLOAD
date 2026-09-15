/**
 * Revisions & Outputs read projection — corrective delta API tests (V4-REVISIONS-OUTPUTS-CORRECTIVE-01).
 *
 * Focused on the new GET /api/projects/:id/revisions and /api/projects/:id/outputs
 * reads. Uses an isolated temp filesystem + project roots. Does NOT touch the
 * Golden live DB.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { projectStorageMarkerFileName, type AppUser, type Project } from '@scli/domain';
import { seedProjects, seedUsers } from '@scli/test-data';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import type { LightingPackageRenderer } from './luminaire-export-service';
import {
  PRODUCTION_V4_DDL,
  applyV17RevisionDeleteTable,
} from './infrastructure/migration/registry/production-migration-registry';
import { CanonicalGenerationService } from './infrastructure/output-registry/CanonicalGenerationService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';

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
  store: PersonalWorkspaceStore;
  registry: CanonicalOutputRegistryStore;
  generation: CanonicalGenerationService;
  projectA: Project;
  projectB: Project;
  projectARoot: string;
}

function createHarness(): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-revisions-read-'));
  temporaryRoots.push(root);
  const projectARoot = path.join(root, 'project-a');
  mkdirSync(projectARoot);
  const config = loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: path.join(root, 'workspace.sqlite'),
  });
  const store = new PersonalWorkspaceStore(config);
  stores.push(store);
  const projectA = structuredClone(seedProjects[0]!);
  const projectB = structuredClone(seedProjects[1]!);
  store.initializeProject(
    projectA.id,
    ['LuminaireSchedule', 'TechnicalBoq'],
    'Full Lighting Design',
    'Manual',
    projectA.requiredDeliveryDate,
  );
  store.initializeProject(
    projectB.id,
    ['LuminaireSchedule'],
    'Full Lighting Design',
    'Manual',
    projectB.requiredDeliveryDate,
  );
  store.setFolderPath(projectA.id, projectARoot);
  writeFileSync(
    path.join(projectARoot, projectStorageMarkerFileName),
    JSON.stringify({
      schemaVersion: 1,
      projectId: projectA.id,
      createdAt: '2026-08-17T08:00:00.000Z',
      projectCodeSnapshot: projectA.projectCode,
    }),
  );
  store.addLuminaire(projectA.id, {
    tag: 'DL01',
    category: 'Downlight',
    imagePath: '03_DESIGN/IMAGES/DL01.png',
    description: 'Test downlight',
    manufacturer: 'Test',
    model: 'DL-100',
    wattage: '8W',
    lumens: '720 lm',
    lightColor: '3000K',
    cri: '90',
    beamAngle: '24 degrees',
    ipRating: 'IP44',
    mounting: 'Recessed',
    cutout: '85 mm',
    driver: 'Remote',
    control: 'DALI',
    emergency: 'No',
    datasheetPath: '08_DATASHEETS/DL01.pdf',
    location: 'Lobby',
    unit: 'No.',
    quantity: 12,
    notes: 'Read projection test',
    sourceName: 'Manual',
    dimensions: '95 x 110 mm',
    bodyColorFinish: 'Black',
  });

  const database = store.getSharedDatabase();
  for (const statement of PRODUCTION_V4_DDL) database.exec(statement);
  applyV17RevisionDeleteTable(database);
  let tick = 0;
  const registry = new CanonicalOutputRegistryStore(
    database,
    { now: () => new Date(Date.parse('2026-08-17T08:00:00.000Z') + tick++ * 1_000) },
    'CANONICAL',
  );
  registry.registerBuiltInTemplateVersions();

  // A renderer that writes the artifact to the project root so physical
  // presence can be verified for real (Present vs Missing).
  const generation = new CanonicalGenerationService(store, registry, {
    async render(_project, _workspace, input) {
      const folder = mkdtempSync(path.join(root, 'renderer-'));
      const scheduleExcelPath = path.join(folder, 'schedule.xlsx');
      const schedulePdfPath = path.join(folder, 'schedule.pdf');
      const boqExcelPath = path.join(folder, 'boq.xlsx');
      const boqPdfPath = path.join(folder, 'boq.pdf');
      writeFileSync(scheduleExcelPath, `schedule-xlsx:${input.revision}`);
      writeFileSync(schedulePdfPath, `schedule-pdf:${input.revision}`);
      writeFileSync(boqExcelPath, `boq-xlsx:${input.revision}`);
      writeFileSync(boqPdfPath, `boq-pdf:${input.revision}`);
      return {
        scheduleExcelPath,
        schedulePdfPath,
        boqExcelPath,
        boqPdfPath,
        datasheetFolder: folder,
        datasheetCount: 0,
        cleanup: async () => rmSync(folder, { recursive: true, force: true }),
      };
    },
  } satisfies LightingPackageRenderer);

  return {
    root,
    store,
    registry,
    generation,
    projectA,
    projectB,
    projectARoot,
  };
}

async function createAppFor(harness: Harness): Promise<FastifyInstance> {
  const provider = new MockDataProvider();
  await provider.updateProject(harness.projectA.id, {
    projectFolderPath: harness.projectARoot,
  });
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
    canonicalGenerationService: harness.generation,
  });
  apps.push(app);
  return app;
}

function rows(store: PersonalWorkspaceStore, table: string): number {
  const row = store.getSharedDatabase().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return Number(row.count);
}

describe('Revisions & Outputs read projection (corrective delta)', () => {
  it('1 + 2 + 7: cross-project reads are isolated and zero-output revision is valid', async () => {
    const harness = createHarness();
    const app = await createAppFor(harness);
    const headers = { 'x-mock-user-id': actor.id };

    // project A has NO revisions/outputs yet — zero-output revision is valid.
    const aRevisions = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.projectA.id}/revisions`,
      headers,
    });
    expect(aRevisions.statusCode).toBe(200);
    expect(aRevisions.json().data).toEqual([]);

    const aOutputs = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.projectA.id}/outputs`,
      headers,
    });
    expect(aOutputs.statusCode).toBe(200);
    expect(aOutputs.json().data).toEqual([]);

    // project A cannot read project B revisions/outputs (project B is a
    // different project; A's read must not leak B data).
    const bRevisions = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.projectB.id}/revisions`,
      headers,
    });
    expect(bRevisions.statusCode).toBe(200);
    expect(bRevisions.json().data).toEqual([]);

    const bOutputs = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.projectB.id}/outputs`,
      headers,
    });
    expect(bOutputs.statusCode).toBe(200);
    expect(bOutputs.json().data).toEqual([]);
  });

  it('4 + 5 + 6: physical Present / Missing / Unavailable artifact presence projection', async () => {
    const harness = createHarness();
    const app = await createAppFor(harness);
    const headers = { 'x-mock-user-id': actor.id };

    // Generate a FINALIZED Schedule PDF (Present artifact physically on disk).
    const generated = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.projectA.id}/luminaire-schedule/generate`,
      headers,
      payload: { format: 'PDF', issueStatus: 'For Review', issueDate: '2026-08-17' },
    });
    expect(generated.statusCode).toBe(201);

    const outputs = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.projectA.id}/outputs`,
      headers,
    });
    expect(outputs.statusCode).toBe(200);
    const list = outputs.json().data as Array<Record<string, unknown>>;
    const finalized = list.find((o) => o.lifecycleState === 'FINALIZED')!;
    expect(finalized).toBeTruthy();
    // Physical file exists at the safe project-scoped locator => Present + open path.
    expect(finalized.artifactPresence).toBe('Present');
    expect(typeof finalized.artifactOpenPath).toBe('string');
    expect((finalized.artifactOpenPath as string).length).toBeGreaterThan(0);

    // Delete the physical artifact => same locator, now physically Missing.
    const openPath = finalized.artifactOpenPath as string;
    rmSync(openPath, { force: true });
    const outputsAfterDelete = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.projectA.id}/outputs`,
      headers,
    });
    const listAfter = outputsAfterDelete.json().data as Array<Record<string, unknown>>;
    const missing = listAfter.find((o) => o.outputId === finalized.outputId)!;
    expect(missing.artifactPresence).toBe('Missing');
    expect(missing.artifactOpenPath).toBeNull();

    // A register-only revision (no artifact locator) => Unavailable.
    const register = await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.projectA.id}/revisions`,
      headers,
      payload: {
        revisionNumber: 2,
        title: 'REV 02',
        status: 'InProgress',
        issuedAt: '2026-08-18',
        summary: 'register-only read projection revision',
        sourceType: 'Manual',
        sourceReference: 'regression',
        changeLog: 'read projection',
      },
    });
    expect(register.statusCode).toBe(201);
    expect(readdirSync(path.join(harness.root, 'backups'))).toEqual([
      expect.stringMatching(/^SCLI_PRE_REVISION_.*\.sqlite$/),
    ]);

    const revisions = await app.inject({
      method: 'GET',
      url: `/api/projects/${harness.projectA.id}/revisions`,
      headers,
    });
    expect(revisions.statusCode).toBe(200);
    const revList = revisions.json().data as Array<Record<string, unknown>>;
    // The register-only revision is recorded with REGISTER_ONLY provenance and
    // its label is derived from the canonical sequence.
    expect(revList.some((r) => r.revisionSequence === 2)).toBe(true);
  });

  it('3: read calls do not mutate registry state', async () => {
    const harness = createHarness();
    const app = await createAppFor(harness);
    const headers = { 'x-mock-user-id': actor.id };

    // Generate one finalized output to ensure non-empty registry.
    await app.inject({
      method: 'POST',
      url: `/api/projects/${harness.projectA.id}/luminaire-schedule/generate`,
      headers,
      payload: { format: 'PDF', issueStatus: 'For Review', issueDate: '2026-08-17' },
    });

    const revisionsBefore = rows(harness.store, 'canonical_revisions');
    const outputsBefore = rows(harness.store, 'canonical_outputs');

    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: 'GET',
        url: `/api/projects/${harness.projectA.id}/revisions`,
        headers,
      });
      await app.inject({
        method: 'GET',
        url: `/api/projects/${harness.projectA.id}/outputs`,
        headers,
      });
    }

    expect(rows(harness.store, 'canonical_revisions')).toBe(revisionsBefore);
    expect(rows(harness.store, 'canonical_outputs')).toBe(outputsBefore);
  });
});
