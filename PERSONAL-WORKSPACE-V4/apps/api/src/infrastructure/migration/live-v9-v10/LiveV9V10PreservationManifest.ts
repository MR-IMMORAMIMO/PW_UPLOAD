import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const CONTROLLED_GOLDEN_PROJECT_ID = '440bef8e-5799-4e96-87e9-5d617320b6a4' as const;
export const CONTROLLED_GOLDEN_PROJECT_CODE =
  '004_SCT260812_SCT_UAT_BOUTIQUE_HOTEL_LIGHTING_PACKAGE' as const;
export const CONTROLLED_GOLDEN_PROJECT_NAME = '[SCT UAT] Boutique Hotel Lighting Package' as const;
export const CONTROLLED_GOLDEN_MARKER = 'GOLDEN_UAT:BOUTIQUE_HOTEL_LIGHTING_PACKAGE' as const;
export const CONTROLLED_PROJECT_COUNT = 4 as const;
export const CONTROLLED_LEGACY_REVIEW_IDS = Object.freeze([
  '244f1dda-4d1e-4ab6-b37d-31441f5391f0',
  '906bbbeb-cefb-41f9-a291-5127a4a18841',
  'b406ea55-6b5c-4377-b7ad-b411426dfd27',
]) as readonly [string, string, string];

interface AppStateProject {
  readonly id: string;
  readonly projectCode: string;
  readonly projectName: string;
  readonly crmReference: string | null;
  readonly status: string | null;
  readonly actualHours: number | null;
  readonly recordSha256: string;
}

export interface GoldenReviewManifestRow {
  readonly id: string;
  readonly projectId: string;
  readonly reference: string;
  readonly title: string;
  readonly description: string;
  readonly area: string;
  readonly luminaireTag: string;
  readonly drawingReference: string;
  readonly status: string;
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly revisionId: string | null;
  readonly response: string;
  readonly receivedAt: string;
  readonly dueDate: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LiveV9V10PreservationManifest {
  readonly goldenProject: AppStateProject;
  readonly projects: readonly AppStateProject[];
  readonly testProjects: readonly AppStateProject[];
  readonly projectCount: number;
  readonly reviews: readonly GoldenReviewManifestRow[];
  readonly reviewActivityIds: readonly string[];
  readonly meetingIds: readonly string[];
  readonly actionIds: readonly string[];
  readonly revisionIds: readonly string[];
  readonly luminaireIds: readonly string[];
  readonly documentIds: readonly string[];
  readonly contactIds: readonly string[];
  readonly canonicalGoldenCommentCount: number;
  readonly replyCount: number;
  readonly attachmentCount: number;
}

export class PreservationManifestError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PreservationManifestError';
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = stableValue(record[key]);
  return sorted;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PreservationManifestError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PreservationManifestError(`${label}.${key} must be a non-empty string.`);
  }
  return value;
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new PreservationManifestError(`Project field ${key} must be a string or null.`);
  }
  return value;
}

function nullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PreservationManifestError(`Project field ${key} must be a finite number or null.`);
  }
  return value;
}

