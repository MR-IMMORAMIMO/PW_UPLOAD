import { SctPdf, SctFile, SctOpen } from '../../components/common/SctIcons';
import { FinalPackagesView } from '../../components/final-ui/FinalPackagesView';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  SctWarning as AlertCircle,
  SctWarning as AlertTriangle,
  SctSuccess as CheckCircle2,
  SctLive as CircleDot,
} from '../../components/common/SctIcons';
import {
  FileArchive,
  Info,
  Package,
  PackageCheck,
  RefreshCw,
  Eye,
} from '../../components/common/SctIcons';
import { ApiError } from '@scli/api-client';
import type {
  CanonicalOutputPresenceRecord,
  IssueHistoryRecord,
  IssueHistoryDeliverable,
  PackageVerificationResult,
  RevisionPackageItem,
  RevisionPackageOutputMode,
  RevisionPackageStatus,
} from '@scli/domain';
import { revisionPackageOutputModes } from '@scli/domain';
import { api } from '../../api/environment';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Button } from '../../components/common/V4Button';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4SplitPane } from '../../components/common/V4SplitPane';
import { V4RouteErrorState } from '../../components/common/V4RouteErrorState';
import { V4StatusPill, type V4StatusPillVariant } from '../../components/common/V4StatusPill';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import {
  buildCatalogOutputRows,
  deriveReadiness,
  eligiblePackageRevisions,
  historyForRevision,
  readErrorMessage,
  statusOutputFolder,
  type PackageArtifactState,
} from './packagesViewModel';

type OutputFilter = 'All' | PackageArtifactState;

interface CreatePackageBody {
  revisionNumber: number;
  label: string;
  status: RevisionPackageStatus;
  outputMode: RevisionPackageOutputMode;
  relativeOutputFolder: string;
  selectedItemIds: string[];
  warningOverrideReason: string;
  recoveryPackageId?: string;
}

interface RecoverableAttempt {
  packageId: string;
  body: CreatePackageBody;
}

const packageUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WARNING_REASON_ID = 'v4-package-warning-reason';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return (
    formatBusinessDateTime(value, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }) || '—'
  );
}

