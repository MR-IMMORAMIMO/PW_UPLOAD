import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SctVerify as FileCheck2 } from '../common/SctIcons';
import { RefreshCw, TriangleAlert, X } from '../common/SctIcons';
import type { CaptureReadModel, P4cArtifactType } from '@scli/contracts';
import type {
  OutputMapping,
  Project,
  ProjectDocument,
  ProjectFolderSnapshot,
  ProjectWorkspace,
} from '@scli/domain';
import { api } from '../../api/environment';
import { executeHandoff } from '../../desktop/integrations';
import { V4ConfirmDialog } from '../common/V4ConfirmDialog';
import { V4Drawer } from '../common/V4Drawer';
import {
  V4InspectorFooter,
  V4InspectorFrame,
  V4InspectorMetadata,
  V4InspectorSection,
} from '../common/V4Inspector';
import { V4Pagination } from '../common/V4Pagination';
import { V4StatusPill } from '../common/V4StatusPill';
import { ProjectStorageHealth } from '../project/ProjectStorageHealth';
import { ToolSessionSurface } from './ToolSessionSurface';

const PAGE_SIZE = 8;
const TYPE_LABELS = {
  DIALUX_REPORT: 'DIALux Report',
  CAD_LAYOUT_PDF: 'Lighting Layout PDF',
  CAD_WORKING_DRAWING: 'CAD Working Drawing',
} as const;

const ATTENTION_STATES = new Set<CaptureReadModel['state']>(['UNRESOLVED', 'FAILED_RECOVERABLE']);

const REASON_LABELS: Readonly<Record<string, string>> = {
  DESTINATION_MAPPING_REQUIRED: 'Output filing needs configuration',
  STORAGE_UNAVAILABLE: 'Project storage is unavailable',
  TARGET_REVISION_FINALIZED: 'Target Revision is finalized',
  TARGET_REVISION_NOT_PREPARING: 'Target Revision is not preparing',
  TARGET_REVISION_STALE_OR_DELETED: 'Target Revision is no longer available',
  DESTINATION_PATH_TOO_LONG: 'Output destination is too long',
  SOURCE_NOT_FOUND: 'Source file was not found',
  SOURCE_NOT_STABLE: 'File is still changing',
  CAPTURE_ROUTING_FAILED: 'Output filing needs attention',
};

function attentionReason(capture: CaptureReadModel) {
  if (!ATTENTION_STATES.has(capture.state) || !capture.structuredReason) return null;
  return {
    ...capture.structuredReason,
    label: REASON_LABELS[capture.structuredReason.code] ?? capture.structuredReason.summary,
  };
}

function ownerStateLabel(capture: CaptureReadModel): string {
  if (capture.state === 'COMPLETED') return 'Completed';
  if (capture.state === 'DISCARDED') return 'Discarded';
  if (ATTENTION_STATES.has(capture.state)) return 'Needs Attention';
  return capture.state.replaceAll('_', ' ');
}

function ownerMessage(capture: CaptureReadModel): { primary: string; secondary?: string } {
  if (capture.state === 'COMPLETED') {
    if (capture.reusedExisting) return { primary: 'Already captured — existing version reused' };
    return capture.finalProjectRelativeLocator
      ? { primary: `Saved to ${capture.finalProjectRelativeLocator}` }
      : { primary: 'Output filed successfully' };
  }
  if (capture.state === 'DISCARDED') return { primary: 'Capture discarded' };
  const reason = attentionReason(capture);
  if (reason) {
    return reason.summary === reason.label
      ? { primary: reason.label }
      : { primary: reason.label, secondary: reason.summary };
  }
  return { primary: 'Capture recorded' };
}

