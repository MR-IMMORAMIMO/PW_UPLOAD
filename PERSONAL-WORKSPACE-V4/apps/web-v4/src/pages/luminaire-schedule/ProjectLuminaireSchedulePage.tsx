import { useParams } from 'react-router-dom';
import { ProjectLuminaireScheduleWorkspace } from './ProjectLuminaireScheduleWorkspace';
export function ProjectLuminaireSchedulePage() {
  const { projectId } = useParams();
  return <ProjectLuminaireScheduleWorkspace key={projectId} finalView />;
}
