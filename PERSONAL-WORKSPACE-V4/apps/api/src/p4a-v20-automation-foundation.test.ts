import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { DomainError } from '@scli/domain';
import { loadConfig } from '@scli/config';
import { createApp } from './app';
import { PersonalWorkspaceStore } from './personal-workspace-store';
import { StandaloneDataProvider } from './standalone-data-provider';
import { ProjectService } from './project-service';
import { BackupManager } from './infrastructure/backup/BackupManager';
import { ManagedArtifactStore } from './infrastructure/managed-artifact/ManagedArtifactStore';
import { CaptureLedgerService } from './infrastructure/managed-artifact/CaptureLedgerService';
import { PathResolverService } from './infrastructure/path/PathResolverService';
import { SchemaMigrationRunner } from './infrastructure/migration/SchemaMigrationRunner';
import { LegacyDetector } from './infrastructure/migration/legacy/LegacyDetector';
import {
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
  PRODUCTION_V20_CAPTURE_LEDGER_COLUMN_NAMES,
  PRODUCTION_V20_INDEX_NAMES,
  PRODUCTION_V20_MIGRATION_ID,
  PRODUCTION_V20_TOOL_CONTEXT_COLUMN_NAMES,
  EXTERNALLY_MIGRATED,
} from './infrastructure/migration/registry/production-migration-registry';
import { validateProductionSchemaVersion } from './infrastructure/migration/registry/production-schema-validator';
import { VersionedMigrationFixtureBuilder } from './infrastructure/migration/testing/VersionedMigrationFixtureBuilder';
import type {
  MigrationBackupFactory,
  MigrationBackupPort,
  MigrationDefinition,
  MigrationJournalPort,
} from './infrastructure/migration/types';
import { AutomationContextService } from './infrastructure/automation/AutomationContextService';
import { CanonicalOutputRegistryStore } from './infrastructure/output-registry/CanonicalOutputRegistryStore';
import { MockDataProvider } from './mock-data-provider';
import { seedProjects, seedUserIds } from '@scli/test-data';

const AT = '2026-08-24T08:00:00.000Z';
const V20_MIGRATIONS = PRODUCTION_MIGRATIONS.slice(0, 20);

function removeTree(directory: string): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) removeTree(child);
    else unlinkSync(child);
  }
  rmdirSync(directory);
}

const roots: string[] = [];
afterEach(() => {
  while (roots.length) removeTree(roots.pop()!);
});

function fixture(): { root: string; databasePath: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-p4a-v20-'));
  roots.push(root);
  const databasePath = path.join(root, 'workspace.sqlite');
  VersionedMigrationFixtureBuilder.build({ outputPath: databasePath, version: 19 });
  return { root, databasePath };
}

class Journal implements MigrationJournalPort {
  public async createAttempt(): Promise<{ attemptId: string }> {
    return { attemptId: 'p4a-v20-attempt' };
  }
  public async transition(): Promise<void> {}
  public async markFailed(): Promise<void> {}
}

class VerifiedBackupFactory implements MigrationBackupFactory {
  public createCount = 0;
  public verifyCount = 0;
  public constructor(private readonly root: string) {}
  public create(input: Parameters<MigrationBackupFactory['create']>[0]) {
    const manager = new BackupManager({
      sourceDb: input.sourceDb,
      sourceDatabasePath: input.sourceDatabasePath,
      backupRoot: path.join(this.root, 'backups'),
      pathResolver: new PathResolverService(this.root),
      clock: { now: () => new Date(AT) },
      appVersion: 'p4a-v20',
      idGenerator: { generate: () => `p4a-v20-backup-${++this.createCount}` },
      verificationPolicy: { requiredTables: [] },
    });
    return {
      createVerifiedBackup: async (
        request: Parameters<MigrationBackupPort['createVerifiedBackup']>[0],
      ) => manager.createVerifiedBackup(request),
      verifyBackup: async (backupId: string) => {
        this.verifyCount += 1;
        return manager.verifyBackup(backupId);
      },
    };
  }
}