export function OutputActivity({
  project,
  documents,
  openRequest: contextualOpenRequest,
  onAddSource,
}: {
  onAddSource?: (() => void) | undefined;
  project: Project;
  documents: ProjectDocument[];
  openRequest?: {
    token: number;
    artifactType: P4cArtifactType;
    sourceDocumentId?: string;
  } | null;
}) {
  const projectId = project.id;
  const queryClient = useQueryClient();
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [view, setView] = useState<'attention' | 'recent'>('attention');
  const [application, setApplication] = useState<'' | 'AUTOCAD' | 'DIALUX'>('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<CaptureReadModel | null>(null);
  const [mapping, setMapping] = useState<CaptureReadModel | null>(null);
  const [recoveryOpenRequest, setRecoveryOpenRequest] = useState<{
    token: number;
    artifactType: P4cArtifactType;
  } | null>(null);
  const startRequest = contextualOpenRequest ?? recoveryOpenRequest;
  const sessions = useQuery({
    queryKey: ['v4', 'tool-sessions', projectId],
    queryFn: () => api.toolSessions(projectId),
  });
  const live = sessions.data?.some(
    (session) => session.state === 'LIVE' || session.state === 'REBOUND',
  );
  const captures = useQuery({
    queryKey: ['v4', 'captures', projectId, view, application, page, showDiscarded],
    queryFn: () =>
      api.captures(projectId, {
        view,
        application: application || undefined,
        state: view === 'recent' && !showDiscarded ? 'COMPLETED' : undefined,
        limit: PAGE_SIZE,
        page,
      }),
    refetchInterval: live ? 2_000 : false,
  });
  const workspace = useQuery({
    queryKey: ['v4', 'files', 'workspace', projectId],
    queryFn: async () => (await api.projectWorkspace(projectId)) as P4cWorkspace,
  });
  const selected = captures.data?.items.find((item) => item.captureId === selectedId) ?? null;
  const invalidate = async () => {
    await Promise.all([
      // Refresh every cached Output Activity view so an inactive Recent query
      // cannot revive warning copy from the capture's pre-retry state.
      queryClient.invalidateQueries({
        queryKey: ['v4', 'captures', projectId],
        refetchType: 'all',
      }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'files', 'workspace', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'revisions', 'deliverables', projectId] }),
    ]);
  };
  const retry = useMutation({ mutationFn: api.retryCapture, onSuccess: invalidate });
  const discard = useMutation({
    mutationFn: (captureId: string) =>
      api.discardCapture(captureId, { reason: 'OUTPUT_NO_LONGER_REQUIRED' }),
    onSuccess: async () => {
      setDiscarding(null);
      setSelectedId(null);
      await invalidate();
    },
  });
  useEffect(() => setPage(0), [view, application]);
  useEffect(() => {
    if (selectedId && !captures.data?.items.some((item) => item.captureId === selectedId))
      setSelectedId(null);
  }, [captures.data?.items, selectedId]);
  const pageCount = Math.max(1, Math.ceil((captures.data?.totalCount ?? 0) / PAGE_SIZE));

  const executeFile = async (capture: CaptureReadModel, action: 'OPEN' | 'REVEAL') => {
    const handoff = await api.captureFileHandoff(capture.captureId, { action });
    await executeHandoff(handoff);
  };

  return (
    <div className="v4-output-activity">
      <ToolSessionSurface
        projectId={projectId}
        documents={documents}
        openRequest={startRequest}
        onAddSource={onAddSource}
      />
      <section className="v4-output-activity__collection" aria-label="Output Activity">
        <header>
          <div>
            <h2>Output Activity</h2>
            <p>Captured AutoCAD and DIALux outputs for this Project.</p>
          </div>
          <div className="v4-output-activity__filters">
            <div role="group" aria-label="Output activity view">
              <button
                type="button"
                aria-pressed={view === 'attention'}
                onClick={() => setView('attention')}
              >
                Needs Attention
              </button>
              <button
                type="button"
                aria-pressed={view === 'recent'}
                onClick={() => setView('recent')}
              >
                Recent
              </button>
            </div>
            {view === 'recent' ? (
              <label>
                <input
                  type="checkbox"
                  checked={showDiscarded}
                  onChange={(event) => {
                    setShowDiscarded(event.target.checked);
                    setPage(0);
                  }}
                />{' '}
                Show discarded
              </label>
            ) : null}
            <label>
              <span>Application</span>
              <select
                value={application}
                onChange={(event) => setApplication(event.target.value as typeof application)}
              >
                <option value="">All</option>
                <option value="AUTOCAD">AutoCAD</option>
                <option value="DIALUX">DIALux</option>
              </select>
            </label>
            <button
              type="button"
              aria-label="Refresh Output Activity"
              onClick={() => void captures.refetch()}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
        </header>
        {captures.isLoading ? <p aria-busy="true">Loading output activity…</p> : null}
        {captures.isError ? (
          <p role="alert">
            <TriangleAlert aria-hidden="true" /> Output Activity could not be loaded.
          </p>
        ) : null}
        {!captures.isLoading && captures.data?.items.length === 0 ? (
          <div className="v4-output-activity__empty">
            <FileCheck2 aria-hidden="true" />
            <strong>
              {view === 'attention' ? 'No outputs need attention' : 'No recent output activity'}
            </strong>
          </div>
        ) : null}
        <div className="v4-output-activity__workspace" data-inspector={Boolean(selected)}>
          <div className="v4-output-activity__rows">
            {(captures.data?.items ?? []).map((capture) => {
              const message = ownerMessage(capture);
              return (
                <button
                  key={capture.captureId}
                  type="button"
                  className="v4-output-activity__row"
                  aria-pressed={selectedId === capture.captureId}
                  onClick={() => setSelectedId(capture.captureId)}
                >
                  <span>
                    <strong>{capture.sourceFileName}</strong>
                    <small>
                      {capture.application} · {TYPE_LABELS[capture.artifactType]}
                      {capture.targetRevision?.label ? ` · ${capture.targetRevision.label}` : ''}
                    </small>
                  </span>
                  <span className="v4-output-activity__message">
                    <strong>{message.primary}</strong>
                    {message.secondary ? <small>{message.secondary}</small> : null}
                  </span>
                  <V4StatusPill
                    variant={
                      capture.state === 'COMPLETED'
                        ? 'success'
                        : capture.state === 'DISCARDED'
                          ? 'neutral'
                          : 'warning'
                    }
                  >
                    {ownerStateLabel(capture)}
                  </V4StatusPill>
                  <time dateTime={capture.milestones.completedAt ?? capture.milestones.detectedAt}>
                    {new Date(
                      capture.milestones.completedAt ?? capture.milestones.detectedAt,
                    ).toLocaleString()}
                  </time>
                </button>
              );
            })}
            <footer>
              <span>{captures.data?.totalCount ?? 0} results</span>
              <V4Pagination
                pageCount={pageCount}
                currentPage={page}
                onChange={setPage}
                ariaLabel="Output Activity pages"
              />
            </footer>
          </div>
          {selected ? (
            <CaptureInspector
              capture={selected}
              project={project}
              pending={retry.isPending}
              onClose={() => setSelectedId(null)}
              onRetry={() => retry.mutate(selected.captureId)}
              onDiscard={() => setDiscarding(selected)}
              onConfigure={() => setMapping(selected)}
              onStartNew={() => {
                setRecoveryOpenRequest({
                  token: Date.now(),
                  artifactType: selected.artifactType,
                });
                setSelectedId(null);
              }}
              onFile={executeFile}
            />
          ) : null}
        </div>
      </section>
      <V4ConfirmDialog
        open={Boolean(discarding)}
        title="Discard capture?"
        description="The capture record becomes terminal. Source, staged, and any existing final bytes will not be deleted."
        cancelLabel="Cancel"
        confirmLabel="Discard Capture"
        destructive
        pending={discard.isPending}
        onCancel={() => setDiscarding(null)}
        onConfirm={() => discarding && discard.mutate(discarding.captureId)}
      />
      <OutputMappingDrawer
        capture={mapping}
        workspace={workspace.data}
        onClose={() => setMapping(null)}
        onSaved={async () => {
          setMapping(null);
          await invalidate();
        }}
      />
    </div>
  );
}

