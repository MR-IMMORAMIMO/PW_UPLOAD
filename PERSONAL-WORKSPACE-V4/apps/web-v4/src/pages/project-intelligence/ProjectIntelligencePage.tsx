import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generatePath, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  SctNext as ArrowRight,
  SctSuccess as CheckCircle2,
  SctWarning as CircleAlert,
  SctPending as CircleDashed,
  SctLocked as Lock,
  SctError as XCircle,
} from '../../components/common/SctIcons';
import {
  Activity,
  Check,
  ChevronRight,
  FilePlus2,
  Gauge,
  History,
  RefreshCw,
  ShieldCheck,
} from '../../components/common/SctIcons';
import type { ProjectActionItem, ProjectSourceFile, SourceFreshnessItem } from '@scli/domain';
import { api } from '../../api/environment';
import { executeProjectSourceHandoff } from '../../desktop/integrations';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4StatusPill, type V4StatusPillVariant } from '../../components/common/V4StatusPill';
import { V4SectionTitle } from '../../components/common/V4SectionTitle';
import { V4StatePanel } from '../../components/common/V4StatePanel';
import { V4RouteErrorState } from '../../components/common/V4RouteErrorState';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import { ROUTE_PROJECT_ACTIONS, ROUTE_PROJECT_INTELLIGENCE } from '../../router/routes';
import './projectIntelligence.css';
import {
  diffChangeLabel,
  diffChangeVariant,
  impactCategoryLabel,
  readinessLevelLabel,
  readinessLevelVariant,
  sortedDiffLuminaires,
  sourceFreshnessLabel,
  sourceFreshnessVariant,
  sourceTypeLabel,
} from './projectIntelligenceViewModel';

const formatDateTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : '—';

