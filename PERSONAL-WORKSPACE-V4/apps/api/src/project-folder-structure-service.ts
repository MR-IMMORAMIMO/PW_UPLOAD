import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  DomainError,
  addFolderToSnapshot,
  deriveFolderRelativePath,
  folderConfigurationFingerprint,
  folderDescendantIds,
  folderSiblingNameCollision,
  folderSubtreeMappings,
  isFolderEffectivelyEnabled,
  moveFolderInSnapshot,
  removeFolderFromSnapshot,
  renameFolderInSnapshot,
  reorderSiblingInSnapshot,
  setFolderEnabledInSnapshot,
  validateWindowsFolderName,
  type FolderNode,
  type OutputMapping,
  type Project,
  type ProjectFolderSnapshot,
} from '@scli/domain';
import type { FolderActionInput, FolderActionPreviewInput } from '@scli/contracts';
import { PersonalWorkspaceStore, type WorkspaceWithScope } from './personal-workspace-store';
import { ProjectFolderService } from './project-folder-service';
import { scanProjectFolder } from './legacy-project-import-service';

export interface FolderActionPreview {
  action: 'rename' | 'move' | 'delete-empty';
  folderId: string;
  currentRelativePath: string;
  proposedRelativePath: string | null;
  containsEntries: boolean;
  indexedFileCount: number;
  affectedDescendantCount: number;
  outputMappings: string[];
  warnings: string[];
  folderConfigurationFingerprint: string;
}

export interface FolderActionResult {
  action: FolderActionInput['action'];
  folderId: string | null;
  folderConfigurationFingerprint: string;
  workspace: WorkspaceWithScope;
}

function recoveryRequiredError(message: string): DomainError {
  return new DomainError('CONFLICT', message, 409, { recoveryRequired: true });
}

function staleFingerprintError(): DomainError {
  return new DomainError(
    'CONFLICT',
    'The folder structure changed after you opened it. Refresh and review the latest structure before continuing.',
    409,
    { code: 'STALE_FOLDER_CONFIGURATION' },
  );
}

function requireNode(snapshot: ProjectFolderSnapshot, folderId: string): FolderNode {
  const node = snapshot.folders.find((folder) => folder.folderId === folderId);
  if (!node) {
    throw new DomainError('VALIDATION_ERROR', `Unknown folderId: ${folderId}`, 400);
  }
  return node;
}

function assertClosedProject(project: Project): void {
  if (project.status === 'Completed' || project.status === 'Cancelled') {
    throw new DomainError(
      'INVALID_TRANSITION',
      'Completed or cancelled projects must be reopened before their folder structure can be edited.',
      409,
    );
  }
}

function normalizeIndexedPath(value: string): string {
  return value.replaceAll('\\', '/');
}

/**
 * Controlled ID-aware folder structure editor (P2.4B2).
 *
 * Owns per-project operation serialization, stale-state fingerprint checks,
 * action orchestration, filesystem + persistence coordination, compensation,
 * index refresh, and audit. Filesystem safety primitives live in
 * ProjectFolderService; canonical snapshot/output persistence lives in
 * PersonalWorkspaceStore.
 */
export class ProjectFolderStructureService {
  private readonly queues = new Map<string, Promise<unknown>>();

