import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Project, ProjectStatus } from '@scli/domain';
import {
  SctDiscarded as FolderX,
  SctMore as MoreVertical,
  SctRestore as RotateCcw,
} from '../../components/common/SctIcons';
import {
  Archive,
  Clock3,
  Folder,
  FolderCheck,
  GripVertical,
  Pencil,
  Trash2,
} from '../../components/common/SctIcons';
import { V4Pagination } from '../../components/common/V4Pagination';
import { V4StatusPill } from '../../components/common/V4StatusPill';
import { formatProjectStatus } from '../../components/project/statusDisplay';
import {
  PLANNER_STATUS_ORDER,
  canDirectlyMove,
  directStatusTargets,
  dueCopy,
  folderCopy,
  formatProjectTimestamp,
  pageSlice,
  priorityTone,
  statusTone,
} from './projectsViewModel';

export type ProjectActionCallbacks = {
  onOpen: (project: Project) => void;
  onEdit: (project: Project) => void;
  onOpenFolder: (project: Project) => void;
  onArchive: (project: Project) => void;
  onRestore: (project: Project) => void;
  onRemove: (project: Project) => void;
  onMove: (project: Project, status: ProjectStatus) => void;
};

type SharedViewProps = ProjectActionCallbacks & {
  projects: Project[];
  now: Date;
  activeProjectId: string | null;
  pendingProjectIds: ReadonlySet<string>;
  actionPending: boolean;
  manager: boolean;
  openMenuId: string | null;
  onToggleMenu: (projectId: string | null) => void;
};

function Progress({ value }: { value: number }) {
  return (
    <div className="v4-project-progress" aria-label={`Progress ${value}%`}>
      <span>{value}%</span>
      <i aria-hidden="true">
        <b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </i>
    </div>
  );
}

function ActiveSessionBadge() {
  return (
    <span className="v4-project-active-session">
      <Clock3 aria-hidden="true" /> Active Session
    </span>
  );
}

function FolderState({ project, compact = false }: { project: Project; compact?: boolean }) {
  const folder = folderCopy(project);
  const Icon = folder.state === 'missing' ? FolderX : FolderCheck;
  return (
    <span className="v4-project-folder" data-state={folder.state} title={folder.detail}>
      <Icon aria-hidden="true" />
      <span>
        <strong>{folder.label}</strong>
        {!compact ? <small>{folder.detail}</small> : null}
      </span>
    </span>
  );
}

