import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  CanonicalLuminaireSnapshot,
  CanonicalRevisionRecord,
  Project,
  ProjectActionItem,
  ProjectStorageHealth,
  ProjectWorkspace,
} from '@scli/domain';
import { PRODUCTION_MIGRATIONS } from '../migration/registry/production-migration-registry';
import { ProjectIntelligenceStore } from './ProjectIntelligenceStore';
import {
  ProjectIntelligenceService,
  type ProjectIntelligenceServiceDeps,
} from './ProjectIntelligenceService';

const NOW = '2026-08-29T00:00:00.000Z';
const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const REV_A = '20000000-0000-4000-8000-000000000001';
const REV_B = '20000000-0000-4000-8000-000000000002';
const LUM_A = '30000000-0000-4000-8000-000000000001';
const LUM_B = '30000000-0000-4000-8000-000000000002';

const temporaryRoots: string[] = [];
afterEach(() => {
  while (temporaryRoots.length > 0) rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
});

function migrateThrough(target: number): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= target)) {
    if (migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION') {
      database.exec('PRAGMA foreign_keys=OFF');
    }
    database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
    migration.up({
      database,
      migrationId: migration.id,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      clock: { now: () => new Date(NOW) },
    });
    database.exec('COMMIT');
    database.exec('PRAGMA foreign_keys=ON');
  }
  return database;
}

function snapshot(
  luminaireId: string,
  tag: string,
  overrides: Partial<CanonicalLuminaireSnapshot> = {},
): CanonicalLuminaireSnapshot {
  return {
    luminaireId,
    tag,
    category: 'Downlight',
    imagePath: '',
    description: 'Fixture',
    manufacturer: 'Acme',
    model: 'A100',
    wattage: '15 W',
    lumens: '1200 lm',
    lightColor: '3000 K',
    cri: '>90',
    beamAngle: '36 deg',
    ipRating: 'IP65',
    mounting: 'Recessed',
    cutout: '',
    driver: '',
    control: '',
    emergency: '',
    datasheetPath: '',
    location: 'Lobby',
    unit: 'No.',
    quantity: 1,
    notes: '',
    sourceName: 'test',
    dimensions: '',
    bodyColorFinish: 'White',
    attachmentReferences: [],
    ...overrides,
  };
}

function revision(
  revisionId: string,
  label: string,
  luminaireSnapshot: CanonicalLuminaireSnapshot[],
): CanonicalRevisionRecord {
  return {
    revisionId,
    projectId: PROJECT_ID,
    revisionSequence: 1,
    revisionLabel: label,
    purpose: null,
    internalNote: null,
    lifecycleState: 'FINALIZED',
    projectSnapshot: null,
    luminaireSnapshot,
    snapshotHash: null,
    createdById: null,
    createdByName: null,
    provenanceClassification: 'CANONICAL',
    legacySourceId: null,
    failureReason: null,
    createdAt: NOW,
    finalizedAt: NOW,
    updatedAt: NOW,
  };
}

function project(): Project {
  return {
    id: PROJECT_ID,
    projectCode: 'P-001',
    projectName: 'Test Project',
    clientName: 'Client',
    projectType: 'Lighting Design',
    description: '',
    salesOwnerId: 'owner',
    salesOwnerNameSnapshot: 'Owner',
    salesOwnerEmailSnapshot: 'owner@x.com',
    createdById: 'owner',
    createdByNameSnapshot: 'Owner',
    createdByEmailSnapshot: 'owner@x.com',
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Site',
    designStage: 'DetailedDesign',
    lightingScope: '',
    luxRequirements: '',
    drawingReference: '',
    status: 'Active' as Project['status'],
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 1,
    actualHours: 0,
    progressPercent: 0,
    requiredDeliveryDate: '2028-12-15',
    projectFolderUrl: null,
    revisionNumber: 1,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    cancelledAt: null,
    version: 1,
  };
}

