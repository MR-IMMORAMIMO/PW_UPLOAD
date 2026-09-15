import { describe, expect, it } from 'vitest';
import type {
  ProjectActionItem,
  ProjectExportRecord,
  ProjectMeeting,
  ProjectRevision,
  WorkflowTransitionRecord,
} from '@scli/domain';
import {
  filterTimelineEvents,
  normalizeProjectTimeline,
  type NormalizeProjectTimelineInput,
} from './project-timeline-model';

const timestamp = '2026-08-01T08:00:00.000Z';

function transition(overrides: Partial<WorkflowTransitionRecord> = {}): WorkflowTransitionRecord {
  return {
    transitionId: 't1',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    sequence: 1,
    fromStatus: 'Planning',
    toStatus: 'InProgress',
    occurredAt: timestamp,
    actorId: null,
    reason: null,
    revisionCycleId: null,
    ...overrides,
  };
}

function revision(overrides: Partial<ProjectRevision> = {}): ProjectRevision {
  return {
    id: 'r1',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    revisionNumber: 1,
    title: 'First issue',
    status: 'Issued',
    receivedAt: null,
    dueDate: null,
    issuedAt: '2026-08-02T08:00:00.000Z',
    summary: 'Initial issue.',
    changeLog: 'First issue.',
    sourceType: 'Manual',
    sourceReference: '',
    locked: true,
    snapshotHash: '',
    reissueNumber: 0,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-02T08:00:00.000Z',
    ...overrides,
  };
}

function meeting(overrides: Partial<ProjectMeeting> = {}): ProjectMeeting {
  return {
    id: 'm1',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    title: 'Kickoff',
    purpose: '',
    startAt: '2026-08-03T08:00:00.000Z',
    endAt: '2026-08-03T09:00:00.000Z',
    location: 'Site',
    attendees: ['Client'],
    agenda: 'Scope review',
    notes: '',
    decisions: '',
    onlineMeetingUrl: '',
    externalEventId: null,
    status: 'Held',
    createdAt: '2026-08-03T07:00:00.000Z',
    updatedAt: '2026-08-03T09:00:00.000Z',
    ...overrides,
  };
}

function action(overrides: Partial<ProjectActionItem> = {}): ProjectActionItem {
  return {
    id: 'a1',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    title: 'Send layout',
    details: 'Send the layout to the client.',
    owner: 'Mohamed',
    ownerRole: '',
    dueDate: '2026-08-10',
    status: 'Open',
    priority: 'High',
    sourceType: 'Manual',
    sourceId: null,
    revisionId: null,
    categoryId: null,
    notes: '',
    completedAt: null,
    createdAt: '2026-08-04T08:00:00.000Z',
    updatedAt: '2026-08-04T08:00:00.000Z',
    ...overrides,
  };
}

function exportRecord(overrides: Partial<ProjectExportRecord> = {}): ProjectExportRecord {
  return {
    id: 'e1',
    projectId: 'aaaaaaaa-0000-4000-8000-000000000001',
    revision: 1,
    excelPath: 'x.xlsx',
    pdfPath: 'x.pdf',
    datasheetFolder: 'ds',
    scheduleExcelPath: 's.xlsx',
    schedulePdfPath: 's.pdf',
    boqExcelPath: 'b.xlsx',
    boqPdfPath: 'b.pdf',
    createdAt: '2026-08-02T08:00:00.000Z',
    ...overrides,
  };
}

function input(
  overrides: Partial<NormalizeProjectTimelineInput> = {},
): NormalizeProjectTimelineInput {
  return {
    transitions: [],
    revisionCycles: [],
    revisions: [],
    meetings: [],
    actions: [],
    exports: [],
    ...overrides,
  };
}

