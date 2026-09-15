import {
  copyFileSync,
  existsSync,
  mkdirSync,
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
  PRODUCTION_MIGRATIONS,
  PRODUCTION_SCHEMA_TARGET_VERSION,
  PRODUCTION_V19_MIGRATION_ID,
} from '../../infrastructure/migration/registry/production-migration-registry';
import {
  CONTROLLED_GOLDEN_MARKER,
  CONTROLLED_GOLDEN_PROJECT_CODE,
  CONTROLLED_GOLDEN_PROJECT_ID,
  CONTROLLED_GOLDEN_PROJECT_NAME,
  CONTROLLED_LEGACY_REVIEW_IDS,
} from '../../infrastructure/migration/live-v9-v10/LiveV9V10PreservationManifest';
import {
  assertGoldenCommentsApplyIntent,
  parseGoldenCommentsReconciliationCliArgs,
  resolveCanonicalGoldenCommentsDatabasePath,
} from '../../scripts/golden-comments-reconciliation-cli';
import { GOLDEN_COMMENT_IDS, GOLDEN_COMMENT_REFERENCES } from '../golden-comments-graph-builder';
import {
  CONTROLLED_LEGACY_REVIEW_ACTIVITY_IDS,
  GOLDEN_COMMENTS_RECONCILIATION_ID,
  GOLDEN_COMMENTS_TARGETS,
  assertExactTargetCommentsManifest,
  buildGoldenCommentsManifest,
  buildPreservedDomainManifest,
  isExactLegacyCommentsBaseline,
  manifestsEqual,
} from './golden-comments-reconciliation-manifest';
import { createGoldenCommentsReconciliationEntrypoint } from './GoldenCommentsReconciliationEntrypoint';

const roots: string[] = [];
const timestamp = '2026-08-11T08:00:00.000Z';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