function readProjects(db: DatabaseSync): AppStateProject[] {
  const row = db.prepare("SELECT json_value FROM app_state WHERE state_key = 'primary'").get() as
    { json_value: string } | undefined;
  if (!row) throw new PreservationManifestError('The primary app_state row is missing.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.json_value) as unknown;
  } catch (error) {
    throw new PreservationManifestError('The primary app_state row is not valid JSON.', {
      cause: error,
    });
  }
  const state = asRecord(parsed, 'app_state.primary');
  const projects = state.projects;
  if (!Array.isArray(projects)) {
    throw new PreservationManifestError('app_state.primary.projects must be an array.');
  }

  return projects
    .map((value, index): AppStateProject => {
      const project = asRecord(value, `projects[${index}]`);
      return Object.freeze({
        id: requiredString(project, 'id', `projects[${index}]`),
        projectCode: requiredString(project, 'projectCode', `projects[${index}]`),
        projectName: requiredString(project, 'projectName', `projects[${index}]`),
        crmReference: nullableString(project, 'crmReference'),
        status: nullableString(project, 'status'),
        actualHours: nullableNumber(project, 'actualHours'),
        recordSha256: sha256(project),
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function readIds(db: DatabaseSync, table: string, projectId: string): string[] {
  const allowedTables = new Set([
    'project_meetings',
    'project_actions',
    'project_revisions',
    'project_luminaires',
    'project_documents',
    'project_contacts',
  ]);
  if (!allowedTables.has(table)) {
    throw new PreservationManifestError('Unsupported manifest table requested.');
  }
  const rows = db
    .prepare(`SELECT id FROM ${table} WHERE project_id = ? ORDER BY id`)
    .all(projectId) as {
    id: string;
  }[];
  return rows.map((row) => row.id);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined
  );
}

function countProjectRows(db: DatabaseSync, table: string, projectId: string): number {
  if (!tableExists(db, table)) return 0;
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`)
    .get(projectId) as {
    count: number;
  };
  return row.count;
}

function readReviews(db: DatabaseSync, projectId: string): GoldenReviewManifestRow[] {
  const rows = db
    .prepare(
      `SELECT id, reference, title, status, source_type, revision_id, luminaire_tag, response,
              project_id, description, area, drawing_reference, source_id,
              received_at, due_date, created_at, updated_at
         FROM project_review_items
        WHERE project_id = ?
        ORDER BY id`,
    )
    .all(projectId) as Array<{
    id: string;
    project_id: string;
    reference: string;
    title: string;
    description: string;
    area: string;
    luminaire_tag: string;
    drawing_reference: string;
    status: string;
    source_type: string;
    source_id: string | null;
    revision_id: string | null;
    response: string;
    received_at: string;
    due_date: string | null;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) =>
    Object.freeze({
      id: row.id,
      projectId: row.project_id,
      reference: row.reference,
      title: row.title,
      description: row.description,
      area: row.area,
      luminaireTag: row.luminaire_tag,
      drawingReference: row.drawing_reference,
      status: row.status,
      sourceType: row.source_type,
      sourceId: row.source_id,
      revisionId: row.revision_id,
      response: row.response,
      receivedAt: row.received_at,
      dueDate: row.due_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );
}

export function buildLiveV9V10PreservationManifest(
  db: DatabaseSync,
): LiveV9V10PreservationManifest {
  const projects = readProjects(db);
  const markerMatches = projects.filter(
    (project) => project.crmReference === CONTROLLED_GOLDEN_MARKER,
  );
  const uuidMatches = projects.filter((project) => project.id === CONTROLLED_GOLDEN_PROJECT_ID);
  if (
    uuidMatches.length !== 1 ||
    markerMatches.length !== 1 ||
    uuidMatches[0] !== markerMatches[0]
  ) {
    throw new PreservationManifestError('The controlled Golden project identity is not unique.');
  }
  const goldenProject = uuidMatches[0]!;

  const reviewActivityIds = (
    db
      .prepare(
        "SELECT id FROM workspace_activity WHERE project_id = ? AND entity_type = 'Review' ORDER BY id",
      )
      .all(goldenProject.id) as { id: string }[]
  ).map((row) => row.id);

  return Object.freeze({
    goldenProject,
    projects: Object.freeze(projects),
    testProjects: Object.freeze(
      projects.filter((project) =>
        `${project.projectCode} ${project.projectName}`.toUpperCase().includes('TEST'),
      ),
    ),
    projectCount: projects.length,
    reviews: Object.freeze(readReviews(db, goldenProject.id)),
    reviewActivityIds: Object.freeze(reviewActivityIds),
    meetingIds: Object.freeze(readIds(db, 'project_meetings', goldenProject.id)),
    actionIds: Object.freeze(readIds(db, 'project_actions', goldenProject.id)),
    revisionIds: Object.freeze(readIds(db, 'project_revisions', goldenProject.id)),
    luminaireIds: Object.freeze(readIds(db, 'project_luminaires', goldenProject.id)),
    documentIds: Object.freeze(readIds(db, 'project_documents', goldenProject.id)),
    contactIds: Object.freeze(readIds(db, 'project_contacts', goldenProject.id)),
    canonicalGoldenCommentCount: (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM project_review_items WHERE project_id = ? AND reference LIKE 'G-CMT-%'",
        )
        .get(goldenProject.id) as { count: number }
    ).count,
    replyCount: countProjectRows(db, 'project_review_replies', goldenProject.id),
    attachmentCount: countProjectRows(db, 'project_review_attachments', goldenProject.id),
  });
}

export function preservationManifestsEqual(
  left: LiveV9V10PreservationManifest,
  right: LiveV9V10PreservationManifest,
): boolean {
  return stableJson(left) === stableJson(right);
}

export function assertControlledPreMigrationManifest(
  manifest: LiveV9V10PreservationManifest,
): void {
  const project = manifest.goldenProject;
  if (
    project.id !== CONTROLLED_GOLDEN_PROJECT_ID ||
    project.projectCode !== CONTROLLED_GOLDEN_PROJECT_CODE ||
    project.projectName !== CONTROLLED_GOLDEN_PROJECT_NAME ||
    project.crmReference !== CONTROLLED_GOLDEN_MARKER
  ) {
    throw new PreservationManifestError('The controlled Golden project identity does not match.');
  }
  if (manifest.projectCount !== CONTROLLED_PROJECT_COUNT) {
    throw new PreservationManifestError('The controlled project-count baseline does not match.');
  }
  const reviewIds = manifest.reviews.map((review) => review.id);
  if (stableJson(reviewIds) !== stableJson(CONTROLLED_LEGACY_REVIEW_IDS)) {
    throw new PreservationManifestError('The controlled legacy Review root IDs do not match.');
  }
  if (manifest.reviewActivityIds.length !== 3) {
    throw new PreservationManifestError('The controlled Review activity count does not match.');
  }
  if (
    manifest.canonicalGoldenCommentCount !== 0 ||
    manifest.replyCount !== 0 ||
    manifest.attachmentCount !== 0
  ) {
    throw new PreservationManifestError('Canonical Comments data already exists unexpectedly.');
  }
}
