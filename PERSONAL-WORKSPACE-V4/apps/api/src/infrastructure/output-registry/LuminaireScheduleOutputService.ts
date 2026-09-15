import type { UpdateTechnicalScheduleConfigInput } from '@scli/contracts';
import type { ProjectWorkspace, TechnicalScheduleWorkspaceView } from '@scli/domain';
import type { PersonalWorkspaceStore } from '../../personal-workspace-store.js';
import type { CanonicalOutputRegistryStore } from './CanonicalOutputRegistryStore.js';
import { TechnicalOutputWorkspaceService } from './TechnicalOutputWorkspaceService.js';

export class LuminaireScheduleOutputService {
  private readonly service: TechnicalOutputWorkspaceService;

  public constructor(
    personalStore: PersonalWorkspaceStore,
    registry: CanonicalOutputRegistryStore,
  ) {
    this.service = new TechnicalOutputWorkspaceService(personalStore, registry, {
      family: 'LuminaireSchedule',
      label: 'Schedule',
      requirePhysicalProjectRoot: false,
    });
  }

  public read(
    projectId: string,
    workspace: ProjectWorkspace,
    selectedRevisionId?: string,
    targetRevisionId?: string,
  ): Promise<TechnicalScheduleWorkspaceView> {
    return this.service.read(projectId, workspace, selectedRevisionId, targetRevisionId);
  }

  public updateConfig(projectId: string, input: UpdateTechnicalScheduleConfigInput) {
    return this.service.updateConfig(projectId, input);
  }
}