function workspace(actions: ProjectActionItem[], folderPath: string | null): ProjectWorkspace {
  return {
    projectId: PROJECT_ID,
    folderPath,
    folderProfile: 'default',
    folderStructure: [],
    outputFolders: {
      scheduleExcel: '',
      schedulePdf: '',
      boqExcel: '',
      boqPdf: '',
      datasheets: '',
    },
    services: [],
    deliverables: [],
    lightingPackage: {
      projectId: PROJECT_ID,
      inputMode: 'Manual',
      pdfPaperSize: 'A4',
      scheduleColumns: [],
      boqColumns: [],
      updatedAt: NOW,
    },
    luminaires: [],
    exports: [],
    revisionPackages: [],
    requirements: [],
    tags: [],
    scopeNotes: [],
    checklist: [],
    actions,
    meetings: [],
    reviewItems: [],
    revisions: [],
    documents: [],
    fileCenter: [],
    contacts: [],
    communications: [],
    activity: [],
    health: {
      score: 0,
      checklistPercent: 0,
      openRequirements: 0,
      blockingRequirements: 0,
      overdueActions: 0,
      unresolvedReviews: 0,
      checks: [],
    },
    updatedAt: NOW,
  };
}

function connectedHealth(): ProjectStorageHealth {
  return {
    projectId: PROJECT_ID,
    state: 'CONNECTED',
    reason: null,
    projectPath: null,
    workspacePath: null,
    canonicalPath: null,
    marker: null,
    canOpenFolder: true,
    canReconnect: false,
    canAdoptLegacy: false,
    checkedAt: NOW,
  };
}

function makeService(overrides: Partial<ProjectIntelligenceServiceDeps> = {}) {
  const database = migrateThrough(28);
  const sourceStore = new ProjectIntelligenceStore(database, 'LEGACY_SELF_MANAGED');
  const revisions = new Map<string, CanonicalRevisionRecord>();
  const registry = {
    getRevision: (id: string) => {
      const found = revisions.get(id);
      if (!found) throw new Error('NOT_FOUND');
      return found;
    },
  } as never;
  const deps: ProjectIntelligenceServiceDeps = {
    personalStore: {
      getWorkspace: () => workspace([], null),
    },
    registry,
    sourceStore,
    storageHealth: async () => connectedHealth(),
    localIntelligence: async () => ({ checks: [] }),
    clock: () => new Date(NOW),
    ...overrides,
  };
  const service = new ProjectIntelligenceService(deps);
  return { service, sourceStore, revisions, database };
}

