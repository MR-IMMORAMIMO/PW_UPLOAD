import type { UpdateOutputMappingInput } from '@scli/contracts';
import { DomainError } from '@scli/domain';
import { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import { P4B_CAPTURE_POLICIES } from './CapturePolicy.js';

export class ProjectOutputMappingService {
  public constructor(private readonly store: PersonalWorkspaceStore) {}

  public update(
    projectId: string,
    outputTypeId: 'dialuxReport' | 'cadLayoutPdf' | 'cadWorkingDrawing',
    input: UpdateOutputMappingInput,
  ) {
    if (!P4B_CAPTURE_POLICIES.some((policy) => policy.outputTypeId === outputTypeId)) {
      throw new DomainError('VALIDATION_ERROR', 'Output filing type is not supported.', 400);
    }
    const workspace = this.store.getWorkspace(projectId);
    if (workspace.folderConfigurationFingerprint !== input.expectedFingerprint) {
      throw new DomainError(
        'CONFLICT',
        'Project folder configuration changed. Refresh before saving output filing.',
        409,
      );
    }
    const folder = workspace.folderSnapshot.folders.find(
      (candidate) => candidate.folderId === input.destinationFolderId,
    );
    if (!folder || !folder.enabled) {
      throw new DomainError('VALIDATION_ERROR', 'Select an enabled Project folder.', 400);
    }
    const mappings = workspace.outputMappings.filter(
      (candidate) => candidate.outputTypeId !== outputTypeId,
    );
    mappings.push({
      outputTypeId,
      destinationFolderId: folder.folderId,
      unresolved: false,
      legacyPath: null,
    });
    return this.store.persistFolderSnapshot(projectId, workspace.folderSnapshot, mappings);
  }
}
