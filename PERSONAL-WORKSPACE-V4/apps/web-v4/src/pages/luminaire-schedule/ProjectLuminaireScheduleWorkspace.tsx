import { useWindowPageSize } from '../../components/common/useWindowPageSize';
import FinalScheduleView from '../../components/final-ui/FinalScheduleView';
import { C as FinalC } from '../../components/final-ui/tokens';
import { Eye, FileDown } from '../../components/common/SctIcons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generatePath, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  GenerateTechnicalScheduleInput,
  UpdateTechnicalScheduleConfigInput,
} from '@scli/contracts';
import type { OutputColumnDefinition, TechnicalScheduleOutputHistoryItem } from '@scli/domain';
import {
  SctWarning as AlertTriangle,
  SctCollapse as ArrowDown,
  SctExpand as ArrowUp,
  SctRemove as Minus,
  SctRestore as RotateCcw,
} from '../../components/common/SctIcons';
import {
  ChevronDown,
  Columns3,
  FolderOpen,
  History,
  Plus,
  RefreshCw,
  Settings2,
  X,
} from '../../components/common/SctIcons';
import { api } from '../../api/environment';
import { businessTodayKey } from '../../date-time/businessDateTime';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Pagination } from '../../components/common/V4Pagination';
import { v4SemanticIcons } from '../../components/common/V4SemanticIcons';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { V4OutputPresentationLauncher } from '../../components/outputs/V4OutputPresentationLauncher';
import { V4TargetRevisionContext } from '../../components/revisions/V4TargetRevisionContext';
import {
  malformedTargetVerdict,
  readTargetRevisionParam,
  TARGET_REVISION_PARAM,
} from '../../components/revisions/targetRevisionUrl';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import { LuminaireImage } from '../project-luminaires/LuminaireImage';
import {
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECT_COMMENTS,
  ROUTE_PROJECT_CONTACTS,
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_LUMINAIRES,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
} from '../../router/routes';
import {
  artifactAbsolutePath,
  effectiveScheduleColumns,
  formatScheduleDateTime,
  isCoreScheduleColumn,
  latestAvailableOutputId,
  orderedScheduleColumns,
  outputAvailabilityLabel,
  outputAvailabilityTone,
  scheduleCellValue,
  scheduleRowKey,
} from './luminaireScheduleViewModel';

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

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const issueDate = () => businessTodayKey();

function OutputHistoryItem({
  item,
  latestId,
  folderPath,
  pending,
  onRetry,
}: {
  item: TechnicalScheduleOutputHistoryItem;
  latestId: string | null;
  folderPath: string | null | undefined;
  pending: boolean;
  onRetry: (item: TechnicalScheduleOutputHistoryItem) => void;
}) {
  const isRecoverable = item.output.lifecycleState === 'FAILED_RECOVERABLE';
  const absolutePath = artifactAbsolutePath(folderPath, item.output.locatorValue);
  const canOpen = item.artifactPresence === 'Present' && Boolean(absolutePath);
  return (
    <article className="v4-schedule__history-item" data-tone={outputAvailabilityTone(item)}>
      <div className="v4-schedule__history-main">
        <div>
          <strong>{item.revisionLabel || 'Revision unavailable'}</strong>
          <span>{item.output.outputFormat}</span>
        </div>
        <span className="v4-schedule__history-rank">
          {item.output.outputId === latestId ? 'Latest' : 'Previous'}
        </span>
      </div>
      <p>
        {item.templateName || 'Template unavailable'}
        {item.output.templateVersionId ? ` · ${item.output.templateVersionId}` : ''}
      </p>
      <div className="v4-schedule__history-meta">
        <span>{formatScheduleDateTime(item.output.finalizedAt ?? item.output.updatedAt)}</span>
        <span>{item.createdByName || 'Actor unavailable'}</span>
      </div>
      <div className="v4-schedule__history-footer">
        <span className="v4-schedule__status-pill" data-tone={outputAvailabilityTone(item)}>
          {outputAvailabilityLabel(item)}
        </span>
        {canOpen ? (
          <button
            type="button"
            disabled={!window.scliDesktop?.openPath}
            title={window.scliDesktop?.openPath ? undefined : 'Desktop app required'}
            onClick={() => void window.scliDesktop?.openPath?.(absolutePath!)}
          >
            <FolderOpen /> Open
          </button>
        ) : null}
        {isRecoverable && item.output.revisionId ? (
          <button type="button" disabled={pending} onClick={() => onRetry(item)}>
            <RefreshCw /> Retry Generation
          </button>
        ) : null}
      </div>
      {item.output.failureReason ? <small>{item.output.failureReason}</small> : null}
    </article>
  );
}

