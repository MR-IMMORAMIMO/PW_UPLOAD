import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppUser, Project } from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store';
import { LuminaireLibraryAssetStorage } from '../luminaire-library/LuminaireLibraryAssetStorage';
import { LegacyDatasheetAdoptionService } from './LegacyDatasheetAdoptionService';

const PROJECT_ID = '10000000-0000-4000-8000-000000000001';
const LUMINAIRE_ID = '20000000-0000-4000-8000-000000000001';
const LEGACY_ID = '30000000-0000-4000-8000-000000000001';
const PREVIOUS_ID = '30000000-0000-4000-8000-000000000000';
const NOW = new Date('2026-08-28T12:00:00.000Z');
const actor = {
  id: '40000000-0000-4000-8000-000000000001',
  entraObjectId: 'owner-entra',
  displayName: 'Owner',
  email: 'owner@example.test',
  jobTitle: 'Owner',
  department: 'Lighting',
  role: 'Admin',
  weeklyCapacityHours: 40,
  availabilityStatus: 'Available',
  avatarUrl: null,
  isActive: true,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
} satisfies AppUser;

const created: string[] = [];

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE project_luminaires (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, tag TEXT NOT NULL,
      datasheet_path TEXT NOT NULL, row_version INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE luminaire_asset_versions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, luminaire_id TEXT NOT NULL,
      asset_type TEXT NOT NULL, version_sequence INTEGER NOT NULL, file_path TEXT NOT NULL,
      file_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER, file_hash TEXT,
      backfilled INTEGER NOT NULL, attached_at TEXT NOT NULL, attached_by_id TEXT,
      attached_by_name_snapshot TEXT, locator_kind TEXT NOT NULL, locator_value TEXT NOT NULL,
      source_library_asset_version_id TEXT,
      UNIQUE(luminaire_id,asset_type,version_sequence)
    );
    CREATE TABLE workspace_activity (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, action TEXT NOT NULL, title TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  return db;
}