export function ProjectIntelligencePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [comparisonParams] = useSearchParams();
  const appliedComparison = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [targetRevisionId, setTargetRevisionId] = useState<string>('');
  const [fromRevisionId, setFromRevisionId] = useState<string>('');
  const [toRevisionId, setToRevisionId] = useState<string>('');
  const [selectedLuminaireId, setSelectedLuminaireId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const [sourcePickerBusy, setSourcePickerBusy] = useState(false);

  const projectQuery = useQuery({
    queryKey: ['v4', 'intelligence', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'intelligence', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: Boolean(projectId),
  });
  const overviewQuery = useQuery({
    queryKey: ['v4', 'intelligence', 'overview', projectId],
    queryFn: () => api.projectIntelligence(projectId as string),
    enabled: Boolean(projectId),
  });
  const sourceFilesQuery = useQuery({
    queryKey: ['v4', 'intelligence', 'sources', projectId],
    queryFn: () => api.projectSourceFiles(projectId as string),
    enabled: Boolean(projectId),
  });

  const revisions = overviewQuery.data?.revisions ?? [];
  const actions = workspaceQuery.data?.actions ?? [];
  const sourceFiles = sourceFilesQuery.data ?? [];

  const latestRevision = revisions[0];
  useEffect(() => {
    if (revisions.length === 0) return;
    setTargetRevisionId((current) => {
      if (current && revisions.some((revision) => revision.revisionId === current)) return current;
      return latestRevision?.revisionId ?? '';
    });
    setFromRevisionId((current) => {
      if (current && revisions.some((revision) => revision.revisionId === current)) return current;
      const previous = revisions.find(
        (revision) => revision.revisionId !== latestRevision?.revisionId,
      );
      return previous?.revisionId ?? latestRevision?.revisionId ?? '';
    });
    setToRevisionId((current) => {
      if (current && revisions.some((revision) => revision.revisionId === current)) return current;
      return latestRevision?.revisionId ?? '';
    });
  }, [revisions, latestRevision]);

  useEffect(() => {
    if (!overviewQuery.data) return;
    const from = comparisonParams.get('fromRevisionId'),
      to = comparisonParams.get('toRevisionId');
    if (!from && !to) return;
    const key = `${projectId}:${from}:${to}`;
    if (appliedComparison.current === key) return;
    appliedComparison.current = key;
    if (
      !from ||
      !to ||
      from === to ||
      !revisions.some((item) => item.revisionId === from) ||
      !revisions.some((item) => item.revisionId === to)
    ) {
      setFromRevisionId('');
      setToRevisionId('');
      setOperationError('The linked Revision comparison is not available in this Project.');
      return;
    }
    setFromRevisionId(from);
    setToRevisionId(to);
  }, [comparisonParams, projectId, overviewQuery.data, revisions]);

  const readinessQuery = useQuery({
    queryKey: ['v4', 'intelligence', 'readiness', projectId, targetRevisionId],
    queryFn: () => api.projectReadiness(projectId as string, targetRevisionId as string),
    enabled: Boolean(projectId && targetRevisionId),
  });
  const comparisonQuery = useQuery({
    queryKey: ['v4', 'intelligence', 'comparison', projectId, fromRevisionId, toRevisionId],
    queryFn: () =>
      api.projectRevisionComparison(
        projectId as string,
        fromRevisionId as string,
        toRevisionId as string,
      ),
    enabled: Boolean(projectId && fromRevisionId && toRevisionId),
  });
  const freshnessQuery = useQuery({
    queryKey: ['v4', 'intelligence', 'freshness', projectId, targetRevisionId],
    queryFn: () => api.projectSourceFreshness(projectId as string, targetRevisionId as string),
    enabled: Boolean(projectId && targetRevisionId),
  });

  const readiness = readinessQuery.data;
  const comparison = comparisonQuery.data;
  const freshnessItems = freshnessQuery.data ?? [];

  const diffLuminaires = useMemo(
    () => (comparison ? sortedDiffLuminaires(comparison.luminaires) : []),
    [comparison],
  );
  const selectedDiff = useMemo(
    () => diffLuminaires.find((item) => item.luminaireId === selectedLuminaireId) ?? null,
    [diffLuminaires, selectedLuminaireId],
  );
  useEffect(() => {
    if (
      selectedLuminaireId &&
      !diffLuminaires.some((item) => item.luminaireId === selectedLuminaireId)
    ) {
      setSelectedLuminaireId(null);
    }
  }, [diffLuminaires, selectedLuminaireId]);

  const toggleBlocking = useMutation({
    mutationFn: (action: ProjectActionItem) =>
      api.patchProjectAction(projectId as string, action.id, {
        rowVersion: action.rowVersion ?? 1,
        blocksIssue: !(action.blocksIssue ?? false),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['v4', 'intelligence', 'workspace', projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['v4', 'intelligence', 'readiness', projectId, targetRevisionId],
      });
      setOperationNotice('Action issue-blocking updated.');
    },
    onError: (error: Error) => setOperationError(error.message),
  });

  const markDone = useMutation({
    mutationFn: (action: ProjectActionItem) =>
      api.patchProjectAction(projectId as string, action.id, {
        rowVersion: action.rowVersion ?? 1,
        status: 'Completed',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['v4', 'intelligence', 'workspace', projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['v4', 'intelligence', 'readiness', projectId, targetRevisionId],
      });
      setOperationNotice('Action completed.');
    },
    onError: (error: Error) => setOperationError(error.message),
  });

  const checkFreshness = useMutation({
    mutationFn: (source: ProjectSourceFile) =>
      api.checkProjectSourceFreshness(projectId as string, source.id, targetRevisionId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['v4', 'intelligence', 'freshness', projectId, targetRevisionId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['v4', 'intelligence', 'readiness', projectId, targetRevisionId],
      });
      setOperationNotice('Controlled sources refreshed.');
    },
    onError: (error: Error) => setOperationError(error.message),
  });

  const captureBaseline = useMutation({
    mutationFn: (source: ProjectSourceFile) =>
      api.captureProjectSourceBaseline(projectId as string, targetRevisionId as string, {
        sourceId: source.id,
        revisionId: targetRevisionId as string,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['v4', 'intelligence', 'freshness', projectId, targetRevisionId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['v4', 'intelligence', 'readiness', projectId, targetRevisionId],
      });
      setOperationNotice('Source baseline captured for this Revision.');
    },
    onError: (error: Error) => setOperationError(error.message),
  });

  const registerSource = useMutation({
    mutationFn: async (sourceType: ProjectSourceFile['sourceType']) => {
      setSourcePickerBusy(true);
      try {
        const { admissionId, handoff } = await api.selectProjectSourceHandoff(projectId as string);
        const outcome = await executeProjectSourceHandoff(handoff);
        if (outcome !== 'accepted')
          throw new Error('Native file picker is not available in this environment.');
        return api.registerProjectSourceFile(projectId as string, { sourceType, admissionId });
      } finally {
        setSourcePickerBusy(false);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['v4', 'intelligence', 'sources', projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['v4', 'intelligence', 'overview', projectId],
      });
      setOperationNotice('Controlled source registered.');
    },
    onError: (error: Error) => setOperationError(error.message),
  });

  const loading =
    projectQuery.isLoading ||
    workspaceQuery.isLoading ||
    overviewQuery.isLoading ||
    sourceFilesQuery.isLoading;
  const error = projectQuery.isError || workspaceQuery.isError || overviewQuery.isError;
  const retrying = projectQuery.isFetching || workspaceQuery.isFetching || overviewQuery.isFetching;
  const retryAll = () =>
    void Promise.all([
      projectQuery.refetch(),
      workspaceQuery.refetch(),
      overviewQuery.refetch(),
      sourceFilesQuery.refetch(),
    ]);

  const ready = readiness;
  const levelVariant = ready ? readinessLevelVariant(ready.level) : 'neutral';

  const actionPillVariant = (action: ProjectActionItem): V4StatusPillVariant =>
    action.status === 'Completed'
      ? 'success'
      : action.status === 'Cancelled'
        ? 'neutral'
        : action.status === 'Waiting'
          ? 'warning'
          : (action.blocksIssue ?? false)
            ? 'danger'
            : 'info';

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
      activeSectionId="intelligence"
      onSelectSection={(id) => {
        if (projectId && id === 'actions')
          navigate(generatePath(ROUTE_PROJECT_ACTIONS, { projectId }));
        if (projectId && id === 'intelligence')
          navigate(generatePath(ROUTE_PROJECT_INTELLIGENCE, { projectId }));
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
        />
      }
      pageHeader={
        <V4PageHeader
          icon={Gauge}
          title="Project Intelligence"
          description="Readiness, Revision impact, Actions, and controlled source freshness."
        />
      }
    >
      <div className="v4-intelligence v4-bounded-page" data-testid="v4-project-intelligence">
        {loading ? (
          <div className="v4-intelligence__state" aria-busy="true">
            Loading Project Intelligence…
          </div>
        ) : error ? (
          <V4RouteErrorState
            title="Unable to load Project Intelligence"
            message="Project intelligence could not be loaded."
            retrying={retrying}
            onRetry={retryAll}
          />
        ) : (
          <>
            {operationError ? (
              <div className="v4-intelligence__banner v4-intelligence__banner--error" role="alert">
                <CircleAlert aria-hidden="true" />
                <span>{operationError}</span>
                <button type="button" onClick={() => setOperationError(null)} aria-label="Dismiss">
                  <XCircle aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {operationNotice ? (
              <div className="v4-intelligence__banner" role="status">
                <CheckCircle2 aria-hidden="true" />
                <span>{operationNotice}</span>
                <button type="button" onClick={() => setOperationNotice(null)} aria-label="Dismiss">
                  <XCircle aria-hidden="true" />
                </button>
              </div>
            ) : null}

            {/* Target Revision selector */}
            <div className="v4-intelligence__target">
              <label htmlFor="v4-intelligence-target-revision">Target Revision</label>
              <select
                id="v4-intelligence-target-revision"
                value={targetRevisionId}
                onChange={(event) => setTargetRevisionId(event.target.value)}
              >
                {revisions.length === 0 ? (
                  <option value="">No Revisions yet</option>
                ) : (
                  revisions.map((revision) => (
                    <option key={revision.revisionId} value={revision.revisionId}>
                      {revision.revisionLabel} · {revision.lifecycleState}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* TOP ROW — Ready-to-Issue status + Readiness Findings table */}
            <div className="v4-intelligence__top">
              <section
                className="v4-intelligence__readiness-card"
                aria-label="Ready-to-Issue status"
                data-level={ready?.level ?? 'NOT_READY'}
              >
                <div className="v4-intelligence__readiness-card-head">
                  <ShieldCheck aria-hidden="true" />
                  <h2>Ready-to-Issue Status</h2>
                  {ready ? (
                    <V4StatusPill variant={levelVariant}>
                      {readinessLevelLabel(ready.level)}
                    </V4StatusPill>
                  ) : (
                    <V4StatusPill variant="neutral">Not evaluated</V4StatusPill>
                  )}
                </div>
                {ready ? (
                  <>
                    <div className="v4-intelligence__readiness-state">
                      <span className="v4-intelligence__readiness-shield">
                        <ShieldCheck aria-hidden="true" />
                      </span>
                      <strong>{readinessLevelLabel(ready.level).toUpperCase()}</strong>
                    </div>
                    <p className="v4-intelligence__readiness-copy">
                      {ready.level === 'READY'
                        ? 'Project is ready to issue.'
                        : ready.level === 'READY_WITH_WARNINGS'
                          ? 'Project is ready to issue with non-blocking warnings.'
                          : 'Project is not ready to issue due to blocking items.'}
                    </p>
                    <div className="v4-intelligence__readiness-counts">
                      <span data-tone="danger">
                        <b>{ready.counts.blockers}</b>
                        <span>BLOCKERS</span>
                      </span>
                      <span data-tone="warning">
                        <b>{ready.counts.warnings}</b>
                        <span>WARNINGS</span>
                      </span>
                      <span data-tone="info">
                        <b>{ready.counts.info}</b>
                        <span>INFO</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="v4-intelligence__readiness-view"
                      onClick={() => {
                        document
                          .querySelector('.v4-intelligence__findings-card')
                          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                      }}
                    >
                      View all findings →
                    </button>
                  </>
                ) : null}
              </section>

              <section className="v4-intelligence__findings-card" aria-label="Readiness findings">
                <V4SectionTitle
                  icon={Gauge}
                  title="Readiness Findings"
                  headingLevel={3}
                  action={
                    <button
                      type="button"
                      className="v4-intelligence__secondary"
                      onClick={() => void readinessQuery.refetch()}
                      disabled={readinessQuery.isFetching}
                    >
                      <RefreshCw aria-hidden="true" /> Re-run
                    </button>
                  }
                />
                <div className="v4-intelligence__findings-scroll">
                  {readinessQuery.isLoading ? (
                    <p className="v4-intelligence__muted">Evaluating…</p>
                  ) : readiness && readiness.findings.length === 0 ? (
                    <V4StatePanel
                      compact
                      icon={CheckCircle2}
                      title="No blockers or warnings"
                      message="This Revision is safe and complete enough to issue."
                      tone="info"
                    />
                  ) : readiness && readiness.findings.length > 0 ? (
                    <table className="v4-intelligence__findings-table">
                      <thead>
                        <tr>
                          <th>Severity</th>
                          <th>Code</th>
                          <th>Finding</th>
                          <th>Source / Evidence</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {readiness.findings.map((finding) => (
                          <tr key={finding.code}>
                            <td>
                              <span
                                className="v4-intelligence__finding-sev"
                                data-severity={finding.severity}
                              >
                                <i aria-hidden="true" />
                                {finding.severity}
                              </span>
                            </td>
                            <td className="v4-intelligence__finding-code">{finding.code}</td>
                            <td className="v4-intelligence__finding-title">{finding.title}</td>
                            <td className="v4-intelligence__finding-source">
                              {finding.sourceAuthority.replaceAll('_', ' ')}
                              {finding.evidence ? ` · ${finding.evidence}` : ''}
                            </td>
                            <td>
                              {finding.recommendedTarget ? (
                                <button
                                  type="button"
                                  className="v4-intelligence__finding-action"
                                  onClick={() => {
                                    if (projectId && finding.recommendedTarget === 'actions')
                                      navigate(generatePath(ROUTE_PROJECT_ACTIONS, { projectId }));
                                  }}
                                >
                                  {finding.recommendedTarget === 'actions'
                                    ? 'Review action'
                                    : finding.recommendedTarget === 'technical-check'
                                      ? 'Open technical check'
                                      : finding.recommendedTarget === 'revisions'
                                        ? 'View revision'
                                        : 'Open'}
                                  <ChevronRight aria-hidden="true" />
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <V4StatePanel
                      compact
                      icon={CircleDashed}
                      title="No Revision selected"
                      message="Select a target Revision to evaluate readiness."
                    />
                  )}
                </div>
              </section>
            </div>

            {/* MIDDLE ROW — Revision Comparison | Project Actions | Controlled Sources */}
            <div className="v4-intelligence__mid">
              <section className="v4-intelligence__card" aria-label="Revision comparison">
                <V4SectionTitle
                  icon={History}
                  title="Revision Comparison"
                  headingLevel={3}
                  action={
                    <div className="v4-intelligence__compare-selectors">
                      <select
                        aria-label="From Revision"
                        value={fromRevisionId}
                        onChange={(event) => setFromRevisionId(event.target.value)}
                      >
                        {revisions.map((revision) => (
                          <option key={revision.revisionId} value={revision.revisionId}>
                            {revision.revisionLabel}
                          </option>
                        ))}
                      </select>
                      <ArrowRight aria-hidden="true" className="v4-intelligence__compare-arrow" />
                      <select
                        aria-label="To Revision"
                        value={toRevisionId}
                        onChange={(event) => setToRevisionId(event.target.value)}
                      >
                        {revisions.map((revision) => (
                          <option key={revision.revisionId} value={revision.revisionId}>
                            {revision.revisionLabel}
                          </option>
                        ))}
                      </select>
                    </div>
                  }
                />
                <div className="v4-intelligence__card-body">
                  {comparisonQuery.isLoading ? (
                    <p className="v4-intelligence__muted">Comparing snapshots…</p>
                  ) : comparison ? (
                    <>
                      <div className="v4-intelligence__summary-strip">
                        <span data-tone="success" data-count={comparison.summary.added}>
                          Added
                        </span>
                        <span data-tone="danger" data-count={comparison.summary.removed}>
                          Removed
                        </span>
                        <span data-tone="warning" data-count={comparison.summary.changed}>
                          Changed
                        </span>
                        <span data-count={comparison.summary.unchanged}>Unchanged</span>
                      </div>
                      {comparison.summary.impactedCategories.length > 0 ? (
                        <>
                          <div className="v4-intelligence__section-label">
                            Top Impact Categories
                          </div>
                          <ul className="v4-intelligence__impacts">
                            {comparison.summary.impactedCategories.map((category) => (
                              <li key={category}>
                                <V4StatusPill variant="info">
                                  {impactCategoryLabel(category)}
                                </V4StatusPill>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                      {diffLuminaires.length === 0 ? (
                        <V4StatePanel
                          compact
                          icon={CircleDashed}
                          title="No luminaires in these Revisions"
                          message="The compared Revisions have no Luminaire snapshots."
                        />
                      ) : (
                        <ul className="v4-intelligence__diff-list">
                          {diffLuminaires
                            .filter((item) => item.changeType !== 'UNCHANGED')
                            .map((item) => (
                              <li key={item.luminaireId}>
                                <button
                                  type="button"
                                  className="v4-intelligence__diff-row"
                                  onClick={() => setSelectedLuminaireId(item.luminaireId)}
                                  aria-pressed={selectedLuminaireId === item.luminaireId}
                                >
                                  <V4StatusPill variant={diffChangeVariant(item.changeType)}>
                                    {diffChangeLabel[item.changeType]}
                                  </V4StatusPill>
                                  <span className="v4-intelligence__diff-tag">{item.tag}</span>
                                  <span className="v4-intelligence__diff-fields">
                                    {item.changedFields.map((field) => field.label).join(', ') ||
                                      '—'}
                                  </span>
                                  {item.impactCategories.length > 0 ? (
                                    <span className="v4-intelligence__diff-impacts">
                                      {item.impactCategories.map((category) => (
                                        <V4StatusPill key={category} variant="neutral">
                                          {impactCategoryLabel(category)}
                                        </V4StatusPill>
                                      ))}
                                    </span>
                                  ) : null}
                                </button>
                              </li>
                            ))}
                        </ul>
                      )}
                      {selectedDiff ? (
                        <div className="v4-intelligence__drawer-inline">
                          <strong>
                            {selectedDiff.tag} — {diffChangeLabel[selectedDiff.changeType]}
                          </strong>
                          {selectedDiff.changedFields.length === 0 ? (
                            <p className="v4-intelligence__muted">No field-level changes.</p>
                          ) : (
                            <table className="v4-intelligence__field-diff">
                              <thead>
                                <tr>
                                  <th>Field</th>
                                  <th>From</th>
                                  <th>To</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedDiff.changedFields.map((field) => (
                                  <tr key={field.field}>
                                    <td>
                                      {field.label}
                                      <V4StatusPill variant="neutral">
                                        {impactCategoryLabel(field.category)}
                                      </V4StatusPill>
                                    </td>
                                    <td className="v4-intelligence__field-before">
                                      {String(field.before ?? '') || '—'}
                                    </td>
                                    <td className="v4-intelligence__field-after">
                                      {String(field.after ?? '') || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          <button
                            type="button"
                            className="v4-intelligence__secondary"
                            onClick={() => setSelectedLuminaireId(null)}
                          >
                            Close details
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <V4StatePanel
                      compact
                      icon={CircleDashed}
                      title="No Revisions to compare"
                      message="Create at least two Revisions to compare snapshot impact."
                    />
                  )}
                </div>
              </section>

              <section className="v4-intelligence__card" aria-label="Project Actions">
                <V4SectionTitle
                  icon={Activity}
                  title="Project Actions"
                  headingLevel={3}
                  action={
                    <button
                      type="button"
                      className="v4-intelligence__secondary"
                      onClick={() => {
                        if (projectId) navigate(generatePath(ROUTE_PROJECT_ACTIONS, { projectId }));
                      }}
                    >
                      Open Actions
                    </button>
                  }
                />
                <div className="v4-intelligence__card-body">
                  {actions.length === 0 ? (
                    <V4StatePanel
                      compact
                      icon={CircleDashed}
                      title="No Actions"
                      message="Create Actions to track work that still needs to be done."
                    />
                  ) : (
                    <ul className="v4-intelligence__actions-list">
                      {actions.slice(0, 8).map((action) => (
                        <li
                          key={action.id}
                          className="v4-intelligence__action"
                          data-tone={
                            action.status === 'Completed'
                              ? 'success'
                              : (action.blocksIssue ?? false)
                                ? 'danger'
                                : action.status === 'Waiting'
                                  ? 'warning'
                                  : 'info'
                          }
                        >
                          <div className="v4-intelligence__action-head">
                            <V4StatusPill variant={actionPillVariant(action)}>
                              {action.status}
                            </V4StatusPill>
                            <strong>{action.title}</strong>
                          </div>
                          <div className="v4-intelligence__action-meta">
                            <span>{action.priority}</span>
                            {(action.blocksIssue ?? false) ? (
                              <V4StatusPill variant="danger">Blocks Issue</V4StatusPill>
                            ) : null}
                            <span>{action.dueDate ? `Due ${action.dueDate}` : 'No due date'}</span>
                          </div>
                          {action.status !== 'Completed' && action.status !== 'Cancelled' ? (
                            <div className="v4-intelligence__action-ops">
                              <button
                                type="button"
                                className="v4-intelligence__secondary"
                                disabled={toggleBlocking.isPending}
                                onClick={() => toggleBlocking.mutate(action)}
                              >
                                {(action.blocksIssue ?? false) ? 'Unblock Issue' : 'Blocks Issue'}
                              </button>
                              <button
                                type="button"
                                className="v4-intelligence__primary"
                                disabled={markDone.isPending}
                                onClick={() => markDone.mutate(action)}
                              >
                                Mark Done
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section className="v4-intelligence__card" aria-label="Controlled source freshness">
                <V4SectionTitle
                  icon={FilePlus2}
                  title="Controlled Sources"
                  headingLevel={3}
                  description="Freshness is relative to the selected Revision baseline. On-demand checks only."
                  action={
                    <button
                      type="button"
                      className="v4-intelligence__primary"
                      disabled={sourcePickerBusy || registerSource.isPending}
                      onClick={() => registerSource.mutate('OTHER')}
                    >
                      <FilePlus2 aria-hidden="true" /> Add Source
                    </button>
                  }
                />
                <div className="v4-intelligence__card-body">
                  {sourceFiles.length === 0 ? (
                    <V4StatePanel
                      compact
                      icon={FilePlus2}
                      title="No controlled sources"
                      message="Register governed Project source files (AutoCAD / DIALux / Excel) to prove freshness before Issue."
                    />
                  ) : (
                    <ul className="v4-intelligence__sources-list">
                      {sourceFiles.map((source) => {
                        const item: SourceFreshnessItem | undefined = freshnessItems.find(
                          (candidate) => candidate.source.id === source.id,
                        );
                        return (
                          <li key={source.id} className="v4-intelligence__source">
                            <div className="v4-intelligence__source-head">
                              <V4StatusPill
                                variant={sourceFreshnessVariant(item?.state ?? 'UNAVAILABLE')}
                              >
                                {sourceFreshnessLabel(item?.state ?? 'UNAVAILABLE')}
                              </V4StatusPill>
                              <strong>{source.displayName}</strong>
                            </div>
                            <div className="v4-intelligence__source-meta">
                              <span>{sourceTypeLabel(source.sourceType)}</span>
                              <span>{source.originalRelativeLocator}</span>
                              {item?.baseline ? (
                                <span>Baseline {formatDateTime(item.baseline.capturedAt)}</span>
                              ) : (
                                <span>No baseline for this Revision</span>
                              )}
                            </div>
                            <div className="v4-intelligence__source-ops">
                              <button
                                type="button"
                                className="v4-intelligence__secondary"
                                disabled={checkFreshness.isPending || !targetRevisionId}
                                onClick={() => checkFreshness.mutate(source)}
                              >
                                <RefreshCw aria-hidden="true" /> Check Freshness
                              </button>
                              <button
                                type="button"
                                className="v4-intelligence__secondary"
                                disabled={captureBaseline.isPending || !targetRevisionId}
                                onClick={() => captureBaseline.mutate(source)}
                              >
                                Capture Baseline
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            </div>

            {/* WORKFLOW GUIDANCE — explanatory UI only; no state machine behavior. */}
            <section className="v4-intelligence__workflow" aria-label="Workflow guidance">
              <h2 className="v4-intelligence__workflow-title">Workflow Guidance</h2>
              <div className="v4-intelligence__workflow-steps">
                <div className="v4-intelligence__wstep">
                  <span className="v4-intelligence__wcircle is-blue">
                    <ShieldCheck aria-hidden="true" />
                  </span>
                  <span className="v4-intelligence__wtext">
                    <strong>Resolve Blockers</strong>
                    <p>Address all blocker findings shown in the readiness panel.</p>
                  </span>
                </div>
                <div className="v4-intelligence__wstep">
                  <span className="v4-intelligence__wcircle is-amber">2</span>
                  <span className="v4-intelligence__wtext">
                    <strong>Review Impact</strong>
                    <p>Compare revisions and review impact on project deliverables.</p>
                  </span>
                </div>
                <div className="v4-intelligence__wstep">
                  <span className="v4-intelligence__wcircle is-green">3</span>
                  <span className="v4-intelligence__wtext">
                    <strong>Close Actions</strong>
                    <p>Complete blocking actions and link them to target Revision.</p>
                  </span>
                </div>
                <div className="v4-intelligence__wstep">
                  <span className="v4-intelligence__wcircle is-purple">4</span>
                  <span className="v4-intelligence__wtext">
                    <strong>Baseline Sources</strong>
                    <p>Capture baselines and ensure all sources are fresh.</p>
                  </span>
                </div>
                <div className="v4-intelligence__wstep">
                  <span className="v4-intelligence__wcircle is-green">
                    <Check aria-hidden="true" />
                  </span>
                  <span className="v4-intelligence__wtext">
                    <strong>Ready to Issue</strong>
                    <p>When no blockers remain, project will be ready to issue.</p>
                  </span>
                </div>
              </div>
            </section>
            <div className="v4-intelligence__bottom-note">
              <Lock aria-hidden="true" />
              All intelligence data is read from authoritative sources. No live file watching or
              auto-sync is performed.
            </div>
          </>
        )}
      </div>
    </V4AppShell>
  );
}
