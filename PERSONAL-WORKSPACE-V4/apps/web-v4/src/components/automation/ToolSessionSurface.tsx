import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SctRestore as RotateCcw } from '../common/SctIcons';
import { FolderOpen, Play, Square } from '../common/SctIcons';
import type { CanonicalRevisionRecord, ProjectDocument } from '@scli/domain';
import type { P4cArtifactType, StartToolSessionInput, ToolSessionRead } from '@scli/contracts';
import { api } from '../../api/environment';
import { executeHandoff, executeManualPickerHandoff } from '../../desktop/integrations';
import { V4ConfirmDialog } from '../common/V4ConfirmDialog';
import { V4FloatingWorkspace } from '../common/V4FloatingWorkspace';
import { V4StatusPill } from '../common/V4StatusPill';

const TYPES: Array<{ value: P4cArtifactType; label: string }> = [
  { value: 'DIALUX_REPORT', label: 'DIALux Report' },
  { value: 'CAD_LAYOUT_PDF', label: 'Lighting Layout PDF' },
  { value: 'CAD_WORKING_DRAWING', label: 'CAD Working Drawing' },
];

function applicationFor(type: P4cArtifactType): 'AUTOCAD' | 'DIALUX' {
  return type === 'DIALUX_REPORT' ? 'DIALUX' : 'AUTOCAD';
}

function sourceEligible(document: ProjectDocument, type: P4cArtifactType): boolean {
  const extension = document.filePath.toLowerCase().match(/\.[^.\\/]+$/)?.[0] ?? '';
  return type === 'DIALUX_REPORT'
    ? ['.evo', '.dlx'].includes(extension)
    : ['.dwg', '.dxf', '.dwt'].includes(extension);
}

