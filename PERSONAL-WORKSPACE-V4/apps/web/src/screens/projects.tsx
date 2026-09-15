/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The Kanban region needs focus for horizontal keyboard scrolling. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Columns3,
  BookmarkPlus,
  Filter,
  FolderInput,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  UserRoundPlus,
  UsersRound,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  allowedStatusTransitions,
  canRoleSetStatus,
  projectStatuses,
  statusLabels,
  type Project,
  type ProjectStatus,
  type AppUser,
} from '@scli/domain';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { AssignmentDrawer } from '../components/assignment-drawer';
import { ProjectCard } from '../components/project-card';
import { useToast } from '../components/toast';
import { personalStatusLabel } from '../personal-status';
import { salesTone } from '../sales-color';
import {
  Deadline,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PriorityBadge,
  ProgressBar,
  StatusBadge,
} from '../components/ui';

type ProjectView = 'board' | 'list' | 'cards' | 'sales';

const boardColumns: Array<{
  label: string;
  target: ProjectStatus;
  statuses: ProjectStatus[];
}> = [
  {
    label: 'New Request',
    target: 'Unassigned',
    statuses: ['NewRequest', 'UnderReview', 'Unassigned'],
  },
  { label: 'Assigned', target: 'Assigned', statuses: ['Assigned'] },
  { label: 'In Progress', target: 'InProgress', statuses: ['InProgress', 'RevisionRequired'] },
  {
    label: 'Waiting for Information',
    target: 'WaitingForInformation',
    statuses: ['WaitingForInformation', 'WaitingForSales'],
  },
  { label: 'Internal Review', target: 'InternalReview', statuses: ['InternalReview'] },
  { label: 'Completed', target: 'Completed', statuses: ['Completed'] },
];

const personalBoardColumns: typeof boardColumns = [
  { label: 'Not Started Yet', target: 'Planning', statuses: ['Planning'] },
  { label: 'In Progress', target: 'InProgress', statuses: ['InProgress', 'RevisionRequired'] },
  {
    label: 'Waiting',
    target: 'WaitingForInformation',
    statuses: ['WaitingForInformation', 'WaitingForSales', 'OnHold'],
  },
  { label: 'Client Review', target: 'ClientReview', statuses: ['ClientReview'] },
  {
    label: 'Internal Review',
    target: 'InternalReview',
    statuses: ['InternalReview', 'ReadyToIssue'],
  },
  { label: 'Issued', target: 'Issued', statuses: ['Issued'] },
  { label: 'Completed', target: 'Completed', statuses: ['Completed'] },
];

