import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Pause, Play, RotateCcw, Square, X } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { workSessionState, type Project } from '@scli/domain';
import { api, ApiError } from '../api';
import { useToast } from './toast';
import { activeSessionSeconds, formatElapsed } from '../work-session-time';
import { formatDate } from './ui';

/**
 * P2-UX-02-H1 — Owner-reconciled Work Session Shell UX.
 *
 * The database row is the single authority (endedAt === null = active;
 * pausedAt !== null = PAUSED). The UI clock is display-only: it ticks to
 * refresh derived elapsed presentation and is never a source of truth. On
 * reload/restart the active session is recovered from the Personal API;
 * nothing is reconstructed from localStorage and nothing is auto-started or
 * auto-stopped.
 *
 * Three presentation surfaces derive from ONE shared authority hook:
 *   1. Extended fixed sidebar footer card (PersonalWorkSessionTimer) — changes
 *      IN PLACE by state; no flyout required for Start/Pause/Resume/Stop.
 *   2. Shell-level sticky Top Tracking Bar (WorkSessionTopBar).
 *   3. Minimal sidebar direct controls + status (WorkSessionMinimalControls).
 *
 * Owner-approved status color contract: GREEN = RUNNING, AMBER = PAUSED,
 * GRAY = INACTIVE, RED reserved for destructive Stop/errors.
 *
 * This is a separate durable model and deliberately does NOT reuse the Team
 * TimeTrackingService or its status-changing behavior.
 */

const ACTIVE_QUERY_KEY = ['personal-work-session-active'] as const;

function useCurrentProjectId(): string | null {
  const location = useLocation();
  const params = useParams();
  const match = location.pathname.match(/^\/projects\/([^/]+)/);
  return match?.[1] ?? params.id ?? null;
}

/**
 * Self-contained Global Start control: a trigger button plus a compact Project
 * chooser. Owns its own refs and popover state so refs are never passed through
 * props during render. Used in Global INACTIVE (Extended + Minimal) contexts.
 * Never auto-starts a Project.
 */