  public constructor(
    private readonly store: PersonalWorkspaceStore,
    private readonly folderService: ProjectFolderService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Serializes folder-structure mutations per project without blocking other projects. */
  private runSerialized<T>(projectId: string, task: () => T): Promise<T> {
    const previous = this.queues.get(projectId) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(projectId, tail);
    void tail.then(() => {
      if (this.queues.get(projectId) === tail) this.queues.delete(projectId);
    });
    return result;
  }

  private fingerprint(snapshot: ProjectFolderSnapshot, mappings: readonly OutputMapping[]): string {
    return folderConfigurationFingerprint(snapshot, mappings);
  }

  private assertCurrentFingerprint(
    expected: string,
    snapshot: ProjectFolderSnapshot,
    mappings: readonly OutputMapping[],
  ): void {
    if (this.fingerprint(snapshot, mappings) !== expected) {
      throw staleFingerprintError();
    }
  }

  private assertManagedRoot(project: Project, workspaceFolderPath: string | null): string {
    if (!workspaceFolderPath) {
      throw new DomainError(
        'CONFLICT',
        'Connect the project folder before editing its structure.',
        409,
      );
    }
    return this.folderService.assertManagedRootOwned(project, workspaceFolderPath);
  }

  private assertSourceFolder(
    root: string,
    snapshot: ProjectFolderSnapshot,
    folderId: string,
  ): string {
    const relativePath = deriveFolderRelativePath(snapshot, folderId);
    if (!relativePath) {
      throw new DomainError('VALIDATION_ERROR', `Unknown folderId: ${folderId}`, 400);
    }
    const physical = this.folderService.resolveManagedDescendant(root, relativePath);
    this.folderService.assertNoReparsePoint(root, physical);
    return physical;
  }

  private assertTargetParent(
    root: string,
    snapshot: ProjectFolderSnapshot,
    parentFolderId: string | null,
  ): string {
    if (parentFolderId === null) {
      this.folderService.assertNoReparsePoint(root, root);
      return root;
    }
    const parent = requireNode(snapshot, parentFolderId);
    if (!isFolderEffectivelyEnabled(snapshot, parentFolderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `The parent folder ${parent.name} is disabled. Enable it before adding or moving folders into it.`,
        400,
      );
    }
    const relativePath = deriveFolderRelativePath(snapshot, parentFolderId);
    if (!relativePath) {
      throw new DomainError('VALIDATION_ERROR', `Unknown parent folderId: ${parentFolderId}`, 400);
    }
    const physical = this.folderService.resolveManagedDescendant(root, relativePath);
    this.folderService.assertNoReparsePoint(root, physical);
    return physical;
  }

  private persist(
    projectId: string,
    snapshot: ProjectFolderSnapshot,
    mappings: readonly OutputMapping[],
  ): WorkspaceWithScope {
    return this.store.persistFolderSnapshot(projectId, snapshot, [...mappings]);
  }

  private audit(
    projectId: string,
    folderId: string | null,
    action: string,
    title: string,
    detail: string,
  ): void {
    this.store.operations.recordWorkspaceActivity(
      projectId,
      'Folder',
      folderId,
      action,
      title,
      detail,
      this.clock().toISOString(),
    );
  }

  private refreshIndex(projectId: string, root: string): void {
    const index = scanProjectFolder(root, projectId);
    this.store.replaceFolderIndex(index);
  }

  private indexedFileCount(projectId: string, relativePath: string): number {
    const index = this.store.getFolderIndex(projectId);
    const prefix = `${normalizeIndexedPath(relativePath)}/`;
    return index.items.filter((item) =>
      normalizeIndexedPath(item.relativePath).toLowerCase().startsWith(prefix.toLowerCase()),
    ).length;
  }

  private mappedOutputTypes(
    mappings: readonly OutputMapping[],
    snapshot: ProjectFolderSnapshot,
    folderId: string,
  ): string[] {
    return folderSubtreeMappings(mappings, snapshot, folderId).map(
      (mapping) => mapping.outputTypeId,
    );
  }

  private proposedPathForRename(
    snapshot: ProjectFolderSnapshot,
    folderId: string,
    newName: string,
  ): string {
    const node = requireNode(snapshot, folderId);
    const parentPath = node.parentFolderId
      ? deriveFolderRelativePath(snapshot, node.parentFolderId)
      : null;
    return parentPath ? `${parentPath}/${newName}` : newName;
  }

  private proposedPathForMove(
    snapshot: ProjectFolderSnapshot,
    folderId: string,
    newParentFolderId: string | null,
  ): string {
    const node = requireNode(snapshot, folderId);
    const parentPath = newParentFolderId
      ? deriveFolderRelativePath(snapshot, newParentFolderId)
      : null;
    return parentPath ? `${parentPath}/${node.name}` : node.name;
  }

  /** Non-mutating preview for physical/path-changing operations. */
  public preview(project: Project, action: FolderActionPreviewInput): FolderActionPreview {
    const workspace = this.store.getWorkspace(project.id);
    const root = this.assertManagedRoot(project, workspace.folderPath);
    const snapshot = workspace.folderSnapshot;
    const mappings = workspace.outputMappings;
    const fingerprint = this.fingerprint(snapshot, mappings);
    const warnings: string[] = [];
    const base = {
      folderId: action.folderId,
      folderConfigurationFingerprint: fingerprint,
    };

    if (action.action === 'rename') {
      const node = requireNode(snapshot, action.folderId);
      const physical = this.assertSourceFolder(root, snapshot, action.folderId);
      const newName = validateWindowsFolderName(action.name);
      if (folderSiblingNameCollision(snapshot, node.parentFolderId, newName, node.folderId)) {
        throw new DomainError(
          'VALIDATION_ERROR',
          `A sibling folder named ${newName} already exists.`,
          400,
        );
      }
      const currentRelativePath = deriveFolderRelativePath(snapshot, action.folderId)!;
      const proposedRelativePath = this.proposedPathForRename(snapshot, action.folderId, newName);
      const entries = readdirSync(physical);
      const indexedFileCount = this.indexedFileCount(project.id, currentRelativePath);
      const affectedDescendantCount = folderDescendantIds(snapshot, action.folderId).length;
      const outputMappings = this.mappedOutputTypes(mappings, snapshot, action.folderId);
      if (entries.length > 0 || affectedDescendantCount > 0) {
        warnings.push(
          'This folder contains files or subfolders. External references such as AutoCAD Xrefs, Revit links, DIALux references, and 3ds Max links may need to be relinked after the rename.',
        );
      }
      return {
        ...base,
        action: 'rename',
        currentRelativePath,
        proposedRelativePath,
        containsEntries: entries.length > 0,
        indexedFileCount,
        affectedDescendantCount,
        outputMappings,
        warnings,
      };
    }

    if (action.action === 'move') {
      const node = requireNode(snapshot, action.folderId);
      if (action.folderId === action.newParentFolderId) {
        throw new DomainError('VALIDATION_ERROR', 'A folder cannot be moved into itself.', 400);
      }
      if (
        action.newParentFolderId !== null &&
        folderDescendantIds(snapshot, action.folderId).includes(action.newParentFolderId)
      ) {
        throw new DomainError(
          'VALIDATION_ERROR',
          'A folder cannot be moved into its own descendant.',
          400,
        );
      }
      const physical = this.assertSourceFolder(root, snapshot, action.folderId);
      this.assertTargetParent(root, snapshot, action.newParentFolderId);
      if (
        folderSiblingNameCollision(snapshot, action.newParentFolderId, node.name, action.folderId)
      ) {
        throw new DomainError(
          'VALIDATION_ERROR',
          `A folder named ${node.name} already exists in the target location.`,
          400,
        );
      }
      const currentRelativePath = deriveFolderRelativePath(snapshot, action.folderId)!;
      const proposedRelativePath = this.proposedPathForMove(
        snapshot,
        action.folderId,
        action.newParentFolderId,
      );
      const entries = readdirSync(physical);
      const indexedFileCount = this.indexedFileCount(project.id, currentRelativePath);
      const affectedDescendantCount = folderDescendantIds(snapshot, action.folderId).length;
      const outputMappings = this.mappedOutputTypes(mappings, snapshot, action.folderId);
      if (entries.length > 0 || affectedDescendantCount > 0) {
        warnings.push(
          'This folder contains files or subfolders. External references such as AutoCAD Xrefs, Revit links, DIALux references, and 3ds Max links may need to be relinked after the move.',
        );
      }
      return {
        ...base,
        action: 'move',
        currentRelativePath,
        proposedRelativePath,
        containsEntries: entries.length > 0,
        indexedFileCount,
        affectedDescendantCount,
        outputMappings,
        warnings,
      };
    }

    // delete-empty
    const physical = this.assertSourceFolder(root, snapshot, action.folderId);
    const currentRelativePath = deriveFolderRelativePath(snapshot, action.folderId)!;
    const entries = readdirSync(physical);
    const affectedDescendantCount = folderDescendantIds(snapshot, action.folderId).length;
    const outputMappings = this.mappedOutputTypes(mappings, snapshot, action.folderId);
    if (affectedDescendantCount > 0) {
      warnings.push('This folder contains subfolders and cannot be deleted.');
    }
    if (entries.length > 0) {
      warnings.push('This folder is not empty and cannot be deleted.');
    }
    if (outputMappings.length > 0) {
      warnings.push(
        'This folder is an output destination. Reassign the output before deleting it.',
      );
    }
    return {
      ...base,
      action: 'delete-empty',
      currentRelativePath,
      proposedRelativePath: null,
      containsEntries: entries.length > 0,
      indexedFileCount: this.indexedFileCount(project.id, currentRelativePath),
      affectedDescendantCount,
      outputMappings,
      warnings,
    };
  }

  /** Executes a controlled folder action with full validation and compensation. */
  public execute(project: Project, action: FolderActionInput): Promise<FolderActionResult> {
    return this.runSerialized(project.id, () => {
      assertClosedProject(project);
      const workspace = this.store.getWorkspace(project.id);
      const root = this.assertManagedRoot(project, workspace.folderPath);
      const snapshot = workspace.folderSnapshot;
      const mappings = workspace.outputMappings;
      this.assertCurrentFingerprint(
        action.expectedFolderConfigurationFingerprint,
        snapshot,
        mappings,
      );

      switch (action.action) {
        case 'add':
          return this.add(project.id, root, snapshot, mappings, action);
        case 'rename':
          return this.rename(project.id, root, snapshot, mappings, action);
        case 'move':
          return this.move(project.id, root, snapshot, mappings, action);
        case 'reorder':
          return this.reorder(project.id, snapshot, mappings, action);
        case 'disable':
          return this.disable(project.id, snapshot, mappings, action);
        case 'enable':
          return this.enable(project.id, snapshot, mappings, action);
        case 'delete-empty':
          return this.deleteEmpty(project.id, root, snapshot, mappings, action);
      }
    });
  }

  private result(
    projectId: string,
    action: FolderActionInput['action'],
    folderId: string | null,
    snapshot: ProjectFolderSnapshot,
    mappings: readonly OutputMapping[],
  ): FolderActionResult {
    return {
      action,
      folderId,
      folderConfigurationFingerprint: this.fingerprint(snapshot, mappings),
      workspace: this.store.getWorkspace(projectId),
    };
  }

  private add(
    projectId: string,
    root: string,
    snapshot: ProjectFolderSnapshot,
    mappings: readonly OutputMapping[],
    action: Extract<FolderActionInput, { action: 'add' }>,
  ): FolderActionResult {
    const parentFolderId = action.parentFolderId;
    const name = validateWindowsFolderName(action.name);
    if (folderSiblingNameCollision(snapshot, parentFolderId, name)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `A sibling folder named ${name} already exists.`,
        400,
      );
    }
    const physicalParent = this.assertTargetParent(root, snapshot, parentFolderId);
    const physical = path.join(physicalParent, name);
    if (existsSync(physical)) {
      throw new DomainError(
        'CONFLICT',
        `A folder named ${name} already exists on disk in that location.`,
        409,
      );
    }
    const siblings = snapshot.folders
      .filter((folder) => folder.parentFolderId === parentFolderId)
      .sort((left, right) => left.displayOrder - right.displayOrder);
    const displayOrder = siblings.length ? siblings[siblings.length - 1]!.displayOrder + 1 : 0;
    const folderId = randomUUID();
    mkdirSync(physical);
    let persisted = false;
    try {
      const nextSnapshot = addFolderToSnapshot(
        snapshot,
        parentFolderId,
        name,
        displayOrder,
        folderId,
      );
      this.persist(projectId, nextSnapshot, mappings);
      persisted = true;
      this.audit(
        projectId,
        folderId,
        'FolderAdded',
        'Folder added',
        `Added ${name} under ${parentFolderId ? deriveFolderRelativePath(snapshot, parentFolderId) : 'project root'}.`,
      );
      return this.result(projectId, 'add', folderId, nextSnapshot, mappings);
    } catch (error) {
      try {
        if (existsSync(physical)) {
          if (readdirSync(physical).length !== 0) {
            throw new Error('The created folder is not empty.');
          }
          rmdirSync(physical);
        }
        if (persisted) {
          this.store.persistFolderSnapshot(projectId, snapshot, [...mappings]);
        }
      } catch {
        throw recoveryRequiredError(
          'The folder was created but could not be persisted safely. Manual recovery is required.',
        );
      }
      throw error;
    }
  }