export function ToolSessionSurface({
  projectId,
  documents,
  fixedRevision = null,
  openRequest,
  onAddSource,
}: {
  onAddSource?: (() => void) | undefined;
  projectId: string;
  documents: ProjectDocument[];
  fixedRevision?: CanonicalRevisionRecord | null;
  openRequest?: {
    token: number;
    artifactType: P4cArtifactType;
    sourceDocumentId?: string;
  } | null;
}) {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [artifactType, setArtifactType] = useState<P4cArtifactType>(
    fixedRevision ? 'CAD_LAYOUT_PDF' : 'CAD_WORKING_DRAWING',
  );
  const [sourceDocumentId, setSourceDocumentId] = useState('');
  const [revisionId, setRevisionId] = useState(fixedRevision?.revisionId ?? '');
  const [ending, setEnding] = useState<ToolSessionRead | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: ['v4', 'tool-sessions', projectId],
    queryFn: () => api.toolSessions(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((session) => session.state === 'LIVE' || session.state === 'REBOUND')
        ? 2_000
        : false,
  });
  const revisions = useQuery({
    queryKey: ['v4', 'tool-sessions', 'revisions', projectId],
    queryFn: () => api.projectRevisions(projectId),
    enabled: !fixedRevision,
  });
  const preparing = (fixedRevision ? [fixedRevision] : (revisions.data ?? [])).filter(
    (revision) => revision.lifecycleState === 'PREPARING',
  );
  const sources = useMemo(
    () => documents.filter((document) => sourceEligible(document, artifactType)),
    [artifactType, documents],
  );
  useEffect(() => {
    if (!openRequest) return;
    setArtifactType(openRequest.artifactType);
    setSourceDocumentId(openRequest.sourceDocumentId ?? '');
    setRevisionId(fixedRevision?.revisionId ?? '');
    setDrawerOpen(true);
  }, [fixedRevision?.revisionId, openRequest]);
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['v4', 'tool-sessions', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'captures', projectId] }),
    ]);
  };
  const start = useMutation({
    mutationFn: async () => {
      const input: StartToolSessionInput = {
        application: applicationFor(artifactType),
        artifactType,
        sourceDocumentId: sourceDocumentId || null,
        targetRevisionId: artifactType === 'CAD_WORKING_DRAWING' ? null : revisionId || null,
      };
      const result = await api.startToolSession(projectId, input);
      if (!(await executeHandoff(result.launchHandoff))) {
        if (!result.reusedExisting)
          await api.closeAutomationContext(result.toolSession.toolContextId);
        throw new Error('Desktop launch request failed.');
      }
      return result;
    },
    onSuccess: async () => {
      setDrawerOpen(false);
      setMessage('Launch requested.');
      setError(null);
      await invalidate();
    },
    onError: () => setError('The Tool Session could not be started.'),
  });
  const manual = useMutation({
    mutationFn: async () => {
      const result = await api.manualCaptureContext(projectId, {
        artifactType,
        targetRevisionId: artifactType === 'CAD_WORKING_DRAWING' ? null : revisionId || null,
      });
      const outcome = await executeManualPickerHandoff(result.pickerHandoff);
      if (outcome !== 'accepted') {
        await api.closeAutomationContext(result.toolSession.toolContextId);
        if (outcome === 'failed') throw new Error('Desktop picker failed.');
      }
      return { result, accepted: outcome === 'accepted' };
    },
    onSuccess: async ({ accepted }) => {
      setManualOpen(false);
      setMessage(
        accepted
          ? 'File admitted. Personal Workspace will capture and file it automatically.'
          : 'Manual capture cancelled.',
      );
      setError(null);
      await invalidate();
    },
    onError: () => setError('The file could not be admitted for capture.'),
  });
  const close = useMutation({
    mutationFn: (id: string) => api.closeAutomationContext(id),
    onSuccess: async () => {
      setEnding(null);
      await invalidate();
    },
  });
  const restart = useMutation({
    mutationFn: async (id: string) => {
      const result = await api.restartToolSession(id);
      if (!(await executeHandoff(result.launchHandoff))) {
        await api.expireAutomationContext(result.toolSession.toolContextId);
        throw new Error('Desktop launch failed.');
      }
    },
    onSuccess: async () => {
      setMessage('Launch requested.');
      await invalidate();
    },
  });
  const openFolder = async (id: string) => {
    const handoff = await api.toolSessionExportFolderHandoff(id);
    if (!(await executeHandoff(handoff))) setError('The Export Folder could not be opened.');
  };

  return (
    <section className="v4-tool-sessions" aria-label="Tool Sessions">
      <header>
        <div>
          <h2>Tool Sessions</h2>
          <p>
            1. Register a source file. 2. Start a session. 3. Save or print into its Export Folder.
            Completed outputs appear below.
          </p>
        </div>
        <div>
          {fixedRevision ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setArtifactType('CAD_LAYOUT_PDF');
                  setSourceDocumentId('');
                  setDrawerOpen(true);
                }}
              >
                <Play aria-hidden="true" /> Start Lighting Layout Session
              </button>
              <button
                type="button"
                onClick={() => {
                  setArtifactType('DIALUX_REPORT');
                  setSourceDocumentId('');
                  setDrawerOpen(true);
                }}
              >
                <Play aria-hidden="true" /> Start DIALux Report Session
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setDrawerOpen(true)}>
              <Play aria-hidden="true" /> Start Tool Session
            </button>
          )}
          <button type="button" onClick={() => setManualOpen(true)}>
            Capture File to Project
          </button>
        </div>
      </header>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="v4-tool-sessions__list">
        {[...(sessions.data ?? [])]
          .sort(
            (a, b) =>
              Number(['LIVE', 'REBOUND'].includes(b.state)) -
              Number(['LIVE', 'REBOUND'].includes(a.state)),
          )
          .map((session) => (
            <article key={session.toolContextId}>
              <div>
                <strong>
                  {session.application === 'AUTOCAD' ? 'AutoCAD Session' : 'DIALux Session'}
                </strong>
                <span>{TYPES.find((type) => type.value === session.artifactType)?.label}</span>
                <small>
                  {session.targetRevisionLabel ?? 'Project-level'}
                  {session.sourceFileName ? ` · ${session.sourceFileName}` : ''}
                </small>
                {session.exportFolder ? (
                  <small className="v4-tool-session-export" title={session.exportFolder}>
                    Export Folder: {session.exportFolder}
                  </small>
                ) : null}
              </div>
              <V4StatusPill
                variant={
                  session.state === 'LIVE' || session.state === 'REBOUND' ? 'success' : 'neutral'
                }
              >
                {session.state === 'LIVE' || session.state === 'REBOUND'
                  ? 'Active'
                  : session.state === 'CLOSED'
                    ? 'Closed'
                    : 'Expired'}
              </V4StatusPill>
              <div>
                {session.state === 'LIVE' || session.state === 'REBOUND' ? (
                  <>
                    <button type="button" onClick={() => void openFolder(session.toolContextId)}>
                      <FolderOpen aria-hidden="true" /> Open Export Folder
                    </button>
                    <button type="button" onClick={() => setEnding(session)}>
                      <Square aria-hidden="true" /> End Tool Session
                    </button>
                  </>
                ) : session.state === 'EXPIRED' ? (
                  <button type="button" onClick={() => restart.mutate(session.toolContextId)}>
                    <RotateCcw aria-hidden="true" /> Restart Tool Session
                  </button>
                ) : null}
              </div>
            </article>
          ))}
      </div>
      <SessionDrawer
        open={drawerOpen}
        title="Start Tool Session"
        artifactType={artifactType}
        setArtifactType={setArtifactType}
        sourceDocumentId={sourceDocumentId}
        setSourceDocumentId={setSourceDocumentId}
        revisionId={revisionId}
        setRevisionId={setRevisionId}
        sources={sources}
        revisions={preparing}
        pending={start.isPending}
        onClose={() => setDrawerOpen(false)}
        onSubmit={() => start.mutate()}
        manual={false}
        onAddSource={
          onAddSource
            ? () => {
                setDrawerOpen(false);
                onAddSource();
              }
            : undefined
        }
      />
      <SessionDrawer
        open={manualOpen}
        title="Capture File to Project"
        artifactType={artifactType}
        setArtifactType={setArtifactType}
        sourceDocumentId=""
        setSourceDocumentId={() => undefined}
        revisionId={revisionId}
        setRevisionId={setRevisionId}
        sources={[]}
        revisions={preparing}
        pending={manual.isPending}
        onClose={() => setManualOpen(false)}
        onSubmit={() => manual.mutate()}
        manual
      />
      <V4ConfirmDialog
        open={Boolean(ending)}
        title="End Tool Session?"
        description="New files in this Export Folder will no longer be captured. Already routed outputs and recoverable captures will be kept."
        cancelLabel="Keep Active"
        confirmLabel="End Tool Session"
        pending={close.isPending}
        destructive
        onCancel={() => setEnding(null)}
        onConfirm={() => ending && close.mutate(ending.toolContextId)}
      />
    </section>
  );
}

