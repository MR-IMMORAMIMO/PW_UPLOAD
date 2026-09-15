import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { projectStorageMarkerSchema, type ReconnectProjectStorageInput } from '@scli/contracts';
import {
  DomainError,
  projectStorageMarkerFileName,
  projectStorageMarkerSchemaVersion,
  type DataProvider,
  type Project,
  type ProjectStorageHealth,
  type ProjectStorageMarker,
} from '@scli/domain';
import { PersonalWorkspaceStore } from './personal-workspace-store.js';
import { StandaloneDataProvider } from './standalone-data-provider.js';

declare const verifiedProjectRootBrand: unique symbol;

/** A canonical Project root returned only after the shared storage-health gate passes. */
export type VerifiedProjectRoot = string & {
  readonly [verifiedProjectRootBrand]: true;
};

export interface ProjectStorageFileSystem {
  exists(filePath: string): boolean;
  lstat(filePath: string): { isDirectory(): boolean; isSymbolicLink(): boolean };
  realpath(filePath: string): string;
  readText(filePath: string): string;
  list(folderPath: string): string[];
  writeExclusiveDurable(filePath: string, contents: string): void;
  remove(filePath: string): void;
}

export const nodeProjectStorageFileSystem: ProjectStorageFileSystem = {
  exists: existsSync,
  lstat: lstatSync,
  realpath: (value) => realpathSync.native(value),
  readText: (value) => readFileSync(value, 'utf8'),
  list: readdirSync,
  writeExclusiveDurable: (filePath, contents) => {
    const descriptor = openSync(filePath, 'wx');
    try {
      writeFileSync(descriptor, contents, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  },
  remove: unlinkSync,
};

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function unavailableReason(error: unknown): ProjectStorageHealth['reason'] {
  const code = errorCode(error);
  if (code === 'ENOENT') return 'NOT_FOUND';
  if (code === 'EACCES' || code === 'EPERM') return 'PERMISSION_DENIED';
  return 'IO_UNAVAILABLE';
}

function markerPath(root: string): string {
  return path.join(root, projectStorageMarkerFileName);
}

function legacyProjectCode(contents: string): string | null {
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => /^Project Code\s*:/i.test(candidate.trim()));
  return line ? line.slice(line.indexOf(':') + 1).trim() : null;
}

export class ProjectStorageService {
  public constructor(
    private readonly provider: DataProvider,
    private readonly store: PersonalWorkspaceStore,
    private readonly fileSystem: ProjectStorageFileSystem = nodeProjectStorageFileSystem,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Read-only: this method never creates or mutates a marker or persisted path. */
  public async getHealth(project: Project): Promise<ProjectStorageHealth> {
    const workspacePath = this.store.getWorkspace(project.id).folderPath;
    const projectPath = project.projectFolderPath?.trim() || null;
    const checkedAt = this.clock().toISOString();
    const base = { projectId: project.id, projectPath, workspacePath, checkedAt };
    if (!projectPath && !workspacePath) {
      return {
        ...base,
        state: 'DISCONNECTED',
        reason: 'NOT_CONFIGURED',
        canonicalPath: null,
        marker: null,
        canOpenFolder: false,
        canReconnect: true,
        canAdoptLegacy: false,
      };
    }
    if (!projectPath || !workspacePath || !samePath(projectPath, workspacePath)) {
      return {
        ...base,
        state: 'NEEDS_RECONNECTION',
        reason: 'PATH_DISAGREEMENT',
        canonicalPath: null,
        marker: null,
        canOpenFolder: false,
        canReconnect: true,
        canAdoptLegacy: false,
      };
    }
    const canonicalPath = path.resolve(projectPath);
    try {
      const stat = this.fileSystem.lstat(canonicalPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        return {
          ...base,
          state: 'NEEDS_RECONNECTION',
          reason: 'IO_UNAVAILABLE',
          canonicalPath,
          marker: null,
          canOpenFolder: false,
          canReconnect: true,
          canAdoptLegacy: false,
        };
      }
      const real = this.fileSystem.realpath(canonicalPath);
      if (!samePath(real, canonicalPath)) {
        return {
          ...base,
          state: 'NEEDS_RECONNECTION',
          reason: 'IO_UNAVAILABLE',
          canonicalPath,
          marker: null,
          canOpenFolder: false,
          canReconnect: true,
          canAdoptLegacy: false,
        };
      }
      const marker = this.readMarker(canonicalPath);
      if (marker.kind === 'invalid') {
        return {
          ...base,
          state: 'NEEDS_RECONNECTION',
          reason: 'MALFORMED_MARKER',
          canonicalPath,
          marker: null,
          canOpenFolder: false,
          canReconnect: true,
          canAdoptLegacy: false,
        };
      }
      if (marker.kind === 'valid') {
        const matches = marker.value.projectId === project.id;
        return {
          ...base,
          state: matches ? 'CONNECTED' : 'NEEDS_RECONNECTION',
          reason: matches ? null : 'WRONG_PROJECT_MARKER',
          canonicalPath,
          marker: marker.value,
          canOpenFolder: matches,
          canReconnect: !matches,
          canAdoptLegacy: false,
        };
      }
      const compatible = this.hasCompatibleLegacyEvidence(project, canonicalPath);
      if (compatible) {
        try {
          await this.assertNotBoundToAnotherProject(project.id, canonicalPath);
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          return {
            ...base,
            state: 'NEEDS_RECONNECTION',
            reason: 'OTHER_PROJECT_BINDING',
            canonicalPath,
            marker: null,
            canOpenFolder: false,
            canReconnect: true,
            canAdoptLegacy: false,
          };
        }
      }
      return {
        ...base,
        state: compatible ? 'LEGACY_UNVERIFIED' : 'NEEDS_RECONNECTION',
        reason: compatible ? null : 'LEGACY_EVIDENCE_MISSING',
        canonicalPath,
        marker: null,
        canOpenFolder: false,
        canReconnect: true,
        canAdoptLegacy: compatible,
      };
    } catch (error) {
      return {
        ...base,
        state: 'UNAVAILABLE',
        reason: unavailableReason(error),
        canonicalPath,
        marker: null,
        canOpenFolder: false,
        canReconnect: true,
        canAdoptLegacy: false,
      };
    }
  }

  public async resolveVerifiedProjectRoot(project: Project): Promise<VerifiedProjectRoot> {
    const health = await this.getHealth(project);
    if (health.state !== 'CONNECTED' || !health.canonicalPath) {
      throw new DomainError(
        'CONFLICT',
        'This file operation requires a connected, verified Project folder.',
        409,
        { storageState: health.state, storageReason: health.reason },
      );
    }
    return health.canonicalPath as VerifiedProjectRoot;
  }

  public async reconnect(project: Project, input: ReconnectProjectStorageInput) {
    if (input.expectedVersion !== project.version) {
      throw new DomainError(
        'CONFLICT',
        'This project changed after you opened it. Refresh before reconnecting storage.',
        409,
        { expectedVersion: input.expectedVersion, latestVersion: project.version },
      );
    }
    const candidate = this.inspectSafeCandidate(input.candidatePath);
    await this.assertNotBoundToAnotherProject(project.id, candidate);
    const existing = this.readMarker(candidate);
    if (existing.kind === 'invalid') {
      throw new DomainError('CONFLICT', 'The selected folder has a malformed Project marker.', 409);
    }
    if (existing.kind === 'valid' && existing.value.projectId !== project.id) {
      throw new DomainError('CONFLICT', 'The selected folder belongs to a different Project.', 409);
    }

    let markerCreated = false;
    if (input.intent === 'MATCHING_MARKER') {
      if (existing.kind !== 'valid') {
        throw new DomainError(
          'CONFLICT',
          'The selected folder has no matching Project marker.',
          409,
        );
      }
    } else if (input.intent === 'ADOPT_LEGACY') {
      const current = await this.getHealth(project);
      if (
        current.state !== 'LEGACY_UNVERIFIED' ||
        !current.canonicalPath ||
        !samePath(current.canonicalPath, candidate) ||
        existing.kind !== 'missing' ||
        !this.hasCompatibleLegacyEvidence(project, candidate)
      ) {
        throw new DomainError(
          'CONFLICT',
          'Legacy adoption requires the currently agreed folder and matching legacy evidence.',
          409,
        );
      }
      this.createMarker(project, candidate);
      markerCreated = true;
    } else {
      const current = await this.getHealth(project);
      if (current.state !== 'DISCONNECTED' || existing.kind !== 'missing') {
        throw new DomainError(
          'CONFLICT',
          'Initial binding is available only for an unbound Project.',
          409,
        );
      }
      if (this.fileSystem.list(candidate).length > 0) {
        throw new DomainError(
          'CONFLICT',
          'An unrelated non-empty folder cannot be used for initial binding.',
          409,
        );
      }
      this.createMarker(project, candidate);
      markerCreated = true;
    }

    try {
      const updated = await this.persistBothPaths(project, candidate);
      const health = await this.getHealth(updated);
      if (health.state !== 'CONNECTED') {
        throw new DomainError(
          'CONFLICT',
          'Storage reconnect did not produce a verified root.',
          409,
        );
      }
      return { project: updated, health, markerCreated };
    } catch (error) {
      if (markerCreated) this.removeCreatedMarker(candidate, project.id);
      throw error;
    }
  }

  /** Used only after the application has created and owns a brand-new root. */
  public async bindProgramOwnedRoot(project: Project, folderPath: string): Promise<Project> {
    const candidate = this.inspectSafeCandidate(folderPath);
    await this.assertNotBoundToAnotherProject(project.id, candidate);
    const existing = this.readMarker(candidate);
    if (
      existing.kind === 'invalid' ||
      (existing.kind === 'valid' && existing.value.projectId !== project.id)
    ) {
      throw new DomainError('CONFLICT', 'The created Project root has a conflicting marker.', 409);
    }
    const markerCreated = existing.kind === 'missing';
    if (markerCreated) this.createMarker(project, candidate);
    try {
      return await this.persistBothPaths(project, candidate, false);
    } catch (error) {
      if (markerCreated) this.removeCreatedMarker(candidate, project.id);
      throw error;
    }
  }

  private inspectSafeCandidate(candidatePath: string): string {
    const candidate = path.resolve(candidatePath);
    if (
      !candidatePath.trim() ||
      candidate === path.parse(candidate).root ||
      candidate.length > 220
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'The selected folder is outside the allowed Project path constraints.',
        400,
      );
    }
    try {
      const stat = this.fileSystem.lstat(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new DomainError('VALIDATION_ERROR', 'Select a real Project directory.', 400);
      }
      const real = this.fileSystem.realpath(candidate);
      if (!samePath(real, candidate)) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'Symlink or reparse-point folders are not allowed.',
          400,
        );
      }
      return real;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('CONFLICT', 'The selected Project folder is unavailable.', 409, {
        reason: unavailableReason(error),
      });
    }
  }

  private readMarker(
    root: string,
  ): { kind: 'missing' } | { kind: 'invalid' } | { kind: 'valid'; value: ProjectStorageMarker } {
    const filePath = markerPath(root);
    if (!this.fileSystem.exists(filePath)) return { kind: 'missing' };
    try {
      return {
        kind: 'valid',
        value: projectStorageMarkerSchema.parse(JSON.parse(this.fileSystem.readText(filePath))),
      };
    } catch {
      return { kind: 'invalid' };
    }
  }

  private hasCompatibleLegacyEvidence(project: Project, root: string): boolean {
    const info = path.join(root, 'PROJECT_INFO.txt');
    if (!this.fileSystem.exists(info)) return false;
    try {
      return (
        legacyProjectCode(this.fileSystem.readText(info))?.toUpperCase() ===
        project.projectCode.toUpperCase()
      );
    } catch {
      return false;
    }
  }

  private createMarker(project: Project, root: string): void {
    const marker: ProjectStorageMarker = {
      schemaVersion: projectStorageMarkerSchemaVersion,
      projectId: project.id,
      createdAt: this.clock().toISOString(),
      projectCodeSnapshot: project.projectCode,
    };
    try {
      this.fileSystem.writeExclusiveDurable(
        markerPath(root),
        `${JSON.stringify(marker, null, 2)}\n`,
      );
    } catch (error) {
      throw new DomainError(
        errorCode(error) === 'EEXIST' ? 'CONFLICT' : 'INTEGRATION_UNAVAILABLE',
        errorCode(error) === 'EEXIST'
          ? 'A Project marker already exists in the selected folder.'
          : 'The Project marker could not be created safely.',
        errorCode(error) === 'EEXIST' ? 409 : 500,
      );
    }
  }

  private removeCreatedMarker(root: string, projectId: string): void {
    const marker = this.readMarker(root);
    if (marker.kind !== 'valid' || marker.value.projectId !== projectId) return;
    try {
      this.fileSystem.remove(markerPath(root));
    } catch {
      // Preserve the original persistence error. The marker still identifies
      // the exact Project and will be surfaced by the next explicit reconnect.
    }
  }

  private async assertNotBoundToAnotherProject(
    projectId: string,
    candidate: string,
  ): Promise<void> {
    for (const other of await this.provider.listProjects()) {
      if (other.id === projectId) continue;
      const projectPath = other.projectFolderPath?.trim();
      let workspacePath: string | null = null;
      try {
        workspacePath = this.store.getWorkspace(other.id).folderPath;
      } catch {
        // A Team-only/no-workspace record still owns its Project path.
      }
      if (
        (projectPath && samePath(projectPath, candidate)) ||
        (workspacePath && samePath(workspacePath, candidate))
      ) {
        throw new DomainError(
          'CONFLICT',
          'The selected folder is already bound to another Project.',
          409,
        );
      }
    }
  }

  private async persistBothPaths(
    project: Project,
    folderPath: string,
    incrementVersion = true,
  ): Promise<Project> {
    const now = this.clock().toISOString();
    const provider = this.provider;
    if (
      provider instanceof StandaloneDataProvider &&
      provider.getSharedDatabase() === this.store.getSharedDatabase()
    ) {
      const snapshot = provider.captureWorkflowState();
      try {
        return this.store.runInTransaction(() => {
          const updated = provider.applyWorkflowProjectMutation(project.id, {
            projectFolderPath: folderPath,
            updatedAt: now,
            version: incrementVersion ? project.version + 1 : project.version,
          });
          this.store.setFolderPath(project.id, folderPath);
          return updated;
        });
      } catch (error) {
        provider.restoreWorkflowState(snapshot);
        throw error;
      }
    }
    const updated = await this.provider.updateProject(project.id, {
      projectFolderPath: folderPath,
      updatedAt: now,
      version: incrementVersion ? project.version + 1 : project.version,
    });
    try {
      this.store.setFolderPath(project.id, folderPath);
      return updated;
    } catch (error) {
      await this.provider.updateProject(project.id, {
        ...(project.projectFolderPath !== undefined
          ? { projectFolderPath: project.projectFolderPath }
          : {}),
        updatedAt: project.updatedAt,
        version: project.version,
      });
      throw error;
    }
  }
}