function applyCurrentProductionSchema(db: DatabaseSync): void {
  createHistoryTable(db);
  for (const migration of PRODUCTION_MIGRATIONS) {
    db.exec(
      migration.foreignKeyMode === 'DISABLED_DURING_MIGRATION'
        ? 'PRAGMA foreign_keys = OFF'
        : 'PRAGMA foreign_keys = ON',
    );
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
      db.exec('PRAGMA foreign_keys = ON');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function controlledProjects(): Array<Record<string, unknown>> {
  return [
    {
      id: '0f4daaad-95a2-4199-b237-0920729dc82a',
      projectCode: '001_SCT260809_TEST',
      projectName: 'MY BEST TEST PROJECT',
      crmReference: null,
      status: 'InProgress',
      actualHours: 10.23,
    },
    {
      id: '13dc93eb-9e38-4e73-b3e4-e0c9a03870b5',
      projectCode: '002_SCT260809_TIMER_SWITCH_TEST_B',
      projectName: 'TIMER SWITCH TEST B',
      crmReference: null,
      status: 'InProgress',
      actualHours: 0.02,
    },
    {
      id: '8860f8b8-2805-43fc-b12a-82992b9fd01c',
      projectCode: '003_SCT260809_SSS',
      projectName: 'sss',
      crmReference: null,
      status: 'Planning',
      actualHours: 0.01,
    },
    {
      id: CONTROLLED_GOLDEN_PROJECT_ID,
      projectCode: CONTROLLED_GOLDEN_PROJECT_CODE,
      projectName: CONTROLLED_GOLDEN_PROJECT_NAME,
      crmReference: CONTROLLED_GOLDEN_MARKER,
      status: 'InProgress',
      actualHours: 4.38,
    },
  ];
}

function insertReview(
  db: DatabaseSync,
  id: string,
  reference: string,
  status = 'Open',
  fields: Partial<{
    projectId: string;
    title: string;
    description: string;
    area: string;
    luminaireTag: string;
    drawingReference: string;
    sourceType: string;
    response: string;
    receivedAt: string;
    dueDate: string | null;
    createdAt: string;
  }> = {},
): void {
  const values = {
    projectId: fields.projectId ?? CONTROLLED_GOLDEN_PROJECT_ID,
    title: fields.title ?? reference,
    description: fields.description ?? 'description',
    area: fields.area ?? 'Lobby',
    luminaireTag: fields.luminaireTag ?? 'DL01',
    drawingReference: fields.drawingReference ?? 'L-101',
    sourceType: fields.sourceType ?? 'Manual',
    response: fields.response ?? 'response',
    receivedAt: fields.receivedAt ?? '2026-07-24',
    dueDate: fields.dueDate ?? null,
    createdAt: fields.createdAt ?? timestamp,
  };
  db.prepare(
    `INSERT INTO project_review_items (
       id, project_id, reference, title, description, area, luminaire_tag,
       drawing_reference, source_type, source_id, status, response, revision_id,
       received_at, due_date, created_at, updated_at,
       origin, author_id, author_name_snapshot, author_role_snapshot, luminaire_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?,
               NULL, NULL, NULL, NULL, NULL)`,
  ).run(
    id,
    values.projectId,
    reference,
    values.title,
    values.description,
    values.area,
    values.luminaireTag,
    values.drawingReference,
    values.sourceType,
    status,
    values.response,
    values.receivedAt,
    values.dueDate,
    values.createdAt,
    values.createdAt,
  );
}

function insertDocument(db: DatabaseSync, id: string, documentNumber: string): void {
  db.prepare(
    `INSERT INTO project_documents (
       id, project_id, category, document_number, title, revision, status, file_path,
       issued_to, issue_date, notes, created_at, updated_at
     ) VALUES (?, ?, 'Drawing', ?, ?, 'REV_01', 'Working', ?, 'Internal', NULL, '', ?, ?)`,
  ).run(
    id,
    CONTROLLED_GOLDEN_PROJECT_ID,
    documentNumber,
    documentNumber,
    `${documentNumber}.fixture`,
    timestamp,
    timestamp,
  );
}

function insertLuminaire(db: DatabaseSync, id: string, tag: string): void {
  db.prepare(
    `INSERT INTO project_luminaires (
       id, project_id, tag, category, image_path, description, manufacturer, model,
       wattage, lumens, light_color, cri, beam_angle, ip_rating, mounting, cutout,
       driver, control, emergency, datasheet_path, location, unit, quantity, notes,
       source_name, dimensions, body_color_finish, created_at, updated_at
     ) VALUES (?, ?, ?, 'Fixture', '', ?, 'Maker', 'Model', '8W', '800', '3000K', '90',
               '36', 'IP44', 'Recessed', '75', 'Remote', 'DALI', 'No', '', 'Lobby',
               'No.', 1, '', 'Fixture', '', 'White', ?, ?)`,
  ).run(id, CONTROLLED_GOLDEN_PROJECT_ID, tag, tag, timestamp, timestamp);
}

function seedControlledV10Baseline(db: DatabaseSync): void {
  const state = {
    users: [],
    projects: controlledProjects(),
    activities: [],
    comments: [],
    notifications: [],
    settings: {},
    lastSequence: 4,
  };
  db.prepare('INSERT INTO app_state (state_key, json_value, updated_at) VALUES (?, ?, ?)').run(
    'primary',
    JSON.stringify(state),
    timestamp,
  );
  db.prepare(
    `INSERT INTO project_workspaces
     (project_id, folder_path, folder_profile, services_json, input_mode, created_at, updated_at)
     VALUES (?, 'C:\\Golden', 'Lighting Design Project', '[]', 'DIALux', ?, ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp);

  const legacyTimestamp = '2026-08-15T19:08:49.587Z';
  insertReview(db, CONTROLLED_LEGACY_REVIEW_IDS[0], 'R-03', 'Resolved', {
    title: 'Lobby brightness',
    description: 'Client confirmed lobby brightness is acceptable.',
    area: 'Lobby',
    luminaireTag: 'DL01',
    drawingReference: 'L-101',
    sourceType: 'Meeting',
    response: 'Confirmed at concept review.',
    receivedAt: '2026-07-24',
    dueDate: null,
    createdAt: legacyTimestamp,
  });
  insertReview(db, CONTROLLED_LEGACY_REVIEW_IDS[1], 'R-01', 'Open', {
    title: 'Guest room CCT to 3000K',
    description: 'Client requested guest room CCT changed to 3000K.',
    area: 'Guest Rooms',
    luminaireTag: 'DL01',
    drawingReference: 'L-102',
    sourceType: 'Email',
    response: '',
    receivedAt: '2026-07-24',
    dueDate: '2026-08-13',
    createdAt: legacyTimestamp,
  });
  insertReview(db, CONTROLLED_LEGACY_REVIEW_IDS[2], 'R-02', 'InProgress', {
    title: 'Update WL01 datasheet',
    description: 'Internal note to update the WL01 datasheet with the latest revision.',
    area: 'Façade',
    luminaireTag: 'WL01',
    drawingReference: 'L-110',
    sourceType: 'Manual',
    response: 'Datasheet requested from manufacturer.',
    receivedAt: '2026-08-04',
    dueDate: '2026-08-13',
    createdAt: legacyTimestamp,
  });
  const mappings = [
    [CONTROLLED_LEGACY_REVIEW_ACTIVITY_IDS[0], CONTROLLED_LEGACY_REVIEW_IDS[0]],
    [CONTROLLED_LEGACY_REVIEW_ACTIVITY_IDS[1], CONTROLLED_LEGACY_REVIEW_IDS[2]],
    [CONTROLLED_LEGACY_REVIEW_ACTIVITY_IDS[2], CONTROLLED_LEGACY_REVIEW_IDS[1]],
  ] as const;
  for (const [activityId, reviewId] of mappings) {
    db.prepare(
      `INSERT INTO workspace_activity
       (id, project_id, entity_type, entity_id, action, title, detail, created_at)
       VALUES (?, ?, 'Review', ?, 'Created', 'Legacy Review', '', ?)`,
    ).run(activityId, CONTROLLED_GOLDEN_PROJECT_ID, reviewId, timestamp);
  }
  db.prepare(
    `INSERT INTO project_revisions (
       id, project_id, revision_number, title, status, received_at, due_date, issued_at,
       summary, change_log, source_type, source_reference, created_at, updated_at
     ) VALUES (?, ?, 2, 'REV02 — Current', 'InProgress', NULL, NULL, NULL, '', '',
               'Manual', '', ?, ?)`,
  ).run(GOLDEN_COMMENTS_TARGETS.revision.id, CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp);
  insertLuminaire(db, GOLDEN_COMMENTS_TARGETS.downlight.id, 'DL01');
  insertLuminaire(db, GOLDEN_COMMENTS_TARGETS.wallWasher.id, 'WL01');
  insertDocument(db, GOLDEN_COMMENTS_TARGETS.drawing.id, 'L-101');
  insertDocument(db, GOLDEN_COMMENTS_TARGETS.minutes.id, 'MM-01');

  db.prepare(
    `INSERT INTO project_meetings (
       id, project_id, title, start_at, end_at, location, attendees_json, agenda, notes,
       decisions, online_meeting_url, external_event_id, status, created_at, updated_at
     ) VALUES ('meeting-preserved', ?, 'Preserved', ?, ?, '', '[]', '', '', '', '', NULL,
               'Held', ?, ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp, timestamp, timestamp);
  db.prepare(
    `INSERT INTO project_actions (
       id, project_id, title, details, owner, due_date, status, priority, source_type,
       source_id, revision_id, completed_at, created_at, updated_at
     ) VALUES ('action-preserved', ?, 'Preserved', '', 'Owner', NULL, 'Open', 'High',
               'Manual', NULL, NULL, NULL, ?, ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp);
  db.prepare(
    `INSERT INTO project_contacts
     (id, project_id, name, email, company, role, created_at, updated_at)
     VALUES ('contact-preserved', ?, 'Client', 'client@example.test', 'SCT', 'Client', ?, ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, timestamp, timestamp);
  db.prepare(
    `INSERT INTO workspace_activity
     (id, project_id, entity_type, entity_id, action, title, detail, created_at)
     VALUES ('activity-preserved', ?, 'Project', ?, 'Updated', 'Preserved', '', ?)`,
  ).run(CONTROLLED_GOLDEN_PROJECT_ID, CONTROLLED_GOLDEN_PROJECT_ID, timestamp);
  insertReview(db, 'other-project-review', 'OTHER-R-01', 'Open', {
    projectId: '0f4daaad-95a2-4199-b237-0920729dc82a',
  });
  db.prepare(
    `INSERT INTO workspace_activity
     (id, project_id, entity_type, entity_id, action, title, detail, created_at)
     VALUES ('other-project-review-activity', ?, 'Review', 'other-project-review',
             'Created', 'Other project Review', '', ?)`,
  ).run('0f4daaad-95a2-4199-b237-0920729dc82a', timestamp);
}

function makeFixture(relativeDatabasePath = 'scli-workspace.sqlite'): {
  root: string;
  databasePath: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'golden-comments-reconcile-'));
  roots.push(root);
  const databasePath = path.join(root, relativeDatabasePath);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    applyCurrentProductionSchema(db);
    seedControlledV10Baseline(db);
  } finally {
    db.close();
  }
  return { root, databasePath };
}

function entrypoint(
  databasePath: string,
  overrides: Partial<Parameters<typeof createGoldenCommentsReconciliationEntrypoint>[0]> = {},
) {
  return createGoldenCommentsReconciliationEntrypoint({
    databasePath,
    expectedDatabasePath: databasePath,
    backupIdGenerator: { generate: () => 'c0000000-0000-4000-8000-000000000001' },
    clock: { now: () => new Date(timestamp) },
    ...overrides,
  });
}

function mutate(databasePath: string, operation: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    operation(db);
  } finally {
    db.close();
  }
}

