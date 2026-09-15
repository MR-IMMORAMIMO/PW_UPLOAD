import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { SctWorkSession as TimerReset } from '../common/SctIcons';
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  FolderKanban,
  Pause,
  Play,
  Square,
  X,
} from '../common/SctIcons';
import type { SidebarMode } from '../sidebar/sidebarMode';
import { V4Tooltip } from '../common/V4Tooltip';
import { V4Button } from '../common/V4Button';
import { useV4WorkSession } from './WorkSessionProvider';
import { formatWorkSessionElapsed } from './workSessionTime';
import { V4AnchoredSurface } from '../interaction/V4AnchoredSurface';
import { ensureV4OverlayRoot } from '../interaction/V4OverlayProvider';

function WorkSessionStateIcon({ state }: { state: 'RUNNING' | 'PAUSED' | null }) {
  if (state === 'RUNNING') return <Play aria-hidden="true" strokeWidth={2} />;
  if (state === 'PAUSED') return <Pause aria-hidden="true" strokeWidth={2} />;
  return <TimerReset aria-hidden="true" strokeWidth={1.75} />;
}

function WorkSessionStateLabel({ state }: { state: 'RUNNING' | 'PAUSED' | null }) {
  return (
    <span className="v4-work-session__state">
      <span className="v4-work-session__state-dot" aria-hidden="true" />
      {state === 'RUNNING' ? 'Running' : state === 'PAUSED' ? 'Paused' : 'Inactive'}
    </span>
  );
}

