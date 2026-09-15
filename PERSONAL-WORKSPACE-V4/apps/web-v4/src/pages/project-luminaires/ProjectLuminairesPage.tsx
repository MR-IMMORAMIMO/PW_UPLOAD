import { useParams } from 'react-router-dom';
import { ProjectLuminairesWorkspace } from './ProjectLuminairesWorkspace';
export function ProjectLuminairesPage() {
  const { projectId } = useParams();
  return <ProjectLuminairesWorkspace key={projectId} finalView />;
}
