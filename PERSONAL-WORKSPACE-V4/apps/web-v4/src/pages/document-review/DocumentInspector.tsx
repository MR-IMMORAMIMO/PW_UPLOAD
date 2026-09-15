import { useEffect, useState } from 'react';
import type {
  DocumentAssociationEvidenceRead,
  DocumentConsistencyResultRead,
  DocumentDecisionRead,
  DocumentFindingRead,
  DocumentRelationshipRead,
  DocumentRoutingProposalRead,
  IntelligenceDocumentRead,
  OwnerDocumentDecisionInput,
} from '@scli/contracts';
import { V4Button } from '../../components/common/V4Button';
import {
  V4InspectorFrame,
  V4InspectorMetadata,
  V4InspectorSection,
} from '../../components/common/V4Inspector';

const classifications = [
  'DIALUX_CALCULATION_REPORT',
  'LIGHTING_LAYOUT',
  'LUMINAIRE_SCHEDULE',
  'BOQ_QTO',
  'PRODUCT_DATASHEET',
  'TECHNICAL_SUBMITTAL',
  'CLIENT_COMMENT_MARKUP',
  'REFERENCE_DOCUMENT',
  'MEETING_DOCUMENT',
  'COMMERCIAL_RECEIPT',
  'REVISION_REGISTER',
  'TRANSMITTAL',
  'COVER_SHEET',
  'VISUALIZATION_RENDERING',
  'UNKNOWN',
] as const;
const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
type Decision = Omit<OwnerDocumentDecisionInput, 'expectedRowVersion'>;
const pathLike = /^(?:[a-z]:[\\/]|\\\\|\/(?:home|users|var|tmp)\/)/i;
const safeEvidenceValue = (value: string) =>
  pathLike.test(value.trim()) ? 'Local path hidden' : value;