export function V4WorkSessionAnchor({ mode }: { mode: SidebarMode }) {
  const workSession = useV4WorkSession();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [trayPosition, setTrayPosition] = useState<CSSProperties>({});
  const minimal = mode === 'minimal';
  const elapsed = formatWorkSessionElapsed(workSession.elapsedSeconds);

  useLayoutEffect(() => {
    if (!workSession.trayOpen) return;
    const sync = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const trayWidth = Math.min(328, window.innerWidth - 24);
      setTrayPosition({
        width: trayWidth,
        left: Math.max(12, Math.min(rect.left + 12, window.innerWidth - trayWidth - 12)),
        bottom: Math.max(12, window.innerHeight - rect.top + 8),
      });
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [workSession.trayOpen, mode]);

  const button = (
    <button
      ref={anchorRef}
      type="button"
      className="v4-work-session-anchor"
      data-state={workSession.state ?? 'INACTIVE'}
      data-mode={mode}
      aria-label={
        minimal ? `Work Session, ${workSession.state?.toLowerCase() ?? 'inactive'}` : 'Work Session'
      }
      aria-expanded={workSession.trayOpen}
      aria-haspopup="dialog"
      onClick={() => workSession.setTrayOpen(!workSession.trayOpen)}
    >
      <span className="v4-work-session-anchor__icon" aria-hidden="true">
        <WorkSessionStateIcon state={workSession.state} />
      </span>
      {minimal ? <span className="v4-work-session-anchor__mini-dot" aria-hidden="true" /> : null}
      {!minimal ? (
        <>
          <span className="v4-work-session-anchor__copy">
            <strong>Work Session</strong>
            {workSession.active ? (
              <span>
                {elapsed} <span aria-hidden="true">·</span>{' '}
                {workSession.state === 'RUNNING' ? 'Running' : 'Paused'}
              </span>
            ) : (
              <span>
                {workSession.statusLoading
                  ? 'Loading session…'
                  : workSession.statusUnavailable
                    ? 'Session unavailable'
                    : 'No active session'}
              </span>
            )}
          </span>
          {workSession.trayOpen ? (
            <ChevronDown className="v4-work-session-anchor__chevron" aria-hidden="true" />
          ) : (
            <ChevronUp className="v4-work-session-anchor__chevron" aria-hidden="true" />
          )}
        </>
      ) : null}
    </button>
  );

  return (
    <>
      {minimal ? <V4Tooltip label="Work Session">{button}</V4Tooltip> : button}
      {createPortal(
        <V4AnchoredSurface
          open={workSession.trayOpen}
          ownerRef={anchorRef}
          triggerRef={anchorRef}
          onRequestClose={() => workSession.setTrayOpen(false)}
          className="v4-work-session-tray"
          role="dialog"
          ariaLabel="Work Session"
          style={trayPosition}
          testId="v4-work-session-tray"
          dataState={workSession.state ?? 'INACTIVE'}
          ariaModal={false}
        >
          <V4WorkSessionTray onClose={() => workSession.setTrayOpen(false)} />
        </V4AnchoredSurface>,
        ensureV4OverlayRoot(),
      )}
    </>
  );
}

export function V4WorkSessionTray({ onClose }: { onClose: () => void }) {
  const workSession = useV4WorkSession();
  const elapsed = formatWorkSessionElapsed(workSession.elapsedSeconds);
  const project = workSession.active ? workSession.activeProject : workSession.currentProject;
  const pending =
    workSession.startPending ||
    workSession.pausePending ||
    workSession.resumePending ||
    workSession.stopPending;

  return (
    <>
      <div className="v4-work-session-tray__grabber" aria-hidden="true" />
      <header className="v4-work-session-tray__header">
        <strong>Work Session</strong>
        <V4Button variant="icon" size="compact" aria-label="Close Work Session" onClick={onClose}>
          <X aria-hidden="true" />
        </V4Button>
      </header>

      {workSession.active ? (
        <>
          <div className="v4-work-session-tray__project">
            <span className="v4-work-session-tray__project-icon" aria-hidden="true">
              <FolderKanban />
            </span>
            <span>
              <strong>{project?.projectName ?? 'Active project'}</strong>
              <small>{project?.projectCode ?? 'Project workspace'}</small>
            </span>
          </div>
          <div className="v4-work-session-tray__timer" aria-label={`Elapsed ${elapsed}`}>
            <strong>{elapsed}</strong>
            <WorkSessionStateLabel state={workSession.state} />
          </div>
          <div className="v4-work-session-tray__actions">
            {workSession.state === 'RUNNING' ? (
              <V4Button
                variant="secondary"
                size="compact"
                onClick={workSession.pause}
                disabled={pending}
              >
                <Pause aria-hidden="true" /> {workSession.pausePending ? 'Pausing…' : 'Pause'}
              </V4Button>
            ) : (
              <V4Button
                variant="secondary"
                size="compact"
                onClick={workSession.resume}
                disabled={pending}
              >
                <Play aria-hidden="true" /> {workSession.resumePending ? 'Resuming…' : 'Resume'}
              </V4Button>
            )}
            <V4Button
              variant="danger"
              size="compact"
              className="v4-work-session-control--stop"
              onClick={workSession.stop}
              disabled={pending}
            >
              <Square aria-hidden="true" /> {workSession.stopPending ? 'Stopping…' : 'Stop'}
            </V4Button>
          </div>
        </>
      ) : (
        <div className="v4-work-session-tray__inactive">
          <span className="v4-work-session-tray__inactive-icon" aria-hidden="true">
            <Clock3 />
          </span>
          <strong>
            {workSession.statusLoading
              ? 'Loading session…'
              : workSession.statusUnavailable
                ? 'Session unavailable'
                : 'No active session'}
          </strong>
          <p>
            {workSession.statusLoading
              ? 'Checking the authoritative Work Session status.'
              : workSession.statusUnavailable
                ? 'The active Work Session status could not be loaded.'
                : workSession.currentProjectId
                  ? 'Start a session to track work on this project.'
                  : 'Open a project to start tracking time.'}
          </p>
          {!workSession.statusLoading && !workSession.statusUnavailable ? (
            <V4Button
              variant="primary"
              className="v4-work-session-tray__start"
              onClick={() => workSession.start()}
              disabled={!workSession.currentProject || workSession.startPending}
            >
              <Play aria-hidden="true" /> {workSession.startPending ? 'Starting…' : 'Start Session'}
            </V4Button>
          ) : null}
        </div>
      )}

      {workSession.error ? (
        <div className="v4-work-session-tray__error" role="alert">
          {workSession.error}
        </div>
      ) : null}
    </>
  );
}

export function V4WorkSessionTrackingStrip() {
  const workSession = useV4WorkSession();
  if (!workSession.active || !workSession.state) return null;
  const elapsed = formatWorkSessionElapsed(workSession.elapsedSeconds);
  const pending = workSession.pausePending || workSession.resumePending || workSession.stopPending;

  return (
    <div
      className="v4-work-session-strip"
      data-state={workSession.state}
      role="status"
      aria-label={`Work Session ${workSession.state === 'RUNNING' ? 'running' : 'paused'}`}
      data-testid="v4-work-session-strip"
    >
      <span className="v4-work-session-strip__indicator" aria-hidden="true">
        {workSession.state === 'RUNNING' ? <span /> : <Pause />}
      </span>
      <strong className="v4-work-session-strip__time">{elapsed}</strong>
      <span className="v4-work-session-strip__divider" aria-hidden="true" />
      <span className="v4-work-session-strip__project">
        {workSession.activeProject?.projectName ?? 'Active project'}
      </span>
      <span className="v4-work-session-strip__divider" aria-hidden="true" />
      <WorkSessionStateLabel state={workSession.state} />
      <span className="v4-work-session-strip__spacer" />
      {workSession.state === 'RUNNING' ? (
        <V4Button variant="secondary" size="compact" onClick={workSession.pause} disabled={pending}>
          <Pause aria-hidden="true" /> {workSession.pausePending ? 'Pausing…' : 'Pause'}
        </V4Button>
      ) : (
        <V4Button
          variant="secondary"
          size="compact"
          onClick={workSession.resume}
          disabled={pending}
        >
          <Play aria-hidden="true" /> {workSession.resumePending ? 'Resuming…' : 'Resume'}
        </V4Button>
      )}
      <V4Button
        variant="danger"
        size="compact"
        className="v4-work-session-control--stop"
        onClick={workSession.stop}
        disabled={pending}
      >
        <Square aria-hidden="true" /> {workSession.stopPending ? 'Stopping…' : 'Stop'}
      </V4Button>
      <V4Button
        variant="icon"
        size="compact"
        className="v4-work-session-strip__tray-toggle"
        aria-label={workSession.trayOpen ? 'Close Work Session tray' : 'Open Work Session tray'}
        aria-expanded={workSession.trayOpen}
        onClick={() => workSession.setTrayOpen(!workSession.trayOpen)}
      >
        {workSession.trayOpen ? (
          <ChevronDown aria-hidden="true" />
        ) : (
          <ChevronUp aria-hidden="true" />
        )}
      </V4Button>
    </div>
  );
}
