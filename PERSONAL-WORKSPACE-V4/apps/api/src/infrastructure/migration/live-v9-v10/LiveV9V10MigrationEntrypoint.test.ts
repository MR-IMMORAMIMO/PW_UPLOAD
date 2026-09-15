import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertExplicitApplyIntent,
  parseLiveV9V10CliArgs,
} from '../../../scripts/live-v9-v10-migration-cli';
import { DatabaseStartupLock } from '../../startup/DatabaseStartupLock';
import { PRODUCTION_APP_VERSION } from '../../startup/createPersonalProductionStartup';
import { PathResolverService } from '../../path/PathResolverService';
import { PersistentMigrationJournal } from '../journal/PersistentMigrationJournal';
import { JOURNAL_FORMAT_VERSION } from '../journal/journal-types';
import {
  PRODUCTION_MIGRATIONS,
  PRODUCTION_V10_MIGRATION_ID,
} from '../registry/production-migration-registry';
import type { MigrationDefinition } from '../types';
import {
  createLiveV9V10MigrationEntrypoint,
  type LiveV9V10FactoryOptions,
} from './LiveV9V10MigrationEntrypoint';
import {
  CONTROLLED_GOLDEN_MARKER,
  CONTROLLED_GOLDEN_PROJECT_CODE,
  CONTROLLED_GOLDEN_PROJECT_ID,
  CONTROLLED_GOLDEN_PROJECT_NAME,
  CONTROLLED_LEGACY_REVIEW_IDS,
  buildLiveV9V10PreservationManifest,
  preservationManifestsEqual,
} from './LiveV9V10PreservationManifest';

const roots: string[] = [];
const timestamp = '2026-08-11T08:00:00.000Z';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-v9-v10-entrypoint-'));
  roots.push(root);
  return root;
}

function createHistoryTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE schema_migrations (
      migration_id TEXT PRIMARY KEY,
      from_version INTEGER NOT NULL,
      to_version INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      description TEXT NOT NULL,
      app_version TEXT NOT NULL,
      backup_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      validation_result TEXT NOT NULL CHECK (validation_result = 'passed'),
      UNIQUE(from_version),
      UNIQUE(to_version),
      CHECK (duration_ms >= 0)
    )
  `);
}

function applySchemaThroughV9(db: DatabaseSync): void {
  createHistoryTable(db);
  for (const migration of PRODUCTION_MIGRATIONS.filter((item) => item.toVersion <= 9)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const context = {
        database: db,
        migrationId: migration.id,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
        clock: { now: () => new Date(timestamp) },
      };
      migration.up(context);
      migration.validate?.(context);
      db.prepare(
        `INSERT INTO schema_migrations (
           migration_id, from_version, to_version, checksum, description, app_version,
           backup_id, started_at, completed_at, duration_ms, validation_result
         ) VALUES (?, ?, ?, ?, ?, 'test', 'fixture', ?, ?, 0, 'passed')`,
      ).run(
        migration.id,
        migration.fromVersion,
        migration.toVersion,
        migration.checksum,
        migration.description,
        timestamp,
        timestamp,
      );
      db.exec(`PRAGMA user_version = ${migration.toVersion}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function controlledProjects(): Array<Record<string, unknown>> {
  return [
    {
      id: '00000000-0000-4000-8000-000000000001',
      projectCode: '001_TEST',
      projectName: 'TEST',
      crmReference: null,
      status: 'InProgress',
      actualHours: 2,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      projectCode: '002_OTHER',
      projectName: 'Other A',
      crmReference: null,
      status: 'Draft',
      actualHours: 0,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      projectCode: '003_OTHER',
      projectName: 'Other B',
      crmReference: null,
      status: 'Completed',
      actualHours: 10,
    },
    {
      id: CONTROLLED_GOLDEN_PROJECT_ID,
      projectCode: CONTROLLED_GOLDEN_PROJECT_CODE,
      projectName: CONTROLLED_GOLDEN_PROJECT_NAME,
      crmReference: CONTROLLED_GOLDEN_MARKER,
      status: 'InProgress',
      actualHours: 14.5,
    },
  ];
}