function CaptureInspector(props: {
  capture: CaptureReadModel;
  project: Project;
  pending: boolean;
  onClose: () => void;
  onRetry: () => void;
  onDiscard: () => void;
  onConfigure: () => void;
  onStartNew: () => void;
  onFile: (capture: CaptureReadModel, action: 'OPEN' | 'REVEAL') => Promise<void>;
}) {
  const { capture } = props;
  const actions = capture.allowedRecoveryActions;
  const reason = attentionReason(capture);
  return (
    <V4InspectorFrame
      title={capture.sourceFileName}
      description={`${capture.application} · ${TYPE_LABELS[capture.artifactType]}`}
      actions={
        <button type="button" aria-label="Close capture Inspector" onClick={props.onClose}>
          <X aria-hidden="true" />
        </button>
      }
      footer={
        <V4InspectorFooter>
          {actions.includes('OPEN') ? (
            <button type="button" onClick={() => void props.onFile(capture, 'OPEN')}>
              Open File
            </button>
          ) : null}
          {actions.includes('REVEAL') ? (
            <button type="button" onClick={() => void props.onFile(capture, 'REVEAL')}>
              Reveal
            </button>
          ) : null}
          {actions.includes('CONFIGURE_OUTPUT_FILING') ? (
            <button type="button" onClick={props.onConfigure}>
              Configure Output Filing
            </button>
          ) : null}
          {actions.includes('START_NEW_TOOL_SESSION') ? (
            <button type="button" onClick={props.onStartNew}>
              Start New Tool Session
            </button>
          ) : null}
          {actions.includes('RETRY') ? (
            <button type="button" disabled={props.pending} onClick={props.onRetry}>
              {props.pending ? 'Retrying…' : 'Retry'}
            </button>
          ) : null}
          {actions.includes('DISCARD') ? (
            <button type="button" onClick={props.onDiscard}>
              Discard Capture
            </button>
          ) : null}
        </V4InspectorFooter>
      }
    >
      <V4InspectorSection>
        <V4InspectorMetadata>
          <div>
            <dt>State</dt>
            <dd>{ownerStateLabel(capture)}</dd>
          </div>
          {reason ? (
            <div>
              <dt>Technical state</dt>
              <dd className="v4-output-activity__technical-value">{capture.state}</dd>
            </div>
          ) : null}
          <div>
            <dt>Revision</dt>
            <dd>{capture.targetRevision?.label ?? 'Project-level'}</dd>
          </div>
          <div>
            <dt>Saved to</dt>
            <dd className="v4-output-activity__technical-value">
              {capture.finalProjectRelativeLocator ?? 'Not filed'}
            </dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>
              {capture.sizeBytes === null ? '—' : `${capture.sizeBytes.toLocaleString()} bytes`}
            </dd>
          </div>
          <div>
            <dt>Artifact Version</dt>
            <dd>{capture.artifactVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>Detected</dt>
            <dd>{new Date(capture.milestones.detectedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>
              {capture.milestones.completedAt
                ? new Date(capture.milestones.completedAt).toLocaleString()
                : '—'}
            </dd>
          </div>
        </V4InspectorMetadata>
      </V4InspectorSection>
      {capture.state === 'COMPLETED' ? (
        <p className="v4-output-activity__completed" role="status">
          {capture.reusedExisting
            ? 'Already captured — existing version reused'
            : 'Output filed successfully'}
        </p>
      ) : null}
      {reason ? (
        <V4InspectorSection title={reason.label}>
          <p>{reason.summary}</p>
          {reason.code === 'STORAGE_UNAVAILABLE' && actions.includes('RECONNECT_STORAGE') ? (
            <ProjectStorageHealth project={props.project} />
          ) : null}
          {reason.code === 'TARGET_REVISION_FINALIZED' ? (
            <p>
              Start a new Tool Session against an exact PREPARING Revision and export again. The old
              bytes cannot be retargeted.
            </p>
          ) : null}
        </V4InspectorSection>
      ) : null}
      <details className="v4-output-activity__technical-details">
        <summary>Technical details</summary>
        <code className="v4-output-activity__technical-value">
          {capture.contentHash ?? 'Hash unavailable'}
        </code>
        <p className="v4-output-activity__technical-value">Capture {capture.captureId}</p>
        {reason ? (
          <p className="v4-output-activity__technical-value">Reason {reason.code}</p>
        ) : null}
      </details>
    </V4InspectorFrame>
  );
}

type P4cWorkspace = ProjectWorkspace & {
  folderSnapshot: ProjectFolderSnapshot;
  outputMappings: OutputMapping[];
  folderConfigurationFingerprint: string;
};

function OutputMappingDrawer({
  capture,
  workspace,
  onClose,
  onSaved,
}: {
  capture: CaptureReadModel | null;
  workspace: P4cWorkspace | undefined;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [folderId, setFolderId] = useState('');
  const folders = useMemo(
    () => workspace?.folderSnapshot?.folders.filter((folder) => folder.enabled) ?? [],
    [workspace],
  );
  const save = useMutation({
    mutationFn: () =>
      api.updateOutputMapping(capture!.project.id, capture!.outputMappingId, {
        destinationFolderId: folderId,
        expectedFingerprint: workspace!.folderConfigurationFingerprint,
      }),
    onSuccess: onSaved,
  });
  return (
    <V4Drawer
      open={Boolean(capture)}
      title="Configure Output Filing"
      onClose={onClose}
      description="Choose an enabled folder from this Project’s stored folder snapshot."
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!folderId || save.isPending}
            onClick={() => save.mutate()}
          >
            Save Mapping
          </button>
        </>
      }
    >
      <label>
        <span>Destination folder</span>
        <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
          <option value="">Select Project folder</option>
          {folders.map((folder) => (
            <option key={folder.folderId} value={folder.folderId}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>
      {save.isError ? (
        <p role="alert">The mapping changed or could not be saved. Refresh and try again.</p>
      ) : null}
    </V4Drawer>
  );
}
