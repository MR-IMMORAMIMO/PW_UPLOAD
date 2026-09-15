import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileSearch, RefreshCw, Upload } from '../../components/common/SctIcons';
import type {
  DocumentAssociationEvidenceRead,
  DocumentConsistencyResultRead,
  DocumentDecisionRead,
  DocumentExtractionValueRead,
  DocumentFindingRead,
  DocumentRelationshipRead,
  DocumentRoutingProposalRead,
  IntelligenceDocumentRead,
  OwnerDocumentDecisionInput,
} from '@scli/contracts';
import { api } from '../../api/environment';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Button } from '../../components/common/V4Button';
import { V4Pagination } from '../../components/common/V4Pagination';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import { executeDocumentSourceHandoff } from '../../desktop/integrations';
import { DocumentList } from './DocumentList';
import { DocumentEvidencePane, type DocumentPreview } from './DocumentEvidencePane';
import { DocumentInspector } from './DocumentInspector';
import './documentReviewCenter.css';

type QueueFilter =
  | 'ALL'
  | 'NEEDS_REVIEW'
  | 'BLOCKING'
  | 'WARNING'
  | 'UNRESOLVED'
  | 'ACCEPTED'
  | 'SUPERSEDED'
  | 'OCR_NEEDED'
  | 'FAILED';
const filters: Array<{ value: QueueFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'NEEDS_REVIEW', label: 'Needs Review' },
  { value: 'BLOCKING', label: 'Blocking' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'UNRESOLVED', label: 'Unresolved' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'SUPERSEDED', label: 'Superseded' },
  { value: 'OCR_NEEDED', label: 'OCR Needed' },
  { value: 'FAILED', label: 'Processing Failed' },
];