describe('normalizeProjectTimeline', () => {
  it('normalizes workflow, revision, meeting, and action events', () => {
    const events = normalizeProjectTimeline(
      input({
        transitions: [transition()],
        revisions: [revision()],
        meetings: [meeting()],
        actions: [action()],
      }),
    );
    expect(events.map((e) => e.type).sort()).toEqual(['action', 'meeting', 'revision', 'workflow']);
  });

  it('preserves canonical source IDs and namespaces the UI/event id', () => {
    const events = normalizeProjectTimeline(
      input({
        transitions: [transition({ transitionId: 't1' })],
        revisions: [revision({ id: 'r1' })],
        meetings: [meeting({ id: 'm1' })],
        actions: [action({ id: 'a1' })],
      }),
    );
    expect(events.find((e) => e.type === 'workflow')!.sourceId).toBe('t1');
    expect(events.find((e) => e.type === 'revision')!.sourceId).toBe('r1');
    expect(events.find((e) => e.type === 'meeting')!.sourceId).toBe('m1');
    expect(events.find((e) => e.type === 'action')!.sourceId).toBe('a1');
    // Namespaced UI identity, raw canonical source id preserved separately.
    expect(events.find((e) => e.type === 'revision')!.id).toBe('revision:r1');
    expect(events.find((e) => e.type === 'meeting')!.id).toBe('meeting:m1');
  });

  it('same raw UUID across two source families does not collide', () => {
    const shared = 'bbbbbbbb-0000-4000-8000-000000000001';
    const events = normalizeProjectTimeline(
      input({
        transitions: [transition({ transitionId: shared, occurredAt: '2026-08-05T08:00:00.000Z' })],
        revisions: [revision({ id: shared, issuedAt: '2026-08-04T08:00:00.000Z' })],
        meetings: [meeting({ id: shared, startAt: '2026-08-03T08:00:00.000Z' })],
        actions: [action({ id: shared, createdAt: '2026-08-02T08:00:00.000Z' })],
      }),
    );
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual([
      'workflow:bbbbbbbb-0000-4000-8000-000000000001',
      'revision:bbbbbbbb-0000-4000-8000-000000000001',
      'meeting:bbbbbbbb-0000-4000-8000-000000000001',
      'action:bbbbbbbb-0000-4000-8000-000000000001',
    ]);
  });

  it('exposes semantic project section targets, not root-level routes', () => {
    const events = normalizeProjectTimeline(
      input({
        transitions: [transition()],
        revisions: [revision()],
        meetings: [meeting()],
        actions: [action()],
      }),
    );
    expect(events.find((e) => e.type === 'workflow')!.sourceSection).toBe('workflow');
    expect(events.find((e) => e.type === 'revision')!.sourceSection).toBe('revisions');
    expect(events.find((e) => e.type === 'meeting')!.sourceSection).toBe('meetings');
    expect(events.find((e) => e.type === 'action')!.sourceSection).toBe('actions');
    for (const event of events) {
      expect(event.sourceSection.startsWith('/')).toBe(false);
    }
  });

  it('omits optional actor/notes when missing', () => {
    const events = normalizeProjectTimeline(
      input({
        transitions: [transition({ reason: null })],
        revisions: [revision({ summary: '' })],
        meetings: [meeting({ agenda: '' })],
        actions: [action({ owner: '', details: '' })],
      }),
    );
    const workflow = events.find((e) => e.type === 'workflow')!;
    const revisionEvent = events.find((e) => e.type === 'revision')!;
    const meetingEvent = events.find((e) => e.type === 'meeting')!;
    const actionEvent = events.find((e) => e.type === 'action')!;
    expect('notes' in workflow).toBe(false);
    expect('notes' in revisionEvent).toBe(false);
    expect('notes' in meetingEvent).toBe(false);
    expect('actor' in actionEvent).toBe(false);
    expect('notes' in actionEvent).toBe(false);
  });

  it('orders most-recent-first with deterministic secondary order', () => {
    const events = normalizeProjectTimeline(
      input({
        transitions: [transition({ occurredAt: '2026-08-01T08:00:00.000Z' })],
        revisions: [revision({ issuedAt: '2026-08-02T08:00:00.000Z' })],
        meetings: [meeting({ startAt: '2026-08-03T08:00:00.000Z' })],
        actions: [action({ createdAt: '2026-08-04T08:00:00.000Z' })],
      }),
    );
    expect(events.map((e) => e.type)).toEqual(['action', 'meeting', 'revision', 'workflow']);
  });

  it('does not mutate input arrays', () => {
    const transitions = [transition()];
    const revisions = [revision()];
    const meetings = [meeting()];
    const actions = [action()];
    const before = {
      transitions: [...transitions],
      revisions: [...revisions],
      meetings: [...meetings],
      actions: [...actions],
    };
    normalizeProjectTimeline(input({ transitions, revisions, meetings, actions }));
    expect(transitions).toEqual(before.transitions);
    expect(revisions).toEqual(before.revisions);
    expect(meetings).toEqual(before.meetings);
    expect(actions).toEqual(before.actions);
  });

  it('links revision related outputs only when the revision matches', () => {
    const events = normalizeProjectTimeline(
      input({
        revisions: [revision({ revisionNumber: 1 })],
        exports: [exportRecord({ revision: 1 }), exportRecord({ id: 'e2', revision: 2 })],
      }),
    );
    const revisionEvent = events.find((e) => e.type === 'revision')!;
    expect(revisionEvent.payload.kind).toBe('revision');
    if (revisionEvent.payload.kind === 'revision') {
      expect(revisionEvent.payload.relatedOutputs.length).toBe(1);
    }
  });

  it('links meeting related actions only when sourceId matches', () => {
    const events = normalizeProjectTimeline(
      input({
        meetings: [meeting({ id: 'm1' })],
        actions: [action({ id: 'a1', sourceId: 'm1' }), action({ id: 'a2', sourceId: 'other' })],
      }),
    );
    const meetingEvent = events.find((e) => e.type === 'meeting')!;
    if (meetingEvent.payload.kind === 'meeting') {
      expect(meetingEvent.payload.relatedActions.length).toBe(1);
    }
  });
});

describe('filterTimelineEvents', () => {
  const events = normalizeProjectTimeline(
    input({
      transitions: [transition()],
      revisions: [revision()],
      meetings: [meeting()],
      actions: [action()],
    }),
  );

  it('all returns everything', () => {
    expect(filterTimelineEvents(events, 'all').length).toBe(4);
  });

  it('filters by each type', () => {
    expect(filterTimelineEvents(events, 'workflow').map((e) => e.type)).toEqual(['workflow']);
    expect(filterTimelineEvents(events, 'revisions').map((e) => e.type)).toEqual(['revision']);
    expect(filterTimelineEvents(events, 'meetings').map((e) => e.type)).toEqual(['meeting']);
    expect(filterTimelineEvents(events, 'actions').map((e) => e.type)).toEqual(['action']);
  });

  it('does not mutate the input list', () => {
    const before = [...events];
    filterTimelineEvents(events, 'workflow');
    expect(events).toEqual(before);
  });
});
