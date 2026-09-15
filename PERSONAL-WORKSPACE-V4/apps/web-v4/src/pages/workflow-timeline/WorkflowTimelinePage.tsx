import { activityOperation } from '../project-summary/activityPresentation';
import { projectActivityProjection } from '../project-summary/projectActivityProjection';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/environment';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { V4Drawer } from '../../components/common/V4Drawer';
import { ProjectHeader } from '../../components/final-ui/ProjectHeader';
import { shellProject } from '../../components/final-ui/ShellData';
import FinalWorkflowTimelineView, {
  type FinalTimelineEvent,
} from '../../components/final-ui/FinalWorkflowTimelineView';
import {
  buildTimelineEvents,
  timelineEventStatusDisplay,
  timelineEventTypeDisplay,
  type TimelineEvent,
} from './workflowTimelineViewModel';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
} from '../../components/sidebar/sidebarMode';

export function WorkflowTimelinePage() {
  const { projectId = '' } = useParams();
  return <TimelineWorkspace key={projectId} projectId={projectId} />;
}
function TimelineWorkspace({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [mode, setMode] = useState(() => readStoredSidebarMode(window.localStorage));
  const [details, setDetails] = useState<TimelineEvent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const project = useQuery({
    queryKey: ['v4', 'timeline', 'project', projectId],
    queryFn: () => api.project(projectId),
  });
  const workspace = useQuery({
    queryKey: ['v4', 'timeline', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId),
  });
  const workflow = useQuery({
    queryKey: ['v4', 'timeline', 'workflow', projectId],
    queryFn: () => api.workflowHistory(projectId),
  });
  const revisions = useQuery({
    queryKey: ['v4', 'timeline', 'canonical-revisions', projectId],
    queryFn: () => api.projectRevisions(projectId),
  });
  const outputs = useQuery({
    queryKey: ['v4', 'timeline', 'outputs', projectId],
    queryFn: () => api.projectOutputs(projectId),
  });
  const audit = useQuery({
    queryKey: ['v4', 'timeline', 'audit', projectId],
    queryFn: () => api.activities(projectId),
  });
  const queries = [project, workspace, workflow, revisions, outputs, audit];
  const loading = queries.some((query) => query.isLoading);
  const error = queries.find((query) => query.error)?.error;
  const source =
    !error &&
    project.data?.id === projectId &&
    workspace.data?.projectId === projectId &&
    workflow.data &&
    revisions.data
      ? buildTimelineEvents(
          project.data,
          {
            ...workspace.data,
            activity: projectActivityProjection(
              projectId,
              workspace.data.activity,
              Array.isArray(audit.data) ? audit.data : [],
            ),
          },
          workflow.data,
          revisions.data,
        )
      : [];
  const latestWorkflow = [...source].reverse().find((event) => event.category === 'workflow');
  function openRevision(id: string, tab = 'revisions') {
    navigate(`/projects/${projectId}/revisions?revisionId=${encodeURIComponent(id)}&tab=${tab}`);
  }
  const events: FinalTimelineEvent[] = source.map((event) => {
    const revision =
      event.category === 'revision'
        ? revisions.data?.find((row) => `revision:${row.revisionId}` === event.id)
        : undefined;
    const related = revision
      ? (outputs.data ?? []).filter(
          (output) => output.projectId === projectId && output.revisionId === revision.revisionId,
        )
      : [];
    const current = event.id === latestWorkflow?.id && event.status === project.data?.status;
    const entityType =
      event.category === 'activity' ? event.activityEntityType?.toLowerCase() : event.category;
    const entityId =
      event.category === 'activity'
        ? event.activityEntityId
        : event.id.slice(event.id.indexOf(':') + 1);
    const destination =
      entityId && workspace.data
        ? entityType === 'action' && workspace.data.actions.some((row) => row.id === entityId)
          ? { path: 'actions', key: 'actionId', label: 'Open Action' }
          : entityType === 'meeting' && workspace.data.meetings.some((row) => row.id === entityId)
            ? { path: 'meetings', key: 'meetingId', label: 'Open Meeting' }
            : entityType === 'luminaire' &&
                workspace.data.luminaires.some((row) => row.id === entityId)
              ? { path: 'luminaires', key: 'luminaireId', label: 'Open Luminaire' }
              : null
        : null;
    const completed =
      event.category === 'workflow' ||
      event.category === 'activity' ||
      ['Completed', 'FINALIZED', 'Closed', 'Issued'].includes(
        event.status ?? event.canonicalLifecycleState ?? '',
      );
    return {
      id: event.id,
      title: event.title,
      desc: event.description ?? '',
      date: formatBusinessDateTime(event.occurredAt, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      time: formatBusinessDateTime(event.occurredAt, { hour: '2-digit', minute: '2-digit' }),
      avatar: (event.actor ?? '')
        .split(/\s+/)
        .map((part) => part[0])
        .slice(0, 2)
        .join(''),
      avatarBg: '#2563eb',
      performer: event.actor ?? '',
      role: '',
      status: current ? 'active' : completed ? 'completed' : 'pending',
      type: event.category,
      iconKind:
        (event.category === 'activity' ? activityOperation(event.status ?? '') : null) ??
        (entityType === 'contact'
          ? 'contact'
          : entityType === 'project'
            ? 'project'
            : entityType === 'luminaire'
              ? 'luminaire'
              : event.category === 'revision'
                ? 'document'
                : event.category === 'meeting'
                  ? 'people'
                  : event.category === 'action'
                    ? 'flag'
                    : event.status === 'RevisionRequired'
                      ? 'warning'
                      : 'gear'),
      iconBg: current ? 'var(--v4-accent-selected)' : 'var(--v4-surface-muted)',
      iconColor: current ? 'var(--v4-action-primary)' : 'var(--v4-text-secondary)',
      eventTypeName: timelineEventTypeDisplay(event.category),
      stage: event.category === 'workflow' ? timelineEventStatusDisplay(event.status ?? '') : '—',
      inProgress: current,
      notes: event.notes ?? '',
      statusLabel: timelineEventStatusDisplay(
        event.status ?? event.canonicalLifecycleState ?? 'Recorded',
      ),
      openRevision: revision ? () => openRevision(revision.revisionId) : null,
      openEntity: destination
        ? () =>
            navigate(
              `/projects/${projectId}/${destination.path}?${destination.key}=${encodeURIComponent(entityId!)}`,
            )
        : null,
      openEntityLabel: destination?.label,
      viewOutputs: revision ? () => openRevision(revision.revisionId, 'deliverables') : null,
      more: () => setDetails(event),
      outputs: related.map((output) => ({
        icon: output.outputFormat.toLowerCase() === 'xlsx' ? 'xlsx' : 'pdf',
        name:
          output.artifactOpenPath?.split(/[\\/]/).at(-1) ??
          `${output.outputFamily ?? 'Output'} · ${output.outputFormat}`,
        meta: `${output.outputFormat} · ${output.artifactPresence}`,
        date: formatBusinessDateTime(output.createdAt, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
        time: formatBusinessDateTime(output.createdAt, { hour: '2-digit', minute: '2-digit' }),
        action: 'download',
        open:
          output.artifactPresence === 'Present' &&
          output.artifactOpenPath &&
          window.scliDesktop?.openPath
            ? () => {
                void window.scliDesktop!.openPath!(output.artifactOpenPath!).catch((error) =>
                  setNotice(error instanceof Error ? error.message : 'Output could not be opened.'),
                );
              }
            : null,
      })),
    };
  });
  return (
    <V4AppShell
      context="project"
      sidebarMode={mode}
      onToggleSidebarMode={() =>
        setMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      finalContacts
    >
      <div
        className="final-ui-reference"
        style={{
          flexDirection: 'column',
          background: 'var(--v4-surface-subtle)',
          overflow: 'hidden',
        }}
        data-testid="v4-workflow-timeline"
      >
        <ProjectHeader project={shellProject(project.isError ? null : project.data)} />
        <FinalWorkflowTimelineView
          events={events}
          loading={loading}
          error={error?.message ?? null}
          retry={() => {
            void Promise.all(queries.map((query) => query.refetch()));
          }}
          initialEventId={search.get('eventId')}
        />
        {notice ? <span role="alert">{notice}</span> : null}
      </div>
      <V4Drawer
        open={Boolean(details)}
        onClose={() => setDetails(null)}
        title="Event details"
        className="v4-timeline-event-details"
      >
        {details ? (
          <>
            <h3>{details.title}</h3>
            <p>{details.description}</p>
            <dl>
              <dt>Performed By</dt>
              <dd>{details.actor || 'Not recorded'}</dd>
              <dt>Event Type</dt>
              <dd>{timelineEventTypeDisplay(details.category)}</dd>
              <dt>Date &amp; Time</dt>
              <dd>{formatBusinessDateTime(details.occurredAt)}</dd>
              <dt>Status</dt>
              <dd>
                {timelineEventStatusDisplay(
                  details.status ?? details.canonicalLifecycleState ?? 'Recorded',
                )}
              </dd>
            </dl>
            {details.notes && details.notes !== details.description && <p>{details.notes}</p>}
          </>
        ) : null}
      </V4Drawer>
    </V4AppShell>
  );
}
