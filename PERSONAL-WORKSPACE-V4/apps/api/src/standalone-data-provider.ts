import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { finalProjectSetupSchema } from '@scli/contracts';
import type { AppConfig } from '@scli/config';
import {
  DomainError,
  type AppNotification,
  type AppSettings,
  type AppUser,
  type LocalIdentityProvider,
  type Project,
  type ProjectActivity,
  type ProjectComment,
  type ProjectCreateRecord,
} from '@scli/domain';
import { seedSettings, type SeedData } from '@scli/test-data';
import { MockDataProvider } from './mock-data-provider';
import {
  DEFAULT_SCHEMA_MANAGEMENT_MODE,
  EXTERNALLY_MIGRATED,
  verifyExternalSchemaReadiness,
  type SchemaManagementMode,
} from './infrastructure/migration/registry/production-migration-registry';

// Keep the specifier dynamic until the bundler recognizes Node's stable sqlite module.
// Older esbuild versions incorrectly rewrite a static `node:sqlite` import to `sqlite`.
const nodeSqliteSpecifier = ['node', 'sqlite'].join(':');
const { DatabaseSync } = (await import(nodeSqliteSpecifier)) as typeof import('node:sqlite');
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;

const persistedStateSchema = z.object({
  users: z.array(z.object({ id: z.string().uuid(), email: z.string().email() }).passthrough()),
  projects: z.array(
    z
      .object({
        id: z.string().uuid(),
        version: z.number().int().min(1),
        finalSetup: finalProjectSetupSchema.optional(),
        responsibilityNotes: z.string().max(4000).optional(),
      })
      .passthrough(),
  ),
  activities: z.array(
    z.object({ id: z.string().uuid(), projectId: z.string().uuid() }).passthrough(),
  ),
  comments: z.array(
    z.object({ id: z.string().uuid(), projectId: z.string().uuid() }).passthrough(),
  ),
  notifications: z.array(
    z.object({ id: z.string().uuid(), recipientUserId: z.string().uuid() }).passthrough(),
  ),
  settings: z
    .object({ companyTimezone: z.string(), projectTypes: z.array(z.unknown()) })
    .passthrough(),
  lastSequence: z.number().int().min(0),
});

