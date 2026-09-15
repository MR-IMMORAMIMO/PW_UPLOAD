/**
 * Right-side inspector for a selected revision — productized V4 technical
 * hierarchy: identity header, primary metadata, failure callout, collapsible
 * Advanced Metadata (collapsed by default), compact deliverables grid, and the
 * B1 manual workflow actions (Create/Finalize/Add/Remove Deliverable) shown
 * only where the B0 lifecycle truthfully allows them.
 *
 * B1/C1 addition: a FAILED_RECOVERABLE composed draft gets a single "Resume
 * Revision" action that returns the REVISION to PREPARING. It never re-renders
 * an Output, so it is not labelled "Recover Output" or "Retry Generation".
 *
 * P2C-03/P2C-10A addition: the server `delete-eligibility` read explicitly
 * distinguishes a fresh Delete Revision action from a restart-safe Retry Delete
 * action. Both use the same Revision-UUID mutation and the UI never invents
 * recovery authority.
 */
import { useEffect, useRef, useState } from 'react';
import type {
  CanonicalOutputPresenceRecord,
  CanonicalRevisionRecord,
  RevisionDeleteEligibility,
  RevisionDeliverable,
  ProjectDocument,
} from '@scli/domain';
import { SctStart as PlayCircle, SctRestore as RotateCcw } from '../../components/common/SctIcons';
import { FileText, Trash2, X, SctPdf } from '../../components/common/SctIcons';
import { isResumableComposedRevision } from '../../components/revisions/canonicalRevisionDisplay';
import {
  deliverableTitle,
  compatibilityTone,
  formatCompatibilityDate,
  formatIsoDateTime,
  lifecycleTone,
  outputFamilyLabel,
  sourceDisplay,
  type RevisionCompatibilitySummary,
} from './revisionsViewModel';
import { Disclosure } from './Disclosure';
import { ToolSessionSurface } from '../../components/automation/ToolSessionSurface';

export interface RevisionDetailsFocusRequest {
  id: number;
  revisionId: string;
}

const DELETE_REASON_LABELS: Record<string, string> = {
  REVISION_FINALIZED: 'Finalized Revisions cannot be deleted.',
  REVISION_NOT_PREPARING: 'Only a Preparing Revision can be deleted.',
  REVISION_NOT_MANUAL: 'Only a manual composed Revision can be deleted.',
  REVISION_IN_RECOVERY: 'This Revision is in recovery and cannot be deleted.',
  PACKAGE_HISTORY_EXISTS: 'This Revision has Package history and cannot be deleted.',
  COMPATIBILITY_HISTORY_EXISTS: 'This Revision has issued history and cannot be deleted.',
  ARTIFACT_OWNERSHIP_UNPROVEN: 'Deletion is blocked because an artifact cannot be safely verified.',
  ARTIFACT_HASH_MISMATCH: 'Deletion is blocked because an artifact failed hash verification.',
  SOURCE_PATH_UNSAFE: 'Deletion is blocked because an artifact path is unsafe.',
  OWNER_PERMISSION_REQUIRED: 'Deletion requires Owner/Manager permission.',
  DELETE_OPERATION_NOT_RECOVERABLE:
    'The persisted Delete operation is not available for manual retry.',
};