function GlobalStartControl({
  onStart,
  pending,
  buttonClassName,
  buttonLabel,
  iconOnly = false,
}: {
  onStart: (project: Project) => void;
  pending: boolean;
  buttonClassName?: string;
  buttonLabel?: string;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const chooserRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects(),
    enabled: open,
  });

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Outside click + Escape close the chooser.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (chooserRef.current?.contains(event.target as Node)) return;
      if (buttonRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // Sort existing projects by updatedAt desc (trustworthy existing recency
  // signal) and cap the visible list. No invented persistence model.
  const projects = (projectsQuery.data ?? [])
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 8);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  const choose = (project: Project) => {
    setOpen(false);
    onStart(project);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={iconOnly ? 'Start work' : undefined}
        title={iconOnly ? 'Start work' : undefined}
        onClick={toggle}
        disabled={pending}
      >
        <Play size={iconOnly ? 16 : 14} aria-hidden="true" />
        {iconOnly ? null : pending ? 'Starting…' : (buttonLabel ?? 'Start Work')}
      </button>
      {open
        ? createPortal(
            <div
              ref={chooserRef}
              className="work-session-chooser"
              role="dialog"
              aria-label="Choose project to start work"
              style={
                anchorRect
                  ? {
                      left: Math.min(anchorRect.left, window.innerWidth - 280),
                      top: anchorRect.bottom + 8,
                    }
                  : undefined
              }
            >
              <div className="work-session-chooser-heading">
                <strong>Start work on…</strong>
              </div>
              {projects.length === 0 ? (
                <p className="work-session-chooser-empty">
                  {projectsQuery.isLoading ? 'Loading projects…' : 'No projects available.'}
                </p>
              ) : (
                <ul className="work-session-chooser-list">
                  {projects.map((project) => (
                    <li key={project.id}>
                      <button type="button" onClick={() => choose(project)}>
                        <span className="work-session-chooser-code">{project.projectCode}</span>
                        <span className="work-session-chooser-name" title={project.projectName}>
                          {project.projectName}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * Single shared authority for the active Personal WorkSession. All surfaces
 * call this hook; React Query dedupes the network request by key, so there is
 * exactly one active-session authority and one persisted truth.
 */
export function useActiveWorkSession() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const projectId = useCurrentProjectId();
  const [now, setNow] = useState(() => Date.now());

  const activeQuery = useQuery({
    queryKey: ACTIVE_QUERY_KEY,
    queryFn: api.activeWorkSession,
    refetchInterval: 30_000,
  });
  const active = activeQuery.data ?? null;

  // Current project (for Start Work / Switch labels) when viewing a project.
  const currentProjectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.project(projectId!),
    enabled: Boolean(projectId),
  });
  const currentProject = currentProjectQuery.data ?? null;

  // Authoritative active project name/code (for display and Open Project).
  const activeProjectQuery = useQuery({
    queryKey: ['project', active?.projectId],
    queryFn: () => api.project(active!.projectId),
    enabled: Boolean(active),
  });
  const activeProject = activeProjectQuery.data ?? null;

  // Display-only ticker. Never writes database state and never refetches the API.
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ACTIVE_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['project-work-sessions'] }),
      queryClient.invalidateQueries({ queryKey: ['project'] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
    ]);
  };

  const startMutation = useMutation({
    mutationFn: (targetProjectId: string) =>
      api.startWorkSession({ projectId: targetProjectId, idempotencyKey: crypto.randomUUID() }),
    onSuccess: async (result) => {
      await invalidate();
      showToast(result.replayed ? 'Work session already active.' : 'Work session started.');
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        // Stale UI: another request already started a session. Surface the
        // authoritative active session and let the user choose explicitly.
        void queryClient.invalidateQueries({ queryKey: ACTIVE_QUERY_KEY });
        showToast(
          'Another project already has an active work session. Switch explicitly to change it.',
          'error',
        );
        return;
      }
      showToast(
        error instanceof Error ? error.message : 'Could not start the work session.',
        'error',
      );
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => api.stopWorkSession({ idempotencyKey: crypto.randomUUID() }),
    onSuccess: async () => {
      await invalidate();
      showToast('Work session stopped.');
    },
    onError: (error) =>
      showToast(
        error instanceof Error ? error.message : 'Could not stop the work session.',
        'error',
      ),
  });

  const switchMutation = useMutation({
    mutationFn: ({ targetProjectId }: { targetProjectId: string; targetName: string }) =>
      api.switchWorkSession({ targetProjectId, idempotencyKey: crypto.randomUUID() }),
    onSuccess: async (_result, variables) => {
      await invalidate();
      showToast(`Now tracking ${variables.targetName}.`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ACTIVE_QUERY_KEY });
      }
      showToast(
        error instanceof Error ? error.message : 'Could not switch the work session.',
        'error',
      );
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () => api.pauseWorkSession({ idempotencyKey: crypto.randomUUID() }),
    onSuccess: async () => {
      await invalidate();
      showToast('Work session paused.');
    },
    onError: (error) =>
      showToast(
        error instanceof Error ? error.message : 'Could not pause the work session.',
        'error',
      ),
  });

  const resumeMutation = useMutation({
    mutationFn: () => api.resumeWorkSession({ idempotencyKey: crypto.randomUUID() }),
    onSuccess: async () => {
      await invalidate();
      showToast('Work session resumed.');
    },
    onError: (error) =>
      showToast(
        error instanceof Error ? error.message : 'Could not resume the work session.',
        'error',
      ),
  });

  const state = active ? workSessionState(active) : null;
  const elapsed = active ? activeSessionSeconds(active, now) : 0;

  return {
    active,
    activeProject,
    currentProject,
    projectId,
    now,
    state,
    elapsed,
    startMutation,
    stopMutation,
    switchMutation,
    pauseMutation,
    resumeMutation,
    invalidate,
  };
}

export type ActiveWorkSession = ReturnType<typeof useActiveWorkSession>;

/**
 * Extended fixed sidebar Work Session footer card. Changes IN PLACE by state:
 * no flyout is required to Start / Pause / Resume / Stop. The card stays above
 * Profile and never requires opening a tray.
 */
export function PersonalWorkSessionTimer() {
  const ws = useActiveWorkSession();
  const [switchTarget, setSwitchTarget] = useState<Project | null>(null);

  // Auto-dismiss the switch dialog on successful switch (no manual Exit needed).
  useEffect(() => {
    if (ws.switchMutation.isSuccess && switchTarget) {
      setSwitchTarget(null);
      ws.switchMutation.reset();
    }
  }, [ws.switchMutation.isSuccess, switchTarget, ws.switchMutation]);

  if (ws.active) {
    return (
      <ExtendedActiveCard
        ws={ws}
        switchTarget={switchTarget}
        onOpenSwitch={(project) => setSwitchTarget(project)}
        onCloseSwitch={() => setSwitchTarget(null)}
      />
    );
  }

  return <ExtendedInactiveCard ws={ws} />;
}

/** Extended RUNNING / PAUSED in-place card. */
function ExtendedActiveCard({
  ws,
  switchTarget,
  onOpenSwitch,
  onCloseSwitch,
}: {
  ws: ActiveWorkSession;
  switchTarget: Project | null;
  onOpenSwitch: (project: Project) => void;
  onCloseSwitch: () => void;
}) {
  const navigate = useNavigate();
  const { active, activeProject, currentProject, projectId, state, elapsed } = ws;
  const activeName = activeProject?.projectName ?? 'Active project';
  const activeCode = activeProject?.projectCode ?? null;
  const onThisProject = Boolean(projectId && active!.projectId === projectId);
  const openActiveProject = () => navigate(`/projects/${active!.projectId}`);

  return (
    <div className="work-session-extended-card">
      <div className="work-session-extended-head">
        <span
          className={`work-session-state-dot ${state === 'RUNNING' ? 'running' : 'paused'}`}
          aria-hidden="true"
        />
        <span className="work-session-state-label">
          <span className="sr-only">{state === 'RUNNING' ? 'Running' : 'Paused'}</span>
          {state === 'RUNNING' ? 'Tracking' : 'Paused'}
        </span>
        <Clock3 size={15} aria-hidden="true" />
      </div>

      <div className="work-session-extended-project">
        {activeCode ? <span className="work-session-extended-code">{activeCode}</span> : null}
        <strong title={activeName}>{activeName}</strong>
      </div>

      {/* Elapsed is the PRIMARY visual value; Started is secondary. */}
      <div className="work-session-extended-elapsed" aria-live="off">
        {formatElapsed(elapsed)}
      </div>
      <div className="work-session-extended-started">
        Started {formatDate(active!.startedAt, { hour: '2-digit', minute: '2-digit' })}
      </div>

      <div className="work-session-extended-actions">
        <button className="button secondary" type="button" onClick={openActiveProject}>
          Open Project
        </button>
        {state === 'RUNNING' ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => ws.pauseMutation.mutate()}
            disabled={ws.pauseMutation.isPending}
          >
            <Pause size={14} /> {ws.pauseMutation.isPending ? 'Pausing…' : 'Pause'}
          </button>
        ) : (
          <button
            className="button secondary"
            type="button"
            onClick={() => ws.resumeMutation.mutate()}
            disabled={ws.resumeMutation.isPending}
          >
            <RotateCcw size={14} /> {ws.resumeMutation.isPending ? 'Resuming…' : 'Resume'}
          </button>
        )}
        <button
          className="button danger"
          type="button"
          onClick={() => ws.stopMutation.mutate()}
          disabled={ws.stopMutation.isPending}
        >
          <Square size={14} /> {ws.stopMutation.isPending ? 'Stopping…' : 'Stop'}
        </button>
      </div>

      {/* Project A while viewing B: expose explicit Switch to the viewed project. */}
      {!onThisProject && projectId && currentProject ? (
        <button
          className="button secondary work-session-extended-switch"
          type="button"
          onClick={() => onOpenSwitch(currentProject)}
          disabled={ws.switchMutation.isPending}
        >
          Switch to this project
        </button>
      ) : null}

      {switchTarget ? (
        <WorkSessionSwitchDialog
          activeName={activeName}
          activeCode={activeCode}
          target={switchTarget}
          saving={ws.switchMutation.isPending}
          onCancel={onCloseSwitch}
          onConfirm={() =>
            ws.switchMutation.mutate({
              targetProjectId: switchTarget.id,
              targetName: switchTarget.projectName,
            })
          }
        />
      ) : null}
    </div>
  );
}

