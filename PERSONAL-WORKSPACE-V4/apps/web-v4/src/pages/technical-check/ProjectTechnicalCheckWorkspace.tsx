import { v4Decisions } from '../../components/interaction/V4Decisions';
import { useWindowPageSize } from '../../components/common/useWindowPageSize';
import { FinalProjectHeader } from '../../components/final-ui/ProjectHeader';
import FinalTechnicalCheckView from '../../components/final-ui/FinalTechnicalCheckView';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generatePath, useNavigate, useParams } from 'react-router-dom';
import {
  SctWarning as AlertCircle,
  SctWarning as AlertTriangle,
  SctSuccess as CheckCircle2,
  SctInfo as CircleHelp,
  SctFilter as Filter,
  SctImage as ImageOff,
} from '../../components/common/SctIcons';
import {
  Check,
  ChevronDown,
  ExternalLink,
  FileSearch,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from '../../components/common/SctIcons';
import type {
  LocalIntelligenceFieldKey,
  LuminaireDatasheetBatchOutcome,
  LuminaireDatasheetAnalysis,
} from '@scli/domain';
import { api } from '../../api/environment';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Pagination } from '../../components/common/V4Pagination';
import { V4RouteErrorState } from '../../components/common/V4RouteErrorState';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import {
  ROUTE_LUMINAIRE_LIBRARY,
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
  buildTechnicalCheckRows,
  filterTechnicalCheckRows,
  groupTechnicalCheckRows,
  technicalCheckCounts,
  technicalFieldOptions,
  type TechnicalCheckGroup,
  type TechnicalCheckRow,
  type TechnicalCheckStatus,
  type TechnicalResultFilter,
} from './technicalCheckViewModel';
import { TechnicalVerificationWorkspace } from './TechnicalVerificationWorkspace';

const resultOptions: Array<{ value: TechnicalResultFilter; label: string }> = [
  { value: 'needs-attention', label: 'Needs Attention' },
  { value: 'mismatch', label: 'Mismatch' },
  { value: 'missing-incomplete', label: 'Missing / Incomplete' },
  { value: 'analyzed', label: 'Datasheets Analyzed' },
  { value: 'missing-schedule', label: 'Missing Schedule' },
  { value: 'missing-datasheet', label: 'Missing Datasheet' },
  { value: 'needs-review', label: 'Needs Review' },
  { value: 'matched', label: 'Matched' },
  { value: 'all', label: 'All' },
];

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

const statusTone: Record<TechnicalCheckStatus, string> = {
  Matched: 'success',
  Mismatch: 'danger',
  MissingSchedule: 'danger',
  MissingDatasheet: 'danger',
  NeedsReview: 'review',
  MissingImage: 'warning',
  MissingRequired: 'warning',
  NeedsAdoption: 'warning',
  ProcessingFailed: 'danger',
  Unavailable: 'warning',
  Unsupported: 'neutral',
};

function StatusIcon({ status }: { status: TechnicalCheckStatus }) {
  if (status === 'Matched') return <CheckCircle2 aria-label="Matched" />;
  if (status === 'NeedsReview') return <CircleHelp aria-label="Needs Review" />;
  if (status === 'MissingDatasheet') return <FileText aria-label="Missing Datasheet" />;
  if (status === 'MissingImage') return <ImageOff aria-label="Missing Image" />;
  if (status === 'Unsupported') return <AlertCircle aria-label="Unsupported" />;
  return <AlertTriangle aria-label={status} />;
}