function ProjectFilters({
  searchParams,
  setSearchParams,
  personal = false,
  salesUsers = [],
  designers = [],
}: {
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  personal?: boolean;
  salesUsers?: AppUser[];
  designers?: AppUser[];
}) {
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };
  return (
    <div className="filter-bar">
      <label className="filter-search">
        <Search size={16} />
        <input
          type="search"
          aria-label="Search projects"
          placeholder="Search code, project, client or CRM reference"
          value={searchParams.get('search') ?? ''}
          onChange={(event) => update('search', event.target.value)}
        />
      </label>
      <label>
        <Filter size={15} />
        <select
          aria-label="Filter by status"
          value={searchParams.get('status') ?? ''}
          onChange={(event) => update('status', event.target.value)}
        >
          <option value="">All statuses</option>
          {projectStatuses
            .filter(
              (status) =>
                !personal ||
                [
                  'Planning',
                  'InProgress',
                  'ClientReview',
                  'WaitingForInformation',
                  'WaitingForSales',
                  'OnHold',
                  'InternalReview',
                  'RevisionRequired',
                  'ReadyToIssue',
                  'Issued',
                  'Completed',
                  'OnHold',
                  'Archived',
                  'Cancelled',
                ].includes(status),
            )
            .map((status) => (
              <option key={status} value={status}>
                {personal ? personalStatusLabel(status) : statusLabels[status]}
              </option>
            ))}
        </select>
      </label>
      <label>
        <UsersRound size={15} />
        <select
          aria-label="Filter by salesperson"
          value={searchParams.get('salesOwnerId') ?? ''}
          onChange={(event) => update('salesOwnerId', event.target.value)}
        >
          <option value="">All salespeople</option>
          {salesUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        <SlidersHorizontal size={15} />
        <select
          aria-label="Filter by priority"
          value={searchParams.get('priority') ?? ''}
          onChange={(event) => update('priority', event.target.value)}
        >
          <option value="">All priorities</option>
          <option>Urgent</option>
          <option>High</option>
          <option>Normal</option>
        </select>
      </label>
      {designers.length ? (
        <label>
          <UsersRound size={15} />
          <select
            aria-label="Filter by Lighting Designer"
            value={searchParams.get('designerId') ?? ''}
            onChange={(event) => update('designerId', event.target.value)}
          >
            <option value="">All Lighting Designers</option>
            {designers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        <select
          aria-label="Sort projects"
          value={searchParams.get('sortBy') ?? 'requiredDate'}
          onChange={(event) => update('sortBy', event.target.value)}
        >
          <option value="requiredDate">Due date</option>
          <option value="priority">Priority</option>
          <option value="createdDate">Created date</option>
          <option value="salesOwner">Salesperson</option>
        </select>
      </label>
      {searchParams.toString() ? (
        <button
          className="button ghost small"
          type="button"
          onClick={() => setSearchParams({}, { replace: true })}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

export function ProjectsScreen({
  unassignedOnly = false,
  archiveOnly = false,
}: {
  unassignedOnly?: boolean;
  archiveOnly?: boolean;
}) {
  const { currentUser, integrationStatus } = useAppContext();
  const personal = integrationStatus.workspaceVariant === 'personal';
  const manager = !personal && (currentUser.role === 'LineManager' || currentUser.role === 'Admin');
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<ProjectView>(() => {
    if (unassignedOnly || archiveOnly) return 'cards';
    const stored = localStorage.getItem('scli.projectView');
    return stored === 'board' || stored === 'list' || stored === 'cards' || stored === 'sales'
      ? stored
      : 'board';
  });
  const [assigning, setAssigning] = useState<Project | null>(null);
  const [savedViews, setSavedViews] = useState<Array<{ name: string; query: string }>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('scli.savedProjectViews') ?? '[]') as unknown;
      return Array.isArray(value)
        ? value
            .filter(
              (item): item is { name: string; query: string } =>
                typeof item === 'object' &&
                item !== null &&
                typeof (item as { name?: unknown }).name === 'string' &&
                typeof (item as { query?: unknown }).query === 'string',
            )
            .slice(0, 6)
        : [];
    } catch {
      return [];
    }
  });
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const preset = searchParams.get('preset') ?? searchParams.get('view');
  const today = new Date();
  const todayText = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const activeStatuses =
    'NewRequest,UnderReview,Unassigned,Assigned,InProgress,WaitingForInformation,WaitingForSales,InternalReview,RevisionRequired,ReadyToIssue,Issued,OnHold';
  const filters = {
    search: searchParams.get('search') ?? undefined,
    status: archiveOnly
      ? 'Archived'
      : unassignedOnly
        ? 'NewRequest,UnderReview,Unassigned'
        : preset === 'active'
          ? activeStatuses
          : preset === 'waiting-sales'
            ? 'WaitingForSales,WaitingForInformation'
            : preset === 'unassigned'
              ? 'NewRequest,UnderReview,Unassigned'
              : preset === 'overdue'
                ? activeStatuses
                : (searchParams.get('status') ?? undefined),
    priority: preset === 'urgent' ? 'Urgent' : (searchParams.get('priority') ?? undefined),
    salesOwnerId: searchParams.get('salesOwnerId') ?? undefined,
    designerId: searchParams.get('designerId') ?? undefined,
    dueFrom: preset === 'due-week' ? todayText : (searchParams.get('dueFrom') ?? undefined),
    dueTo:
      preset === 'due-week'
        ? nextWeek.toISOString().slice(0, 10)
        : preset === 'overdue'
          ? yesterday.toISOString().slice(0, 10)
          : (searchParams.get('dueTo') ?? undefined),
    sortBy: searchParams.get('sortBy') ?? 'requiredDate',
    sortDirection: searchParams.get('sortDirection') ?? 'asc',
  };
  const projectsQuery = useQuery({
    queryKey: ['projects', currentUser.id, unassignedOnly, archiveOnly, filters],
    queryFn: () => api.projects(filters),
  });
  const salesQuery = useQuery({
    queryKey: ['sales-users'],
    queryFn: api.salesUsers,
    enabled: personal,
  });
  const filterWorkloadsQuery = useQuery({
    queryKey: ['workloads', 'project-filters'],
    queryFn: api.workloads,
    enabled: manager,
  });
  const projects = projectsQuery.data ?? [];
  const canMove = !archiveOnly && (personal || currentUser.role === 'Designer' || manager);

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProjectStatus }) =>
      api.changeStatus(id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['projects'] });
      const snapshots = queryClient.getQueriesData<Project[]>({ queryKey: ['projects'] });
      queryClient.setQueriesData<Project[]>({ queryKey: ['projects'] }, (current) =>
        current?.map((project) => (project.id === id ? { ...project, status } : project)),
      );
      return { snapshots };
    },
    onError: (error, _variables, context) => {
      for (const [key, value] of context?.snapshots ?? []) queryClient.setQueryData(key, value);
      showToast(
        `${error instanceof Error ? error.message : 'Move rejected.'} The board was restored.`,
        'error',
      );
    },
    onSuccess: (updated) =>
      showToast(
        `${updated.projectName} moved to ${personal ? personalStatusLabel(updated.status) : statusLabels[updated.status]}.`,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const changeView = (next: ProjectView) => {
    setView(next);
    localStorage.setItem('scli.projectView', next);
  };

  const availableStatuses = (project: Project) =>
    [project.status, ...allowedStatusTransitions[project.status]].filter(
      (status, index, values) =>
        values.indexOf(status) === index &&
        canRoleSetStatus(currentUser.role, project.status, status),
    );

  const grouped = useMemo(
    () =>
      (personal ? personalBoardColumns : boardColumns).map((column) => ({
        ...column,
        projects: projects.filter((project) => column.statuses.includes(project.status)),
      })),
    [personal, projects],
  );

  return (
    <>
      <PageHeader
        eyebrow={
          archiveOnly
            ? 'Completed work'
            : unassignedOnly
              ? 'Assignment queue'
              : currentUser.role === 'Sales'
                ? 'Sales workspace'
                : 'Delivery workspace'
        }
        title={
          archiveOnly
            ? 'Project archive'
            : unassignedOnly
              ? 'Unassigned projects'
              : currentUser.role === 'Sales'
                ? 'My requests'
                : 'My projects'
        }
        description={
          archiveOnly
            ? 'A clean record of archived lighting projects and their final files.'
            : unassignedOnly
              ? 'Review new requests, balance workload and assign the right Lighting Designer.'
              : 'Switch views, filter the portfolio and keep every delivery moving.'
        }
        actions={
          !unassignedOnly && !archiveOnly ? (
            <div className="project-header-actions">
              {personal ? (
                <Link className="button secondary" to="/import-projects">
                  <FolderInput /> Import Existing
                </Link>
              ) : null}
              <div className="view-switcher" role="group" aria-label="Project view">
                <button
                  type="button"
                  className={view === 'board' ? 'active' : ''}
                  onClick={() => changeView('board')}
                  title="Board view"
                >
                  <Columns3 size={17} />
                  <span>Board</span>
                </button>
                <button
                  type="button"
                  className={view === 'list' ? 'active' : ''}
                  onClick={() => changeView('list')}
                  title="List view"
                >
                  <List size={17} />
                  <span>List</span>
                </button>
                <button
                  type="button"
                  className={view === 'cards' ? 'active' : ''}
                  onClick={() => changeView('cards')}
                  title="Card view"
                >
                  <LayoutGrid size={17} />
                  <span>Cards</span>
                </button>
                {personal ? (
                  <button
                    type="button"
                    className={view === 'sales' ? 'active' : ''}
                    onClick={() => changeView('sales')}
                    title="Group by salesperson"
                  >
                    <UsersRound size={17} />
                    <span>By Sales</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : undefined
        }
      />
      {!unassignedOnly && !archiveOnly && !personal ? (
        <div className="saved-view-bar">
          <span>Quick views</span>
          {(
            [
              ['active', 'Active'],
              ['due-week', 'Due this week'],
              ['urgent', 'Urgent'],
              ['waiting-sales', 'Waiting for Sales'],
              ...(manager ? [['unassigned', 'Unassigned']] : []),
            ] as Array<[string, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={preset === key ? 'active' : ''}
              onClick={() => setSearchParams({ preset: key }, { replace: true })}
            >
              {label}
            </button>
          ))}
          {savedViews.map((saved) => (
            <button
              key={`${saved.name}-${saved.query}`}
              type="button"
              className={searchParams.toString() === saved.query ? 'active saved' : 'saved'}
              onClick={() => setSearchParams(new URLSearchParams(saved.query), { replace: true })}
              title="Saved filter"
            >
              {saved.name}
            </button>
          ))}
          {searchParams.toString() ? (
            <button
              type="button"
              className="save-view-button"
              onClick={() => {
                const name = window.prompt('Name this project view');
                if (!name?.trim()) return;
                const next = [
                  ...savedViews,
                  { name: name.trim().slice(0, 30), query: searchParams.toString() },
                ].slice(-6);
                setSavedViews(next);
                localStorage.setItem('scli.savedProjectViews', JSON.stringify(next));
                showToast('Project view saved.');
              }}
            >
              <BookmarkPlus size={14} /> Save view
            </button>
          ) : null}
        </div>
      ) : null}
      <ProjectFilters
        searchParams={searchParams}
        setSearchParams={setSearchParams}
        personal={personal}
        salesUsers={salesQuery.data ?? []}
        designers={filterWorkloadsQuery.data?.map((item) => item.designer) ?? []}
      />

      {projectsQuery.isLoading ? <LoadingState label="Loading projects…" /> : null}
      {projectsQuery.error ? (
        <ErrorState
          message={(projectsQuery.error as Error).message}
          onRetry={() => projectsQuery.refetch()}
        />
      ) : null}
      {!projectsQuery.isLoading && !projects.length ? (
        <EmptyState
          kind={searchParams.toString() ? 'search' : 'empty'}
          title={
            archiveOnly
              ? 'Archive is empty'
              : unassignedOnly
                ? 'The queue is clear'
                : 'No projects found'
          }
          description={
            searchParams.toString()
              ? 'Try changing or clearing the current filters.'
              : 'Projects that match your role will appear here.'
          }
        />
      ) : null}

      {projects.length && (unassignedOnly || archiveOnly || view === 'cards') ? (
        <div className="project-grid project-grid-three">
          {projects.map((project) =>
            manager && project.assignedDesignerId === null ? (
              <ProjectCard key={project.id} project={project} onAssign={setAssigning} />
            ) : (
              <ProjectCard key={project.id} project={project} />
            ),
          )}
        </div>
      ) : null}

      {projects.length && !unassignedOnly && !archiveOnly && view === 'sales' ? (
        <div className="sales-project-groups">
          {[...new Set(projects.map((project) => project.salesOwnerNameSnapshot || 'Direct'))]
            .sort((a, b) => a.localeCompare(b))
            .map((salesperson) => {
              const owned = projects.filter(
                (project) => (project.salesOwnerNameSnapshot || 'Direct') === salesperson,
              );
              return (
                <section className="content-card" key={salesperson}>
                  <div
                    className={`sales-group-heading ${salesTone(owned[0]?.salesOwnerId ?? salesperson)}`}
                  >
                    <span>
                      <UsersRound />
                    </span>
                    <div>
                      <h2>{salesperson}</h2>
                      <p>
                        {owned.length} project(s) ·{' '}
                        {owned.filter((project) => project.status === 'WaitingForSales').length}{' '}
                        waiting for Sales
                      </p>
                    </div>
                  </div>
                  <div className="project-grid project-grid-three">
                    {owned.map((project) => (
                      <ProjectCard key={project.id} project={project} />
                    ))}
                  </div>
                </section>
              );
            })}
        </div>
      ) : null}

      {projects.length && !unassignedOnly && !archiveOnly && view === 'list' ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>{personal ? 'Salesperson / Scope' : 'Owner / Lighting Designer'}</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Priority</th>
                <th>Required</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <Link to={`/projects/${project.id}`} title={project.projectName}>
                      <strong>{project.projectName}</strong>
                      <span title={`${project.projectCode} · ${project.clientName}`}>
                        {project.projectCode} · {project.clientName}
                      </span>
                    </Link>
                  </td>
                  <td>
                    <strong
                      className={
                        personal
                          ? `sales-chip ${salesTone(project.salesOwnerId || project.salesOwnerNameSnapshot)}`
                          : undefined
                      }
                      title={
                        personal
                          ? project.salesOwnerNameSnapshot || 'Direct'
                          : project.salesOwnerNameSnapshot
                      }
                    >
                      {personal
                        ? project.salesOwnerNameSnapshot || 'Direct'
                        : project.salesOwnerNameSnapshot}
                    </strong>
                    <span>
                      {personal
                        ? `${project.services?.length ?? 0} deliverables`
                        : (project.assignedDesignerNameSnapshot ?? 'Unassigned')}
                    </span>
                  </td>
                  <td>
                    <StatusBadge
                      status={project.status}
                      label={personal ? personalStatusLabel(project.status) : undefined}
                    />
                  </td>
                  <td className="table-progress">
                    <ProgressBar value={project.progressPercent} />
                  </td>
                  <td>
                    <PriorityBadge priority={project.priority} />
                  </td>
                  <td>
                    <Deadline date={project.requiredDeliveryDate} />
                  </td>
                  <td>
                    {manager && !project.assignedDesignerId ? (
                      <button
                        className="icon-button accent"
                        type="button"
                        onClick={() => setAssigning(project)}
                        aria-label={`Assign ${project.projectName}`}
                      >
                        <UserRoundPlus size={17} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {projects.length && !unassignedOnly && !archiveOnly && view === 'board' ? (
        <div
          className="kanban-viewport"
          role="region"
          aria-label="Project status board"
          tabIndex={0}
        >
          <div className="kanban-board">
            {grouped.map((column) => (
              <section
                className="kanban-column"
                key={column.label}
                onDragOver={(event) => {
                  if (canMove) event.preventDefault();
                }}
                onDrop={() => {
                  const project = projects.find((item) => item.id === draggedId);
                  if (project && canMove && project.status !== column.target)
                    statusMutation.mutate({ id: project.id, status: column.target });
                  setDraggedId(null);
                }}
              >
                <header>
                  <span className={`column-dot status-${column.target}`} />
                  <strong>{column.label}</strong>
                  <span>{column.projects.length}</span>
                </header>
                <div className="kanban-cards">
                  {column.projects.map((project) => (
                    <article
                      className="kanban-card"
                      key={project.id}
                      draggable={canMove}
                      onDragStart={() => setDraggedId(project.id)}
                      onDragEnd={() => setDraggedId(null)}
                    >
                      <div>
                        <span className="project-code" title={project.projectCode}>
                          {project.projectCode}
                        </span>
                        <PriorityBadge priority={project.priority} />
                      </div>
                      <Link to={`/projects/${project.id}`} title={project.projectName}>
                        {project.projectName}
                      </Link>
                      <span title={project.clientName}>{project.clientName}</span>
                      <ProgressBar value={project.progressPercent} />
                      <div className="kanban-meta">
                        <Deadline date={project.requiredDeliveryDate} />
                        <span>
                          {personal
                            ? `${project.services?.length ?? 0} deliverables`
                            : (project.assignedDesignerNameSnapshot ?? 'Unassigned')}
                        </span>
                      </div>
                      {canMove ? (
                        <label className="keyboard-move">
                          Move project<span className="sr-only"> {project.projectName}</span>
                          <select
                            aria-label={`Move ${project.projectName}`}
                            value={project.status}
                            onChange={(event) =>
                              statusMutation.mutate({
                                id: project.id,
                                status: event.target.value as ProjectStatus,
                              })
                            }
                          >
                            {availableStatuses(project).map((status) => (
                              <option key={status} value={status}>
                                {personal ? personalStatusLabel(status) : statusLabels[status]}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </article>
                  ))}
                  {!column.projects.length ? (
                    <div className="column-empty">Drop permitted projects here</div>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      <AssignmentDrawer project={assigning} onClose={() => setAssigning(null)} />
    </>
  );
}

export function UnassignedScreen() {
  return <ProjectsScreen unassignedOnly />;
}

export function ArchiveScreen() {
  return <ProjectsScreen archiveOnly />;
}