function readComments(databasePath: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return buildGoldenCommentsManifest(db);
  } finally {
    db.close();
  }
}

describe('Golden Comments reconciliation CLI', () => {
  it('defaults to PLAN and requires the exact APPLY token', () => {
    expect(parseGoldenCommentsReconciliationCliArgs(['--db', 'C:\\temp\\db.sqlite']).mode).toBe(
      'PLAN',
    );
    const apply = parseGoldenCommentsReconciliationCliArgs([
      '--mode=apply',
      '--db',
      'C:\\temp\\db.sqlite',
      `--confirm=${GOLDEN_COMMENTS_RECONCILIATION_ID}`,
    ]);
    expect(() => assertGoldenCommentsApplyIntent(apply)).not.toThrow();
    expect(() =>
      assertGoldenCommentsApplyIntent(
        parseGoldenCommentsReconciliationCliArgs([
          '--mode=apply',
          '--db',
          'C:\\temp\\db.sqlite',
          '--confirm=wrong',
        ]),
      ),
    ).toThrow(/No database was opened/);
  });

  it('derives the production path from OS user-profile authority and rejects APPDATA redirection', async () => {
    const relativeCanonicalPath = path.join(
      'AppData',
      'Roaming',
      'scli-lighting-project-workspace',
      'Workspace Data',
      'scli-workspace.sqlite',
    );
    const { root, databasePath } = makeFixture(relativeCanonicalPath);
    const attackerAppData = path.join(root, 'attacker-appdata');
    const attackerDatabasePath = path.join(
      attackerAppData,
      'scli-lighting-project-workspace',
      'Workspace Data',
      'scli-workspace.sqlite',
    );
    mkdirSync(path.dirname(attackerDatabasePath), { recursive: true });
    copyFileSync(databasePath, attackerDatabasePath);
    const previousAppData = process.env.APPDATA;
    process.env.APPDATA = attackerAppData;
    try {
      const canonicalPath = resolveCanonicalGoldenCommentsDatabasePath(root);
      expect(canonicalPath).toBe(databasePath);
      expect(
        await entrypoint(databasePath, { expectedDatabasePath: canonicalPath }).run('PLAN'),
      ).toMatchObject({
        status: 'PLAN_READY',
      });
      expect(
        await entrypoint(attackerDatabasePath, { expectedDatabasePath: canonicalPath }).run(
          'APPLY',
        ),
      ).toMatchObject({ status: 'APPLY_BLOCKED', reasonCode: 'INVALID_DATABASE_PATH' });
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previousAppData;
    }
  });
});