function seedControlledBusinessData(db: DatabaseSync): void {
  const state = {
    users: [],
    projects: controlledProjects(),
    activities: [],
    comments: [],
    notifications: [],
    settings: {},
    lastSequence: 4,
  };
  db.prepare(
    "INSERT INTO app_state (state_key, json_value, updated_at) VALUES ('primary', ?, ?)",
  ).run(JSON.stringify(state), timestamp);

  const reviewRows = [
    [CONTROLLED_LEGACY_REVIEW_IDS[0], 'R-03', 'Lobby brightness', 'Resolved', 'Meeting'],
    [CONTROLLED_LEGACY_REVIEW_IDS[1], 'R-01', 'Guest room CCT', 'Open', 'Email'],
    [CONTROLLED_LEGACY_REVIEW_IDS[2], 'R-02', 'Update WL01 datasheet', 'InProgress', 'Manual'],
  ] as const;
  for (const [id, reference, title, status, sourceType] of reviewRows) {
    db.prepare(
      `INSERT INTO project_review_items (
         id, project_id, reference, title, description, area, luminaire_tag,
         drawing_reference, source_type, source_id, status, response, revision_id,
         received_at, due_date, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'description', 'Lobby', 'DL01', 'L-101', ?, NULL, ?,
                 'response', NULL, ?, NULL, ?, ?)`,
    ).run(
      id,
      CONTROLLED_GOLDEN_PROJECT_ID,
      reference,
      title,
      sourceType,
      status,
      timestamp,
      timestamp,
      timestamp,
    );
  }
  for (let index = 0; index < CONTROLLED_LEGACY_REVIEW_IDS.length; index += 1) {
    db.prepare(
      `INSERT INTO workspace_activity (
         id, project_id, entity_type, entity_id, action, title, detail, created_at
       ) VALUES (?, ?, 'Review', ?, 'Created', 'Review activity', '', ?)`,
    ).run(
      `10000000-0000-4000-8000-00000000000${index}`,
      CONTROLLED_GOLDEN_PROJECT_ID,
      CONTROLLED_LEGACY_REVIEW_IDS[index]!,
      timestamp,
    );
  }

  db.prepare(
    `INSERT INTO project_meetings (
       id, project_id, title, start_at, end_at, location, attendees_json, agenda, notes,
       decisions, online_meeting_url, external_event_id, status, created_at, updated_at
     ) VALUES ('meeting-1', ?, 'Review', ?, ?, 'Office', '[]', '', '', '', '', NULL,
               'Scheduled', ?, ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp, timestamp, timestamp);
  db.prepare(
    `INSERT INTO project_actions (
       id, project_id, title, details, owner, due_date, status, priority, source_type,
       source_id, revision_id, completed_at, created_at, updated_at
     ) VALUES ('action-1', ?, 'Coordinate', '', 'Owner', NULL, 'Open', 'High', 'Manual',
               NULL, NULL, NULL, ?, ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp);
  db.prepare(
    `INSERT INTO project_revisions (
       id, project_id, revision_number, title, status, received_at, due_date, issued_at,
       summary, change_log, source_type, source_reference, created_at, updated_at
     ) VALUES ('revision-2', ?, 2, 'REV02', 'Draft', NULL, NULL, NULL, '', '', 'Manual', '', ?, ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp);
  db.prepare(
    `INSERT INTO project_documents (
       id, project_id, category, document_number, title, revision, status, file_path,
       issued_to, issue_date, notes, created_at, updated_at
     ) VALUES ('document-l101', ?, 'Drawing', 'L-101', 'Lighting Layout', '02', 'Draft',
               'L-101.dwg', '', NULL, '', ?, ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp);
  db.prepare(
    `INSERT INTO project_contacts (
       id, project_id, name, email, company, role, created_at, updated_at
     ) VALUES ('contact-1', ?, 'Client', 'client@example.test', 'SCT', 'Client', ?, ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp);
  db.prepare(
    `INSERT INTO project_luminaires (
       id, project_id, tag, category, image_path, description, manufacturer, model,
       wattage, lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout,
       driver, control, emergency, datasheet_path, location, unit, quantity, notes,
       source_name, dimensions, body_color_finish, created_at, updated_at
     ) VALUES ('luminaire-dl01', ?, 'DL01', 'Downlight', '', 'Downlight', 'Maker', 'Model',
               '8W', '800', '3000K', '90', '36', 'IP44', 'Recessed', '75', 'Remote',
               'DALI', 'No', '', 'Lobby', 'No.', 1, '', 'Fixture', '', 'White', ?, ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp);
}

function makeV9Fixture(): { root: string; databasePath: string } {
  const root = makeRoot();
  const databasePath = path.join(root, 'scli-workspace.sqlite');
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    applySchemaThroughV9(db);
    seedControlledBusinessData(db);
  } finally {
    db.close();
  }
  return { root, databasePath };
}

function makeEntrypoint(
  databasePath: string,
  overrides: Omit<LiveV9V10FactoryOptions, 'databasePath' | 'expectedDatabasePath'> = {},
) {
  return createLiveV9V10MigrationEntrypoint({
    databasePath,
    expectedDatabasePath: databasePath,
    ...overrides,
  });
}

function fileHash(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readVersion(databasePath: string): number {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  } finally {
    db.close();
  }
}

async function migrateFixtureToV10(databasePath: string): Promise<void> {
  expect((await makeEntrypoint(databasePath).run('APPLY')).status).toBe(
    'MIGRATION_APPLIED_AND_VERIFIED',
  );
}

async function createUnresolvedJournal(root: string, databasePath: string): Promise<string> {
  const journal = new PersistentMigrationJournal({
    journalRoot: path.join(root, 'journal'),
    databasePath,
    pathResolver: new PathResolverService(root),
    clock: { now: () => new Date(timestamp) },
    idGenerator: { generate: () => 'att-live-v9-v10-blocker' },
    appVersion: PRODUCTION_APP_VERSION,
    journalFormatVersion: JOURNAL_FORMAT_VERSION,
  });
  return (await journal.createAttempt({ fromVersion: 9, targetVersion: 10 })).attemptId;
}

describe('guarded live v9 to v10 migration-only entrypoint', () => {
  it('defaults the operator command to PLAN and requires an exact APPLY confirmation', () => {
    expect(parseLiveV9V10CliArgs([]).mode).toBe('PLAN');
    const applyWithoutConfirmation = parseLiveV9V10CliArgs(['--mode=apply']);
    expect(() => assertExplicitApplyIntent(applyWithoutConfirmation)).toThrow(
      `APPLY requires --confirm=${PRODUCTION_V10_MIGRATION_ID}`,
    );
    const confirmedApply = parseLiveV9V10CliArgs([
      '--mode=apply',
      `--confirm=${PRODUCTION_V10_MIGRATION_ID}`,
    ]);
    expect(() => assertExplicitApplyIntent(confirmedApply)).not.toThrow();
  });

  it('PLAN is ready on the controlled v9 fixture and performs no mutation', async () => {
    const { root, databasePath } = makeV9Fixture();
    const beforeHash = fileHash(databasePath);
    const beforeDb = new DatabaseSync(databasePath, { readOnly: true });
    const historyBefore = (
      beforeDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }
    ).count;
    beforeDb.close();

    const outcome = await makeEntrypoint(databasePath).run('PLAN');

    expect(outcome.status).toBe('PLAN_READY');
    expect(outcome.readiness?.currentVersion).toBe(9);
    expect(outcome.readiness?.projectCount).toBe(4);
    expect(outcome.readiness?.goldenReviewRootIds).toEqual(CONTROLLED_LEGACY_REVIEW_IDS);
    expect(fileHash(databasePath)).toBe(beforeHash);
    expect(readVersion(databasePath)).toBe(9);
    const afterDb = new DatabaseSync(databasePath, { readOnly: true });
    expect(
      (
        afterDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
          count: number;
        }
      ).count,
    ).toBe(historyBefore);
    afterDb.close();
    expect(existsSync(path.join(root, 'backups'))).toBe(false);
    expect(existsSync(path.join(root, 'journal'))).toBe(false);
  });

  it('APPLY creates a verified backup, applies only v10, and preserves business data', async () => {
    const { root, databasePath } = makeV9Fixture();
    const beforeDb = new DatabaseSync(databasePath, { readOnly: true });
    const before = buildLiveV9V10PreservationManifest(beforeDb);
    beforeDb.close();

    const outcome = await makeEntrypoint(databasePath).run('APPLY');

    expect(outcome.status).toBe('MIGRATION_APPLIED_AND_VERIFIED');
    expect(outcome.backupId).toBeTruthy();
    expect(readVersion(databasePath)).toBe(10);
    const afterDb = new DatabaseSync(databasePath, { readOnly: true });
    const after = buildLiveV9V10PreservationManifest(afterDb);
    expect(preservationManifestsEqual(before, after)).toBe(true);
    expect(
      afterDb
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id = ?')
        .get(PRODUCTION_V10_MIGRATION_ID),
    ).toEqual({ count: 1 });
    expect(
      afterDb
        .prepare(
          `SELECT COUNT(*) AS count FROM project_review_items
            WHERE origin IS NOT NULL OR author_id IS NOT NULL OR author_name_snapshot IS NOT NULL
               OR author_role_snapshot IS NOT NULL OR luminaire_id IS NOT NULL`,
        )
        .get(),
    ).toEqual({ count: 0 });
    afterDb.close();

    const metadata = JSON.parse(
      readFileSync(path.join(root, 'backups', outcome.backupId!, 'metadata.json'), 'utf8'),
    ) as { reason: string; migrationId: string; schemaVersion: number };
    expect(metadata).toMatchObject({
      reason: 'SCHEMA_UPGRADE_9_TO_10',
      migrationId: PRODUCTION_V10_MIGRATION_ID,
      schemaVersion: 9,
    });
  });

  it('refuses replay when the source is already at v10', async () => {
    const { databasePath } = makeV9Fixture();
    await migrateFixtureToV10(databasePath);
    expect((await makeEntrypoint(databasePath).run('APPLY')).status).toBe('ALREADY_MIGRATED');
  });

  it.each([
    [
      'missing v10 history',
      (db: DatabaseSync) => {
        db.prepare('DELETE FROM schema_migrations WHERE migration_id = ?').run(
          PRODUCTION_V10_MIGRATION_ID,
        );
      },
    ],
    [
      'wrong v10 target history',
      (db: DatabaseSync) => {
        db.prepare('UPDATE schema_migrations SET to_version = 11 WHERE migration_id = ?').run(
          PRODUCTION_V10_MIGRATION_ID,
        );
      },
    ],
    [
      'missing v10 column',
      (db: DatabaseSync) => {
        db.exec('ALTER TABLE project_review_items DROP COLUMN origin');
      },
    ],
    [
      'missing v10 table',
      (db: DatabaseSync) => {
        db.exec('DROP TABLE project_review_attachments');
      },
    ],
    [
      'Golden identity mismatch',
      (db: DatabaseSync) => {
        const row = db
          .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
          .get() as { json_value: string };
        const state = JSON.parse(row.json_value) as { projects: Array<Record<string, unknown>> };
        state.projects[3]!.projectName = 'Wrong Golden';
        db.prepare("UPDATE app_state SET json_value = ? WHERE state_key = 'primary'").run(
          JSON.stringify(state),
        );
      },
    ],
    [
      'unexpected G-CMT root',
      (db: DatabaseSync) => {
        db.prepare(
          `INSERT INTO project_review_items (
             id, project_id, reference, title, description, area, luminaire_tag,
             drawing_reference, source_type, source_id, status, response, revision_id,
             received_at, due_date, created_at, updated_at
           ) VALUES ('g-cmt-01', ?, 'G-CMT-01', 'Unexpected comment', 'description',
                     'Lobby', 'DL01', 'L-101', 'Manual', NULL, 'Open', '', NULL,
                     ?, NULL, ?, ?)`,
        ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp, timestamp);
      },
    ],
  ])('does not classify schema v10 with %s as already migrated', async (_label, mutate) => {
    const { databasePath } = makeV9Fixture();
    await migrateFixtureToV10(databasePath);
    const db = new DatabaseSync(databasePath);
    try {
      mutate(db);
    } finally {
      db.close();
    }

    await expect(makeEntrypoint(databasePath).run('PLAN')).resolves.toMatchObject({
      status: 'ALREADY_V10_STATE_MISMATCH',
      reasonCode: 'ALREADY_V10_STATE_MISMATCH',
    });
  });

  it('blocks a source version other than v9', async () => {
    const { databasePath } = makeV9Fixture();
    const db = new DatabaseSync(databasePath);
    db.exec('PRAGMA user_version = 8');
    db.close();
    const outcome = await makeEntrypoint(databasePath).run('PLAN');
    expect(outcome).toMatchObject({ status: 'PLAN_BLOCKED', reasonCode: 'WRONG_SOURCE_VERSION' });
  });

  it('blocks partial v10 authority while user_version remains 9', async () => {
    const { databasePath } = makeV9Fixture();
    const db = new DatabaseSync(databasePath);
    db.exec(
      "ALTER TABLE project_review_items ADD COLUMN origin TEXT CHECK(origin IN ('Client', 'Internal'))",
    );
    db.close();
    const outcome = await makeEntrypoint(databasePath).run('PLAN');
    expect(outcome).toMatchObject({
      status: 'PLAN_BLOCKED',
      reasonCode: 'PARTIAL_V10_SCHEMA_STATE',
    });
  });

  it('blocks Golden identity mismatch before backup or migration', async () => {
    const { root, databasePath } = makeV9Fixture();
    const db = new DatabaseSync(databasePath);
    const row = db
      .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
      .get() as {
      json_value: string;
    };
    const state = JSON.parse(row.json_value) as { projects: Array<Record<string, unknown>> };
    state.projects[3]!.projectName = 'Wrong Golden';
    db.prepare("UPDATE app_state SET json_value = ? WHERE state_key = 'primary'").run(
      JSON.stringify(state),
    );
    db.close();
    const outcome = await makeEntrypoint(databasePath).run('APPLY');
    expect(outcome).toMatchObject({
      status: 'APPLY_BLOCKED',
      reasonCode: 'GOLDEN_IDENTITY_MISMATCH',
    });
    expect(existsSync(path.join(root, 'backups'))).toBe(false);
    expect(readVersion(databasePath)).toBe(9);
  });

  it('blocks a duplicate Golden UUID even when only one project has the Golden marker', async () => {
    const { databasePath } = makeV9Fixture();
    const db = new DatabaseSync(databasePath);
    const row = db
      .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
      .get() as { json_value: string };
    const state = JSON.parse(row.json_value) as { projects: Array<Record<string, unknown>> };
    state.projects[0]!.id = CONTROLLED_GOLDEN_PROJECT_ID;
    db.prepare("UPDATE app_state SET json_value = ? WHERE state_key = 'primary'").run(
      JSON.stringify(state),
    );
    db.close();

    await expect(makeEntrypoint(databasePath).run('PLAN')).resolves.toMatchObject({
      status: 'PLAN_BLOCKED',
      reasonCode: 'GOLDEN_IDENTITY_MISMATCH',
    });
  });

  it('blocks project-count drift', async () => {
    const { databasePath } = makeV9Fixture();
    const db = new DatabaseSync(databasePath);
    const row = db
      .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
      .get() as {
      json_value: string;
    };
    const state = JSON.parse(row.json_value) as { projects: Array<Record<string, unknown>> };
    state.projects.splice(0, 1);
    db.prepare("UPDATE app_state SET json_value = ? WHERE state_key = 'primary'").run(
      JSON.stringify(state),
    );
    db.close();
    const outcome = await makeEntrypoint(databasePath).run('PLAN');
    expect(outcome.reasonCode).toBe('PROJECT_COUNT_MISMATCH');
  });

  it('blocks a foreign-key violation', async () => {
    const { databasePath } = makeV9Fixture();
    const db = new DatabaseSync(databasePath);
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(
      'CREATE TABLE guard_fk_child (id TEXT PRIMARY KEY, review_id TEXT REFERENCES project_review_items(id))',
    );
    db.prepare('INSERT INTO guard_fk_child (id, review_id) VALUES (?, ?)').run('bad', 'missing');
    db.close();
    const outcome = await makeEntrypoint(databasePath).run('PLAN');
    expect(outcome.reasonCode).toBe('FOREIGN_KEY_CHECK_FAILED');
  });

  it('blocks a non-canonical database path before opening it', async () => {
    const { root, databasePath } = makeV9Fixture();
    const wrongPath = path.join(root, 'wrong.sqlite');
    const outcome = await createLiveV9V10MigrationEntrypoint({
      databasePath: wrongPath,
      expectedDatabasePath: databasePath,
    }).run('PLAN');

    expect(outcome).toMatchObject({
      status: 'PLAN_BLOCKED',
      reasonCode: 'INVALID_DATABASE_PATH',
    });
    expect(existsSync(wrongPath)).toBe(false);
  });

  it('blocks an unresolved migration journal attempt', async () => {
    const { root, databasePath } = makeV9Fixture();
    await createUnresolvedJournal(root, databasePath);

    await expect(makeEntrypoint(databasePath).run('PLAN')).resolves.toMatchObject({
      status: 'JOURNAL_BLOCKED',
      reasonCode: 'UNRESOLVED_MIGRATION_ATTEMPT',
    });
  });

  it('blocks a corrupt migration journal attempt', async () => {
    const { root, databasePath } = makeV9Fixture();
    await createUnresolvedJournal(root, databasePath);
    const journalFile = readdirSync(path.join(root, 'journal')).find((name) =>
      name.endsWith('.jsonl'),
    );
    expect(journalFile).toBeTruthy();
    appendFileSync(path.join(root, 'journal', journalFile!), '{corrupt\n');

    await expect(makeEntrypoint(databasePath).run('PLAN')).resolves.toMatchObject({
      status: 'JOURNAL_BLOCKED',
      reasonCode: 'UNRESOLVED_MIGRATION_ATTEMPT',
    });
  });

  it('blocks backup manifest mismatch before source mutation', async () => {
    const { databasePath } = makeV9Fixture();
    const corruptingBackup: LiveV9V10FactoryOptions['backupFunction'] = async (
      source,
      destination,
      options,
    ) => {
      const pages = await backup(source, destination, options);
      const copied = new DatabaseSync(destination);
      const row = copied
        .prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'")
        .get() as { json_value: string };
      const state = JSON.parse(row.json_value) as { projects: Array<Record<string, unknown>> };
      state.projects.pop();
      copied
        .prepare("UPDATE app_state SET json_value = ? WHERE state_key = 'primary'")
        .run(JSON.stringify(state));
      copied.close();
      return pages;
    };

    const outcome = await makeEntrypoint(databasePath, {
      backupFunction: corruptingBackup,
    }).run('APPLY');
    expect(outcome.status).toBe('BACKUP_FAILED');
    expect(readVersion(databasePath)).toBe(9);
    const db = new DatabaseSync(databasePath, { readOnly: true });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id = ?')
        .get(PRODUCTION_V10_MIGRATION_ID),
    ).toEqual({ count: 0 });
    db.close();
  });

  it('aborts when the source changes after the backup is verified', async () => {
    const { databasePath } = makeV9Fixture();
    const outcome = await makeEntrypoint(databasePath, {
      afterBackupVerifiedForTest(db) {
        db.prepare('UPDATE project_review_items SET description = ? WHERE id = ?').run(
          'Changed by a non-cooperating writer',
          CONTROLLED_LEGACY_REVIEW_IDS[0],
        );
      },
    }).run('APPLY');

    expect(outcome).toMatchObject({
      status: 'SOURCE_CHANGED_AFTER_BACKUP',
      reasonCode: 'SOURCE_CHANGED_AFTER_BACKUP',
    });
    expect(outcome.backupId).toBeTruthy();
    expect(readVersion(databasePath)).toBe(9);
    const db = new DatabaseSync(databasePath, { readOnly: true });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id = ?')
        .get(PRODUCTION_V10_MIGRATION_ID),
    ).toEqual({ count: 0 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM pragma_table_info('project_review_items') WHERE name = 'origin'",
        )
        .get(),
    ).toEqual({ count: 0 });
    db.close();
  });

  it('rolls back a simulated migration failure and preserves the verified backup', async () => {
    const { root, databasePath } = makeV9Fixture();
    const migrations: MigrationDefinition[] = PRODUCTION_MIGRATIONS.map((migration) =>
      migration.id === PRODUCTION_V10_MIGRATION_ID
        ? {
            ...migration,
            up(context) {
              context.database.exec('CREATE TABLE should_rollback (id TEXT PRIMARY KEY)');
              throw new Error('simulated migration failure');
            },
          }
        : migration,
    );

    const outcome = await makeEntrypoint(databasePath, { migrations }).run('APPLY');

    expect(outcome.status).toBe('MIGRATION_FAILED_ROLLED_BACK');
    expect(readVersion(databasePath)).toBe(9);
    expect(outcome.backupId).toBeTruthy();
    expect(existsSync(path.join(root, 'backups', outcome.backupId!, 'database.sqlite'))).toBe(true);
    const db = new DatabaseSync(databasePath, { readOnly: true });
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'")
        .get(),
    ).toBeUndefined();
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id = ?')
        .get(PRODUCTION_V10_MIGRATION_ID),
    ).toEqual({ count: 0 });
    db.close();
  });

  it('does not claim rollback when post-failure history contradicts schema v9', async () => {
    const { databasePath } = makeV9Fixture();
    const v10 = PRODUCTION_MIGRATIONS.find(
      (migration) => migration.id === PRODUCTION_V10_MIGRATION_ID,
    )!;
    const migrations: MigrationDefinition[] = PRODUCTION_MIGRATIONS.map((migration) =>
      migration.id === PRODUCTION_V10_MIGRATION_ID
        ? {
            ...migration,
            up() {
              throw new Error('simulated migration failure');
            },
          }
        : migration,
    );

    const outcome = await makeEntrypoint(databasePath, {
      migrations,
      afterMigrationFailureForTest(failedDatabasePath) {
        const db = new DatabaseSync(failedDatabasePath);
        try {
          db.prepare(
            `INSERT INTO schema_migrations (
               migration_id, from_version, to_version, checksum, description, app_version,
               backup_id, started_at, completed_at, duration_ms, validation_result
             ) VALUES (?, 9, 10, ?, ?, 'test', 'contradictory', ?, ?, 0, 'passed')`,
          ).run(v10.id, v10.checksum, v10.description, timestamp, timestamp);
        } finally {
          db.close();
        }
      },
    }).run('APPLY');

    expect(outcome).toMatchObject({
      status: 'MIGRATION_STATE_AMBIGUOUS',
      reasonCode: 'MIGRATION_STATE_AMBIGUOUS',
    });
    expect(readVersion(databasePath)).toBe(9);
  });

  it('detects post-migration corruption in previously omitted Review fields', async () => {
    const { root, databasePath } = makeV9Fixture();
    const migrations: MigrationDefinition[] = PRODUCTION_MIGRATIONS.map((migration) =>
      migration.id === PRODUCTION_V10_MIGRATION_ID
        ? {
            ...migration,
            up(context) {
              migration.up(context);
              context.database
                .prepare(
                  'UPDATE project_review_items SET description = ?, source_id = ? WHERE id = ?',
                )
                .run(
                  'Unexpected review mutation',
                  'unexpected-source',
                  CONTROLLED_LEGACY_REVIEW_IDS[0],
                );
            },
          }
        : migration,
    );

    const outcome = await makeEntrypoint(databasePath, { migrations }).run('APPLY');

    expect(outcome.status).toBe('POST_MIGRATION_VERIFICATION_FAILED');
    expect(readVersion(databasePath)).toBe(10);
    expect(outcome.backupId).toBeTruthy();
    expect(existsSync(path.join(root, 'backups', outcome.backupId!, 'database.sqlite'))).toBe(true);
  });

  it('blocks pending restore markers without running restore authority', async () => {
    const { root, databasePath } = makeV9Fixture();
    const marker = path.join(root, 'restore-pending.json');
    const markerDb = new DatabaseSync(databasePath);
    markerDb.close();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(marker, JSON.stringify({ version: 1, backupId: randomUUID() }));
    const outcome = await makeEntrypoint(databasePath).run('PLAN');
    expect(outcome.status).toBe('RESTORE_PENDING');
    expect(existsSync(marker)).toBe(true);
    expect(readVersion(databasePath)).toBe(9);
  });

  it('refuses APPLY when the canonical startup lock is held', async () => {
    const { databasePath } = makeV9Fixture();
    const heldLock = new DatabaseStartupLock({ busyTimeoutMs: 10 });
    const lease = heldLock.acquire(databasePath);
    try {
      const outcome = await makeEntrypoint(databasePath, {
        lock: new DatabaseStartupLock({ busyTimeoutMs: 10 }),
      }).run('APPLY');
      expect(outcome.status).toBe('LOCK_UNAVAILABLE');
      expect(readVersion(databasePath)).toBe(9);
    } finally {
      lease.release();
    }
  });

  it('does not seed fixture roots or start normal runtime behavior', async () => {
    const { databasePath } = makeV9Fixture();
    const outcome = await makeEntrypoint(databasePath).run('APPLY');
    expect(outcome.status).toBe('MIGRATION_APPLIED_AND_VERIFIED');
    const db = new DatabaseSync(databasePath, { readOnly: true });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM project_review_items WHERE reference LIKE 'G-CMT-%'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(readdirSync(path.dirname(databasePath))).not.toContain('golden-uat-manifest.json');
    db.close();
  });
});