function SessionDrawer(props: {
  open: boolean;
  title: string;
  artifactType: P4cArtifactType;
  setArtifactType: (value: P4cArtifactType) => void;
  sourceDocumentId: string;
  setSourceDocumentId: (value: string) => void;
  revisionId: string;
  setRevisionId: (value: string) => void;
  sources: ProjectDocument[];
  revisions: CanonicalRevisionRecord[];
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  manual: boolean;
  onAddSource?: (() => void) | undefined;
}) {
  const needsRevision = props.artifactType !== 'CAD_WORKING_DRAWING';
  const invalid =
    (needsRevision && !props.revisions.some((item) => item.revisionId === props.revisionId)) ||
    (!props.manual && !props.sources.some((item) => item.id === props.sourceDocumentId));
  return (
    <V4FloatingWorkspace
      panelClassName="v4-tool-session-float"
      open={props.open}
      title={props.title}
      onRequestClose={props.onClose}
      description={
        props.manual
          ? 'Select one supported output. The Desktop picker admits one file only.'
          : 'The exact Project, source, output, and Revision remain bound for capture.'
      }
      footer={
        <>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" disabled={props.pending || invalid} onClick={props.onSubmit}>
            {props.manual ? 'Choose File' : 'Start and Launch'}
          </button>
        </>
      }
    >
      <div className="v4-tool-session-form">
        <label>
          <span>Expected output</span>
          <select
            aria-label="Expected output"
            value={props.artifactType}
            onChange={(event) => {
              props.setArtifactType(event.target.value as P4cArtifactType);
              props.setSourceDocumentId('');
            }}
          >
            {TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        {needsRevision ? (
          <label>
            <span>PREPARING Revision</span>
            <select
              aria-label="PREPARING Revision"
              value={props.revisionId}
              onChange={(event) => props.setRevisionId(event.target.value)}
            >
              <option value="">Select Revision</option>
              {props.revisions.map((revision) => (
                <option key={revision.revisionId} value={revision.revisionId}>
                  {revision.revisionLabel}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!props.manual ? (
          <label>
            <span>Registered source</span>
            <select
              aria-label="Registered source"
              value={props.sourceDocumentId}
              onChange={(event) => props.setSourceDocumentId(event.target.value)}
            >
              <option value="">Select source file</option>
              {props.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title} — {source.filePath.split(/[\\/]/).pop()}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!props.manual && props.sources.length === 0 ? (
          <div role="status">
            <p>
              {props.artifactType === 'DIALUX_REPORT'
                ? 'No DIALux source is registered. Add an EVO or DLX project file in Working Files.'
                : 'No CAD source is registered. Add a DWG, DXF or DWT file in Working Files. PDF files are outputs, not CAD sources.'}
            </p>
            {props.onAddSource ? (
              <button type="button" onClick={props.onAddSource}>
                <FolderOpen aria-hidden="true" /> Add source file
              </button>
            ) : null}
          </div>
        ) : null}
        {needsRevision && props.revisions.length === 0 ? (
          <p role="status">
            Create a preparing Revision before capturing a report. CAD Working Drawing can be
            captured at project level.
          </p>
        ) : null}
        {!props.manual ? (
          <p>
            Export into this Tool Session’s Export Folder. Personal Workspace will capture and file
            it automatically.
          </p>
        ) : null}
      </div>
    </V4FloatingWorkspace>
  );
}