function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function standaloneSeed(config: AppConfig): SeedData {
  const now = new Date().toISOString();
  const adminId = crypto.randomUUID();
  const admin: AppUser = {
    id: adminId,
    entraObjectId: `standalone:${adminId}`,
    displayName: config.STANDALONE_ADMIN_NAME,
    email: config.STANDALONE_ADMIN_EMAIL.toLowerCase(),
    jobTitle: 'Application Administrator',
    department: 'Lighting Solutions',
    role: 'Admin',
    weeklyCapacityHours: 0,
    availabilityStatus: 'Available',
    avatarUrl: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  return {
    users: [admin],
    projects: [],
    activities: [],
    comments: [],
    notifications: [],
    settings: {
      ...structuredClone(seedSettings),
      companyTimezone: config.COMPANY_TIMEZONE,
      updatedAt: now,
      updatedById: adminId,
    },
    lastSequence: 0,
  };
}

export class StandaloneDataProvider extends MockDataProvider implements LocalIdentityProvider {
  private readonly database: DatabaseSyncInstance;
  private readonly ownsDatabase: boolean;

  /**
   * schemaManagementMode defaults to LEGACY_SELF_MANAGED as a temporary transition: it preserves
   * the currently runnable application until production startup wiring explicitly selects
   * EXTERNALLY_MIGRATED. LEGACY_SELF_MANAGED is not safe for final production and its removal is
   * deferred until the End-to-End Reality Gate passes.
   *
   * When `database` is supplied the provider uses that shared handle and does NOT own it (close()
   * is a no-op for the connection). When omitted the provider opens and owns its own connection.
   */
  public constructor(
    private readonly config: AppConfig,
    schemaManagementMode: SchemaManagementMode = DEFAULT_SCHEMA_MANAGEMENT_MODE,
    database?: DatabaseSyncInstance,
    initialSeed?: SeedData,
  ) {
    const ownsDatabase = database === undefined;
    const db = database ?? openStandaloneDatabase(config);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
    `);
    if (schemaManagementMode === EXTERNALLY_MIGRATED) {
      // Post-migration readiness assertion: no schema creation, alteration, or repair.
      try {
        verifyExternalSchemaReadiness(db, 'StandaloneDataProvider');
      } catch (error) {
        if (ownsDatabase) db.close();
        throw error;
      }
    } else {
      db.exec(`
      CREATE TABLE IF NOT EXISTS app_state (
        state_key TEXT PRIMARY KEY,
        json_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_accounts (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        idempotency_key TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      `);
    }
    const stateRow = db
      .prepare('SELECT json_value FROM app_state WHERE state_key = ?')
      .get('primary') as { json_value: string } | undefined;
    const seed = stateRow
      ? (persistedStateSchema.parse(JSON.parse(stateRow.json_value)) as unknown as SeedData)
      : (initialSeed ?? standaloneSeed(config));
    super(seed, 'standalone');
    this.database = db;
    this.ownsDatabase = ownsDatabase;
    if (!stateRow) this.persist();
    this.ensureBootstrapAccount();
  }

  private persist(): void {
    this.database
      .prepare(
        `INSERT INTO app_state (state_key, json_value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET
           json_value = excluded.json_value,
           updated_at = excluded.updated_at`,
      )
      .run('primary', JSON.stringify(this.snapshot()), new Date().toISOString());
  }

  private ensureBootstrapAccount(): void {
    const count = this.database.prepare('SELECT COUNT(*) AS count FROM local_accounts').get() as {
      count: number;
    };
    if (count.count > 0) return;
    const admin = this.data.users.find((user) => user.role === 'Admin' && user.isActive);
    if (!admin) throw new Error('Standalone mode requires an active bootstrap Admin.');
    const { salt, hash } = hashPassword(this.config.STANDALONE_ADMIN_PASSWORD);
    this.database
      .prepare(
        `INSERT INTO local_accounts (user_id, email, salt, password_hash, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(admin.id, admin.email.toLowerCase(), salt, hash, new Date().toISOString());
  }

  public override async createUser(user: AppUser): Promise<AppUser> {
    const created = await super.createUser(user);
    this.persist();
    return created;
  }

  public override async updateUser(id: string, patch: Partial<AppUser>): Promise<AppUser> {
    const updated = await super.updateUser(id, patch);
    this.database
      .prepare('UPDATE local_accounts SET email = ?, updated_at = ? WHERE user_id = ?')
      .run(updated.email.toLowerCase(), new Date().toISOString(), id);
    this.persist();
    return updated;
  }

  public override async createProject(record: ProjectCreateRecord): Promise<Project> {
    const existing = this.database
      .prepare('SELECT project_id FROM idempotency_keys WHERE idempotency_key = ?')
      .get(record.idempotencyKey) as { project_id: string } | undefined;
    if (existing) {
      const project = await this.getProject(existing.project_id);
      if (project) return project;
    }
    const created = await super.createProject(record);
    this.database
      .prepare(
        'INSERT OR IGNORE INTO idempotency_keys (idempotency_key, project_id, created_at) VALUES (?, ?, ?)',
      )
      .run(record.idempotencyKey, created.id, new Date().toISOString());
    this.persist();
    return created;
  }

  public override async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const updated = await super.updateProject(id, patch);
    this.persist();
    return updated;
  }

  public override async allocateProjectNumber(): Promise<number> {
    const allocated = await super.allocateProjectNumber();
    this.persist();
    return allocated;
  }

  public override async setProjectSequenceFloor(sequence: number): Promise<void> {
    await super.setProjectSequenceFloor(sequence);
    this.persist();
  }

  public override async deleteProject(id: string): Promise<void> {
    await super.deleteProject(id);
    this.database.prepare('DELETE FROM idempotency_keys WHERE project_id = ?').run(id);
    this.persist();
  }

  public override async appendActivities(activities: ProjectActivity[]): Promise<void> {
    await super.appendActivities(activities);
    this.persist();
  }

  public override async addComment(comment: ProjectComment): Promise<ProjectComment> {
    const created = await super.addComment(comment);
    this.persist();
    return created;
  }

  public override async addNotifications(notifications: AppNotification[]): Promise<void> {
    await super.addNotifications(notifications);
    this.persist();
  }

  public override async markNotificationRead(id: string, userId: string): Promise<AppNotification> {
    const updated = await super.markNotificationRead(id, userId);
    this.persist();
    return updated;
  }

  public override async updateSettings(settings: AppSettings): Promise<AppSettings> {
    const updated = await super.updateSettings(settings);
    this.persist();
    return updated;
  }

  public async verifyCredentials(email: string, password: string): Promise<AppUser | null> {
    const account = this.database
      .prepare(
        'SELECT user_id, salt, password_hash FROM local_accounts WHERE email = ? COLLATE NOCASE',
      )
      .get(email.trim().toLowerCase()) as
      { user_id: string; salt: string; password_hash: string } | undefined;
    if (!account) {
      scryptSync(password, 'constant-missing-account-salt', 64);
      return null;
    }
    const supplied = scryptSync(password, account.salt, 64);
    const expected = Buffer.from(account.password_hash, 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const user = await this.getUser(account.user_id);
    return user?.isActive ? user : null;
  }

  public async setPassword(userId: string, password: string): Promise<void> {
    const user = await this.getUser(userId);
    if (!user) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    const { salt, hash } = hashPassword(password);
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO local_accounts (user_id, email, salt, password_hash, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           email = excluded.email,
           salt = excluded.salt,
           password_hash = excluded.password_hash,
           updated_at = excluded.updated_at`,
      )
      .run(user.id, user.email.toLowerCase(), salt, hash, updatedAt);
    await super.updateUser(user.id, { updatedAt });
    this.persist();
  }

  public close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  // ---------------------------------------------------------------------------
  // P2.6B2A — narrow atomic workflow coordination capabilities.
  //
  // These methods are SYNCHRONOUS (non-yielding) and never begin/commit a
  // transaction themselves. The PersonalWorkflowTransitionCoordinator owns the
  // outer BEGIN IMMEDIATE ... COMMIT on the shared connection and calls these
  // from inside it, so project mutation, ProjectActivity, and history write as
  // one atomic durable unit. On rollback the coordinator restores in-memory
  // state via capture/restore so provider memory never diverges from SQLite.
  // ---------------------------------------------------------------------------

  /** Returns the shared DatabaseSync handle (must equal the store's handle). */
  public getSharedDatabase(): DatabaseSyncInstance {
    return this.database;
  }

  /** Deep-copies the provider's full in-memory state for atomic rollback. */
  public captureWorkflowState(): SeedData {
    return structuredClone(this.data);
  }

  /** Restores the provider's in-memory state after an atomic rollback. */
  public restoreWorkflowState(snapshot: SeedData): void {
    this.data = structuredClone(snapshot);
  }

  /**
   * Applies a project patch synchronously to in-memory state and rewrites the
   * app_state row on the shared connection. Must be called inside the outer
   * transaction (no independent BEGIN/COMMIT here). Returns the updated project.
   */
  public applyWorkflowProjectMutation(projectId: string, patch: Partial<Project>): Project {
    const index = this.data.projects.findIndex((project) => project.id === projectId);
    if (index < 0) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    const current = this.data.projects[index];
    if (!current) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    const updated = { ...current, ...structuredClone(patch) };
    this.data.projects[index] = updated;
    this.persist();
    return structuredClone(updated);
  }

  /**
   * P2.8C — internal compatibility aggregate writer used only by the Personal
   * WorkSession coordinator. Applies an actualHours delta (plus updatedAt and
   * version bump) synchronously inside the outer transaction. `now` is the same
   * authoritative timestamp used to close the WorkSession so the aggregate
   * update is consistent with the session's persisted endedAt. This is the
   * single safe internal path for the WorkSession close -> actualHours update;
   * it is never exposed to route/UI callers, which are blocked from direct
   * actualHours mutation for Personal projects.
   */
  public applySessionActualHoursDelta(projectId: string, deltaHours: number, now: string): Project {
    const index = this.data.projects.findIndex((project) => project.id === projectId);
    if (index < 0) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    const current = this.data.projects[index];
    if (!current) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    const updated = {
      ...current,
      actualHours: current.actualHours + deltaHours,
      updatedAt: now,
      version: current.version + 1,
    };
    this.data.projects[index] = updated;
    this.persist();
    return structuredClone(updated);
  }

  /**
   * Appends a ProjectActivity synchronously to in-memory state and rewrites the
   * app_state row on the shared connection. Must be called inside the outer
   * transaction (no independent BEGIN/COMMIT here).
   */
  public appendWorkflowActivity(activity: ProjectActivity): void {
    this.data.activities.push(structuredClone(activity));
    this.persist();
  }
}

/** Opens a standalone database connection owned by the caller. */
export function openStandaloneDatabase(config: AppConfig): DatabaseSyncInstance {
  const databasePath = path.resolve(process.cwd(), config.STANDALONE_DB_PATH);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  return new DatabaseSync(databasePath);
}