function ProjectActionsMenu({
  project,
  open,
  pending,
  manager,
  callbacks,
  onToggle,
}: {
  project: Project;
  open: boolean;
  pending: boolean;
  manager: boolean;
  callbacks: ProjectActionCallbacks;
  onToggle: () => void;
}) {
  const targets = directStatusTargets(project);
  const run = (action: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    action();
  };
  return (
    <div className="v4-project-actions">
      <button
        type="button"
        className="v4-project-actions__trigger"
        aria-label={`Actions for ${project.projectName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={run(onToggle)}
      >
        <MoreVertical aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="v4-project-actions__menu"
          role="menu"
          aria-label={`${project.projectName} actions`}
        >
          <button type="button" role="menuitem" onClick={run(() => callbacks.onOpen(project))}>
            Open Project
          </button>
          <button type="button" role="menuitem" onClick={run(() => callbacks.onEdit(project))}>
            <Pencil aria-hidden="true" /> Edit
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!project.projectFolderPath}
            title={project.projectFolderPath ? undefined : 'No project folder path is available.'}
            onClick={run(() => callbacks.onOpenFolder(project))}
          >
            <Folder aria-hidden="true" /> Open Folder
          </button>
          {targets.length ? (
            <div className="v4-project-actions__move" role="group" aria-label="Move to Status">
              <span>Move to Status</span>
              {targets.map((status) => (
                <button
                  key={status}
                  type="button"
                  role="menuitem"
                  onClick={run(() => callbacks.onMove(project, status))}
                >
                  {formatProjectStatus(status)}
                </button>
              ))}
            </div>
          ) : null}
          {manager && project.status !== 'Archived' ? (
            <button type="button" role="menuitem" onClick={run(() => callbacks.onArchive(project))}>
              <Archive aria-hidden="true" /> Archive
            </button>
          ) : null}
          {manager && project.status === 'Archived' ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={run(() => callbacks.onRestore(project))}
              >
                <RotateCcw aria-hidden="true" /> Restore
              </button>
              <button
                type="button"
                role="menuitem"
                className="v4-project-actions__danger"
                onClick={run(() => callbacks.onRemove(project))}
              >
                <Trash2 aria-hidden="true" /> Remove
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function callbacksFrom(props: SharedViewProps): ProjectActionCallbacks {
  return {
    onOpen: props.onOpen,
    onEdit: props.onEdit,
    onOpenFolder: props.onOpenFolder,
    onArchive: props.onArchive,
    onRestore: props.onRestore,
    onRemove: props.onRemove,
    onMove: props.onMove,
  };
}

export function ProjectsTable(props: SharedViewProps) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(props.projects.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = pageSlice(props.projects, currentPage, pageSize);
  const callbacks = callbacksFrom(props);
  return (
    <section
      className="v4-projects-table"
      aria-label="Projects table view"
      data-testid="projects-table-view"
    >
      <div className="v4-projects-table__scroll">
        <table>
          <thead>
            <tr>
              {[
                'Project',
                'Client',
                'Type',
                'Status',
                'Priority',
                'Due Date',
                'Progress',
                'Folder',
                'Last Updated',
                'Actions',
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((project) => {
              const due = dueCopy(project.requiredDeliveryDate, props.now);
              const pending = props.pendingProjectIds.has(project.id);
              return (
                <tr
                  key={project.id}
                  tabIndex={0}
                  aria-label={`Open ${project.projectName}`}
                  aria-busy={pending || undefined}
                  onClick={() => props.onOpen(project)}
                  onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.key === 'Enter') props.onOpen(project);
                  }}
                >
                  <td>
                    <span className="v4-project-identity">
                      <strong>{project.projectCode}</strong>
                      <span>{project.projectName}</span>
                      {props.activeProjectId === project.id ? <ActiveSessionBadge /> : null}
                    </span>
                  </td>
                  <td>{project.clientName || '—'}</td>
                  <td>{project.projectType || '—'}</td>
                  <td>
                    <V4StatusPill variant={statusTone(project.status)}>
                      {formatProjectStatus(project.status)}
                    </V4StatusPill>
                  </td>
                  <td>
                    <V4StatusPill variant={priorityTone(project.priority)}>
                      {project.priority}
                    </V4StatusPill>
                  </td>
                  <td>
                    <span className="v4-project-due" data-state={due.state}>
                      <strong>{due.label}</strong>
                      <small>{due.detail}</small>
                    </span>
                  </td>
                  <td>
                    <Progress value={project.progressPercent} />
                  </td>
                  <td>
                    <FolderState project={project} />
                  </td>
                  <td>{formatProjectTimestamp(project.updatedAt)}</td>
                  <td>
                    <ProjectActionsMenu
                      project={project}
                      open={props.openMenuId === project.id}
                      pending={pending || props.actionPending}
                      manager={props.manager}
                      callbacks={callbacks}
                      onToggle={() =>
                        props.onToggleMenu(props.openMenuId === project.id ? null : project.id)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer className="v4-projects-pagination">
        <label>
          Show
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
          </select>
          per page
        </label>
        <V4Pagination
          pageCount={pageCount}
          currentPage={currentPage}
          onChange={setPage}
          ariaLabel="Project table pages"
        />
        <span>
          {props.projects.length ? currentPage * pageSize + 1 : 0}–
          {Math.min((currentPage + 1) * pageSize, props.projects.length)} of {props.projects.length}{' '}
          projects
        </span>
      </footer>
    </section>
  );
}

function ProjectGridCard({ project, props }: { project: Project; props: SharedViewProps }) {
  const due = dueCopy(project.requiredDeliveryDate, props.now);
  const pending = props.pendingProjectIds.has(project.id);
  return (
    <article className="v4-project-grid-card" aria-busy={pending || undefined}>
      <header>
        <button
          type="button"
          className="v4-project-card-open"
          aria-label={`Open ${project.projectName}`}
          onClick={() => props.onOpen(project)}
        >
          <span className="v4-project-identity">
            <strong>{project.projectCode}</strong>
            <span>{project.projectName}</span>
          </span>
        </button>
        <ProjectActionsMenu
          project={project}
          open={props.openMenuId === project.id}
          pending={pending || props.actionPending}
          manager={props.manager}
          callbacks={callbacksFrom(props)}
          onToggle={() => props.onToggleMenu(props.openMenuId === project.id ? null : project.id)}
        />
      </header>
      {props.activeProjectId === project.id ? <ActiveSessionBadge /> : null}
      <p>
        {project.clientName || '—'} <span aria-hidden="true">·</span> {project.projectType || '—'}
      </p>
      <div className="v4-project-grid-card__pills">
        <V4StatusPill variant={statusTone(project.status)}>
          {formatProjectStatus(project.status)}
        </V4StatusPill>
        <V4StatusPill variant={priorityTone(project.priority)}>{project.priority}</V4StatusPill>
      </div>
      <div className="v4-project-grid-card__due">
        <span>Due Date</span>
        <span className="v4-project-due" data-state={due.state}>
          <strong>{due.label}</strong>
          <small>{due.detail}</small>
        </span>
      </div>
      <Progress value={project.progressPercent} />
      <footer>
        <FolderState project={project} compact />
        <span title="Sales Owner">{project.salesOwnerNameSnapshot || '—'}</span>
      </footer>
    </article>
  );
}

export function ProjectsCards(props: SharedViewProps) {
  const [page, setPage] = useState(0);
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(props.projects.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  return (
    <section
      className="v4-projects-cards"
      aria-label="Projects cards view"
      data-testid="projects-cards-view"
    >
      <div className="v4-projects-cards__grid">
        {pageSlice(props.projects, currentPage, pageSize).map((project) => (
          <ProjectGridCard key={project.id} project={project} props={props} />
        ))}
      </div>
      <footer className="v4-projects-pagination">
        <span>{props.projects.length} projects</span>
        <V4Pagination
          pageCount={pageCount}
          currentPage={currentPage}
          onChange={setPage}
          ariaLabel="Project card pages"
        />
        <span>
          {props.projects.length ? currentPage * pageSize + 1 : 0}–
          {Math.min((currentPage + 1) * pageSize, props.projects.length)} of {props.projects.length}{' '}
          projects
        </span>
      </footer>
    </section>
  );
}

function PlannerCard({
  project,
  props,
  overlay = false,
  onOpen,
}: {
  project: Project;
  props: SharedViewProps;
  overlay?: boolean;
  onOpen?: () => void;
}) {
  const draggable =
    directStatusTargets(project).length > 0 && !props.pendingProjectIds.has(project.id);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: project.id,
    disabled: overlay || !draggable,
  });
  const due = dueCopy(project.requiredDeliveryDate, props.now);
  const style =
    transform && !overlay
      ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
      : undefined;
  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      className={`v4-planner-card${overlay ? ' v4-planner-card--overlay' : ''}${isDragging ? ' v4-planner-card--dragging' : ''}`}
      style={style}
      data-draggable={draggable}
      aria-busy={props.pendingProjectIds.has(project.id) || undefined}
    >
      <header>
        {overlay ? (
          <GripVertical aria-hidden="true" className="v4-planner-card__grip" />
        ) : (
          <button
            type="button"
            className="v4-planner-card__drag-handle"
            aria-label={`Move ${project.projectName}`}
            disabled={!draggable}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden="true" className="v4-planner-card__grip" />
          </button>
        )}
        <button
          type="button"
          className="v4-project-card-open"
          aria-label={`Open ${project.projectName}`}
          onClick={onOpen}
        >
          <span className="v4-project-identity">
            <strong>{project.projectCode}</strong>
            <span>{project.projectName}</span>
          </span>
        </button>
        {!overlay ? (
          <ProjectActionsMenu
            project={project}
            open={props.openMenuId === project.id}
            pending={props.pendingProjectIds.has(project.id) || props.actionPending}
            manager={props.manager}
            callbacks={callbacksFrom(props)}
            onToggle={() => props.onToggleMenu(props.openMenuId === project.id ? null : project.id)}
          />
        ) : null}
      </header>
      {props.activeProjectId === project.id ? <ActiveSessionBadge /> : null}
      <p>
        {project.clientName || '—'} <span aria-hidden="true">·</span> {project.projectType || '—'}
      </p>
      <span className="v4-project-due" data-state={due.state}>
        <strong>{due.label}</strong>
        <small>{due.detail}</small>
      </span>
      <Progress value={project.progressPercent} />
      <footer>
        <V4StatusPill variant={priorityTone(project.priority)}>{project.priority}</V4StatusPill>
        <FolderState project={project} compact />
      </footer>
      {props.pendingProjectIds.has(project.id) ? (
        <span className="v4-planner-card__saving" role="status">
          Saving status…
        </span>
      ) : null}
    </article>
  );
}

function PlannerLane({
  status,
  projects,
  props,
  activeProject,
  overStatus,
  onOpen,
}: {
  status: ProjectStatus;
  projects: Project[];
  props: SharedViewProps;
  activeProject: Project | null;
  overStatus: ProjectStatus | null;
  onOpen: (project: Project) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status}` });
  let dropState = 'idle';
  if (activeProject) {
    dropState =
      activeProject.status === status
        ? 'neutral'
        : canDirectlyMove(activeProject, status)
          ? 'valid'
          : 'invalid';
  }
  if (isOver && overStatus === status) dropState += '-over';
  return (
    <section
      ref={setNodeRef}
      className="v4-planner-lane"
      data-status={status}
      data-drop-state={dropState}
    >
      <header>
        <i data-tone={statusTone(status)} aria-hidden="true" />
        <strong>{formatProjectStatus(status)}</strong>
        <span>{projects.length}</span>
      </header>
      <div className="v4-planner-lane__cards">
        {projects.map((project) => (
          <PlannerCard
            key={project.id}
            project={project}
            props={props}
            onOpen={() => onOpen(project)}
          />
        ))}
        {!projects.length ? <p>No projects in this status</p> : null}
      </div>
    </section>
  );
}

