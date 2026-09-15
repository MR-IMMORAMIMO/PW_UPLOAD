import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generatePath, useNavigate } from 'react-router-dom';
import type { FullProjectEditInput } from '@scli/contracts';
import type { Project } from '@scli/domain';
import {
  SctSort as ArrowDownAZ,
  SctSort as ArrowUpAZ,
  SctDashboard as LayoutGrid,
  SctError as XCircle,
} from '../../components/common/SctIcons';
import { Columns3, FolderKanban, Plus, Search, Table2 } from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4ProjectEditWorkspace } from '../../components/project/V4ProjectEditWorkspace';
import { useProjectStatusController } from '../../components/project/useProjectStatusController';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import { useV4WorkSession } from '../../components/work-session/WorkSessionProvider';
import { ROUTE_NEW_PROJECT, ROUTE_PROJECT_SUMMARY } from '../../router/routes';
import {
  ProjectsCards,
  ProjectsEmpty,
  ProjectsPlanner,
  ProjectsTable,
  type ProjectActionCallbacks,
} from './ProjectsViews';
import {
  PROJECT_PRIORITY_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  PROJECTS_VIEW_STORAGE_KEY,
  projectsQueryFilters,
  readProjectsView,
  todayInTimezone,
  type ProjectsDueFilter,
  type ProjectsSortDirection,
  type ProjectsSortKey,
  type ProjectsViewMode,
} from './projectsViewModel';

const PROJECTS_QUERY_ROOT = ['v4', 'projects', 'list'] as const;

const sortOptions = [
  { value: 'requiredDate', label: 'Due Date' },
  { value: 'priority', label: 'Priority' },
  { value: 'createdDate', label: 'Created Date' },
  { value: 'salesOwner', label: 'Sales Owner' },
] as const;

