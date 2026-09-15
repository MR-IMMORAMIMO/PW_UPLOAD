import { useParams } from 'react-router-dom';
import { ProjectTechnicalBoqWorkspace } from './ProjectTechnicalBoqWorkspace';
export function ProjectTechnicalBoqPage() {
  const { projectId } = useParams();
  return <ProjectTechnicalBoqWorkspace key={projectId} finalView />;
}