describe('Golden Comments reconciliation PLAN guards', () => {
  it('returns PLAN_READY without source, backup, or journal mutation', async () => {
    const { root, databasePath } = makeFixture();
    const before = readComments(databasePath);
    const result = await entrypoint(databasePath).run('PLAN');
    expect(result.status).toBe('PLAN_READY');
    expect(result.readiness).toMatchObject({
      schemaVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
      projectCount: 4,
      replyCount: 0,
      attachmentCount: 0,
    });
    expect(readComments(databasePath)).toEqual(before);
    expect(existsSync(path.join(root, 'backups'))).toBe(false);
    expect(existsSync(path.join(root, 'journal'))).toBe(false);
  });

  it.each([
    ['wrong schema', (db: DatabaseSync) => db.exec('PRAGMA user_version = 9'), 'WRONG_SCHEMA'],
    [
      'missing migration prefix',
      (db: DatabaseSync) => {
        const firstMigration = PRODUCTION_MIGRATIONS[0]!;
        db.prepare('DELETE FROM schema_migrations WHERE migration_id = ?').run(firstMigration.id);
      },
      'MIGRATION_HISTORY_MISMATCH',
    ],
    [
      'contradictory extra history row',
      (db: DatabaseSync) => {
        db.prepare(
          `INSERT INTO schema_migrations (
             migration_id, from_version, to_version, checksum, description, app_version,
             backup_id, started_at, completed_at, duration_ms, validation_result
           ) VALUES ('contradictory-current-next', ${PRODUCTION_SCHEMA_TARGET_VERSION}, ${PRODUCTION_SCHEMA_TARGET_VERSION + 1},
                     'wrong', 'wrong', 'test', 'fixture',
                     ?, ?, 0, 'passed')`,
        ).run(timestamp, timestamp);
      },
      'MIGRATION_HISTORY_MISMATCH',
    ],
    [
      'wrong latest migration identity',
      (db: DatabaseSync) => {
        db.prepare('UPDATE schema_migrations SET migration_id = ? WHERE migration_id = ?').run(
          'wrong-production-current-authority',
          PRODUCTION_V19_MIGRATION_ID,
        );
      },
      'MIGRATION_HISTORY_MISMATCH',
    ],
    [
      'duplicate target row in malformed history',
      (db: DatabaseSync) => {
        db.exec(`
          ALTER TABLE schema_migrations RENAME TO schema_migrations_canonical;
          CREATE TABLE schema_migrations AS SELECT * FROM schema_migrations_canonical;
          INSERT INTO schema_migrations
          SELECT * FROM schema_migrations_canonical
          WHERE migration_id = '${PRODUCTION_V19_MIGRATION_ID}';
          DROP TABLE schema_migrations_canonical;
        `);
      },
      'MIGRATION_HISTORY_MISMATCH',
    ],
    [
      'missing required Comments table',
      (db: DatabaseSync) => db.exec('DROP TABLE project_review_attachments'),
      'WRONG_SCHEMA',
    ],
    [
      'missing required Comments column',
      (db: DatabaseSync) =>
        db.exec(
          'ALTER TABLE project_review_items RENAME COLUMN luminaire_id TO missing_luminaire_id',
        ),
      'WRONG_SCHEMA',
    ],
    [
      'wrong Golden',
      (db: DatabaseSync) => {
        const row = db
          .prepare('SELECT json_value FROM app_state WHERE state_key = ?')
          .get('primary') as {
          json_value: string;
        };
        const state = JSON.parse(row.json_value) as { projects: Array<Record<string, unknown>> };
        state.projects[3]!.crmReference = 'WRONG';
        db.prepare('UPDATE app_state SET json_value = ? WHERE state_key = ?').run(
          JSON.stringify(state),
          'primary',
        );
      },
      'GOLDEN_IDENTITY_MISMATCH',
    ],
    [
      'extra root',
      (db: DatabaseSync) => insertReview(db, 'extra-review', 'R-99'),
      'COMMENTS_BASELINE_MISMATCH',
    ],
    [
      'unexpected reply',
      (db: DatabaseSync) => {
        db.prepare(
          `INSERT INTO project_review_replies
           (id, project_id, review_item_id, body, author_id, author_name_snapshot,
            author_role_snapshot, origin, created_at, updated_at)
           VALUES ('extra-reply', ?, ?, 'body', 'author', 'Author', 'Role', 'Internal', ?, ?)`,
        ).run(CONTROLLED_GOLDEN_PROJECT_ID, CONTROLLED_LEGACY_REVIEW_IDS[0], timestamp, timestamp);
      },
      'COMMENTS_BASELINE_MISMATCH',
    ],
    [
      'unexpected attachment',
      (db: DatabaseSync) => {
        db.prepare(
          `INSERT INTO project_review_attachments
           (id, project_id, document_id, review_item_id, reply_id,
            created_by_id, created_by_name_snapshot, created_at)
           VALUES ('extra-attachment', ?, ?, ?, NULL, 'author', 'Author', ?)`,
        ).run(
          CONTROLLED_GOLDEN_PROJECT_ID,
          GOLDEN_COMMENTS_TARGETS.drawing.id,
          CONTROLLED_LEGACY_REVIEW_IDS[0],
          timestamp,
        );
      },
      'COMMENTS_BASELINE_MISMATCH',
    ],
    [
      'unexpected Comments activity',
      (db: DatabaseSync) => {
        db.prepare(
          `INSERT INTO workspace_activity
           (id, project_id, entity_type, entity_id, action, title, detail, created_at)
           VALUES ('extra-review-activity', ?, 'Review', ?, 'Created', 'Extra', '', ?)`,
        ).run(CONTROLLED_GOLDEN_PROJECT_ID, CONTROLLED_LEGACY_REVIEW_IDS[0], timestamp);
      },
      'COMMENTS_BASELINE_MISMATCH',
    ],
    [
      'partial fixture identity',
      (db: DatabaseSync) =>
        insertReview(db, GOLDEN_COMMENT_IDS.roots[0]!, GOLDEN_COMMENT_REFERENCES[0]),
      'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE',
    ],
    [
      'fixture identity in another project',
      (db: DatabaseSync) =>
        insertReview(db, GOLDEN_COMMENT_IDS.roots[0]!, GOLDEN_COMMENT_REFERENCES[0], 'Open', {
          projectId: '0f4daaad-95a2-4199-b237-0920729dc82a',
        }),
      'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE',
    ],
    [
      'target root identity in an unrelated domain table',
      (db: DatabaseSync) => {
        db.prepare('UPDATE project_actions SET id = ? WHERE id = ?').run(
          GOLDEN_COMMENT_IDS.roots[0]!,
          'action-preserved',
        );
      },
      'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE',
    ],
    [
      'target reply identity outside the reply table',
      (db: DatabaseSync) => {
        db.prepare('UPDATE project_contacts SET id = ? WHERE id = ?').run(
          GOLDEN_COMMENT_IDS.replies[0]!,
          'contact-preserved',
        );
      },
      'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE',
    ],
    [
      'target attachment identity in the wrong project and table',
      (db: DatabaseSync) => {
        db.prepare('UPDATE project_review_items SET id = ? WHERE id = ?').run(
          GOLDEN_COMMENT_IDS.attachments[0]!,
          'other-project-review',
        );
      },
      'PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE',
    ],
    [
      'missing required target',
      (db: DatabaseSync) => {
        db.prepare('DELETE FROM project_documents WHERE id = ?').run(
          GOLDEN_COMMENTS_TARGETS.minutes.id,
        );
      },
      'REQUIRED_TARGET_MISMATCH',
    ],
    [
      'ambiguous required target',
      (db: DatabaseSync) => insertDocument(db, 'duplicate-mm01', 'MM-01'),
      'REQUIRED_TARGET_MISMATCH',
    ],
  ])('blocks %s', async (_name, change, reasonCode) => {
    const { databasePath } = makeFixture();
    mutate(databasePath, change);
    const result = await entrypoint(databasePath).run('PLAN');
    expect(result.reasonCode).toBe(reasonCode);
    expect(result.status).not.toBe('PLAN_READY');
  });
});

