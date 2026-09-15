import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import {
  DomainError,
  adaptLegacyFolderStructure,
  adaptLegacyOutputMappings,
  buildOutputMappings,
  buildProjectFolderSnapshot,
  deriveFolderRelativePath,
  folderProfileStructuralFingerprint,
  folderStructureFromSnapshot,
  orderFolderNodes,
  rebuildFolderSnapshot,
  rebuildOutputMappings,
  renameFolderInSnapshot,
  resolveLegacyOutputDestination,
  validateFolderSnapshot,
  type FolderNodePreset,
  type ProjectOutputFolders,
} from '@scli/domain';
import { projectOutputMappingsSchema } from '@scli/contracts';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';

const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');

const temporaryDirectories: string[] = [];
const closeables: Array<{ close(): Promise<void> | void }> = [];

afterEach(async () => {
  for (const resource of closeables.splice(0).reverse()) await resource.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeConfig(databasePath: string, projectRoot: string): AppConfig {
  return loadConfig({
    APP_MODE: 'standalone',
    WORKSPACE_VARIANT: 'personal',
    PERSONAL_AUTO_LOGIN: 'true',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    STANDALONE_DB_PATH: databasePath,
    STANDALONE_SESSION_SECRET: 'p24b1-reality-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
    PERSONAL_DEFAULT_FOLDER_PROFILE: 'Full Lighting Design',
  });
}

function sequentialIds(): () => string {
  let next = 0;
  return () => `id-${(next += 1)}`;
}

const syntheticProfileFolders: FolderNodePreset[] = [
  { name: '00_RECEIVED', children: [] },
  { name: '01_WORKING', children: [] },
  { name: '02_CALCULATIONS', children: [] },
  { name: '03_DRAWINGS', children: [] },
  {
    name: '04_TECHNICAL',
    children: [
      { name: 'DATASHEETS', children: [] },
      { name: 'BOQ', children: [] },
    ],
  },
  { name: '05_DELIVERABLES', children: [] },
];

const syntheticProfileOutputs: ProjectOutputFolders = {
  scheduleExcel: '04_TECHNICAL',
  schedulePdf: '04_TECHNICAL',
  boqExcel: '04_TECHNICAL/BOQ',
  boqPdf: '04_TECHNICAL/BOQ',
  datasheets: '04_TECHNICAL/DATASHEETS',
};

const mutatedProfileFolders: FolderNodePreset[] = [
  { name: '00_RECEIVED', children: [] },
  { name: '01_WORKING', children: [] },
  { name: '02_CALCULATIONS', children: [] },
  { name: '03_LIGHTING_DRAWINGS', children: [] },
  { name: 'MOCKUP', children: [] },
  {
    name: '04_TECHNICAL',
    children: [
      { name: 'DATASHEETS', children: [] },
      { name: 'BOQ', children: [] },
    ],
  },
  { name: '05_DELIVERABLES', children: [] },
];

const mutatedProfileOutputs: ProjectOutputFolders = {
  ...syntheticProfileOutputs,
  boqExcel: '05_DELIVERABLES',
  boqPdf: '05_DELIVERABLES',
};

describe('P2.4B1 canonical folder snapshot model', () => {
  it('assigns stable folder identities independent of name, order, and path', () => {
    const folders: FolderNodePreset[] = [
      { name: '01_INPUT', children: [{ name: 'CAD', children: [] }] },
      { name: '02_DESIGN', children: [] },
    ];
    const snapshot = buildProjectFolderSnapshot(folders, null, sequentialIds());
    expect(snapshot.folders.map((folder) => folder.folderId)).toEqual(['id-1', 'id-2', 'id-3']);
    expect(snapshot.folders.every((folder) => folder.enabled)).toBe(true);
    expect(snapshot.folders.every((folder) => folder.semanticRole === null)).toBe(true);

    // Renaming a folder keeps its identity in the pure model.
    const renamed = renameFolderInSnapshot(snapshot, 'id-1', '01_RECEIVED');
    expect(renamed.folders.find((folder) => folder.folderId === 'id-1')?.name).toBe('01_RECEIVED');
    expect(renamed.folders.find((folder) => folder.name === 'CAD')?.folderId).toBe('id-2');

    // Rebuilding from presets keeps identities for unchanged paths, independent of order.
    const reordered = rebuildFolderSnapshot(
      snapshot,
      [
        { name: '02_DESIGN', children: [] },
        { name: '01_INPUT', children: [{ name: 'CAD', children: [] }] },
      ],
      () => 'new-id',
    );
    expect(reordered.folders.find((folder) => folder.name === 'CAD')?.folderId).toBe('id-2');
    expect(reordered.folders.find((folder) => folder.name === '02_DESIGN')?.folderId).toBe('id-3');
  });

  it('rejects duplicate folder ids, missing parents, and hierarchy cycles', () => {
    const base = {
      schemaVersion: '1.0' as const,
      sourceProfile: null,
    };
    expect(() =>
      validateFolderSnapshot({
        ...base,
        folders: [
          {
            folderId: 'a',
            parentFolderId: null,
            name: 'A',
            displayOrder: 0,
            enabled: true,
            semanticRole: null,
          },
          {
            folderId: 'a',
            parentFolderId: null,
            name: 'B',
            displayOrder: 1,
            enabled: true,
            semanticRole: null,
          },
        ],
      }),
    ).toThrow(DomainError);
    expect(() =>
      validateFolderSnapshot({
        ...base,
        folders: [
          {
            folderId: 'a',
            parentFolderId: null,
            name: 'A',
            displayOrder: 0,
            enabled: true,
            semanticRole: null,
          },
          {
            folderId: 'b',
            parentFolderId: 'missing',
            name: 'B',
            displayOrder: 1,
            enabled: true,
            semanticRole: null,
          },
        ],
      }),
    ).toThrow(DomainError);
    expect(() =>
      validateFolderSnapshot({
        ...base,
        folders: [
          {
            folderId: 'a',
            parentFolderId: 'b',
            name: 'A',
            displayOrder: 0,
            enabled: true,
            semanticRole: null,
          },
          {
            folderId: 'b',
            parentFolderId: 'a',
            name: 'B',
            displayOrder: 1,
            enabled: true,
            semanticRole: null,
          },
        ],
      }),
    ).toThrow(DomainError);
  });

  it('derives relative paths from hierarchy and names, not a second mutable source', () => {
    const snapshot = buildProjectFolderSnapshot(
      [{ name: '04_TECHNICAL', children: [{ name: 'BOQ', children: [] }] }],
      null,
      sequentialIds(),
    );
    const boq = snapshot.folders.find((folder) => folder.name === 'BOQ');
    expect(boq).toBeDefined();
    expect(deriveFolderRelativePath(snapshot, boq!.folderId)).toBe('04_TECHNICAL/BOQ');
    expect(deriveFolderRelativePath(snapshot, 'missing')).toBeNull();
  });

  it('orders folders deterministically with parents before children', () => {
    const snapshot = buildProjectFolderSnapshot(
      [
        { name: 'B', children: [{ name: 'B1', children: [] }] },
        { name: 'A', children: [{ name: 'A1', children: [] }] },
      ],
      null,
      sequentialIds(),
    );
    const ordered = orderFolderNodes(snapshot);
    expect(ordered.map((folder) => folder.name)).toEqual(['B', 'B1', 'A', 'A1']);
    expect(folderStructureFromSnapshot(snapshot)).toEqual([
      { name: 'B', children: [{ name: 'B1', children: [] }] },
      { name: 'A', children: [{ name: 'A1', children: [] }] },
    ]);
  });

  it('adapts legacy folder JSON deterministically and preserves unknown folders', () => {
    const legacy: FolderNodePreset[] = [
      { name: '01_INPUT', children: [{ name: 'CAD', children: [] }] },
      { name: 'UNKNOWN_FOLDER', children: [] },
    ];
    const first = adaptLegacyFolderStructure('project-1', legacy, []);
    const second = adaptLegacyFolderStructure('project-1', legacy, []);
    expect(first.folders.map((folder) => folder.folderId)).toEqual(
      second.folders.map((folder) => folder.folderId),
    );
    expect(first.folders.some((folder) => folder.name === 'UNKNOWN_FOLDER')).toBe(true);
    expect(first.sourceProfile).toBeNull();

    const otherProject = adaptLegacyFolderStructure('project-2', legacy, []);
    expect(otherProject.folders[0]?.folderId).not.toBe(first.folders[0]?.folderId);

    const pathList = adaptLegacyFolderStructure('project-1', ['01_INPUT/CAD', '02_DESIGN'], []);
    expect(pathList.folders.map((folder) => folder.name)).toEqual(['01_INPUT', 'CAD', '02_DESIGN']);
  });

  it('gives nested folders with duplicate basenames distinct legacy identities', () => {
    const legacy: FolderNodePreset[] = [
      { name: '01_WORKING', children: [{ name: 'BOQ', children: [] }] },
      { name: '04_TECHNICAL', children: [{ name: 'BOQ', children: [] }] },
    ];
    const snapshot = adaptLegacyFolderStructure('project-1', legacy, []);
    const boqs = snapshot.folders.filter((folder) => folder.name === 'BOQ');
    expect(boqs).toHaveLength(2);
    expect(boqs[0]?.folderId).not.toBe(boqs[1]?.folderId);
    expect(deriveFolderRelativePath(snapshot, boqs[0]!.folderId)).toBe('01_WORKING/BOQ');
    expect(deriveFolderRelativePath(snapshot, boqs[1]!.folderId)).toBe('04_TECHNICAL/BOQ');
  });

  it('computes a structural fingerprint that ignores JSON key order but detects structure changes', () => {
    const first = folderProfileStructuralFingerprint(
      syntheticProfileFolders,
      syntheticProfileOutputs,
    );
    const second = folderProfileStructuralFingerprint(structuredClone(syntheticProfileFolders), {
      ...syntheticProfileOutputs,
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(
      folderProfileStructuralFingerprint(mutatedProfileFolders, mutatedProfileOutputs),
    ).not.toBe(first);
  });
});

describe('P2.4B1 output mapping model', () => {
  it('maps known output types to destination folder ids', () => {
    const snapshot = buildProjectFolderSnapshot(syntheticProfileFolders, null, sequentialIds());
    const mappings = buildOutputMappings(syntheticProfileOutputs, snapshot);
    const boq = snapshot.folders.find((folder) => folder.name === 'BOQ');
    const technical = snapshot.folders.find((folder) => folder.name === '04_TECHNICAL');
    expect(
      mappings.find((mapping) => mapping.outputTypeId === 'boqExcel')?.destinationFolderId,
    ).toBe(boq?.folderId);
    expect(
      mappings.find((mapping) => mapping.outputTypeId === 'scheduleExcel')?.destinationFolderId,
    ).toBe(technical?.folderId);
    expect(mappings.every((mapping) => !mapping.unresolved)).toBe(true);
  });

  it('keeps the same folder id when a destination folder name changes in memory', () => {
    const snapshot = buildProjectFolderSnapshot(
      [{ name: '04_TECHNICAL', children: [{ name: 'BOQ', children: [] }] }],
      null,
      sequentialIds(),
    );
    const mappings = buildOutputMappings(
      { ...syntheticProfileOutputs, boqExcel: '04_TECHNICAL/BOQ' },
      snapshot,
    );
    const boqId = snapshot.folders.find((folder) => folder.name === 'BOQ')?.folderId;
    const renamedSnapshot = renameFolderInSnapshot(snapshot, boqId!, 'BOQ_FINAL');
    expect(renamedSnapshot.folders.find((folder) => folder.folderId === boqId)?.name).toBe(
      'BOQ_FINAL',
    );
    const renamedMappings = rebuildOutputMappings(mappings, renamedSnapshot, {
      ...syntheticProfileOutputs,
      boqExcel: '04_TECHNICAL/BOQ_FINAL',
    });
    expect(
      renamedMappings.find((mapping) => mapping.outputTypeId === 'boqExcel')?.destinationFolderId,
    ).toBe(boqId);
  });

  it('preserves unknown/custom output types through rebuilds', () => {
    const snapshot = buildProjectFolderSnapshot(syntheticProfileFolders, null, sequentialIds());
    const deliverables = snapshot.folders.find((folder) => folder.name === '05_DELIVERABLES');
    const custom = {
      outputTypeId: 'Reports',
      destinationFolderId: deliverables?.folderId ?? null,
      unresolved: false,
      legacyPath: null,
    };
    const rebuilt = rebuildOutputMappings([custom], snapshot, syntheticProfileOutputs);
    expect(rebuilt.some((mapping) => mapping.outputTypeId === 'Reports')).toBe(true);
  });

  it('rejects duplicate output type mappings in canonical storage', () => {
    const snapshot = buildProjectFolderSnapshot(syntheticProfileFolders, null, sequentialIds());
    const boq = snapshot.folders.find((folder) => folder.name === 'BOQ');
    const mapping = {
      outputTypeId: 'boqExcel',
      destinationFolderId: boq?.folderId ?? null,
      unresolved: false,
      legacyPath: null,
    };
    expect(
      projectOutputMappingsSchema.safeParse({
        schemaVersion: '1.0',
        mappings: [mapping, { ...mapping, destinationFolderId: null, unresolved: true }],
      }).success,
    ).toBe(false);
  });

  it('resolves unique legacy destinations and never guesses ambiguous ones', () => {
    const snapshot = adaptLegacyFolderStructure(
      'project-1',
      [
        { name: '01_WORKING', children: [{ name: 'BOQ', children: [] }] },
        { name: '04_TECHNICAL', children: [{ name: 'BOQ', children: [] }] },
        { name: '05_DELIVERABLES', children: [] },
      ],
      [],
    );
    const unique = resolveLegacyOutputDestination(snapshot, '04_TECHNICAL/BOQ');
    expect(unique?.name).toBe('BOQ');
    expect(resolveLegacyOutputDestination(snapshot, 'BOQ')).toBeNull();
    expect(resolveLegacyOutputDestination(snapshot, 'MISSING/BOQ')).toBeNull();
  });

  it('keeps unresolved legacy output mappings explicit and diagnosable', () => {
    const snapshot = adaptLegacyFolderStructure('project-1', syntheticProfileFolders, []);
    const mappings = adaptLegacyOutputMappings(
      { boqExcel: 'MISSING/BOQ', datasheets: '04_TECHNICAL/DATASHEETS' },
      snapshot,
      syntheticProfileOutputs,
    );
    const missing = mappings.find((mapping) => mapping.outputTypeId === 'boqExcel');
    expect(missing?.unresolved).toBe(true);
    expect(missing?.destinationFolderId).toBeNull();
    expect(missing?.legacyPath).toBe('MISSING/BOQ');
    const resolved = mappings.find((mapping) => mapping.outputTypeId === 'datasheets');
    expect(resolved?.unresolved).toBe(false);
    expect(resolved?.destinationFolderId).not.toBeNull();
  });
});

describe('P2.4B1 workspace store reality', () => {
  it('creates an independent canonical snapshot and reopens with identical ids and mappings', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-store-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const profileName = 'Synthetic Full Lighting Design';
    store.saveFolderProfile({
      name: profileName,
      description: 'Synthetic reality profile.',
      folders: syntheticProfileFolders,
      outputFolders: syntheticProfileOutputs,
    });
    const projectId = randomUUID();
    const workspace = store.initializeProject(
      projectId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      profileName,
      'Later',
      '2026-08-20',
    );
    expect(workspace.folderSnapshot.schemaVersion).toBe('1.0');
    expect(workspace.folderSnapshot.sourceProfile).toMatchObject({
      profileId: profileName,
      profileName,
      profileRevision: null,
    });
    expect(workspace.folderSnapshot.sourceProfile?.structuralFingerprint).toBe(
      folderProfileStructuralFingerprint(syntheticProfileFolders, syntheticProfileOutputs),
    );
    expect(workspace.folderSnapshot.folders.length).toBeGreaterThan(0);
    expect(new Set(workspace.folderSnapshot.folders.map((folder) => folder.folderId)).size).toBe(
      workspace.folderSnapshot.folders.length,
    );
    expect(workspace.outputMappings.length).toBe(5);
    for (const mapping of workspace.outputMappings) {
      expect(mapping.unresolved).toBe(false);
      expect(
        workspace.folderSnapshot.folders.some(
          (folder) => folder.folderId === mapping.destinationFolderId,
        ),
      ).toBe(true);
    }

    const reopened = store.getWorkspace(projectId);
    expect(reopened.folderSnapshot.folders.map((folder) => folder.folderId)).toEqual(
      workspace.folderSnapshot.folders.map((folder) => folder.folderId),
    );
    expect(reopened.outputMappings).toEqual(workspace.outputMappings);
    expect(reopened.folderStructure).toEqual(syntheticProfileFolders);
  });

  it('keeps Project 1 on its original snapshot when the profile changes, and Project 2 gets the new structure', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-profile-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const profileName = 'Synthetic Full Lighting Design';
    store.saveFolderProfile({
      name: profileName,
      description: 'Synthetic reality profile.',
      folders: syntheticProfileFolders,
      outputFolders: syntheticProfileOutputs,
    });
    const projectOneId = randomUUID();
    const projectOne = store.initializeProject(
      projectOneId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      profileName,
      'Later',
      '2026-08-20',
    );
    const originalFingerprint = projectOne.folderSnapshot.sourceProfile?.structuralFingerprint;
    const originalNames = projectOne.folderSnapshot.folders.map((folder) => folder.name);
    const originalMappings = projectOne.outputMappings;

    // Mutate the synthetic profile: add MOCKUP, rename 03_DRAWINGS, move Technical BOQ.
    store.saveFolderProfile({
      name: profileName,
      description: 'Synthetic reality profile (mutated).',
      folders: mutatedProfileFolders,
      outputFolders: mutatedProfileOutputs,
    });

    const reopenedOne = store.getWorkspace(projectOneId);
    expect(reopenedOne.folderSnapshot.folders.map((folder) => folder.name)).toEqual(originalNames);
    expect(reopenedOne.folderSnapshot.sourceProfile?.structuralFingerprint).toBe(
      originalFingerprint,
    );
    expect(reopenedOne.outputMappings).toEqual(originalMappings);

    const projectTwoId = randomUUID();
    const projectTwo = store.initializeProject(
      projectTwoId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      profileName,
      'Later',
      '2026-08-20',
    );
    expect(projectTwo.folderSnapshot.folders.map((folder) => folder.name)).toContain('MOCKUP');
    expect(projectTwo.folderSnapshot.folders.map((folder) => folder.name)).toContain(
      '03_LIGHTING_DRAWINGS',
    );
    const boqMapping = projectTwo.outputMappings.find(
      (mapping) => mapping.outputTypeId === 'boqExcel',
    );
    const deliverables = projectTwo.folderSnapshot.folders.find(
      (folder) => folder.name === '05_DELIVERABLES',
    );
    expect(boqMapping?.destinationFolderId).toBe(deliverables?.folderId);
  });

  it('keeps output mappings on the same folder id when a folder name changes in memory only', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-rename-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const profileName = 'Synthetic Full Lighting Design';
    store.saveFolderProfile({
      name: profileName,
      description: 'Synthetic reality profile.',
      folders: syntheticProfileFolders,
      outputFolders: syntheticProfileOutputs,
    });
    const projectId = randomUUID();
    const workspace = store.initializeProject(
      projectId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      profileName,
      'Later',
      '2026-08-20',
    );
    const boqMapping = workspace.outputMappings.find(
      (mapping) => mapping.outputTypeId === 'boqExcel',
    );
    const boqFolder = workspace.folderSnapshot.folders.find(
      (folder) => folder.folderId === boqMapping?.destinationFolderId,
    );
    const renamedSnapshot = renameFolderInSnapshot(
      workspace.folderSnapshot,
      boqFolder?.folderId ?? '',
      'BOQ_FINAL',
    );
    const renamedBoq = renamedSnapshot.folders.find(
      (folder) => folder.folderId === boqFolder?.folderId,
    );
    expect(renamedBoq?.name).toBe('BOQ_FINAL');
    const renamedMappings = rebuildOutputMappings(workspace.outputMappings, renamedSnapshot, {
      ...syntheticProfileOutputs,
      boqExcel: '04_TECHNICAL/BOQ_FINAL',
      boqPdf: '04_TECHNICAL/BOQ_FINAL',
    });
    expect(
      renamedMappings.find((mapping) => mapping.outputTypeId === 'boqExcel')?.destinationFolderId,
    ).toBe(boqFolder?.folderId);
  });

  it('adapts a legacy workspace without writing, resolving unique outputs and preserving unresolved ones', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-legacy-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const projectId = randomUUID();
    store.initializeProject(
      projectId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      'Full Lighting Design',
      'Later',
      '2026-08-20',
      syntheticProfileFolders,
      syntheticProfileOutputs,
    );

    const legacyFolders: FolderNodePreset[] = [
      { name: '00_RECEIVED', children: [] },
      { name: '01_WORKING', children: [{ name: 'BOQ', children: [] }] },
      {
        name: '04_TECHNICAL',
        children: [
          { name: 'BOQ', children: [] },
          { name: 'DATASHEETS', children: [] },
        ],
      },
      { name: '05_DELIVERABLES', children: [] },
    ];
    const legacyOutputs: Record<string, string> = {
      scheduleExcel: '04_TECHNICAL',
      schedulePdf: '04_TECHNICAL',
      boqExcel: '04_TECHNICAL/BOQ',
      boqPdf: 'MISSING/PDF',
      datasheets: '04_TECHNICAL/DATASHEETS',
      Reports: '05_DELIVERABLES',
      Ambiguous: 'BOQ',
    };
    const raw = new DatabaseSync(config.STANDALONE_DB_PATH);
    raw
      .prepare(
        'UPDATE project_workspaces SET folders_json = ?, output_folders_json = ? WHERE project_id = ?',
      )
      .run(JSON.stringify(legacyFolders), JSON.stringify(legacyOutputs), projectId);
    raw.close();

    const workspace = store.getWorkspace(projectId);
    expect(workspace.folderSnapshot.sourceProfile).toBeNull();
    expect(workspace.folderSnapshot.folders.map((folder) => folder.name)).toEqual([
      '00_RECEIVED',
      '01_WORKING',
      'BOQ',
      '04_TECHNICAL',
      'BOQ',
      'DATASHEETS',
      '05_DELIVERABLES',
    ]);

    const boq = workspace.outputMappings.find((mapping) => mapping.outputTypeId === 'boqExcel');
    expect(boq?.unresolved).toBe(false);
    expect(boq?.destinationFolderId).not.toBeNull();
    const missing = workspace.outputMappings.find((mapping) => mapping.outputTypeId === 'boqPdf');
    expect(missing?.unresolved).toBe(true);
    expect(missing?.destinationFolderId).toBeNull();
    const reports = workspace.outputMappings.find((mapping) => mapping.outputTypeId === 'Reports');
    expect(reports?.unresolved).toBe(false);
    const ambiguous = workspace.outputMappings.find(
      (mapping) => mapping.outputTypeId === 'Ambiguous',
    );
    expect(ambiguous?.unresolved).toBe(true);
    expect(ambiguous?.destinationFolderId).toBeNull();

    // Repeated reads produce the same deterministic adapted ids.
    const again = store.getWorkspace(projectId);
    expect(again.folderSnapshot.folders.map((folder) => folder.folderId)).toEqual(
      workspace.folderSnapshot.folders.map((folder) => folder.folderId),
    );

    // Opening the legacy project must not rewrite its stored JSON.
    const readOnly = new DatabaseSync(config.STANDALONE_DB_PATH, { readOnly: true });
    const row = readOnly
      .prepare(
        'SELECT folders_json, output_folders_json FROM project_workspaces WHERE project_id = ?',
      )
      .get(projectId) as { folders_json: string; output_folders_json: string };
    readOnly.close();
    expect(row.folders_json).toBe(JSON.stringify(legacyFolders));
    expect(row.output_folders_json).toBe(JSON.stringify(legacyOutputs));
  });

  it('keeps the folder snapshot and output mappings untouched by scope edits', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-scope-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const projectId = randomUUID();
    store.initializeProject(
      projectId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      'Full Lighting Design',
      'Later',
      '2026-08-20',
      syntheticProfileFolders,
      syntheticProfileOutputs,
    );
    const before = store.getWorkspace(projectId);
    store.updateScope(projectId, [
      { code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { label: 'Mockup Review', custom: true },
    ]);
    const after = store.getWorkspace(projectId);
    expect(after.folderSnapshot).toEqual(before.folderSnapshot);
    expect(after.outputMappings).toEqual(before.outputMappings);
    expect(after.folderStructure).toEqual(before.folderStructure);
    expect(after.outputFolders).toEqual(before.outputFolders);
  });

  it('rejects identity-changing folder edits through workspace setup for canonical snapshots', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-guard-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const projectId = randomUUID();
    store.initializeProject(
      projectId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      'Full Lighting Design',
      'Later',
      '2026-08-20',
      syntheticProfileFolders,
      syntheticProfileOutputs,
    );
    const before = store.getWorkspace(projectId);
    const boq = before.folderSnapshot.folders.find((folder) => folder.name === 'BOQ');
    const boqMapping = before.outputMappings.find((mapping) => mapping.outputTypeId === 'boqExcel');
    expect(boq).toBeDefined();
    expect(boqMapping?.destinationFolderId).toBe(boq?.folderId);

    const renamedFolders: FolderNodePreset[] = [
      { name: '00_RECEIVED', children: [] },
      { name: '01_WORKING', children: [] },
      { name: '02_CALCULATIONS', children: [] },
      { name: '03_DRAWINGS', children: [] },
      {
        name: '04_TECHNICAL',
        children: [
          { name: 'DATASHEETS', children: [] },
          { name: 'TECHNICAL_BOQ', children: [] },
        ],
      },
      { name: '05_DELIVERABLES', children: [] },
    ];
    const renamedOutputs: ProjectOutputFolders = {
      ...syntheticProfileOutputs,
      boqExcel: '04_TECHNICAL/TECHNICAL_BOQ',
      boqPdf: '04_TECHNICAL/TECHNICAL_BOQ',
    };
    expect(() =>
      store.updateFolderConfiguration(
        projectId,
        'Full Lighting Design',
        renamedFolders,
        renamedOutputs,
      ),
    ).toThrow(DomainError);

    const after = store.getWorkspace(projectId);
    expect(after.folderSnapshot).toEqual(before.folderSnapshot);
    expect(after.outputMappings).toEqual(before.outputMappings);
  });

  it('allows identity-preserving folder additions on canonical snapshots', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-add-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const projectId = randomUUID();
    store.initializeProject(
      projectId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      'Full Lighting Design',
      'Later',
      '2026-08-20',
      syntheticProfileFolders,
      syntheticProfileOutputs,
    );
    const before = store.getWorkspace(projectId);
    const addedFolders: FolderNodePreset[] = [
      ...syntheticProfileFolders,
      { name: '06_MOCKUP', children: [] },
    ];
    store.updateFolderConfiguration(
      projectId,
      'Full Lighting Design',
      addedFolders,
      syntheticProfileOutputs,
    );
    const after = store.getWorkspace(projectId);
    expect(after.folderSnapshot.folders.map((folder) => folder.folderId)).toEqual(
      expect.arrayContaining(before.folderSnapshot.folders.map((folder) => folder.folderId)),
    );
    expect(after.folderSnapshot.folders.some((folder) => folder.name === '06_MOCKUP')).toBe(true);
  });

  it('still allows identity-changing edits on legacy projects through workspace setup', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-legacy-edit-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const projectId = randomUUID();
    store.initializeProject(
      projectId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      'Full Lighting Design',
      'Later',
      '2026-08-20',
      syntheticProfileFolders,
      syntheticProfileOutputs,
    );
    const raw = new DatabaseSync(config.STANDALONE_DB_PATH);
    raw
      .prepare(
        'UPDATE project_workspaces SET folders_json = ?, output_folders_json = ? WHERE project_id = ?',
      )
      .run(
        JSON.stringify(syntheticProfileFolders),
        JSON.stringify(syntheticProfileOutputs),
        projectId,
      );
    raw.close();

    const legacyBefore = store.getWorkspace(projectId);
    expect(legacyBefore.folderSnapshot.sourceProfile).toBeNull();

    const renamedFolders: FolderNodePreset[] = [
      { name: '00_RECEIVED', children: [] },
      { name: '01_WORKING', children: [] },
      { name: '02_CALCULATIONS', children: [] },
      { name: '03_DRAWINGS', children: [] },
      {
        name: '04_TECHNICAL',
        children: [
          { name: 'DATASHEETS', children: [] },
          { name: 'TECHNICAL_BOQ', children: [] },
        ],
      },
      { name: '05_DELIVERABLES', children: [] },
    ];
    const renamedOutputs: ProjectOutputFolders = {
      ...syntheticProfileOutputs,
      boqExcel: '04_TECHNICAL/TECHNICAL_BOQ',
      boqPdf: '04_TECHNICAL/TECHNICAL_BOQ',
    };
    store.updateFolderConfiguration(
      projectId,
      'Full Lighting Design',
      renamedFolders,
      renamedOutputs,
    );
    const legacyAfter = store.getWorkspace(projectId);
    expect(
      legacyAfter.folderSnapshot.folders.some((folder) => folder.name === 'TECHNICAL_BOQ'),
    ).toBe(true);
  });

  it('projects canonical output mappings into legacy-compatible derived paths', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-projection-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const projectId = randomUUID();
    store.initializeProject(
      projectId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      'Full Lighting Design',
      'Later',
      '2026-08-20',
      syntheticProfileFolders,
      syntheticProfileOutputs,
    );
    const workspace = store.getWorkspace(projectId);
    expect(workspace.outputFolders.boqExcel).toBe('04_TECHNICAL/BOQ');
    expect(workspace.outputFolders.boqPdf).toBe('04_TECHNICAL/BOQ');
    expect(workspace.outputFolders.datasheets).toBe('04_TECHNICAL/DATASHEETS');
    expect(workspace.outputFolders.scheduleExcel).toBe('04_TECHNICAL');
  });

  it('keeps unresolved canonical mappings out of the compatibility projection as empty, not a wrong path', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-unresolved-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const projectId = randomUUID();
    store.initializeProject(
      projectId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      'Full Lighting Design',
      'Later',
      '2026-08-20',
      syntheticProfileFolders,
      syntheticProfileOutputs,
    );
    const raw = new DatabaseSync(config.STANDALONE_DB_PATH);
    const row = raw
      .prepare(
        'SELECT folders_json, output_folders_json FROM project_workspaces WHERE project_id = ?',
      )
      .get(projectId) as { folders_json: string; output_folders_json: string };
    const mappings = JSON.parse(row.output_folders_json) as {
      schemaVersion: string;
      mappings: Array<{
        outputTypeId: string;
        destinationFolderId: string | null;
        unresolved: boolean;
        legacyPath: string | null;
      }>;
    };
    mappings.mappings = mappings.mappings.map((mapping) =>
      mapping.outputTypeId === 'boqExcel'
        ? { ...mapping, destinationFolderId: 'missing-folder', unresolved: false }
        : mapping,
    );
    raw
      .prepare('UPDATE project_workspaces SET output_folders_json = ? WHERE project_id = ?')
      .run(JSON.stringify(mappings), projectId);
    raw.close();

    const workspace = store.getWorkspace(projectId);
    const boq = workspace.outputMappings.find((mapping) => mapping.outputTypeId === 'boqExcel');
    expect(boq?.unresolved).toBe(true);
    expect(boq?.destinationFolderId).toBeNull();
    expect(workspace.outputFolders.boqExcel).toBe('');
  });

  it('rejects path-structural folder names in new canonical structures', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-path-safety-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const store = new PersonalWorkspaceStore(config);
    closeables.push(store);

    const projectId = randomUUID();
    store.initializeProject(
      projectId,
      ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
      'Full Lighting Design',
      'Later',
      '2026-08-20',
      syntheticProfileFolders,
      syntheticProfileOutputs,
    );
    const unsafeFolders: FolderNodePreset[] = [
      { name: '00_RECEIVED', children: [] },
      { name: 'A/B', children: [] },
    ];
    expect(() =>
      store.updateFolderConfiguration(
        projectId,
        'Full Lighting Design',
        unsafeFolders,
        syntheticProfileOutputs,
      ),
    ).toThrow(DomainError);
    expect(() =>
      store.initializeProject(
        randomUUID(),
        ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
        'Full Lighting Design',
        'Later',
        '2026-08-20',
        [{ name: '..', children: [] }],
        syntheticProfileOutputs,
      ),
    ).toThrow(DomainError);
  });
});

