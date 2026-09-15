import type { UpdateTechnicalBoqConfigInput } from '@scli/contracts';
import type { ProjectWorkspace, TechnicalBoqWorkspaceView } from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import type { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';
import { TechnicalOutputWorkspaceService } from './TechnicalOutputWorkspaceService.js';

export class TechnicalBoqOutputService {
  private readonly service: TechnicalOutputWorkspaceService;

  public constructor(
    personalStore: PersonalWorkspaceStore,
    registry: CanonicalOutputRegistryStore,
  ) {
    this.service = new TechnicalOutputWorkspaceService(personalStore, registry, {
      family: 'TechnicalBoq',
      label: 'Technical BOQ',
      requirePhysicalProjectRoot: true,
    });
  }

  public read(
    projectId: string,
    workspace: ProjectWorkspace,
    selectedRevisionId?: string,
    targetRevisionId?: string,
  ): Promise<TechnicalBoqWorkspaceView> {
    return this.service.read(projectId, workspace, selectedRevisionId, targetRevisionId);
  }

  public updateConfig(projectId: string, input: UpdateTechnicalBoqConfigInput) {
    return this.service.updateConfig(projectId, input);
  }
}
