import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  GOLDEN_COMMENT_IDS,
  buildGoldenCommentsExpectedPersistence,
  goldenCommentActorSeeds,
} from '../golden-comments-graph-builder';
import { GOLDEN_UAT_DEFAULT_ANCHOR_DATE, buildAnchorContract } from '../golden-uat-types';
import {
  CONTROLLED_GOLDEN_MARKER,
  CONTROLLED_GOLDEN_PROJECT_CODE,
  CONTROLLED_GOLDEN_PROJECT_ID,
  CONTROLLED_GOLDEN_PROJECT_NAME,
  CONTROLLED_LEGACY_REVIEW_IDS,
} from '../../infrastructure/migration/live-v9-v10/LiveV9V10PreservationManifest';

export const GOLDEN_COMMENTS_RECONCILIATION_ID = 'golden-comments-exact-reconciliation' as const;
export const GOLDEN_COMMENTS_BACKUP_REASON = 'GOLDEN_COMMENTS_EXACT_RECONCILIATION' as const;

export const CONTROLLED_LEGACY_REVIEW_ACTIVITY_IDS = Object.freeze([
  '5cea3659-1483-4583-97c7-cb972eb6cb0b',
  'a6a3f5ab-3846-47fb-8613-f418686cdf60',
  'dd6b5d1b-825a-43d2-bcac-98f6970f7f1c',
] as const);

export const GOLDEN_COMMENTS_TARGETS = Object.freeze({
  revision: Object.freeze({ id: '9aee7ec3-87ec-4929-a674-0b0796a9a1dc', revisionNumber: 2 }),
  downlight: Object.freeze({ id: 'd4a39389-531a-44fd-ba8b-11575d24fa6b', tag: 'DL01' }),
  wallWasher: Object.freeze({ id: '55895b8a-3d9f-4b6d-9638-b541f97e9ee3', tag: 'WL01' }),
  drawing: Object.freeze({ id: '9ae9a945-34c4-4b68-a98e-1d5021a33b29', documentNumber: 'L-101' }),
  minutes: Object.freeze({ id: '244574c0-e68e-4577-a3d2-7b1debc13592', documentNumber: 'MM-01' }),
});

const COMMENTS_TABLES = new Set([
  'project_review_items',
  'project_review_replies',
  'project_review_attachments',
]);
const COMMENTS_ACTIVITY_TYPES = ['Review', 'ReviewReply', 'ReviewAttachment'] as const;

type Row = Record<string, unknown>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, stableValue(record[key])]),
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function sortedRows(rows: readonly Row[]): readonly Row[] {
  return Object.freeze(
    [...rows]
      .map((row) => Object.freeze({ ...row }))
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
  );
}

function readPrimaryState(db: DatabaseSync): Row {
  const row = db.prepare('SELECT json_value FROM app_state WHERE state_key = ?').get('primary') as
    { json_value?: unknown } | undefined;
  if (typeof row?.json_value !== 'string') throw new Error('The primary app_state row is missing.');
  const parsed = JSON.parse(row.json_value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The primary app_state row is invalid.');
  }
  return parsed as Row;
}

export interface GoldenIdentityManifest {
  readonly id: string;
  readonly projectCode: string;
  readonly projectName: string;
  readonly crmReference: string;
  readonly uuidCount: number;
  readonly markerCount: number;
  readonly projectCount: number;
}

export function readGoldenIdentity(db: DatabaseSync): GoldenIdentityManifest {
  const state = readPrimaryState(db);
  if (!Array.isArray(state.projects)) throw new Error('app_state.primary.projects is invalid.');
  const projects = state.projects as Row[];
  const uuidMatches = projects.filter((project) => project.id === CONTROLLED_GOLDEN_PROJECT_ID);
  const markerMatches = projects.filter(
    (project) => project.crmReference === CONTROLLED_GOLDEN_MARKER,
  );
  const project = uuidMatches[0];
  if (!project) throw new Error('The controlled Golden project UUID is missing.');
  return Object.freeze({
    id: String(project.id ?? ''),
    projectCode: String(project.projectCode ?? ''),
    projectName: String(project.projectName ?? ''),
    crmReference: String(project.crmReference ?? ''),
    uuidCount: uuidMatches.length,
    markerCount: markerMatches.length,
    projectCount: projects.length,
  });
}

