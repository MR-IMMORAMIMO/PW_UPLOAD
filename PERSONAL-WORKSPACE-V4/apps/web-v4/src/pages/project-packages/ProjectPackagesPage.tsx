import { useParams } from 'react-router-dom';
import { ProjectPackagesWorkspace } from './ProjectPackagesWorkspace';
export function ProjectPackagesPage() {
  const { projectId } = useParams();
  return <ProjectPackagesWorkspace key={projectId} finalView />;
}