function Inspector({
  group,
  onClose,
  onOpenReview,
  onViewLuminaires,
}: {
  group: TechnicalCheckGroup;
  onClose: () => void;
  onOpenReview: (origin: HTMLElement) => void;
  onViewLuminaires: () => void;
}) {
  return (
    <aside
      className="v4-technical-check__inspector"
      aria-label={`${group.luminaire.tag} grouped check inspector`}
    >
      <header className="v4-technical-check__inspector-header">
        <div>
          <h2>{group.luminaire.tag}</h2>
          <p>{group.luminaire.category || 'Uncategorized'}</p>
        </div>
        <button type="button" aria-label="Close selected check inspector" onClick={onClose}>
          <X />
        </button>
      </header>
      <div className="v4-technical-check__inspector-scroll">
        <section aria-labelledby="technical-summary-heading">
          <h3 id="technical-summary-heading">Luminaire Summary</h3>
          <dl className="v4-technical-check__details">
            {[
              ['Category', group.luminaire.category],
              ['Manufacturer', group.luminaire.manufacturer],
              ['Ordering Code', group.luminaire.orderingCode],
              ['Product Family / Model', group.luminaire.productType || group.luminaire.model],
              ['Overall Result', group.overallLabel],
              ['Findings', String(group.findingCount)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="technical-summary-actions-heading">
          <h3 id="technical-summary-actions-heading">Review Actions</h3>
          <div className="v4-technical-check__actions-grid">
            <button
              type="button"
              className="v4-technical-check__primary"
              onClick={(event) => onOpenReview(event.currentTarget)}
            >
              Open Review
            </button>
            <button type="button" onClick={onViewLuminaires}>
              View in Luminaires <ExternalLink />
            </button>
          </div>
        </section>
      </div>
      <footer>Full Datasheet verification decisions open in Technical Verification.</footer>
    </aside>
  );
}

interface TechnicalBrowseState {
  query: string;
  resultFilter: TechnicalResultFilter;
  fieldFilter: string;
  analysisFilter: string;
  hideMatched: boolean;
  page: number;
  requestedPageSize: number;
  finalSelectedId: string | null;
  sortDirection: 1 | -1;
}
export function ProjectTechnicalCheckWorkspace({ finalView = false }: { finalView?: boolean }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [returnState] = useState(() =>
    queryClient.getQueryData<TechnicalBrowseState>(['ux', 'technical-browse', projectId]),
  );
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [legacyAnalyses, setAnalyses] = useState<LuminaireDatasheetAnalysis[] | null>(null);
  const [legacyOutcomes, setOutcomes] = useState<LuminaireDatasheetBatchOutcome[] | null>(null);
  const [query, setQuery] = useState(returnState?.query ?? '');
  const [resultFilter, setResultFilter] = useState<TechnicalResultFilter>(
    returnState?.resultFilter ?? 'needs-attention',
  );
  const [fieldFilter, setFieldFilter] = useState(returnState?.fieldFilter ?? '');
  const [analysisFilter, setAnalysisFilter] = useState(returnState?.analysisFilter ?? 'all');
  const [hideMatched, setHideMatched] = useState(returnState?.hideMatched ?? false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewRowId, setReviewRowId] = useState<string | null>(null);
  const [page, setPage] = useState(returnState?.page ?? 0);
  const [requestedPageSize, setPageSize] = useState(
    returnState?.requestedPageSize ?? (finalView ? 0 : 8),
  );
  const pageSize = useWindowPageSize(requestedPageSize, finalView, 340, 52);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const reviewReturnRef = useRef<HTMLElement | null>(null);

  const projectQuery = useQuery({
    queryKey: ['v4', 'technical-check', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'technical-check', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: Boolean(projectId),
  });
  const assetsQuery = useQuery({
    queryKey: ['v4', 'technical-check', 'assets', projectId],
    queryFn: () => api.luminaireAssets(projectId as string),
    enabled: Boolean(projectId),
  });
  const overviewQuery = useQuery({
    queryKey: ['v4', 'technical-check', 'overview', projectId],
    queryFn: () => api.localIntelligence(projectId as string),
    enabled: Boolean(projectId),
  });
  const storageHealthQuery = useQuery({
    queryKey: ['v4', 'project', projectId, 'storage-health'],
    queryFn: () => api.projectStorageHealth(projectId as string),
    enabled: Boolean(projectId),
  });
  const adoptionStatusQuery = useQuery({
    queryKey: ['v4', 'technical-check', 'legacy-adoption', projectId],
    queryFn: () => api.legacyDatasheetAdoptionStatus(projectId as string),
    enabled: Boolean(projectId),
  });

  const savedResultsQuery = useQuery({
    queryKey: ['v4', 'technical-check', 'saved-results', projectId],
    queryFn: () => api.projectDatasheetResults(projectId!),
    enabled: finalView && Boolean(projectId),
  });
  const outcomes = finalView ? (savedResultsQuery.data?.items ?? null) : legacyOutcomes;
  const analyses = finalView
    ? (outcomes?.flatMap((item) => (item.analysis ? [item.analysis] : [])) ?? null)
    : legacyAnalyses;
  const [finalSelectedId, setFinalSelectedId] = useState<string | null>(
    returnState?.finalSelectedId ?? null,
  );
  const [sortDirection, setSortDirection] = useState<1 | -1>(returnState?.sortDirection ?? 1);
  useEffect(() => {
    queryClient.setQueryData<TechnicalBrowseState>(['ux', 'technical-browse', projectId], {
      query,
      resultFilter,
      fieldFilter,
      analysisFilter,
      hideMatched,
      page,
      requestedPageSize,
      finalSelectedId,
      sortDirection,
    });
  }, [
    queryClient,
    projectId,
    query,
    resultFilter,
    fieldFilter,
    analysisFilter,
    hideMatched,
    page,
    requestedPageSize,
    finalSelectedId,
    sortDirection,
  ]);
  const finalSelectionApplied = useRef(false);
  const luminaires = workspaceQuery.data?.luminaires ?? [];
  const assets = assetsQuery.data ?? [];
  const rows = useMemo(
    () =>
      buildTechnicalCheckRows({
        luminaires,
        assets,
        scheduleColumns: workspaceQuery.data?.lightingPackage.scheduleColumns ?? [],
        ...(overviewQuery.data ? { overview: overviewQuery.data } : {}),
        analyses,
        ...(outcomes ? { outcomes } : {}),
      }),
    [
      analyses,
      assets,
      luminaires,
      outcomes,
      overviewQuery.data,
      workspaceQuery.data?.lightingPackage,
    ],
  );
  const filtered = useMemo(() => {
    const base = filterTechnicalCheckRows(rows, query, resultFilter, fieldFilter, hideMatched);
    return analysisFilter === 'all'
      ? base
      : base.filter((row) => (row.analysisStatus ?? 'NotRun') === analysisFilter);
  }, [analysisFilter, fieldFilter, hideMatched, query, resultFilter, rows]);
  const groups = useMemo(() => groupTechnicalCheckRows(filtered), [filtered]);
  const allGroups = useMemo(() => groupTechnicalCheckRows(rows), [rows]);
  const reviewQueue = useMemo(
    () => allGroups.filter((group) => group.findingCount > 0),
    [allGroups],
  );
  const counts = technicalCheckCounts(rows, outcomes, luminaires.length);
  const linkedDatasheets = luminaires.filter((luminaire) => luminaire.datasheetPath.trim()).length;
  const legacyAssets = assets
    .map((asset) => asset.datasheet)
    .filter((asset) => asset?.locatorKind === 'LEGACY_PATH');
  const storageVerified = storageHealthQuery.data?.state === 'CONNECTED';
  const adoptionReadyCount =
    adoptionStatusQuery.data?.items?.filter((item) => item.status === 'READY_TO_ADOPT').length ?? 0;
  const finalRows = groups
    .map((visibleGroup) => {
      const group = allGroups.find((item) => item.id === visibleGroup.id)!;
      return {
        ...visibleGroup.checks[0]!,
        groupSummary: {
          checks: group.checks.length,
          conflicts: group.checks.filter((row) => row.status === 'Mismatch').length,
          missing: group.checks.filter((row) => row.status.startsWith('Missing')).length,
          review: group.checks.filter(
            (row) =>
              !['Matched', 'Mismatch'].includes(row.status) && !row.status.startsWith('Missing'),
          ).length,
          label: group.overallLabel,
        },
      };
    })
    .sort(
      (a, b) =>
        a.luminaire.tag.localeCompare(b.luminaire.tag, 'en', { numeric: true }) * sortDirection,
    );
  const pageCount = Math.max(
    1,
    Math.ceil((finalView ? finalRows.length : groups.length) / pageSize),
  );
  const finalSelected = rows.find((row) => row.id === finalSelectedId) ?? null;
  const selectionDataReady =
    Boolean(workspaceQuery.data) &&
    !assetsQuery.isLoading &&
    !overviewQuery.isLoading &&
    (!finalView || !savedResultsQuery.isLoading);
  useEffect(() => {
    // Wait for saved findings before restoring selection: loading rows have temporary IDs.
    if (selectionDataReady && !finalSelectionApplied.current && finalRows[0]) {
      setFinalSelectedId(
        finalRows.find((row) => row.id === returnState?.finalSelectedId)?.id ?? finalRows[0].id,
      );
      finalSelectionApplied.current = true;
    }
  }, [finalRows, returnState?.finalSelectedId, selectionDataReady]);
  const pageGroups = groups.slice(page * pageSize, page * pageSize + pageSize);
  const selected = groups.find((group) => group.id === selectedId) ?? null;
  const reviewed = allGroups.find((group) => group.id === reviewId) ?? null;
  const reviewQueuePosition = reviewed
    ? reviewQueue.findIndex((group) => group.id === reviewed.id)
    : -1;
  const assetsByLuminaire = useMemo(
    () => new Map(assets.map((asset) => [asset.luminaireId, asset])),
    [assets],
  );

  useEffect(() => {
    if (selectedId && groups.some((group) => group.id === selectedId)) return;
    setSelectedId(groups[0]?.id ?? null);
  }, [groups, selectedId]);
  useEffect(() => {
    if (!reviewId || allGroups.some((group) => group.id === reviewId)) return;
    setReviewId(null);
  }, [allGroups, reviewId]);
  const filterFingerprint = JSON.stringify([
    analysisFilter,
    fieldFilter,
    hideMatched,
    requestedPageSize,
    query,
    resultFilter,
  ]);
  const previousFilters = useRef(filterFingerprint);
  useEffect(() => {
    if (previousFilters.current !== filterFingerprint) setPage(0);
    previousFilters.current = filterFingerprint;
  }, [filterFingerprint]);
  useEffect(() => {
    if (workspaceQuery.data && !savedResultsQuery.isLoading && page >= pageCount)
      setPage(pageCount - 1);
  }, [page, pageCount, workspaceQuery.data, savedResultsQuery.isLoading]);

  const replaceAnalysis = (next: LuminaireDatasheetAnalysis) => {
    if (finalView) {
      void savedResultsQuery.refetch();
      return;
    }
    setAnalyses((current) => [
      ...(current ?? []).filter((analysis) => analysis.luminaireId !== next.luminaireId),
      next,
    ]);
    setOutcomes((current) => [
      ...(current ?? []).filter((outcome) => outcome.luminaireId !== next.luminaireId),
      {
        luminaireId: next.luminaireId,
        tag:
          luminaires.find((luminaire) => luminaire.id === next.luminaireId)?.tag ?? next.fileName,
        status: next.status === 'Ready' ? 'VERIFIED' : 'UNVERIFIED',
        reasonCode: 'NONE',
        message: next.message,
        analysis: next,
      },
    ]);
  };
  const analyzeAllMutation = useMutation({
    onMutate: () =>
      finalView
        ? queryClient.cancelQueries({
            queryKey: ['v4', 'technical-check', 'saved-results', projectId],
          })
        : undefined,
    mutationFn: () => api.analyzeProjectDatasheets(projectId as string),
    onSuccess: async (next) => {
      if (finalView)
        queryClient.setQueryData(['v4', 'technical-check', 'saved-results', projectId], next);
      setOutcomes(next.items);
      setAnalyses(next.items.flatMap((item) => (item.analysis ? [item.analysis] : [])));
      setOperationError(null);
      setOperationNotice(null);
      await queryClient.invalidateQueries({
        queryKey: ['v4', 'technical-check', 'overview', projectId],
      });
    },
    onError: (error) =>
      setOperationError(error instanceof Error ? error.message : 'Technical Check could not run.'),
  });
  const adoptLegacyMutation = useMutation({
    mutationFn: () =>
      api.adoptLegacyDatasheets(projectId as string, {
        items: legacyAssets.map((asset) => ({
          luminaireId: asset!.luminaireId,
          assetVersionId: asset!.id,
        })),
      }),
    onSuccess: async (result) => {
      const adopted = result.items.filter((item) => item.status === 'ADOPTED').length;
      const failed = result.items.filter((item) => item.status === 'FAILED').length;
      setOperationNotice(
        failed
          ? `${adopted} legacy Datasheet(s) adopted; ${failed} item(s) need attention.`
          : `${adopted} legacy Datasheet(s) adopted into managed Project storage.`,
      );
      setOperationError(null);
      setAnalyses(null);
      setOutcomes(null);
      if (finalView) void savedResultsQuery.refetch();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v4', 'technical-check', 'assets', projectId] }),
        queryClient.invalidateQueries({
          queryKey: ['v4', 'technical-check', 'workspace', projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['v4', 'technical-check', 'legacy-adoption', projectId],
        }),
      ]);
    },
    onError: (error) =>
      setOperationError(
        error instanceof Error ? error.message : 'Legacy Datasheet adoption could not run.',
      ),
  });
  const analyzeOneMutation = useMutation({
    mutationFn: (luminaireId: string) =>
      api.analyzeLuminaireDatasheet(projectId as string, luminaireId),
    onSuccess: replaceAnalysis,
    onError: (error) =>
      setOperationError(
        error instanceof Error ? error.message : 'The datasheet could not be analyzed.',
      ),
  });
  const useValueMutation = useMutation({
    mutationFn: async (row: TechnicalCheckRow) => {
      if (!row.verificationFingerprint) throw new Error('Refresh Datasheet verification first.');
      return api.resolveLuminaireDatasheetField(projectId as string, row.luminaire.id, {
        fieldKey: row.fieldKey as LocalIntelligenceFieldKey,
        expectedRowVersion: row.luminaire.rowVersion,
        verificationFingerprint: row.verificationFingerprint,
      });
    },
    onSuccess: async (next) => {
      replaceAnalysis(next);
      setOperationError(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['v4', 'technical-check', 'workspace', projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['v4', 'technical-check', 'overview', projectId],
        }),
      ]);
    },
    onError: (error) =>
      setOperationError(
        error instanceof Error ? error.message : 'The luminaire could not be updated.',
      ),
  });

  const applySelectedValue = async (row: TechnicalCheckRow) => {
    if (!row.canUseDatasheetValue) return;
    const confirmed = await v4Decisions.confirm(
      `Use “${row.datasheetValue}” as the ${row.fieldLabel} value for ${row.luminaire.tag}?`,
    );
    if (confirmed) useValueMutation.mutate(row);
  };
  const loading =
    projectQuery.isLoading ||
    workspaceQuery.isLoading ||
    assetsQuery.isLoading ||
    (finalView && savedResultsQuery.isLoading);
  const failed =
    projectQuery.isError ||
    workspaceQuery.isError ||
    assetsQuery.isError ||
    (finalView && savedResultsQuery.isError);
  const retrying = projectQuery.isFetching || workspaceQuery.isFetching || assetsQuery.isFetching;
  const pending =
    analyzeAllMutation.isPending ||
    analyzeOneMutation.isPending ||
    useValueMutation.isPending ||
    adoptLegacyMutation.isPending;
  const start = groups.length ? page * pageSize + 1 : 0;
  const end = Math.min((page + 1) * pageSize, groups.length);

  const legacyAdoptionNotice =
    legacyAssets.length > 0 ? (
      <div className="v4-technical-check__notice" role="status">
        <FileText />
        <div>
          <strong>Legacy Datasheet needs adoption</strong>
          <p>
            {storageVerified
              ? `${legacyAssets.length} linked Datasheet(s) must be adopted into managed Project storage before analysis.`
              : 'Connect / verify the Project folder before adopting legacy Datasheets. Use the existing Project storage action in Edit Project.'}
          </p>
        </div>
        <button
          type="button"
          disabled={!storageVerified || adoptionReadyCount === 0 || pending}
          onClick={async () => {
            const confirmed = await v4Decisions.confirm(
              `Adopt ${adoptionReadyCount} exact legacy Datasheet(s) into managed Project storage? A verified backup will be created first.`,
            );
            if (confirmed) adoptLegacyMutation.mutate();
          }}
        >
          {adoptLegacyMutation.isPending ? 'Adopting…' : 'Adopt Legacy Datasheets'}
        </button>
      </div>
    ) : null;

  return (
    <V4AppShell
      finalContacts={finalView}
      context="project"
      boundedPage
      sidebarMode={mode}
      onToggleSidebarMode={() =>
        setMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      activeSectionId="technical-check"
      onSelectSection={(id) => {
        if (projectId && routes[id]) navigate(generatePath(routes[id], { projectId }));
      }}
      project={
        projectQuery.data
          ? {
              projectCode: projectQuery.data.projectCode,
              projectName: projectQuery.data.projectName,
              status: projectQuery.data.status ?? null,
            }
          : null
      }
      projectLoading={loading}
      projectContextHeader={
        <V4ProjectContextHeader
          data={{
            projectCode: projectQuery.data?.projectCode ?? '',
            projectName: projectQuery.data?.projectName ?? '',
            clientName: projectQuery.data?.clientName ?? null,
            projectType: projectQuery.data?.projectType ?? null,
            designStage: projectQuery.data?.designStage ?? null,
            requiredDeliveryDate: projectQuery.data?.requiredDeliveryDate ?? null,
          }}
          actions={
            <V4ProjectEditAction
              project={projectQuery.data}
              projectQueryKey={['v4', 'technical-check', 'project', projectId]}
            />
          }
        />
      }
    >
      <main
        className={finalView ? 'final-ui-reference' : 'v4-technical-check v4-bounded-page'}
        style={finalView ? { flexDirection: 'column', minHeight: 0 } : undefined}
        data-testid="v4-technical-check"
      >
        {finalView ? <FinalProjectHeader /> : null}
        <div
          style={finalView ? { display: 'none' } : undefined}
          className="v4-technical-check__title-band"
        >
          <V4PageHeader
            title="Technical Check"
            description="Review incomplete and inconsistent luminaire information before issue."
            icon={ShieldCheck}
            actions={
              !loading && !failed ? (
                <button
                  type="button"
                  className="v4-technical-check__run"
                  disabled={pending || !luminaires.length}
                  onClick={() => analyzeAllMutation.mutate()}
                >
                  <RefreshCw />
                  {analyzeAllMutation.isPending
                    ? 'Running…'
                    : outcomes
                      ? 'Run Again'
                      : 'Run Technical Check'}
                </button>
              ) : null
            }
          />
        </div>
        {loading ? (
          <div className="v4-technical-check__state" aria-busy="true">
            Loading Technical Check…
          </div>
        ) : null}
        {!loading && failed ? (
          <V4RouteErrorState
            title="Unable to load Technical Check"
            message="Project luminaires and asset data could not be loaded."
            retrying={retrying}
            onRetry={() =>
              void Promise.all([
                projectQuery.refetch(),
                workspaceQuery.refetch(),
                assetsQuery.refetch(),
                ...(finalView ? [savedResultsQuery.refetch()] : []),
              ])
            }
          />
        ) : null}
        {!loading && !failed ? (
          finalView ? (
            <FinalTechnicalCheckView
              binding={{
                items: finalRows.slice(page * pageSize, (page + 1) * pageSize),
                selected: finalSelected,
                query,
                setQuery,
                result: resultFilter,
                setResult: (value) => {
                  setResultFilter(value);
                  if (value === 'matched' || value === 'analyzed') setHideMatched(false);
                },
                analysisFilter,
                setAnalysisFilter,
                resultOptions,
                field: fieldFilter,
                setField: setFieldFilter,
                fieldOptions: [
                  { value: '', label: 'All Fields' },
                  { value: 'datasheet', label: 'Datasheet' },
                  { value: 'productImage', label: 'Product Image' },
                  ...technicalFieldOptions,
                ],
                hideMatched,
                setHideMatched,
                counts,
                linked: linkedDatasheets,
                luminaireCount: luminaires.length,
                page,
                pages: pageCount,
                total: finalRows.length,
                pageSize,
                requestedPageSize,
                setPage,
                setPageSize,
                select: setFinalSelectedId,
                review: (row, origin) => {
                  reviewReturnRef.current = origin;
                  setReviewRowId(row.id);
                  setReviewId(row.luminaire.id);
                },
                run: () => analyzeAllMutation.mutate(),
                pending,
                filters: () => setFilterOpen((current) => !current),
                filterMenu: null,
                viewDatasheet: (row) =>
                  navigate(
                    generatePath(ROUTE_PROJECT_DATASHEETS_IMAGES, { projectId: projectId! }) +
                      '?luminaireId=' +
                      encodeURIComponent(row.luminaire.id),
                  ),
                viewLuminaire: (row) =>
                  navigate(
                    generatePath(ROUTE_PROJECT_LUMINAIRES, { projectId: projectId! }) +
                      '?luminaireId=' +
                      encodeURIComponent(row.luminaire.id),
                  ),
                useValue: applySelectedValue,
                sort: () => setSortDirection((current) => (current === 1 ? -1 : 1)),
                notice: (
                  <>
                    {legacyAdoptionNotice}
                    {operationError ? (
                      <p role="alert">{operationError}</p>
                    ) : operationNotice ? (
                      <p role="status">{operationNotice}</p>
                    ) : null}
                  </>
                ),
              }}
            />
          ) : (
            <div className="v4-technical-check__workspace">
              <div className="v4-technical-check__content">
                {operationError ? (
                  <div className="v4-technical-check__notice" role="alert">
                    <AlertCircle /> {operationError}
                  </div>
                ) : null}
                {operationNotice ? (
                  <div className="v4-technical-check__notice" role="status">
                    <CheckCircle2 /> {operationNotice}
                  </div>
                ) : null}
                {legacyAdoptionNotice}
                {overviewQuery.isError ? (
                  <div className="v4-technical-check__notice" role="status">
                    <AlertCircle /> Project checks are temporarily unavailable; asset and comparison
                    data remain visible.
                  </div>
                ) : null}
                {luminaires.length > 0 && linkedDatasheets === 0 ? (
                  <div className="v4-technical-check__notice" role="status">
                    <FileText />
                    No datasheets are linked, so Technical Check can show completeness issues but
                    cannot compare extracted values.
                    <button
                      type="button"
                      onClick={() =>
                        projectId &&
                        navigate(generatePath(ROUTE_PROJECT_DATASHEETS_IMAGES, { projectId }))
                      }
                    >
                      Go to Datasheets &amp; Images
                    </button>
                  </div>
                ) : null}
                <div
                  className={`v4-technical-check__body${selected ? '' : ' v4-technical-check__body--closed'}`}
                >
                  <section
                    className="v4-technical-check__main"
                    aria-label="Technical comparison workspace"
                  >
                    <div className="v4-technical-check__kpis" aria-label="Technical Check summary">
                      <article data-tone="danger">
                        <span>
                          <AlertTriangle />
                        </span>
                        <div>
                          <b>{counts.needsAttention}</b>
                          <strong>Needs Attention</strong>
                          <small>Mismatches, missing &amp; review</small>
                        </div>
                      </article>
                      <article data-tone="warning">
                        <span>
                          <AlertCircle />
                        </span>
                        <div>
                          <b>{counts.missingIncomplete}</b>
                          <strong>Missing / Incomplete</strong>
                          <small>Required info or assets</small>
                        </div>
                      </article>
                      <article data-tone="success">
                        <span>
                          <Check />
                        </span>
                        <div>
                          <b>{counts.matched ?? 'Not run'}</b>
                          <strong>Matched</strong>
                          <small>
                            {counts.matched === null
                              ? 'Run analysis to compare'
                              : 'Values are consistent'}
                          </small>
                        </div>
                      </article>
                      <article data-tone="info">
                        <span>
                          <FileSearch />
                        </span>
                        <div>
                          <b>
                            {counts.analyzed === null
                              ? 'Not run'
                              : `${counts.analyzed} / ${counts.luminaireCount}`}
                          </b>
                          <strong>Datasheets Analyzed</strong>
                          <small>
                            {counts.analyzed === null
                              ? `${linkedDatasheets} linked of ${luminaires.length}`
                              : counts.needsAdoption || counts.failed
                                ? `${counts.needsAdoption} need adoption • ${counts.failed} failed`
                                : 'Local analysis coverage'}
                          </small>
                        </div>
                      </article>
                    </div>
                    <section
                      className="v4-technical-check__table-card"
                      aria-label="Technical checks"
                    >
                      <div className="v4-technical-check__toolbar">
                        <label className="v4-technical-check__search">
                          <Search />
                          <input
                            type="search"
                            aria-label="Search technical checks"
                            placeholder="Search by tag, manufacturer, model or field…"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                          />
                        </label>
                        <label className="v4-technical-check__select">
                          <small>Result</small>
                          <select
                            aria-label="Result filter"
                            value={resultFilter}
                            onChange={(event) =>
                              setResultFilter(event.target.value as TechnicalResultFilter)
                            }
                          >
                            {resultOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown />
                        </label>
                        <label className="v4-technical-check__select">
                          <small>Field</small>
                          <select
                            aria-label="Field filter"
                            value={fieldFilter}
                            onChange={(event) => setFieldFilter(event.target.value)}
                          >
                            <option value="">All Fields</option>
                            {technicalFieldOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown />
                        </label>
                        <label className="v4-technical-check__toggle">
                          <input
                            type="checkbox"
                            checked={hideMatched}
                            onChange={(event) => setHideMatched(event.target.checked)}
                          />
                          <i /> Hide Matched
                        </label>
                        <button
                          type="button"
                          className="v4-technical-check__filters"
                          aria-expanded={filterOpen}
                          onClick={() => setFilterOpen((current) => !current)}
                        >
                          <Filter /> Filters
                        </button>
                      </div>
                      {filterOpen ? (
                        <div className="v4-technical-check__advanced-filters">
                          <label>
                            Analysis status
                            <select
                              aria-label="Analysis status filter"
                              value={analysisFilter}
                              onChange={(event) => setAnalysisFilter(event.target.value)}
                            >
                              <option value="all">All analysis states</option>
                              <option value="NotRun">Not run</option>
                              <option value="Ready">Ready</option>
                              <option value="NeedsReview">Needs Review</option>
                              <option value="Unavailable">Unavailable</option>
                              <option value="Unsupported">Unsupported</option>
                            </select>
                          </label>
                        </div>
                      ) : null}
                      <div className="v4-technical-check__table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Review</th>
                              <th>Tag</th>
                              <th>Category</th>
                              <th>Overall Result</th>
                              <th>Findings</th>
                              <th>Affected Fields</th>
                              <th>Severity</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pageGroups.map((group) => (
                              <tr
                                key={group.id}
                                tabIndex={0}
                                aria-label={`Open ${group.luminaire.tag} Technical Verification`}
                                className={
                                  group.id === selectedId
                                    ? 'v4-technical-check__row--selected'
                                    : undefined
                                }
                                onClick={(event) => {
                                  reviewReturnRef.current = event.currentTarget;
                                  setSelectedId(group.id);
                                  setReviewId(group.id);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter' && event.key !== ' ') return;
                                  event.preventDefault();
                                  reviewReturnRef.current = event.currentTarget;
                                  setSelectedId(group.id);
                                  setReviewId(group.id);
                                }}
                              >
                                <td>
                                  <button
                                    type="button"
                                    aria-label={`Open ${group.luminaire.tag} review`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      reviewReturnRef.current = event.currentTarget;
                                      setSelectedId(group.id);
                                      setReviewId(group.id);
                                    }}
                                  >
                                    Open Review
                                  </button>
                                </td>
                                <td>
                                  <strong>{group.luminaire.tag}</strong>
                                  <small>{group.checks.length} checks</small>
                                </td>
                                <td>{group.luminaire.category || 'Uncategorized'}</td>
                                <td>
                                  <span
                                    className="v4-technical-check__pill"
                                    data-tone={statusTone[group.overallStatus]}
                                  >
                                    <StatusIcon status={group.overallStatus} />
                                    {group.overallLabel}
                                  </span>
                                </td>
                                <td>
                                  <strong>{group.findingCount}</strong>{' '}
                                  {group.findingCount === 1 ? 'finding' : 'findings'}
                                </td>
                                <td>
                                  <div className="v4-technical-check__field-chips">
                                    {group.affectedFields.slice(0, 3).map((field) => (
                                      <span key={field}>{field}</span>
                                    ))}
                                    {group.affectedFields.length > 3 ? (
                                      <small>+{group.affectedFields.length - 3} more</small>
                                    ) : null}
                                  </div>
                                </td>
                                <td>{group.severity ?? (group.findingCount ? 'Review' : '—')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!pageGroups.length ? (
                          <div className="v4-technical-check__empty">
                            {!luminaires.length ? (
                              <>
                                <strong>No luminaires to check.</strong>
                                <p>Add or import project luminaires first.</p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    projectId &&
                                    navigate(generatePath(ROUTE_PROJECT_LUMINAIRES, { projectId }))
                                  }
                                >
                                  Go to Luminaires
                                </button>
                              </>
                            ) : outcomes === null && !rows.length ? (
                              <>
                                <strong>Technical comparison has not run.</strong>
                                <p>
                                  Current project data has no derived asset or required-field gaps.
                                </p>
                                <button type="button" onClick={() => analyzeAllMutation.mutate()}>
                                  Run Technical Check
                                </button>
                              </>
                            ) : outcomes &&
                              rows.length > 0 &&
                              rows.every((row) => row.status === 'Matched') ? (
                              <>
                                <strong>No actionable findings.</strong>
                                <p>All analyzed technical values are consistent.</p>
                              </>
                            ) : (
                              <>
                                <strong>No checks match this view.</strong>
                                <p>Change the search or filters to see other results.</p>
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <footer className="v4-technical-check__pagination">
                        <span>
                          Showing {start} to {end} of {groups.length} luminaires
                        </span>
                        <V4Pagination
                          pageCount={pageCount}
                          currentPage={page}
                          onChange={setPage}
                          ariaLabel="Technical Check pages"
                        />
                        <label>
                          <select
                            aria-label="Luminaires per page"
                            value={pageSize}
                            onChange={(event) => setPageSize(Number(event.target.value))}
                          >
                            <option value={8}>8 / page</option>
                            <option value={16}>16 / page</option>
                            <option value={25}>25 / page</option>
                          </select>
                        </label>
                      </footer>
                    </section>
                  </section>
                  {selected ? (
                    <Inspector
                      group={selected}
                      onClose={() => setSelectedId(null)}
                      onOpenReview={(origin) => {
                        reviewReturnRef.current = origin;
                        setReviewId(selected.id);
                      }}
                      onViewLuminaires={() =>
                        projectId &&
                        navigate(
                          `${generatePath(ROUTE_PROJECT_LUMINAIRES, { projectId })}?luminaireId=${encodeURIComponent(selected.luminaire.id)}`,
                        )
                      }
                    />
                  ) : null}
                </div>
              </div>
            </div>
          )
        ) : null}
      </main>
      <TechnicalVerificationWorkspace
        group={reviewed}
        initialRowId={finalView ? reviewRowId : null}
        asset={reviewed ? assetsByLuminaire.get(reviewed.luminaire.id) : undefined}
        queuePosition={reviewQueuePosition >= 0 ? reviewQueuePosition : null}
        queueLength={reviewQueue.length}
        queue={reviewQueue}
        onSelectGroup={(groupId) => setReviewId(groupId)}
        pending={pending}
        storageVerified={storageVerified}
        returnFocusRef={reviewReturnRef}
        onClose={() => setReviewId(null)}
        onPrevious={() => {
          if (reviewQueuePosition > 0) setReviewId(reviewQueue[reviewQueuePosition - 1]!.id);
        }}
        onNext={() => {
          if (reviewQueuePosition >= 0 && reviewQueuePosition < reviewQueue.length - 1)
            setReviewId(reviewQueue[reviewQueuePosition + 1]!.id);
        }}
        onUseValue={applySelectedValue}
        onOpenLibraryCorrection={() => navigate(ROUTE_LUMINAIRE_LIBRARY)}
        onReplaceDatasheet={() => {
          if (!projectId || !reviewed) return;
          navigate(
            `${generatePath(ROUTE_PROJECT_DATASHEETS_IMAGES, { projectId })}?luminaireId=${encodeURIComponent(reviewed.luminaire.id)}`,
          );
        }}
        onOpenDatasheet={() => {
          if (!projectId || !reviewed) return;
          navigate(
            `${generatePath(ROUTE_PROJECT_DATASHEETS_IMAGES, { projectId })}?luminaireId=${encodeURIComponent(reviewed.luminaire.id)}`,
          );
        }}
        onAdoptLegacy={async () => {
          if (!adoptionReadyCount) return;
          const confirmed = await v4Decisions.confirm(
            `Adopt ${adoptionReadyCount} exact legacy Datasheet(s) into managed Project storage? A verified backup will be created first.`,
          );
          if (confirmed) adoptLegacyMutation.mutate();
        }}
        onRerun={() => reviewed && analyzeOneMutation.mutate(reviewed.luminaire.id)}
      />
    </V4AppShell>
  );
}
