import { useParams } from 'react-router-dom';
import { ProjectActionsWorkspace } from './ProjectActionsWorkspace';
export function ProjectActionsPage() {
  const { projectId } = useParams();
  return <ProjectActionsWorkspace key={projectId} finalView />;
}