function statusFromDroppable(id: string | number | null | undefined): ProjectStatus | null {
  if (typeof id !== 'string' || !id.startsWith('status:')) return null;
  const status = id.slice('status:'.length) as ProjectStatus;
  return PLANNER_STATUS_ORDER.includes(status) ? status : null;
}

export function ProjectsPlanner(props: SharedViewProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<ProjectStatus | null>(null);
  const justDragged = useRef<string | null>(null);
  const reducedMotion =
    document.documentElement.classList.contains('v4-reduced-motion') ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const activeProject = props.projects.find((project) => project.id === activeId) ?? null;
  const finish = (event: DragEndEvent) => {
    const project = props.projects.find((item) => item.id === String(event.active.id));
    const target = statusFromDroppable(event.over?.id);
    justDragged.current = project?.id ?? null;
    window.setTimeout(() => {
      justDragged.current = null;
    }, 0);
    setActiveId(null);
    setOverStatus(null);
    if (project && target && canDirectlyMove(project, target)) props.onMove(project, target);
  };
  const open = (project: Project) => {
    if (justDragged.current !== project.id && activeId !== project.id) props.onOpen(project);
  };
  return (
    <section
      className="v4-projects-planner"
      aria-label="Projects planner view"
      data-testid="projects-planner-view"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(event: DragStartEvent) => {
          setActiveId(String(event.active.id));
          props.onToggleMenu(null);
        }}
        onDragOver={(event: DragOverEvent) => setOverStatus(statusFromDroppable(event.over?.id))}
        onDragCancel={() => {
          setActiveId(null);
          setOverStatus(null);
        }}
        onDragEnd={finish}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Press space or enter to pick up a project. Move it to a valid status lane, then press space or enter to save. Press escape to cancel.',
          },
        }}
      >
        <div className="v4-projects-planner__board">
          {PLANNER_STATUS_ORDER.map((status) => (
            <PlannerLane
              key={status}
              status={status}
              projects={props.projects.filter((project) => project.status === status)}
              props={props}
              activeProject={activeProject}
              overStatus={overStatus}
              onOpen={open}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={reducedMotion ? null : { duration: 180, easing: 'ease' }}>
          {activeProject ? <PlannerCard project={activeProject} props={props} overlay /> : null}
        </DragOverlay>
      </DndContext>
      <p className="v4-projects-planner__hint">
        Drag a project to a valid status lane. Use its Actions menu for keyboard status movement.
      </p>
    </section>
  );
}

export function ProjectsEmpty({ children }: { children: ReactNode }) {
  return <div className="v4-projects-empty">{children}</div>;
}
