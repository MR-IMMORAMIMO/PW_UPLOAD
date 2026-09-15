import path from 'node:path';
import {
  deriveFolderRelativePath,
  type CaptureLedgerEntry,
  type DataProvider,
  type Project,
} from '@scli/domain';
import { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import { ProjectStorageService, type VerifiedProjectRoot } from '../../project-storage-service.js';
import { CanonicalOutputRegistryStore } from '../output-registry/CanonicalOutputRegistryStore.js';
import type { CanonicalRevisionRecord } from '@scli/domain';
import type { P4bCapturePolicy } from './CapturePolicy.js';

export interface CaptureDestinationPlan {
  project: Project;
  revision: CanonicalRevisionRecord | null;
  verifiedRoot: VerifiedProjectRoot;
  destinationFolderId: string;
  destinationRelativeFolder: string;
  destinationAbsoluteFolder: string;
}

export type CaptureDestinationResolution =
  | { kind: 'READY'; plan: CaptureDestinationPlan }
  | { kind: 'UNRESOLVED'; reason: 'DESTINATION_MAPPING_REQUIRED' | 'TARGET_REVISION_FINALIZED' }
  | { kind: 'REJECTED'; reason: 'TARGET_REVISION_STALE_OR_DELETED' }
  | { kind: 'FAILED_RECOVERABLE'; reason: 'STORAGE_UNAVAILABLE' | 'TARGET_REVISION_NOT_PREPARING' };

export class CaptureDestinationResolver {
  public constructor(
    private readonly provider: DataProvider,
    private readonly workspaceStore: PersonalWorkspaceStore,
    private readonly projectStorage: ProjectStorageService,
    private readonly revisions: CanonicalOutputRegistryStore,
  ) {}

  public async resolve(
    capture: CaptureLedgerEntry,
    policy: P4bCapturePolicy,
  ): Promise<CaptureDestinationResolution> {
    const project = await this.provider.getProject(capture.projectId);
    if (!project) return { kind: 'FAILED_RECOVERABLE', reason: 'STORAGE_UNAVAILABLE' };

    let revision: CanonicalRevisionRecord | null = null;
    if (policy.level === 'REVISION') {
      if (!capture.targetRevisionId) {
        return { kind: 'REJECTED', reason: 'TARGET_REVISION_STALE_OR_DELETED' };
      }
      try {
        revision = this.revisions.getRevision(capture.targetRevisionId);
      } catch {
        return { kind: 'REJECTED', reason: 'TARGET_REVISION_STALE_OR_DELETED' };
      }
      if (revision.projectId !== capture.projectId) {
        return { kind: 'REJECTED', reason: 'TARGET_REVISION_STALE_OR_DELETED' };
      }
      if (revision.lifecycleState === 'FINALIZED') {
        return { kind: 'UNRESOLVED', reason: 'TARGET_REVISION_FINALIZED' };
      }
      if (revision.lifecycleState !== 'PREPARING') {
        return { kind: 'FAILED_RECOVERABLE', reason: 'TARGET_REVISION_NOT_PREPARING' };
      }
    }

    let verifiedRoot: VerifiedProjectRoot;
    try {
      verifiedRoot = await this.projectStorage.resolveVerifiedProjectRoot(project);
    } catch {
      return { kind: 'FAILED_RECOVERABLE', reason: 'STORAGE_UNAVAILABLE' };
    }
    const workspace = this.workspaceStore.getWorkspace(project.id);
    const mapping = workspace.outputMappings.find(
      (candidate) => candidate.outputTypeId === policy.outputTypeId,
    );
    if (!mapping || mapping.unresolved || !mapping.destinationFolderId) {
      return { kind: 'UNRESOLVED', reason: 'DESTINATION_MAPPING_REQUIRED' };
    }
    const folder = workspace.folderSnapshot.folders.find(
      (candidate) => candidate.folderId === mapping.destinationFolderId,
    );
    if (!folder?.enabled) {
      return { kind: 'UNRESOLVED', reason: 'DESTINATION_MAPPING_REQUIRED' };
    }
    const destinationRelativeFolder = deriveFolderRelativePath(
      workspace.folderSnapshot,
      mapping.destinationFolderId,
    );
    if (!destinationRelativeFolder) {
      return { kind: 'UNRESOLVED', reason: 'DESTINATION_MAPPING_REQUIRED' };
    }
    const destinationAbsoluteFolder = path.resolve(verifiedRoot, destinationRelativeFolder);
    const relative = path.relative(verifiedRoot, destinationAbsoluteFolder);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return { kind: 'UNRESOLVED', reason: 'DESTINATION_MAPPING_REQUIRED' };
    }
    return {
      kind: 'READY',
      plan: {
        project,
        revision,
        verifiedRoot,
        destinationFolderId: mapping.destinationFolderId,
        destinationRelativeFolder: destinationRelativeFolder.replaceAll('\\', '/'),
        destinationAbsoluteFolder,
      },
    };
  }
}

export function sameCanonicalRoot(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}
