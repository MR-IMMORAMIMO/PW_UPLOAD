import * as FinalGlyphs from '../../components/common/SctIcons';
import FinalRevisionsView from '../../components/final-ui/FinalRevisionsView';
import { V4ConfirmDialog } from '../../components/common/V4ConfirmDialog';
import { V4Drawer } from '../../components/common/V4Drawer';
/**
 * Project Revisions & Deliverables page (PW-V4-F3-REVISIONS, B1).
 *
 * Three tabs: Revisions, Deliverables, Recovery.
 * KPI band + dense tables + fixed right inspector.
 *
 * B1 evolution: the Deliverables tab is the unified Revision Deliverable read
 * model (GeneratedOutput + DocumentSnapshot). Manual PREPARING Revisions can be
 * created, given DocumentSnapshot deliverables, and finalized through the B0
 * authority. Filtering is view-model/local presentation only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generatePath, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SctWarning as AlertTriangle,
  SctInspect as FileQuestion,
  SctNotes as ScrollText,
} from '../../components/common/SctIcons';
import { History, Package } from '../../components/common/SctIcons';
import type { GenerateTechnicalScheduleInput, GenerateTechnicalBoqInput } from '@scli/contracts';
import type {
  CanonicalRevisionRecord,
  RevisionDeleteEligibility,
  RevisionDeliverable,
  RevisionReuseCandidate,
} from '@scli/domain';
import { api } from '../../api/environment';
import { businessTodayKey } from '../../date-time/businessDateTime';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4SplitPane } from '../../components/common/V4SplitPane';
import { V4RouteErrorState } from '../../components/common/V4RouteErrorState';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { isComposableTargetRevision } from '../../components/revisions/canonicalRevisionDisplay';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import {
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECT_COMMENTS,
  ROUTE_PROJECT_CONTACTS,
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_LUMINAIRES,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
} from '../../router/routes';
import {
  buildRevisionKpis,
  buildRevisionRows,
  buildCompatibilitySummary,
  buildDeliverableRows,
  buildRecoveryItems,
  composableTargetRevisions,
  deriveRevisionFilterOptions,
  deriveDeliverableFilterOptions,
  emptyRevisionFilters,
  emptyDeliverableFilters,
  filterRevisionRows,
  filterDeliverableRows,
  isRevisionFilterActive,
  isDeliverableFilterActive,
  paginateRows,
  type RevisionFilters,
  type DeliverableFilters,
  type RecoveryItem,
  type RevisionsTab,
} from './revisionsViewModel';
import { RevisionsTable } from './RevisionsTable';
import { DeliverablesTable } from './DeliverablesTable';
import { RecoveryTable } from './RecoveryTable';
import { RevisionInspector, type RevisionDetailsFocusRequest } from './RevisionInspector';
import { DeliverableInspector } from './DeliverableInspector';
import { RecoveryInspector } from './RecoveryInspector';
import { GenerateOutputMenu } from './GenerateOutputMenu';
import { AddDeliverableDrawer } from './AddDeliverableDrawer';
import './deliverables.css';

const routes: Record<string, string> = {
  summary: ROUTE_PROJECT_SUMMARY,
  workflow: ROUTE_PROJECT_WORKFLOW_TIMELINE,
  scope: ROUTE_PROJECT_SCOPE,
  actions: ROUTE_PROJECT_ACTIONS,
  meetings: ROUTE_PROJECT_MEETINGS,
  comments: ROUTE_PROJECT_COMMENTS,
  contacts: ROUTE_PROJECT_CONTACTS,
  luminaires: ROUTE_PROJECT_LUMINAIRES,
  datasheets: ROUTE_PROJECT_DATASHEETS_IMAGES,
  'technical-check': ROUTE_PROJECT_TECHNICAL_CHECK,
  'lighting-schedule': ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  'technical-boq': ROUTE_PROJECT_TECHNICAL_BOQ,
};

const TABS: Array<{ id: RevisionsTab; label: string }> = [
  { id: 'revisions', label: 'Revisions' },
  { id: 'deliverables', label: 'Deliverables' },
  { id: 'recovery', label: 'Recovery' },
];

const DEFAULT_PAGE_SIZE = 10;

export function acknowledgeRevisionDetailsFocusRequest(
  current: RevisionDetailsFocusRequest | null,
  handledRequestId: number,
): RevisionDetailsFocusRequest | null {
  return current?.id === handledRequestId ? null : current;
}

export function ProjectRevisionsWorkspace({ finalView = false }: { finalView?: boolean }) {
  const [finalDetailsOpen, setFinalDetailsOpen] = useState(false);
  const [finalPhase, setFinalPhase] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [finalizeTarget, setFinalizeTarget] = useState<CanonicalRevisionRecord | null>(null);
  const finalInitialSelection = useRef(false);
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const requestedRevisionId = searchParams.get('revisionId');
  const requestedTab = searchParams.get('tab');
  const requestedDetails = searchParams.get('details') === '1';
  const appliedDeepLink = useRef<string | null>(null);
  const navigate = useNavigate();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [activeTab, setActiveTab] = useState<RevisionsTab>('revisions');
  const [selectedRevision, setSelectedRevision] = useState<CanonicalRevisionRecord | null>(null);
  const [selectedDeliverable, setSelectedDeliverable] = useState<RevisionDeliverable | null>(null);
  const [selectedRecovery, setSelectedRecovery] = useState<RecoveryItem | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [pendingRevisionDetailsFocusRequest, setPendingRevisionDetailsFocusRequest] =
    useState<RevisionDetailsFocusRequest | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  // RECOVERY-SCOPED error state: rendered ONLY on the Recovery tab so a
  // malformed/recoverable Generated Output never turns the whole workspace into
  // a global error state. Mutation/operation errors remain in operationError.
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createPurpose, setCreatePurpose] = useState('');
  const [createInternalNote, setCreateInternalNote] = useState('');
  const [removeTarget, setRemoveTarget] = useState<RevisionDeliverable | null>(null);
  const [reuseTarget, setReuseTarget] = useState<RevisionReuseCandidate | null>(null);
  const [reuseReason, setReuseReason] = useState('');
  const [revisionFilters, setRevisionFilters] = useState<RevisionFilters>(emptyRevisionFilters);
  const [deliverableFilters, setDeliverableFilters] =
    useState<DeliverableFilters>(emptyDeliverableFilters);
  const [revisionPage, setRevisionPage] = useState(0);
  const [revisionPageSize, setRevisionPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [deliverablePage, setDeliverablePage] = useState(0);
  const [deliverablePageSize, setDeliverablePageSize] = useState(DEFAULT_PAGE_SIZE);
  const queryClient = useQueryClient();
  // Synchronous in-flight guard: mutation state updates asynchronously, so a
  // rapid double-click could otherwise fire two recoveries before React
  // re-renders. This ref enforces ONE mutation per user action synchronously.
  const recoveryInFlightRef = useRef(false);
  const nextRevisionDetailsFocusRequestIdRef = useRef(0);
  const reuseReasonRef = useRef<HTMLTextAreaElement>(null);
  const createPurposeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (reuseTarget) reuseReasonRef.current?.focus();
  }, [reuseTarget]);

  useEffect(() => {
    if (createDialogOpen) createPurposeRef.current?.focus();
  }, [createDialogOpen]);

  const projectQuery = useQuery({
    queryKey: ['v4', 'revisions', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });

  const workspaceQuery = useQuery({
    queryKey: ['v4', 'revisions', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: Boolean(projectId),
  });

  const revisionsQuery = useQuery({
    queryKey: ['v4', 'revisions', 'revisions', projectId],
    queryFn: () => api.projectRevisions(projectId as string),
    enabled: Boolean(projectId),
  });

  const outputsQuery = useQuery({
    queryKey: ['v4', 'revisions', 'outputs', projectId],
    queryFn: () => api.projectOutputs(projectId as string),
    enabled: Boolean(projectId),
  });

  // B0 unified Revision Deliverable read model for the currently selected
  // Revision (or the first selected one). Per-Revision read: never aggregates
  // every Revision's snapshots via N+1 reads.
  const selectedRevisionId = selectedRevision?.revisionId ?? null;
  const deliverablesQuery = useQuery({
    queryKey: ['v4', 'revisions', 'deliverables', projectId, selectedRevisionId],
    queryFn: () => api.revisionDeliverables(projectId as string, selectedRevisionId as string),
    enabled: Boolean(projectId && selectedRevisionId),
  });

  // PACKAGES-E2E-05A — Datasheet intake eligibility read for the selected
  // PREPARING MANUAL_DELIVERABLES Revision (project/revision-scoped).
  const datasheetEligibilityQuery = useQuery({
    queryKey: ['v4', 'revisions', 'datasheet-eligibility', projectId, selectedRevisionId],
    queryFn: () => api.datasheetEligibility(projectId as string, selectedRevisionId as string),
    enabled: Boolean(
      projectId &&
      selectedRevisionId &&
      selectedRevision?.lifecycleState === 'PREPARING' &&
      selectedRevision.projectSnapshot?.canonicalOperation === 'MANUAL_DELIVERABLES',
    ),
  });

  // P2C-03/P2C-10A — Safe Revision Delete eligibility for the selected
  // PREPARING Revision, including an explicit restart-safe retry projection.
  const deleteEligibilityQuery = useQuery({
    queryKey: ['v4', 'revisions', 'delete-eligibility', projectId, selectedRevisionId],
    queryFn: () => api.revisionDeleteEligibility(projectId as string, selectedRevisionId as string),
    enabled: Boolean(
      projectId && selectedRevisionId && selectedRevision?.lifecycleState === 'PREPARING',
    ),
  });

  const reuseEligibilityQuery = useQuery({
    queryKey: ['v4', 'revisions', 'reuse-eligibility', projectId],
    queryFn: () => api.revisionReuseEligibility(projectId as string),
    enabled: Boolean(projectId),
  });

  const project = projectQuery.data;
  const workspace = workspaceQuery.data ?? null;
  const revisions = revisionsQuery.data ?? [];
  const outputs = outputsQuery.data ?? [];
  const deliverables = deliverablesQuery.data ?? [];
  const datasheetEligibility = datasheetEligibilityQuery.data ?? [];
  const deleteEligibility: RevisionDeleteEligibility | null = deleteEligibilityQuery.data ?? null;
  const reuseCandidate = reuseEligibilityQuery.data?.candidate ?? null;

  const kpis = useMemo(() => buildRevisionKpis(revisions, outputs), [revisions, outputs]);
  const revisionRows = useMemo(
    () => buildRevisionRows(revisions, outputs, workspace),
    [revisions, outputs, workspace],
  );
  const selectedCompatibility = useMemo(
    () => (selectedRevision ? buildCompatibilitySummary(selectedRevision, workspace) : null),
    [selectedRevision, workspace],
  );
  const deliverableRows = useMemo(
    () => buildDeliverableRows(deliverables, revisions),
    [deliverables, revisions],
  );

  // STRICT per-Revision scoping: the Deliverables tab must show ONLY the
  // currently selected Revision's deliverables. This is a defensive guarantee —
  // even if a stale/foreign query result were ever present, no row from another
  // Revision can render under the selected Revision context.
  const scopedDeliverableRows = useMemo(
    () =>
      selectedRevisionId
        ? deliverableRows.filter((row) => row.deliverable.revisionId === selectedRevisionId)
        : [],
    [deliverableRows, selectedRevisionId],
  );
  const recoveryItems = useMemo(() => buildRecoveryItems(revisions, outputs), [revisions, outputs]);

  /**
   * C1 — the selected Revision, but ONLY when it is a PREPARING composed draft.
   *
   * This is what the Generate Output menu carries as `?targetRevisionId=`. It is
   * an OFFER, not authority: a FINALIZED, foreign, generated-output, or
   * register-only Revision produces no target and the menu behaves exactly as it
   * did before C1. The server re-verifies on every generation call.
   */
  const composableSelection = useMemo(
    () =>
      selectedRevision && isComposableTargetRevision(selectedRevision) ? selectedRevision : null,
    [selectedRevision],
  );

  /**
   * PACKAGES-E2E-01 — the full set of PREPARING composed Revisions that may
   * currently receive a generated Output. The Generate Output menu derives its
   * target from this set (defaulting to the single one, or requiring explicit
   * UUID selection when several exist) and never infers by sequence.
   */
  const composableTargets = useMemo(() => composableTargetRevisions(revisions), [revisions]);

  const revisionFilterOptions = useMemo(
    () => deriveRevisionFilterOptions(revisionRows),
    [revisionRows],
  );
  const deliverableFilterOptions = useMemo(
    () => deriveDeliverableFilterOptions(scopedDeliverableRows),
    [scopedDeliverableRows],
  );
  const visibleRevisionRows = useMemo(
    () =>
      filterRevisionRows(revisionRows, revisionFilters).filter(
        (row) =>
          (!finalView || !finalPhase || row.revision.projectSnapshot?.designStage === finalPhase) &&
          (!attentionOnly ||
            row.revision.lifecycleState === 'FAILED_RECOVERABLE' ||
            outputs.some(
              (output) =>
                output.revisionId === row.revision.revisionId &&
                output.artifactPresence === 'Missing',
            )),
      ),
    [revisionRows, revisionFilters, finalView, finalPhase, attentionOnly, outputs],
  );
  // Deliverable filtering operates on the STRICTLY scoped rows only, so a
  // foreign Revision's rows can never appear here.
  const visibleDeliverableRows = useMemo(
    () => filterDeliverableRows(scopedDeliverableRows, deliverableFilters),
    [scopedDeliverableRows, deliverableFilters],
  );

  useEffect(() => {
    if (!requestedRevisionId || !revisionsQuery.data || revisionsQuery.isError) return;
    const requestKey = `${projectId}:${requestedRevisionId}:${requestedTab}:${requestedDetails}`;
    if (appliedDeepLink.current === requestKey) return;
    appliedDeepLink.current = requestKey;
    const target = revisionsQuery.data.find(
      (revision) => revision.revisionId === requestedRevisionId && revision.projectId === projectId,
    );
    if (!target) {
      setOperationError('The requested Revision is unavailable in this Project.');
      return;
    }
    setSelectedRevision(target);
    if (finalView && requestedDetails) setFinalDetailsOpen(true);
    setActiveTab(requestedTab === 'deliverables' ? 'deliverables' : 'revisions');
    const position = visibleRevisionRows.findIndex(
      (row) => row.revision.revisionId === target.revisionId,
    );
    setRevisionPage(Math.max(0, Math.floor(position / revisionPageSize)));
    setInspectorOpen(true);
  }, [
    projectId,
    requestedRevisionId,
    requestedTab,
    requestedDetails,
    finalView,
    revisionsQuery.data,
    revisionsQuery.isError,
    visibleRevisionRows,
    revisionPageSize,
  ]);

  useEffect(() => {
    if (
      !finalView ||
      requestedRevisionId ||
      finalInitialSelection.current ||
      !revisionsQuery.data?.length
    )
      return;
    finalInitialSelection.current = true;
    setSelectedRevision(
      revisionsQuery.data.reduce((latest, item) =>
        item.revisionSequence > latest.revisionSequence ? item : latest,
      ),
    );
  }, [finalView, requestedRevisionId, revisionsQuery.data]);

  // Selection/filter interaction: a selection that is filtered out is cleared
  // predictably (the inspector returns to its "select an item" empty state).
  useEffect(() => {
    if (
      selectedRevision &&
      !visibleRevisionRows.some((row) => row.revision.revisionId === selectedRevision.revisionId)
    ) {
      setSelectedRevision(null);
    }
  }, [visibleRevisionRows, selectedRevision]);

  useEffect(() => {
    if (
      selectedDeliverable &&
      !visibleDeliverableRows.some(
        (row) => row.deliverable.deliverableId === selectedDeliverable.deliverableId,
      )
    ) {
      setSelectedDeliverable(null);
    }
  }, [visibleDeliverableRows, selectedDeliverable]);

  useEffect(() => {
    if (selectedRecovery && !recoveryItems.some((item) => item.id === selectedRecovery.id)) {
      setSelectedRecovery(null);
    }
  }, [recoveryItems, selectedRecovery]);

  const revisionPageCount = Math.max(1, Math.ceil(visibleRevisionRows.length / revisionPageSize));
  const clampedRevisionPage = Math.min(revisionPage, revisionPageCount - 1);
  const pagedRevisionRows = paginateRows(
    visibleRevisionRows,
    clampedRevisionPage,
    revisionPageSize,
  );
  const deliverablePageCount = Math.max(
    1,
    Math.ceil(visibleDeliverableRows.length / deliverablePageSize),
  );
  const clampedDeliverablePage = Math.min(deliverablePage, deliverablePageCount - 1);
  const pagedDeliverableRows = paginateRows(
    visibleDeliverableRows,
    clampedDeliverablePage,
    deliverablePageSize,
  );

  const refreshReads = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'revisions', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'outputs', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'deliverables', projectId] }),
    ]);
  };

  const issueDate = () => businessTodayKey();

  // REAL canonical recovery. Each mutation invokes the EXISTING Luminaire
  // Schedule or Technical BOQ authority via its recoveryRevisionId contract —
  // never a navigation-only "retry". One mutation per user action, reconciled
  // from the server response.
  const scheduleRecoveryMutation = useMutation({
    mutationFn: (recoveryRevisionId: string) =>
      api.generateLuminaireSchedule(projectId as string, {
        recoveryRevisionId,
        issueStatus: 'Preliminary',
        issueDate: issueDate(),
      } satisfies GenerateTechnicalScheduleInput),
    onSuccess: refreshReads,
    onError: (err) => {
      // RECOVERY-SCOPED error: surfaces on the Recovery tab only, never as a
      // global page banner across Revisions/Deliverables.
      setRecoveryError(
        err instanceof Error && err.message ? err.message : 'Schedule recovery failed.',
      );
    },
  });
  const boqRecoveryMutation = useMutation({
    mutationFn: (recoveryRevisionId: string) =>
      api.generateTechnicalBoq(projectId as string, {
        recoveryRevisionId,
        issueStatus: 'Preliminary',
        issueDate: issueDate(),
      } satisfies GenerateTechnicalBoqInput),
    onSuccess: refreshReads,
    onError: (err) => {
      setRecoveryError(
        err instanceof Error && err.message ? err.message : 'Technical BOQ recovery failed.',
      );
    },
  });

  const recoveryPending = scheduleRecoveryMutation.isPending || boqRecoveryMutation.isPending;

  const runRecovery = (recoveryRevisionId: string, outputFamily: string | null) => {
    if (!projectId || recoveryPending) return;
    if (recoveryInFlightRef.current) return;
    recoveryInFlightRef.current = true;
    setRecoveryError(null);
    // fire-and-forget is intentional: onSuccess owns reconciliation and onError
    // owns the Recovery-scoped UI error. mutate() (not mutateAsync) avoids an
    // unhandled rejection escaping after onError has already handled it.
    if (outputFamily === 'TechnicalBoq') {
      boqRecoveryMutation.mutate(recoveryRevisionId);
    } else {
      scheduleRecoveryMutation.mutate(recoveryRevisionId);
    }
    // Clear the synchronous in-flight guard once the mutation settles.
    // (The guard is synchronous to prevent a double-fire on rapid clicks.)
    queueMicrotask(() => {
      recoveryInFlightRef.current = false;
    });
  };

  const handleOpenDeliverable = (deliverable: RevisionDeliverable) => {
    if (deliverable.presence !== 'Present' || deliverable.projectId !== projectId || !projectId)
      return;
    if (deliverable.sourceType === 'DocumentSnapshot') {
      if (!window.scliDesktop?.executeDesktopHandoff) {
        setOperationError('The desktop app is required to open this snapshot.');
        return;
      }
      void api
        .revisionSnapshotFileHandoff(projectId, deliverable.revisionId, deliverable.deliverableId)
        .then((handoff) =>
          window.scliDesktop!.executeDesktopHandoff!(handoff.handoffId, handoff.action),
        )
        .catch((error) =>
          setOperationError(
            error instanceof Error ? error.message : 'The snapshot could not be opened.',
          ),
        );
      return;
    }
    const output = outputs.find((item) => item.outputId === deliverable.deliverableId);
    if (output?.artifactPresence === 'Present' && output.artifactOpenPath)
      void window.scliDesktop
        ?.openPath?.(output.artifactOpenPath)
        .then((message) => {
          if (message) setOperationError(message);
        })
        .catch((error) => setOperationError(String(error)));
  };
  const canOpenDeliverable = (deliverable: RevisionDeliverable) => {
    if (deliverable.presence !== 'Present') return false;
    if (deliverable.sourceType === 'DocumentSnapshot') return true;
    return outputs.some(
      (output) =>
        output.outputId === deliverable.deliverableId &&
        output.artifactPresence === 'Present' &&
        Boolean(output.artifactOpenPath),
    );
  };
  const handleOpenOwningWorkspace = (item: RecoveryItem) => {
    const pid = projectId as string;
    // Only the two real canonical families resolve to a specific owning
    // workspace. When the family is NOT determinable we still open the project
    // technical workspace, but the control is labelled "Open Project Workspace"
    // so the UI never claims to know an owner it cannot resolve.
    if (item.outputFamily === 'TechnicalBoq') {
      navigate(generatePath(ROUTE_PROJECT_TECHNICAL_BOQ, { projectId: pid }));
    } else {
      navigate(generatePath(ROUTE_PROJECT_LUMINAIRE_SCHEDULE, { projectId: pid }));
    }
  };

  const handleRetryRecovery = (item: RecoveryItem) => {
    if (item.recoveryRevisionId) {
      runRecovery(item.recoveryRevisionId, item.outputFamily);
    }
  };

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [projectId]);

  const handleToggleMode = () => {
    setMode((current) => {
      const next: SidebarMode = current === 'extended' ? 'minimal' : 'extended';
      writeStoredSidebarMode(window.localStorage, next);
      return next;
    });
  };

  const loading =
    projectQuery.isLoading ||
    workspaceQuery.isLoading ||
    revisionsQuery.isLoading ||
    outputsQuery.isLoading;
  const error =
    projectQuery.isError ||
    workspaceQuery.isError ||
    revisionsQuery.isError ||
    outputsQuery.isError;
  const retrying =
    projectQuery.isFetching ||
    workspaceQuery.isFetching ||
    revisionsQuery.isFetching ||
    outputsQuery.isFetching;

  const handleSelectRevision = (revision: CanonicalRevisionRecord) => {
    // selectedRevision is the shared Revision context used by BOTH the
    // Revisions tab (inspector) and the Deliverables tab (per-Revision read).
    setSelectedRevision(revision);
    setSelectedDeliverable(null);
    setSelectedRecovery(null);
    setPendingRevisionDetailsFocusRequest(null);
    setInspectorOpen(true);
  };

  const handleViewRevisionDetails = (revision: CanonicalRevisionRecord) => {
    handleSelectRevision(revision);
    nextRevisionDetailsFocusRequestIdRef.current += 1;
    setPendingRevisionDetailsFocusRequest({
      id: nextRevisionDetailsFocusRequestIdRef.current,
      revisionId: revision.revisionId,
    });
  };

  const handleRevisionDetailsFocusRequestHandled = useCallback((handledRequestId: number) => {
    setPendingRevisionDetailsFocusRequest((current) =>
      acknowledgeRevisionDetailsFocusRequest(current, handledRequestId),
    );
  }, []);

  const handleSelectDeliverable = (deliverable: RevisionDeliverable) => {
    // Keep the selectedRevision context (the Deliverables read is scoped to it);
    // selecting a row only changes which Deliverable the inspector shows.
    setSelectedDeliverable(deliverable);
    setSelectedRecovery(null);
    setPendingRevisionDetailsFocusRequest(null);
    setInspectorOpen(true);
  };

  const handleSelectRecovery = (item: RecoveryItem) => {
    setSelectedRecovery(item);
    setSelectedRevision(null);
    setSelectedDeliverable(null);
    setPendingRevisionDetailsFocusRequest(null);
    setInspectorOpen(true);
  };

  const handleCloseInspector = () => {
    setPendingRevisionDetailsFocusRequest(null);
    setInspectorOpen(false);
  };

  const handleTabChange = (tab: RevisionsTab) => {
    setActiveTab(tab);
    setPendingRevisionDetailsFocusRequest(null);
    if (tab === 'recovery') {
      // Recovery is its own workspace; drop the Revision context.
      setSelectedRevision(null);
    }
    setSelectedDeliverable(null);
    setSelectedRecovery(null);
    setInspectorOpen(true);
  };

  const handleRetryRevision = (revision: CanonicalRevisionRecord) => {
    const row = revisionRows.find((r) => r.revision.revisionId === revision.revisionId);
    runRecovery(revision.revisionId, row?.recoverableFamily ?? null);
  };

  // ---- B1 manual Revision & Deliverable workflow (B0 authority) ----

  // Create a PREPARING manual Revision through the B0 prepare authority. No
  // client-created identity: the server returns the canonical Revision.
  const createRevisionMutation = useMutation({
    mutationFn: (metadata: { purpose: string; internalNote: string }) =>
      api.prepareRevision(projectId as string, metadata),
    onSuccess: async (created) => {
      setOperationError(null);
      setCreateDialogOpen(false);
      setCreatePurpose('');
      setCreateInternalNote('');
      setAddDrawerOpen(false);
      // Refresh the revisions list and select the newly created Revision.
      await queryClient.invalidateQueries({
        queryKey: ['v4', 'revisions', 'revisions', projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['v4', 'revisions', 'reuse-eligibility', projectId],
      });
      setSelectedRevision(created);
      setSelectedDeliverable(null);
      setSelectedRecovery(null);
      // Switch to the Deliverables tab so the next action (Add Deliverable) is
      // immediately surfaced.
      setActiveTab('deliverables');
      setInspectorOpen(true);
      setAddDrawerOpen(false);
    },
    onError: (err) => {
      setOperationError(
        err instanceof Error && err.message ? err.message : 'Creating the Revision failed.',
      );
    },
  });

  const updateMetadataMutation = useMutation({
    mutationFn: ({
      revisionId,
      metadata,
    }: {
      revisionId: string;
      metadata: { purpose?: string | null; internalNote?: string | null };
    }) => api.updateRevisionMetadata(projectId as string, revisionId, metadata),
    onSuccess: async (updated) => {
      setOperationError(null);
      await queryClient.invalidateQueries({
        queryKey: ['v4', 'revisions', 'revisions', projectId],
      });
      setSelectedRevision(updated);
      setInspectorOpen(true);
    },
    onError: (err) => {
      setOperationError(
        err instanceof Error && err.message ? err.message : 'Updating Revision metadata failed.',
      );
    },
  });

  // Add an immutable DocumentSnapshot deliverable to the selected PREPARING
  // Revision. Body sends sourceDocumentId + optional title only; the Revision is
  // taken from the route/selection (never from the body).
  const addDeliverableMutation = useMutation({
    mutationFn: ({
      revisionId,
      sourceDocumentId,
      title,
    }: {
      revisionId: string;
      sourceDocumentId: string;
      title?: string;
    }) => {
      const body: { sourceDocumentId: string; title?: string } = { sourceDocumentId };
      if (title) body.title = title;
      return api.addRevisionDeliverable(projectId as string, revisionId, body);
    },
    onSuccess: async (snapshot) => {
      setOperationError(null);
      await queryClient.invalidateQueries({
        queryKey: ['v4', 'revisions', 'deliverables', projectId],
      });
      // Keep the Revision context. The refreshed Deliverables read now contains
      // the new snapshot; the row is selectable from the table.
      if (selectedRevision?.revisionId === snapshot.revisionId) {
        setSelectedDeliverable(null);
        setSelectedRecovery(null);
        setInspectorOpen(true);
      }
    },
    onError: (err) => {
      setOperationError(
        err instanceof Error && err.message ? err.message : 'Adding the Deliverable failed.',
      );
    },
  });

  // PACKAGES-E2E-05A — admit one Datasheet AssetVersion into the selected
  // PREPARING Revision. Body sends assetVersionId only; the Revision is taken
  // from the route/selection (never from the body) and the server re-resolves
  // everything (never trusts the prior eligibility read).
  const addDatasheetMutation = useMutation({
    mutationFn: ({ revisionId, assetVersionId }: { revisionId: string; assetVersionId: string }) =>
      api.addDatasheetDeliverable(projectId as string, revisionId, { assetVersionId }),
    onSuccess: async () => {
      setOperationError(null);
      // Invalidate BOTH the Deliverables read (so the Datasheet snapshot
      // appears immediately in the same Revision Deliverables list) and the
      // eligibility read (so the added item flips to Already Added).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'deliverables', projectId] }),
        queryClient.invalidateQueries({
          queryKey: ['v4', 'revisions', 'datasheet-eligibility', projectId],
        }),
      ]);
      setSelectedDeliverable(null);
      setInspectorOpen(true);
    },
    onError: (err) => {
      setOperationError(
        err instanceof Error && err.message ? err.message : 'Adding the Datasheet failed.',
      );
    },
  });

  // Remove a DocumentSnapshot deliverable (PREPARING only, via B0 remove).
  const removeDeliverableMutation = useMutation({
    mutationFn: ({ revisionId, deliverableId }: { revisionId: string; deliverableId: string }) =>
      api.removeRevisionDeliverable(projectId as string, revisionId, deliverableId),
    onSuccess: async () => {
      setOperationError(null);
      setRemoveTarget(null);
      if (selectedDeliverable) setSelectedDeliverable(null);
      await queryClient.invalidateQueries({
        queryKey: ['v4', 'revisions', 'deliverables', projectId],
      });
    },
    onError: (err) => {
      setOperationError(
        err instanceof Error && err.message ? err.message : 'Removing the Deliverable failed.',
      );
      setRemoveTarget(null);
    },
  });

  // Finalize a PREPARING Revision (requires >= 1 Deliverable). Server is the
  // final authority; zero-Deliverable finalize is refused.
  const finalizeRevisionMutation = useMutation({
    mutationFn: (revisionId: string) => api.finalizeRevision(projectId as string, revisionId),
    onSuccess: async (finalized) => {
      setOperationError(null);
      await queryClient.invalidateQueries({
        queryKey: ['v4', 'revisions', 'revisions', projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['v4', 'revisions', 'deliverables', projectId],
      });
      // Update the selected revision to the finalized record so the inspector
      // immediately reflects immutability.
      setFinalizeTarget(null);
      setSelectedRevision(finalized);
      setSelectedDeliverable(null);
      setInspectorOpen(true);
    },
    onError: (err) => {
      setOperationError(
        err instanceof Error && err.message ? err.message : 'Finalizing the Revision failed.',
      );
    },
  });

  /**
   * B1 — resume a FAILED_RECOVERABLE composed draft back to PREPARING.
   *
   * This is the smallest truthful affordance for a composed Revision whose
   * generation failed: it recovers the REVISION so composition can continue. It
   * is NOT "Recover Output" and NOT "Retry Generation" — no Output is re-rendered
   * here, and the existing per-Output recovery path is untouched.
   */
  const resumeRevisionMutation = useMutation({
    mutationFn: (revisionId: string) => api.resumeRevision(projectId as string, revisionId),
    onSuccess: async (resumed) => {
      setOperationError(null);
      await refreshReads();
      setSelectedRevision(resumed);
      setSelectedDeliverable(null);
      setInspectorOpen(true);
    },
    onError: (err) => {
      setOperationError(
        err instanceof Error && err.message ? err.message : 'Resuming the Revision failed.',
      );
    },
  });

  // P2C-03 — Safe Revision Delete mutation. Server re-runs the complete
  // eligibility check, archives owned artifacts, then commits the DB deletion.
  const deleteRevisionMutation = useMutation({
    mutationFn: (revisionId: string) => api.deleteRevision(projectId as string, revisionId),
    onSuccess: async (result) => {
      setOperationError(null);
      // Invalidate the Revision list, outputs, deliverables, eligibility, and
      // the selected Revision context. A successful delete clears selection so
      // the inspector returns to its empty state without a manual refresh.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'revisions', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'outputs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'deliverables', projectId] }),
        queryClient.invalidateQueries({
          queryKey: ['v4', 'revisions', 'delete-eligibility', projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['v4', 'revisions', 'reuse-eligibility', projectId],
        }),
      ]);
      if (result.outcome === 'DELETED') {
        setSelectedRevision(null);
        setSelectedDeliverable(null);
        setSelectedRecovery(null);
      } else {
        // RETRYABLE — the Revision remains visible; surface an actionable message.
        setOperationError('The Revision delete did not complete. Retry Delete to converge safely.');
        await queryClient.invalidateQueries({
          queryKey: ['v4', 'revisions', 'delete-eligibility', projectId],
        });
      }
    },
    onError: (err) => {
      setOperationError(
        err instanceof Error && err.message ? err.message : 'Deleting the Revision failed.',
      );
    },
  });

  const reuseRevisionMutation = useMutation({
    mutationFn: ({ deleteOperationId, reason }: { deleteOperationId: string; reason: string }) =>
      api.reuseRevisionNumber(projectId as string, { deleteOperationId, reason }),
    onSuccess: async (created) => {
      setOperationError(null);
      setReuseTarget(null);
      setReuseReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'revisions', projectId] }),
        queryClient.invalidateQueries({
          queryKey: ['v4', 'revisions', 'reuse-eligibility', projectId],
        }),
      ]);
      setSelectedRevision(created);
      setSelectedDeliverable(null);
      setSelectedRecovery(null);
      setActiveTab('deliverables');
      setInspectorOpen(true);
    },
    onError: async (err) => {
      setOperationError(
        err instanceof Error && err.message ? err.message : 'Reusing the Revision number failed.',
      );
      setReuseTarget(null);
      setReuseReason('');
      await queryClient.invalidateQueries({
        queryKey: ['v4', 'revisions', 'reuse-eligibility', projectId],
      });
    },
  });

  const mutationPending =
    createRevisionMutation.isPending ||
    addDeliverableMutation.isPending ||
    addDatasheetMutation.isPending ||
    removeDeliverableMutation.isPending ||
    finalizeRevisionMutation.isPending ||
    resumeRevisionMutation.isPending ||
    deleteRevisionMutation.isPending ||
    reuseRevisionMutation.isPending ||
    updateMetadataMutation.isPending;

  const handleCreateRevision = () => {
    if (!projectId || mutationPending) return;
    setOperationError(null);
    setCreatePurpose('');
    setCreateInternalNote('');
    setCreateDialogOpen(true);
  };

  const handleConfirmCreate = () => {
    if (!projectId || mutationPending) return;
    setOperationError(null);
    createRevisionMutation.mutate({ purpose: createPurpose, internalNote: createInternalNote });
  };

  const handleOpenReuse = () => {
    if (!reuseCandidate || mutationPending) return;
    setOperationError(null);
    setReuseReason('');
    setReuseTarget(reuseCandidate);
  };

  const handleConfirmReuse = () => {
    if (!reuseTarget || mutationPending || !reuseReason.trim()) return;
    setOperationError(null);
    reuseRevisionMutation.mutate({
      deleteOperationId: reuseTarget.deleteOperationId,
      reason: reuseReason,
    });
  };

  const handleAddDeliverable = async (sourceDocumentId: string, title?: string) => {
    if (!projectId || !selectedRevision || mutationPending) return;
    setOperationError(null);
    const args: { revisionId: string; sourceDocumentId: string; title?: string } = {
      revisionId: selectedRevision.revisionId,
      sourceDocumentId,
    };
    if (title) args.title = title;
    return addDeliverableMutation.mutateAsync(args);
  };

  const handleAddDatasheet = async (assetVersionId: string) => {
    if (!projectId || !selectedRevision || mutationPending) return;
    setOperationError(null);
    return addDatasheetMutation.mutateAsync({
      revisionId: selectedRevision.revisionId,
      assetVersionId,
    });
  };

  const handleFinalizeRevision = (revision: CanonicalRevisionRecord) => {
    if (!projectId || mutationPending) return;
    setOperationError(null);
    setFinalizeTarget(revision);
  };

  const handleResumeRevision = (revision: CanonicalRevisionRecord) => {
    if (!projectId || mutationPending) return;
    setOperationError(null);
    resumeRevisionMutation.mutate(revision.revisionId);
  };

  // P2C-03 — Delete Revision. The server re-runs the full eligibility check and
  // archives owned artifacts before committing; double-submission is blocked by
  // mutationPending.
  const handleDeleteRevision = (revision: CanonicalRevisionRecord) => {
    if (!projectId || mutationPending) return;
    setOperationError(null);
    deleteRevisionMutation.mutate(revision.revisionId);
  };

  const handleRemoveDeliverable = (deliverable: RevisionDeliverable) => {
    if (!projectId || mutationPending) return;
    if (deliverable.sourceType !== 'DocumentSnapshot') return; // never remove GeneratedOutput
    // Open the confirmation dialog first.
    setRemoveTarget(deliverable);
  };

  // Perform the actual removal once the user confirms.
  const confirmRemoveDeliverable = (deliverable: RevisionDeliverable) => {
    if (!projectId || !selectedRevision || mutationPending) return;
    setOperationError(null);
    removeDeliverableMutation.mutate({
      revisionId: selectedRevision.revisionId,
      deliverableId: deliverable.deliverableId,
    });
  };

  // Registered Project Documents available as Add-Deliverable sources (from the
  // current workspace read authority). No arbitrary path input.
  const availableDocuments = workspace?.documents ?? [];
  const projectDocuments = availableDocuments;

  const inspector = useMemo(() => {
    if (activeTab === 'recovery') {
      return (
        <RecoveryInspector
          item={selectedRecovery}
          retryPending={recoveryPending}
          onRetry={handleRetryRecovery}
          onOpenOwningWorkspace={handleOpenOwningWorkspace}
          onClose={handleCloseInspector}
        />
      );
    }
    if (activeTab === 'deliverables') {
      if (!selectedDeliverable) {
        return (
          <InspectorEmpty
            icon={FileQuestion}
            title="Select a deliverable"
            body="Select a deliverable to view its details."
            testId="v4-deliverables-inspector-empty"
          />
        );
      }
      return (
        <DeliverableInspector
          deliverable={selectedDeliverable}
          revisions={revisions}
          onClose={handleCloseInspector}
          onOpen={handleOpenDeliverable}
        />
      );
    }
    if (!selectedRevision) {
      return (
        <InspectorEmpty
          icon={FileQuestion}
          title="Select a revision"
          body="Select a revision to view revision details."
          testId="v4-revisions-inspector-empty"
        />
      );
    }
    const revOutputs = outputs.filter((o) => o.revisionId === selectedRevision.revisionId);
    const revDeliverables = deliverables.filter(
      (d) => d.revisionId === selectedRevision.revisionId,
    );
    return (
      <RevisionInspector
        embedded={finalView}
        onOpenDeliverable={handleOpenDeliverable}
        projectId={projectId as string}
        documents={workspaceQuery.data?.documents ?? []}
        revision={selectedRevision}
        deliverables={revDeliverables}
        outputs={revOutputs}
        compatibility={selectedCompatibility}
        detailsFocusRequest={pendingRevisionDetailsFocusRequest}
        onDetailsFocusRequestHandled={handleRevisionDetailsFocusRequestHandled}
        onClose={finalView ? () => setFinalDetailsOpen(false) : handleCloseInspector}
        onFinalize={handleFinalizeRevision}
        onAddDeliverable={() => setAddDrawerOpen(true)}
        onRemoveDeliverable={handleRemoveDeliverable}
        onResume={handleResumeRevision}
        onDelete={handleDeleteRevision}
        onUpdateMetadata={async (metadata) => {
          if (!projectId || mutationPending) return;
          setOperationError(null);
          await updateMetadataMutation.mutateAsync({
            revisionId: selectedRevision.revisionId,
            metadata,
          });
        }}
        finalizePending={finalizeRevisionMutation.isPending}
        resumePending={resumeRevisionMutation.isPending}
        deletePending={deleteRevisionMutation.isPending}
        mutationPending={mutationPending}
        metadataPending={updateMetadataMutation.isPending}
        deleteEligibility={deleteEligibility}
      />
    );
  }, [
    activeTab,
    selectedRevision,
    selectedDeliverable,
    selectedRecovery,
    recoveryPending,
    revisions,
    outputs,
    deliverables,
    selectedCompatibility,
    pendingRevisionDetailsFocusRequest,
    handleRevisionDetailsFocusRequestHandled,
    mutationPending,
    finalizeRevisionMutation.isPending,
    resumeRevisionMutation.isPending,
    deleteRevisionMutation.isPending,
    deleteEligibility,
    projectId,
    workspaceQuery.data?.documents,
  ]);

  const finalOtherTab = (
    <V4SplitPane
      initialRatio={75}
      timeline={
        <div className="v4-revisions__main-card">
          {activeTab === 'deliverables' ? (
            <div className="v4-revision-selected-context">
              <strong>Selected Revision: {selectedRevision?.revisionLabel ?? 'None'}</strong>
              <span>{selectedRevision?.lifecycleState ?? ''}</span>
            </div>
          ) : null}
          {activeTab === 'deliverables' && (
            <DeliverablesTable
              rows={pagedDeliverableRows}
              totalCount={visibleDeliverableRows.length}
              page={clampedDeliverablePage}
              pageSize={deliverablePageSize}
              onPageChange={setDeliverablePage}
              onPageSizeChange={(size) => {
                setDeliverablePageSize(size);
                setDeliverablePage(0);
              }}
              filters={deliverableFilters}
              onFiltersChange={(next) => {
                setDeliverableFilters(next);
                setDeliverablePage(0);
              }}
              filterOptions={deliverableFilterOptions}
              filtersActive={isDeliverableFilterActive(deliverableFilters)}
              hasData={scopedDeliverableRows.length > 0}
              emptyState={
                selectedRevisionId
                  ? scopedDeliverableRows.length > 0
                    ? null
                    : selectedRevision?.lifecycleState === 'PREPARING'
                      ? 'preparing-zero'
                      : 'historical-zero'
                  : 'no-revision'
              }
              onSelect={handleSelectDeliverable}
              onOpen={handleOpenDeliverable}
              canOpenDeliverable={canOpenDeliverable}
              onAddDeliverable={() => setAddDrawerOpen(true)}
              canAddDeliverable={selectedRevision?.lifecycleState === 'PREPARING'}
              selectedId={selectedDeliverable?.deliverableId ?? null}
            />
          )}
          {activeTab === 'recovery' && (
            <>
              {recoveryError ? (
                <div className="v4-revisions__notice" role="alert" data-testid="v4-recovery-error">
                  <AlertTriangle size={15} />
                  <span>{recoveryError}</span>
                  <button
                    type="button"
                    aria-label="Dismiss recovery error"
                    onClick={() => setRecoveryError(null)}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              <RecoveryTable
                items={recoveryItems}
                onSelect={handleSelectRecovery}
                selectedId={selectedRecovery?.id ?? null}
                onRetry={handleRetryRecovery}
                onOpenOwningWorkspace={handleOpenOwningWorkspace}
                retryPending={recoveryPending}
              />
            </>
          )}
        </div>
      }
      inspector={inspector}
      collapsed={!inspectorOpen}
    />
  );
  const finalOpenOutput = (output: (typeof outputs)[number]) => {
    if (
      output.projectId !== projectId ||
      output.artifactPresence !== 'Present' ||
      !output.artifactOpenPath
    )
      return;
    if (!window.scliDesktop?.openPath) {
      setOperationError('The desktop app is required to open this artifact.');
      return;
    }
    void window.scliDesktop
      .openPath(output.artifactOpenPath)
      .then((message) => {
        if (message) setOperationError(message);
      })
      .catch((error) =>
        setOperationError(
          error instanceof Error ? error.message : 'The output could not be opened.',
        ),
      );
  };
  const exportFinalReport = () => {
    const quote = (value: unknown) => {
      const text = String(value ?? '');
      return '"' + (/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replace(/"/g, '""') + '"';
    };
    const records = [
      [
        'Revision',
        'Operation / Source',
        'Lifecycle',
        'Created By',
        'Created At',
        'Luminaire Snapshot',
        'Outputs',
        'Compatibility Status',
      ],
      ...revisionRows.map((row) => [
        row.revision.revisionLabel,
        row.revision.provenanceClassification,
        row.revision.lifecycleState,
        row.revision.createdByName,
        row.revision.createdAt,
        row.revision.luminaireSnapshot?.length ?? 0,
        row.outputsCount,
        row.compatibilityStatus,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(['\ufeff' + records.map((row) => row.map(quote).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project?.projectCode ?? 'Project'}-revision-report.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <V4AppShell
      context="project"
      sidebarMode={mode}
      onToggleSidebarMode={handleToggleMode}
      activeSectionId="revisions"
      onSelectSection={(id) => {
        const route = routes[id];
        if (route && projectId) {
          navigate(generatePath(route, { projectId }));
        }
      }}
      project={
        project
          ? {
              projectCode: project.projectCode,
              projectName: project.projectName,
              status: project.status ?? null,
            }
          : null
      }
      projectLoading={loading}
      projectContextHeader={
        <V4ProjectContextHeader
          data={{
            projectCode: project?.projectCode ?? '',
            projectName: project?.projectName ?? '',
            clientName: project?.clientName ?? null,
            projectType: project?.projectType ?? null,
            designStage: project?.designStage ?? null,
            requiredDeliveryDate: project?.requiredDeliveryDate ?? null,
          }}
          actions={
            <V4ProjectEditAction
              project={project}
              projectQueryKey={['v4', 'revisions', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        finalView ? undefined : (
          <div
            className="v4-revisions-page-header"
            style={finalView ? { display: 'none' } : undefined}
          >
            <V4PageHeader
              title="Revisions & Deliverables"
              description="Track revisions, deliverables, and generated artifacts across all project phases."
              icon={History}
              actions={
                projectId ? (
                  <GenerateOutputMenu
                    projectId={projectId}
                    composableTargets={composableTargets}
                    selectedRevisionId={composableSelection?.revisionId ?? null}
                  />
                ) : undefined
              }
            />
          </div>
        )
      }
      boundedPage
    >
      <div
        className={finalView ? 'final-ui-reference' : 'v4-revisions v4-bounded-page'}
        style={
          finalView
            ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }
            : undefined
        }
        data-testid="v4-project-revisions"
      >
        {loading && !revisions.length ? <RevisionsSkeleton /> : null}

        {!loading && error ? (
          <V4RouteErrorState
            title="Unable to load revisions"
            message="Revision and output authority could not be loaded."
            retrying={retrying}
            onRetry={() =>
              void Promise.all([
                projectQuery.refetch(),
                workspaceQuery.refetch(),
                revisionsQuery.refetch(),
                outputsQuery.refetch(),
              ])
            }
          />
        ) : null}

        {operationError && !error ? (
          <div className="v4-revisions__notice" role="alert" data-testid="v4-revisions-notice">
            <AlertTriangle size={15} />
            <span>{operationError}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setOperationError(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        {!loading && !error && finalView ? (
          <FinalRevisionsView
            binding={{
              phase: finalPhase,
              setPhase: (phase) => {
                setFinalPhase(phase);
                setRevisionPage(0);
              },
              rows: pagedRevisionRows,
              allRows: revisionRows,
              workspace,
              outputs,
              deliverables,
              openDeliverable: handleOpenDeliverable,
              attentionOnly,
              setAttentionOnly: (value) => {
                setAttentionOnly(value);
                setRevisionPage(0);
              },
              selected: inspectorOpen ? selectedRevision : null,
              select: handleSelectRevision,
              close: () => setInspectorOpen(false),
              details: (item) => {
                handleSelectRevision(item);
                setFinalDetailsOpen(true);
              },
              kpis,
              completed: revisions.filter((item) => item.lifecycleState === 'FINALIZED').length,
              tab: activeTab,
              setTab: handleTabChange,
              filters: revisionFilters,
              setFilters: (next) => {
                setRevisionFilters(next);
                setRevisionPage(0);
              },
              options: revisionFilterOptions,
              page: clampedRevisionPage,
              pages: Math.max(1, Math.ceil(visibleRevisionRows.length / revisionPageSize)),
              total: visibleRevisionRows.length,
              pageSize: revisionPageSize,
              setPage: setRevisionPage,
              setPageSize: (size) => {
                setRevisionPageSize(size);
                setRevisionPage(0);
              },
              create: handleCreateRevision,
              createPending: createRevisionMutation.isPending,
              exportReport: exportFinalReport,
              menu: projectId ? (
                <GenerateOutputMenu
                  triggerStyle={{
                    height: '100%',
                    minWidth: 0,
                    background: 'var(--v4-accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0 8px 8px 0',
                    borderLeft: '1px solid rgba(255,255,255,0.25)',
                    padding: '0 10px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  triggerContent={<FinalGlyphs.SctExpand width="12" height="12" />}
                  projectId={projectId}
                  composableTargets={composableTargets}
                  selectedRevisionId={composableSelection?.revisionId ?? null}
                />
              ) : null,
              otherTab: finalOtherTab,
              openOutput: finalOpenOutput,
              notice: null,
            }}
          />
        ) : !loading && !error && !finalView ? (
          <>
            <div className="v4-revisions__kpis" data-testid="v4-revisions-kpis">
              <KpiCard
                label="Total Revisions"
                value={String(kpis.totalRevisions)}
                caption={kpis.captions.totalRevisions}
                icon={ScrollText}
                tone="info"
              />
              <KpiCard
                label="Latest Revision"
                value={kpis.latestRevisionLabel ?? '—'}
                caption={kpis.captions.latestRevision}
                icon={History}
                tone="brandTeal"
              />
              <KpiCard
                label="Generated Outputs"
                value={String(kpis.generatedOutputs)}
                caption={kpis.captions.generatedOutputs}
                icon={Package}
                tone="brandPurple"
              />
              <KpiCard
                label="Needs Attention"
                value={String(kpis.needsAttention)}
                caption={kpis.captions.needsAttention}
                icon={AlertTriangle}
                tone={kpis.needsAttention > 0 ? 'danger' : 'success'}
              />
            </div>

            <div
              className="v4-revisions__tabs"
              role="tablist"
              aria-label="Revisions and deliverables"
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  data-testid={`v4-revisions-tab-${tab.id}`}
                  onClick={() => handleTabChange(tab.id)}
                >
                  {tab.label}
                  {tab.id === 'recovery' && recoveryItems.length > 0 ? (
                    <span className="v4-revisions__tab-badge">{recoveryItems.length}</span>
                  ) : null}
                </button>
              ))}
            </div>

            <V4SplitPane
              timeline={
                <div className="v4-revisions__main-card" data-testid="v4-revisions-main">
                  {activeTab === 'revisions' && (
                    <RevisionsTable
                      rows={pagedRevisionRows}
                      totalCount={visibleRevisionRows.length}
                      page={clampedRevisionPage}
                      pageSize={revisionPageSize}
                      onPageChange={setRevisionPage}
                      onPageSizeChange={(size) => {
                        setRevisionPageSize(size);
                        setRevisionPage(0);
                      }}
                      filters={revisionFilters}
                      onFiltersChange={(next) => {
                        setRevisionFilters(next);
                        setRevisionPage(0);
                      }}
                      filterOptions={revisionFilterOptions}
                      filtersActive={isRevisionFilterActive(revisionFilters)}
                      hasData={revisionRows.length > 0}
                      onSelect={handleSelectRevision}
                      onViewDetails={handleViewRevisionDetails}
                      onRetry={handleRetryRevision}
                      selectedId={selectedRevision?.revisionId ?? null}
                      retryPending={recoveryPending}
                      onCreateRevision={handleCreateRevision}
                      createPending={createRevisionMutation.isPending}
                      reuseCandidate={reuseCandidate}
                      onReuseRevision={handleOpenReuse}
                      reusePending={reuseRevisionMutation.isPending}
                    />
                  )}
                  {activeTab === 'deliverables' && (
                    <DeliverablesTable
                      rows={pagedDeliverableRows}
                      totalCount={visibleDeliverableRows.length}
                      page={clampedDeliverablePage}
                      pageSize={deliverablePageSize}
                      onPageChange={setDeliverablePage}
                      onPageSizeChange={(size) => {
                        setDeliverablePageSize(size);
                        setDeliverablePage(0);
                      }}
                      filters={deliverableFilters}
                      onFiltersChange={(next) => {
                        setDeliverableFilters(next);
                        setDeliverablePage(0);
                      }}
                      filterOptions={deliverableFilterOptions}
                      filtersActive={isDeliverableFilterActive(deliverableFilters)}
                      hasData={scopedDeliverableRows.length > 0}
                      emptyState={
                        selectedRevisionId
                          ? scopedDeliverableRows.length > 0
                            ? null
                            : selectedRevision?.lifecycleState === 'PREPARING'
                              ? 'preparing-zero'
                              : 'historical-zero'
                          : 'no-revision'
                      }
                      onSelect={handleSelectDeliverable}
                      onOpen={handleOpenDeliverable}
                      canOpenDeliverable={canOpenDeliverable}
                      onAddDeliverable={() => setAddDrawerOpen(true)}
                      canAddDeliverable={selectedRevision?.lifecycleState === 'PREPARING'}
                      selectedId={selectedDeliverable?.deliverableId ?? null}
                    />
                  )}
                  {activeTab === 'recovery' && (
                    <>
                      {recoveryError ? (
                        <div
                          className="v4-revisions__notice"
                          role="alert"
                          data-testid="v4-recovery-error"
                        >
                          <AlertTriangle size={15} />
                          <span>{recoveryError}</span>
                          <button
                            type="button"
                            aria-label="Dismiss recovery error"
                            onClick={() => setRecoveryError(null)}
                          >
                            ×
                          </button>
                        </div>
                      ) : null}
                      <RecoveryTable
                        items={recoveryItems}
                        onSelect={handleSelectRecovery}
                        selectedId={selectedRecovery?.id ?? null}
                        onRetry={handleRetryRecovery}
                        onOpenOwningWorkspace={handleOpenOwningWorkspace}
                        retryPending={recoveryPending}
                      />
                    </>
                  )}
                </div>
              }
              inspector={inspector}
              collapsed={!inspectorOpen}
            />
          </>
        ) : null}
      </div>

      <V4Drawer
        open={finalView && finalDetailsOpen}
        title="Revision Details"
        onClose={() => setFinalDetailsOpen(false)}
      >
        {inspector}
      </V4Drawer>
      {addDrawerOpen ? (
        <AddDeliverableDrawer
          key={selectedRevision?.revisionId}
          revisionLabel={selectedRevision?.revisionLabel ?? ''}
          existing={deliverables.filter((item) => item.revisionId === selectedRevision?.revisionId)}
          open={addDrawerOpen}
          documents={projectDocuments}
          datasheets={datasheetEligibility}
          onClose={() => setAddDrawerOpen(false)}
          onAddDocument={handleAddDeliverable}
          onAddDatasheet={handleAddDatasheet}
          pending={addDeliverableMutation.isPending || addDatasheetMutation.isPending}
          error={operationError}
        />
      ) : null}

      <V4ConfirmDialog
        open={Boolean(finalizeTarget)}
        title="Finalize Revision"
        description={
          'Finalize ' +
          (finalizeTarget?.revisionLabel ?? '') +
          '? Its contents will be frozen. Files cannot be added or removed afterward.'
        }
        cancelLabel="Cancel"
        confirmLabel="Finalize"
        pending={finalizeRevisionMutation.isPending}
        onCancel={() => setFinalizeTarget(null)}
        onConfirm={() => {
          if (finalizeTarget) finalizeRevisionMutation.mutate(finalizeTarget.revisionId);
        }}
      />
      {createDialogOpen ? (
        <div className="v4-deliverables__confirm-layer" data-testid="v4-create-revision-dialog">
          <div
            className="v4-deliverables__confirm v4-revisions__metadata-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="v4-create-revision-heading"
          >
            <h2 id="v4-create-revision-heading">Create Revision</h2>
            <p>Add context now or leave both fields empty and continue working.</p>
            <label>
              <span>
                Revision Purpose <small>Optional</small>
              </span>
              <input
                ref={createPurposeRef}
                value={createPurpose}
                maxLength={500}
                placeholder="Client comments — entrance and courtyard lighting"
                onChange={(event) => setCreatePurpose(event.target.value)}
              />
            </label>
            <label>
              <span>
                Internal Note <small>Optional</small>
              </span>
              <textarea
                value={createInternalNote}
                maxLength={8000}
                rows={4}
                placeholder="Working note visible only in this Revision workspace"
                onChange={(event) => setCreateInternalNote(event.target.value)}
              />
            </label>
            <div className="v4-deliverables__confirm-actions">
              <button
                type="button"
                className="v4-deliverables__secondary"
                onClick={() => setCreateDialogOpen(false)}
                disabled={createRevisionMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v4-deliverables__primary"
                onClick={handleConfirmCreate}
                disabled={createRevisionMutation.isPending}
                data-testid="v4-confirm-create-revision"
              >
                {createRevisionMutation.isPending ? 'Creating…' : 'Create Revision'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {removeTarget ? (
        <div className="v4-deliverables__confirm-layer" data-testid="v4-remove-confirm">
          <div className="v4-deliverables__confirm" role="dialog" aria-modal="true">
            <h2>Remove Deliverable</h2>
            <p>
              Removing this Document Snapshot from the Revision does not delete the original
              registered project document.
            </p>
            <div className="v4-deliverables__confirm-actions">
              <button
                type="button"
                className="v4-deliverables__secondary"
                onClick={() => setRemoveTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v4-deliverables__danger"
                onClick={() => confirmRemoveDeliverable(removeTarget)}
                data-testid="v4-confirm-remove"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reuseTarget ? (
        <div className="v4-deliverables__confirm-layer" data-testid="v4-reuse-confirm">
          <div
            className="v4-deliverables__confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="v4-reuse-heading"
          >
            <h2 id="v4-reuse-heading">
              Reuse deleted Revision number {reuseTarget.revisionLabel}?
            </h2>
            <p>
              This creates a new Revision using {reuseTarget.revisionLabel}. The deleted Revision
              history remains preserved.
            </p>
            <p className="v4-deliverables__confirm-detail">
              A new internal Revision identity will be created.
            </p>
            <label className="v4-deliverables__reuse-field">
              <span>Reason</span>
              <textarea
                ref={reuseReasonRef}
                value={reuseReason}
                maxLength={500}
                placeholder="Accidental duplicate Revision created"
                onChange={(event) => setReuseReason(event.target.value)}
                required
              />
            </label>
            <div className="v4-deliverables__confirm-actions">
              <button
                type="button"
                className="v4-deliverables__secondary"
                onClick={() => {
                  setReuseTarget(null);
                  setReuseReason('');
                }}
                disabled={reuseRevisionMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v4-deliverables__primary"
                onClick={handleConfirmReuse}
                disabled={!reuseReason.trim() || reuseRevisionMutation.isPending}
                data-testid="v4-confirm-reuse"
              >
                {reuseRevisionMutation.isPending
                  ? 'Reusing…'
                  : `Reuse ${reuseTarget.revisionLabel}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </V4AppShell>
  );
}

function KpiCard({
  label,
  value,
  caption,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  icon: typeof AlertTriangle;
  tone: string;
}) {
  return (
    <div
      className={`v4-revisions__kpi v4-revisions__kpi--${tone}`}
      data-testid={`v4-kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <div className="v4-revisions__kpi-header">
        <span className="v4-revisions__kpi-label">{label}</span>
        <span className="v4-revisions__kpi-icon" aria-hidden="true">
          <Icon strokeWidth={1.75} />
        </span>
      </div>
      <div className="v4-revisions__kpi-value">{value}</div>
      <div className="v4-revisions__kpi-caption">{caption}</div>
    </div>
  );
}

function InspectorEmpty({
  icon: Icon,
  title,
  body,
  testId,
}: {
  icon: typeof FileQuestion;
  title: string;
  body: string;
  testId: string;
}) {
  return (
    <div className="v4-revisions__inspector v4-revisions__inspector--empty" data-testid={testId}>
      <div className="v4-revisions__empty-state">
        <span className="v4-revisions__empty-state-icon" aria-hidden="true">
          <Icon size={26} strokeWidth={1.5} />
        </span>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

function RevisionsSkeleton() {
  return (
    <div className="v4-revisions__skeleton" data-testid="v4-revisions-skeleton">
      <div className="v4-revisions__kpis">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="v4-revisions__kpi v4-revisions__kpi--skeleton" />
        ))}
      </div>
      <div className="v4-revisions__tabs" />
      <div className="v4-revisions__skeleton-table" />
    </div>
  );
}
