import { useParams } from 'react-router-dom';
import { ProjectRevisionsWorkspace } from './ProjectRevisionsWorkspace';
export function ProjectRevisionsPage() {
  const { projectId } = useParams();
  return <ProjectRevisionsWorkspace key={projectId} finalView />;
}
