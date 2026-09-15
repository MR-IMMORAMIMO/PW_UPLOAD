import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '@scli/config';
import { seedProjects, seedUsers } from '@scli/test-data';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';

describe('verified Project root route guard', () => {
  let root: string;
  let app: FastifyInstance;
  let store: PersonalWorkspaceStore;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'scli-storage-guard-'));
    const config = loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      STANDALONE_DB_PATH: path.join(root, 'workspace.sqlite'),
      PERSONAL_PROJECT_ROOT: path.join(root, 'projects'),
    });
    store = new PersonalWorkspaceStore(config);
    const project = seedProjects[0]!;
    store.initializeProject(
      project.id,
      ['LuminaireSchedule', 'TechnicalBoq'],
      'Full Lighting Design',
      'Manual',
      project.requiredDeliveryDate,
    );
    app = await createApp({ config, provider: new MockDataProvider(), personalStore: store });
  });

  afterEach(async () => {
    await app.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  function totalChanges(): number {
    const row = store.getSharedDatabase().prepare('SELECT total_changes() AS count').get() as {
      count: number;
    };
    return Number(row.count);
  }

  async function expectGuarded(request: {
    method: 'POST' | 'DELETE';
    url: string;
    headers: Record<string, string>;
    payload?: string | Record<string, unknown>;
  }) {
    const before = totalChanges();
    const response = await app.inject(request);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/connected, verified Project folder/i);
    expect(totalChanges()).toBe(before);
  }

  it('blocks representative file-backed mutations before any DB mutation', async () => {
    const projectId = seedProjects[0]!.id;
    const actorId = seedUsers.find((candidate) => candidate.role === 'Admin')!.id;
    const headers = { 'x-mock-user-id': actorId };
    const revisionId = '10000000-0000-4000-8000-000000000001';

    await expectGuarded({
      method: 'POST',
      url: `/api/projects/${projectId}/revisions/${revisionId}/deliverables`,
      headers,
      payload: { sourceDocumentId: '20000000-0000-4000-8000-000000000001' },
    });
    await expectGuarded({
      method: 'POST',
      url: `/api/projects/${projectId}/revisions/${revisionId}/datasheet-deliverables`,
      headers,
      payload: { assetVersionId: '30000000-0000-4000-8000-000000000001' },
    });
    await expectGuarded({
      method: 'DELETE',
      url: `/api/projects/${projectId}/revisions/${revisionId}/deliverables/40000000-0000-4000-8000-000000000001`,
      headers,
    });
    await expectGuarded({
      method: 'POST',
      url: `/api/projects/${projectId}/luminaire-schedule/generate`,
      headers,
      payload: { format: 'PDF', issueStatus: 'For Review', issueDate: '2026-08-23' },
    });
    await expectGuarded({
      method: 'POST',
      url: `/api/projects/${projectId}/revision-packages`,
      headers,
      payload: {
        revisionNumber: 1,
        reissueNumber: 0,
        label: 'Guarded package',
        status: 'Draft',
        outputMode: 'Folder',
        relativeOutputFolder: 'ISSUED/REV_01',
        selectedItemIds: ['output-1'],
      },
    });
    await expectGuarded({
      method: 'DELETE',
      url: `/api/projects/${projectId}/revisions/${revisionId}`,
      headers,
    });
  });

  it('keeps database-backed Project reads available while storage is disconnected', async () => {
    const projectId = seedProjects[0]!.id;
    const actorId = seedUsers.find((candidate) => candidate.role === 'Admin')!.id;
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}`,
      headers: { 'x-mock-user-id': actorId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.id).toBe(projectId);
  });
});
