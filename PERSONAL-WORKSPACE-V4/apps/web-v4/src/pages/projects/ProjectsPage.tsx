import FinalProjectsView from '../../components/final-ui/FinalProjectsView';
import { ProjectsWorkspaceController } from './ProjectsWorkspaceController';
export function ProjectsPage() {
  return (
    <ProjectsWorkspaceController
      renderFinal={(binding) => (
        <FinalProjectsView key={binding.preferenceScope ?? 'loading'} binding={binding} />
      )}
    />
  );
}
