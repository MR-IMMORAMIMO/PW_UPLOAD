/**
 * Right-side inspector for a selected unified Revision Deliverable.
 *
 * Handles both discriminated source types (GeneratedOutput and
 * DocumentSnapshot) with a common "Deliverable Details" header, then
 * source-specific sections. For DocumentSnapshot: Identity / Document Snapshot /
 * Artifact / Content Integrity / Provenance. For GeneratedOutput: Identity /
 * Output / Artifact / Template & metadata. No raw JSON by default, no
 * horizontal scroll. SHA-256 / content hash is labelled truthfully.
 */
import { useState } from 'react';
import type { CanonicalRevisionRecord, RevisionDeliverable } from '@scli/domain';
import { ExternalLink, FileText, File, X } from '../../components/common/SctIcons';
import {
  deliverableSourceLabel,
  deliverableTitle,
  deliverableTypeLabel,
  formatIsoDateTime,
} from './revisionsViewModel';
import { Disclosure } from './Disclosure';

export function DeliverableInspector({
  deliverable,
  revisions,
  onClose,
  onOpen,
}: {
  deliverable: RevisionDeliverable;
  revisions: CanonicalRevisionRecord[];
  onClose: () => void;
  onOpen: (deliverable: RevisionDeliverable) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const revision = revisions.find((r) => r.revisionId === deliverable.revisionId);
  const artifactState = deliverable.presence;
  const canOpenArtifact = artifactState === 'Present';
  const typeLabel = deliverableTypeLabel(deliverable);
  const format = deliverable.format;
  const isGenerated = deliverable.sourceType === 'GeneratedOutput';
  const hashLabel = isGenerated ? 'Content Hash' : 'SHA-256';
  const sourceLabel = deliverableSourceLabel(deliverable);

  return (
    <div className="v4-revisions__inspector" data-testid="v4-deliverable-inspector">
      <header className="v4-revisions__inspector-header">
        <h2>Deliverable Details</h2>
        <button
          type="button"
          className="v4-revisions__inspector-close"
          aria-label="Close deliverable details"
          data-testid="v4-deliverable-inspector-close"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className="v4-revisions__inspector-identity">
        <span className="v4-revisions__inspector-icon" aria-hidden="true">
          {isGenerated ? (
            <FileText size={22} strokeWidth={1.75} />
          ) : (
            <File size={22} strokeWidth={1.75} />
          )}
        </span>
        <div className="v4-revisions__inspector-identity-main">
          <span className="v4-revisions__inspector-title">{deliverableTitle(deliverable)}</span>
          <span
            className={`v4-deliverables__source-chip v4-deliverables__source-chip--${isGenerated ? 'generated' : 'registered'}`}
          >
            {sourceLabel}
          </span>
        </div>
      </div>

      <section className="v4-revisions__inspector-section">
        <h3>Identity</h3>
        <dl className="v4-revisions__inspector-dl">
          <div>
            <dt>Source</dt>
            <dd>{sourceLabel}</dd>
          </div>
          <div>
            <dt>Deliverable ID</dt>
            <dd className="v4-revisions__inspector-id">{deliverable.deliverableId}</dd>
          </div>
          {!isGenerated ? (
            <div>
              <dt>Source Document ID</dt>
              <dd className="v4-revisions__inspector-id">{deliverable.sourceId}</dd>
            </div>
          ) : null}
          <div>
            <dt>Revision</dt>
            <dd>{revision?.revisionLabel ?? '—'}</dd>
          </div>
        </dl>
      </section>

      {isGenerated ? (
        <>
          <section className="v4-revisions__inspector-section">
            <h3>Output</h3>
            <dl className="v4-revisions__inspector-dl">
              <div>
                <dt>Family</dt>
                <dd>{typeLabel ?? '—'}</dd>
              </div>
              <div>
                <dt>Format</dt>
                <dd>{format ?? '—'}</dd>
              </div>
              <div>
                <dt>Output ID</dt>
                <dd className="v4-revisions__inspector-id">{deliverable.deliverableId}</dd>
              </div>
              <div>
                <dt>Lifecycle</dt>
                <dd>{deliverable.lifecycleState ?? '—'}</dd>
              </div>
              <div>
                <dt>Created By</dt>
                <dd>{revision?.createdByName ?? '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="v4-revisions__inspector-section">
            <h3>Artifact</h3>
            {canOpenArtifact ? (
              <button
                type="button"
                className="v4-revisions__artifact-open"
                data-testid="v4-deliverable-artifact-open"
                onClick={() => onOpen(deliverable)}
              >
                <ExternalLink size={14} aria-hidden="true" />
                <span>Open Artifact</span>
              </button>
            ) : (
              <p
                className="v4-revisions__artifact-message"
                data-testid="v4-deliverable-artifact-message"
              >
                {artifactState === 'Missing'
                  ? 'Artifact is registered but the physical file is missing.'
                  : artifactState === 'Unavailable'
                    ? 'Artifact state is currently unavailable.'
                    : 'No safely openable artifact is available.'}
              </p>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="v4-revisions__inspector-section">
            <h3>Document Snapshot</h3>
            <dl className="v4-revisions__inspector-dl">
              <div>
                <dt>Title</dt>
                <dd>{deliverable.title ?? '—'}</dd>
              </div>
              <div>
                <dt>Filename</dt>
                <dd className="v4-revisions__inspector-locator">{deliverable.fileName ?? '—'}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{deliverable.category ?? '—'}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{deliverable.sizeBytes != null ? `${deliverable.sizeBytes} bytes` : '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="v4-revisions__inspector-section">
            <h3>Content Integrity</h3>
            <dl className="v4-revisions__inspector-dl">
              <div>
                <dt>SHA-256</dt>
                <dd className="v4-revisions__inspector-hash">{deliverable.contentHash ?? '—'}</dd>
              </div>
              <div>
                <dt>Snapshot Time</dt>
                <dd>{revision?.createdAt ? formatIsoDateTime(revision.createdAt) : '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="v4-revisions__inspector-section">
            <h3>Provenance</h3>
            <dl className="v4-revisions__inspector-dl">
              <div>
                <dt>Source</dt>
                <dd>{sourceLabel}</dd>
              </div>
              <div>
                <dt>Immutable Snapshot</dt>
                <dd>Yes — independent of the mutable source document</dd>
              </div>
            </dl>
          </section>
        </>
      )}

      <section className="v4-revisions__inspector-section">
        <h3>Artifact</h3>
        <dl className="v4-revisions__inspector-dl">
          <div>
            <dt>Artifact State</dt>
            <dd>
              <span
                className={`v4-revisions__artifact-badge v4-revisions__artifact-badge--${artifactState.toLowerCase()}`}
              >
                {artifactState}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <Disclosure
        title="Advanced Metadata"
        open={advancedOpen}
        onToggle={() => setAdvancedOpen((current) => !current)}
        testId="v4-deliverable-advanced"
      >
        <dl className="v4-revisions__inspector-dl">
          <div>
            <dt>{hashLabel}</dt>
            <dd className="v4-revisions__inspector-hash">{deliverable.contentHash ?? '—'}</dd>
          </div>
          {deliverable.revisionId ? (
            <div>
              <dt>Revision ID</dt>
              <dd className="v4-revisions__inspector-id">{deliverable.revisionId}</dd>
            </div>
          ) : null}
          <div>
            <dt>Project ID</dt>
            <dd className="v4-revisions__inspector-id">{deliverable.projectId}</dd>
          </div>
        </dl>
      </Disclosure>
    </div>
  );
}