/** Extended INACTIVE fixed footer control (direct Start; Global uses mini chooser). */
function ExtendedInactiveCard({ ws }: { ws: ActiveWorkSession }) {
  const { currentProject, projectId } = ws;

  // In Project context: direct Start for the viewed project. While the project
  // is still loading, show the inactive header only (never the Global chooser).
  if (projectId) {
    return (
      <div className="work-session-extended-card inactive">
        <div className="work-session-extended-head">
          <span className="work-session-state-dot idle" aria-hidden="true" />
          <span className="work-session-state-label">
            <span className="sr-only">Inactive</span>
            Work Session
          </span>
          <Clock3 size={15} aria-hidden="true" />
        </div>
        {currentProject ? (
          <button
            className="button secondary work-session-extended-start"
            type="button"
            onClick={() => ws.startMutation.mutate(currentProject.id)}
            disabled={ws.startMutation.isPending}
          >
            <Play size={14} /> {ws.startMutation.isPending ? 'Starting…' : 'Start Work'}
          </button>
        ) : null}
      </div>
    );
  }

  // Global context: no project target; open the mini chooser. Never auto-start.
  return (
    <div className="work-session-extended-card inactive">
      <div className="work-session-extended-head">
        <span className="work-session-state-dot idle" aria-hidden="true" />
        <span className="work-session-state-label">
          <span className="sr-only">Inactive</span>
          Work Session
        </span>
        <Clock3 size={15} aria-hidden="true" />
      </div>
      <GlobalStartControl
        onStart={(project) => ws.startMutation.mutate(project.id)}
        pending={ws.startMutation.isPending}
        buttonClassName="button secondary work-session-extended-start"
      />
    </div>
  );
}