function runner(
  root: string,
  backupFactory: MigrationBackupFactory,
  migrations: readonly MigrationDefinition[] = V20_MIGRATIONS,
  targetVersion = 20,
): SchemaMigrationRunner {
  return new SchemaMigrationRunner({
    migrations,
    targetVersion,
    appVersion: 'p4a-v20',
    databaseFactory: {
      openReadWrite: (databasePath) => new DatabaseSync(databasePath),
      openReadOnly: (databasePath) => new DatabaseSync(databasePath, { readOnly: true }),
    },
    backupFactory,
    journal: new Journal(),
    clock: { now: () => new Date(AT) },
    pathResolver: new PathResolverService(root),
    busyTimeoutMs: 5000,
    legacyAdmission: new LegacyDetector(),
  });
}

describe('Phase 4A v20 automation foundation', () => {
  it('requires a verified v19 backup, migrates populated rows additively, and is restart-safe', async () => {
    const { root, databasePath } = fixture();
    const backup = new VerifiedBackupFactory(root);
    const result = await runner(root, backup).run(databasePath);
    expect(result).toMatchObject({ status: 'migrated', fromVersion: 19, toVersion: 20 });
    expect(result.appliedMigrationIds).toEqual([PRODUCTION_V20_MIGRATION_ID]);
    expect(backup.createCount).toBe(1);
    expect(backup.verifyCount).toBeGreaterThanOrEqual(1);

    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA foreign_keys = ON');
    try {
      validateProductionSchemaVersion(database, 20);
      const toolColumns = database.prepare('PRAGMA table_info(tool_contexts)').all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      const captureColumns = database.prepare('PRAGMA table_info(capture_ledger)').all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      for (const name of PRODUCTION_V20_TOOL_CONTEXT_COLUMN_NAMES) {
        expect(toolColumns.find((column) => column.name === name)).toMatchObject({
          notnull: 0,
          dflt_value: null,
        });
      }
      for (const name of PRODUCTION_V20_CAPTURE_LEDGER_COLUMN_NAMES) {
        expect(captureColumns.find((column) => column.name === name)).toMatchObject({
          notnull: 0,
          dflt_value: null,
        });
      }
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM canonical_revisions').get(),
      ).toMatchObject({ count: 3 });
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM tool_contexts
             WHERE target_revision_id IS NOT NULL OR source_document_id IS NOT NULL`,
          )
          .get(),
      ).toMatchObject({ count: 0 });
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM capture_ledger
             WHERE target_revision_id IS NOT NULL OR routing_decision IS NOT NULL`,
          )
          .get(),
      ).toMatchObject({ count: 0 });
      for (const name of PRODUCTION_V20_INDEX_NAMES) {
        expect(
          database
            .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
            .get(name),
        ).toBeDefined();
      }
    } finally {
      database.close();
    }

    const restartBackup = new VerifiedBackupFactory(root);
    expect(await runner(root, restartBackup).run(databasePath)).toMatchObject({
      status: 'up-to-date',
      appliedMigrationIds: [],
    });
    expect(restartBackup.createCount).toBe(0);
  });

  it('rolls the v20 DDL back atomically when the migration faults', async () => {
    const { root, databasePath } = fixture();
    const v20 = V20_MIGRATIONS.at(-1)!;
    const faulted = [
      ...V20_MIGRATIONS.slice(0, -1),
      {
        ...v20,
        up: (context: Parameters<MigrationDefinition['up']>[0]) => {
          v20.up(context);
          throw new Error('injected v20 fault');
        },
      },
    ];
    await expect(
      runner(root, new VerifiedBackupFactory(root), faulted).run(databasePath),
    ).rejects.toMatchObject({
      code: 'MIGRATION_EXECUTION_FAILED',
    });
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(
        (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      ).toBe(19);
      const columns = database.prepare('PRAGMA table_info(tool_contexts)').all() as Array<{
        name: string;
      }>;
      expect(columns.some((column) => column.name === 'target_revision_id')).toBe(false);
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get(),
      ).toMatchObject({ count: 19 });
    } finally {
      database.close();
    }
  });

  it('preserves immutable Revision and source identities and requires durable user confirmation', async () => {
    const { root, databasePath } = fixture();
    await runner(root, new VerifiedBackupFactory(root)).run(databasePath);
    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA foreign_keys = ON');
    const store = new ManagedArtifactStore(database);
    const contexts = new AutomationContextService(database, store, () => new Date(AT));
    const projectId = '10000000-0000-4000-8000-000000000001';
    const revisionId = '20000000-0000-4000-8000-000000000001';
    const sourceDocumentId = '30000000-0000-4000-8000-000000000099';
    try {
      database
        .prepare(
          `INSERT INTO project_documents
           (id, project_id, category, document_number, title, revision, status, file_path,
            issued_to, issue_date, notes, created_at, updated_at)
           VALUES (?, ?, 'Drawing', 'P4A-SOURCE', 'P4A source drawing', 'A', 'Current',
                   'Inputs\\source.dwg', '', NULL, '', ?, ?)`,
        )
        .run(sourceDocumentId, projectId, AT, AT);
      const context = contexts.open({
        projectId,
        application: 'DIALUX',
        expectedArtifactType: 'DIALUX_REPORT',
        targetRevisionId: revisionId,
        sourceDocumentId,
      });
      expect(context).toMatchObject({ targetRevisionId: revisionId, sourceDocumentId });

      const ledger = new CaptureLedgerService(store);
      const capture = ledger.createDetectedCapture({
        projectId,
        toolContextId: context.toolContextId,
        sourcePath: 'C:\\Session\\report.pdf',
        sourceChannel: 'DEDICATED_SESSION_INBOX',
        expectedArtifactType: 'DIALUX_REPORT',
        detectedAt: AT,
      });
      expect(capture.targetRevisionId).toBe(revisionId);
      expect(() =>
        database
          .prepare('UPDATE capture_ledger SET routing_decision = ? WHERE capture_id = ?')
          .run('INVALID_DECISION', capture.captureId),
      ).toThrow(/CHECK constraint/i);
      expect(() =>
        ledger.recordRoutingDecision(capture.captureId, {
          decision: 'USER_CONFIRMED',
          decidedAt: AT,
        }),
      ).toThrow(DomainError);
      const decided = ledger.recordRoutingDecision(capture.captureId, {
        decision: 'USER_CONFIRMED',
        reason: 'Owner confirmed the output type.',
        decidedAt: AT,
        decidedById: 'owner-local',
        decidedByName: 'Owner',
      });
      expect(decided).toMatchObject({
        routingDecision: 'USER_CONFIRMED',
        decidedById: 'owner-local',
        decidedByName: 'Owner',
      });
      expect(() =>
        ledger.recordRoutingDecision(capture.captureId, {
          decision: 'REJECTED',
          decidedAt: AT,
        }),
      ).toThrowError(/immutable/);
      const systemCapture = ledger.createDetectedCapture({
        projectId,
        toolContextId: context.toolContextId,
        sourcePath: 'C:\\Session\\automatic-report.pdf',
        sourceChannel: 'DEDICATED_SESSION_INBOX',
        expectedArtifactType: 'DIALUX_REPORT',
        detectedAt: AT,
      });
      expect(
        ledger.recordRoutingDecision(systemCapture.captureId, {
          decision: 'AUTO_APPROVED',
          decidedAt: AT,
        }),
      ).toMatchObject({
        routingDecision: 'AUTO_APPROVED',
        decidedById: null,
        decidedByName: null,
      });
      database.prepare('DELETE FROM project_documents WHERE id = ?').run(sourceDocumentId);
      expect(contexts.get(context.toolContextId).sourceDocumentId).toBe(sourceDocumentId);
    } finally {
      database.close();
    }
  });

  it('expires live contexts on restart and refuses stale UUID rebinds', async () => {
    const { root, databasePath } = fixture();
    await runner(root, new VerifiedBackupFactory(root)).run(databasePath);
    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA foreign_keys = ON');
    const store = new ManagedArtifactStore(database);
    const service = new AutomationContextService(database, store, () => new Date(AT));
    const projectId = '10000000-0000-4000-8000-000000000001';
    const revisionId = '20000000-0000-4000-8000-000000000099';
    try {
      database
        .prepare(
          `INSERT INTO canonical_revisions
           (revision_id, project_id, revision_sequence, revision_label, lifecycle_state,
            project_snapshot_json, luminaire_snapshot_json, snapshot_hash, created_by_id,
            created_by_name, provenance_classification, legacy_source_id, failure_reason,
            created_at, finalized_at, updated_at, purpose, internal_note)
           SELECT ?, project_id, 99, 'REV_99', 'PREPARING', project_snapshot_json,
                  luminaire_snapshot_json, snapshot_hash, created_by_id, created_by_name,
                  provenance_classification, NULL, NULL, created_at, NULL, updated_at, NULL, NULL
           FROM canonical_revisions WHERE revision_id = ?`,
        )
        .run(revisionId, '20000000-0000-4000-8000-000000000001');
      const context = service.open({
        projectId,
        application: 'AUTOCAD',
        expectedArtifactType: 'CAD_DRAWING',
        targetRevisionId: revisionId,
      });
      expect(service.expireActiveContextsAfterRestart()).toBe(1);
      expect(service.get(context.toolContextId).state).toBe('EXPIRED');
      database.prepare('DELETE FROM canonical_revisions WHERE revision_id = ?').run(revisionId);
      expect(() => service.rebind(context.toolContextId)).toThrowError(/Revision not found/i);
      expect(service.get(context.toolContextId)).toMatchObject({
        state: 'EXPIRED',
        targetRevisionId: revisionId,
      });
    } finally {
      database.close();
    }
  });

  it('exposes authenticated Project-authorized context lifecycle routes only', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scli-p4a-v20-api-'));
    roots.push(root);
    const databasePath = path.join(root, 'workspace.sqlite');
    new DatabaseSync(databasePath).close();
    await runner(
      root,
      new VerifiedBackupFactory(root),
      PRODUCTION_MIGRATIONS,
      PRODUCTION_SCHEMA_TARGET_VERSION,
    ).run(databasePath);
    const config = loadConfig({
      APP_MODE: 'standalone',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'true',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      STANDALONE_DB_PATH: databasePath,
      STANDALONE_SESSION_SECRET: 'p4a-test-session-secret-longer-than-thirty-two-characters',
      STANDALONE_ADMIN_NAME: 'Local Owner',
      STANDALONE_ADMIN_EMAIL: 'owner@local.test',
      STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
      COMPANY_TIMEZONE: 'Asia/Dubai',
    });
    const database = new DatabaseSync(databasePath);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, database);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, database);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      clock: () => new Date(AT),
    });
    try {
      const admin = (await provider.listUsers()).find((user) => user.role === 'Admin');
      if (!admin) throw new Error('Bootstrap Admin missing.');
      const project = (
        await new ProjectService(
          provider,
          config.COMPANY_TIMEZONE,
          () => new Date(AT),
          'personal',
        ).createProject(admin, {
          projectName: 'P4A Route Project',
          clientName: 'Disposable Client',
          projectType: 'Lighting Layout',
          description: 'Disposable automation route test.',
          collaboratorDesignerIds: [],
          siteLocation: 'Dubai, UAE',
          designStage: 'Concept',
          lightingScope: 'Lighting design.',
          luxRequirements: '500 lux.',
          drawingReference: 'A-101',
          priority: 'Normal',
          complexity: 'Medium',
          estimatedHours: 1,
          requiredDeliveryDate: '2026-08-30',
          projectFolderUrl: null,
          idempotencyKey: randomUUID(),
        })
      ).project;
      const opened = await app.inject({
        method: 'POST',
        url: `/api/personal/projects/${project.id}/automation-contexts`,
        payload: {
          application: 'AUTOCAD',
          expectedArtifactType: 'CAD_DRAWING',
        },
      });
      expect(opened.statusCode).toBe(201);
      const context = opened.json().data as { toolContextId: string; projectId: string };
      expect(context.projectId).toBe(project.id);

      const listed = await app.inject({
        method: 'GET',
        url: `/api/personal/projects/${project.id}/automation-contexts`,
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().data).toHaveLength(1);

      const expired = await app.inject({
        method: 'POST',
        url: `/api/personal/automation-contexts/${context.toolContextId}/expire`,
      });
      expect(expired.statusCode).toBe(200);
      expect(expired.json().data.state).toBe('EXPIRED');
    } finally {
      await app.close();
      store.close();
      provider.close();
      database.close();
    }
  });

  it('P4B exposes safe capture list/get/retry routes without absolute path disclosure', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scli-p4b-api-'));
    roots.push(root);
    const databasePath = path.join(root, 'workspace.sqlite');
    new DatabaseSync(databasePath).close();
    await runner(
      root,
      new VerifiedBackupFactory(root),
      PRODUCTION_MIGRATIONS,
      PRODUCTION_SCHEMA_TARGET_VERSION,
    ).run(databasePath);
    const config = loadConfig({
      APP_MODE: 'standalone',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'true',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      STANDALONE_DB_PATH: databasePath,
      STANDALONE_SESSION_SECRET: 'p4b-test-session-secret-longer-than-thirty-two-characters',
      STANDALONE_ADMIN_NAME: 'Local Owner',
      STANDALONE_ADMIN_EMAIL: 'owner@local.test',
      STANDALONE_ADMIN_PASSWORD: 'A-Strong-Local-Password-2026!',
      COMPANY_TIMEZONE: 'Asia/Dubai',
    });
    const database = new DatabaseSync(databasePath);
    const provider = new StandaloneDataProvider(config, EXTERNALLY_MIGRATED, database);
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, database);
    const registry = new CanonicalOutputRegistryStore(
      database,
      { now: () => new Date(AT) },
      'CANONICAL',
    );
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      canonicalOutputRegistry: registry,
      clock: () => new Date(AT),
    });
    try {
      const admin = (await provider.listUsers()).find((user) => user.role === 'Admin');
      if (!admin) throw new Error('Bootstrap Admin missing.');
      const project = (
        await new ProjectService(
          provider,
          config.COMPANY_TIMEZONE,
          () => new Date(AT),
          'personal',
        ).createProject(admin, {
          projectName: 'P4B Capture API Project',
          clientName: 'Disposable Client',
          projectType: 'Lighting Layout',
          description: 'Disposable P4B route test.',
          collaboratorDesignerIds: [],
          siteLocation: 'Dubai, UAE',
          designStage: 'Concept',
          lightingScope: 'Lighting design.',
          luxRequirements: '500 lux.',
          drawingReference: 'A-101',
          priority: 'Normal',
          complexity: 'Medium',
          estimatedHours: 1,
          requiredDeliveryDate: '2026-08-30',
          projectFolderUrl: null,
          idempotencyKey: randomUUID(),
        })
      ).project;
      const opened = await app.inject({
        method: 'POST',
        url: `/api/personal/projects/${project.id}/automation-contexts`,
        payload: {
          application: 'AUTOCAD',
          expectedArtifactType: 'CAD_WORKING_DRAWING',
        },
      });
      expect(opened.statusCode).toBe(201);
      const context = opened.json().data as { toolContextId: string };
      const captures = new CaptureLedgerService(new ManagedArtifactStore(database));
      const capture = captures.createDetectedCapture({
        projectId: project.id,
        targetRevisionId: null,
        toolContextId: context.toolContextId,
        sourcePath: path.join(root, 'private', 'working.dwg'),
        sourceChannel: 'DEDICATED_SESSION_INBOX',
        expectedArtifactType: 'CAD_WORKING_DRAWING',
        detectedAt: AT,
      });
      captures.markUnresolved(capture.captureId, 'DESTINATION_MAPPING_REQUIRED', AT);

      const listed = await app.inject({
        method: 'GET',
        url: `/api/personal/projects/${project.id}/captures`,
      });
      expect(listed.statusCode).toBe(200);
      const listedText = listed.body;
      expect(listedText).not.toContain(root);
      expect(listed.json().data.items[0]).toMatchObject({
        captureId: capture.captureId,
        sourceFileName: 'working.dwg',
        artifactType: 'CAD_WORKING_DRAWING',
        outputMappingId: 'cadWorkingDrawing',
        state: 'UNRESOLVED',
        structuredReason: {
          code: 'DESTINATION_MAPPING_REQUIRED',
          summary: 'Output filing needs a valid Project folder mapping.',
        },
        allowedRecoveryActions: ['CONFIGURE_OUTPUT_FILING', 'RETRY', 'DISCARD'],
      });
      expect(listed.json().data).toMatchObject({ totalCount: 1, pageSize: 50, page: 0 });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/personal/captures/${capture.captureId}`,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.body).not.toContain(root);

      const invalidBody = await app.inject({
        method: 'POST',
        url: `/api/personal/captures/${capture.captureId}/retry`,
        payload: { path: root },
      });
      expect(invalidBody.statusCode).toBe(400);

      const retry = await app.inject({
        method: 'POST',
        url: `/api/personal/captures/${capture.captureId}/retry`,
        payload: {},
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().data).toMatchObject({
        routingDecision: 'REJECTED',
        state: 'DISCARDED',
      });
    } finally {
      await app.close();
      store.close();
      provider.close();
      database.close();
    }
  });

  it('P4B capture routes authorize the exact owning Project against direct URLs', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scli-p4b-api-auth-'));
    roots.push(root);
    const databasePath = path.join(root, 'workspace.sqlite');
    new DatabaseSync(databasePath).close();
    await runner(
      root,
      new VerifiedBackupFactory(root),
      PRODUCTION_MIGRATIONS,
      PRODUCTION_SCHEMA_TARGET_VERSION,
    ).run(databasePath);
    const config = loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'false',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      STANDALONE_DB_PATH: databasePath,
      COMPANY_TIMEZONE: 'Asia/Dubai',
    });
    const database = new DatabaseSync(databasePath);
    const provider = new MockDataProvider();
    const store = new PersonalWorkspaceStore(config, EXTERNALLY_MIGRATED, database);
    const registry = new CanonicalOutputRegistryStore(
      database,
      { now: () => new Date(AT) },
      'CANONICAL',
    );
    const artifacts = new ManagedArtifactStore(database);
    const context = artifacts.createToolContext({
      projectId: seedProjects[0]!.id,
      targetRevisionId: null,
      tool: 'AUTOCAD',
      expectedArtifactType: 'CAD_WORKING_DRAWING',
      mode: 'EXTERNAL_OUTPUT_SESSION',
      channel: 'DEDICATED_SESSION_INBOX',
      openedAt: AT,
    });
    const captures = new CaptureLedgerService(artifacts);
    const capture = captures.createDetectedCapture({
      projectId: seedProjects[0]!.id,
      targetRevisionId: null,
      toolContextId: context.toolContextId,
      sourcePath: path.join(root, 'private', 'working.dwg'),
      sourceChannel: 'DEDICATED_SESSION_INBOX',
      expectedArtifactType: 'CAD_WORKING_DRAWING',
      detectedAt: AT,
    });
    captures.markUnresolved(capture.captureId, 'DESTINATION_MAPPING_REQUIRED', AT);
    const app = await createApp({
      config,
      provider,
      personalStore: store,
      canonicalOutputRegistry: registry,
      clock: () => new Date(AT),
    });
    try {
      const deniedProject = await app.inject({
        method: 'GET',
        url: `/api/personal/projects/${seedProjects[0]!.id}/captures`,
        headers: { 'x-mock-user-id': seedUserIds.salesTwo },
      });
      expect(deniedProject.statusCode).toBe(403);
      const deniedDirect = await app.inject({
        method: 'GET',
        url: `/api/personal/captures/${capture.captureId}`,
        headers: { 'x-mock-user-id': seedUserIds.salesTwo },
      });
      expect(deniedDirect.statusCode).toBe(403);
      const deniedRetry = await app.inject({
        method: 'POST',
        url: `/api/personal/captures/${capture.captureId}/retry`,
        headers: { 'x-mock-user-id': seedUserIds.salesTwo },
        payload: {},
      });
      expect(deniedRetry.statusCode).toBe(403);
      const allowed = await app.inject({
        method: 'GET',
        url: `/api/personal/captures/${capture.captureId}`,
        headers: { 'x-mock-user-id': seedUserIds.admin },
      });
      expect(allowed.statusCode).toBe(200);
    } finally {
      await app.close();
      store.close();
      database.close();
    }
  });
});