export function DocumentInspector({
  document,
  findings,
  associationEvidence,
  evidenceCount,
  relationships,
  decisions,
  routing,
  busy,
  consistencyBusy,
  consistencyStatus,
  consistencySummary,
  onAccept,
  onExclude,
  onRetry,
  onCancel,
  onDecision,
  onRecomputeConsistency,
  onCreateRouting,
  onApproveRouting,
  onExecuteRouting,
}: {
  document: IntelligenceDocumentRead | null;
  findings: DocumentFindingRead[];
  associationEvidence: DocumentAssociationEvidenceRead[];
  evidenceCount: number;
  relationships: DocumentRelationshipRead[];
  decisions: DocumentDecisionRead[];
  routing: DocumentRoutingProposalRead[];
  busy: boolean;
  consistencyBusy: boolean;
  consistencyStatus: string | null;
  consistencySummary: DocumentConsistencyResultRead | null;
  onAccept: () => void;
  onExclude: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onDecision: (decision: Decision) => void;
  onRecomputeConsistency: () => void;
  onCreateRouting: (destinationMappingId: string) => void;
  onApproveRouting: (proposal: DocumentRoutingProposalRead) => void;
  onExecuteRouting: (proposal: DocumentRoutingProposalRead) => void;
}) {
  const [classification, setClassification] = useState<(typeof classifications)[number]>('UNKNOWN');
  const [projectIdentity, setProjectIdentity] = useState('');
  const [reason, setReason] = useState('Owner reviewed the source-backed document evidence.');
  const [destinationMappingId, setDestinationMappingId] = useState('');
  useEffect(() => {
    setClassification(document?.classification ?? 'UNKNOWN');
    setProjectIdentity(document?.confirmedProjectId ?? '');
  }, [document]);
  const decide = (decision: Omit<Decision, 'reason'> & { reason?: string }) =>
    onDecision({ ...decision, reason: decision.reason ?? reason });
  const processingActive = document
    ? !['COMPLETE', 'INCOMPLETE', 'FAILED_RETRYABLE', 'CANCELLED', 'INTERRUPTED'].includes(
        document.processingState,
      )
    : false;
  const candidateProjectIds = [
    ...new Set(
      associationEvidence.flatMap((item) =>
        item.candidateProjectId ? [item.candidateProjectId] : [],
      ),
    ),
  ];

  return (
    <V4InspectorFrame
      title="Document Inspector"
      description={document ? 'Evidence, authority and review history' : 'No document selected'}
      className="document-review__inspector"
      footer={
        document ? (
          <div className="document-review__inspector-actions">
            <V4Button variant="primary" disabled={busy} onClick={onAccept}>
              Accept intelligence
            </V4Button>
            <V4Button disabled={busy} onClick={onRetry}>
              Retry processing
            </V4Button>
            {processingActive ? (
              <V4Button disabled={busy} onClick={onCancel}>
                Cancel processing
              </V4Button>
            ) : null}
            <V4Button variant="tertiary" disabled={busy} onClick={onExclude}>
              Exclude
            </V4Button>
          </div>
        ) : undefined
      }
    >
      {document ? (
        <>
          <V4InspectorSection title="Identity">
            <V4InspectorMetadata>
              <dt>Document</dt>
              <dd>{document.id}</dd>
              <dt>Version</dt>
              <dd>v{document.activeVersionSequence}</dd>
              <dt>Lifecycle</dt>
              <dd>{label(document.lifecycle)}</dd>
              <dt>Processing</dt>
              <dd>{label(document.processingState)}</dd>
            </V4InspectorMetadata>
            <div className="document-review__inline-actions">
              {document.processingState === 'INCOMPLETE' ? (
                <V4Button
                  disabled={busy}
                  onClick={() =>
                    decide({
                      action: 'ACCEPT_INCOMPLETE_INTELLIGENCE',
                      reason:
                        'Owner accepted bounded incomplete intelligence after reviewing the available evidence.',
                    })
                  }
                >
                  Accept incomplete
                </V4Button>
              ) : null}
              {document.lifecycle !== 'SUPERSEDED' ? (
                <V4Button
                  variant="tertiary"
                  disabled={busy}
                  onClick={() =>
                    decide({
                      action: 'SUPERSEDE_VERSION',
                      reason:
                        'Owner marked this document version superseded after relationship review.',
                    })
                  }
                >
                  Mark superseded
                </V4Button>
              ) : null}
            </div>
          </V4InspectorSection>
          <V4InspectorSection title="Classification">
            <V4InspectorMetadata>
              <dt>Classification</dt>
              <dd>{label(document.classification)}</dd>
              <dt>Confidence</dt>
              <dd>{Math.round(document.classificationConfidence)}%</dd>
            </V4InspectorMetadata>
            <div className="document-review__owner-controls">
              <label>
                Classification
                <select
                  value={classification}
                  onChange={(event) =>
                    setClassification(event.target.value as typeof classification)
                  }
                >
                  {classifications.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </label>
              <V4Button
                disabled={busy || classification === document.classification}
                onClick={() => decide({ action: 'OVERRIDE_CLASSIFICATION', classification })}
              >
                Apply classification
              </V4Button>
            </div>
          </V4InspectorSection>
          <V4InspectorSection title="Project Association">
            <V4InspectorMetadata>
              <dt>Current state</dt>
              <dd>{label(document.associationState)}</dd>
              <dt>Confirmed Project</dt>
              <dd>{document.confirmedProjectId ?? 'Not confirmed'}</dd>
            </V4InspectorMetadata>
            {document.associationState === 'CONFLICTING' ? (
              <p className="document-review__association-guidance" data-state="conflicting">
                Conflicting strong evidence requires an explicit Owner decision. No routing or
                comparison inclusion is allowed until Project authority is resolved.
              </p>
            ) : null}
            {document.associationState === 'AMBIGUOUS' ? (
              <p className="document-review__association-guidance">
                Multiple plausible Project candidates were found. Choose a candidate only after
                reviewing why each one was proposed.
              </p>
            ) : null}
            {document.associationState === 'UNRESOLVED' ? (
              <p className="document-review__association-guidance">
                Available evidence is weak or insufficient, so Project confirmation was not
                automatic.
              </p>
            ) : null}
            <h4 className="document-review__section-label">Candidate Projects</h4>
            <div className="document-review__candidate-list">
              {candidateProjectIds.map((candidateProjectId) => (
                <div key={candidateProjectId}>
                  <code>{candidateProjectId}</code>
                  <V4Button
                    variant="tertiary"
                    disabled={busy}
                    onClick={() => setProjectIdentity(candidateProjectId)}
                  >
                    Use candidate
                  </V4Button>
                </div>
              ))}
              {!candidateProjectIds.length ? (
                <p className="document-review__muted">No Project candidate was identified.</p>
              ) : null}
            </div>
            <h4 className="document-review__section-label">Evidence</h4>
            <div className="document-review__association-evidence">
              {associationEvidence.map((item) => (
                <article key={item.id} data-contradictory={item.contradictory}>
                  <strong>{label(item.evidenceType)}</strong>
                  <span>
                    {item.strength} · {item.contradictory ? 'Contradictory' : 'Supporting'}
                  </span>
                  <p>{item.reason}</p>
                  <dl>
                    <dt>Project</dt>
                    <dd>{item.candidateProjectId ?? 'No exact candidate'}</dd>
                    <dt>Normalized value</dt>
                    <dd>{safeEvidenceValue(item.normalizedValue)}</dd>
                    {item.pageNumber ? (
                      <>
                        <dt>Source page</dt>
                        <dd>{item.pageNumber}</dd>
                      </>
                    ) : null}
                  </dl>
                </article>
              ))}
              {!associationEvidence.length ? (
                <p className="document-review__muted">No machine association evidence.</p>
              ) : null}
            </div>
            <div className="document-review__owner-controls">
              <label>
                Project UUID
                <input
                  value={projectIdentity}
                  onChange={(event) => setProjectIdentity(event.target.value)}
                  placeholder="Project identity"
                />
              </label>
              <div className="document-review__inline-actions">
                <V4Button
                  disabled={busy || !projectIdentity.trim()}
                  onClick={() =>
                    decide({
                      action: 'CONFIRM_PROJECT_ASSOCIATION',
                      projectId: projectIdentity.trim(),
                    })
                  }
                >
                  Confirm Project
                </V4Button>
                <V4Button
                  variant="tertiary"
                  disabled={busy}
                  onClick={() => decide({ action: 'REJECT_PROJECT_ASSOCIATION' })}
                >
                  Reject association
                </V4Button>
              </div>
              <label>
                Owner reason
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                />
              </label>
            </div>
          </V4InspectorSection>
          <V4InspectorSection title="Extracted Data">
            <p className="document-review__muted">
              {evidenceCount} source-backed values loaded in the bounded evidence pane.
            </p>
            <V4Button
              disabled={
                busy ||
                document.lifecycle !== 'ACCEPTED' ||
                document.associationState !== 'CONFIRMED'
              }
              onClick={() =>
                decide({
                  action: document.comparisonEnabled ? 'EXCLUDE_COMPARISON' : 'INCLUDE_COMPARISON',
                })
              }
            >
              {document.comparisonEnabled ? 'Exclude from comparison' : 'Include in comparison'}
            </V4Button>
          </V4InspectorSection>
          <V4InspectorSection title="Cross-document Consistency">
            {!document.confirmedProjectId ? (
              <p className="document-review__muted">
                Confirm the Project before recomputing consistency.
              </p>
            ) : (
              <p className="document-review__muted">
                The server revalidates accepted, comparison-enabled, current documents for this
                exact confirmed Project.
                {document.lifecycle !== 'ACCEPTED' || !document.comparisonEnabled
                  ? ' This document is not currently in that eligible source set.'
                  : ' This document is currently eligible.'}
              </p>
            )}
            {consistencySummary ? (
              <V4InspectorMetadata>
                <dt>Eligible documents</dt>
                <dd>{consistencySummary.eligibleDocuments}</dd>
                <dt>Findings refreshed</dt>
                <dd>{consistencySummary.findings}</dd>
                <dt>Source-set fingerprint</dt>
                <dd className="document-review__fingerprint">{consistencySummary.fingerprint}</dd>
              </V4InspectorMetadata>
            ) : null}
            {consistencyStatus ? (
              <p className="document-review__consistency-status" aria-live="polite">
                {consistencyStatus}
              </p>
            ) : null}
            <V4Button
              disabled={busy || !document.confirmedProjectId}
              onClick={onRecomputeConsistency}
            >
              {consistencyBusy ? 'Recomputing consistency…' : 'Recompute consistency'}
            </V4Button>
          </V4InspectorSection>
          <V4InspectorSection title={`Quality findings (${findings.length})`}>
            <div className="document-review__finding-list">
              {findings.map((finding) => (
                <article key={finding.id} data-severity={finding.severity}>
                  <strong>{finding.title}</strong>
                  <span>
                    {finding.severity} · {label(finding.state)}
                  </span>
                  <p>{finding.explanation}</p>
                  {finding.state === 'OPEN' ? (
                    <div className="document-review__inline-actions">
                      <V4Button
                        disabled={busy}
                        onClick={() =>
                          decide({
                            action: 'ACKNOWLEDGE_FINDING',
                            findingId: finding.id,
                            fingerprint: finding.generationFingerprint,
                          })
                        }
                      >
                        Acknowledge
                      </V4Button>
                      <V4Button
                        disabled={busy}
                        onClick={() =>
                          decide({
                            action: 'RESOLVE_FINDING',
                            findingId: finding.id,
                            fingerprint: finding.generationFingerprint,
                          })
                        }
                      >
                        Resolve
                      </V4Button>
                      <V4Button
                        variant="tertiary"
                        disabled={busy || !reason.trim()}
                        onClick={() =>
                          decide({
                            action: 'DISMISS_FINDING',
                            findingId: finding.id,
                            fingerprint: finding.generationFingerprint,
                          })
                        }
                      >
                        Dismiss with reason
                      </V4Button>
                    </div>
                  ) : null}
                </article>
              ))}
              {!findings.length ? <p className="document-review__muted">No findings.</p> : null}
            </div>
          </V4InspectorSection>
          <V4InspectorSection title="Cross-document Conflicts">
            {findings
              .filter((finding) => finding.code.endsWith('_CONFLICT'))
              .map((finding) => (
                <div key={finding.id} className="document-review__relationship">
                  <strong>{label(finding.code)}</strong>
                  <p>{finding.explanation}</p>
                  {(finding.competingValues ?? []).length ? (
                    <ul className="document-review__conflict-values">
                      {finding.competingValues!.map((source) => (
                        <li key={`${source.documentId}:${source.versionId}:${source.field}`}>
                          <strong>{source.tag === null ? 'Unlabelled' : String(source.tag)}</strong>
                          <span>
                            {String(source.value)}
                            {source.unit ? ` ${source.unit}` : ''}
                            {source.basis ? ` · ${source.basis}` : ''}
                          </span>
                          <code>{source.documentId}</code>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <small>No winner is selected; the Owner must review every source value.</small>
                </div>
              ))}
            {!findings.some((finding) => finding.code.endsWith('_CONFLICT')) ? (
              <p className="document-review__muted">No active comparison conflicts.</p>
            ) : null}
          </V4InspectorSection>
          <V4InspectorSection title="Evidence">
            <p className="document-review__muted">
              Preview and extracted snippets retain page, method, confidence, and bounded source
              context.
            </p>
          </V4InspectorSection>
          <V4InspectorSection title={`Relationships (${relationships.length})`}>
            {relationships.map((relationship) => (
              <div key={relationship.id} className="document-review__relationship">
                <strong>{label(relationship.type)}</strong>
                <br />
                {label(relationship.state)} · {Math.round(relationship.confidence)}%
                {relationship.state === 'PROPOSED' ? (
                  <div className="document-review__inline-actions">
                    <V4Button
                      disabled={busy}
                      onClick={() =>
                        decide({ action: 'CONFIRM_RELATIONSHIP', relationshipId: relationship.id })
                      }
                    >
                      Confirm
                    </V4Button>
                    <V4Button
                      variant="tertiary"
                      disabled={busy}
                      onClick={() =>
                        decide({ action: 'REJECT_RELATIONSHIP', relationshipId: relationship.id })
                      }
                    >
                      Reject
                    </V4Button>
                  </div>
                ) : null}
              </div>
            ))}
            {!relationships.length ? (
              <p className="document-review__muted">No proposed relationships.</p>
            ) : null}
          </V4InspectorSection>
          <V4InspectorSection title={`Owner decisions (${decisions.length})`}>
            {decisions.slice(0, 10).map((decision) => (
              <p key={decision.id} className="document-review__decision">
                <strong>{label(decision.action)}</strong>
                <br />
                {decision.actorName} · {new Date(decision.decidedAt).toLocaleString()}
                <br />
                <span>{decision.reason}</span>
              </p>
            ))}
            {!decisions.length ? (
              <p className="document-review__muted">No Owner decisions yet.</p>
            ) : null}
          </V4InspectorSection>
          <V4InspectorSection title={`Routing Proposal (${routing.length})`}>
            {routing.map((proposal) => (
              <div key={proposal.id} className="document-review__relationship">
                <strong>{label(proposal.state)}</strong>
                <br />
                {proposal.destinationMappingId}
                <div className="document-review__inline-actions">
                  {proposal.state === 'PROPOSED' ? (
                    <V4Button disabled={busy} onClick={() => onApproveRouting(proposal)}>
                      Approve
                    </V4Button>
                  ) : null}
                  {proposal.state === 'APPROVED' ? (
                    <V4Button disabled={busy} onClick={() => onExecuteRouting(proposal)}>
                      Execute after revalidation
                    </V4Button>
                  ) : null}
                </div>
              </div>
            ))}
            {!routing.length ? (
              <div className="document-review__owner-controls">
                <p className="document-review__muted">
                  Routing remains unavailable until all evidence authority is settled.
                </p>
                <label>
                  Folder mapping ID
                  <input
                    value={destinationMappingId}
                    onChange={(event) => setDestinationMappingId(event.target.value)}
                    placeholder="Configured mapping identity"
                  />
                </label>
                <V4Button
                  disabled={busy || !destinationMappingId.trim()}
                  onClick={() => onCreateRouting(destinationMappingId.trim())}
                >
                  Create routing proposal
                </V4Button>
              </div>
            ) : null}
          </V4InspectorSection>
        </>
      ) : (
        <p className="document-review__muted">Choose a queue item to inspect.</p>
      )}
    </V4InspectorFrame>
  );
}
