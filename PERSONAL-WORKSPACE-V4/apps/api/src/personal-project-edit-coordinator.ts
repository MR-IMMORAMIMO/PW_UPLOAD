import type { FullProjectEditInput } from '@scli/contracts';
import {
  builtInCodesFromScopeItems,
  normalizeScopeItemInputs,
  type Project,
  type ProjectWorkspace,
} from '@scli/domain';
import type { PreparedProjectUpdate } from './project-service.js';
import { PersonalWorkspaceStore, type WorkspaceWithScope } from './personal-workspace-store.js';
import { StandaloneDataProvider } from './standalone-data-provider.js';

export interface PersonalProjectEditResult {
  project: Project;
  workspace: ProjectWorkspace & { scopeItems: WorkspaceWithScope['scopeItems'] };
}

/**
 * Atomic Personal Project configuration authority. The provider app_state row,
 * immutable Project activities, project_workspaces services/input mode, and
 * deliverable requirement projection share one BEGIN IMMEDIATE transaction.
 */
export class PersonalProjectEditCoordinator {
  public constructor(
    private readonly provider: StandaloneDataProvider,
    private readonly store: PersonalWorkspaceStore,
  ) {}

  public commit(
    prepared: PreparedProjectUpdate,
    input: Pick<FullProjectEditInput, 'scopeItems' | 'luminaireInputMode'>,
  ): PersonalProjectEditResult {
    const preState = this.provider.captureWorkflowState();
    const now = String(prepared.patch.updatedAt);
    const scopeItems = normalizeScopeItemInputs(input.scopeItems);
    const services = builtInCodesFromScopeItems(scopeItems);
    try {
      const project = this.store.runInTransaction(() => {
        const updated = this.provider.applyWorkflowProjectMutation(prepared.project.id, {
          ...prepared.patch,
          services,
          luminaireInputMode: input.luminaireInputMode,
        });
        for (const activity of prepared.activities) {
          this.provider.appendWorkflowActivity(activity);
        }
        this.store.applyProjectConfiguration(
          prepared.project.id,
          input.scopeItems,
          input.luminaireInputMode,
          now,
        );
        return updated;
      });
      return { project, workspace: this.store.getWorkspace(project.id) };
    } catch (error) {
      this.provider.restoreWorkflowState(preState);
      throw error;
    }
  }
}
