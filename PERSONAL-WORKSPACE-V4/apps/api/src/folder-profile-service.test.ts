import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '@scli/config';
import {
  DomainError,
  type FolderProfile,
  type ProfileFolderNode,
  type ProfileFolderNodeDraft,
} from '@scli/domain';
import type { CreateFolderProfileInput } from '@scli/contracts';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';
import { FolderProfileService } from './folder-profile-service';

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
    STANDALONE_SESSION_SECRET: 'p24b3a-service-secret-that-is-longer-than-thirty-two-characters',
    STANDALONE_ADMIN_NAME: 'Reality Admin',
    STANDALONE_ADMIN_EMAIL: 'reality@local.test',
    STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
    PERSONAL_PROJECT_ROOT: projectRoot,
    PERSONAL_DEFAULT_FOLDER_PROFILE: 'Full Lighting Design',
  });
}

function createInput(): CreateFolderProfileInput {
  return {
    name: 'Full Lighting + Authority',
    description: 'Reality profile',
    folders: [
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
    ],
    outputDefaults: [
      { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
      { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
      { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
    ],
  };
}

function profileToDrafts(profile: FolderProfile): ProfileFolderNodeDraft[] {
  const byParent = new Map<string | null, ProfileFolderNode[]>();
  for (const node of profile.folders) {
    const siblings = byParent.get(node.parentProfileFolderId) ?? [];
    siblings.push(node);
    byParent.set(node.parentProfileFolderId, siblings);
  }
  const build = (parent: string | null): ProfileFolderNodeDraft[] =>
    (byParent.get(parent) ?? [])
      .sort((left, right) => left.displayOrder - right.displayOrder)
      .map((node) => ({
        profileFolderId: node.profileFolderId,
        name: node.name,
        semanticRole: node.semanticRole,
        children: build(node.profileFolderId),
      }));
  return build(null);
}

function setup(): {
  directory: string;
  store: PersonalWorkspaceStore;
  service: FolderProfileService;
} {
  const directory = mkdtempSync(path.join(tmpdir(), 'p24b3a-service-'));
  temporaryDirectories.push(directory);
  const config = makeConfig(
    path.join(directory, 'reality.sqlite'),
    path.join(directory, 'projects'),
  );
  mkdirSync(config.PERSONAL_PROJECT_ROOT, { recursive: true });
  const provider = new StandaloneDataProvider(config);
  const store = new PersonalWorkspaceStore(config);
  closeables.push(provider, store);
  return { directory, store, service: new FolderProfileService(store) };
}

describe('P2.4B3A FolderProfileService CRUD and persistence', () => {
  it('creates and persists a profile across a store reopen', () => {
    const { directory, service } = setup();
    const created = service.createProfile(createInput());
    expect(created.profileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.folders).toHaveLength(8);
    expect(created.outputDefaults).toHaveLength(3);

    const reopened = new PersonalWorkspaceStore(
      loadConfig({
        APP_MODE: 'standalone',
        WORKSPACE_VARIANT: 'personal',
        PERSONAL_AUTO_LOGIN: 'true',
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        STANDALONE_DB_PATH: path.join(directory, 'reality.sqlite'),
        STANDALONE_SESSION_SECRET:
          'p24b3a-service-secret-that-is-longer-than-thirty-two-characters',
        STANDALONE_ADMIN_NAME: 'Reality Admin',
        STANDALONE_ADMIN_EMAIL: 'reality@local.test',
        STANDALONE_ADMIN_PASSWORD: 'Reality-Check-Password-2026!',
        PERSONAL_PROJECT_ROOT: path.join(directory, 'projects'),
        PERSONAL_DEFAULT_FOLDER_PROFILE: 'Full Lighting Design',
      }),
    );
    closeables.push(reopened);
    const reopenedService = new FolderProfileService(reopened);
    const loaded = reopenedService.getProfile(created.profileId);
    expect(loaded.name).toBe(created.name);
    expect(loaded.folders.map((folder) => folder.profileFolderId)).toEqual(
      created.folders.map((folder) => folder.profileFolderId),
    );
    expect(loaded.structuralFingerprint).toBe(created.structuralFingerprint);
  });

  it('updates and persists a profile while preserving profileId and node IDs', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    const drafts = profileToDrafts(created);
    drafts.find((draft) => draft.name === '03_DRAWINGS')!.name = '03_LIGHTING_DRAWINGS';
    drafts.push({ name: 'MOCKUP', children: [] });
    const updated = service.updateProfile(created.profileId, {
      name: created.name,
      description: created.description,
      folders: drafts,
      outputDefaults: [
        { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
        { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
        { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
      ],
    });
    expect(updated.profileId).toBe(created.profileId);
    expect(updated.folders).toHaveLength(created.folders.length + 1);
    const originalIds = new Set(created.folders.map((folder) => folder.profileFolderId));
    const preserved = updated.folders.filter((folder) => originalIds.has(folder.profileFolderId));
    expect(preserved).toHaveLength(created.folders.length);
    expect(updated.folders.some((folder) => folder.name === 'MOCKUP')).toBe(true);
    expect(service.getProfile(created.profileId).structuralFingerprint).toBe(
      updated.structuralFingerprint,
    );
  });

  it('duplicates a profile independently and persists it', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    const duplicate = service.duplicateProfile(created.profileId);
    expect(duplicate.profileId).not.toBe(created.profileId);
    expect(duplicate.name).toBe('Full Lighting + Authority Copy');
    const originalIds = new Set(created.folders.map((folder) => folder.profileFolderId));
    expect(duplicate.folders.every((folder) => !originalIds.has(folder.profileFolderId))).toBe(
      true,
    );
    expect(service.listProfiles()).toHaveLength(2);
    const reloaded = service.getProfile(duplicate.profileId);
    expect(reloaded.folders.map((folder) => folder.profileFolderId)).toEqual(
      duplicate.folders.map((folder) => folder.profileFolderId),
    );
  });

  it('deletes a profile only and clears the default when the default is deleted', () => {
    const { service } = setup();
    const first = service.createProfile(createInput());
    const second = service.createProfile({ ...createInput(), name: 'Second Profile' });
    service.setDefaultProfile(first.profileId);
    service.deleteProfile(first.profileId);
    expect(service.listProfiles().map((profile) => profile.profileId)).toEqual([second.profileId]);
    expect(service.getDefaultProfile()).toBeNull();
  });

  it('set default permits exactly one catalog default and clear default works', () => {
    const { service } = setup();
    const first = service.createProfile(createInput());
    const second = service.createProfile({ ...createInput(), name: 'Second Profile' });
    service.setDefaultProfile(first.profileId);
    service.setDefaultProfile(second.profileId);
    expect(service.getDefaultProfile()?.profileId).toBe(second.profileId);
    service.clearDefaultProfile();
    expect(service.getDefaultProfile()).toBeNull();
  });

  it('listing and getting profiles performs no project mutation', () => {
    const { directory, service } = setup();
    const created = service.createProfile(createInput());
    service.listProfiles();
    service.getProfile(created.profileId);
    service.setDefaultProfile(created.profileId);
    service.clearDefaultProfile();
    expect(readdirSync(path.join(directory, 'projects'))).toHaveLength(0);
  });

  it('rejects a duplicate normalized user profile name', () => {
    const { service } = setup();
    service.createProfile(createInput());
    expect(() =>
      service.createProfile({ ...createInput(), name: 'full lighting + authority' }),
    ).toThrow(DomainError);
  });

  it('rejects an update that removes a folder targeted by an output default', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    const drafts = profileToDrafts(created).filter((draft) => draft.name !== '04_TECHNICAL');
    expect(() =>
      service.updateProfile(created.profileId, {
        name: created.name,
        description: created.description,
        folders: drafts,
        outputDefaults: [
          { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
          { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
          { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
        ],
      }),
    ).toThrow(DomainError);
  });
});

describe('P2.4B3A existing project independence', () => {
  it('profile folder rename after instantiation does not alter Project A', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    const projectA = service.instantiateProfile(created.profileId);
    const drafts = profileToDrafts(created);
    drafts.find((draft) => draft.name === '03_DRAWINGS')!.name = '03_LIGHTING_DRAWINGS';
    service.updateProfile(created.profileId, {
      name: created.name,
      description: created.description,
      folders: drafts,
      outputDefaults: [
        { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
        { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
        { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
      ],
    });
    const reopened = service.instantiateProfile(created.profileId);
    expect(reopened.snapshot.folders.map((folder) => folder.folderId)).not.toEqual(
      projectA.snapshot.folders.map((folder) => folder.folderId),
    );
    expect(projectA.snapshot.folders.find((folder) => folder.name === '03_DRAWINGS')).toBeDefined();
    expect(projectA.snapshot.folders.some((folder) => folder.name === '03_LIGHTING_DRAWINGS')).toBe(
      false,
    );
  });

  it('profile add after instantiation does not alter Project A', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    const projectA = service.instantiateProfile(created.profileId);
    const drafts = profileToDrafts(created);
    drafts.push({ name: 'MOCKUP', children: [] });
    service.updateProfile(created.profileId, {
      name: created.name,
      description: created.description,
      folders: drafts,
      outputDefaults: [
        { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
        { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
        { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
      ],
    });
    expect(projectA.snapshot.folders.some((folder) => folder.name === 'MOCKUP')).toBe(false);
    expect(projectA.snapshot.folders).toHaveLength(8);
  });

  it('profile removal after instantiation does not alter Project A', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    const projectA = service.instantiateProfile(created.profileId);
    const drafts = profileToDrafts(created).filter((draft) => draft.name !== '03_DRAWINGS');
    service.updateProfile(created.profileId, {
      name: created.name,
      description: created.description,
      folders: drafts,
      outputDefaults: [
        { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
        { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
        { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
      ],
    });
    expect(projectA.snapshot.folders.some((folder) => folder.name === '03_DRAWINGS')).toBe(true);
    expect(projectA.snapshot.folders).toHaveLength(8);
  });

  it('profile output change after instantiation does not alter Project A', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    const projectA = service.instantiateProfile(created.profileId);
    const originalMappings = structuredClone(projectA.outputMappings);
    service.updateProfile(created.profileId, {
      name: created.name,
      description: created.description,
      folders: profileToDrafts(created),
      outputDefaults: [
        { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
        { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
        { outputTypeId: 'Reports', destinationPath: '04_TECHNICAL' },
      ],
    });
    expect(projectA.outputMappings).toEqual(originalMappings);
    const reports = projectA.outputMappings.mappings.find(
      (mapping) => mapping.outputTypeId === 'Reports',
    )!;
    expect(reports.destinationFolderId).not.toBeNull();
  });

  it('profile display-name change after instantiation does not alter Project A structure', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    const projectA = service.instantiateProfile(created.profileId);
    const originalFolders = structuredClone(projectA.snapshot.folders);
    service.updateProfile(created.profileId, {
      name: 'Renamed Profile',
      description: created.description,
      folders: profileToDrafts(created),
      outputDefaults: [
        { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
        { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
        { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
      ],
    });
    expect(projectA.snapshot.sourceProfile?.profileName).toBe('Full Lighting + Authority');
    expect(projectA.snapshot.folders).toEqual(originalFolders);
  });

  it('profile deletion after instantiation does not alter Project A', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    const projectA = service.instantiateProfile(created.profileId);
    service.deleteProfile(created.profileId);
    expect(service.listProfiles()).toHaveLength(0);
    expect(projectA.snapshot.folders).toHaveLength(8);
    expect(projectA.snapshot.sourceProfile?.profileId).toBe(created.profileId);
  });
});

describe('P2.4B3A failed mutation recovery', () => {
  it('a failed create does not poison later catalog mutations', () => {
    const { service } = setup();
    const first = service.createProfile(createInput());
    expect(() =>
      service.createProfile({ ...createInput(), name: 'full lighting + authority' }),
    ).toThrow(DomainError);
    expect(service.listProfiles()).toHaveLength(1);

    const second = service.createProfile({ ...createInput(), name: 'Second Profile' });
    expect(service.listProfiles()).toHaveLength(2);

    const updated = service.updateProfile(first.profileId, {
      name: 'Renamed First',
      description: first.description,
      folders: profileToDrafts(first),
      outputDefaults: [
        { outputTypeId: 'TechnicalBoq', destinationPath: '04_TECHNICAL/BOQ' },
        { outputTypeId: 'Datasheets', destinationPath: '04_TECHNICAL/DATASHEETS' },
        { outputTypeId: 'Reports', destinationPath: '05_DELIVERABLES' },
      ],
    });
    expect(updated.name).toBe('Renamed First');
    expect(service.getProfile(second.profileId).name).toBe('Second Profile');
    expect(service.getDefaultProfile()).toBeNull();
  });

  it('a failed update leaves the catalog unchanged and readable', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    expect(() =>
      service.updateProfile(created.profileId, {
        name: created.name,
        description: created.description,
        folders: profileToDrafts(created),
        outputDefaults: [{ outputTypeId: 'TechnicalBoq', destinationPath: 'MISSING' }],
      }),
    ).toThrow(DomainError);
    const reloaded = service.getProfile(created.profileId);
    expect(reloaded.folders).toHaveLength(created.folders.length);
    expect(reloaded.outputDefaults).toEqual(created.outputDefaults);
    expect(service.listProfiles()).toHaveLength(1);
  });
});

describe('P2.4B3B1A unified default authority and legacy import', () => {
  it('rejects an unknown factory key and a missing user profile', () => {
    const { service } = setup();
    expect(() => service.setDefaultFactoryProfile('renamed-later')).toThrow(DomainError);
    expect(() => service.setDefaultProfileRef({ kind: 'user', profileId: 'missing-uuid' })).toThrow(
      DomainError,
    );
    expect(service.getDefaultProfileRef()).toEqual({ kind: 'blank' });
  });

  it('never exposes factory profiles through canonical catalog CRUD', () => {
    const { service } = setup();
    expect(service.listProfiles()).toEqual([]);
    expect(() => service.deleteProfile('full-lighting-design')).toThrow(DomainError);
    expect(service.getDefaultProfileRef()).toEqual({ kind: 'blank' });
  });

  it('imports a historical row with fresh canonical identity and preserves the row', () => {
    const { store, service } = setup();
    const database = (
      store as unknown as {
        database: {
          prepare(sql: string): {
            run(...params: unknown[]): unknown;
            get(...params: unknown[]): Record<string, unknown> | undefined;
          };
        };
      }
    ).database;
    database
      .prepare(
        `INSERT INTO custom_folder_profiles
         (name, description, folders_json, output_folders_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'Old Facade Profile',
        'Historical.',
        JSON.stringify([{ name: '01_RECEIVED', children: [] }]),
        JSON.stringify({ scheduleExcel: '01_RECEIVED', datasheets: '01_RECEIVED' }),
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      );

    const imported = service.importLegacyProfile('Old Facade Profile');
    expect(imported.profileId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      imported.outputDefaults.map((outputDefault) => outputDefault.outputTypeId).sort(),
    ).toEqual(['datasheets', 'scheduleExcel']);

    const row = database
      .prepare('SELECT description, output_folders_json FROM custom_folder_profiles WHERE name = ?')
      .get('Old Facade Profile');
    expect(String(row?.description)).toBe('Historical.');
    expect(JSON.parse(String(row?.output_folders_json))).toEqual({
      scheduleExcel: '01_RECEIVED',
      datasheets: '01_RECEIVED',
    });

    expect(() => service.importLegacyProfile('Old Facade Profile')).toThrow(DomainError);
    expect(() => service.importLegacyProfile('Never Existed')).toThrow(DomainError);
  });

  it('resolves the legacy default only while no canonical default exists', () => {
    const { service } = setup();
    expect(service.resolveDefaultCompatibility()).toMatchObject({
      legacyMatch: 'factory',
      effectiveRef: { kind: 'factory', factoryProfileKey: 'full-lighting-design' },
    });
    service.setDefaultBlank();
    expect(service.resolveDefaultCompatibility()).toMatchObject({
      legacyMatch: 'canonical',
      effectiveRef: { kind: 'blank' },
    });
  });

  it('deleting the default user profile clears the canonical default coherently', () => {
    const { service } = setup();
    const created = service.createProfile(createInput());
    service.setDefaultProfile(created.profileId);
    service.deleteProfile(created.profileId);
    expect(service.getDefaultProfileRef()).toEqual({ kind: 'blank' });
    expect(service.getDefaultProfile()).toBeNull();
  });
});
