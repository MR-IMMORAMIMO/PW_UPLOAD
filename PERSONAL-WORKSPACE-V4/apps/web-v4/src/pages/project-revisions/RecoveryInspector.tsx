/**
 * Right-side inspector for the Recovery tab.
 *
 * Never a blank white panel: shows a centered empty state until an item is
 * selected, then real failure details with the truthful available action —
 * Retry Generation ONLY when a canonical Schedule/BOQ recovery target exists,
 * otherwise "Open Owning Workspace" and an explanatory note. No fake Retry.
 */
import { ArchiveRestore, FolderOpen, RefreshCw, X } from '../../components/common/SctIcons';
import {
  formatIsoDateTime,
  hasDeterminableOwningFamily,
  lifecycleTone,
  outputFamilyLabel,
  recoveryItemCanRetry,
} from './revisionsViewModel';
import type { RecoveryItem } from './revisionsViewModel';

export function RecoveryInspector({
  item,
  retryPending,
  onRetry,
  onOpenOwningWorkspace,
  onClose,
}: {
  item: RecoveryItem | null;
  retryPending: boolean;
  onRetry: (item: RecoveryItem) => void;
  onOpenOwningWorkspace: (item: RecoveryItem) => void;
  onClose: () => void;
}) {
  if (!item) {
    return (
      <div
        className="v4-revisions__inspector v4-revisions__inspector--empty"
        data-testid="v4-recovery-inspector-empty"
      >
        <div className="v4-revisions__empty-state">
          <span className="v4-revisions__empty-state-icon" aria-hidden="true">
            <ArchiveRestore size={26} strokeWidth={1.5} />
          </span>
        </div>
      </div>
    );
  }

  const canRetry = recoveryItemCanRetry(item);
  const isOutput = item.kind === 'output';
  const familyDeterminable = hasDeterminableOwningFamily(item);
  const familyLabel = outputFamilyLabel(item.family);
  const owningFamilyLabel = outputFamilyLabel(item.outputFamily);

  return (
    <div className="v4-revisions__inspector" data-testid="v4-recovery-inspector">
      <header className="v4-revisions__inspector-header">
        <h2>Recovery Details</h2>
        <button
          type="button"
          className="v4-revisions__inspector-close"
          aria-label="Close recovery details"
          data-testid="v4-recovery-inspector-close"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className="v4-revisions__inspector-identity">
        <span className="v4-revisions__inspector-icon" aria-hidden="true">
          <ArchiveRestore size={22} strokeWidth={1.75} />
        </span>
        <div className="v4-revisions__inspector-identity-main">
          <span className="v4-revisions__inspector-title">
            {isOutput
              ? `${familyLabel ?? 'Output'} · ${item.outputFormat ?? 'Output'}`
              : item.label}
          </span>
          <span
            className={`v4-revisions__badge v4-revisions__badge--${lifecycleTone(item.lifecycle)}`}
          >
            {item.lifecycle}
          </span>
        </div>
      </div>

      <section className="v4-revisions__inspector-section">
        <h3>Recovery Item</h3>
        <dl className="v4-revisions__inspector-dl">
          <div>
            <dt>Revision</dt>
            <dd>{item.revisionLabel ?? item.label}</dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{isOutput ? 'Generated Output' : 'Revision'}</dd>
          </div>
          {isOutput ? (
            <>
              <div>
                <dt>Family</dt>
                <dd>{familyLabel ?? '—'}</dd>
              </div>
              <div>
                <dt>Format</dt>
                <dd>{item.outputFormat ?? '—'}</dd>
              </div>
              <div>
                <dt>Artifact State</dt>
                <dd>{item.artifactState ?? '—'}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Owning Output Family</dt>
                <dd>{owningFamilyLabel ?? 'Not determinable'}</dd>
              </div>
              <div>
                <dt>Registered Output Count</dt>
                <dd>{item.outputCount}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Lifecycle</dt>
            <dd>{item.lifecycle}</dd>
          </div>
          <div>
            <dt>Created At</dt>
            <dd>{formatIsoDateTime(item.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section
        className="v4-revisions__inspector-callout v4-revisions__inspector-callout--danger"
        data-testid="v4-recovery-failure"
      >
        <h3>Failure Reason</h3>
        <p>{item.failureReason ?? 'No failure reason recorded.'}</p>
      </section>

      <section className="v4-revisions__inspector-actions">
        {canRetry ? (
          <button
            type="button"
            className="v4-revisions__retry-btn"
            disabled={retryPending}
            aria-busy={retryPending}
            data-testid={`v4-recovery-inspector-retry-${item.id}`}
            onClick={() => onRetry(item)}
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={retryPending ? 'v4-revisions__retry-spin' : undefined}
            />
            <span>{retryPending ? 'Retrying…' : 'Retry Generation'}</span>
          </button>
        ) : (
          <p className="v4-revisions__inspector-note" data-testid="v4-recovery-no-retry">
            {familyDeterminable
              ? 'This failed item has no direct schedule/BOQ recovery authority. Open the owning workspace to regenerate manually.'
              : 'This failed item has no canonical schedule/BOQ recovery authority, and no owning output family is determinable from canonical data. Open the project workspace to regenerate manually.'}
          </p>
        )}
        <button
          type="button"
          className="v4-revisions__workspace-btn"
          data-testid="v4-recovery-inspector-workspace"
          onClick={() => onOpenOwningWorkspace(item)}
        >
          <FolderOpen size={14} aria-hidden="true" />
          {/* Never claims to know the owner when the family is not determinable. */}
          <span>{familyDeterminable ? 'Open Owning Workspace' : 'Open Project Workspace'}</span>
        </button>
      </section>
    </div>
  );
}
