import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ProjectActionItem,
  ProjectExportRecord,
  ProjectMeeting,
  ProjectRevision,
  RevisionCycle,
  WorkflowTransitionRecord,
} from '@scli/domain';
import { formatDate } from './ui';
import {
  cycleStatusLabel,
  filterTimelineEvents,
  normalizeProjectTimeline,
  TIMELINE_FILTER_LABELS,
  type TimelineEvent,
  type TimelineFilter,
} from '../project-timeline-model';
import { projectSectionHref } from '../navigation';

/**
 * P2-UX-04A multi-source Workflow Timeline + generic Event Inspector.
 *
 * Extends the existing Overview Workflow Timeline in place: workflow events
 * keep their established rendering (cycle badge, feedback summary, latest-first
 * order, show-all control) so existing behavior is preserved, while revision /
 * meeting / action events join the same normalized list. The Timeline is a pure
 * projection of `normalizeProjectTimeline(...)`; the component holds no business
 * logic. All "Open Source" and related-record destinations are project-scoped
 * via the single navigation route builder. No speculative upcoming content.
 */

export interface ProjectTimelineProps {
  projectId: string;
  transitions: WorkflowTransitionRecord[];
  revisionCycles: RevisionCycle[];
  revisions: ProjectRevision[];
  meetings: ProjectMeeting[];
  actions: ProjectActionItem[];
  exports: ProjectExportRecord[];
}

function EventTypeBadge({ type }: { type: TimelineEvent['type'] }) {
  return <span className={`timeline-type-badge timeline-type-${type}`}>{type}</span>;
}