/**
 * Shell-level sticky Top Tracking Bar. Rendered once at App/Layout level across
 * the MAIN WORKSPACE only (excludes the sidebar). Stays visible through scroll
 * (sticky shell placement, not fragile fixed offsets). Appears only while a
 * WorkSession is RUNNING or PAUSED.
 */
export function WorkSessionTopBar() {
  const ws = useActiveWorkSession();
  const navigate = useNavigate();
  if (!ws.active) return null;
  const state = ws.state;
  const activeName = ws.activeProject?.projectName ?? 'Active project';
  const activeCode = ws.activeProject?.projectCode ?? null;
  const openActiveProject = () => navigate(`/projects/${ws.active!.projectId}`);

  return (
    <div
      className={`work-session-top-bar ${state === 'PAUSED' ? 'paused' : 'running'}`}
      role="status"
    >
      <span className="work-session-top-bar-indicator" aria-hidden="true" />
      <span className="work-session-top-bar-status">
        <span className="sr-only">{state === 'RUNNING' ? 'Running' : 'Paused'}</span>
        {state === 'RUNNING' ? 'Tracking' : 'Paused'}
      </span>
      <span className="work-session-top-bar-project" title={activeName}>
        {activeCode ? <span className="work-session-top-bar-code">{activeCode}</span> : null}
        <span className="work-session-top-bar-name">{activeName}</span>
      </span>
      <span className="work-session-top-bar-elapsed" aria-live="off">
        {formatElapsed(ws.elapsed)}
      </span>
      <div className="work-session-top-bar-actions">
        <button className="button secondary" type="button" onClick={openActiveProject}>
          Open Project
        </button>
        {state === 'RUNNING' ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => ws.pauseMutation.mutate()}
            disabled={ws.pauseMutation.isPending}
          >
            <Pause size={14} /> {ws.pauseMutation.isPending ? 'Pausing…' : 'Pause'}
          </button>
        ) : (
          <button
            className="button secondary"
            type="button"
            onClick={() => ws.resumeMutation.mutate()}
            disabled={ws.resumeMutation.isPending}
          >
            <RotateCcw size={14} /> {ws.resumeMutation.isPending ? 'Resuming…' : 'Resume'}
          </button>
        )}
        <button
          className="button danger"
          type="button"
          onClick={() => ws.stopMutation.mutate()}
          disabled={ws.stopMutation.isPending}
        >
          <Square size={14} /> {ws.stopMutation.isPending ? 'Stopping…' : 'Stop'}
        </button>
      </div>
    </div>
  );
}

/**
 * Minimal sidebar direct controls + status (above Profile). Icon-only, no timer
 * details, no tray, no Expand required. State-aware PRIMARY control
 * (Play/Pause/Resume) plus a conditional Stop. In Global INACTIVE the Play icon
 * opens the same mini Project chooser.
 */
