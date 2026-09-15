import { useParams } from 'react-router-dom';
import { ProjectDatasheetsWorkspace } from './ProjectDatasheetsWorkspace';
export function ProjectDatasheetsImagesPage() {
  const { projectId } = useParams();
  return <ProjectDatasheetsWorkspace key={projectId} finalView />;
}
