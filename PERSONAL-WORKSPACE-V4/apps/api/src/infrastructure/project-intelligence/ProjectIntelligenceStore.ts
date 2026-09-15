import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  DomainError,
  type ProjectSourceFile,
  type ProjectSourceFileType,
  type RevisionSourceFileBaseline,
} from '@scli/domain';
import {
  PRODUCTION_V28_TABLE_NAMES,
  type SchemaManagementMode,
  LEGACY_SELF_MANAGED,
  DEFAULT_SCHEMA_MANAGEMENT_MODE,
  verifyExternalSchemaReadiness,
} from '../migration/registry/production-migration-registry';

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  return String(row[key] ?? '');
}

function numberValue(row: Row, key: string): number {
  return Number(row[key] ?? 0);
}

export interface RegisterProjectSourceInput {
  projectId: string;
  sourceType: ProjectSourceFileType;
  displayName: string;
  /** Governed root-relative locator resolved inside the verified Project root. */
  originalRelativeLocator: string;
  sha256: string;
  sizeBytes: number;
  modifiedAt: string;
  now: string;
}

export interface UpdateSourceFingerprintInput {
  projectId: string;
  sourceId: string;
  sha256: string;
  sizeBytes: number;
  modifiedAt: string;
  checkedAt: string;
  expectedRowVersion: number;
}

/**
 * P5D — durable controlled-source authority (schema v28 tables:
 * project_source_files, revision_source_file_baselines).
 *
 * The store owns ONLY persistence. Source admission (picker handoff, path
 * validation, hashing) lives in ProjectSourceAdmission / ProjectIntelligenceService.
 * Baselines are append-only immutable evidence: capture never rewrites history.
 */
export class ProjectIntelligenceStore {
  public constructor(
    private readonly database: DatabaseSync,
    schemaManagementMode: SchemaManagementMode = DEFAULT_SCHEMA_MANAGEMENT_MODE,
  ) {
    this.database.exec('PRAGMA foreign_keys = ON');
    if (schemaManagementMode === LEGACY_SELF_MANAGED) {
      this.ensureSchema();
    } else {
      verifyExternalSchemaReadiness(database, 'PersonalWorkspaceStore');
    }
  }

