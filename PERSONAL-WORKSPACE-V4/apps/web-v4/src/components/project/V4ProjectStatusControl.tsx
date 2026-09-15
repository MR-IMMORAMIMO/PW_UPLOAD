import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from '../common/SctIcons';
import type { Project, ProjectStatus } from '@scli/domain';
import { V4StatusPill } from '../common/V4StatusPill';
import {
  directStatusTargets,
  specializedStatusTargets,
} from '../../pages/projects/projectsViewModel';
import { PROJECT_LIFECYCLE_SEQUENCE } from '../../pages/project-summary/projectSummaryViewModel';
import { formatProjectStatus, projectStatusTone } from './statusDisplay';
import { useProjectStatusController } from './useProjectStatusController';
import { V4AnchoredSurface } from '../interaction/V4AnchoredSurface';
import { V4ModalLayer } from '../interaction/V4ModalLayer';
import { V4Button } from '../common/V4Button';

export function V4ProjectStatusControl({
  project,
  triggerContent,
}: {
  project: Project;
  triggerContent?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reasonTarget, setReasonTarget] = useState<ProjectStatus | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const reasonHelpId = useId();
  const targets = directStatusTargets(project);
  const specializedTargets = specializedStatusTargets(project);
  const lifecycle = PROJECT_LIFECYCLE_SEQUENCE.includes(project.status)
    ? PROJECT_LIFECYCLE_SEQUENCE
    : ([project.status, ...PROJECT_LIFECYCLE_SEQUENCE] as const);
  const firstAvailable = lifecycle.find(
    (status) => targets.includes(status) || specializedTargets.includes(status),
  );
  const statusController = useProjectStatusController({
    onMutate: () => setOpen(false),
    onSuccess: () => {
      setReasonTarget(null);
      setReason('');
      setReasonError(null);
    },
  });

  const closeReasonDialog = () => {
    if (statusController.isPending) return;
    setReasonTarget(null);
    setReason('');
    setReasonError(null);
  };

  const confirmReasonTransition = () => {
    const trimmed = reason.trim();
    if (!reasonTarget || !trimmed) {
      setReasonError('Reason is required.');
      reasonRef.current?.focus();
      return;
    }
    statusController.changeStatus(project, reasonTarget, trimmed);
  };

  return (
    <div className="v4-project-status-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="v4-project-status-control__trigger"
        style={
          triggerContent
            ? { padding: 0, border: 0, background: 'transparent', boxShadow: 'none' }
            : undefined
        }
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={statusController.isPending}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => firstItemRef.current?.focus());
        }}
      >
        {triggerContent ?? (
          <>
            <V4StatusPill variant={projectStatusTone(project.status)}>
              {formatProjectStatus(project.status)}
            </V4StatusPill>
            <ChevronDown aria-hidden="true" />
          </>
        )}
      </button>
      <V4AnchoredSurface
        open={open}
        ownerRef={rootRef}
        triggerRef={triggerRef}
        onRequestClose={() => setOpen(false)}
        className="v4-project-status-control__menu"
        role="menu"
        ariaLabel="Change Project status"
      >
        {lifecycle.map((status) => {
          const current = status === project.status;
          const direct = !current && targets.includes(status);
          const specialized = !current && specializedTargets.includes(status);
          const available = direct || specialized;
          const disabled = current || !available || statusController.isPending;
          const availabilityLabel = current
            ? 'Current'
            : direct
              ? 'Directly available'
              : specialized
                ? 'Specialized available — reason required'
                : 'Not available from current state';
          return (
            <button
              ref={status === firstAvailable ? firstItemRef : undefined}
              key={status}
              type="button"
              role="menuitem"
              aria-label={`${formatProjectStatus(status)} — ${availabilityLabel}`}
              aria-disabled={disabled}
              disabled={disabled}
              className={`v4-project-status-control__item${
                current
                  ? ' is-current'
                  : specialized
                    ? ' is-specialized'
                    : direct
                      ? ' is-available'
                      : ' is-unavailable'
              }`}
              onClick={() => {
                if (specialized && !statusController.isPending) {
                  setOpen(false);
                  setReasonTarget(status);
                  setReason('');
                  setReasonError(null);
                } else if (direct && !statusController.isPending) {
                  statusController.changeStatus(project, status);
                }
              }}
            >
              <span
                className={`v4-project-status-control__dot is-${projectStatusTone(status)}`}
                aria-hidden="true"
              />
              <span className="v4-project-status-control__label">
                <strong>{formatProjectStatus(status)}</strong>
                <small>{availabilityLabel}</small>
              </span>
            </button>
          );
        })}
      </V4AnchoredSurface>
      {statusController.error ? (
        <span
          role="alert"
          className={`v4-project-status-control__error${reasonTarget ? ' is-dialog-error' : ''}`}
        >
          {statusController.error instanceof Error
            ? statusController.error.message
            : 'The status change was rejected.'}
        </span>
      ) : null}
      <V4ModalLayer
        open={reasonTarget === 'RevisionRequired'}
        kind="nested-dialog"
        dismissible={!statusController.isPending}
        className="v4-confirm-dialog__layer"
        backdropClassName="v4-confirm-dialog__backdrop"
        panelClassName="v4-confirm-dialog v4-status-reason-dialog"
        initialFocusRef={reasonRef}
        returnFocusRef={triggerRef}
        onRequestClose={closeReasonDialog}
        role="dialog"
        ariaLabel="Revision Required"
        ariaDescribedBy={reasonHelpId}
        testId="v4-status-reason-layer"
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            confirmReasonTransition();
          }}
        >
          <h3>Revision Required</h3>
          <p id={reasonHelpId}>
            Capture why the client review needs another revision before changing status.
          </p>
          <label className="v4-status-reason-dialog__field">
            <span>Reason</span>
            <textarea
              ref={reasonRef}
              required
              maxLength={500}
              value={reason}
              disabled={statusController.isPending}
              aria-invalid={Boolean(reasonError)}
              aria-describedby={reasonError ? `${reasonHelpId}-error` : undefined}
              onChange={(event) => {
                setReason(event.target.value);
                if (reasonError) setReasonError(null);
              }}
            />
          </label>
          {reasonError ? (
            <p id={`${reasonHelpId}-error`} role="alert" className="v4-status-reason-dialog__error">
              {reasonError}
            </p>
          ) : null}
          {statusController.error ? (
            <p role="alert" className="v4-status-reason-dialog__error">
              {statusController.error instanceof Error
                ? statusController.error.message
                : 'The status change was rejected.'}
            </p>
          ) : null}
          <div className="v4-confirm-dialog__actions">
            <V4Button
              variant="secondary"
              onClick={closeReasonDialog}
              disabled={statusController.isPending}
            >
              Keep Current Status
            </V4Button>
            <V4Button
              type="submit"
              variant="primary"
              disabled={statusController.isPending}
              aria-busy={statusController.isPending || undefined}
            >
              Confirm Revision Required
            </V4Button>
          </div>
        </form>
      </V4ModalLayer>
    </div>
  );
}