function transactionalStore(db: DatabaseSync): PersonalWorkspaceStore {
  return {
    runInTransaction<T>(operation: () => T): T {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = operation();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as PersonalWorkspaceStore;
}

function seedLegacy(db: DatabaseSync, sourcePath: string, storedHash: string | null): void {
  db.prepare(`INSERT INTO project_luminaires VALUES (?,?,?,?,1,?)`).run(
    LUMINAIRE_ID,
    PROJECT_ID,
    'DL01',
    sourcePath,
    NOW.toISOString(),
  );
  const insert = db.prepare(
    `INSERT INTO luminaire_asset_versions
     VALUES (?,?,?,?,?,?,?,?,?,?,0,?,NULL,NULL,'LEGACY_PATH',?,NULL)`,
  );
  insert.run(
    PREVIOUS_ID,
    PROJECT_ID,
    LUMINAIRE_ID,
    'Datasheet',
    1,
    `${sourcePath}.previous.pdf`,
    'previous.pdf',
    'application/pdf',
    10,
    null,
    NOW.toISOString(),
    `${sourcePath}.previous.pdf`,
  );
  const bytes = readFileSync(sourcePath);
  insert.run(
    LEGACY_ID,
    PROJECT_ID,
    LUMINAIRE_ID,
    'Datasheet',
    2,
    sourcePath,
    path.basename(sourcePath),
    'application/pdf',
    bytes.length,
    storedHash,
    NOW.toISOString(),
    sourcePath,
  );
}

function fixture(input?: { verified?: boolean; storedHash?: string | null; bytes?: Buffer }) {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-legacy-adoption-'));
  created.push(root);
  const dataRoot = path.join(root, 'data');
  const externalRoot = path.join(root, 'external');
  mkdirSync(externalRoot, { recursive: true });
  const sourcePath = path.join(externalRoot, 'DL01.pdf');
  const bytes = input?.bytes ?? Buffer.from('%PDF-1.4\nSynthetic Datasheet\n%%EOF');
  writeFileSync(sourcePath, bytes, { flag: 'wx' });
  const db = database();
  seedLegacy(db, sourcePath, input?.storedHash === undefined ? sha256(bytes) : input.storedHash);
  const createVerifiedBackup = vi.fn(async () => ({ backupId: 'backup-001' }));
  const service = new LegacyDatasheetAdoptionService(
    db,
    transactionalStore(db),
    {
      resolveVerifiedProjectRoot:
        input?.verified === false
          ? async () => {
              throw new Error('unverified');
            }
          : async () => root as never,
    },
    new LuminaireLibraryAssetStorage(dataRoot),
    { createVerifiedBackup },
    () => NOW,
  );
  return {
    root,
    dataRoot,
    sourcePath,
    bytes,
    db,
    service,
    createVerifiedBackup,
    project: { id: PROJECT_ID } as Project,
    request: { items: [{ luminaireId: LUMINAIRE_ID, assetVersionId: LEGACY_ID }] },
  };
}

afterEach(() => {
  for (const item of created.splice(0)) rmSync(item, { recursive: true, force: true });
});

describe('LegacyDatasheetAdoptionService', () => {
  it('blocks every mutation while the existing Project root is unverified', async () => {
    const f = fixture({ verified: false });
    const before = f.db.prepare('SELECT COUNT(*) count FROM luminaire_asset_versions').get() as {
      count: number;
    };
    const result = await f.service.adopt(f.project, f.request, actor);
    expect(result.items[0]).toMatchObject({
      status: 'BLOCKED_STORAGE_UNVERIFIED',
      reasonCode: 'STORAGE_UNVERIFIED',
    });
    expect(f.createVerifiedBackup).not.toHaveBeenCalled();
    expect(
      (
        f.db.prepare('SELECT COUNT(*) count FROM luminaire_asset_versions').get() as {
          count: number;
        }
      ).count,
    ).toBe(before.count);
    expect(existsSync(path.join(f.dataRoot, 'project-luminaire-assets'))).toBe(false);
  });

  it('adopts null-hash legacy bytes into a new managed AssetVersion and preserves history', async () => {
    const f = fixture({ storedHash: null });
    const result = await f.service.adopt(f.project, f.request, actor);
    expect(result.backupId).toBe('backup-001');
    expect(result.items[0]).toMatchObject({ status: 'ADOPTED', reasonCode: 'READY_TO_ADOPT' });
    expect(f.createVerifiedBackup).toHaveBeenCalledTimes(1);
    const rows = f.db
      .prepare(
        'SELECT id,version_sequence,file_hash,locator_kind,locator_value FROM luminaire_asset_versions ORDER BY version_sequence',
      )
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ id: LEGACY_ID, version_sequence: 2, file_hash: null });
    expect(rows[2]).toMatchObject({
      version_sequence: 3,
      file_hash: sha256(f.bytes),
      locator_kind: 'DATA_ROOT_RELATIVE',
    });
    const managedPath = f.db.prepare('SELECT datasheet_path FROM project_luminaires').get() as {
      datasheet_path: string;
    };
    expect(readFileSync(managedPath.datasheet_path)).toEqual(f.bytes);
    expect(readFileSync(f.sourcePath)).toEqual(f.bytes);
    expect(existsSync(path.join(f.dataRoot, 'document-store'))).toBe(false);
    expect(
      (
        f.db
          .prepare(
            `SELECT COUNT(*) count FROM workspace_activity WHERE action='LEGACY_DATASHEET_ADOPTED'`,
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);

    const replay = await f.service.adopt(f.project, f.request, actor);
    expect(replay.items[0]).toMatchObject({ status: 'ALREADY_MANAGED' });
    expect(f.createVerifiedBackup).toHaveBeenCalledTimes(1);
    expect(
      (
        f.db.prepare('SELECT COUNT(*) count FROM luminaire_asset_versions').get() as {
          count: number;
        }
      ).count,
    ).toBe(3);
  });

  it('performs zero copies and zero database mutations when backup creation fails', async () => {
    const f = fixture();
    f.createVerifiedBackup.mockRejectedValueOnce(new Error('backup failed'));
    const result = await f.service.adopt(f.project, f.request, actor);
    expect(result.items[0]).toMatchObject({ status: 'FAILED', reasonCode: 'BACKUP_FAILED' });
    expect(
      (
        f.db.prepare('SELECT COUNT(*) count FROM luminaire_asset_versions').get() as {
          count: number;
        }
      ).count,
    ).toBe(2);
    expect(existsSync(path.join(f.dataRoot, 'project-luminaire-assets'))).toBe(false);
  });

  it('blocks missing, invalid, mismatched, and reparse-routed exact sources', async () => {
    const missing = fixture();
    rmSync(missing.sourcePath);
    expect(
      (await missing.service.inspect(missing.project, missing.request)).items[0],
    ).toMatchObject({
      reasonCode: 'SOURCE_FILE_MISSING',
    });

    const invalid = fixture({ bytes: Buffer.from('not a pdf') });
    expect(
      (await invalid.service.inspect(invalid.project, invalid.request)).items[0],
    ).toMatchObject({
      reasonCode: 'PDF_VALIDATION_FAILED',
    });

    const mismatch = fixture({ storedHash: '0'.repeat(64) });
    expect(
      (await mismatch.service.inspect(mismatch.project, mismatch.request)).items[0],
    ).toMatchObject({
      reasonCode: 'SOURCE_HASH_MISMATCH',
    });

    const linked = fixture();
    const linkRoot = path.join(linked.root, 'linked');
    symlinkSync(path.dirname(linked.sourcePath), linkRoot, 'junction');
    const linkedPath = path.join(linkRoot, path.basename(linked.sourcePath));
    linked.db.prepare('UPDATE project_luminaires SET datasheet_path=?').run(linkedPath);
    linked.db
      .prepare('UPDATE luminaire_asset_versions SET file_path=?,locator_value=? WHERE id=?')
      .run(linkedPath, linkedPath, LEGACY_ID);
    expect((await linked.service.inspect(linked.project, linked.request)).items[0]).toMatchObject({
      reasonCode: 'PDF_VALIDATION_FAILED',
    });
  });

  it('adopts a disposable ten-Luminaire legacy fixture with one backup and independent versions', async () => {
    const f = fixture({ storedHash: null });
    const requests = [...f.request.items];
    for (let index = 2; index <= 10; index += 1) {
      const suffix = String(index).padStart(12, '0');
      const luminaireId = `20000000-0000-4000-8000-${suffix}`;
      const assetVersionId = `30000000-0000-4000-8000-${suffix}`;
      const sourcePath = path.join(
        path.dirname(f.sourcePath),
        `DL${String(index).padStart(2, '0')}.pdf`,
      );
      const bytes = Buffer.from(`%PDF-1.4\nSynthetic Datasheet ${index}\n%%EOF`);
      writeFileSync(sourcePath, bytes, { flag: 'wx' });
      f.db
        .prepare('INSERT INTO project_luminaires VALUES (?,?,?,?,1,?)')
        .run(
          luminaireId,
          PROJECT_ID,
          `DL${String(index).padStart(2, '0')}`,
          sourcePath,
          NOW.toISOString(),
        );
      f.db
        .prepare(
          `INSERT INTO luminaire_asset_versions
           VALUES (?,?,?,'Datasheet',1,?,?, 'application/pdf',?,?,0,?,NULL,NULL,'LEGACY_PATH',?,NULL)`,
        )
        .run(
          assetVersionId,
          PROJECT_ID,
          luminaireId,
          sourcePath,
          path.basename(sourcePath),
          bytes.length,
          index % 2 === 0 ? sha256(bytes) : null,
          NOW.toISOString(),
          sourcePath,
        );
      requests.push({ luminaireId, assetVersionId });
    }

    const result = await f.service.adopt(f.project, { items: requests }, actor);
    expect(result.items).toHaveLength(10);
    expect(result.items.every((item) => item.status === 'ADOPTED')).toBe(true);
    expect(f.createVerifiedBackup).toHaveBeenCalledTimes(1);
    expect(
      (
        f.db
          .prepare(
            `SELECT COUNT(*) count FROM luminaire_asset_versions WHERE locator_kind='DATA_ROOT_RELATIVE'`,
          )
          .get() as { count: number }
      ).count,
    ).toBe(10);
    expect(
      (
        f.db
          .prepare(
            `SELECT COUNT(*) count FROM luminaire_asset_versions WHERE locator_kind='LEGACY_PATH' AND file_hash IS NULL`,
          )
          .get() as { count: number }
      ).count,
    ).toBe(6);
  });

  it('keeps a valid adoption when another item in the same batch has a stored hash mismatch', async () => {
    const f = fixture();
    const secondLuminaireId = '20000000-0000-4000-8000-000000000099';
    const secondAssetId = '30000000-0000-4000-8000-000000000099';
    const secondPath = path.join(path.dirname(f.sourcePath), 'DL99.pdf');
    const secondBytes = Buffer.from('%PDF-1.4\nMismatched fixture\n%%EOF');
    writeFileSync(secondPath, secondBytes, { flag: 'wx' });
    f.db
      .prepare('INSERT INTO project_luminaires VALUES (?,?,?,?,1,?)')
      .run(secondLuminaireId, PROJECT_ID, 'DL99', secondPath, NOW.toISOString());
    f.db
      .prepare(
        `INSERT INTO luminaire_asset_versions
         VALUES (?,?,?,'Datasheet',1,?,?,'application/pdf',?,?,0,?,NULL,NULL,'LEGACY_PATH',?,NULL)`,
      )
      .run(
        secondAssetId,
        PROJECT_ID,
        secondLuminaireId,
        secondPath,
        'DL99.pdf',
        secondBytes.length,
        '0'.repeat(64),
        NOW.toISOString(),
        secondPath,
      );

    const result = await f.service.adopt(
      f.project,
      {
        items: [
          ...f.request.items,
          { luminaireId: secondLuminaireId, assetVersionId: secondAssetId },
        ],
      },
      actor,
    );
    expect(result.items).toMatchObject([
      { status: 'ADOPTED' },
      { status: 'BLOCKED_HASH_MISMATCH', reasonCode: 'SOURCE_HASH_MISMATCH' },
    ]);
    expect(f.createVerifiedBackup).toHaveBeenCalledTimes(1);
  });
});