function InspectorField({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="inspector-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RelatedRecordList({
  projectId,
  label,
  items,
}: {
  projectId: string;
  label: string;
  items: Array<{ label: string; detail: string; targetSection: string }>;
}) {
  if (!items.length) return null;
  return (
    <div className="inspector-related">
      <h3>{label}</h3>
      <ul>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            <Link to={projectSectionHref(projectId, item.targetSection)}>{item.label}</Link>
            <span>{item.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventInspector({ projectId, event }: { projectId: string; event: TimelineEvent }) {
  const payload = event.payload;
  return (
    <aside className="event-inspector" aria-label="Event inspector">
      <div className="inspector-head">
        <EventTypeBadge type={event.type} />
        <h2>{event.title}</h2>
        {event.status ? <span className="inspector-status">{event.status}</span> : null}
      </div>
      <dl className="inspector-fields">
        <InspectorField
          label="Date & time"
          value={formatDate(event.timestamp, {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        />
        <InspectorField label="Performed by" value={event.actor} />
        <InspectorField label="Notes" value={event.notes} />
        {payload.kind === 'workflow' ? (
          <>
            <InspectorField label="From" value={payload.fromStatus} />
            <InspectorField label="To" value={payload.toStatus} />
            <InspectorField label="Reason" value={payload.reason} />
            {payload.cycleNumber !== null ? (
              <InspectorField
                label="Revision cycle"
                value={`Cycle ${payload.cycleNumber} · ${payload.cycleStatus ?? ''}`}
              />
            ) : null}
            <InspectorField label="Feedback summary" value={payload.feedbackSummary} />
          </>
        ) : null}
        {payload.kind === 'revision' ? (
          <>
            <InspectorField
              label="Revision"
              value={`Revision ${String(payload.revisionNumber).padStart(2, '0')}`}
            />
            <InspectorField label="Status" value={payload.status} />
            <InspectorField label="Summary" value={payload.summary} />
            <InspectorField label="Change log" value={payload.changeLog} />
            <InspectorField
              label="Issued at"
              value={payload.issuedAt ? formatDate(payload.issuedAt) : null}
            />
            <RelatedRecordList
              projectId={projectId}
              label="Related outputs"
              items={payload.relatedOutputs}
            />
          </>
        ) : null}
        {payload.kind === 'meeting' ? (
          <>
            <InspectorField label="Status" value={payload.status} />
            <InspectorField label="Location" value={payload.location} />
            <InspectorField label="Agenda" value={payload.agenda} />
            <InspectorField label="Notes" value={payload.notes} />
            <InspectorField label="Decisions" value={payload.decisions} />
            {payload.attendees.length ? (
              <InspectorField label="Attendees" value={payload.attendees.join(', ')} />
            ) : null}
            <RelatedRecordList
              projectId={projectId}
              label="Linked actions"
              items={payload.relatedActions}
            />
          </>
        ) : null}
        {payload.kind === 'action' ? (
          <>
            <InspectorField label="Status" value={payload.status} />
            <InspectorField label="Priority" value={payload.priority} />
            <InspectorField label="Owner" value={payload.owner} />
            <InspectorField
              label="Due"
              value={payload.dueDate ? formatDate(payload.dueDate) : null}
            />
            <InspectorField label="Details" value={payload.details} />
          </>
        ) : null}
      </dl>
      <Link to={projectSectionHref(projectId, event.sourceSection)} className="button secondary">
        Open Source
      </Link>
    </aside>
  );
}

const FILTER_ZERO_COPY: Record<Exclude<TimelineFilter, 'all'>, string> = {
  workflow: 'No workflow events yet.',
  revisions: 'No revision events yet.',
  meetings: 'No meeting events yet.',
  actions: 'No action events yet.',
};

export function ProjectTimeline({
  projectId,
  transitions,
  revisionCycles,
  revisions,
  meetings,
  actions,
  exports,
}: ProjectTimelineProps) {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const events = useMemo(
    () =>
      normalizeProjectTimeline({
        transitions,
        revisionCycles,
        revisions,
        meetings,
        actions,
        exports,
      }),
    [transitions, revisionCycles, revisions, meetings, actions, exports],
  );

  const visible = useMemo(() => filterTimelineEvents(events, filter), [events, filter]);

  // Stale-selection safety: if the selected event is no longer in the visible
  // filtered set (filter changed or the source refetched and dropped it), clear
  // the selection so the inspector never shows a hidden/removed event. Returning
  // to All does NOT silently restore the previously hidden selection.
  const selected = useMemo(() => {
    if (selectedId === null) return null;
    return visible.find((event) => event.id === selectedId) ?? null;
  }, [selectedId, visible]);

  useEffect(() => {
    if (selectedId !== null && selected === null) {
      setSelectedId(null);
    }
  }, [selected, selectedId]);

  const cycleById = useMemo(
    () => new Map(revisionCycles.map((cycle) => [cycle.revisionCycleId, cycle])),
    [revisionCycles],
  );

  if (events.length === 0) {
    return (
      <section className="content-card workflow-timeline" aria-label="Workflow Timeline">
        <h2>Workflow Timeline</h2>
        <p className="muted-copy">No recorded workflow transitions yet.</p>
        <p className="muted-copy">
          Structured history is recorded from the first tracked workflow transition.
        </p>
      </section>
    );
  }

  const shown = showAll ? visible : visible.slice(0, 8);

  return (
    <section className="content-card workflow-timeline" aria-label="Workflow Timeline">
      <div className="timeline-head">
        <h2>Workflow Timeline</h2>
        <div className="timeline-filters" role="group" aria-label="Timeline filters">
          {(Object.keys(TIMELINE_FILTER_LABELS) as TimelineFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`timeline-filter ${filter === key ? 'active' : ''}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {TIMELINE_FILTER_LABELS[key]}
            </button>
          ))}
        </div>
      </div>
      <div className="timeline-layout">
        <ol className="workflow-timeline-list">
          {shown.map((event) => {
            const cycle =
              event.type === 'workflow' &&
              event.payload.kind === 'workflow' &&
              event.payload.revisionCycleId
                ? (cycleById.get(event.payload.revisionCycleId) ?? null)
                : null;
            const isOpening =
              event.type === 'workflow' &&
              event.payload.kind === 'workflow' &&
              event.payload.toStatus === 'RevisionRequired';
            return (
              <li key={event.id} className="workflow-timeline-event">
                <button
                  type="button"
                  className={`timeline-event-row ${selectedId === event.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(event.id)}
                >
                  <span className="timeline-event-title">
                    <EventTypeBadge type={event.type} />
                    <strong>{event.title}</strong>
                  </span>
                  <time dateTime={event.timestamp}>
                    {formatDate(event.timestamp, {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </button>
                {event.type === 'workflow' && event.payload.kind === 'workflow' ? (
                  <div className="workflow-timeline-event-meta">
                    {cycle ? (
                      <span className="cycle-badge">
                        Cycle {cycle.cycleNumber} · {cycleStatusLabel(cycle.status)}
                      </span>
                    ) : null}
                    {isOpening && cycle ? (
                      <span className="workflow-timeline-feedback">
                        Feedback Summary: {cycle.feedbackSummary}
                      </span>
                    ) : null}
                    {!isOpening && event.payload.reason ? (
                      <span className="workflow-timeline-reason">{event.payload.reason}</span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
          {visible.length === 0 ? (
            <li className="timeline-filter-empty">
              <p className="muted-copy">
                {filter === 'all' ? 'No events yet.' : FILTER_ZERO_COPY[filter]}
              </p>
            </li>
          ) : null}
        </ol>
        {selected ? (
          <EventInspector projectId={projectId} event={selected} />
        ) : (
          <aside className="event-inspector" aria-label="Event inspector">
            <p className="muted-copy">Select an event to view its details.</p>
          </aside>
        )}
      </div>
      {visible.length > 8 ? (
        <button
          className="inline-text-button"
          type="button"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? 'Show less' : `Show full history (${visible.length})`}
        </button>
      ) : null}
    </section>
  );
}
