import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ProjectsPage } from '../projects/ProjectsPage';
import { DashboardPage } from '../dashboard/DashboardPage';
import FinalNewProjectModal from '../../components/final-ui/FinalNewProjectModal';
export function NewProjectPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const state = location.state as { origin?: { x: number; y: number }; background?: string } | null;
  const background = state?.background === '/dashboard' ? '/dashboard' : '/projects';
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <>
      {background === '/dashboard' ? <DashboardPage /> : <ProjectsPage />}
      <FinalNewProjectModal
        open={open}
        origin={state?.origin ?? null}
        onClose={() => {
          setOpen(false);
          window.setTimeout(() => navigate(background), 334);
        }}
      />
    </>
  );
}