export function isExactGoldenIdentity(identity: GoldenIdentityManifest): boolean {
  return (
    identity.uuidCount === 1 &&
    identity.markerCount === 1 &&
    identity.id === CONTROLLED_GOLDEN_PROJECT_ID &&
    identity.projectCode === CONTROLLED_GOLDEN_PROJECT_CODE &&
    identity.projectName === CONTROLLED_GOLDEN_PROJECT_NAME &&
    identity.crmReference === CONTROLLED_GOLDEN_MARKER &&
    identity.projectCount === 4
  );
}

export interface GoldenCommentsManifest {
  readonly roots: readonly Row[];
  readonly replies: readonly Row[];
  readonly attachments: readonly Row[];
  readonly activities: readonly Row[];
  readonly sha256: string;
}

export function buildGoldenCommentsManifest(db: DatabaseSync): GoldenCommentsManifest {
  const roots = sortedRows(
    db
      .prepare('SELECT * FROM project_review_items WHERE project_id = ?')
      .all(CONTROLLED_GOLDEN_PROJECT_ID) as Row[],
  );
  const replies = sortedRows(
    db
      .prepare('SELECT * FROM project_review_replies WHERE project_id = ?')
      .all(CONTROLLED_GOLDEN_PROJECT_ID) as Row[],
  );
  const attachments = sortedRows(
    db
      .prepare('SELECT * FROM project_review_attachments WHERE project_id = ?')
      .all(CONTROLLED_GOLDEN_PROJECT_ID) as Row[],
  );
  const activities = sortedRows(
    db
      .prepare(
        `SELECT * FROM workspace_activity
          WHERE project_id = ? AND entity_type IN (?, ?, ?)`,
      )
      .all(CONTROLLED_GOLDEN_PROJECT_ID, ...COMMENTS_ACTIVITY_TYPES) as Row[],
  );
  return Object.freeze({
    roots,
    replies,
    attachments,
    activities,
    sha256: sha256({ roots, replies, attachments, activities }),
  });
}

export interface PreservedDomainManifest {
  readonly tableCounts: Readonly<Record<string, number>>;
  readonly tableHashes: Readonly<Record<string, string>>;
  readonly sha256: string;
}