export function RevisionInspector({
  revision,
  deliverables,
  outputs,
  compatibility,
  detailsFocusRequest,
  onDetailsFocusRequestHandled,
  onClose,
  onFinalize,
  onAddDeliverable,
  onRemoveDeliverable,
  onResume,
  onDelete,
  onUpdateMetadata,
  finalizePending,
  resumePending,
  deletePending,
  mutationPending,
  metadataPending,
  deleteEligibility,
  projectId,
  documents,
  embedded = false,
  onOpenDeliverable,
}: {
  revision: CanonicalRevisionRecord;
  deliverables: RevisionDeliverable[];
  outputs: CanonicalOutputPresenceRecord[];
  compatibility: RevisionCompatibilitySummary | null;
  detailsFocusRequest: RevisionDetailsFocusRequest | null;
  onDetailsFocusRequestHandled: (requestId: number) => void;
  onClose: () => void;
  onFinalize: (revision: CanonicalRevisionRecord) => void;
  onAddDeliverable: () => void;
  onRemoveDeliverable: (deliverable: RevisionDeliverable) => void;
  onResume: (revision: CanonicalRevisionRecord) => void;
  onDelete: (revision: CanonicalRevisionRecord) => void;
  onUpdateMetadata: (metadata: {
    purpose?: string | null;
    internalNote?: string | null;
  }) => void | Promise<void>;
  finalizePending: boolean;
  resumePending: boolean;
  deletePending: boolean;
  mutationPending: boolean;
  metadataPending: boolean;
  deleteEligibility: RevisionDeleteEligibility | null;
  projectId: string;
  documents: ProjectDocument[];
  embedded?: boolean;
  onOpenDeliverable?: (deliverable: RevisionDeliverable) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState<'purpose' | 'internalNote' | null>(null);
  const [metadataDraft, setMetadataDraft] = useState('');
  const [metadataError, setMetadataError] = useState('');
  const purposeInputRef = useRef<HTMLInputElement>(null);
  const internalNoteInputRef = useRef<HTMLTextAreaElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isPreparing = revision.lifecycleState === 'PREPARING';
  const isFinalized = revision.lifecycleState === 'FINALIZED';
  // Offered ONLY for a composed draft that failed. A failed GENERATED_OUTPUTS or
  // REGISTER_ONLY Revision keeps its existing Recovery-tab path unchanged.
  const canResume = isResumableComposedRevision(revision);
  const documentSnapshots = deliverables.filter((d) => d.sourceType === 'DocumentSnapshot');
  const generatedOutputs = deliverables.filter((d) => d.sourceType === 'GeneratedOutput');
  const canFinalize =
    isPreparing && deliverables.length >= 1 && !finalizePending && !mutationPending;
  const finalizeDisabledReason =
    isPreparing && deliverables.length === 0
      ? 'Add at least one Deliverable before finalizing.'
      : null;
  // The explicit action preserves the semantic difference between a fresh
  // deletion and resuming the one persisted recoverable operation.
  const canDelete = deleteEligibility?.deleteAction === 'DELETE' && isPreparing;
  const canRetryDelete = deleteEligibility?.deleteAction === 'RETRY_DELETE' && isPreparing;
  const blockedDeleteReasons = deleteEligibility?.blockedReasons ?? [];

  useEffect(() => {
    setEditingMetadata(null);
    setMetadataDraft('');
  }, [revision.revisionId]);

  useEffect(() => {
    if (editingMetadata === 'purpose') purposeInputRef.current?.focus();
    if (editingMetadata === 'internalNote') internalNoteInputRef.current?.focus();
  }, [editingMetadata]);

  useEffect(() => {
    if (!detailsFocusRequest || detailsFocusRequest.revisionId !== revision.revisionId) return;
    headingRef.current?.focus({ preventScroll: true });
    if (inspectorRef.current) inspectorRef.current.scrollTop = 0;
    onDetailsFocusRequestHandled(detailsFocusRequest.id);
  }, [detailsFocusRequest, onDetailsFocusRequestHandled, revision.revisionId]);

  const beginMetadataEdit = (field: 'purpose' | 'internalNote') => {
    setEditingMetadata(field);
    setMetadataDraft(
      field === 'purpose' ? (revision.purpose ?? '') : (revision.internalNote ?? ''),
    );
  };

  const saveMetadata = async () => {
    if (!editingMetadata || metadataPending) return;
    setMetadataError('');
    try {
      await onUpdateMetadata({ [editingMetadata]: metadataDraft });
      setEditingMetadata(null);
      setMetadataDraft('');
    } catch (error) {
      setMetadataError(
        error instanceof Error ? error.message : 'Saving failed. Your edits are retained.',
      );
    }
  };

  // The confirmation counts come ONLY from the server delete-eligibility
  // response — the UI never reconstructs destructive confirmation counts from
  // unrelated page state (that would create a second, competing definition).
  // The dialog is only reachable when deleteEligibility is present (canDelete).
  const counts = deleteEligibility?.counts ?? {
    documentSnapshots: 0,
    datasheetSnapshots: 0,
    generatedOutputs: 0,
  };

  return (
    <div ref={inspectorRef} className="v4-revisions__inspector" data-testid="v4-revision-inspector">
      {!embedded ? (
        <header className="v4-revisions__inspector-header">
          <h2 ref={headingRef} tabIndex={-1}>
            Revision Details
          </h2>
          <button
            type="button"
            className="v4-revisions__inspector-close"
            aria-label="Close revision details"
            data-testid="v4-revision-inspector-close"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
      ) : null}
      {metadataError ? <p role="alert">{metadataError}</p> : null}

      <div className="v4-revisions__inspector-identity">
        <span className="v4-revisions__inspector-icon" aria-hidden="true">
          <FileText size={22} strokeWidth={1.75} />
        </span>
        <div className="v4-revisions__inspector-identity-main">
          <span className="v4-revisions__inspector-title">{revision.revisionLabel}</span>
          <span
            className={`v4-revisions__badge v4-revisions__badge--${lifecycleTone(revision.lifecycleState)}`}
          >
            {revision.lifecycleState}
          </span>
        </div>
      </div>

      <section className="v4-revisions__inspector-section">
        <h3>Revision</h3>
        <dl className="v4-revisions__inspector-dl v4-revisions__inspector-dl--grid">
          <div>
            <dt>Operation / Source</dt>
            <dd title={sourceDisplay(revision)}>{sourceDisplay(revision)}</dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>{revision.lifecycleState}</dd>
          </div>
          <div>
            <dt>Created At</dt>
            <dd>{formatIsoDateTime(revision.createdAt)}</dd>
          </div>
          <div>
            <dt>Finalized At</dt>
            <dd>{revision.finalizedAt ? formatIsoDateTime(revision.finalizedAt) : '—'}</dd>
          </div>
          <div>
            <dt>Created By</dt>
            <dd>{revision.createdByName ?? '—'}</dd>
          </div>
          <div>
            <dt>Luminaire Snapshot</dt>
            <dd>{(revision.luminaireSnapshot ?? []).length} luminaires</dd>
          </div>
          <div>
            <dt>Deliverables</dt>
            <dd>{deliverables.length}</dd>
          </div>
        </dl>
      </section>

      <section
        className="v4-revisions__inspector-section v4-revisions__compatibility"
        data-testid="v4-revision-compatibility"
      >
        <h3>Compatibility</h3>
        {compatibility ? (
          <dl className="v4-revisions__inspector-dl v4-revisions__compatibility-dl">
            <div>
              <dt>Status</dt>
              <dd>
                <span
                  className={`v4-revisions__badge v4-revisions__badge--${compatibilityTone(compatibility.status)}`}
                >
                  {compatibility.statusLabel}
                </span>
              </dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>
                {compatibility.issuedAt
                  ? formatCompatibilityDate(compatibility.issuedAt)
                  : 'Not issued'}
              </dd>
            </div>
            <div>
              <dt>Locked</dt>
              <dd>{compatibility.locked ? 'Yes' : 'No'}</dd>
            </div>
            {compatibility.title ? (
              <div>
                <dt>Title</dt>
                <dd>{compatibility.title}</dd>
              </div>
            ) : null}
            {compatibility.summary ? (
              <div>
                <dt>Summary</dt>
                <dd>{compatibility.summary}</dd>
              </div>
            ) : null}
            {compatibility.changes ? (
              <div>
                <dt>Changes</dt>
                <dd>{compatibility.changes}</dd>
              </div>
            ) : null}
            {compatibility.receivedAt ? (
              <div>
                <dt>Received</dt>
                <dd>{formatCompatibilityDate(compatibility.receivedAt)}</dd>
              </div>
            ) : null}
            {compatibility.dueDate ? (
              <div>
                <dt>Due</dt>
                <dd>{formatCompatibilityDate(compatibility.dueDate)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Source</dt>
              <dd>{compatibility.sourceType}</dd>
            </div>
            {compatibility.reissueNumber ? (
              <div>
                <dt>Reissue</dt>
                <dd>{compatibility.reissueNumber}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="v4-revisions__compatibility-empty">No compatibility record</p>
        )}
      </section>

      <section className="v4-revisions__inspector-section" data-testid="v4-revision-metadata">
        <h3>Revision Context</h3>
        <div className="v4-revisions__metadata-block">
          <div className="v4-revisions__metadata-heading">
            <strong>Purpose</strong>
            {isPreparing && editingMetadata !== 'purpose' ? (
              <button
                type="button"
                className="v4-revisions__metadata-edit"
                onClick={() => beginMetadataEdit('purpose')}
                disabled={mutationPending}
                aria-label="Edit Revision Purpose"
              >
                Edit
              </button>
            ) : null}
          </div>
          {editingMetadata === 'purpose' ? (
            <div className="v4-revisions__metadata-editor">
              <input
                ref={purposeInputRef}
                aria-label="Revision Purpose"
                value={metadataDraft}
                maxLength={500}
                onChange={(event) => setMetadataDraft(event.target.value)}
              />
              <div className="v4-revisions__metadata-actions">
                <button type="button" onClick={() => setEditingMetadata(null)}>
                  Cancel
                </button>
                <button type="button" onClick={saveMetadata} disabled={metadataPending}>
                  {metadataPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <p className={revision.purpose ? undefined : 'v4-revisions__metadata-empty'}>
              {revision.purpose ?? 'Not added'}
            </p>
          )}
        </div>
        <div className="v4-revisions__metadata-block">
          <div className="v4-revisions__metadata-heading">
            <strong>Internal Note</strong>
            {isPreparing && editingMetadata !== 'internalNote' ? (
              <button
                type="button"
                className="v4-revisions__metadata-edit"
                onClick={() => beginMetadataEdit('internalNote')}
                disabled={mutationPending}
                aria-label="Edit Internal Note"
              >
                Edit
              </button>
            ) : null}
          </div>
          {editingMetadata === 'internalNote' ? (
            <div className="v4-revisions__metadata-editor">
              <textarea
                ref={internalNoteInputRef}
                aria-label="Internal Note"
                value={metadataDraft}
                maxLength={8000}
                rows={5}
                onChange={(event) => setMetadataDraft(event.target.value)}
              />
              <div className="v4-revisions__metadata-actions">
                <button type="button" onClick={() => setEditingMetadata(null)}>
                  Cancel
                </button>
                <button type="button" onClick={saveMetadata} disabled={metadataPending}>
                  {metadataPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <p
              className={revision.internalNote ? undefined : 'v4-revisions__metadata-empty'}
              data-testid="v4-revision-internal-note"
            >
              {revision.internalNote ?? 'Not added'}
            </p>
          )}
        </div>
      </section>

      {revision.failureReason ? (
        <section
          className="v4-revisions__inspector-callout v4-revisions__inspector-callout--danger"
          data-testid="v4-revision-failure"
        >
          <h3>Failure</h3>
          <p>{revision.failureReason}</p>
        </section>
      ) : null}

      {isPreparing ? (
        <section className="v4-revisions__inspector-section">
          <h3>Workflow</h3>
          <div className="v4-deliverables__workflow">
            <button
              type="button"
              className="v4-deliverables__primary v4-deliverables__primary--wide"
              onClick={onAddDeliverable}
              disabled={mutationPending}
              data-testid="v4-revision-add-deliverable"
            >
              Add Deliverable
            </button>
            {canFinalize ? (
              <button
                type="button"
                className="v4-deliverables__primary v4-deliverables__primary--wide"
                onClick={() => onFinalize(revision)}
                disabled={finalizePending || mutationPending}
                aria-busy={finalizePending}
                data-testid="v4-revision-finalize"
              >
                {finalizePending ? 'Finalizing…' : 'Finalize Revision'}
              </button>
            ) : finalizeDisabledReason ? (
              <p
                className="v4-deliverables__finalize-note"
                data-testid="v4-revision-finalize-disabled"
              >
                {finalizeDisabledReason}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {canResume ? (
        <section className="v4-revisions__inspector-section" data-testid="v4-revision-resume-panel">
          <h3>Workflow</h3>
          <div className="v4-deliverables__workflow">
            <button
              type="button"
              className="v4-deliverables__resume"
              onClick={() => onResume(revision)}
              disabled={resumePending || mutationPending}
              aria-busy={resumePending}
              data-testid="v4-revision-resume"
            >
              <PlayCircle aria-hidden="true" />
              {resumePending ? 'Resuming…' : 'Resume Revision'}
            </button>
            <p className="v4-deliverables__finalize-note">
              Returns this composed Revision to Preparing so its Deliverables can be completed. No
              Output is regenerated.
            </p>
          </div>
        </section>
      ) : null}

      {/* P2C-03 — Safe Revision Delete action, gated by server eligibility. */}
      {isPreparing ? (
        <section className="v4-revisions__inspector-section" data-testid="v4-revision-delete-panel">
          <h3>Danger Zone</h3>
          {canRetryDelete && !deletePending && !mutationPending ? (
            <div className="v4-deliverables__workflow">
              <div
                className="v4-revisions__inspector-callout v4-revisions__inspector-callout--danger"
                data-testid="v4-revision-delete-recovery"
              >
                <h3>Delete interrupted</h3>
                <p>
                  The previous Revision Delete was interrupted. Its persisted operation can be
                  safely resumed.
                </p>
              </div>
              <button
                type="button"
                className="v4-deliverables__danger"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deletePending || mutationPending}
                data-testid="v4-revision-retry-delete"
              >
                <RotateCcw aria-hidden="true" />
                Retry Delete
              </button>
            </div>
          ) : canDelete && !deletePending && !mutationPending ? (
            <div className="v4-deliverables__workflow">
              <button
                type="button"
                className="v4-deliverables__danger"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deletePending || mutationPending}
                data-testid="v4-revision-delete"
              >
                <Trash2 aria-hidden="true" />
                Delete Revision
              </button>
            </div>
          ) : deleteEligibility ? (
            <ul
              className="v4-deliverables__blocked-reasons"
              data-testid="v4-revision-delete-blocked"
            >
              {blockedDeleteReasons.map((reason) => (
                <li key={reason}>{DELETE_REASON_LABELS[reason] ?? reason}</li>
              ))}
              {blockedDeleteReasons.length === 0 ? (
                <li>Deletion is not available for this Revision.</li>
              ) : null}
            </ul>
          ) : (
            <p className="v4-deliverables__finalize-note" data-testid="v4-revision-delete-loading">
              Checking delete eligibility…
            </p>
          )}
        </section>
      ) : null}

      {isFinalized ? (
        <p className="v4-deliverables__finalize-note" data-testid="v4-revision-finalized-readonly">
          This Revision is finalized and immutable. Add and remove Deliverable actions are disabled.
        </p>
      ) : null}

      {isPreparing ? (
        <ToolSessionSurface projectId={projectId} documents={documents} fixedRevision={revision} />
      ) : null}

      <Disclosure
        title="Advanced Metadata"
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((current) => !current)}
        testId="v4-revision-advanced"
      >
        <dl className="v4-revisions__inspector-dl">
          <div>
            <dt>Revision ID</dt>
            <dd className="v4-revisions__inspector-id">{revision.revisionId}</dd>
          </div>
          <div>
            <dt>Sequence</dt>
            <dd>{revision.revisionSequence}</dd>
          </div>
          <div>
            <dt>Provenance</dt>
            <dd>{revision.provenanceClassification}</dd>
          </div>
          <div>
            <dt>Snapshot Hash</dt>
            <dd className="v4-revisions__inspector-hash">{revision.snapshotHash ?? '—'}</dd>
          </div>
        </dl>
      </Disclosure>

      {generatedOutputs.length > 0 ? (
        <section className="v4-revisions__inspector-section">
          <h3>Generated Outputs</h3>
          <div className="v4-revisions__inspector-outputs-grid">
            {generatedOutputs.map((deliverable) => (
              <article
                key={deliverable.deliverableId}
                className="v4-revisions__inspector-output-card"
              >
                <div className="v4-revisions__inspector-output-header">
                  <button
                    type="button"
                    className="v4-revision-file-link"
                    disabled={deliverable.presence !== 'Present' || !onOpenDeliverable}
                    onClick={() => onOpenDeliverable?.(deliverable)}
                  >
                    {/\.pdf$/i.test(deliverable.fileName ?? '') || deliverable.format === 'PDF' ? (
                      <SctPdf size={16} style={{ color: 'var(--v4-danger)' }} />
                    ) : (
                      <FileText size={14} />
                    )}
                    <span>{deliverableTitle(deliverable)}</span>
                  </button>
                </div>
                <div className="v4-revisions__inspector-output-body">
                  <span className="v4-revisions__inspector-output-version">
                    {outputFamilyLabel(deliverable.outputFamily) ?? '—'}
                  </span>
                  <span
                    className={`v4-revisions__artifact-badge v4-revisions__artifact-badge--${deliverable.presence.toLowerCase()}`}
                  >
                    {deliverable.presence}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {documentSnapshots.length > 0 ? (
        <section className="v4-revisions__inspector-section">
          <h3>Document Snapshots</h3>
          <div className="v4-revisions__inspector-outputs-grid">
            {documentSnapshots.map((deliverable) => (
              <article
                key={deliverable.deliverableId}
                className="v4-revisions__inspector-output-card"
              >
                <div className="v4-revisions__inspector-output-header">
                  <button
                    type="button"
                    className="v4-revision-file-link"
                    disabled={deliverable.presence !== 'Present' || !onOpenDeliverable}
                    onClick={() => onOpenDeliverable?.(deliverable)}
                  >
                    {/\.pdf$/i.test(deliverable.fileName ?? '') || deliverable.format === 'PDF' ? (
                      <SctPdf size={16} style={{ color: 'var(--v4-danger)' }} />
                    ) : (
                      <FileText size={14} />
                    )}
                    <span>{deliverableTitle(deliverable)}</span>
                  </button>
                </div>
                <div className="v4-revisions__inspector-output-body">
                  <span className="v4-revisions__inspector-output-version">
                    {deliverable.category ?? '—'}
                  </span>
                  <span
                    className={`v4-revisions__artifact-badge v4-revisions__artifact-badge--${deliverable.presence.toLowerCase()}`}
                  >
                    {deliverable.presence}
                  </span>
                </div>
                {isPreparing ? (
                  <button
                    type="button"
                    className="v4-deliverables__remove"
                    aria-label={`Remove ${deliverableTitle(deliverable)}`}
                    disabled={mutationPending}
                    data-testid={`v4-remove-deliverable-${deliverable.deliverableId}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveDeliverable(deliverable);
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* Legacy outputs grid retained for backward-compatible visibility. */}
      {outputs.length > 0 && generatedOutputs.length === 0 ? (
        <section className="v4-revisions__inspector-section">
          <h3>Outputs in Revision</h3>
          <div className="v4-revisions__inspector-outputs-grid">
            {outputs.map((output) => (
              <article key={output.outputId} className="v4-revisions__inspector-output-card">
                <div className="v4-revisions__inspector-output-header">
                  <FileText size={14} aria-hidden="true" />
                  <span>
                    {outputFamilyLabel(output.outputFamily) ?? 'Output'} · {output.outputFormat}
                  </span>
                </div>
                <div className="v4-revisions__inspector-output-body">
                  <span className="v4-revisions__inspector-output-version">
                    {output.templateVersionId ?? output.templateId ?? '—'}
                  </span>
                  <span
                    className={`v4-revisions__badge v4-revisions__badge--${lifecycleTone(output.lifecycleState)}`}
                  >
                    {output.lifecycleState}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* P2C-03 — Delete Revision confirmation dialog with counts + source-preservation text. */}
      {deleteConfirmOpen ? (
        <div className="v4-deliverables__confirm-layer" data-testid="v4-revision-delete-confirm">
          <div className="v4-deliverables__confirm" role="dialog" aria-modal="true">
            <h2>{canRetryDelete ? 'Retry Delete' : 'Delete Revision'}</h2>
            <p className="v4-deliverables__confirm-label">{revision.revisionLabel}</p>
            <dl className="v4-deliverables__confirm-counts">
              <div>
                <dt>Deliverables</dt>
                <dd>
                  {counts.documentSnapshots + counts.datasheetSnapshots + counts.generatedOutputs}
                </dd>
              </div>
              <div>
                <dt>Generated Outputs</dt>
                <dd>{counts.generatedOutputs}</dd>
              </div>
              <div>
                <dt>Document Snapshots</dt>
                <dd>{counts.documentSnapshots}</dd>
              </div>
              <div>
                <dt>Datasheets</dt>
                <dd>{counts.datasheetSnapshots}</dd>
              </div>
            </dl>
            <p className="v4-deliverables__confirm-safety" data-testid="v4-revision-delete-safety">
              Original Project Documents and Datasheet source files will not be deleted.
            </p>
            <div className="v4-deliverables__confirm-actions">
              <button
                type="button"
                className="v4-deliverables__secondary"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deletePending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v4-deliverables__danger"
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  onDelete(revision);
                }}
                disabled={deletePending}
                data-testid="v4-confirm-delete-revision"
              >
                {deletePending
                  ? canRetryDelete
                    ? 'Retrying…'
                    : 'Deleting…'
                  : canRetryDelete
                    ? 'Retry Delete'
                    : 'Delete Revision'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