export function WorkSessionMinimalControls() {
  const ws = useActiveWorkSession();
  const { state, active, projectId, currentProject } = ws;

  const stop = active ? (
    <button
      type="button"
      className="work-session-minimal-control danger"
      aria-label="Stop work session"
      title="Stop work session"
      onClick={() => ws.stopMutation.mutate()}
      disabled={ws.stopMutation.isPending}
    >
      <Square size={16} aria-hidden="true" />
    </button>
  ) : null;

  let primary: React.ReactNode;
  if (state === 'RUNNING') {
    primary = (
      <button
        type="button"
        className="work-session-minimal-control"
        aria-label="Pause work session"
        title="Pause work session"
        onClick={() => ws.pauseMutation.mutate()}
        disabled={ws.pauseMutation.isPending}
      >
        <Pause size={16} aria-hidden="true" />
      </button>
    );
  } else if (state === 'PAUSED') {
    primary = (
      <button
        type="button"
        className="work-session-minimal-control"
        aria-label="Resume work session"
        title="Resume work session"
        onClick={() => ws.resumeMutation.mutate()}
        disabled={ws.resumeMutation.isPending}
      >
        <RotateCcw size={16} aria-hidden="true" />
      </button>
    );
  } else if (projectId) {
    // Project context: Start the viewed project directly. If the project is
    // still loading, keep the control disabled until it resolves.
    primary = (
      <button
        type="button"
        className="work-session-minimal-control"
        aria-label="Start work"
        title="Start work"
        onClick={() => currentProject && ws.startMutation.mutate(currentProject.id)}
        disabled={ws.startMutation.isPending || !currentProject}
      >
        <Play size={16} aria-hidden="true" />
      </button>
    );
  } else {
    // Global inactive: Start opens the mini chooser.
    primary = (
      <GlobalStartControl
        onStart={(project) => ws.startMutation.mutate(project.id)}
        pending={ws.startMutation.isPending}
        buttonClassName="work-session-minimal-control"
        iconOnly
      />
    );
  }

  const statusLabel = active
    ? state === 'RUNNING'
      ? 'Work session active'
      : 'Work session paused'
    : 'No active work session';

  return (
    <>
      <div className="work-session-minimal-controls">
        {primary}
        {stop}
        <span
          className={`work-session-state-dot ${
            state === 'RUNNING' ? 'running' : state === 'PAUSED' ? 'paused' : 'idle'
          }`}
          aria-hidden="true"
        />
      </div>
      <span className="sr-only">{statusLabel}</span>
    </>
  );
}

function WorkSessionSwitchDialog({
  activeName,
  activeCode,
  target,
  saving,
  onCancel,
  onConfirm,
}: {
  activeName: string;
  activeCode: string | null;
  target: Project;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Escape closes only when NOT pending a switch request.
  useEffect(() => {
    if (saving) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onCancel]);

  // Render through a portal so the modal escapes the sidebar's overflow:
  // clipping container and sits above the whole shell/workspace.
  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <section
        className="work-session-switch-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Switch work session"
      >
        <header>
          <div>
            <span className="eyebrow">Work session</span>
            <h2>Switch work session?</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close switch dialog"
            onClick={onCancel}
            disabled={saving}
          >
            <X />
          </button>
        </header>
        <div className="work-session-switch-body">
          <div className="work-session-switch-projects" aria-label="Project switch">
            <div className="work-session-switch-project">
              <span className="work-session-switch-project-label">Current</span>
              {activeCode ? <span className="work-session-switch-code">{activeCode}</span> : null}
              <strong title={activeName}>{activeName}</strong>
            </div>
            <span className="work-session-switch-arrow" aria-hidden="true">
              →
            </span>
            <div className="work-session-switch-project">
              <span className="work-session-switch-project-label">Target</span>
              <span className="work-session-switch-code">{target.projectCode}</span>
              <strong title={target.projectName}>{target.projectName}</strong>
            </div>
          </div>
          <p className="muted-copy">
            This will stop the current session on {activeName} and start tracking{' '}
            {target.projectName} in one atomic switch.
          </p>
        </div>
        <footer className="work-session-switch-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={saving}>
            {saving ? 'Switching…' : `Switch to ${target.projectName}`}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