export function buildPreservedDomainManifest(db: DatabaseSync): PreservedDomainManifest {
  const tableNames = (
    db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
  const tableCounts: Record<string, number> = {};
  const tableHashes: Record<string, string> = {};
  for (const table of tableNames) {
    const rows = sortedRows(
      (COMMENTS_TABLES.has(table)
        ? db
            .prepare(`SELECT * FROM "${table}" WHERE project_id <> ?`)
            .all(CONTROLLED_GOLDEN_PROJECT_ID)
        : table === 'workspace_activity'
          ? db
              .prepare(
                `SELECT * FROM workspace_activity
                WHERE NOT (project_id = ? AND entity_type IN (?, ?, ?))`,
              )
              .all(CONTROLLED_GOLDEN_PROJECT_ID, ...COMMENTS_ACTIVITY_TYPES)
          : db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all()) as Row[],
    );
    tableCounts[table] = rows.length;
    tableHashes[table] = sha256(rows);
  }
  return Object.freeze({
    tableCounts: Object.freeze(tableCounts),
    tableHashes: Object.freeze(tableHashes),
    sha256: sha256({ tableCounts, tableHashes }),
  });
}

export function manifestsEqual(
  left: { readonly sha256: string },
  right: { readonly sha256: string },
): boolean {
  return left.sha256 === right.sha256;
}

function ids(rows: readonly Row[]): string[] {
  return rows.map((row) => String(row.id ?? '')).sort();
}

function exactIds(rows: readonly Row[], expected: readonly string[]): boolean {
  return stableJson(ids(rows)) === stableJson([...expected].sort());
}

export function isExactLegacyCommentsBaseline(manifest: GoldenCommentsManifest): boolean {
  if (
    !exactIds(manifest.roots, CONTROLLED_LEGACY_REVIEW_IDS) ||
    manifest.replies.length !== 0 ||
    manifest.attachments.length !== 0 ||
    !exactIds(manifest.activities, CONTROLLED_LEGACY_REVIEW_ACTIVITY_IDS)
  ) {
    return false;
  }
  const expectedRoots: Readonly<Record<string, Row>> = Object.freeze({
    '244f1dda-4d1e-4ab6-b37d-31441f5391f0': Object.freeze({
      reference: 'R-03',
      title: 'Lobby brightness',
      description: 'Client confirmed lobby brightness is acceptable.',
      area: 'Lobby',
      luminaire_tag: 'DL01',
      drawing_reference: 'L-101',
      source_type: 'Meeting',
      source_id: null,
      status: 'Resolved',
      response: 'Confirmed at concept review.',
      revision_id: null,
      received_at: '2026-07-24',
      due_date: null,
      created_at: '2026-08-15T19:08:49.587Z',
      updated_at: '2026-08-15T19:08:49.587Z',
    }),
    '906bbbeb-cefb-41f9-a291-5127a4a18841': Object.freeze({
      reference: 'R-01',
      title: 'Guest room CCT to 3000K',
      description: 'Client requested guest room CCT changed to 3000K.',
      area: 'Guest Rooms',
      luminaire_tag: 'DL01',
      drawing_reference: 'L-102',
      source_type: 'Email',
      source_id: null,
      status: 'Open',
      response: '',
      revision_id: null,
      received_at: '2026-07-24',
      due_date: '2026-08-13',
      created_at: '2026-08-15T19:08:49.587Z',
      updated_at: '2026-08-15T19:08:49.587Z',
    }),
    'b406ea55-6b5c-4377-b7ad-b411426dfd27': Object.freeze({
      reference: 'R-02',
      title: 'Update WL01 datasheet',
      description: 'Internal note to update the WL01 datasheet with the latest revision.',
      area: 'Façade',
      luminaire_tag: 'WL01',
      drawing_reference: 'L-110',
      source_type: 'Manual',
      source_id: null,
      status: 'InProgress',
      response: 'Datasheet requested from manufacturer.',
      revision_id: null,
      received_at: '2026-08-04',
      due_date: '2026-08-13',
      created_at: '2026-08-15T19:08:49.587Z',
      updated_at: '2026-08-15T19:08:49.587Z',
    }),
  });
  for (const root of manifest.roots) {
    const expected = expectedRoots[String(root.id ?? '')];
    if (!expected) return false;
    for (const [key, value] of Object.entries(expected)) {
      if (root[key] !== value) return false;
    }
    for (const key of [
      'origin',
      'author_id',
      'author_name_snapshot',
      'author_role_snapshot',
      'luminaire_id',
    ]) {
      if (root[key] !== null) return false;
    }
  }
  const expectedActivityEntity: Readonly<Record<string, string>> = Object.freeze({
    '5cea3659-1483-4583-97c7-cb972eb6cb0b': '244f1dda-4d1e-4ab6-b37d-31441f5391f0',
    'a6a3f5ab-3846-47fb-8613-f418686cdf60': 'b406ea55-6b5c-4377-b7ad-b411426dfd27',
    'dd6b5d1b-825a-43d2-bcac-98f6970f7f1c': '906bbbeb-cefb-41f9-a291-5127a4a18841',
  });
  return manifest.activities.every(
    (row) =>
      row.entity_type === 'Review' &&
      expectedActivityEntity[String(row.id ?? '')] === row.entity_id,
  );
}

export function hasAnyDeterministicFixtureIdentity(manifest: GoldenCommentsManifest): boolean {
  const expected = new Set<string>([
    ...GOLDEN_COMMENT_IDS.roots,
    ...GOLDEN_COMMENT_IDS.replies,
    ...GOLDEN_COMMENT_IDS.attachments,
    ...GOLDEN_COMMENT_IDS.activities,
  ]);
  return [
    ...manifest.roots,
    ...manifest.replies,
    ...manifest.attachments,
    ...manifest.activities,
  ].some((row) => expected.has(String(row.id ?? '')));
}

const TARGET_ROW_IDENTITIES = Object.freeze([
  ...GOLDEN_COMMENT_IDS.roots,
  ...GOLDEN_COMMENT_IDS.replies,
  ...GOLDEN_COMMENT_IDS.attachments,
  ...GOLDEN_COMMENT_IDS.activities,
]);

export interface DeterministicIdentityOccurrence {
  readonly id: string;
  readonly table: string;
  readonly projectId: string | null;
}

export function buildDeterministicIdentityOccurrences(
  db: DatabaseSync,
): readonly DeterministicIdentityOccurrence[] {
  const tables = (
    db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
  const occurrences: DeterministicIdentityOccurrence[] = [];
  const identityPlaceholders = TARGET_ROW_IDENTITIES.map(() => '?').join(', ');
  for (const table of tables) {
    const escapedTable = table.replaceAll('"', '""');
    const columns = new Set(
      (db.prepare(`PRAGMA table_info("${escapedTable}")`).all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
    if (!columns.has('id')) continue;
    const projectExpression = columns.has('project_id') ? 'project_id' : 'NULL';
    const rows = db
      .prepare(
        `SELECT id, ${projectExpression} AS project_id FROM "${escapedTable}"
          WHERE id IN (${identityPlaceholders})`,
      )
      .all(...TARGET_ROW_IDENTITIES) as Array<{ id: unknown; project_id: unknown }>;
    for (const row of rows) {
      occurrences.push(
        Object.freeze({
          id: String(row.id ?? ''),
          table,
          projectId: row.project_id === null ? null : String(row.project_id ?? ''),
        }),
      );
    }
  }
  return Object.freeze(
    occurrences.sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
  );
}

export function hasAnyDeterministicFixtureIdentityInDatabase(db: DatabaseSync): boolean {
  return buildDeterministicIdentityOccurrences(db).length !== 0;
}

function expectedTargetOccurrences(): readonly DeterministicIdentityOccurrence[] {
  const expected = [
    ...GOLDEN_COMMENT_IDS.roots.map((id) => ({
      id,
      table: 'project_review_items',
      projectId: CONTROLLED_GOLDEN_PROJECT_ID,
    })),
    ...GOLDEN_COMMENT_IDS.replies.map((id) => ({
      id,
      table: 'project_review_replies',
      projectId: CONTROLLED_GOLDEN_PROJECT_ID,
    })),
    ...GOLDEN_COMMENT_IDS.attachments.map((id) => ({
      id,
      table: 'project_review_attachments',
      projectId: CONTROLLED_GOLDEN_PROJECT_ID,
    })),
    ...GOLDEN_COMMENT_IDS.activities.map((id) => ({
      id,
      table: 'workspace_activity',
      projectId: CONTROLLED_GOLDEN_PROJECT_ID,
    })),
  ];
  return Object.freeze(
    expected.sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
  );
}

export function assertExactTargetDeterministicOccurrences(db: DatabaseSync): void {
  if (
    stableJson(buildDeterministicIdentityOccurrences(db)) !==
    stableJson(expectedTargetOccurrences())
  ) {
    throw new Error('The global deterministic Golden Comments identity occurrences are not exact.');
  }
}

function expectedTargetPersistence(): GoldenCommentsManifest {
  const contract = buildAnchorContract(GOLDEN_UAT_DEFAULT_ANCHOR_DATE);
  const expected = buildGoldenCommentsExpectedPersistence({
    projectId: CONTROLLED_GOLDEN_PROJECT_ID,
    contract,
    revision: GOLDEN_COMMENTS_TARGETS.revision,
    downlight: GOLDEN_COMMENTS_TARGETS.downlight,
    wallWasher: GOLDEN_COMMENTS_TARGETS.wallWasher,
    drawing: {
      ...GOLDEN_COMMENTS_TARGETS.drawing,
      projectId: CONTROLLED_GOLDEN_PROJECT_ID,
    },
    minutes: {
      ...GOLDEN_COMMENTS_TARGETS.minutes,
      projectId: CONTROLLED_GOLDEN_PROJECT_ID,
    },
    actors: goldenCommentActorSeeds(contract),
  });
  const roots = sortedRows(expected.roots);
  const replies = sortedRows(expected.replies);
  const attachments = sortedRows(expected.attachments);
  const activities = sortedRows(expected.activities);
  return Object.freeze({
    roots,
    replies,
    attachments,
    activities,
    sha256: sha256({ roots, replies, attachments, activities }),
  });
}

export function assertExactTargetCommentsManifest(manifest: GoldenCommentsManifest): void {
  const expected = expectedTargetPersistence();
  for (const key of ['roots', 'replies', 'attachments', 'activities'] as const) {
    if (stableJson(manifest[key]) !== stableJson(expected[key])) {
      throw new Error(`The canonical Golden Comments ${key} rows are not exact.`);
    }
  }
}

export function isExactTargetCommentsManifest(manifest: GoldenCommentsManifest): boolean {
  try {
    assertExactTargetCommentsManifest(manifest);
    return true;
  } catch {
    return false;
  }
}