describe('P2.4B1 creation integration', () => {
  it('returns the canonical snapshot and stable mappings through the API and on reopen', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-api-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        projectName: 'Dubai Hills Villa',
        clientName: 'Private Client',
        projectType: 'Villa Lighting Design',
        description: 'P2.4B1 creation integration.',
        siteLocation: 'Dubai Hills',
        designStage: 'Concept',
        lightingScope: 'Complete villa lighting design and documentation.',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 24,
        requiredDeliveryDate: '2026-08-20',
        createFolders: false,
        folderProfile: 'Full Lighting Design',
        folderStructure: syntheticProfileFolders,
        outputFolders: syntheticProfileOutputs,
        services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
        luminaireInputMode: 'Later',
        crmReference: 'CRM-48572',
        idempotencyKey: randomUUID(),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{
      data: {
        project: { id: string; projectCode: string; crmReference: string | null };
        workspace: {
          folderSnapshot: { schemaVersion: string; folders: Array<{ folderId: string }> };
          outputMappings: Array<{ outputTypeId: string; unresolved: boolean }>;
        };
      };
    }>().data;
    const projectId = created.project.id;
    expect(created.project.crmReference).toBe('CRM-48572');
    expect(created.workspace.folderSnapshot.schemaVersion).toBe('1.0');
    expect(created.workspace.outputMappings.length).toBe(5);
    expect(created.workspace.outputMappings.every((mapping) => !mapping.unresolved)).toBe(true);

    const reopenResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    expect(reopenResponse.statusCode).toBe(200);
    const reopened = reopenResponse.json<{
      data: {
        folderSnapshot: { folders: Array<{ folderId: string }> };
        outputMappings: Array<{ outputTypeId: string; unresolved: boolean }>;
      };
    }>().data;
    expect(reopened.folderSnapshot.folders.map((folder) => folder.folderId)).toEqual(
      created.workspace.folderSnapshot.folders.map((folder) => folder.folderId),
    );
    expect(reopened.outputMappings).toEqual(created.workspace.outputMappings);
  });

  it('rejects a workspace-setup rename through the API without changing folder identity', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'p24b1-api-guard-'));
    temporaryDirectories.push(directory);
    const config = makeConfig(
      path.join(directory, 'reality.sqlite'),
      path.join(directory, 'projects'),
    );
    const provider = new StandaloneDataProvider(config);
    const store = new PersonalWorkspaceStore(config);
    closeables.push(provider, store);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    closeables.push(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        projectName: 'Dubai Hills Villa',
        clientName: 'Private Client',
        projectType: 'Villa Lighting Design',
        description: 'P2.4B1 API guard.',
        siteLocation: 'Dubai Hills',
        designStage: 'Concept',
        lightingScope: 'Complete villa lighting design and documentation.',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 24,
        requiredDeliveryDate: '2026-08-20',
        createFolders: false,
        folderProfile: 'Full Lighting Design',
        folderStructure: syntheticProfileFolders,
        outputFolders: syntheticProfileOutputs,
        services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
        luminaireInputMode: 'Later',
        crmReference: 'CRM-48572',
        idempotencyKey: randomUUID(),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{
      data: {
        project: { id: string };
        workspace: {
          folderSnapshot: { folders: Array<{ folderId: string }> };
          outputMappings: Array<{ outputTypeId: string; destinationFolderId: string | null }>;
        };
      };
    }>().data;
    const projectId = created.project.id;
    const originalIds = created.workspace.folderSnapshot.folders.map((folder) => folder.folderId);
    const originalMappings = created.workspace.outputMappings;

    const renamedFolders: FolderNodePreset[] = [
      { name: '00_RECEIVED', children: [] },
      { name: '01_WORKING', children: [] },
      { name: '02_CALCULATIONS', children: [] },
      { name: '03_DRAWINGS', children: [] },
      {
        name: '04_TECHNICAL',
        children: [
          { name: 'DATASHEETS', children: [] },
          { name: 'TECHNICAL_BOQ', children: [] },
        ],
      },
      { name: '05_DELIVERABLES', children: [] },
    ];
    const renamedOutputs: ProjectOutputFolders = {
      ...syntheticProfileOutputs,
      boqExcel: '04_TECHNICAL/TECHNICAL_BOQ',
      boqPdf: '04_TECHNICAL/TECHNICAL_BOQ',
    };
    const renameResponse = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/workspace-setup`,
      payload: {
        services: ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'],
        folderProfile: 'Full Lighting Design',
        folderStructure: renamedFolders,
        outputFolders: renamedOutputs,
      },
    });
    expect(renameResponse.statusCode).toBe(400);

    const reopenResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/workspace`,
    });
    expect(reopenResponse.statusCode).toBe(200);
    const reopened = reopenResponse.json<{
      data: {
        folderSnapshot: { folders: Array<{ folderId: string }> };
        outputMappings: Array<{ outputTypeId: string; destinationFolderId: string | null }>;
      };
    }>().data;
    expect(reopened.folderSnapshot.folders.map((folder) => folder.folderId)).toEqual(originalIds);
    expect(reopened.outputMappings).toEqual(originalMappings);
  });
});