describe('Golden Comments reconciliation APPLY', () => {
  it('creates a verified backup and atomically produces the exact graph', async () => {
    const { root, databasePath } = makeFixture();
    const beforeDb = new DatabaseSync(databasePath, { readOnly: true });
    const preservedBefore = buildPreservedDomainManifest(beforeDb);
    const workspaceUpdatedAtBefore = beforeDb
      .prepare('SELECT updated_at FROM project_workspaces WHERE project_id = ?')
      .get(CONTROLLED_GOLDEN_PROJECT_ID);
    const microsoftConnectionBefore = beforeDb
      .prepare('SELECT COUNT(*) AS count FROM microsoft_connection')
      .get();
    beforeDb.close();
    const first = await entrypoint(databasePath).run('APPLY');
    expect(first.status).toBe('RECONCILIATION_APPLIED_AND_VERIFIED');
    expect(first.backupId).toBe('c0000000-0000-4000-8000-000000000001');
    const target = readComments(databasePath);
    expect(() => assertExactTargetCommentsManifest(target)).not.toThrow();
    expect(target.roots).toHaveLength(4);
    expect(target.replies).toHaveLength(6);
    expect(target.attachments).toHaveLength(2);
    expect(target.activities).toHaveLength(12);
    expect(target.roots.filter((row) => row.origin === 'Client')).toHaveLength(2);
    expect(target.roots.filter((row) => row.origin === 'Internal')).toHaveLength(2);
    expect(target.roots.filter((row) => row.status === 'Resolved')).toHaveLength(1);
    expect(Math.ceil(target.roots.length / 3)).toBe(2);
    const afterDb = new DatabaseSync(databasePath, { readOnly: true });
    const preservedAfter = buildPreservedDomainManifest(afterDb);
    expect(
      afterDb
        .prepare('SELECT updated_at FROM project_workspaces WHERE project_id = ?')
        .get(CONTROLLED_GOLDEN_PROJECT_ID),
    ).toEqual(workspaceUpdatedAtBefore);
    expect(afterDb.prepare('SELECT COUNT(*) AS count FROM microsoft_connection').get()).toEqual(
      microsoftConnectionBefore,
    );
    expect(microsoftConnectionBefore).toEqual({ count: 0 });
    afterDb.close();
    expect(manifestsEqual(preservedBefore, preservedAfter)).toBe(true);
    const backupDir = path.join(root, 'backups', first.backupId!);
    expect(existsSync(path.join(backupDir, 'database.sqlite'))).toBe(true);
    expect(existsSync(path.join(backupDir, 'metadata.json'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(backupDir, 'metadata.json'), 'utf8'))).toMatchObject({
      status: 'verified',
      schemaVersion: PRODUCTION_SCHEMA_TARGET_VERSION,
      reason: 'GOLDEN_COMMENTS_EXACT_RECONCILIATION',
      migrationId: GOLDEN_COMMENTS_RECONCILIATION_ID,
      verification: { integrityCheck: 'ok', customPolicyChecked: true },
    });

    const backupsBeforeSecond = readdirSync(path.join(root, 'backups')).sort();
    const second = await entrypoint(databasePath, {
      backupIdGenerator: { generate: () => 'c0000000-0000-4000-8000-000000000002' },
    }).run('APPLY');
    expect(second.status).toBe('ALREADY_RECONCILED');
    expect(readdirSync(path.join(root, 'backups')).sort()).toEqual(backupsBeforeSecond);
  });

  it('does not classify a corrupted deterministic author identity as already reconciled', async () => {
    const { databasePath } = makeFixture();
    const applied = await entrypoint(databasePath).run('APPLY');
    expect(applied.status).toBe('RECONCILIATION_APPLIED_AND_VERIFIED');
    mutate(databasePath, (db) => {
      db.prepare('UPDATE project_review_items SET author_id = ? WHERE id = ?').run(
        'wrong-deterministic-author',
        GOLDEN_COMMENT_IDS.roots[0]!,
      );
    });

    const plan = await entrypoint(databasePath).run('PLAN');

    expect(plan.status).toBe('PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE');
    expect(plan.reasonCode).toBe('PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE');
  });

  it.each([
    [
      'root title',
      (db: DatabaseSync) =>
        db
          .prepare('UPDATE project_review_items SET title = ? WHERE id = ?')
          .run('Corrupted root title', GOLDEN_COMMENT_IDS.roots[0]!),
    ],
    [
      'reply body',
      (db: DatabaseSync) =>
        db
          .prepare('UPDATE project_review_replies SET body = ? WHERE id = ?')
          .run('Corrupted reply body', GOLDEN_COMMENT_IDS.replies[0]!),
    ],
    [
      'attachment creator snapshot',
      (db: DatabaseSync) =>
        db
          .prepare(
            'UPDATE project_review_attachments SET created_by_name_snapshot = ? WHERE id = ?',
          )
          .run('Corrupted creator', GOLDEN_COMMENT_IDS.attachments[0]!),
    ],
    [
      'activity detail',
      (db: DatabaseSync) =>
        db
          .prepare('UPDATE workspace_activity SET detail = ? WHERE id = ?')
          .run('Corrupted activity detail', GOLDEN_COMMENT_IDS.activities[0]!),
    ],
    [
      'per-ID activity type',
      (db: DatabaseSync) =>
        db
          .prepare('UPDATE workspace_activity SET entity_type = ? WHERE id = ?')
          .run('ReviewReply', GOLDEN_COMMENT_IDS.activities[0]!),
    ],
  ])(
    'does not classify a target with corrupted %s as already reconciled',
    async (_name, change) => {
      const { databasePath } = makeFixture();
      expect((await entrypoint(databasePath).run('APPLY')).status).toBe(
        'RECONCILIATION_APPLIED_AND_VERIFIED',
      );
      mutate(databasePath, change);

      const plan = await entrypoint(databasePath).run('PLAN');

      expect(plan.status).toBe('PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE');
      expect(plan.reasonCode).toBe('PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE');
    },
  );

  it('does not classify an exact target with an additional cross-domain identity as reconciled', async () => {
    const { databasePath } = makeFixture();
    expect((await entrypoint(databasePath).run('APPLY')).status).toBe(
      'RECONCILIATION_APPLIED_AND_VERIFIED',
    );
    mutate(databasePath, (db) => {
      db.prepare('UPDATE project_contacts SET id = ? WHERE id = ?').run(
        GOLDEN_COMMENT_IDS.roots[0]!,
        'contact-preserved',
      );
    });

    const plan = await entrypoint(databasePath).run('PLAN');

    expect(plan.status).toBe('PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE');
    expect(plan.reasonCode).toBe('PARTIAL_GOLDEN_COMMENTS_FIXTURE_STATE');
  });

  it('returns BACKUP_FAILED without source mutation', async () => {
    const { databasePath } = makeFixture();
    const before = readComments(databasePath);
    const result = await entrypoint(databasePath, {
      backupFunction: async () => {
        throw new Error('injected backup failure');
      },
    }).run('APPLY');
    expect(result.status).toBe('BACKUP_FAILED');
    expect(readComments(databasePath)).toEqual(before);
  });

  it('rejects a semantically mismatched backup without source mutation', async () => {
    const { databasePath } = makeFixture();
    const before = readComments(databasePath);
    const result = await entrypoint(databasePath, {
      backupFunction: async (source, destination, options) => {
        const pages = await backup(source, destination, options);
        mutate(destination, (db) => {
          db.prepare('UPDATE project_actions SET title = ? WHERE id = ?').run(
            'Backup mismatch',
            'action-preserved',
          );
        });
        return pages;
      },
    }).run('APPLY');
    expect(result.status).toBe('BACKUP_FAILED');
    expect(readComments(databasePath)).toEqual(before);
  });

  it('stops when the source changes after backup and never starts reconciliation', async () => {
    const { databasePath } = makeFixture();
    const result = await entrypoint(databasePath, {
      afterBackupVerifiedForTest: (db) => {
        db.prepare('UPDATE project_actions SET title = ? WHERE id = ?').run(
          'Changed after backup',
          'action-preserved',
        );
      },
    }).run('APPLY');
    expect(result.status).toBe('SOURCE_CHANGED_AFTER_BACKUP');
    expect(isExactLegacyCommentsBaseline(readComments(databasePath))).toBe(true);
  });

  it('rolls back legacy deletion when canonical fixture creation fails', async () => {
    const { databasePath } = makeFixture();
    const before = readComments(databasePath);
    const result = await entrypoint(databasePath, {
      beforeFixtureWriteForTest: () => {
        throw new Error('injected fixture failure');
      },
    }).run('APPLY');
    expect(result.status).toBe('RECONCILIATION_FAILED_ROLLED_BACK');
    expect(readComments(databasePath)).toEqual(before);
  });

  it('rolls back when a Comments writer path mutates a preserved workspace row', async () => {
    const { databasePath } = makeFixture();
    const result = await entrypoint(databasePath, {
      beforeFixtureWriteForTest: (db) => {
        db.prepare('UPDATE project_workspaces SET updated_at = ? WHERE project_id = ?').run(
          '2099-01-01T00:00:00.000Z',
          CONTROLLED_GOLDEN_PROJECT_ID,
        );
      },
    }).run('APPLY');

    expect(result.status).toBe('RECONCILIATION_FAILED_ROLLED_BACK');
    const db = new DatabaseSync(databasePath, { readOnly: true });
    expect(
      db
        .prepare('SELECT updated_at FROM project_workspaces WHERE project_id = ?')
        .get(CONTROLLED_GOLDEN_PROJECT_ID),
    ).toEqual({ updated_at: timestamp });
    db.close();
  });

  it('reports conservative post-commit verification failure without auto restore', async () => {
    const { databasePath } = makeFixture();
    const result = await entrypoint(databasePath, {
      afterCommitForTest: (sourcePath) => {
        mutate(sourcePath, (db) => {
          db.prepare('UPDATE project_actions SET title = ? WHERE id = ?').run(
            'Injected post-commit mismatch',
            'action-preserved',
          );
        });
      },
    }).run('APPLY');
    expect(result.status).toBe('POST_RECONCILIATION_VERIFICATION_FAILED');
    expect(() => assertExactTargetCommentsManifest(readComments(databasePath))).not.toThrow();
  });

  it('reports post-commit verification failure for one corrupted canonical Comments field', async () => {
    const { databasePath } = makeFixture();
    const result = await entrypoint(databasePath, {
      afterCommitForTest: (sourcePath) => {
        mutate(sourcePath, (db) => {
          db.prepare('UPDATE project_review_replies SET body = ? WHERE id = ?').run(
            'Post-commit corruption',
            GOLDEN_COMMENT_IDS.replies[0]!,
          );
        });
      },
    }).run('APPLY');

    expect(result.status).toBe('POST_RECONCILIATION_VERIFICATION_FAILED');
  });
});
