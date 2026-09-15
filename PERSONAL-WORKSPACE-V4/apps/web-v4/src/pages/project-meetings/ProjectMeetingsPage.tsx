import { useParams } from 'react-router-dom';
import { ProjectMeetingsWorkspace } from './ProjectMeetingsWorkspace';
export function ProjectMeetingsPage() {
  const { projectId } = useParams();
  return <ProjectMeetingsWorkspace key={projectId} finalView />;
}
