import { useQuery } from '@tanstack/react-query';
import { generatePath, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { GLOBAL_NAV_ITEMS, PROJECT_NAV_GROUPS } from '../navigation/navModel';
import type { SidebarMode } from '../sidebar/sidebarMode';
import { api } from '../../api/environment';
import GlobalSidebar from './GlobalSidebar';
import ProjectSidebar, { StatusChip } from './ProjectSidebar';
import { V4ProjectStatusControl } from '../project/V4ProjectStatusControl';
import { ShellData, shellProject } from './ShellData';
import './finalUi.css';

const aliases: Record<string, string> = {
  luminaire: 'luminaire-library',
  'smart-import': 'imports',
  'doc-review': 'documents',
  documents: 'documents',
  timeline: 'workflow',
  'tech-check': 'technical-check',
  'luminaire-sch': 'lighting-schedule',
  'tech-boq': 'technical-boq',
};
const reverse = (id: string) =>
  Object.entries(aliases).find(([, value]) => value === id)?.[0] ?? id;
export function FinalSidebar({
  mode,
  onToggleMode,
}: {
  mode: SidebarMode;
  onToggleMode: () => void;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const projectId = matchPath('/projects/:projectId/*', pathname)?.params.projectId;
  const project = useQuery({
    queryKey: ['v4', 'final-shell', 'project', projectId],
    queryFn: () => api.project(projectId!),
    enabled: Boolean(projectId),
  });
  const projectItems = PROJECT_NAV_GROUPS.flatMap((g) => g.items);
  const current = projectId
    ? projectItems.find((i) => matchPath(i.route, pathname))
    : GLOBAL_NAV_ITEMS.find((i) => matchPath(i.route, pathname));
  const navigateItem = (figmaId: string) => {
    if (figmaId === 'settings') {
      navigate('/settings');
      return;
    }
    const id = aliases[figmaId] ?? figmaId;
    const item = (projectId ? projectItems : GLOBAL_NAV_ITEMS).find((i) => i.id === id);
    if (!item || item.disabled) return;
    navigate(projectId ? generatePath(item.route, { projectId }) : item.route);
  };
  return (
    <ShellData>
      <div
        className="final-ui final-ui-sidebar"
        data-final-shell="01"
        data-project-id={projectId ?? ''}
        data-sidebar-mode={mode}
      >
        {projectId ? (
          <ProjectSidebar
            statusControl={
              project.data ? (
                <V4ProjectStatusControl
                  project={project.data}
                  triggerContent={<StatusChip status={shellProject(project.data).status} />}
                />
              ) : undefined
            }
            key={projectId}
            project={shellProject(project.isError ? null : project.data)}
            activePage={reverse(current?.id ?? '')}
            setActivePage={navigateItem}
            onBack={() => navigate('/projects')}
            collapsed={mode === 'minimal'}
            setCollapsed={onToggleMode}
          />
        ) : (
          <GlobalSidebar
            activeNav={pathname === '/settings' ? 'settings' : reverse(current?.id ?? '')}
            setActiveNav={navigateItem}
            collapsed={mode === 'minimal'}
            setCollapsed={onToggleMode}
          />
        )}
      </div>
    </ShellData>
  );
}