  private ensureSchema(): void {
    if (
      this.database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'project_source_files'",
        )
        .get()
    ) {
      return;
    }
    // Self-managed mirror must stay semantically aligned with the production
    // 27 -> 28 migration. Kept local rather than importing the migration DDL
    // so the self-managed bootstrap can never be confused with migration authority.
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS project_source_files (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('AUTOCAD','DIALUX','EXCEL','OTHER')),
        display_name TEXT NOT NULL,
        original_relative_locator TEXT NOT NULL,
        latest_hash TEXT NOT NULL,
        latest_size INTEGER NOT NULL,
        latest_modified_at TEXT NOT NULL,
        last_checked_at TEXT NOT NULL,
        row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_project_source_files_project
        ON project_source_files(project_id, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_project_source_files_locator
        ON project_source_files(project_id, original_relative_locator);
      CREATE TABLE IF NOT EXISTS revision_source_file_baselines (
        baseline_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        source_file_id TEXT NOT NULL
          REFERENCES project_source_files(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        captured_at TEXT NOT NULL,
        captured_by_id TEXT NOT NULL,
        captured_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_revision_source_file_baselines_revision
        ON revision_source_file_baselines(revision_id, captured_at DESC);
      CREATE INDEX IF NOT EXISTS ix_revision_source_file_baselines_source
        ON revision_source_file_baselines(source_file_id, revision_id, captured_at DESC);
    `);
  }

  // -------------------------------------------------------------------------
  // Project source files
  // -------------------------------------------------------------------------

  public listSourceFiles(projectId: string): ProjectSourceFile[] {
    const rows = this.database
      .prepare(
        'SELECT * FROM project_source_files WHERE project_id = ? ORDER BY updated_at DESC, id',
      )
      .all(projectId) as Row[];
    return rows.map(sourceFileFromRow);
  }

  public getSourceFile(projectId: string, sourceId: string): ProjectSourceFile {
    const row = this.database
      .prepare('SELECT * FROM project_source_files WHERE id = ? AND project_id = ?')
      .get(sourceId, projectId) as Row | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 'Controlled source file not found.', 404);
    return sourceFileFromRow(row);
  }

  public registerSourceFile(input: RegisterProjectSourceInput): ProjectSourceFile {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO project_source_files
         (id, project_id, source_type, display_name, original_relative_locator,
          latest_hash, latest_size, latest_modified_at, last_checked_at, row_version,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.sourceType,
        input.displayName,
        input.originalRelativeLocator,
        input.sha256,
        input.sizeBytes,
        input.modifiedAt,
        input.now,
        input.now,
        input.now,
      );
    this.activity(
      input.projectId,
      'SourceFile',
      id,
      'Registered',
      input.displayName,
      `${input.sourceType} registered under ${input.originalRelativeLocator}.`,
      input.now,
    );
    return this.getSourceFile(input.projectId, id);
  }

  /**
   * Fingerprint refresh with optimistic concurrency. The row_version guard
   * prevents two concurrent freshness checks from last-write-wins clobbering.
   */
  public updateSourceFingerprint(input: UpdateSourceFingerprintInput): ProjectSourceFile {
    const result = this.database
      .prepare(
        `UPDATE project_source_files
         SET latest_hash = ?, latest_size = ?, latest_modified_at = ?,
             last_checked_at = ?, row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND project_id = ? AND row_version = ?`,
      )
      .run(
        input.sha256,
        input.sizeBytes,
        input.modifiedAt,
        input.checkedAt,
        input.checkedAt,
        input.sourceId,
        input.projectId,
        input.expectedRowVersion,
      );
    if (result.changes !== 1) {
      throw new DomainError(
        'CONFLICT',
        'The controlled source file changed during the freshness check. Refresh and retry.',
        409,
      );
    }
    return this.getSourceFile(input.projectId, input.sourceId);
  }

  public deleteSourceFile(projectId: string, sourceId: string): void {
    const existing = this.getSourceFile(projectId, sourceId);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare('DELETE FROM revision_source_file_baselines WHERE source_file_id = ?')
        .run(sourceId);
      this.database
        .prepare('DELETE FROM project_source_files WHERE id = ? AND project_id = ?')
        .run(sourceId, projectId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.activity(
      projectId,
      'SourceFile',
      sourceId,
      'Removed',
      existing.displayName,
      'Controlled source file removed.',
      new Date().toISOString(),
    );
  }

  // -------------------------------------------------------------------------
  // Revision source baselines (append-only immutable evidence)
  // -------------------------------------------------------------------------

  public listBaselinesForSource(projectId: string, sourceId: string): RevisionSourceFileBaseline[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM revision_source_file_baselines
         WHERE project_id = ? AND source_file_id = ?
         ORDER BY captured_at DESC, baseline_id`,
      )
      .all(projectId, sourceId) as Row[];
    return rows.map(baselineFromRow);
  }

  public listBaselinesForRevision(
    projectId: string,
    revisionId: string,
  ): RevisionSourceFileBaseline[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM revision_source_file_baselines
         WHERE project_id = ? AND revision_id = ?
         ORDER BY captured_at DESC, baseline_id`,
      )
      .all(projectId, revisionId) as Row[];
    return rows.map(baselineFromRow);
  }

  public getBaseline(
    projectId: string,
    sourceId: string,
    revisionId: string,
  ): RevisionSourceFileBaseline | null {
    const row = this.database
      .prepare(
        `SELECT * FROM revision_source_file_baselines
         WHERE project_id = ? AND source_file_id = ? AND revision_id = ?
         ORDER BY captured_at DESC, baseline_id LIMIT 1`,
      )
      .get(projectId, sourceId, revisionId) as Row | undefined;
    return row ? baselineFromRow(row) : null;
  }

  public captureBaseline(input: {
    projectId: string;
    revisionId: string;
    sourceFileId: string;
    sha256: string;
    sizeBytes: number;
    capturedAt: string;
    capturedById: string;
    capturedByName: string;
  }): RevisionSourceFileBaseline {
    const baselineId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO revision_source_file_baselines
         (baseline_id, project_id, revision_id, source_file_id, sha256, size_bytes,
          captured_at, captured_by_id, captured_by_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        baselineId,
        input.projectId,
        input.revisionId,
        input.sourceFileId,
        input.sha256,
        input.sizeBytes,
        input.capturedAt,
        input.capturedById,
        input.capturedByName,
        input.capturedAt,
      );
    const source = this.getSourceFile(input.projectId, input.sourceFileId);
    this.activity(
      input.projectId,
      'SourceFile',
      input.sourceFileId,
      'BaselineCaptured',
      source.displayName,
      `Baseline captured for Revision ${input.revisionId}.`,
      input.capturedAt,
    );
    return baselineFromRow({
      baseline_id: baselineId,
      project_id: input.projectId,
      revision_id: input.revisionId,
      source_file_id: input.sourceFileId,
      sha256: input.sha256,
      size_bytes: input.sizeBytes,
      captured_at: input.capturedAt,
      captured_by_id: input.capturedById,
      captured_by_name: input.capturedByName,
    });
  }

  // -------------------------------------------------------------------------
  // Audit activity (reuses the canonical workspace_activity authority)
  // -------------------------------------------------------------------------

  private activity(
    projectId: string,
    entityType: string,
    entityId: string,
    action: string,
    title: string,
    detail: string,
    createdAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO workspace_activity
         (id, project_id, entity_type, entity_id, action, title, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), projectId, entityType, entityId, action, title, detail, createdAt);
  }
}

export const PROJECT_INTELLIGENCE_COMPONENT_TABLES: readonly string[] = Object.freeze([
  ...PRODUCTION_V28_TABLE_NAMES,
]);

function sourceFileFromRow(row: Row): ProjectSourceFile {
  return {
    id: text(row, 'id'),
    projectId: text(row, 'project_id'),
    sourceType: text(row, 'source_type') as ProjectSourceFileType,
    displayName: text(row, 'display_name'),
    originalRelativeLocator: text(row, 'original_relative_locator'),
    latestHash: text(row, 'latest_hash'),
    latestSize: numberValue(row, 'latest_size'),
    latestModifiedAt: text(row, 'latest_modified_at'),
    lastCheckedAt: text(row, 'last_checked_at'),
    rowVersion: numberValue(row, 'row_version'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function baselineFromRow(row: Row): RevisionSourceFileBaseline {
  return {
    baselineId: text(row, 'baseline_id'),
    projectId: text(row, 'project_id'),
    revisionId: text(row, 'revision_id'),
    sourceFileId: text(row, 'source_file_id'),
    sha256: text(row, 'sha256'),
    sizeBytes: numberValue(row, 'size_bytes'),
    capturedAt: text(row, 'captured_at'),
    capturedById: text(row, 'captured_by_id'),
    capturedByName: text(row, 'captured_by_name'),
  };
}