describe('ProjectIntelligenceService', () => {
  it('classifies ADDED / REMOVED / CHANGED / UNCHANGED by UUID and summarizes impact', () => {
    const { service, revisions } = makeService();
    revisions.set(
      REV_A,
      revision(REV_A, 'Rev A', [
        snapshot(LUM_A, 'L01', { quantity: 1 }),
        snapshot(LUM_B, 'L02', { wattage: '15 W' }),
      ]),
    );
    revisions.set(
      REV_B,
      revision(REV_B, 'Rev B', [
        snapshot(LUM_A, 'L01', { quantity: 2 }),
        snapshot(LUM_B, 'L02', { wattage: '20 W' }),
        snapshot('40000000-0000-4000-8000-000000000001', 'L03'),
      ]),
    );
    const comparison = service.compareRevisions(project(), REV_A, REV_B);
    expect(comparison.summary).toMatchObject({
      added: 1,
      removed: 0,
      changed: 2,
      unchanged: 0,
      quantityChanges: 1,
      technicalChanges: 1,
    });
    expect(comparison.summary.impactedCategories).toContain('QUANTITY_BOQ_IMPACT');
    expect(comparison.summary.impactedCategories).toContain('TECHNICAL_SCHEDULE_IMPACT');
    const changed = comparison.luminaires.filter((item) => item.changeType === 'CHANGED');
    expect(changed).toHaveLength(2);
    expect(changed.every((item) => item.changedFields.length > 0)).toBe(true);
  });

  it('rejects comparing the same Revision and requires two different Revisions', () => {
    const { service, revisions } = makeService();
    revisions.set(REV_A, revision(REV_A, 'Rev A', [snapshot(LUM_A, 'L01')]));
    expect(() => service.compareRevisions(project(), REV_A, REV_A)).toThrow(
      /two different Revisions/,
    );
  });

  it('readiness is NOT_READY when an open blocking Action exists', async () => {
    const blockingAction: ProjectActionItem = {
      id: '50000000-0000-4000-8000-000000000001',
      projectId: PROJECT_ID,
      title: 'Fix layout',
      details: '',
      owner: 'owner',
      ownerRole: '',
      dueDate: null,
      status: 'Open',
      priority: 'High',
      sourceType: 'Manual',
      sourceId: null,
      revisionId: null,
      categoryId: null,
      notes: '',
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      blocksIssue: true,
      rowVersion: 1,
    };
    const { service, revisions } = makeService({
      personalStore: { getWorkspace: () => workspace([blockingAction], null) },
    });
    revisions.set(REV_A, revision(REV_A, 'Rev A', [snapshot(LUM_A, 'L01')]));
    const result = await service.readiness(project(), REV_A);
    expect(result.level).toBe('NOT_READY');
    expect(result.counts.openBlockingActions).toBe(1);
    expect(result.findings.some((finding) => finding.code === 'ACTION_BLOCKS_ISSUE')).toBe(true);
  });

  it('readiness is READY when all authorities pass', async () => {
    const { service, revisions } = makeService();
    revisions.set(REV_A, revision(REV_A, 'Rev A', [snapshot(LUM_A, 'L01')]));
    const result = await service.readiness(project(), REV_A);
    expect(result.level).toBe('READY');
    expect(result.counts.blockers).toBe(0);
    expect(result.counts.warnings).toBe(0);
  });

  it('source freshness reports FRESH / STALE / MISSING / NOT_BASELINED', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scli-p5d-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'plan.dwg');
    const planBytes = Buffer.from('plan-bytes');
    writeFileSync(filePath, planBytes);
    const planHash = createHash('sha256').update(planBytes).digest('hex');
    const { service, sourceStore, revisions } = makeService({
      personalStore: { getWorkspace: () => workspace([], root) },
    });
    revisions.set(REV_A, revision(REV_A, 'Rev A', [snapshot(LUM_A, 'L01')]));
    const source = sourceStore.registerSourceFile({
      projectId: PROJECT_ID,
      sourceType: 'AUTOCAD',
      displayName: 'plan.dwg',
      originalRelativeLocator: 'plan.dwg',
      sha256: planHash,
      sizeBytes: planBytes.length,
      modifiedAt: NOW,
      now: NOW,
    });
    // No baseline yet -> NOT_BASELINED.
    let items = await service.listSourceFreshness(project(), REV_A);
    expect(items[0]!.state).toBe('NOT_BASELINED');
    // Capture a baseline matching the current bytes -> FRESH.
    sourceStore.captureBaseline({
      projectId: PROJECT_ID,
      revisionId: REV_A,
      sourceFileId: source.id,
      sha256: planHash,
      sizeBytes: planBytes.length,
      capturedAt: NOW,
      capturedById: 'actor',
      capturedByName: 'Actor',
    });
    items = await service.listSourceFreshness(project(), REV_A);
    expect(items[0]!.state).toBe('FRESH');
    // Change the file -> STALE.
    writeFileSync(filePath, 'changed-bytes');
    items = await service.listSourceFreshness(project(), REV_A);
    expect(items[0]!.state).toBe('STALE');
    // Remove the file -> MISSING.
    rmSync(filePath, { force: true });
    items = await service.listSourceFreshness(project(), REV_A);
    expect(items[0]!.state).toBe('MISSING');
  });
});
