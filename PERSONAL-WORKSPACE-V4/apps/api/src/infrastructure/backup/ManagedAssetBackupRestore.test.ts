import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { PathResolverService } from '../path/PathResolverService';
import { BackupManager } from './BackupManager';
import { RestoreManager } from './RestoreManager';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('verified DB and managed Library asset backup/restore', () => {
  it('restores SQLite, Library assets, and Project snapshots from one verified artifact', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'p5a-backup-'));
    roots.push(dataRoot);
    const databasePath = path.join(dataRoot, 'workspace.sqlite');
    const backupRoot = path.join(dataRoot, 'backups');
    const libraryRoot = path.join(dataRoot, 'luminaire-library', 'assets');
    const projectRoot = path.join(dataRoot, 'project-luminaire-assets');
    const libraryFile = path.join(libraryRoot, 'asset-version-1', 'lightscan.ies');
    const projectFile = path.join(
      projectRoot,
      'project-a',
      'luminaire-a',
      'asset-version-a',
      'lightscan.ies',
    );
    mkdirSync(path.dirname(libraryFile), { recursive: true });
    mkdirSync(path.dirname(projectFile), { recursive: true });
    writeFileSync(libraryFile, 'library-v1');
    writeFileSync(projectFile, 'project-v1');

    const database = new DatabaseSync(databasePath);
    database.exec(
      `PRAGMA user_version = 22;
       CREATE TABLE verification_anchor (value TEXT NOT NULL);
       INSERT INTO verification_anchor VALUES ('before');`,
    );
    const managedAssetRoots = [
      { key: 'luminaire-library', absolutePath: libraryRoot },
      { key: 'project-luminaire-assets', absolutePath: projectRoot },
    ] as const;
    const manager = new BackupManager({
      sourceDb: database,
      sourceDatabasePath: databasePath,
      backupRoot,
      pathResolver: new PathResolverService(dataRoot),
      clock: { now: () => new Date('2026-08-25T00:00:00.000Z') },
      idGenerator: { generate: () => 'verified-p5a-backup' },
      appVersion: '3.2.2',
      verificationPolicy: { requiredTables: ['verification_anchor'] },
      managedAssetRoots,
    });

    const backup = await manager.createVerifiedBackup({ reason: 'P5A UAT' });
    const verification = await manager.verifyBackup(backup.backupId);
    expect(verification.managedAssets?.manifest.files).toHaveLength(2);
    expect(backup.metadata.managedAssets).toMatchObject({ fileCount: 2, totalSizeBytes: 20 });

    database.prepare("UPDATE verification_anchor SET value = 'after'").run();
    database.close();
    writeFileSync(libraryFile, 'library-v2');
    writeFileSync(projectFile, 'project-v2');

    let stagingId = 0;
    const restore = new RestoreManager({
      backupRoot,
      pathResolver: new PathResolverService(dataRoot),
      verifier: manager,
      stagingNameGenerator: { generate: () => `restore-${++stagingId}` },
      managedAssetRoots,
    });
    const result = await restore.restore({
      targetDatabasePath: databasePath,
      backupId: backup.backupId,
    });
    expect(result).toMatchObject({ status: 'RESTORED', verificationPassed: true });
    const restored = new DatabaseSync(databasePath, { readOnly: true });
    expect(restored.prepare('SELECT value FROM verification_anchor').get()).toEqual({
      value: 'before',
    });
    restored.close();
    expect(readFileSync(libraryFile, 'utf8')).toBe('library-v1');
    expect(readFileSync(projectFile, 'utf8')).toBe('project-v1');
  });

  it('fails verification when a backed-up managed asset is corrupted', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'p5a-backup-corrupt-'));
    roots.push(dataRoot);
    const databasePath = path.join(dataRoot, 'workspace.sqlite');
    const backupRoot = path.join(dataRoot, 'backups');
    const libraryRoot = path.join(dataRoot, 'luminaire-library', 'assets');
    const libraryFile = path.join(libraryRoot, 'asset-version-1', 'lightscan.ldt');
    mkdirSync(path.dirname(libraryFile), { recursive: true });
    writeFileSync(libraryFile, 'original');
    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA user_version = 22; CREATE TABLE verification_anchor (value TEXT)');
    const manager = new BackupManager({
      sourceDb: database,
      sourceDatabasePath: databasePath,
      backupRoot,
      pathResolver: new PathResolverService(dataRoot),
      clock: { now: () => new Date('2026-08-25T00:00:00.000Z') },
      idGenerator: { generate: () => 'corruption-check' },
      appVersion: '3.2.2',
      verificationPolicy: { requiredTables: ['verification_anchor'] },
      managedAssetRoots: [{ key: 'luminaire-library', absolutePath: libraryRoot }],
    });
    const backup = await manager.createVerifiedBackup({ reason: 'P5A corrupt check' });
    writeFileSync(
      path.join(
        backup.backupDirectory,
        'managed-assets',
        'luminaire-library',
        'asset-version-1',
        'lightscan.ldt',
      ),
      'corrupt',
    );
    await expect(manager.verifyBackup(backup.backupId)).rejects.toMatchObject({
      code: 'MANAGED_ASSET_VERIFICATION_FAILED',
    });
    database.close();
  });
});