const dueOptions = [
  { value: '', label: 'Any Date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'next7', label: 'Next 7 Days' },
  { value: 'next30', label: 'Next 30 Days' },
] as const;

function upsertProject(current: Project[] | undefined, updated: Project): Project[] | undefined {
  return current?.map((project) => (project.id === updated.id ? updated : project));
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export interface ProjectsWorkspaceBinding {
  preferenceScope?: string | undefined;
  projects: Project[];
  callbacks: ProjectActionCallbacks;
  activeProjectId: string | null;
  loading: boolean;
  error: string | null;
  feedback: string | null;
  retry(): void;
  newProject(): void;
}
export function ProjectsWorkspaceController({
  renderFinal,
}: { renderFinal?: (binding: ProjectsWorkspaceBinding) => ReactNode } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workSession = useV4WorkSession();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    readStoredSidebarMode(window.localStorage),
  );
  const [view, setView] = useState<ProjectsViewMode>(() => readProjectsView(window.localStorage));
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [salesOwnerId, setSalesOwnerId] = useState('');
  const [priority, setPriority] = useState('');
  const [projectType, setProjectType] = useState('');
  const [due, setDue] = useState<ProjectsDueFilter>('');
  const [sortBy, setSortBy] = useState<ProjectsSortKey>('requiredDate');
  const [sortDirection, setSortDirection] = useState<ProjectsSortDirection>('asc');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [removeProject, setRemoveProject] = useState<Project | null>(null);
  const [removeConfirmation, setRemoveConfirmation] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const closeActionsMenu = () => setOpenMenuId(null);
    document.addEventListener('click', closeActionsMenu);
    return () => document.removeEventListener('click', closeActionsMenu);
  }, []);

  const meQuery = useQuery({
    queryKey: ['v4', 'projects', 'me'],
    queryFn: api.me,
    staleTime: 60_000,
  });
  const settingsQuery = useQuery({
    queryKey: ['v4', 'projects', 'settings'],
    queryFn: api.settings,
    enabled: meQuery.data?.role === 'Admin',
    staleTime: 60_000,
  });
  const salesQuery = useQuery({
    queryKey: ['v4', 'projects', 'sales'],
    queryFn: api.salesUsers,
    staleTime: 60_000,
  });
  const projectTypesQuery = useQuery({
    queryKey: ['v4', 'project-types', 'catalog'],
    queryFn: api.projectTypeCatalogue,
    staleTime: 60_000,
  });
  const editWorkspaceQuery = useQuery({
    queryKey: ['v4', 'project', editingProject?.id, 'workspace'],
    queryFn: () => api.projectWorkspace(editingProject!.id),
    enabled: !!editingProject,
  });
  const timezone = settingsQuery.data?.companyTimezone ?? 'Asia/Dubai';
  const today = todayInTimezone(now, timezone);
  const filters = useMemo(
    () =>
      projectsQueryFilters({
        search,
        status,
        salesOwnerId,
        priority,
        projectType,
        due,
        sortBy,
        sortDirection,
        today,
      }),
    [due, priority, projectType, salesOwnerId, search, sortBy, sortDirection, status, today],
  );
  const projectsQuery = useQuery({
    queryKey: [...PROJECTS_QUERY_ROOT, filters],
    queryFn: () => api.projects(filters),
  });
  const projects = projectsQuery.data ?? [];
  const manager = meQuery.data?.role === 'Admin' || meQuery.data?.role === 'LineManager';

  const reconcileProject = (updated: Project) => {
    queryClient.setQueriesData<Project[]>({ queryKey: PROJECTS_QUERY_ROOT }, (current) =>
      upsertProject(current, updated),
    );
    queryClient.setQueriesData<Project>(
      { predicate: (query) => query.queryKey.includes(updated.id) },
      (current) => (current?.id === updated.id ? updated : current),
    );
  };

  const statusController = useProjectStatusController({
    onMutate: () => {
      setFeedback(null);
      setOpenMenuId(null);
    },
    onSuccess: (updated) => {
      setFeedback(
        `${updated.projectName} moved to ${updated.status.replace(/([a-z])([A-Z])/g, '$1 $2')}.`,
      );
    },
    onError: (error) => {
      setFeedback(
        `${messageFor(error, 'The status move was rejected.')} The Planner was restored.`,
      );
    },
  });

  const projectActionMutation = useMutation({
    mutationFn: async ({
      kind,
      project,
    }: {
      kind: 'archive' | 'restore' | 'remove';
      project: Project;
    }) => {
      if (kind === 'archive')
        return { kind, project: await api.archiveProject(project.id) } as const;
      if (kind === 'restore')
        return { kind, project: await api.restoreProject(project.id) } as const;
      await api.removeProjectFromWorkspace(project.id, removeConfirmation);
      return { kind, project } as const;
    },
    onMutate: () => {
      setFeedback(null);
      setOpenMenuId(null);
    },
    onSuccess: (result) => {
      if (result.kind === 'remove') {
        queryClient.setQueriesData<Project[]>({ queryKey: PROJECTS_QUERY_ROOT }, (current) =>
          current?.filter((project) => project.id !== result.project.id),
        );
        setFeedback(
          `${result.project.projectName} was removed from the app. Its project folder was not deleted.`,
        );
        setRemoveProject(null);
        setRemoveConfirmation('');
      } else {
        reconcileProject(result.project);
        setFeedback(
          result.kind === 'archive'
            ? `${result.project.projectName} was archived. Its project folder was not changed.`
            : `${result.project.projectName} was restored to ${result.project.status}.`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_ROOT });
    },
    onError: (error) =>
      setFeedback(messageFor(error, 'The project action could not be completed.')),
  });

  const editMutation = useMutation({
    mutationFn: (payload: FullProjectEditInput) =>
      api.updateProjectConfiguration(editingProject!.id, payload),
    onSuccess: ({ project: updated, workspace }) => {
      reconcileProject(updated);
      queryClient.setQueryData(['v4', 'project', updated.id, 'workspace'], workspace);
      setEditingProject(null);
      setFeedback(`${updated.projectName} was updated.`);
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_ROOT });
    },
  });

  const changeView = (next: ProjectsViewMode) => {
    setView(next);
    window.localStorage.setItem(PROJECTS_VIEW_STORAGE_KEY, next);
    setOpenMenuId(null);
  };
  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setStatus('');
    setSalesOwnerId('');
    setPriority('');
    setProjectType('');
    setDue('');
  };
  const activeFilterCount = [search, status, salesOwnerId, priority, projectType, due].filter(
    Boolean,
  ).length;
  const projectTypes = (projectTypesQuery.data ?? []).filter(
    (item) => item.isActive || item.name === editingProject?.projectType,
  );

  const callbacks: ProjectActionCallbacks = {
    onOpen: (project) => navigate(generatePath(ROUTE_PROJECT_SUMMARY, { projectId: project.id })),
    onEdit: (project) => {
      setEditingProject(project);
      setOpenMenuId(null);
    },
    onOpenFolder: (project) => {
      setOpenMenuId(null);
      if (!project.projectFolderPath || !window.scliDesktop?.openPath) {
        setFeedback(
          'Open Folder is available only in the desktop app when a real project folder path exists.',
        );
        return;
      }
      void window.scliDesktop
        .openPath(project.projectFolderPath)
        .catch((error: unknown) =>
          setFeedback(messageFor(error, 'The project folder could not be opened.')),
        );
    },
    onArchive: (project) => projectActionMutation.mutate({ kind: 'archive', project }),
    onRestore: (project) => projectActionMutation.mutate({ kind: 'restore', project }),
    onRemove: (project) => {
      setRemoveProject(project);
      setRemoveConfirmation('');
      setOpenMenuId(null);
    },
    onMove: statusController.changeStatus,
  };
  const sharedViewProps = {
    projects,
    now,
    activeProjectId: workSession.active?.projectId ?? null,
    pendingProjectIds: statusController.pendingProjectIds,
    actionPending: projectActionMutation.isPending,
    manager,
    openMenuId,
    onToggleMenu: setOpenMenuId,
    ...callbacks,
  };

  return (
    <V4AppShell
      context="global"
      sidebarMode={sidebarMode}
      onToggleSidebarMode={() =>
        setSidebarMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      activeSectionId="projects"
      onSelectSection={() => undefined}
      boundedPage
      pageHeader={
        renderFinal ? undefined : (
          <div className="v4-projects-page-header">
            <V4PageHeader
              title="Projects"
              description="Browse, manage, and track all your lighting design projects."
              icon={FolderKanban}
              actions={
                <>
                  <button
                    type="button"
                    className="v4-projects-new"
                    onClick={() => navigate(ROUTE_NEW_PROJECT)}
                  >
                    <Plus aria-hidden="true" /> New Project
                  </button>
                </>
              }
            />
          </div>
        )
      }
    >
      {renderFinal ? (
        renderFinal({
          preferenceScope: meQuery.data?.id,
          projects,
          callbacks,
          activeProjectId: workSession.active?.projectId ?? null,
          loading: projectsQuery.isLoading,
          error: projectsQuery.isError
            ? messageFor(projectsQuery.error, 'Projects could not be loaded.')
            : null,
          feedback,
          retry: () => {
            void projectsQuery.refetch();
          },
          newProject: () => navigate(ROUTE_NEW_PROJECT),
        })
      ) : (
        <main className="v4-projects">
          <section className="v4-projects-toolbar" aria-label="Project filters">
            <label className="v4-projects-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                aria-label="Search projects"
                placeholder="Search projects by name, code, client or CRM…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>
            <div className="v4-projects-filter">
              <span>Status</span>
              <V4FilterSelect
                label="Status"
                value={status}
                options={[{ value: '', label: 'All Statuses' }, ...PROJECT_STATUS_OPTIONS]}
                onChange={setStatus}
              />
            </div>
            <div className="v4-projects-filter">
              <span>Sales</span>
              <V4FilterSelect
                label="Sales"
                value={salesOwnerId}
                options={[
                  { value: '', label: 'All Sales' },
                  ...(salesQuery.data ?? []).map((user) => ({
                    value: user.id,
                    label: user.displayName,
                  })),
                ]}
                onChange={setSalesOwnerId}
              />
            </div>
            <div className="v4-projects-filter">
              <span>Priority</span>
              <V4FilterSelect
                label="Priority"
                value={priority}
                options={[{ value: '', label: 'All Priorities' }, ...PROJECT_PRIORITY_OPTIONS]}
                onChange={setPriority}
              />
            </div>
            <div className="v4-projects-filter">
              <span>Project Type</span>
              <V4FilterSelect
                label="Project Type"
                value={projectType}
                options={[
                  { value: '', label: 'All Types' },
                  ...(projectTypesQuery.data ?? []).map((type) => ({
                    value: type.name,
                    label: type.name,
                  })),
                ]}
                onChange={setProjectType}
              />
            </div>
            <div className="v4-projects-filter">
              <span>Due Date</span>
              <V4FilterSelect
                label="Due Date"
                value={due}
                options={dueOptions}
                onChange={(value) => setDue(value as ProjectsDueFilter)}
              />
            </div>
            <div className="v4-projects-filter v4-projects-filter--sort">
              <span>Sort By</span>
              <V4FilterSelect
                label="Sort By"
                value={sortBy}
                options={sortOptions}
                onChange={(value) => setSortBy(value as ProjectsSortKey)}
              />
              <button
                type="button"
                aria-label={`Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`}
                onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
              >
                {sortDirection === 'asc' ? (
                  <ArrowDownAZ aria-hidden="true" />
                ) : (
                  <ArrowUpAZ aria-hidden="true" />
                )}
              </button>
            </div>
            <button
              type="button"
              className="v4-projects-clear"
              onClick={clearFilters}
              disabled={!activeFilterCount}
            >
              <XCircle aria-hidden="true" /> Clear Filters
            </button>
          </section>

          <section className="v4-projects-workspace" aria-label="Projects workspace">
            <header className="v4-projects-workspace__header">
              <p>
                <strong>{projects.length}</strong> Projects found <span aria-hidden="true">|</span>{' '}
                Active filters: <b>{activeFilterCount || 'None'}</b>
              </p>
              <div className="v4-projects-view-switcher" role="group" aria-label="Project view">
                <button
                  type="button"
                  aria-pressed={view === 'table'}
                  onClick={() => changeView('table')}
                >
                  <Table2 aria-hidden="true" /> Table
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'planner'}
                  onClick={() => changeView('planner')}
                >
                  <Columns3 aria-hidden="true" /> Planner
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'cards'}
                  onClick={() => changeView('cards')}
                >
                  <LayoutGrid aria-hidden="true" /> Cards
                </button>
              </div>
            </header>

            {feedback ? (
              <div className="v4-projects-feedback" role="status" data-testid="projects-feedback">
                <span>{feedback}</span>
                <button
                  type="button"
                  aria-label="Dismiss message"
                  onClick={() => setFeedback(null)}
                >
                  ×
                </button>
              </div>
            ) : null}
            {projectsQuery.isLoading ? (
              <div className="v4-projects-loading" role="status">
                Loading projects…
              </div>
            ) : null}
            {projectsQuery.isError ? (
              <ProjectsEmpty>
                <h2>Projects could not be loaded</h2>
                <p>{messageFor(projectsQuery.error, 'Try again.')}</p>
                <button type="button" onClick={() => void projectsQuery.refetch()}>
                  Retry
                </button>
              </ProjectsEmpty>
            ) : null}
            {!projectsQuery.isLoading && !projectsQuery.isError && !projects.length ? (
              <ProjectsEmpty>
                <FolderKanban aria-hidden="true" />
                <h2>{activeFilterCount ? 'No projects match these filters' : 'No projects yet'}</h2>
                <p>
                  {activeFilterCount
                    ? 'Clear or change the current filters.'
                    : 'Create a lighting project from the New Project workspace.'}
                </p>
                {activeFilterCount ? (
                  <button type="button" onClick={clearFilters}>
                    Clear Filters
                  </button>
                ) : null}
              </ProjectsEmpty>
            ) : null}
            {projects.length && !projectsQuery.isError ? (
              view === 'table' ? (
                <ProjectsTable {...sharedViewProps} />
              ) : view === 'planner' ? (
                <ProjectsPlanner {...sharedViewProps} />
              ) : (
                <ProjectsCards {...sharedViewProps} />
              )
            ) : null}
          </section>
        </main>
      )}

      {editingProject && editWorkspaceQuery.data ? (
        <V4ProjectEditWorkspace
          open
          project={editingProject}
          workspace={editWorkspaceQuery.data}
          projectTypes={projectTypes}
          salesUsers={salesQuery.data ?? []}
          actor={meQuery.data}
          saving={editMutation.isPending}
          error={
            editMutation.error
              ? messageFor(editMutation.error, 'The project could not be saved.')
              : null
          }
          saved={false}
          onClose={() => {
            if (!editMutation.isPending) setEditingProject(null);
          }}
          onSave={(payload) => editMutation.mutate(payload)}
        />
      ) : null}

      {removeProject ? (
        <div className="v4-projects-dialog-backdrop">
          <button
            type="button"
            className="v4-projects-dialog-backdrop__dismiss"
            aria-label="Close removal dialog"
            disabled={projectActionMutation.isPending}
            onClick={() => setRemoveProject(null)}
          />
          <section role="alertdialog" aria-modal="true" aria-labelledby="v4-remove-project-title">
            <h2 id="v4-remove-project-title">Remove archived project?</h2>
            <p>
              The database project record will be removed. The project folder and its files will not
              be deleted.
            </p>
            <label>
              Type <strong>{removeProject.projectCode}</strong> to confirm
              <input
                value={removeConfirmation}
                onChange={(event) => setRemoveConfirmation(event.target.value)}
              />
            </label>
            {projectActionMutation.isError ? (
              <p className="v4-projects-dialog-error">
                {messageFor(projectActionMutation.error, 'The project could not be removed.')}
              </p>
            ) : null}
            <footer>
              <button
                type="button"
                onClick={() => setRemoveProject(null)}
                disabled={projectActionMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v4-projects-dialog-danger"
                disabled={
                  removeConfirmation !== removeProject.projectCode ||
                  projectActionMutation.isPending
                }
                onClick={() =>
                  projectActionMutation.mutate({ kind: 'remove', project: removeProject })
                }
              >
                {projectActionMutation.isPending ? 'Removing…' : 'Remove Project'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </V4AppShell>
  );
}