  private rename(
    projectId: string,
    root: string,
    snapshot: ProjectFolderSnapshot,
    mappings: readonly OutputMapping[],
    action: Extract<FolderActionInput, { action: 'rename' }>,
  ): FolderActionResult {
    const node = requireNode(snapshot, action.folderId);
    const newName = validateWindowsFolderName(action.name);
    if (folderSiblingNameCollision(snapshot, node.parentFolderId, newName, node.folderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `A sibling folder named ${newName} already exists.`,
        400,
      );
    }
    const source = this.assertSourceFolder(root, snapshot, action.folderId);
    const parentPath = node.parentFolderId
      ? deriveFolderRelativePath(snapshot, node.parentFolderId)
      : null;
    const parentPhysical = parentPath ? path.join(root, parentPath) : root;
    const target = path.join(parentPhysical, newName);
    const caseOnly = newName.toLowerCase() === node.name.toLowerCase() && newName !== node.name;
    if (existsSync(target) && !caseOnly) {
      throw new DomainError(
        'CONFLICT',
        `A folder named ${newName} already exists in that location.`,
        409,
      );
    }
    if (caseOnly) {
      // Windows treats case-only renames as no-ops, so use a collision-resistant
      // temporary same-parent rename with full compensation.
      const tempName = `.scli_rename_${randomUUID().replaceAll('-', '')}`;
      const tempPath = path.join(parentPhysical, tempName);
      renameSync(source, tempPath);
      try {
        renameSync(tempPath, target);
      } catch (error) {
        try {
          renameSync(tempPath, source);
        } catch {
          throw recoveryRequiredError(
            'The case-only rename could not be completed safely. Manual recovery is required.',
          );
        }
        throw error;
      }
    } else {
      renameSync(source, target);
    }
    const oldIndex = this.store.getFolderIndex(projectId);
    let persisted = false;
    try {
      const nextSnapshot = renameFolderInSnapshot(snapshot, action.folderId, newName);
      this.persist(projectId, nextSnapshot, mappings);
      persisted = true;
      this.refreshIndex(projectId, root);
      this.audit(
        projectId,
        action.folderId,
        'FolderRenamed',
        'Folder renamed',
        `Renamed ${node.name} to ${newName}.`,
      );
      return this.result(projectId, 'rename', action.folderId, nextSnapshot, mappings);
    } catch (error) {
      try {
        renameSync(target, source);
        if (persisted) {
          this.store.persistFolderSnapshot(projectId, snapshot, [...mappings]);
          this.store.replaceFolderIndex(oldIndex);
        }
      } catch {
        throw recoveryRequiredError(
          'The folder was renamed but could not be persisted safely. Manual recovery is required.',
        );
      }
      throw error;
    }
  }

