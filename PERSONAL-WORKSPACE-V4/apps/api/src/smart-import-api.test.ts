import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { seedProjects, seedUserIds } from '@scli/test-data';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import {
  LEGACY_SELF_MANAGED,
  PRODUCTION_MIGRATIONS,
} from './infrastructure/migration/registry/production-migration-registry';

describe('Smart Import API', () => {
  let app: FastifyInstance;
  let store: PersonalWorkspaceStore;
  let database: DatabaseSync;
  let projectId: string;
  let runtimeRoot: string;

  beforeEach(async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'p5b-api-'));
    runtimeRoot = root;
    const databasePath = path.join(root, 'workspace.sqlite');
    database = new DatabaseSync(databasePath);
    for (const migration of PRODUCTION_MIGRATIONS) {
      database.exec(
        migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
          ? 'PRAGMA foreign_keys = OFF'
          : 'PRAGMA foreign_keys = ON',
      );
      database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON');
      migration.up({
        database,
        migrationId: migration.id,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        clock: { now: () => new Date('2026-08-27T00:00:00.000Z') },
      });
      database.exec(`PRAGMA user_version = ${migration.toVersion}; COMMIT`);
      database.exec('PRAGMA foreign_keys = ON');
    }
    const config = loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'false',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      COMPANY_TIMEZONE: 'Asia/Dubai',
      STANDALONE_DB_PATH: databasePath,
    });
    store = new PersonalWorkspaceStore(config, LEGACY_SELF_MANAGED, database);
    projectId = seedProjects[0]!.id;
    app = await createApp({
      config,
      provider: new MockDataProvider(),
      personalStore: store,
      clock: () => new Date('2026-08-27T00:00:00.000Z'),
      workspaceBackupService: {
        createBackup: async () => 'unused',
        createVerifiedBackup: async () => ({ backupId: 'security-test-backup' }),
        listBackups: async () => [],
        scheduleRestore: async () => 'unused',
      },
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    if (store) {
      store.close();
    }
    if (database) {
      database.close();
    }
    if (runtimeRoot) {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  const adminHeaders = { 'x-mock-user-id': seedUserIds.admin };

  it('creates an authorized session, inspects raw bytes, pages rows, reopens history, and fails closed without verified Apply authority', async () => {
    const before = (
      store
        .getSharedDatabase()
        .prepare('SELECT COUNT(*) AS count FROM project_luminaires WHERE project_id = ?')
        .get(projectId) as { count: number }
    ).count;
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/imports',
      headers: adminHeaders,
      payload: { destinationMode: 'PROJECT', projectId },
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const created = createdResponse.json().data;

    const lines = ['Tag,Manufacturer,Ordering Code,Connected Load [W]'];
    for (let index = 0; index < 105; index += 1) {
      lines.push(
        `DL${String(index + 1).padStart(3, '0')},Brand ${index},SKU-${index},${index + 1}`,
      );
    }
    const sourceResponse = await app.inject({
      method: 'POST',
      url: `/api/imports/${created.importSessionId}/source`,
      headers: {
        ...adminHeaders,
        'content-type': 'application/octet-stream',
        'x-import-file-name': encodeURIComponent('manufacturer.csv'),
      },
      payload: Buffer.from(lines.join('\n')),
    });
    expect(sourceResponse.statusCode).toBe(201);
    expect(sourceResponse.json().data).toMatchObject({
      detectedAdapterId: 'GENERIC_CSV',
      counts: { total: 105 },
    });

    const page = await app.inject({
      method: 'GET',
      url: `/api/imports/${created.importSessionId}/rows?page=1&limit=50&filter=ALL`,
      headers: adminHeaders,
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().data.items).toHaveLength(50);
    expect(page.json().data.totalCount).toBe(105);

    const history = await app.inject({ method: 'GET', url: '/api/imports', headers: adminHeaders });
    expect(history.json().data.items[0]).toMatchObject({
      importSessionId: created.importSessionId,
      sourceFileName: 'manufacturer.csv',
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/imports/${created.importSessionId}/apply`,
          headers: adminHeaders,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        store
          .getSharedDatabase()
          .prepare('SELECT COUNT(*) AS count FROM project_luminaires WHERE project_id = ?')
          .get(projectId) as { count: number }
      ).count,
    ).toBe(before);
  });

  it('enforces Project access and stale mapping revisions server-side', async () => {
    const protectedProject = seedProjects.find(
      (project) => project.salesOwnerId === seedUserIds.salesTwo,
    )!;
    const denied = await app.inject({
      method: 'POST',
      url: '/api/imports',
      headers: { 'x-mock-user-id': seedUserIds.salesOne },
      payload: { destinationMode: 'PROJECT', projectId: protectedProject.id },
    });
    expect(denied.statusCode).toBe(403);

    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/imports',
        headers: adminHeaders,
        payload: { destinationMode: 'MASTER_LIBRARY' },
      })
    ).json().data;
    const inspected = (
      await app.inject({
        method: 'POST',
        url: `/api/imports/${created.importSessionId}/source`,
        headers: {
          ...adminHeaders,
          'content-type': 'application/octet-stream',
          'x-import-file-name': 'source.csv',
        },
        payload: Buffer.from('Manufacturer,Product Family,Ordering Code\nERCO,Iku,ABC'),
      })
    ).json().data;
    const table = (
      await app.inject({
        method: 'GET',
        url: `/api/imports/${created.importSessionId}/tables`,
        headers: adminHeaders,
      })
    ).json().data[0];
    const first = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${created.importSessionId}/tables/${table.sourceTableId}`,
      headers: adminHeaders,
      payload: {
        selected: true,
        expectedRowVersion: table.rowVersion,
        expectedSessionRevision: inspected.sessionRevision,
      },
    });
    expect(first.statusCode).toBe(200);
    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${created.importSessionId}/tables/${table.sourceTableId}`,
      headers: adminHeaders,
      payload: {
        selected: false,
        expectedRowVersion: table.rowVersion,
        expectedSessionRevision: inspected.sessionRevision,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONFLICT');
  });

  it('rejects the complete forged Project Apply authority matrix without internal leakage', async () => {
    const responseBodies: string[] = [];
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/imports',
        headers: adminHeaders,
        payload: { destinationMode: 'PROJECT', projectId },
      })
    ).json().data;
    const inspected = (
      await app.inject({
        method: 'POST',
        url: `/api/imports/${created.importSessionId}/source`,
        headers: {
          ...adminHeaders,
          'content-type': 'application/octet-stream',
          'x-import-file-name': 'security.csv',
        },
        payload: Buffer.from('Tag,Location,Quantity\nSEC-NEW-001,Security Lab,1'),
      })
    ).json().data;
    const reconciledResponse = await app.inject({
      method: 'POST',
      url: `/api/imports/${created.importSessionId}/reconcile`,
      headers: adminHeaders,
      payload: {
        expectedSessionRevision: inspected.sessionRevision,
        expectedPreviewFingerprint: inspected.previewFingerprint,
      },
    });
    expect(reconciledResponse.statusCode).toBe(200);
    const reconciled = reconciledResponse.json().data;
    const row = (
      await app.inject({
        method: 'GET',
        url: `/api/imports/${created.importSessionId}/rows?page=0&limit=50&filter=ALL`,
        headers: adminHeaders,
      })
    ).json().data.items[0];

    const assertRejected = async (request: InjectOptions, statusCode: number, codes: string[]) => {
      const response = await app.inject(request);
      responseBodies.push(response.body);
      expect(response.statusCode).toBe(statusCode);
      expect(codes).toContain(response.json().error.code);
      return response;
    };
    const forgedSessionId = '90000000-0000-4000-8000-000000000090';
    const forgedRowId = '90000000-0000-4000-8000-000000000091';
    const forgedProjectId = '90000000-0000-4000-8000-000000000092';
    const forgedTargetId = '90000000-0000-4000-8000-000000000093';
    const forgedVersionId = '90000000-0000-4000-8000-000000000094';

    await assertRejected(
      { method: 'GET', url: `/api/imports/${forgedSessionId}`, headers: adminHeaders },
      404,
      ['NOT_FOUND'],
    );
    await assertRejected(
      {
        method: 'POST',
        url: '/api/imports',
        headers: adminHeaders,
        payload: { destinationMode: 'PROJECT', projectId: forgedProjectId },
      },
      404,
      ['NOT_FOUND'],
    );
    await assertRejected(
      {
        method: 'PATCH',
        url: `/api/imports/${created.importSessionId}/rows/${forgedRowId}/action`,
        headers: adminHeaders,
        payload: {
          expectedSessionRevision: reconciled.sessionRevision,
          expectedRowVersion: 1,
          action: { type: 'PROJECT_CREATE_ONLY' },
        },
      },
      404,
      ['NOT_FOUND'],
    );
    await assertRejected(
      {
        method: 'PATCH',
        url: `/api/imports/${created.importSessionId}/rows/${row.importRowId}/action`,
        headers: adminHeaders,
        payload: {
          expectedSessionRevision: reconciled.sessionRevision,
          expectedRowVersion: row.rowVersion,
          action: {
            type: 'PROJECT_UPDATE_EXISTING',
            projectLuminaireId: forgedTargetId,
            expectedProjectRowVersion: 999,
            expectedBindingRowVersion: 999,
          },
        },
      },
      400,
      ['VALIDATION_ERROR'],
    );
    await assertRejected(
      {
        method: 'PATCH',
        url: `/api/imports/${created.importSessionId}/rows/${row.importRowId}/action`,
        headers: adminHeaders,
        payload: {
          expectedSessionRevision: reconciled.sessionRevision,
          expectedRowVersion: row.rowVersion,
          action: { type: 'PROJECT_ADD_FROM_LIBRARY', versionId: forgedVersionId },
        },
      },
      409,
      ['IMPORT_ACTION_INVALID', 'IMPORT_LIBRARY_VERSION_UNAVAILABLE'],
    );
    await assertRejected(
      {
        method: 'PATCH',
        url: `/api/imports/${created.importSessionId}/rows/${row.importRowId}/action`,
        headers: adminHeaders,
        payload: {
          expectedSessionRevision: reconciled.sessionRevision,
          expectedRowVersion: row.rowVersion,
          action: { type: 'DELETE_PROJECT_ROW' },
        },
      },
      400,
      ['VALIDATION_ERROR'],
    );
    await assertRejected(
      {
        method: 'POST',
        url: `/api/imports/${created.importSessionId}/reconcile`,
        headers: adminHeaders,
        payload: {
          expectedSessionRevision: reconciled.sessionRevision,
          expectedPreviewFingerprint: '0'.repeat(64),
        },
      },
      409,
      ['IMPORT_PREVIEW_STALE'],
    );
    await assertRejected(
      {
        method: 'PATCH',
        url: `/api/imports/${created.importSessionId}/rows/${row.importRowId}/action`,
        headers: adminHeaders,
        payload: {
          expectedSessionRevision: reconciled.sessionRevision - 1,
          expectedRowVersion: row.rowVersion,
          action: { type: 'PROJECT_CREATE_ONLY' },
        },
      },
      409,
      ['IMPORT_PLAN_STALE'],
    );

    const plannedResponse = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${created.importSessionId}/rows/${row.importRowId}/action`,
      headers: adminHeaders,
      payload: {
        expectedSessionRevision: reconciled.sessionRevision,
        expectedRowVersion: row.rowVersion,
        action: { type: 'PROJECT_CREATE_ONLY' },
      },
    });
    expect(plannedResponse.statusCode).toBe(200);
    const planned = (
      await app.inject({
        method: 'GET',
        url: `/api/imports/${created.importSessionId}`,
        headers: adminHeaders,
      })
    ).json().data;
    await assertRejected(
      {
        method: 'PATCH',
        url: `/api/imports/${created.importSessionId}/rows/${row.importRowId}/action`,
        headers: adminHeaders,
        payload: {
          expectedSessionRevision: planned.sessionRevision,
          expectedRowVersion: row.rowVersion,
          action: { type: 'PROJECT_CREATE_ONLY' },
        },
      },
      409,
      ['IMPORT_PLAN_STALE'],
    );

    const applyAuthority = {
      expectedSessionRevision: planned.sessionRevision,
      previewFingerprint: planned.previewFingerprint,
      destinationFingerprint: planned.destinationFingerprint,
      applyPlanFingerprint: planned.applyPlanFingerprint,
      idempotencyKey: 'security-forged-apply',
      mode: 'ALL',
      confirmPartial: false,
    };
    await assertRejected(
      {
        method: 'POST',
        url: `/api/imports/${created.importSessionId}/apply`,
        headers: adminHeaders,
        payload: { ...applyAuthority, previewFingerprint: '1'.repeat(64) },
      },
      409,
      ['IMPORT_PREVIEW_STALE'],
    );
    await assertRejected(
      {
        method: 'POST',
        url: `/api/imports/${created.importSessionId}/apply`,
        headers: adminHeaders,
        payload: { ...applyAuthority, destinationFingerprint: '2'.repeat(64) },
      },
      409,
      ['IMPORT_DESTINATION_CHANGED'],
    );
    await assertRejected(
      {
        method: 'POST',
        url: `/api/imports/${created.importSessionId}/apply`,
        headers: adminHeaders,
        payload: { ...applyAuthority, applyPlanFingerprint: '3'.repeat(64) },
      },
      409,
      ['IMPORT_PLAN_STALE'],
    );
    await assertRejected(
      {
        method: 'POST',
        url: `/api/imports/${created.importSessionId}/apply`,
        headers: adminHeaders,
        payload: { ...applyAuthority, expectedSessionRevision: planned.sessionRevision - 1 },
      },
      409,
      ['IMPORT_PREVIEW_STALE'],
    );

    const secondSession = (
      await app.inject({
        method: 'POST',
        url: '/api/imports',
        headers: adminHeaders,
        payload: { destinationMode: 'PROJECT', projectId },
      })
    ).json().data;
    store
      .getSharedDatabase()
      .prepare(
        `INSERT INTO import_apply_attempts
         (apply_attempt_id, import_session_id, idempotency_key, expected_session_revision,
          preview_fingerprint, apply_plan_fingerprint, destination_fingerprint, state,
          total_count, counts_json, started_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', 0, '{}', ?, ?, ?)`,
      )
      .run(
        '90000000-0000-4000-8000-000000000095',
        created.importSessionId,
        'security-cross-session-key',
        planned.sessionRevision,
        planned.previewFingerprint,
        planned.applyPlanFingerprint,
        planned.destinationFingerprint,
        '2026-08-27T00:00:00.000Z',
        '2026-08-27T00:00:00.000Z',
        '2026-08-27T00:00:00.000Z',
      );
    await assertRejected(
      {
        method: 'POST',
        url: `/api/imports/${secondSession.importSessionId}/apply`,
        headers: adminHeaders,
        payload: {
          expectedSessionRevision: secondSession.sessionRevision,
          previewFingerprint: '4'.repeat(64),
          destinationFingerprint: '5'.repeat(64),
          applyPlanFingerprint: '6'.repeat(64),
          idempotencyKey: 'security-cross-session-key',
          mode: 'ALL',
          confirmPartial: false,
        },
      },
      409,
      ['CONFLICT'],
    );

    const tooManyRows = Array.from(
      { length: 501 },
      (_, index) => `90000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    await assertRejected(
      {
        method: 'PATCH',
        url: `/api/imports/${created.importSessionId}/rows/actions`,
        headers: adminHeaders,
        payload: {
          expectedSessionRevision: planned.sessionRevision,
          rowIds: tooManyRows,
          action: 'SKIP',
        },
      },
      400,
      ['VALIDATION_ERROR'],
    );
    for (const body of responseBodies) {
      expect(body).not.toContain(runtimeRoot);
      expect(body).not.toContain('.sqlite');
      expect(body).not.toContain('SELECT ');
    }
  });
});
