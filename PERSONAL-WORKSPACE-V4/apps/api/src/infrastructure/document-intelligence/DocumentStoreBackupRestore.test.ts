import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupManager } from '../backup/BackupManager';
import { RestoreManager } from '../backup/RestoreManager';
import { PathResolverService } from '../path/PathResolverService';
import {
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
} from '../migration/registry/production-migration-registry';
import { validateProductionSchemaVersion } from '../migration/registry/production-schema-validator';
import { DocumentIntelligenceStore } from './DocumentIntelligenceStore';
import { DocumentSourceAdmission } from './DocumentSourceAdmission';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('verified Document Store backup and restore', () => {
  it('restores v27 identities, verification authority, retryable processing, exact-source reuse, and immutable bytes with hash integrity', async () => {
    const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'p5c-backup-'));
    roots.push(dataRoot);
    const databasePath = path.join(dataRoot, 'workspace.sqlite');
    const backupRoot = path.join(dataRoot, 'backups');
    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA foreign_keys=ON');
    for (const migration of PRODUCTION_MIGRATIONS) {
      database.exec(
        migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
          ? 'PRAGMA foreign_keys = OFF'
          : 'PRAGMA foreign_keys = ON',
      );
      database.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
      migration.up({
        database,
        migrationId: migration.id,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        clock: { now: () => new Date() },
      });
      database.exec(`PRAGMA user_version=${migration.toVersion}; COMMIT`);
    }
    const admission = new DocumentSourceAdmission(dataRoot);
    const bytes = Buffer.from('%PDF-1.4\nbackup synthetic\n%%EOF');
    const managed = admission.admitBuffer(bytes, 'Backup.pdf');
    const store = new DocumentIntelligenceStore(database);
    const first = store.createAdmission({
      bytes: managed,
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'backup-first',
    });
    const duplicate = store.createAdmission({
      bytes: admission.admitBuffer(bytes, 'Backup Copy.pdf'),
      admissionMechanism: 'GLOBAL_SELECT',
      projectContextId: null,
      idempotencyKey: 'backup-copy',
    });
    expect(duplicate.sourceId).toBe(first.sourceId);
    store.setAttemptState(first.processingAttemptId, 'FAILED_RETRYABLE', 'SYNTHETIC_FAILURE', {
      errorCode: 'PARSER_FAILED',
    });
    const managedAssetRoots = [
      { key: 'document-store', absolutePath: path.join(dataRoot, 'document-store', 'objects') },
    ] as const;
    const manager = new BackupManager({
      sourceDb: database,
      sourceDatabasePath: databasePath,
      backupRoot,
      pathResolver: new PathResolverService(dataRoot),
      clock: { now: () => new Date('2026-08-27T00:00:00.000Z') },
      idGenerator: { generate: () => 'p5c-document-backup' },
      appVersion: '3.2.2',
      verificationPolicy: {
        requiredTables: [
          'document_sources',
          'intelligence_documents',
          'document_versions',
          'document_processing_attempts',
          'luminaire_datasheet_verifications',
        ],
        validateDatabase: (candidate) =>
          validateProductionSchemaVersion(candidate, PRODUCTION_SCHEMA_TARGET_VERSION),
      },
      managedAssetRoots,
    });
    const backup = await manager.createVerifiedBackup({ reason: 'P5C synthetic backup' });
    const verification = await manager.verifyBackup(backup.backupId);
    expect(verification.managedAssets?.manifest.files).toHaveLength(1);
    database.close();
    const sourcePath = admission.resolveManagedLocator(managed.managedLocator);
    writeFileSync(sourcePath, 'corrupt');
    const restore = new RestoreManager({
      backupRoot,
      pathResolver: new PathResolverService(dataRoot),
      verifier: manager,
      stagingNameGenerator: { generate: () => 'p5c-restore-stage' },
      managedAssetRoots,
    });
    await expect(
      restore.restore({ targetDatabasePath: databasePath, backupId: backup.backupId }),
    ).resolves.toMatchObject({ status: 'RESTORED', verificationPassed: true });
    const restored = new DatabaseSync(databasePath);
    restored.exec('PRAGMA foreign_keys=ON');
    validateProductionSchemaVersion(restored, PRODUCTION_SCHEMA_TARGET_VERSION);
    expect(
      restored
        .prepare(`SELECT state FROM document_processing_attempts WHERE attempt_id=?`)
        .get(first.processingAttemptId),
    ).toEqual({ state: 'FAILED_RETRYABLE' });
    expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    restored.close();
    const restoredBytes = readFileSync(sourcePath);
    expect(restoredBytes).toEqual(bytes);
    expect(createHash('sha256').update(restoredBytes).digest('hex')).toBe(managed.sha256);
  });
});
