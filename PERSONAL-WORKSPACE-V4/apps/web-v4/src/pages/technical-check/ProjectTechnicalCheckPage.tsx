import { useParams } from 'react-router-dom';
import { ProjectTechnicalCheckWorkspace } from './ProjectTechnicalCheckWorkspace';
export function ProjectTechnicalCheckPage() {
  const { projectId } = useParams();
  return <ProjectTechnicalCheckWorkspace key={projectId} finalView />;
}
