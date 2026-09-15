import { constants, existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BackupRecord } from '@scli/domain';
import { DomainError } from '@scli/domain';
import { BackupManager } from './BackupManager';

export interface WorkspaceBackupService {
  createBackup(): Promise<string>;
  createVerifiedBackup(reason: string): Promise<{ backupId: string }>;
  listBackups(): Promise<BackupRecord[]>;
  scheduleRestore(backupDirectory: string): Promise<string>;
}

export class ProductionWorkspaceBackupService implements WorkspaceBackupService {
  public constructor(
    private readonly manager: BackupManager,
    private readonly backupRoot: string,
    private readonly pendingRestoreRequestPath: string,
  ) {}

  public async createBackup(): Promise<string> {
    const result = await this.manager.createVerifiedBackup({ reason: 'MANUAL' });
    return result.backupDirectory;
  }

  public async createVerifiedBackup(reason: string): Promise<{ backupId: string }> {
    const result = await this.manager.createVerifiedBackup({ reason: reason.slice(0, 200) });
    return { backupId: path.basename(result.backupDirectory) };
  }

  public async listBackups(): Promise<BackupRecord[]> {
    if (!existsSync(this.backupRoot)) return [];
    const records: BackupRecord[] = [];
    for (const entry of readdirSync(this.backupRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.partial-')) continue;
      try {
        const metadata = await this.manager.inspectBackup(entry.name);
        records.push({
          fileName: entry.name,
          filePath: path.join(this.backupRoot, entry.name),
          sizeBytes:
            metadata.backupDatabase.sizeBytes + (metadata.managedAssets?.totalSizeBytes ?? 0),
          createdAt: metadata.createdAt,
          reason: metadata.reason,
          managedAssetCount: metadata.managedAssets?.fileCount ?? 0,
          managedAssetsVerified: Boolean(metadata.managedAssets),
        });
      } catch {
        // Invalid or incomplete artifacts are never presented as restorable backups.
      }
    }
    return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  public async scheduleRestore(backupDirectory: string): Promise<string> {
    const resolved = path.resolve(backupDirectory);
    const root = path.resolve(this.backupRoot);
    if (path.dirname(resolved).toLocaleLowerCase('en') !== root.toLocaleLowerCase('en')) {
      throw new DomainError('NOT_FOUND', 'Backup artifact was not found.', 404);
    }
    const backupId = path.basename(resolved);
    const record = (await this.listBackups()).find((item) => item.fileName === backupId);
    if (!record) throw new DomainError('NOT_FOUND', 'Backup artifact was not found.', 404);
    try {
      await this.manager.verifyBackup(backupId);
    } catch {
      throw new DomainError('VALIDATION_ERROR', 'Backup verification failed.', 400);
    }
    if (existsSync(this.pendingRestoreRequestPath)) {
      throw new DomainError(
        'CONFLICT',
        'A restore is already waiting for application restart.',
        409,
      );
    }
    try {
      writeFileSync(
        this.pendingRestoreRequestPath,
        `${JSON.stringify({ version: 1, backupId }, null, 2)}\n`,
        { flag: 'wx', mode: constants.S_IRUSR | constants.S_IWUSR },
      );
    } catch (error) {
      if (existsSync(this.pendingRestoreRequestPath)) {
        throw new DomainError(
          'CONFLICT',
          'A restore is already waiting for application restart.',
          409,
        );
      }
      throw error;
    }
    return this.pendingRestoreRequestPath;
  }
}
