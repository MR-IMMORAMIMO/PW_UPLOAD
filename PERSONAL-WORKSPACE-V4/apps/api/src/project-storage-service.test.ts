import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { projectStorageMarkerFileName, type Project } from '@scli/domain';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { nodeProjectStorageFileSystem, ProjectStorageService } from './project-storage-service';

describe('ProjectStorageService', () => {
  let root: string;
  let store: PersonalWorkspaceStore;
  let provider: MockDataProvider;
  let project: Project;
  let service: ProjectStorageService;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'scli-storage-health-'));
    const config = loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      STANDALONE_DB_PATH: path.join(root, 'app.sqlite'),
      PERSONAL_PROJECT_ROOT: root,
    });
    store = new PersonalWorkspaceStore(config);
    provider = new MockDataProvider();
    project = (await provider.listProjects())[0]!;
    store.initializeProject(
      project.id,
      ['LuminaireSchedule'],
      'Full Lighting Design',
      'Later',
      project.requiredDeliveryDate,
    );
    service = new ProjectStorageService(
      provider,
      store,
      undefined,
      () => new Date('2026-08-23T08:00:00.000Z'),
    );
  });

  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function bindPaths(folder: string) {
    project = await provider.updateProject(project.id, { projectFolderPath: folder });
    store.setFolderPath(project.id, folder);
  }

  function writeMarker(folder: string): void {
    writeFileSync(
      path.join(folder, projectStorageMarkerFileName),
      JSON.stringify({
        schemaVersion: 1,
        projectId: project.id,
        createdAt: '2026-08-23T08:00:00.000Z',
        projectCodeSnapshot: project.projectCode,
      }),
    );
  }

  it('reports an unbound Project as DISCONNECTED without touching the filesystem', async () => {
    expect(await service.getHealth(project)).toMatchObject({
      state: 'DISCONNECTED',
      reason: 'NOT_CONFIGURED',
      canonicalPath: null,
      canReconnect: true,
    });
  });

  it('reports CONNECTED only for agreeing paths and an exact UUID marker', async () => {
    const folder = path.join(root, 'connected');
    mkdirSync(folder);
    writeMarker(folder);
    await bindPaths(folder);
    expect(await service.getHealth(project)).toMatchObject({
      state: 'CONNECTED',
      reason: null,
      canonicalPath: folder,
      canOpenFolder: true,
    });
    expect(await service.resolveVerifiedProjectRoot(project)).toBe(folder);
  });

  it('keeps health read-only and classifies compatible historical roots as LEGACY_UNVERIFIED', async () => {
    const folder = path.join(root, 'legacy');
    mkdirSync(folder);
    writeFileSync(path.join(folder, 'PROJECT_INFO.txt'), `Project Code: ${project.projectCode}\n`);
    await bindPaths(folder);
    expect(await service.getHealth(project)).toMatchObject({
      state: 'LEGACY_UNVERIFIED',
      canAdoptLegacy: true,
      marker: null,
    });
    expect(existsSync(path.join(folder, projectStorageMarkerFileName))).toBe(false);
    await expect(service.resolveVerifiedProjectRoot(project)).rejects.toThrow(
      /verified Project folder/i,
    );
  });

  it('never treats another Project legacy folder as trusted storage', async () => {
    const shared = path.join(root, 'shared-legacy');
    mkdirSync(shared);
    writeFileSync(path.join(shared, 'PROJECT_INFO.txt'), `Project Code: ${project.projectCode}\n`);
    await bindPaths(shared);
    const otherProject = (await provider.listProjects())[1]!;
    await provider.updateProject(otherProject.id, { projectFolderPath: shared });
    expect(await service.getHealth(project)).toMatchObject({
      state: 'NEEDS_RECONNECTION',
      reason: 'OTHER_PROJECT_BINDING',
      canAdoptLegacy: false,
    });
  });

  it('distinguishes unavailable, path disagreement, malformed, and wrong-project markers', async () => {
    const missing = path.join(root, 'missing');
    await bindPaths(missing);
    expect(await service.getHealth(project)).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'NOT_FOUND',
    });

    const other = path.join(root, 'other');
    mkdirSync(other);
    store.setFolderPath(project.id, other);
    expect(await service.getHealth(project)).toMatchObject({
      state: 'NEEDS_RECONNECTION',
      reason: 'PATH_DISAGREEMENT',
    });

    await bindPaths(other);
    writeFileSync(path.join(other, projectStorageMarkerFileName), '{broken');
    expect(await service.getHealth(project)).toMatchObject({ reason: 'MALFORMED_MARKER' });
    rmSync(path.join(other, projectStorageMarkerFileName));
    writeFileSync(
      path.join(other, projectStorageMarkerFileName),
      JSON.stringify({
        schemaVersion: 1,
        projectId: randomUUID(),
        createdAt: '2026-08-23T08:00:00.000Z',
        projectCodeSnapshot: 'OTHER',
      }),
    );
    expect(await service.getHealth(project)).toMatchObject({ reason: 'WRONG_PROJECT_MARKER' });
  });

  it('creates a marker only during explicit initial binding and updates both path authorities', async () => {
    const folder = path.join(root, 'initial');
    mkdirSync(folder);
    const result = await service.reconnect(project, {
      candidatePath: folder,
      intent: 'INITIAL_BINDING',
      expectedVersion: project.version,
    });
    expect(result.markerCreated).toBe(true);
    expect(result.health.state).toBe('CONNECTED');
    expect(result.project.projectFolderPath).toBe(folder);
    expect(store.getWorkspace(project.id).folderPath).toBe(folder);
    expect(existsSync(path.join(folder, projectStorageMarkerFileName))).toBe(true);
  });

  it('reconnects a moved exact-marker root and survives service reconstruction', async () => {
    const moved = path.join(root, 'moved-marked-root');
    mkdirSync(moved);
    writeMarker(moved);
    const result = await service.reconnect(project, {
      candidatePath: moved,
      intent: 'MATCHING_MARKER',
      expectedVersion: project.version,
    });
    expect(result).toMatchObject({
      markerCreated: false,
      project: { projectFolderPath: moved },
      health: { state: 'CONNECTED', canonicalPath: moved },
    });
    expect(store.getWorkspace(project.id).folderPath).toBe(moved);

    const restarted = new ProjectStorageService(provider, store);
    expect(await restarted.getHealth(result.project)).toMatchObject({
      state: 'CONNECTED',
      canonicalPath: moved,
    });
  });

  it('rejects reparse candidates and exclusive marker collisions through the filesystem port', async () => {
    const candidate = path.join(root, 'unsafe-candidate');
    mkdirSync(candidate);
    const reparse = new ProjectStorageService(provider, store, {
      ...nodeProjectStorageFileSystem,
      lstat: () => ({ isDirectory: () => true, isSymbolicLink: () => true }),
    });
    await expect(
      reparse.reconnect(project, {
        candidatePath: candidate,
        intent: 'INITIAL_BINDING',
        expectedVersion: project.version,
      }),
    ).rejects.toThrow(/real Project directory/i);

    const collision = new ProjectStorageService(provider, store, {
      ...nodeProjectStorageFileSystem,
      writeExclusiveDurable: () => {
        throw Object.assign(new Error('collision'), { code: 'EEXIST' });
      },
    });
    await expect(
      collision.reconnect(project, {
        candidatePath: candidate,
        intent: 'INITIAL_BINDING',
        expectedVersion: project.version,
      }),
    ).rejects.toThrow(/marker already exists/i);
    expect((await provider.getProject(project.id))?.projectFolderPath).toBeUndefined();
    expect(store.getWorkspace(project.id).folderPath).toBeNull();
  });

  it('requires explicit legacy adoption and then returns verified server truth', async () => {
    const folder = path.join(root, 'legacy-adopt');
    mkdirSync(folder);
    writeFileSync(path.join(folder, 'PROJECT_INFO.txt'), `Project Code: ${project.projectCode}\n`);
    await bindPaths(folder);
    const result = await service.reconnect(project, {
      candidatePath: folder,
      intent: 'ADOPT_LEGACY',
      expectedVersion: project.version,
    });
    expect(result).toMatchObject({ markerCreated: true, health: { state: 'CONNECTED' } });
    expect(
      JSON.parse(readFileSync(path.join(folder, projectStorageMarkerFileName), 'utf8')),
    ).toMatchObject({
      schemaVersion: 1,
      projectId: project.id,
      projectCodeSnapshot: project.projectCode,
    });
  });

  it('derives permission and IO failures through the injectable filesystem port', async () => {
    const folder = path.join(root, 'unavailable');
    mkdirSync(folder);
    await bindPaths(folder);
    const permission = new ProjectStorageService(provider, store, {
      ...nodeProjectStorageFileSystem,
      lstat: () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    });
    expect(await permission.getHealth(project)).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'PERMISSION_DENIED',
    });
    const timeout = new ProjectStorageService(provider, store, {
      ...nodeProjectStorageFileSystem,
      lstat: () => {
        throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      },
    });
    expect(await timeout.getHealth(project)).toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'IO_UNAVAILABLE',
    });
  });

  it('compensates only the marker created by a failed reconnect persistence', async () => {
    const folder = path.join(root, 'compensation');
    mkdirSync(folder);
    const original = store.setFolderPath.bind(store);
    let fail = true;
    store.setFolderPath = ((projectId: string, folderPath: string) => {
      if (fail) {
        fail = false;
        throw new Error('simulated DB failure');
      }
      return original(projectId, folderPath);
    }) as typeof store.setFolderPath;
    await expect(
      service.reconnect(project, {
        candidatePath: folder,
        intent: 'INITIAL_BINDING',
        expectedVersion: project.version,
      }),
    ).rejects.toThrow(/simulated DB failure/);
    expect(existsSync(path.join(folder, projectStorageMarkerFileName))).toBe(false);
  });

  it('rejects wrong UUIDs, unrelated non-empty folders, and folders bound to another Project', async () => {
    const wrong = path.join(root, 'wrong');
    mkdirSync(wrong);
    writeFileSync(
      path.join(wrong, projectStorageMarkerFileName),
      JSON.stringify({
        schemaVersion: 1,
        projectId: randomUUID(),
        createdAt: '2026-08-23T08:00:00.000Z',
        projectCodeSnapshot: 'OTHER',
      }),
    );
    await expect(
      service.reconnect(project, {
        candidatePath: wrong,
        intent: 'MATCHING_MARKER',
        expectedVersion: project.version,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const nonEmpty = path.join(root, 'non-empty');
    mkdirSync(nonEmpty);
    writeFileSync(path.join(nonEmpty, 'unrelated.txt'), 'not project evidence');
    await expect(
      service.reconnect(project, {
        candidatePath: nonEmpty,
        intent: 'INITIAL_BINDING',
        expectedVersion: project.version,
      }),
    ).rejects.toThrow(/unrelated non-empty/i);

    const otherProject = (await provider.listProjects())[1]!;
    await provider.updateProject(otherProject.id, { projectFolderPath: nonEmpty });
    await expect(
      service.reconnect(project, {
        candidatePath: nonEmpty,
        intent: 'INITIAL_BINDING',
        expectedVersion: project.version,
      }),
    ).rejects.toThrow(/another Project/i);
  });
});