function formatBytes(value: number): string {
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function businessStatusVariant(businessStatus: 'Draft' | 'Issued'): V4StatusPillVariant {
  return businessStatus === 'Issued' ? 'success' : 'neutral';
}

function lifecycleVariant(lifecycle: string): V4StatusPillVariant {
  if (lifecycle === 'FINALIZED') return 'success';
  if (lifecycle === 'FAILED_RECOVERABLE') return 'danger';
  if (lifecycle === 'LEGACY_IMPORTED') return 'warning';
  return 'neutral';
}

function verificationVariant(status: string): V4StatusPillVariant {
  if (status === 'VERIFIED') return 'success';
  if (status === 'MISMATCH') return 'danger';
  if (status === 'MISSING') return 'danger';
  return 'warning';
}

function artifactVariant(state: PackageArtifactState): V4StatusPillVariant {
  if (state === 'Present') return 'success';
  return state === 'Missing' ? 'danger' : 'warning';
}

interface DeliverablePresentation {
  name: string;
  verificationLabel: string;
  format: string | null;
  technicalType: IssueHistoryDeliverable['sourceType'];
}

function outputFamilyName(family: string | null | undefined): string {
  if (family === 'LuminaireSchedule') return 'Luminaire Schedule';
  if (family === 'PresentationSchedule') return 'Presentation Schedule';
  if (family === 'TechnicalBoq') return 'Technical BOQ';
  return 'Canonical Output';
}

function fileNameFormat(fileName: string | null | undefined): string | null {
  const match = fileName?.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function deliverablePresentation(
  deliverable: IssueHistoryDeliverable,
  outputs: readonly CanonicalOutputPresenceRecord[],
  catalogItems: readonly RevisionPackageItem[],
): DeliverablePresentation {
  const deliverableId =
    deliverable.sourceType === 'DocumentSnapshot'
      ? deliverable.deliverableId
      : deliverable.outputId;
  const catalogItem = catalogItems.find((item) => item.id === deliverableId);

  if (deliverable.sourceType === 'DocumentSnapshot') {
    const name = catalogItem?.datasheet
      ? `${catalogItem.datasheet.tag} Datasheet`
      : (catalogItem?.label ?? deliverable.title);
    return {
      name,
      verificationLabel: name,
      format: fileNameFormat(catalogItem?.fileName),
      technicalType: deliverable.sourceType,
    };
  }

  const output = outputs.find((item) => item.outputId === deliverable.outputId);
  const name = outputFamilyName(output?.outputFamily);
  const format = output?.outputFormat ?? null;
  return {
    name,
    verificationLabel: catalogItem?.label ?? [name, format].filter(Boolean).join(' '),
    format,
    technicalType: deliverable.sourceType,
  };
}

function recoverablePackageId(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const value = error.details?.packageId;
  return typeof value === 'string' && packageUuid.test(value) ? value : null;
}

export function ProjectPackagesWorkspace({ finalView = false }: { finalView?: boolean }) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    readStoredSidebarMode(window.localStorage),
  );
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [outputMode, setOutputMode] = useState<RevisionPackageOutputMode>('Folder');
  const [relativeOutputFolder, setRelativeOutputFolder] = useState('');
  const [warningOverrideReason, setWarningOverrideReason] = useState('');
  const [artifactFilter, setArtifactFilter] = useState<OutputFilter>('All');
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [recoverableAttempt, setRecoverableAttempt] = useState<RecoverableAttempt | null>(null);
  // PACKAGES-E2E-04B — track whether the Owner has explicitly edited the output
  // folder. An untouched (auto-derived) folder is status-aware: Draft -> DRAFT,
  // Issued -> ISSUED. An explicit edit is always honoured verbatim.
  const [outputFolderEdited, setOutputFolderEdited] = useState(false);
  // PACKAGES-E2E-04B1 — the status the Owner is preparing drives the DISPLAYED
  // auto-derived default, so the folder shown always matches the folder that
  // will actually be sent (never display ISSUED while sending DRAFT).
  const [pendingStatus, setPendingStatus] = useState<RevisionPackageStatus>('Draft');
  const [packagePreviewOpen, setPackagePreviewOpen] = useState(false);
  const projectQuery = useQuery({
    queryKey: ['v4', 'packages', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
  });
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'packages', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: Boolean(projectId),
  });
  const revisionsQuery = useQuery({
    queryKey: ['v4', 'packages', 'revisions', projectId],
    queryFn: () => api.packageRevisions(projectId as string),
    enabled: Boolean(projectId),
  });
  const outputsQuery = useQuery({
    queryKey: ['v4', 'packages', 'outputs', projectId],
    queryFn: () => api.projectOutputs(projectId as string),
    enabled: Boolean(projectId),
  });
  const catalogQuery = useQuery({
    queryKey: ['v4', 'packages', 'catalog', projectId, ...(finalView ? [selectedRevisionId] : [])],
    queryFn: () =>
      api.revisionPackageCatalog(
        projectId as string,
        finalView ? (selectedRevisionId ?? undefined) : undefined,
      ),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  });
  const historyQuery = useQuery({
    queryKey: ['v4', 'packages', 'issue-history', projectId],
    queryFn: () => api.issueHistory(projectId as string),
    enabled: Boolean(projectId),
  });

  const project = projectQuery.data;
  const workspace = workspaceQuery.data ?? null;
  const catalog = catalogQuery.data ?? null;
  const issueHistory = historyQuery.data?.items ?? [];
  const eligibleRevisions = useMemo(
    () => eligiblePackageRevisions(revisionsQuery.data ?? []),
    [revisionsQuery.data],
  );
  const selectedRevision =
    eligibleRevisions.find((revision) => revision.revisionId === selectedRevisionId) ?? null;
  const catalogRevision = useMemo(() => {
    // C2 identity contract: catalog ownership binds ONLY on the canonical
    // Revision UUID. When the catalog carries no canonical revisionId there is
    // NO canonical target — never fall back to the display sequence (that is
    // the identity inference C2 exists to eliminate, and it would risk an
    // accidental REV_01 binding).
    if (!catalog || !catalog.revisionId) return null;
    return eligibleRevisions.find((revision) => revision.revisionId === catalog.revisionId) ?? null;
  }, [catalog, eligibleRevisions]);
  const catalogOwnsSelectedRevision = Boolean(
    selectedRevision && catalogRevision?.revisionId === selectedRevision.revisionId,
  );
  const outputRows = useMemo(
    () =>
      catalogOwnsSelectedRevision ? buildCatalogOutputRows(catalog, outputsQuery.data ?? []) : [],
    [catalog, catalogOwnsSelectedRevision, outputsQuery.data],
  );
  const visibleOutputRows = useMemo(
    () =>
      artifactFilter === 'All'
        ? outputRows
        : outputRows.filter((row) => row.artifactState === artifactFilter),
    [artifactFilter, outputRows],
  );
  const selectedRows = outputRows.filter((row) => selectedItemIds.has(row.id) && row.available);
  const revisionHistory = useMemo(
    () => historyForRevision(issueHistory, selectedRevision?.revisionId ?? null),
    [issueHistory, selectedRevision],
  );
  const selectedHistoryRecord = useMemo(
    () => revisionHistory.find((record) => record.package.packageId === selectedPackageId) ?? null,
    [revisionHistory, selectedPackageId],
  );
  const readiness = deriveReadiness({
    catalog,
    workspace,
    selectedRevision,
    catalogOwnsSelectedRevision,
    outputRows,
    selectedRows,
    relativeOutputFolder,
  });
  const warningCount =
    readiness.warnings.length +
    (readiness.outdatedOutputCount > 0 ? 1 : 0) +
    (readiness.deselectedDatasheetCount > 0 ? 1 : 0);
  const issueBlocked = readiness.hardGuards.length > 0 || readiness.blocking.length > 0;
  const draftBlocked = readiness.hardGuards.length > 0;
  const loading = [
    projectQuery,
    workspaceQuery,
    revisionsQuery,
    outputsQuery,
    catalogQuery,
    historyQuery,
  ].some((query) => query.isLoading);
  const readError = [
    projectQuery,
    workspaceQuery,
    revisionsQuery,
    outputsQuery,
    catalogQuery,
    historyQuery,
  ].some((query) => query.isError);
  const retrying = [
    projectQuery,
    workspaceQuery,
    revisionsQuery,
    outputsQuery,
    catalogQuery,
    historyQuery,
  ].some((query) => query.isFetching);

  useEffect(() => {
    if (!selectedRevisionId && catalogRevision) setSelectedRevisionId(catalogRevision.revisionId);
  }, [catalogRevision, selectedRevisionId]);

  useEffect(() => {
    if (!catalogOwnsSelectedRevision) {
      setSelectedItemIds(new Set());
      setRelativeOutputFolder('');
      setOutputFolderEdited(false);
      return;
    }

    // PACKAGES-E2E-04B — derive a truthful status-aware default. The displayed
    // default points to the status root. An explicit Owner edit is never
    // overwritten on a re-render.
    if (!outputFolderEdited) {
      setRelativeOutputFolder(
        statusOutputFolder({
          status: pendingStatus,
          suggestedOutputFolder: catalog?.suggestedOutputFolder ?? '',
          revisionSequence: selectedRevision?.revisionSequence ?? 0,
        }),
      );
    }
  }, [
    catalog?.suggestedOutputFolder,
    catalogOwnsSelectedRevision,
    selectedRevisionId,
    outputFolderEdited,
    selectedRevision?.revisionSequence,
    pendingStatus,
  ]);

  useEffect(() => {
    if (catalogOwnsSelectedRevision)
      setSelectedItemIds(new Set(outputRows.filter((row) => row.available).map((row) => row.id)));
  }, [catalogOwnsSelectedRevision, selectedRevisionId]);

  const createMutation = useMutation({
    mutationFn: (body: CreatePackageBody) => api.createRevisionPackage(projectId as string, body),
    onSuccess: async (record) => {
      setSelectedPackageId(record.id);
      setRecoverableAttempt(null);
      setOperationError(null);
      setOperationMessage(
        record.status === 'Issued'
          ? 'Issue Package recorded successfully.'
          : 'Draft package created successfully. It has not been issued.',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v4', 'packages', 'workspace', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v4', 'packages', 'catalog', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v4', 'packages', 'revisions', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v4', 'packages', 'outputs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['v4', 'packages', 'issue-history', projectId] }),
      ]);
    },
    onError: (error, body) => {
      const packageId = recoverablePackageId(error);
      setOperationMessage(null);
      setOperationError(readErrorMessage(error));
      setRecoverableAttempt(packageId ? { packageId, body } : null);
    },
  });

  const buildCreateBody = (status: RevisionPackageStatus): CreatePackageBody | null => {
    if (!selectedRevision) return null;
    // PACKAGES-E2E-04B — when the folder is the untouched auto-derived default,
    // honour the actual business status so a Draft never materializes under
    // ISSUED and an Issued package never under DRAFT. An explicit Owner edit is
    // always honoured verbatim.
    const folder = outputFolderEdited
      ? relativeOutputFolder.trim()
      : statusOutputFolder({
          status,
          suggestedOutputFolder: catalog?.suggestedOutputFolder ?? relativeOutputFolder,
          revisionSequence: selectedRevision.revisionSequence,
        });
    return {
      revisionNumber: selectedRevision.revisionSequence,
      label: label.trim(),
      status,
      outputMode,
      relativeOutputFolder: folder,
      selectedItemIds: selectedRows.map((row) => row.id),
      warningOverrideReason: status === 'Issued' ? warningOverrideReason.trim() : '',
    };
  };

  const createPackage = (status: RevisionPackageStatus) => {
    setOperationError(null);
    setOperationMessage(null);
    setSelectedPackageId(null);
    // PACKAGES-E2E-04B1 — the status the Owner is preparing drives the
    // DISPLAYED auto-derived default, so the folder shown always matches the
    // folder that will actually be sent.
    setPendingStatus(status);
    if (!label.trim()) {
      setOperationError('Enter a package label.');
      return;
    }
    if (status === 'Issued' && warningCount > 0 && !warningOverrideReason.trim()) {
      setOperationError('Explain why the package may be issued with warnings.');
      document.getElementById(WARNING_REASON_ID)?.focus();
      return;
    }
    const body = buildCreateBody(status);
    if (!body || (status === 'Issued' ? issueBlocked : draftBlocked)) return;
    createMutation.mutate(body);
  };

  const retryPackageCreation = () => {
    if (!recoverableAttempt || createMutation.isPending) return;
    setOperationError(null);
    createMutation.mutate({
      ...recoverableAttempt.body,
      recoveryPackageId: recoverableAttempt.packageId,
    });
  };

  const verifyMutation = useMutation({
    mutationFn: (packageId: string) => api.verifyIssuePackage(projectId as string, packageId),
    onError: (error) => {
      setOperationError(readErrorMessage(error));
    },
  });

  // Reset any live verification result when the selected package changes so a
  // stale result from a different package is never shown.
  useEffect(() => {
    verifyMutation.reset();
  }, [selectedPackageId]);

  const handleRevisionChange = (revisionId: string) => {
    setSelectedRevisionId(revisionId);
    setSelectedPackageId(null);
    setRecoverableAttempt(null);
    setOperationError(null);
    setOperationMessage(null);
    setOutputFolderEdited(false);
  };

  const handleOutputFolderChange = (value: string) => {
    setOutputFolderEdited(true);
    setRelativeOutputFolder(value);
  };

  const startReissue = (record: IssueHistoryRecord) => {
    const revision = eligibleRevisions.find(
      (candidate) => candidate.revisionId === record.revision.revisionId,
    );
    if (!revision || record.package.businessStatus !== 'Issued') return;
    setOutputFolderEdited(false);
    setPendingStatus('Issued');
    setSelectedRevisionId(revision.revisionId);
    setSelectedPackageId(null);
    setLabel('');
    setWarningOverrideReason('');
    setOperationError(null);
    setOperationMessage(
      'Started a new package build for the same Revision. Identity remains server-owned.',
    );
  };

  const savedSettings = workspace?.revisionPackages.find((item) => item.id === selectedPackageId);
  const packageFile = async (packageId: string, memberId?: string, name = 'Package file') => {
    if (!projectId) return;
    setOperationError(null);
    try {
      if (memberId) {
        if (!window.scliDesktop?.executeDesktopHandoff)
          throw new Error('Open this saved package file in the desktop app.');
        const handoff = await api.packageFileHandoff(projectId, packageId, memberId);
        await window.scliDesktop.executeDesktopHandoff(handoff.handoffId, handoff.action);
        return;
      }
      const blob = await api.packageFile(projectId, packageId);
      const url = URL.createObjectURL(blob);
      {
        const link = document.createElement('a');
        link.href = url;
        link.download = name.replace(/[<>:"/\\|?*]/g, '_') + '.zip';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (error) {
      setOperationError(readErrorMessage(error));
    }
  };
  const openRevisionFile = async (id: string) => {
    if (!projectId || !selectedRevision) return;
    try {
      const output = outputsQuery.data?.find((item) => item.outputId === id);
      if (output) {
        if (!output.artifactOpenPath || !window.scliDesktop?.openPath)
          throw new Error('This generated file is unavailable for opening.');
        await window.scliDesktop.openPath(output.artifactOpenPath);
      } else {
        if (!window.scliDesktop?.executeDesktopHandoff)
          throw new Error('Open this Revision file in the desktop app.');
        const handoff = await api.revisionSnapshotFileHandoff(
          projectId,
          selectedRevision.revisionId,
          id,
        );
        await window.scliDesktop.executeDesktopHandoff(handoff.handoffId, handoff.action);
      }
    } catch (error) {
      setOperationError(readErrorMessage(error));
    }
  };
  const previewRows = selectedHistoryRecord
    ? selectedHistoryRecord.deliverables.map((item) => {
        const id = item.sourceType === 'DocumentSnapshot' ? item.deliverableId : item.outputId;
        const presentation = deliverablePresentation(
          item,
          outputsQuery.data ?? [],
          catalog?.items ?? [],
        );
        return {
          id,
          label: presentation.name,
          format:
            presentation.format ??
            (item.sourceType === 'DocumentSnapshot' ? fileNameFormat(item.locator) : null) ??
            'File',
          size:
            item.sourceType === 'DocumentSnapshot'
              ? item.sizeBytes
              : (catalog?.items.find((row) => row.id === id)?.sizeBytes ?? 0),
        };
      })
    : selectedRows.map((row) => ({
        id: row.id,
        label: row.label,
        format: row.format,
        size: catalog?.items.find((item) => item.id === row.id)?.sizeBytes ?? 0,
      }));
  const selectSaved = (id: string) => {
    const record = issueHistory.find((item) => item.package.packageId === id);
    if (!record) return;
    handleRevisionChange(record.revision.revisionId);
    setSelectedPackageId(id);
    setBuilderOpen(true);
  };
  const feedback = (
    <>
      {operationError ? <p role="alert">{operationError}</p> : null}
      {operationMessage ? <p role="status">{operationMessage}</p> : null}
    </>
  );
  const builderFooter = (
    <>
      {feedback}
      <div className="v4-output-preview__footer-actions">
        <V4Button onClick={() => setBuilderOpen(false)}>Close</V4Button>
        {!selectedHistoryRecord ? (
          <>
            <V4Button
              disabled={draftBlocked || createMutation.isPending}
              onClick={() => createPackage('Draft')}
            >
              Create Draft
            </V4Button>
            <V4Button
              variant="primary"
              disabled={issueBlocked || createMutation.isPending}
              onClick={() => createPackage('Issued')}
            >
              Issue Package
            </V4Button>
          </>
        ) : (
          <V4Button onClick={() => setPackagePreviewOpen(true)}>Preview Contents</V4Button>
        )}
      </div>
    </>
  );

  const beginBuild = (status: RevisionPackageStatus) => {
    if (selectedHistoryRecord) {
      setLabel(selectedHistoryRecord.package.label);
      setSelectedItemIds(
        new Set(
          selectedHistoryRecord.deliverables.map((item) =>
            item.sourceType === 'DocumentSnapshot' ? item.deliverableId : item.outputId,
          ),
        ),
      );
      if (savedSettings) setOutputMode(savedSettings.outputMode);
    }
    setSelectedPackageId(null);
    setOutputFolderEdited(false);
    setPendingStatus(status);
    setBuilderOpen(true);
  };

  const toggleSidebar = () => {
    setSidebarMode((current) => {
      const next = current === 'extended' ? 'minimal' : 'extended';
      writeStoredSidebarMode(window.localStorage, next);
      return next;
    });
  };

  const packageBuilder = (
    <V4SplitPane
      initialRatio={75}
      label="Resize package builder and inspector"
      collapsed={false}
      timeline={
        <div className="v4-packages__builder">
          <section className="v4-packages__card" aria-labelledby="packages-revision-heading">
            <div className="v4-packages__section-heading">
              <div>
                <span className="v4-packages__step">01</span>
                <h2 id="packages-revision-heading">Finalized Revision</h2>
              </div>
              {selectedRevision ? <V4StatusPill variant="success">FINALIZED</V4StatusPill> : null}
            </div>
            {eligibleRevisions.length === 0 ? (
              <EmptyState
                title="No finalized Revision is available"
                detail="Finalize a canonical Revision with an eligible Deliverable before building a package."
              />
            ) : (
              <div className="v4-packages__revision-grid">
                <label>
                  <span>Revision</span>
                  <select
                    aria-label="Finalized Revision"
                    value={selectedRevisionId ?? ''}
                    onChange={(event) => handleRevisionChange(event.target.value)}
                  >
                    {eligibleRevisions.map((revision) => (
                      <option key={revision.revisionId} value={revision.revisionId}>
                        {revision.revisionLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <RevisionFact
                  label="Finalized"
                  value={formatDate(selectedRevision?.finalizedAt ?? null)}
                />
                <RevisionFact
                  label="Luminaire snapshot"
                  value={String(selectedRevision?.luminaireCount ?? 0)}
                />
                <RevisionFact label="Purpose" value={selectedRevision?.purpose ?? 'Not added'} />
                <RevisionFact label="Packages" value={String(revisionHistory.length)} />
              </div>
            )}
            {selectedRevision && !catalogOwnsSelectedRevision ? (
              <div className="v4-packages__authority-gap" role="note">
                <Info size={15} />
                <span>
                  This Revision is finalized, but the current package catalog only exposes Rev{' '}
                  {catalog?.suggestedRevision ?? '—'}. Creation is blocked rather than guessing
                  package contents or folder identity.
                </span>
              </div>
            ) : null}
          </section>

          <section
            className="v4-packages__card v4-packages__outputs"
            aria-labelledby="packages-outputs-heading"
          >
            <div className="v4-packages__section-heading v4-packages__section-heading--outputs">
              <div>
                <span className="v4-packages__step">02</span>
                <h2 id="packages-outputs-heading">Eligible Deliverables</h2>
              </div>
              <div className="v4-packages__table-actions">
                <label>
                  <span className="v4-visually-hidden">Artifact presence</span>
                  <select
                    value={artifactFilter}
                    onChange={(event) => setArtifactFilter(event.target.value as OutputFilter)}
                  >
                    <option value="All">All artifacts</option>
                    <option value="Present">Present</option>
                    <option value="Not generated">Not generated</option>
                    <option value="Missing">Missing</option>
                    <option value="Unavailable">Unavailable</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedItemIds(
                      new Set(outputRows.filter((row) => row.available).map((row) => row.id)),
                    )
                  }
                  disabled={!outputRows.some((row) => row.available)}
                >
                  Select available
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedItemIds(new Set())}
                  disabled={selectedItemIds.size === 0}
                >
                  Clear
                </button>
              </div>
            </div>
            {!selectedRevision ? (
              <EmptyState
                title="Select a finalized Revision"
                detail="Package-eligible Deliverables will appear here."
              />
            ) : !catalogOwnsSelectedRevision ? (
              <EmptyState
                title="Catalog unavailable for this Revision"
                detail="No package contents can be selected without server catalog authority."
              />
            ) : outputRows.length === 0 ? (
              <EmptyState
                title="No eligible Deliverables"
                detail="This finalized Revision has no canonical Deliverables supported by the package renderer."
              />
            ) : (
              <div className="v4-packages__table-scroll">
                <table className="v4-packages__table">
                  <thead>
                    <tr>
                      <th scope="col">Include</th>
                      <th scope="col">Deliverable</th>
                      <th scope="col">Family</th>
                      <th scope="col">Format</th>
                      <th scope="col">Artifact</th>
                      <th scope="col">Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOutputRows.map((row) => (
                      <tr key={row.id} data-selected={selectedItemIds.has(row.id) || undefined}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Include ${row.label}`}
                            checked={selectedItemIds.has(row.id)}
                            disabled={!row.available}
                            onChange={(event) => {
                              setSelectedItemIds((current) => {
                                const next = new Set(current);
                                if (event.target.checked && row.available) next.add(row.id);
                                else next.delete(row.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td>
                          <strong>{row.label}</strong>
                          <span>{row.fileName || row.note || 'No canonical artifact'}</span>
                          {row.datasheet ? (
                            <span className="v4-packages__datasheet-meta">
                              {row.datasheet.tag} · {row.datasheet.manufacturer} ·{' '}
                              {row.datasheet.model}
                            </span>
                          ) : null}
                        </td>
                        <td>{row.family}</td>
                        <td>{row.format}</td>
                        <td>
                          <V4StatusPill variant={artifactVariant(row.artifactState)}>
                            {row.artifactState}
                          </V4StatusPill>
                        </td>
                        <td>{formatDate(row.modifiedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section
            className="v4-packages__card v4-packages__history"
            aria-labelledby="packages-context-heading"
          >
            <div className="v4-packages__section-heading">
              <div>
                <span className="v4-packages__step">03</span>
                <h2 id="packages-context-heading">Packages for this Revision</h2>
              </div>
              <span>{revisionHistory.length} record(s)</span>
            </div>
            {revisionHistory.length === 0 ? (
              <EmptyState
                title="No package records"
                detail="This selected Revision has not been packaged yet."
              />
            ) : (
              <div className="v4-packages__table-scroll">
                <table className="v4-packages__table">
                  <thead>
                    <tr>
                      <th scope="col">Package</th>
                      <th scope="col">Business Status</th>
                      <th scope="col">Lifecycle</th>
                      <th scope="col">Issued By</th>
                      <th scope="col">Issued At</th>
                      <th scope="col">Deliverables</th>
                      <th scope="col">
                        <span className="v4-visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {revisionHistory.map((record) => (
                      <tr
                        key={record.package.packageId}
                        tabIndex={0}
                        data-selected={
                          selectedHistoryRecord?.package.packageId === record.package.packageId ||
                          undefined
                        }
                        onClick={() => setSelectedPackageId(record.package.packageId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedPackageId(record.package.packageId);
                          }
                        }}
                      >
                        <td>
                          <strong>{record.package.label}</strong>
                          <span>Pkg {record.package.packageSequence}</span>
                        </td>
                        <td>
                          <V4StatusPill
                            variant={businessStatusVariant(record.package.businessStatus)}
                          >
                            {record.package.businessStatus}
                          </V4StatusPill>
                        </td>
                        <td>
                          <V4StatusPill variant={lifecycleVariant(record.package.lifecycleState)}>
                            {record.package.lifecycleState}
                          </V4StatusPill>
                        </td>
                        <td>{record.package.issuedBy?.actorNameSnapshot ?? 'Not issued'}</td>
                        <td>{formatDate(record.package.issuedAt)}</td>
                        <td>{record.deliverables.length}</td>
                        <td>
                          <button
                            type="button"
                            className="v4-packages__text-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              startReissue(record);
                            }}
                          >
                            Start Reissue
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      }
      inspector={
        selectedHistoryRecord ? (
          <PackageInspector
            key={selectedHistoryRecord.package.packageId}
            record={selectedHistoryRecord}
            outputs={outputsQuery.data ?? []}
            catalogItems={catalogOwnsSelectedRevision ? (catalog?.items ?? []) : []}
            onBack={() => setSelectedPackageId(null)}
            onOpen={(item) =>
              void packageFile(
                selectedHistoryRecord.package.packageId,
                item.sourceType === 'DocumentSnapshot' ? item.deliverableId : item.outputId,
                deliverablePresentation(item, outputsQuery.data ?? [], catalog?.items ?? []).name,
              )
            }
            onReissue={() => startReissue(selectedHistoryRecord)}
            verifyPending={verifyMutation.isPending}
            verifyResult={verifyMutation.data ?? null}
            onVerify={() => verifyMutation.mutate(selectedHistoryRecord.package.packageId)}
          />
        ) : (
          <BuilderInspector
            hideActions={finalView}
            label={label}
            setLabel={setLabel}
            outputMode={outputMode}
            setOutputMode={setOutputMode}
            relativeOutputFolder={relativeOutputFolder}
            setRelativeOutputFolder={handleOutputFolderChange}
            warningCount={warningCount}
            warningOverrideReason={warningOverrideReason}
            setWarningOverrideReason={setWarningOverrideReason}
            readiness={readiness}
            selectedCount={selectedRows.length}
            pending={createMutation.isPending}
            draftBlocked={draftBlocked}
            issueBlocked={issueBlocked}
            onDraft={() => createPackage('Draft')}
            onIssue={() => createPackage('Issued')}
          />
        )
      }
    />
  );

  return (
    <V4AppShell
      context="project"
      sidebarMode={sidebarMode}
      onToggleSidebarMode={toggleSidebar}
      activeSectionId="packages"
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
              projectQueryKey={['v4', 'packages', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        finalView ? undefined : (
          <V4PageHeader
            title="Packages"
            description="Build, validate, and record immutable Issue Packages from finalized project revisions."
            icon={PackageCheck}
            actions={
              <div className="v4-packages__header-actions">
                <button
                  type="button"
                  className="v4-packages__button v4-packages__button--secondary"
                  disabled={!selectedRevision || loading}
                  onClick={() => setPackagePreviewOpen(true)}
                >
                  <Eye size={15} aria-hidden="true" />
                  Preview Package
                </button>
                <button
                  type="button"
                  className="v4-packages__button v4-packages__button--secondary"
                  disabled={draftBlocked || createMutation.isPending || loading}
                  onClick={() => createPackage('Draft')}
                >
                  <FileArchive size={15} aria-hidden="true" />
                  Create Draft
                </button>
                <button
                  type="button"
                  className="v4-packages__button v4-packages__button--primary"
                  disabled={issueBlocked || createMutation.isPending || loading}
                  onClick={() => createPackage('Issued')}
                >
                  <PackageCheck size={15} aria-hidden="true" />
                  Issue Package
                </button>
              </div>
            }
          />
        )
      }
      boundedPage
    >
      <main
        className={finalView ? 'final-ui-reference v4-bounded-page' : 'v4-packages v4-bounded-page'}
        data-testid="v4-project-packages"
      >
        {loading ? <PackagesLoading /> : null}
        {!loading && readError ? (
          <V4RouteErrorState
            title="Unable to load packages"
            message="Package authority could not be loaded. No package action is available."
            retrying={retrying}
            onRetry={() =>
              void Promise.all([
                projectQuery.refetch(),
                workspaceQuery.refetch(),
                revisionsQuery.refetch(),
                outputsQuery.refetch(),
                catalogQuery.refetch(),
                historyQuery.refetch(),
              ])
            }
          />
        ) : null}
        {operationError ? (
          <div className="v4-packages__alert v4-packages__alert--danger" role="alert">
            <AlertCircle size={16} />
            <span>{operationError}</span>
          </div>
        ) : null}
        {operationMessage ? (
          <div className="v4-packages__alert v4-packages__alert--success" role="status">
            <CheckCircle2 size={16} />
            <span>{operationMessage}</span>
          </div>
        ) : null}
        {recoverableAttempt ? (
          <div
            className="v4-packages__recovery"
            role="region"
            aria-label="Recover package creation"
          >
            <div>
              <strong>Package identity is recoverable</strong>
              <span>
                Retry finalization for the same package. This does not create a new Issue.
              </span>
            </div>
            <button
              type="button"
              onClick={retryPackageCreation}
              disabled={createMutation.isPending}
            >
              <RefreshCw size={14} /> Retry Package Creation
            </button>
          </div>
        ) : null}

        {!loading && !readError ? (
          <>
            {finalView ? (
              <FinalPackagesView
                revision={selectedRevision}
                history={issueHistory}
                selected={selectedHistoryRecord}
                label={label}
                readiness={readiness}
                warningCount={warningCount}
                included={selectedRows.length}
                size={formatBytes(
                  (catalog?.items ?? [])
                    .filter((item) => selectedRows.some((row) => row.id === item.id))
                    .reduce((sum, item) => sum + item.sizeBytes, 0),
                )}
                pending={createMutation.isPending}
                draftBlocked={draftBlocked}
                issueBlocked={issueBlocked}
                onBuilder={() => setBuilderOpen(true)}
                onPreview={() => setPackagePreviewOpen(true)}
                onReadiness={() => setReadinessOpen(true)}
                onSelect={selectSaved}
                onDownload={(id) =>
                  void packageFile(
                    id,
                    undefined,
                    issueHistory.find((item) => item.package.packageId === id)?.package.label ??
                      'Package',
                  )
                }
                onVerify={(id) => {
                  selectSaved(id);
                  verifyMutation.mutate(id);
                }}
                onReissueRecord={(id) => {
                  const record = issueHistory.find((item) => item.package.packageId === id);
                  if (record) {
                    startReissue(record);
                    setBuilderOpen(true);
                  }
                }}
                onDraft={() => {
                  beginBuild('Draft');
                }}
                onIssue={() => {
                  beginBuild('Issued');
                }}
                canRetry={Boolean(recoverableAttempt)}
                onRetry={retryPackageCreation}
                onReissue={() => {
                  if (selectedHistoryRecord) startReissue(selectedHistoryRecord);
                  setBuilderOpen(true);
                }}
              />
            ) : null}
            {!finalView ? (
              <section className="v4-packages__summary" aria-label="Package summary">
                <SummaryCard
                  label="Finalized Revisions"
                  value={String(eligibleRevisions.length)}
                  detail="With package-renderer Outputs"
                  icon={CircleDot}
                />
                <SummaryCard
                  label="Eligible Deliverables"
                  value={
                    catalogOwnsSelectedRevision
                      ? String(outputRows.filter((row) => row.available).length)
                      : '—'
                  }
                  detail="For the selected Revision"
                  icon={Package}
                />
                <SummaryCard
                  label="Existing Packages"
                  value={String(workspace?.revisionPackages.length ?? 0)}
                  detail="Real workspace records"
                  icon={FileArchive}
                />
                <SummaryCard
                  label="Readiness"
                  value={readiness.state}
                  detail={
                    readiness.state === 'Blocked'
                      ? `${readiness.hardGuards.length + readiness.blocking.length} blocking item(s)`
                      : warningCount > 0
                        ? `${warningCount} warning(s) to review`
                        : 'No blocking issues'
                  }
                  icon={
                    readiness.state === 'Blocked'
                      ? AlertCircle
                      : readiness.state === 'Warnings'
                        ? AlertTriangle
                        : CheckCircle2
                  }
                  tone={readiness.state.toLowerCase() as 'ready' | 'warnings' | 'blocked'}
                />
              </section>
            ) : null}

            {!finalView ? packageBuilder : null}
          </>
        ) : null}
      </main>
      {finalView ? (
        <V4FloatingWorkspace
          open={builderOpen}
          title="Package Builder"
          footer={builderFooter}
          description="Review the selected Revision, package contents and issue settings."
          onRequestClose={() => setBuilderOpen(false)}
        >
          <div className="v4-packages" style={{ height: '100%', minHeight: 0, overflow: 'auto' }}>
            {packageBuilder}
          </div>
        </V4FloatingWorkspace>
      ) : null}
      <V4FloatingWorkspace
        open={readinessOpen}
        title="Package Readiness"
        onRequestClose={() => setReadinessOpen(false)}
        footer={<V4Button onClick={() => setReadinessOpen(false)}>Close</V4Button>}
      >
        <ReadinessGroup
          label="Blocking"
          count={readiness.hardGuards.length + readiness.blocking.length}
          tone="blocking"
          items={[
            ...readiness.hardGuards,
            ...readiness.blocking.map((check) => `${check.label}: ${check.detail}`),
          ]}
        />
        <ReadinessGroup
          label="Warnings"
          count={warningCount}
          tone="warnings"
          items={[
            ...readiness.warnings.map((check) => `${check.label}: ${check.detail}`),
            ...(readiness.outdatedOutputCount
              ? [
                  `${readiness.outdatedOutputCount} selected outputs predate current luminaire edits.`,
                ]
              : []),
            ...(readiness.deselectedDatasheetCount
              ? [`${readiness.deselectedDatasheetCount} available datasheets are not selected.`]
              : []),
          ]}
        />
        <ReadinessGroup
          label="Info"
          count={readiness.info.length}
          tone="info"
          items={readiness.info.map((check) => `${check.label}: ${check.detail}`)}
        />
      </V4FloatingWorkspace>
      <V4FloatingWorkspace
        open={packagePreviewOpen}
        title="Issue Package Preview"
        description={
          (selectedHistoryRecord
            ? 'Saved package: ' + selectedHistoryRecord.package.label
            : 'New package: ' + (label || 'Untitled')) +
          ' · ' +
          (selectedRevision?.revisionLabel ?? '')
        }
        onRequestClose={() => setPackagePreviewOpen(false)}
        footer={
          <>
            {feedback}
            <span>
              {previewRows.length} files ·{' '}
              {formatBytes(previewRows.reduce((total, row) => total + row.size, 0))}
            </span>
            <div className="v4-output-preview__footer-actions">
              <V4Button onClick={() => setPackagePreviewOpen(false)}>Close</V4Button>
              {selectedHistoryRecord ? (
                <V4Button
                  onClick={() =>
                    void packageFile(
                      selectedHistoryRecord.package.packageId,
                      undefined,
                      selectedHistoryRecord.package.label,
                    )
                  }
                >
                  Download ZIP
                </V4Button>
              ) : (
                <>
                  <V4Button
                    disabled={draftBlocked || createMutation.isPending}
                    onClick={() => createPackage('Draft')}
                  >
                    Save Draft
                  </V4Button>
                  <V4Button
                    variant="primary"
                    disabled={issueBlocked || createMutation.isPending}
                    onClick={() => createPackage('Issued')}
                  >
                    Issue Package
                  </V4Button>
                </>
              )}
            </div>
          </>
        }
      >
        <div className="v4-package-preview">
          <section aria-label="Package contents">
            <header>
              <strong>Contents</strong>
              <span>{selectedRevision?.revisionLabel}</span>
            </header>
            <ol>
              {previewRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="v4-packages__text-button"
                    aria-label={'Open ' + row.label}
                    onClick={() =>
                      selectedHistoryRecord
                        ? void packageFile(
                            selectedHistoryRecord.package.packageId,
                            row.id,
                            row.label,
                          )
                        : void openRevisionFile(row.id)
                    }
                  >
                    {row.format.toUpperCase().includes('PDF') ? (
                      <SctPdf style={{ color: 'var(--v4-danger)' }} />
                    ) : (
                      <SctFile />
                    )}
                    <span>
                      <strong>{row.label}</strong>
                      <small>
                        {row.format} · {formatBytes(row.size)}
                      </small>
                    </span>
                    <SctOpen />
                  </button>
                </li>
              ))}
            </ol>
            {!previewRows.length ? <p>No files selected.</p> : null}
          </section>
          <aside>
            <h3>Package details</h3>
            <dl>
              <div>
                <dt>Label</dt>
                <dd>{selectedHistoryRecord?.package.label ?? (label || 'Required')}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selectedHistoryRecord?.package.businessStatus ?? pendingStatus}</dd>
              </div>
              <div>
                <dt>Output mode</dt>
                <dd>
                  {selectedHistoryRecord
                    ? (savedSettings?.outputMode ?? 'Not available')
                    : outputMode}
                </dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>
                  {selectedHistoryRecord
                    ? savedSettings?.zipPath || savedSettings?.folderPath || 'Not available'
                    : relativeOutputFolder}
                </dd>
              </div>
            </dl>
            {selectedHistoryRecord ? (
              <p>This saved package preserves the files and issue status recorded at creation.</p>
            ) : (
              <>
                <label>
                  Label
                  <input value={label} onChange={(event) => setLabel(event.target.value)} />
                </label>
                {warningCount ? (
                  <label>
                    Reason for issuing with warnings
                    <textarea
                      value={warningOverrideReason}
                      onChange={(event) => setWarningOverrideReason(event.target.value)}
                    />
                  </label>
                ) : null}
                <details open={issueBlocked}>
                  <summary>Readiness · {readiness.state}</summary>
                  <ReadinessGroup
                    label="Blocking"
                    count={readiness.hardGuards.length + readiness.blocking.length}
                    tone="blocking"
                    items={[
                      ...readiness.hardGuards,
                      ...readiness.blocking.map((item) => item.detail),
                    ]}
                  />
                  <ReadinessGroup
                    label="Warnings"
                    count={warningCount}
                    tone="warnings"
                    items={[
                      ...readiness.warnings.map((item) => item.detail),
                      ...(readiness.outdatedOutputCount
                        ? [readiness.outdatedOutputCount + ' older outputs selected.']
                        : []),
                      ...(readiness.deselectedDatasheetCount
                        ? [readiness.deselectedDatasheetCount + ' available datasheets excluded.']
                        : []),
                    ]}
                  />
                </details>
              </>
            )}
          </aside>
        </div>
      </V4FloatingWorkspace>
    </V4AppShell>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'ready',
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Package;
  tone?: 'ready' | 'warnings' | 'blocked';
}) {
  return (
    <article className="v4-packages__summary-card" data-tone={tone}>
      <span className="v4-packages__summary-icon">
        <Icon size={18} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function RevisionFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="v4-packages__revision-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="v4-packages__empty">
      <Package size={24} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function PackagesLoading() {
  return (
    <div className="v4-packages__loading" aria-label="Loading Packages">
      <span />
      <span />
      <span />
    </div>
  );
}

function BuilderInspector(props: {
  hideActions?: boolean;
  label: string;
  setLabel: (value: string) => void;
  outputMode: RevisionPackageOutputMode;
  setOutputMode: (value: RevisionPackageOutputMode) => void;
  relativeOutputFolder: string;
  setRelativeOutputFolder: (value: string) => void;
  warningCount: number;
  warningOverrideReason: string;
  setWarningOverrideReason: (value: string) => void;
  readiness: ReturnType<typeof deriveReadiness>;
  selectedCount: number;
  pending: boolean;
  draftBlocked: boolean;
  issueBlocked: boolean;
  onDraft: () => void;
  onIssue: () => void;
}) {
  return (
    <aside className="v4-packages__inspector" aria-label="Package builder inspector">
      <section>
        <div className="v4-packages__inspector-heading">
          <Package size={16} />
          <h2>Package Setup</h2>
        </div>
        <label htmlFor="v4-package-label">
          <span>Label</span>
        </label>
        <input
          id="v4-package-label"
          value={props.label}
          maxLength={120}
          onChange={(event) => props.setLabel(event.target.value)}
          placeholder="Package label"
        />
        <label htmlFor="v4-package-output-mode">
          <span>Output Mode</span>
        </label>
        <select
          id="v4-package-output-mode"
          aria-describedby="v4-package-output-mode-help"
          value={props.outputMode}
          onChange={(event) => props.setOutputMode(event.target.value as RevisionPackageOutputMode)}
        >
          {revisionPackageOutputModes.map((mode) => (
            <option key={mode}>{mode}</option>
          ))}
        </select>
        <small id="v4-package-output-mode-help">
          Folder, ZIP, or both. “Both” is not a transactional delivery claim.
        </small>
        <label htmlFor="v4-package-folder">
          <span>Relative Output Folder</span>
        </label>
        <input
          id="v4-package-folder"
          aria-describedby="v4-package-folder-help"
          value={props.relativeOutputFolder}
          onChange={(event) => props.setRelativeOutputFolder(event.target.value)}
          placeholder="Project-relative folder"
        />
        <small id="v4-package-folder-help">Resolved within the connected project folder.</small>
      </section>
      <section>
        <div className="v4-packages__inspector-heading">
          <PackageCheck size={16} />
          <h2>Package Readiness</h2>
        </div>
        <ReadinessGroup
          label="Blocking"
          count={props.readiness.blocking.length + props.readiness.hardGuards.length}
          tone="blocking"
          items={[
            ...props.readiness.hardGuards,
            ...props.readiness.blocking.map((check) => `${check.label}: ${check.detail}`),
          ]}
        />
        <ReadinessGroup
          label="Warnings"
          count={props.warningCount}
          tone="warnings"
          items={[
            ...props.readiness.warnings.map((check) => `${check.label}: ${check.detail}`),
            ...(props.readiness.outdatedOutputCount > 0
              ? [
                  `${props.readiness.outdatedOutputCount} selected Output(s) predate current Luminaire edits.`,
                ]
              : []),
            ...(props.readiness.deselectedDatasheetCount > 0
              ? [
                  `${props.readiness.deselectedDatasheetCount} available Datasheet(s) are not selected and will be omitted from this Package.`,
                ]
              : []),
          ]}
        />
        <ReadinessGroup
          label="Info"
          count={props.readiness.info.length}
          tone="info"
          items={props.readiness.info.map((check) => `${check.label}: ${check.detail}`)}
        />
        <div className="v4-packages__selected-count">
          <strong>{props.selectedCount}</strong>
          <span>Deliverables selected</span>
        </div>
      </section>
      {props.warningCount > 0 ? (
        <section>
          <div className="v4-packages__inspector-heading">
            <AlertTriangle size={16} />
            <h2>Warning Override</h2>
          </div>
          <label htmlFor={WARNING_REASON_ID}>
            <span>Warning Override Reason</span>
          </label>
          <textarea
            id={WARNING_REASON_ID}
            aria-describedby="v4-package-warning-reason-help"
            value={props.warningOverrideReason}
            maxLength={2000}
            onChange={(event) => props.setWarningOverrideReason(event.target.value)}
            aria-required="true"
          />
          <small id="v4-package-warning-reason-help">
            Required only when recording an Issue Package with warnings.
          </small>
        </section>
      ) : null}
      <section className="v4-packages__audit-note">
        <Info size={16} />
        <div>
          <strong>Issue Audit is server-owned</strong>
          <span>
            Drafts remain not issued. Issued By and Issued At are derived by the server and cannot
            be edited here.
          </span>
        </div>
      </section>
      <section className="v4-packages__inspector-actions" hidden={props.hideActions}>
        <button
          type="button"
          className="v4-packages__button v4-packages__button--primary"
          disabled={props.issueBlocked || props.pending}
          onClick={props.onIssue}
        >
          Issue Package
        </button>
        <button
          type="button"
          className="v4-packages__button v4-packages__button--secondary"
          disabled={props.draftBlocked || props.pending}
          onClick={props.onDraft}
        >
          Create Draft
        </button>
      </section>
    </aside>
  );
}

function ReadinessGroup({
  label,
  count,
  tone,
  items,
}: {
  label: string;
  count: number;
  tone: string;
  items: string[];
}) {
  return (
    <div className="v4-packages__readiness-group" data-tone={tone}>
      <div>
        <strong>{label}</strong>
        <span>{count}</span>
      </div>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>None</p>
      )}
    </div>
  );
}

function PackageInspector({
  record,
  outputs,
  catalogItems,
  onBack,
  onReissue,
  onOpen,
  verifyPending,
  verifyResult,
  onVerify,
}: {
  record: IssueHistoryRecord;
  outputs: readonly CanonicalOutputPresenceRecord[];
  catalogItems: readonly RevisionPackageItem[];
  onBack: () => void;
  onReissue: () => void;
  onOpen: (item: IssueHistoryDeliverable) => void;
  verifyPending: boolean;
  verifyResult: PackageVerificationResult | null;
  onVerify: () => void;
}) {
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const [verificationDetailsOpen, setVerificationDetailsOpen] = useState(false);
  const presentations = new Map(
    record.deliverables.map((deliverable) => {
      const id =
        deliverable.sourceType === 'DocumentSnapshot'
          ? deliverable.deliverableId
          : deliverable.outputId;
      return [id, deliverablePresentation(deliverable, outputs, catalogItems)] as const;
    }),
  );
  const verifiedCount =
    verifyResult?.deliverables.filter((deliverable) => deliverable.status === 'VERIFIED').length ??
    0;
  const nonVerifiedDeliverables =
    verifyResult?.deliverables.filter((deliverable) => deliverable.status !== 'VERIFIED') ?? [];

  const renderVerificationMember = (
    deliverable: PackageVerificationResult['deliverables'][number],
  ) => {
    const presentation = presentations.get(deliverable.sourceId);
    return (
      <li key={`${deliverable.sourceType}:${deliverable.sourceId}`}>
        <div className="v4-packages__verify-member-heading">
          <div>
            <strong>{presentation?.verificationLabel ?? 'Canonical Deliverable'}</strong>
            <small>{deliverable.sourceType}</small>
          </div>
          <V4StatusPill variant={verificationVariant(deliverable.status)}>
            {deliverable.status}
          </V4StatusPill>
        </div>
        {deliverable.reason ? <small>{deliverable.reason}</small> : null}
      </li>
    );
  };

  return (
    <aside className="v4-packages__inspector" aria-label="Selected package details">
      <button type="button" className="v4-packages__text-button" onClick={onBack}>
        ← Back to builder
      </button>
      <section>
        <div className="v4-packages__inspector-heading">
          <FileArchive size={16} />
          <h2>Package Identity</h2>
        </div>
        <dl className="v4-packages__details">
          <div>
            <dt>Label</dt>
            <dd>{record.package.label}</dd>
          </div>
          <div>
            <dt>Package Sequence</dt>
            <dd>{record.package.packageSequence}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>{record.revision.revisionLabel}</dd>
          </div>
          <div>
            <dt>Revision Purpose</dt>
            <dd>{record.revision.purpose ?? 'Not added'}</dd>
          </div>
          <div>
            <dt>Business Status</dt>
            <dd>
              <V4StatusPill variant={businessStatusVariant(record.package.businessStatus)}>
                {record.package.businessStatus}
              </V4StatusPill>
            </dd>
          </div>
          <div>
            <dt>File preparation</dt>
            <dd>
              <V4StatusPill variant={lifecycleVariant(record.package.lifecycleState)}>
                {record.package.lifecycleState === 'FINALIZED'
                  ? 'Files saved'
                  : record.package.lifecycleState}
              </V4StatusPill>
            </dd>
          </div>
        </dl>
      </section>
      <section>
        <div className="v4-packages__inspector-heading">
          <PackageCheck size={16} />
          <h2>Issue Audit (Read-only)</h2>
        </div>
        <dl className="v4-packages__details">
          <div>
            <dt>Issued By</dt>
            <dd>{record.package.issuedBy?.actorNameSnapshot ?? 'Not issued'}</dd>
          </div>
          <div>
            <dt>Issued At</dt>
            <dd>{record.package.issuedAt ? formatDate(record.package.issuedAt) : 'Not issued'}</dd>
          </div>
        </dl>
      </section>
      <section>
        <div className="v4-packages__inspector-heading">
          <Package size={16} />
          <h2>Deliverables</h2>
        </div>
        {record.deliverables.length === 0 ? (
          <p className="v4-packages__details-note">No canonical deliverables recorded.</p>
        ) : (
          <ul className="v4-packages__deliverable-list">
            {record.deliverables.map((deliverable) => (
              <DeliverableItem
                key={
                  deliverable.sourceType === 'DocumentSnapshot'
                    ? deliverable.deliverableId
                    : deliverable.outputId
                }
                onOpen={() => onOpen(deliverable)}
                deliverable={deliverable}
                presentation={presentations.get(
                  deliverable.sourceType === 'DocumentSnapshot'
                    ? deliverable.deliverableId
                    : deliverable.outputId,
                )}
              />
            ))}
          </ul>
        )}
        <p className="v4-packages__datasheet-truth">
          Datasheets are included as canonical DocumentSnapshot deliverables.
        </p>
        <div className="v4-packages__disclosure">
          <button
            type="button"
            className="v4-packages__text-button"
            aria-expanded={technicalDetailsOpen}
            aria-controls="v4-package-technical-details"
            onClick={() => setTechnicalDetailsOpen((open) => !open)}
          >
            {technicalDetailsOpen ? 'Hide file details' : 'View file details'}
          </button>
          {technicalDetailsOpen ? (
            <div id="v4-package-technical-details" className="v4-packages__technical-details">
              <dl className="v4-packages__details">
                <div>
                  <dt>Package ID</dt>
                  <dd>{record.package.packageId}</dd>
                </div>
              </dl>
              <ul className="v4-packages__technical-list">
                {record.deliverables.map((deliverable) => (
                  <TechnicalDeliverableDetails
                    key={
                      deliverable.sourceType === 'DocumentSnapshot'
                        ? deliverable.deliverableId
                        : deliverable.outputId
                    }
                    deliverable={deliverable}
                    presentation={presentations.get(
                      deliverable.sourceType === 'DocumentSnapshot'
                        ? deliverable.deliverableId
                        : deliverable.outputId,
                    )}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
      <section>
        <div className="v4-packages__inspector-heading">
          <RefreshCw size={16} />
          <h2>Reproducibility</h2>
        </div>
        {verifyResult ? (
          <div className="v4-packages__verify-result" data-status={verifyResult.status}>
            <V4StatusPill variant={verificationVariant(verifyResult.status)}>
              {verifyResult.status}
            </V4StatusPill>
            <strong className="v4-packages__verify-summary">
              {verifyResult.status === 'VERIFIED'
                ? `${verifiedCount} / ${verifyResult.deliverables.length} Deliverables verified`
                : nonVerifiedDeliverables.length > 0
                  ? `${nonVerifiedDeliverables.length} of ${verifyResult.deliverables.length} Deliverable${nonVerifiedDeliverables.length === 1 ? '' : 's'} needs attention`
                  : 'Package verification needs attention'}
            </strong>
            <span>Checked {formatDate(verifyResult.checkedAt)}</span>
            {nonVerifiedDeliverables.length > 0 ? (
              <ul className="v4-packages__verify-members v4-packages__verify-members--attention">
                {nonVerifiedDeliverables.map(renderVerificationMember)}
              </ul>
            ) : null}
            {verifyResult.deliverables.length > 0 ? (
              <div className="v4-packages__disclosure">
                <button
                  type="button"
                  className="v4-packages__text-button"
                  aria-expanded={verificationDetailsOpen}
                  aria-controls="v4-package-verification-details"
                  onClick={() => setVerificationDetailsOpen((open) => !open)}
                >
                  {verificationDetailsOpen
                    ? 'Hide verification details'
                    : 'View verification details'}
                </button>
                {verificationDetailsOpen ? (
                  <ul id="v4-package-verification-details" className="v4-packages__verify-members">
                    {verifyResult.deliverables.map(renderVerificationMember)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="v4-packages__details-note">
            Verify whether this exact historical package can still be reproduced.
          </p>
        )}
      </section>
      <section className="v4-packages__inspector-actions">
        <button
          type="button"
          className="v4-packages__button v4-packages__button--secondary"
          onClick={() => {
            setVerificationDetailsOpen(false);
            onVerify();
          }}
          disabled={verifyPending}
        >
          {verifyPending ? 'Verifying…' : 'Verify Package'}
        </button>
        <button
          type="button"
          className="v4-packages__button v4-packages__button--secondary"
          hidden={record.package.businessStatus !== 'Issued'}
          onClick={onReissue}
        >
          Start Reissue
        </button>
      </section>
    </aside>
  );
}

function DeliverableItem({
  deliverable,
  presentation,
  onOpen,
}: {
  deliverable: IssueHistoryDeliverable;
  presentation: DeliverablePresentation | undefined;
  onOpen: () => void;
}) {
  const deliverablePresentationValue =
    presentation ??
    (deliverable.sourceType === 'DocumentSnapshot'
      ? {
          name: deliverable.title,
          verificationLabel: deliverable.title,
          format: null,
          technicalType: deliverable.sourceType,
        }
      : {
          name: 'Canonical Output',
          verificationLabel: 'Canonical Output',
          format: null,
          technicalType: deliverable.sourceType,
        });

  return (
    <li className="v4-packages__deliverable-row">
      <div>
        <button type="button" className="v4-packages__text-button" onClick={onOpen}>
          {deliverablePresentationValue.format === 'PDF' ? (
            <SctPdf style={{ color: 'var(--v4-danger)' }} />
          ) : (
            <SctFile />
          )}
          <strong>{deliverablePresentationValue.name}</strong>
          <SctOpen />
        </button>
        <small>{deliverablePresentationValue.technicalType}</small>
      </div>
      {deliverablePresentationValue.format ? (
        <span className="v4-packages__deliverable-format">
          {deliverablePresentationValue.format}
        </span>
      ) : null}
    </li>
  );
}

function TechnicalDeliverableDetails({
  deliverable,
  presentation,
}: {
  deliverable: IssueHistoryDeliverable;
  presentation: DeliverablePresentation | undefined;
}) {
  if (deliverable.sourceType === 'DocumentSnapshot') {
    return (
      <li>
        <strong>{presentation?.verificationLabel ?? deliverable.title}</strong>
        <dl className="v4-packages__details">
          <div>
            <dt>Deliverable ID</dt>
            <dd>{deliverable.deliverableId}</dd>
          </div>
          <div>
            <dt>Content Hash</dt>
            <dd className="v4-packages__hash">{deliverable.contentHash}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(deliverable.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Locator</dt>
            <dd>{deliverable.locator}</dd>
          </div>
          {deliverable.sourceArtifactVersionId ? (
            <div>
              <dt>Source Artifact Version</dt>
              <dd>{deliverable.sourceArtifactVersionId}</dd>
            </div>
          ) : null}
        </dl>
      </li>
    );
  }
  return (
    <li>
      <strong>{presentation?.verificationLabel ?? 'Canonical Output'}</strong>
      <dl className="v4-packages__details">
        <div>
          <dt>Output ID</dt>
          <dd>{deliverable.outputId}</dd>
        </div>
        <div>
          <dt>Content Hash</dt>
          <dd className="v4-packages__hash">{deliverable.contentHash}</dd>
        </div>
        {deliverable.templateId ? (
          <div>
            <dt>Template</dt>
            <dd>{deliverable.templateId}</dd>
          </div>
        ) : null}
        {deliverable.templateVersionId ? (
          <div>
            <dt>Template Version</dt>
            <dd>{deliverable.templateVersionId}</dd>
          </div>
        ) : null}
        {deliverable.resolvedTemplateSnapshotHash ? (
          <div>
            <dt>Template Snapshot Hash</dt>
            <dd className="v4-packages__hash">{deliverable.resolvedTemplateSnapshotHash}</dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}