export function DocumentReviewCenterPage() {
  const selectionRequest = useRef(0);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    readStoredSidebarMode(window.localStorage),
  );
  const [items, setItems] = useState<IntelligenceDocumentRead[]>([]);
  const [selected, setSelected] = useState<IntelligenceDocumentRead | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('NEEDS_REVIEW');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [evidence, setEvidence] = useState<DocumentExtractionValueRead[]>([]);
  const [associationEvidence, setAssociationEvidence] = useState<DocumentAssociationEvidenceRead[]>(
    [],
  );
  const [findings, setFindings] = useState<DocumentFindingRead[]>([]);
  const [relationships, setRelationships] = useState<DocumentRelationshipRead[]>([]);
  const [decisions, setDecisions] = useState<DocumentDecisionRead[]>([]);
  const [routing, setRouting] = useState<DocumentRoutingProposalRead[]>([]);
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [consistencyBusy, setConsistencyBusy] = useState(false);
  const [consistencySummary, setConsistencySummary] = useState<
    (DocumentConsistencyResultRead & { projectId: string }) | null
  >(null);
  const [consistencyStatus, setConsistencyStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const projectId = useMemo(
    () => new URLSearchParams(window.location.search).get('projectId') ?? undefined,
    [],
  );

  const query = useMemo(() => {
    const result: Record<string, string> = { page: String(page), limit: '50' };
    if (projectId) result.projectId = projectId;
    if (search.trim()) result.search = search.trim();
    if (filter === 'NEEDS_REVIEW') result.lifecycle = 'NEEDS_REVIEW';
    if (filter === 'BLOCKING') result.findingSeverity = 'BLOCKING';
    if (filter === 'WARNING') result.findingSeverity = 'WARNING';
    if (filter === 'UNRESOLVED') result.associationState = 'UNRESOLVED';
    if (filter === 'ACCEPTED') result.lifecycle = 'ACCEPTED';
    if (filter === 'SUPERSEDED') result.lifecycle = 'SUPERSEDED';
    if (filter === 'OCR_NEEDED') result.findingCode = 'OCR_REQUIRED';
    if (filter === 'FAILED') result.processingState = 'FAILED_RETRYABLE';
    return result;
  }, [filter, page, projectId, search]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.documents(query);
      setItems(response.items);
      setTotalCount(response.totalCount);
      setSelected((current) => {
        if (current)
          return response.items.find((item) => item.id === current.id) ?? response.items[0] ?? null;
        return response.items[0] ?? null;
      });
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Document queue is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadSelection = useCallback(async (document: IntelligenceDocumentRead | null) => {
    const requestId = ++selectionRequest.current;
    if (!document) {
      setEvidence([]);
      setAssociationEvidence([]);
      setFindings([]);
      setRelationships([]);
      setDecisions([]);
      setRouting([]);
      setPreview(null);
      return;
    }
    const [
      evidencePage,
      associationRows,
      findingRows,
      relationshipRows,
      decisionRows,
      routingRows,
      previewResult,
    ] = await Promise.all([
      api.documentEvidence(document.id, 0, 100),
      api.documentAssociationEvidence(document.id),
      api.documentFindings(document.id),
      api.documentRelationships(document.id),
      api.documentDecisions(document.id),
      api.documentRoutingProposals(document.id),
      api.documentPreview(document.id, 1).catch(() => null),
    ]);
    if (requestId !== selectionRequest.current) return;
    setEvidence(evidencePage.items);
    setAssociationEvidence(associationRows);
    setFindings(findingRows);
    setRelationships(relationshipRows);
    setDecisions(decisionRows);
    setRouting(routingRows);
    setPreview(previewResult);
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);
  useEffect(() => {
    void loadSelection(selected).catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Evidence is unavailable.'),
    );
  }, [loadSelection, selected]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (
        items.some(
          (item) =>
            !['COMPLETE', 'INCOMPLETE', 'FAILED_RETRYABLE', 'CANCELLED', 'INTERRUPTED'].includes(
              item.processingState,
            ),
        )
      )
        void loadQueue();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [items, loadQueue]);

  const toggleSidebar = () =>
    setSidebarMode((current) => {
      const next = current === 'extended' ? 'minimal' : 'extended';
      writeStoredSidebarMode(window.localStorage, next);
      return next;
    });

  const selectPdf = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const admission = await api.createDocumentAdmission({
        originalFileName: 'selected-document.pdf',
        idempotencyKey,
        ...(projectId ? { projectContextId: projectId } : {}),
      });
      const result = await executeDocumentSourceHandoff(admission.handoff);
      if (result === 'cancelled') {
        setMessage('PDF selection was cancelled.');
        return;
      }
      if (result === 'failed') throw new Error('The bounded Desktop PDF picker is unavailable.');
      await api.completeDocumentAdmission(admission.admissionId, {
        idempotencyKey,
        ...(projectId ? { projectContextId: projectId } : {}),
      });
      setFilter('ALL');
      setPage(0);
      await loadQueue();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The PDF could not be admitted.');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: Omit<OwnerDocumentDecisionInput, 'expectedRowVersion'>) => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await api.decideDocument(selected.id, {
        ...decision,
        expectedRowVersion: selected.rowVersion,
      });
      setSelected(updated);
      await loadQueue();
      await loadSelection(updated);
    } catch (error) {
      const failure = error instanceof Error ? error.message : 'The Owner decision failed.';
      try {
        await loadQueue();
        const authoritative = await api.document(selected.id);
        setSelected(authoritative);
        await loadSelection(authoritative);
      } catch {
        // Retain the original server rejection; a later explicit refresh can recover transport loss.
      }
      setMessage(failure);
    } finally {
      setBusy(false);
    }
  };
  const recomputeConsistency = async () => {
    if (!selected?.confirmedProjectId) {
      const failure = 'Confirm the Project before recomputing consistency.';
      setConsistencyStatus(failure);
      setMessage(failure);
      return;
    }
    const selectedDocumentId = selected.id;
    const confirmedProjectId = selected.confirmedProjectId;
    setBusy(true);
    setConsistencyBusy(true);
    setConsistencyStatus('Recomputing the authoritative Project source set…');
    setMessage(null);
    try {
      const result = await api.recomputeDocumentConsistency(
        confirmedProjectId,
        crypto.randomUUID(),
      );
      await loadQueue();
      const refreshedDocument = await api.document(
        result.affectedDocumentIds[0] ?? selectedDocumentId,
      );
      setSelected(refreshedDocument);
      await loadSelection(refreshedDocument);
      setConsistencySummary({ ...result, projectId: confirmedProjectId });
      const status = result.findings
        ? `Consistency recomputed across ${result.eligibleDocuments} eligible documents. ${result.findings} conflict finding${result.findings === 1 ? '' : 's'} refreshed.`
        : `Consistency recomputed across ${result.eligibleDocuments} eligible documents. No conflicts were found.`;
      setConsistencyStatus(status);
      setMessage(status);
    } catch (error) {
      const failure =
        error instanceof Error ? error.message : 'Consistency could not be recomputed.';
      setConsistencyStatus(failure);
      setMessage(failure);
    } finally {
      setConsistencyBusy(false);
      setBusy(false);
    }
  };
  const retry = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.retryDocumentProcessing(selected.id, {
        expectedRowVersion: selected.rowVersion,
        idempotencyKey: crypto.randomUUID(),
      });
      await loadQueue();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Retry could not be queued.');
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.cancelDocumentProcessing(selected.id, { expectedRowVersion: selected.rowVersion });
      await loadQueue();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Processing could not be cancelled.');
    } finally {
      setBusy(false);
    }
  };
  const createRouting = async (destinationMappingId: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.createDocumentRoutingProposal(selected.id, {
        expectedRowVersion: selected.rowVersion,
        destinationMappingId,
      });
      await loadSelection(selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Routing proposal could not be created.');
    } finally {
      setBusy(false);
    }
  };
  const approveRouting = async (proposal: DocumentRoutingProposalRead) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.approveDocumentRoutingProposal(selected.id, proposal.id, {
        expectedRowVersion: proposal.rowVersion,
        expectedEligibilityFingerprint: proposal.eligibilityFingerprint,
        reason: 'Owner approved this exact routing eligibility fingerprint.',
      });
      await loadSelection(selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Routing proposal approval failed.');
    } finally {
      setBusy(false);
    }
  };
  const executeRouting = async (proposal: DocumentRoutingProposalRead) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.executeDocumentRoutingProposal(selected.id, proposal.id, {
        expectedRowVersion: proposal.rowVersion,
      });
      await loadSelection(selected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Routing execution failed revalidation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <V4AppShell
      context="global"
      sidebarMode={sidebarMode}
      onToggleSidebarMode={toggleSidebar}
      activeSectionId="documents"
      boundedPage
      pageHeader={
        <V4PageHeader
          title="Document Review Center"
          description="Local PDF intelligence, OCR evidence, quality findings and governed Owner review."
          icon={FileSearch}
          actions={
            <>
              <V4Button
                leadingIcon={<RefreshCw aria-hidden="true" />}
                disabled={loading}
                onClick={() => void loadQueue()}
              >
                Refresh
              </V4Button>
              <V4Button
                variant="primary"
                leadingIcon={<Upload aria-hidden="true" />}
                disabled={busy}
                onClick={() => void selectPdf()}
              >
                Select PDF
              </V4Button>
            </>
          }
        />
      }
    >
      <main className="document-review" aria-label="Document Review Center">
        <div className="document-review__toolbar">
          <div className="document-review__filters" role="group" aria-label="Document filters">
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => {
                  setFilter(item.value);
                  setPage(0);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="document-review__search">
            <span>Search documents</span>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Filename or title"
            />
          </label>
        </div>
        {message ? (
          <div className="document-review__message" role="alert">
            {message}
          </div>
        ) : null}
        <div className="document-review__workspace">
          <section className="document-review__queue" aria-label="Review queue">
            <header>
              <div>
                <span className="document-review__eyebrow">Review queue</span>
                <h2>{totalCount} documents</h2>
              </div>
              {loading ? <span>Loading…</span> : null}
            </header>
            <DocumentList items={items} selectedId={selected?.id ?? null} onSelect={setSelected} />
            <V4Pagination
              pageCount={Math.ceil(totalCount / 50)}
              currentPage={page}
              onChange={setPage}
              ariaLabel="Document pages"
            />
          </section>
          <DocumentEvidencePane document={selected} preview={preview} evidence={evidence} />
          <DocumentInspector
            document={selected}
            evidenceCount={evidence.length}
            associationEvidence={associationEvidence}
            findings={findings}
            relationships={relationships}
            decisions={decisions}
            routing={routing}
            busy={busy}
            consistencyBusy={consistencyBusy}
            consistencyStatus={consistencyStatus}
            consistencySummary={
              selected?.confirmedProjectId === consistencySummary?.projectId
                ? consistencySummary
                : null
            }
            onAccept={() =>
              void decide({
                action: 'ACCEPT_DOCUMENT',
                reason: 'Owner reviewed and accepted the document intelligence.',
              })
            }
            onExclude={() =>
              void decide({
                action: 'EXCLUDE_DOCUMENT',
                reason: 'Owner excluded this document from active intelligence.',
              })
            }
            onRetry={() => void retry()}
            onCancel={() => void cancel()}
            onDecision={(input) => void decide(input)}
            onRecomputeConsistency={() => void recomputeConsistency()}
            onCreateRouting={(mapping) => void createRouting(mapping)}
            onApproveRouting={(proposal) => void approveRouting(proposal)}
            onExecuteRouting={(proposal) => void executeRouting(proposal)}
          />
        </div>
      </main>
    </V4AppShell>
  );
}
