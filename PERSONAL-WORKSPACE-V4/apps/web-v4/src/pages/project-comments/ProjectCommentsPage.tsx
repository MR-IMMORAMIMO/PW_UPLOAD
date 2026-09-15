import { useParams } from 'react-router-dom';
import { ProjectCommentsWorkspace } from './ProjectCommentsWorkspace';
export function ProjectCommentsPage() {
  const { projectId } = useParams();
  return <ProjectCommentsWorkspace key={projectId} finalView />;
}