export function ProjectLuminaireScheduleWorkspace({ finalView = false }: { finalView?: boolean }) {
  const [finalTab, setFinalTab] = useState<'technical' | 'presentation'>('technical');
  const duplicateRequest = useRef<{
    sourceId: string;
    requestId: string;
    expectedSnapshotHash: string;
  } | null>(null);
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [revisionId, setRevisionId] = useState<string | undefined>();
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [requestedPageSize, setPageSize] = useState(25);
  const pageSize = useWindowPageSize(requestedPageSize, finalView, 440, 76);

  // The address is the ONLY authority for the composition target.
  const targetParam = readTargetRevisionParam(searchParams);
  const targetRevisionId = targetParam?.wellFormed ? targetParam.raw : undefined;
  const clearTarget = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(TARGET_REVISION_PARAM);
      return next;
    });
  };

  const projectQuery = useQuery({
    queryKey: ['v4', 'luminaire-schedule', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });
  const projectWorkspaceQuery = useQuery({
    queryKey: ['v4', 'luminaire-schedule', 'project-workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: Boolean(projectId),
  });
  const scheduleQuery = useQuery({
    queryKey: [
      'v4',
      'luminaire-schedule',
      'workspace',
      projectId,
      revisionId ?? 'current',
      targetRevisionId ?? 'no-target',
    ],
    queryFn: () =>
      api.luminaireScheduleWorkspace(projectId as string, revisionId, targetRevisionId),
    enabled: Boolean(projectId),
  });

  const refreshSchedule = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['v4', 'luminaire-schedule', 'workspace', projectId],
    });
  };
  /**
   * A targeted generation also changed a Revision that OTHER surfaces read, so
   * those exact namespaces are invalidated too. Only they are: a standalone
   * generation leaves this untouched, and no broad `['v4']` sweep is issued.
   */
  const refreshComposedRevisionReads = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'revisions', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'outputs', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'deliverables', projectId] }),
    ]);
  };
  const configMutation = useMutation({
    mutationFn: (input: UpdateTechnicalScheduleConfigInput) =>
      api.updateLuminaireScheduleConfig(projectId as string, input),
    onSuccess: refreshSchedule,
  });
  const generationMutation = useMutation({
    mutationFn: (input: GenerateTechnicalScheduleInput) =>
      api.generateLuminaireSchedule(projectId as string, input),
    onSuccess: refreshSchedule,
  });

  const workspace = scheduleQuery.data;
  // The rendered verdict must describe the target CURRENTLY in the address, so a
  // verdict for a different Revision is discarded rather than shown.
  const serverVerdict =
    workspace?.requestedTarget && workspace.requestedTarget.revisionId === targetParam?.raw
      ? workspace.requestedTarget
      : null;
  const requestedTarget = targetParam
    ? targetParam.wellFormed
      ? serverVerdict
      : malformedTargetVerdict(targetParam.raw)
    : null;
  const eligibleTarget = requestedTarget?.eligible ? requestedTarget.target : null;
  const invalidTarget = Boolean(requestedTarget && !requestedTarget.eligible);
  // An address target the server has not yet ruled on also blocks generation:
  // an unverified target must never degrade into a standalone generation.
  const targetUnverified = Boolean(targetParam && !requestedTarget);
  const rows = workspace?.selectedRevision?.rows ?? workspace?.currentRows ?? [];
  const columns = useMemo(
    () => effectiveScheduleColumns(workspace?.effectiveTemplate.columns ?? []),
    [workspace?.effectiveTemplate.columns],
  );
  const allColumns = useMemo(
    () => orderedScheduleColumns(workspace?.effectiveTemplate.columns ?? []),
    [workspace?.effectiveTemplate.columns],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);
  const start = rows.length ? page * pageSize + 1 : 0;
  const end = Math.min((page + 1) * pageSize, rows.length);
  const latestId = latestAvailableOutputId(workspace?.outputs ?? []);
  const latestOutput = workspace?.outputs[0];
  const generationBlocked =
    Boolean(revisionId && (!finalView || revisionId !== eligibleTarget?.revisionId)) ||
    invalidTarget ||
    targetUnverified ||
    !workspace?.generationReadiness.ready ||
    generationMutation.isPending;

  useEffect(() => setPage(0), [pageSize, revisionId]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  useEffect(() => {
    const first = pageRows[0];
    if (!first) return setSelectedRowId(null);
    if (!selectedRowId || !rows.some((row) => scheduleRowKey(row) === selectedRowId)) {
      setSelectedRowId(scheduleRowKey(first));
    }
  }, [pageRows, rows, selectedRowId]);

  const mutateConfig = async (input: UpdateTechnicalScheduleConfigInput) => {
    setOperationError(null);
    try {
      await configMutation.mutateAsync(input);
    } catch (error) {
      setOperationError(errorMessage(error, 'Schedule configuration could not be updated.'));
    }
  };
  const updateColumn = (column: OutputColumnDefinition, patch: Partial<OutputColumnDefinition>) =>
    void mutateConfig({
      columns: [
        {
          columnId: column.columnId,
          ...(patch.visible === undefined ? {} : { visible: patch.visible }),
          ...(patch.order === undefined ? {} : { order: patch.order }),
          ...(patch.width === undefined ? {} : { width: patch.width }),
        },
      ],
    });
  const moveColumn = (index: number, direction: -1 | 1) => {
    const current = allColumns[index];
    const sibling = allColumns[index + direction];
    if (!current || !sibling) return;
    void mutateConfig({
      columns: [
        { columnId: current.columnId, order: sibling.order },
        { columnId: sibling.columnId, order: current.order },
      ],
    });
  };
  const resetColumns = () => {
    const source = workspace?.templates.find(
      (template) =>
        template.templateId === workspace.effectiveTemplate.templateId &&
        template.templateVersionId === workspace.effectiveTemplate.versionId,
    )?.resolvedTemplate.columns;
    if (!source) return;
    void mutateConfig({
      columns: source.map((column) => ({
        columnId: column.columnId,
        visible: column.visible,
        order: column.order,
        width: column.width,
      })),
    });
  };
  const retry = async (item: TechnicalScheduleOutputHistoryItem) => {
    if (!item.output.revisionId) return;
    setOperationError(null);
    try {
      await generationMutation.mutateAsync({
        recoveryRevisionId: item.output.revisionId,
        issueStatus: 'Preliminary',
        issueDate: issueDate(),
      });
    } catch (error) {
      setOperationError(errorMessage(error, 'Schedule recovery failed.'));
    }
  };

  const duplicateMutation = useMutation({
    mutationFn: (input: { sourceId: string; requestId: string; expectedSnapshotHash: string }) =>
      api.duplicateRevision(projectId as string, input.sourceId, {
        requestId: input.requestId,
        expectedSnapshotHash: input.expectedSnapshotHash,
      }),
    onSuccess: async (revision) => {
      duplicateRequest.current = null;
      await refreshSchedule();
      await refreshComposedRevisionReads();
      setRevisionId(revision.revisionId);
      setSearchParams((params) => {
        const next = new URLSearchParams(params);
        next.set(TARGET_REVISION_PARAM, revision.revisionId);
        return next;
      });
    },
    onError: (error) => setOperationError(errorMessage(error, 'Revision could not be duplicated.')),
  });
  const selectedRevision = workspace?.selectedRevision?.metadata.revision;
  const finalHistory = (workspace?.outputs ?? []).filter(
    (item) => !revisionId || item.output.revisionId === revisionId,
  );
  const deleteEligibilityQuery = useQuery({
    queryKey: [
      'v4',
      'luminaire-schedule',
      'delete-eligibility',
      projectId,
      selectedRevision?.revisionId,
    ],
    queryFn: () => api.revisionDeleteEligibility(projectId as string, selectedRevision!.revisionId),
    enabled: Boolean(finalView && projectId && selectedRevision),
    retry: false,
  });

  const previousRevision = selectedRevision
    ? workspace?.revisions
        .map((item) => item.revision)
        .filter((item) => item.revisionSequence < selectedRevision.revisionSequence)
        .sort((a, b) => b.revisionSequence - a.revisionSequence)[0]
    : undefined;
  const revisionRoute = (id: string, details = false) =>
    `/projects/${encodeURIComponent(projectId as string)}/revisions?revisionId=${encodeURIComponent(id)}${details ? '&details=1' : ''}`;
  const duplicateSelected = () => {
    if (!selectedRevision?.snapshotHash) return;
    if (
      duplicateRequest.current?.sourceId !== selectedRevision.revisionId ||
      duplicateRequest.current.expectedSnapshotHash !== selectedRevision.snapshotHash
    )
      duplicateRequest.current = {
        sourceId: selectedRevision.revisionId,
        requestId: crypto.randomUUID(),
        expectedSnapshotHash: selectedRevision.snapshotHash,
      };
    duplicateMutation.mutate(duplicateRequest.current);
  };
  const finalPanels = workspace ? (
    <div style={{ position: 'relative' }} className="v4-schedule">
      {' '}
      {columnsOpen ? (
        <div className="v4-schedule__columns-panel" aria-label="Schedule columns">
          <header>
            <div>
              <strong>Schedule Columns</strong>
              <span>Visibility, order, and width</span>
            </div>
            <button type="button" aria-label="Close columns" onClick={() => setColumnsOpen(false)}>
              <X />
            </button>
          </header>
          <div className="v4-schedule__columns-list">
            {allColumns.map((column, index) => (
              <div key={column.columnId} className="v4-schedule__column-row">
                <label>
                  <input
                    type="checkbox"
                    checked={column.visible}
                    disabled={isCoreScheduleColumn(column) || configMutation.isPending}
                    onChange={() => updateColumn(column, { visible: !column.visible })}
                  />
                  <span>{column.label}</span>
                  {isCoreScheduleColumn(column) ? <small>Core</small> : null}
                </label>
                <div className="v4-schedule__column-controls">
                  <button
                    type="button"
                    aria-label={`Move ${column.label} up`}
                    disabled={index === 0 || configMutation.isPending}
                    onClick={() => moveColumn(index, -1)}
                  >
                    <ArrowUp />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${column.label} down`}
                    disabled={index === allColumns.length - 1 || configMutation.isPending}
                    onClick={() => moveColumn(index, 1)}
                  >
                    <ArrowDown />
                  </button>
                  <button
                    type="button"
                    aria-label={`Narrow ${column.label}`}
                    disabled={column.width <= 60 || configMutation.isPending}
                    onClick={() =>
                      updateColumn(column, {
                        width: Math.max(60, column.width - 20),
                      })
                    }
                  >
                    <Minus />
                  </button>
                  <span>{column.width}px</span>
                  <button
                    type="button"
                    aria-label={`Widen ${column.label}`}
                    disabled={column.width >= 600 || configMutation.isPending}
                    onClick={() =>
                      updateColumn(column, {
                        width: Math.min(600, column.width + 20),
                      })
                    }
                  >
                    <Plus />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="v4-schedule__reset"
            disabled={configMutation.isPending}
            onClick={resetColumns}
          >
            <RotateCcw /> Reset to Template
          </button>
        </div>
      ) : null}{' '}
      {settingsOpen ? (
        <div className="v4-schedule__settings-panel" aria-label="Schedule settings">
          <header>
            <div>
              <strong>Output Settings</strong>
              <span>Phase-2 configuration</span>
            </div>
            <button
              type="button"
              aria-label="Close settings"
              onClick={() => setSettingsOpen(false)}
            >
              <X />
            </button>
          </header>
          <label>
            <span>Paper Size</span>
            <select
              aria-label="Paper size"
              value={workspace.effectiveTemplate.paperSize}
              disabled={configMutation.isPending}
              onChange={(event) =>
                void mutateConfig({
                  paperSize: event.target.value as 'Auto' | 'A4' | 'A3',
                })
              }
            >
              <option>Auto</option>
              <option>A4</option>
              <option>A3</option>
            </select>
          </label>
          <dl>
            <div>
              <dt>Orientation</dt>
              <dd>{workspace.effectiveTemplate.orientation} · Template-defined</dd>
            </div>
            <div>
              <dt>Header</dt>
              <dd>
                {workspace.effectiveTemplate.headerSettings.visible ? 'Shown' : 'Hidden'} ·
                Template-defined
              </dd>
            </div>
            <div>
              <dt>Footer</dt>
              <dd>
                {workspace.effectiveTemplate.footerSettings.visible ? 'Shown' : 'Hidden'} ·
                Template-defined
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  ) : null;
  const finalOutputLauncher = (generate = false) =>
    workspace ? (
      <V4OutputPresentationLauncher
        projectId={projectId as string}
        outputKind={finalTab === 'technical' ? 'LuminaireSchedule' : 'PresentationSchedule'}
        targetRevisionId={eligibleTarget?.revisionId}
        disabled={generationBlocked}
        label={generate ? 'Generate Output' : 'Preview'}
        triggerContent={
          <>
            {generate ? <FileDown size={14} /> : <Eye size={14} />}{' '}
            {generate ? 'Generate Output' : 'Preview'}
          </>
        }
        triggerStyle={{
          display: 'flex',
          alignItems: 'center',
          gap: generate ? 6 : 5,
          border: generate ? 'none' : `1px solid ${FinalC.border}`,
          borderRadius: generate ? '6px 0 0 6px' : 6,
          background: generate ? FinalC.teal : FinalC.white,
          color: generate ? 'white' : FinalC.textDark,
          height: 32,
          minHeight: 0,
          padding: generate ? '0 14px' : '0 12px',
          fontSize: 12,
          fontWeight: generate ? 600 : 500,
          boxShadow: 'none',
        }}
        templateOptions={finalTab === 'technical' ? workspace.templates : []}
        selectedTemplate={
          finalTab === 'technical'
            ? {
                templateId: workspace.effectiveTemplate.templateId,
                templateVersionId: workspace.effectiveTemplate.versionId,
              }
            : undefined
        }
        onGenerated={async () => {
          await refreshSchedule();
          if (eligibleTarget) await refreshComposedRevisionReads();
        }}
      />
    ) : null;
  const loading =
    projectQuery.isLoading || projectWorkspaceQuery.isLoading || scheduleQuery.isLoading;
  const failed = projectQuery.isError || projectWorkspaceQuery.isError || scheduleQuery.isError;

  return (
    <V4AppShell
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
      activeSectionId="lighting-schedule"
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
              projectQueryKey={['v4', 'luminaire-schedule', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        finalView ? null : (
          <div
            className="v4-schedule-page-header"
            style={finalView ? { display: 'none' } : undefined}
          >
            <V4PageHeader
              icon={v4SemanticIcons.luminaireSchedule}
              title="Luminaire Schedule"
              description="Prepare and generate the project technical luminaire schedule."
            />
          </div>
        )
      }
    >
      <main
        className={finalView ? 'final-ui-reference' : 'v4-schedule v4-bounded-page'}
        style={
          finalView
            ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }
            : undefined
        }
        data-testid="v4-luminaire-schedule"
      >
        {loading ? (
          <div className="v4-schedule__state" aria-busy="true">
            Loading Luminaire Schedule…
          </div>
        ) : null}
        {failed ? (
          <div className="v4-schedule__state" role="alert">
            <strong>Luminaire Schedule could not be loaded.</strong>
            <button
              type="button"
              onClick={() =>
                void Promise.all([
                  projectQuery.refetch(),
                  projectWorkspaceQuery.refetch(),
                  scheduleQuery.refetch(),
                ])
              }
            >
              Retry
            </button>
          </div>
        ) : null}
        {!loading && !failed && workspace && finalView ? (
          <FinalScheduleView
            binding={{
              workspace,
              rows: pageRows,
              columns,
              selectedId: selectedRowId,
              select: (id) => {
                setSelectedRowId(id);
                setInspectorOpen(true);
              },
              tab: finalTab,
              setTab: setFinalTab,
              detailsOpen: inspectorOpen,
              close: () => setInspectorOpen(false),
              template: `${workspace.effectiveTemplate.templateId}::${workspace.effectiveTemplate.versionId}`,
              setTemplate: (value) => {
                const template = workspace.templates.find(
                  (item) => `${item.templateId}::${item.templateVersionId}` === value,
                );
                if (template)
                  void mutateConfig({
                    templateId: template.templateId,
                    templateVersionId: template.templateVersionId,
                  });
              },
              revision: revisionId ?? '',
              setRevision: (value) => setRevisionId(value || undefined),
              page,
              pages: pageCount,
              total: rows.length,
              pageSize,
              setPage,
              setPageSize,
              columnsAction: () => {
                setColumnsOpen(!columnsOpen);
                setSettingsOpen(false);
              },
              settingsAction: () => {
                setSettingsOpen(!settingsOpen);
                setColumnsOpen(false);
              },
              preview: finalOutputLauncher(),
              generate: finalOutputLauncher(true),
              options: () => {
                setSettingsOpen(!settingsOpen);
                setColumnsOpen(false);
              },
              panels: finalPanels,
              notice: (
                <>
                  {requestedTarget ? (
                    <V4TargetRevisionContext
                      requestedTarget={requestedTarget}
                      familyLabel="Luminaire Schedule"
                      onClear={clearTarget}
                    />
                  ) : null}
                  {operationError ? <p role="alert">{operationError}</p> : null}
                  {!workspace.generationReadiness.ready ? (
                    <p role="status">{workspace.generationReadiness.reasons.join(' · ')}</p>
                  ) : null}
                </>
              ),
              history: (
                <div className="v4-schedule">
                  {finalHistory.length ? (
                    finalHistory
                      .slice(0, 1)
                      .map((item) => (
                        <OutputHistoryItem
                          key={item.output.outputId}
                          item={item}
                          latestId={latestId}
                          folderPath={projectWorkspaceQuery.data?.folderPath}
                          pending={generationMutation.isPending}
                          onRetry={(value) => void retry(value)}
                        />
                      ))
                  ) : (
                    <p style={{ fontSize: 11, color: FinalC.textSub }}>No Schedule outputs yet.</p>
                  )}
                </div>
              ),
              viewHistory: () =>
                navigate(
                  selectedRevision
                    ? revisionRoute(selectedRevision.revisionId)
                    : `/projects/${projectId}/revisions`,
                ),
              duplicate: duplicateSelected,
              compare: () => {
                if (selectedRevision && previousRevision)
                  navigate(
                    `/projects/${projectId}/intelligence?fromRevisionId=${encodeURIComponent(previousRevision.revisionId)}&toRevisionId=${encodeURIComponent(selectedRevision.revisionId)}`,
                  );
              },
              remove: () => {
                if (selectedRevision) navigate(revisionRoute(selectedRevision.revisionId, true));
              },
              canRevise: Boolean(deleteEligibilityQuery.data?.canDelete),
              canDuplicate: Boolean(
                selectedRevision?.provenanceClassification === 'CANONICAL' &&
                selectedRevision.lifecycleState === 'FINALIZED' &&
                selectedRevision.snapshotHash,
              ),
              canCompare: Boolean(previousRevision),
              pending:
                configMutation.isPending ||
                generationMutation.isPending ||
                duplicateMutation.isPending,
            }}
          />
        ) : !loading && !failed && workspace ? (
          <div className="v4-schedule__page">
            <div className="v4-schedule__tabs" role="tablist" aria-label="Schedule type">
              <button type="button" role="tab" aria-selected="true">
                Technical Schedule
              </button>
            </div>
            {requestedTarget ? (
              <V4TargetRevisionContext
                requestedTarget={requestedTarget}
                familyLabel="Luminaire Schedule"
                onClear={clearTarget}
              />
            ) : null}
            {operationError ? (
              <div className="v4-schedule__notice" role="alert">
                <AlertTriangle /> <span>{operationError}</span>
                <button
                  type="button"
                  aria-label="Dismiss error"
                  onClick={() => setOperationError(null)}
                >
                  <X />
                </button>
              </div>
            ) : null}
            <div
              className={`v4-schedule__workspace${inspectorOpen ? '' : ' v4-schedule__workspace--closed'}`}
              data-testid="schedule-workspace"
            >
              <section
                className="v4-schedule__main-card"
                aria-label="Technical Luminaire Schedule"
                data-testid="schedule-main-card"
              >
                <div className="v4-schedule__toolbar">
                  <label className="v4-schedule__select-field">
                    <span>Template</span>
                    <select
                      aria-label="Schedule template"
                      value={`${workspace.effectiveTemplate.templateId}::${workspace.effectiveTemplate.versionId}`}
                      disabled={configMutation.isPending}
                      onChange={(event) => {
                        const template = workspace.templates.find(
                          (item) =>
                            `${item.templateId}::${item.templateVersionId}` === event.target.value,
                        );
                        if (template)
                          void mutateConfig({
                            templateId: template.templateId,
                            templateVersionId: template.templateVersionId,
                          });
                      }}
                    >
                      {workspace.templates.map((template) => (
                        <option
                          key={`${template.templateId}:${template.templateVersionId}`}
                          value={`${template.templateId}::${template.templateVersionId}`}
                        >
                          {template.name} · {template.version}
                        </option>
                      ))}
                    </select>
                    <ChevronDown />
                  </label>
                  <label className="v4-schedule__select-field">
                    <span>
                      Revision
                      {revisionId ? (
                        <small className="v4-schedule__snapshot-pill">Snapshot</small>
                      ) : null}
                    </span>
                    <select
                      aria-label="Schedule revision"
                      value={revisionId ?? ''}
                      onChange={(event) => setRevisionId(event.target.value || undefined)}
                    >
                      <option value="">Current / Live Schedule</option>
                      {workspace.revisions.map((revision) => (
                        <option
                          key={revision.revision.revisionId}
                          value={revision.revision.revisionId}
                        >
                          {revision.revision.revisionLabel}
                        </option>
                      ))}
                    </select>
                    <ChevronDown />
                  </label>
                  <div className="v4-schedule__toolbar-actions">
                    <div className="v4-schedule__popover-anchor">
                      <button
                        type="button"
                        aria-expanded={columnsOpen}
                        onClick={() => {
                          setColumnsOpen((open) => !open);
                          setSettingsOpen(false);
                        }}
                      >
                        <Columns3 /> Columns
                      </button>
                      {columnsOpen ? (
                        <div className="v4-schedule__columns-panel" aria-label="Schedule columns">
                          <header>
                            <div>
                              <strong>Schedule Columns</strong>
                              <span>Visibility, order, and width</span>
                            </div>
                            <button
                              type="button"
                              aria-label="Close columns"
                              onClick={() => setColumnsOpen(false)}
                            >
                              <X />
                            </button>
                          </header>
                          <div className="v4-schedule__columns-list">
                            {allColumns.map((column, index) => (
                              <div key={column.columnId} className="v4-schedule__column-row">
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={column.visible}
                                    disabled={
                                      isCoreScheduleColumn(column) || configMutation.isPending
                                    }
                                    onChange={() =>
                                      updateColumn(column, { visible: !column.visible })
                                    }
                                  />
                                  <span>{column.label}</span>
                                  {isCoreScheduleColumn(column) ? <small>Core</small> : null}
                                </label>
                                <div className="v4-schedule__column-controls">
                                  <button
                                    type="button"
                                    aria-label={`Move ${column.label} up`}
                                    disabled={index === 0 || configMutation.isPending}
                                    onClick={() => moveColumn(index, -1)}
                                  >
                                    <ArrowUp />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Move ${column.label} down`}
                                    disabled={
                                      index === allColumns.length - 1 || configMutation.isPending
                                    }
                                    onClick={() => moveColumn(index, 1)}
                                  >
                                    <ArrowDown />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Narrow ${column.label}`}
                                    disabled={column.width <= 60 || configMutation.isPending}
                                    onClick={() =>
                                      updateColumn(column, {
                                        width: Math.max(60, column.width - 20),
                                      })
                                    }
                                  >
                                    <Minus />
                                  </button>
                                  <span>{column.width}px</span>
                                  <button
                                    type="button"
                                    aria-label={`Widen ${column.label}`}
                                    disabled={column.width >= 600 || configMutation.isPending}
                                    onClick={() =>
                                      updateColumn(column, {
                                        width: Math.min(600, column.width + 20),
                                      })
                                    }
                                  >
                                    <Plus />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="v4-schedule__reset"
                            disabled={configMutation.isPending}
                            onClick={resetColumns}
                          >
                            <RotateCcw /> Reset to Template
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="v4-schedule__popover-anchor">
                      <button
                        type="button"
                        aria-expanded={settingsOpen}
                        onClick={() => {
                          setSettingsOpen((open) => !open);
                          setColumnsOpen(false);
                        }}
                      >
                        <Settings2 /> Settings
                      </button>
                      {settingsOpen ? (
                        <div className="v4-schedule__settings-panel" aria-label="Schedule settings">
                          <header>
                            <div>
                              <strong>Output Settings</strong>
                              <span>Phase-2 configuration</span>
                            </div>
                            <button
                              type="button"
                              aria-label="Close settings"
                              onClick={() => setSettingsOpen(false)}
                            >
                              <X />
                            </button>
                          </header>
                          <label>
                            <span>Paper Size</span>
                            <select
                              aria-label="Paper size"
                              value={workspace.effectiveTemplate.paperSize}
                              disabled={configMutation.isPending}
                              onChange={(event) =>
                                void mutateConfig({
                                  paperSize: event.target.value as 'Auto' | 'A4' | 'A3',
                                })
                              }
                            >
                              <option>Auto</option>
                              <option>A4</option>
                              <option>A3</option>
                            </select>
                          </label>
                          <dl>
                            <div>
                              <dt>Orientation</dt>
                              <dd>{workspace.effectiveTemplate.orientation} · Template-defined</dd>
                            </div>
                            <div>
                              <dt>Header</dt>
                              <dd>
                                {workspace.effectiveTemplate.headerSettings.visible
                                  ? 'Shown'
                                  : 'Hidden'}{' '}
                                · Template-defined
                              </dd>
                            </div>
                            <div>
                              <dt>Footer</dt>
                              <dd>
                                {workspace.effectiveTemplate.footerSettings.visible
                                  ? 'Shown'
                                  : 'Hidden'}{' '}
                                · Template-defined
                              </dd>
                            </div>
                          </dl>
                        </div>
                      ) : null}
                    </div>
                    {!inspectorOpen ? (
                      <button type="button" onClick={() => setInspectorOpen(true)}>
                        Output Details
                      </button>
                    ) : null}
                    <V4OutputPresentationLauncher
                      projectId={projectId as string}
                      outputKind="LuminaireSchedule"
                      targetRevisionId={eligibleTarget?.revisionId}
                      disabled={generationBlocked}
                      label="Preview Technical"
                      templateOptions={workspace.templates}
                      selectedTemplate={{
                        templateId: workspace.effectiveTemplate.templateId,
                        templateVersionId: workspace.effectiveTemplate.versionId,
                      }}
                      onGenerated={async () => {
                        await refreshSchedule();
                        if (eligibleTarget) await refreshComposedRevisionReads();
                      }}
                    />
                    <V4OutputPresentationLauncher
                      projectId={projectId as string}
                      outputKind="PresentationSchedule"
                      targetRevisionId={eligibleTarget?.revisionId}
                      disabled={
                        Boolean(revisionId) ||
                        invalidTarget ||
                        targetUnverified ||
                        !workspace.generationReadiness.ready
                      }
                      label="Preview Presentation"
                      onGenerated={async () => {
                        await refreshSchedule();
                        if (eligibleTarget) await refreshComposedRevisionReads();
                      }}
                    />
                  </div>
                </div>
                {!workspace.generationReadiness.ready ? (
                  <div className="v4-schedule__readiness" role="status">
                    <AlertTriangle /> {workspace.generationReadiness.reasons.join(' · ')}
                  </div>
                ) : null}
                <div className="v4-schedule__table-scroll" data-testid="schedule-table-scroll">
                  <table>
                    <colgroup>
                      <col style={{ width: 42 }} />
                      {columns.map((column) => (
                        <col key={column.columnId} style={{ width: column.width }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th>
                          <span className="v4-visually-hidden">Select row</span>
                        </th>
                        {columns.map((column) => (
                          <th key={column.columnId}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row) => {
                        const rowId = scheduleRowKey(row);
                        return (
                          <tr key={rowId} data-selected={selectedRowId === rowId}>
                            <td>
                              <input
                                type="radio"
                                name="schedule-row"
                                aria-label={`Select ${row.tag}`}
                                checked={selectedRowId === rowId}
                                onChange={() => setSelectedRowId(rowId)}
                              />
                            </td>
                            {columns.map((column) => (
                              <td key={column.columnId}>
                                {column.fieldKey === 'imagePath' ? (
                                  <span className="v4-schedule__thumb">
                                    <LuminaireImage
                                      path={row.imagePath}
                                      alt={`${row.tag} schedule thumbnail`}
                                    />
                                  </span>
                                ) : (
                                  scheduleCellValue(row, column.fieldKey)
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!pageRows.length ? (
                    <div className="v4-schedule__empty">
                      <strong>No luminaires available</strong>
                      <p>The selected schedule context has no luminaire rows.</p>
                    </div>
                  ) : null}
                </div>
                <footer className="v4-schedule__pagination" data-testid="schedule-pagination">
                  <span>
                    Showing {start} to {end} of {rows.length} luminaires
                  </span>
                  <V4Pagination
                    pageCount={pageCount}
                    currentPage={page}
                    onChange={setPage}
                    ariaLabel="Schedule pages"
                  />
                  <label>
                    <span className="v4-visually-hidden">Rows per page</span>
                    <select
                      aria-label="Rows per page"
                      value={pageSize}
                      onChange={(event) => setPageSize(Number(event.target.value))}
                    >
                      <option value="10">10 / page</option>
                      <option value="25">25 / page</option>
                      <option value="50">50 / page</option>
                    </select>
                  </label>
                </footer>
              </section>
              {inspectorOpen ? (
                <aside
                  className="v4-schedule__inspector"
                  aria-label="Schedule Output Details"
                  data-testid="schedule-inspector"
                >
                  <header>
                    <div>
                      <v4SemanticIcons.luminaireSchedule />
                      <h2>Schedule Output Details</h2>
                    </div>
                    <button
                      type="button"
                      aria-label="Close output details"
                      onClick={() => setInspectorOpen(false)}
                    >
                      <X />
                    </button>
                  </header>
                  <div className="v4-schedule__inspector-scroll">
                    <section aria-labelledby="schedule-details-heading">
                      <h3 id="schedule-details-heading">Output Details</h3>
                      <dl className="v4-schedule__details">
                        <div>
                          <dt>Template</dt>
                          <dd>{workspace.effectiveTemplate.displayName}</dd>
                        </div>
                        <div>
                          <dt>Version</dt>
                          <dd>{workspace.effectiveTemplate.versionId}</dd>
                        </div>
                        <div>
                          <dt>Revision</dt>
                          <dd>
                            {workspace.selectedRevision?.metadata.revision.revisionLabel ??
                              'Live / Current data'}
                          </dd>
                        </div>
                        <div>
                          <dt>Paper Size</dt>
                          <dd>{workspace.effectiveTemplate.paperSize}</dd>
                        </div>
                        <div>
                          <dt>Orientation</dt>
                          <dd>{workspace.effectiveTemplate.orientation} · Template-defined</dd>
                        </div>
                        <div>
                          <dt>Header</dt>
                          <dd>
                            {workspace.effectiveTemplate.headerSettings.visible
                              ? 'Shown'
                              : 'Hidden'}{' '}
                            · Template-defined
                          </dd>
                        </div>
                        <div>
                          <dt>Footer</dt>
                          <dd>
                            {workspace.effectiveTemplate.footerSettings.visible
                              ? 'Shown'
                              : 'Hidden'}{' '}
                            · Template-defined
                          </dd>
                        </div>
                        <div>
                          <dt>Last Updated</dt>
                          <dd>
                            {formatScheduleDateTime(
                              latestOutput?.output.finalizedAt ??
                                latestOutput?.output.updatedAt ??
                                null,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Updated By</dt>
                          <dd>{latestOutput?.createdByName || 'Not available'}</dd>
                        </div>
                      </dl>
                    </section>
                    <section
                      aria-labelledby="schedule-history-heading"
                      className="v4-schedule__history"
                    >
                      <div className="v4-schedule__section-heading">
                        <History /> <h3 id="schedule-history-heading">Output History</h3>
                        <span>{workspace.outputs.length}</span>
                      </div>
                      {workspace.outputs.length ? (
                        workspace.outputs.map((item) => (
                          <OutputHistoryItem
                            key={item.output.outputId}
                            item={item}
                            latestId={latestId}
                            folderPath={projectWorkspaceQuery.data?.folderPath}
                            pending={generationMutation.isPending}
                            onRetry={(value) => void retry(value)}
                          />
                        ))
                      ) : (
                        <div className="v4-schedule__history-empty">
                          <History />
                          <strong>No Schedule outputs yet</strong>
                          <span>Generated XLSX and PDF outputs will appear here.</span>
                        </div>
                      )}
                    </section>
                  </div>
                </aside>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>
    </V4AppShell>
  );
}