  private move(
    projectId: string,
    root: string,
    snapshot: ProjectFolderSnapshot,
    mappings: readonly OutputMapping[],
    action: Extract<FolderActionInput, { action: 'move' }>,
  ): FolderActionResult {
    const node = requireNode(snapshot, action.folderId);
    if (action.folderId === action.newParentFolderId) {
      throw new DomainError('VALIDATION_ERROR', 'A folder cannot be moved into itself.', 400);
    }
    if (
      action.newParentFolderId !== null &&
      folderDescendantIds(snapshot, action.folderId).includes(action.newParentFolderId)
    ) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'A folder cannot be moved into its own descendant.',
        400,
      );
    }
    if (folderSiblingNameCollision(snapshot, action.newParentFolderId, node.name, node.folderId)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `A folder named ${node.name} already exists in the target location.`,
        400,
      );
    }
    const source = this.assertSourceFolder(root, snapshot, action.folderId);
    const targetParent = this.assertTargetParent(root, snapshot, action.newParentFolderId);
    const target = path.join(targetParent, node.name);
    if (existsSync(target)) {
      throw new DomainError(
        'CONFLICT',
        `A folder named ${node.name} already exists on disk in the target location.`,
        409,
      );
    }
    renameSync(source, target);
    const oldIndex = this.store.getFolderIndex(projectId);
    let persisted = false;
    try {
      const nextSnapshot = moveFolderInSnapshot(
        snapshot,
        action.folderId,
        action.newParentFolderId,
      );
      this.persist(projectId, nextSnapshot, mappings);
      persisted = true;
      this.refreshIndex(projectId, root);
      this.audit(
        projectId,
        action.folderId,
        'FolderMoved',
        'Folder moved',
        `Moved ${node.name} to ${action.newParentFolderId ? deriveFolderRelativePath(snapshot, action.newParentFolderId) : 'project root'}.`,
      );
      return this.result(projectId, 'move', action.folderId, nextSnapshot, mappings);
    } catch (error) {
      try {
        renameSync(target, source);
        if (persisted) {
          this.store.persistFolderSnapshot(projectId, snapshot, [...mappings]);
          this.store.replaceFolderIndex(oldIndex);
        }
      } catch {
        throw recoveryRequiredError(
          'The folder was moved but could not be persisted safely. Manual recovery is required.',
        );
      }
      throw error;
    }
  }

  private reorder(
    projectId: string,
    snapshot: ProjectFolderSnapshot,
    mappings: readonly OutputMapping[],
    action: Extract<FolderActionInput, { action: 'reorder' }>,
  ): FolderActionResult {
    const node = requireNode(snapshot, action.folderId);
    const nextSnapshot = reorderSiblingInSnapshot(
      snapshot,
      action.folderId,
      action.newDisplayOrder,
    );
    this.persist(projectId, nextSnapshot, mappings);
    this.audit(
      projectId,
      action.folderId,
      'FolderReordered',
      'Folder reordered',
      `Reordered ${node.name} among its siblings.`,
    );
    return this.result(projectId, 'reorder', action.folderId, nextSnapshot, mappings);
  }

  private disable(
    projectId: string,
    snapshot: ProjectFolderSnapshot,
    mappings: readonly OutputMapping[],
    action: Extract<FolderActionInput, { action: 'disable' }>,
  ): FolderActionResult {
    const node = requireNode(snapshot, action.folderId);
    const mapped = folderSubtreeMappings(mappings, snapshot, action.folderId);
    if (mapped.length > 0) {
      throw new DomainError(
        'CONFLICT',
        `${node.name} (or a folder inside it) is an output destination. Reassign the output before disabling it.`,
        409,
      );
    }
    const nextSnapshot = setFolderEnabledInSnapshot(snapshot, action.folderId, false);
    this.persist(projectId, nextSnapshot, mappings);
    this.audit(
      projectId,
      action.folderId,
      'FolderDisabled',
      'Folder disabled',
      `Disabled ${node.name}. Files remain on disk.`,
    );
    return this.result(projectId, 'disable', action.folderId, nextSnapshot, mappings);
  }

  private enable(
    projectId: string,
    snapshot: ProjectFolderSnapshot,
    mappings: readonly OutputMapping[],
    action: Extract<FolderActionInput, { action: 'enable' }>,
  ): FolderActionResult {
    const node = requireNode(snapshot, action.folderId);
    const nextSnapshot = setFolderEnabledInSnapshot(snapshot, action.folderId, true);
    this.persist(projectId, nextSnapshot, mappings);
    this.audit(
      projectId,
      action.folderId,
      'FolderEnabled',
      'Folder enabled',
      `Enabled ${node.name}.`,
    );
    return this.result(projectId, 'enable', action.folderId, nextSnapshot, mappings);
  }

  private deleteEmpty(
    projectId: string,
    root: string,
    snapshot: ProjectFolderSnapshot,
    mappings: readonly OutputMapping[],
    action: Extract<FolderActionInput, { action: 'delete-empty' }>,
  ): FolderActionResult {
    const node = requireNode(snapshot, action.folderId);
    if (folderDescendantIds(snapshot, action.folderId).length > 0) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `${node.name} contains subfolders and cannot be deleted.`,
        400,
      );
    }
    const mapped = folderSubtreeMappings(mappings, snapshot, action.folderId);
    if (mapped.length > 0) {
      throw new DomainError(
        'CONFLICT',
        `${node.name} is an output destination. Reassign the output before deleting it.`,
        409,
      );
    }
    const source = this.assertSourceFolder(root, snapshot, action.folderId);
    const entries = readdirSync(source);
    if (entries.length > 0) {
      throw new DomainError(
        'VALIDATION_ERROR',
        `${node.name} is not empty and cannot be deleted.`,
        400,
      );
    }
    rmdirSync(source);
    let persisted = false;
    try {
      const nextSnapshot = removeFolderFromSnapshot(snapshot, action.folderId);
      this.persist(projectId, nextSnapshot, mappings);
      persisted = true;
      this.audit(
        projectId,
        action.folderId,
        'EmptyFolderDeleted',
        'Empty folder deleted',
        `Deleted empty folder ${node.name}.`,
      );
      return this.result(projectId, 'delete-empty', action.folderId, nextSnapshot, mappings);
    } catch (error) {
      try {
        mkdirSync(source);
        if (persisted) {
          this.store.persistFolderSnapshot(projectId, snapshot, [...mappings]);
        }
      } catch {
        throw recoveryRequiredError(
          'The empty folder was deleted but could not be persisted safely. Manual recovery is required.',
        );
      }
      throw error;
    }
  }
}
