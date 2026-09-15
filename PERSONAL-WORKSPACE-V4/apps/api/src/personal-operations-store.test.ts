import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@scli/config';
import type { ProjectMeetingInput } from '@scli/contracts';
import type { Project } from '@scli/domain';
import { DomainError } from '@scli/domain';
import { PersonalWorkspaceStore } from './personal-workspace-store';

const stores: PersonalWorkspaceStore[] = [];
const temporaryRoots: string[] = [];

function createStore(): PersonalWorkspaceStore {
  const store = new PersonalWorkspaceStore(
    loadConfig({
      APP_MODE: 'mock',
      WORKSPACE_VARIANT: 'personal',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    }),
  );
  stores.push(store);
  return store;
}

it('keeps contact groups separate from roles, replaces Primary within one group, and archives without deleting identity', () => {
  const store = createStore();
  const projectId = '13131313-1313-4131-8131-131313131313';
  store.initializeProject(
    projectId,
    ['LightingLayout'],
    'Full Lighting Design',
    'Later',
    '2026-09-11',
  );
  const input = {
    name: 'First',
    email: '',
    company: '',
    role: 'Project Manager',
    group: 'Client',
    isPrimary: true,
    notes: 'Design approvals',
  };
  const first = store.operations.createContact(projectId, input);
  const sales = store.operations.createContact(projectId, {
    ...input,
    name: 'Sales',
    group: 'Sales',
  });
  const next = store.operations.createContact(projectId, {
    ...input,
    name: 'Second',
    role: 'Architect',
  });
  let contacts = store.getWorkspace(projectId).contacts;
  expect(contacts.find((contact) => contact.id === first.id)?.isPrimary).toBe(false);
  expect(contacts.find((contact) => contact.id === sales.id)?.isPrimary).toBe(true);
  expect(contacts.find((contact) => contact.id === next.id)).toMatchObject({
    group: 'Client',
    role: 'Architect',
    email: '',
    isPrimary: true,
    notes: 'Design approvals',
  });
  store.operations.updateContact(projectId, next.id, { ...input, name: 'Second', archived: true });
  contacts = store.getWorkspace(projectId).contacts;
  expect(contacts.find((contact) => contact.id === next.id)?.archived).toBe(true);
  expect(contacts).toHaveLength(3);
  store.operations.updateContact(projectId, next.id, { ...input, name: 'Second', archived: false });
  expect(
    store.getWorkspace(projectId).contacts.find((contact) => contact.id === next.id)?.archived,
  ).toBe(false);
});

it('searches canonical luminaires and limits all record results to authorized projects, including literal wildcards', () => {
  const store = createStore();
  const allowed = '11111111-1111-4111-8111-111111111111';
  const hidden = '22222222-2222-4222-8222-222222222222';
  for (const projectId of [allowed, hidden]) {
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Manual',
      '2026-10-01',
    );
    store.operations.createAction(projectId, {
      title: 'Find 50% output',
      details: '',
      owner: '',
      ownerRole: '',
      dueDate: '2026-10-01',
      status: 'Open',
      priority: 'Normal',
      sourceType: 'Manual',
      sourceId: null,
      revisionId: null,
      notes: '',
    });
    store.addLuminaire(projectId, {
      tag: 'FIND-DL01',
      category: 'Downlight',
      imagePath: '',
      description: '',
      manufacturer: 'Search Maker',
      model: 'Model 50%',
      wattage: '',
      lumens: '',
      lightColor: '',
      cri: '',
      beamAngle: '',
      ipRating: '',
      mounting: '',
      cutout: '',
      driver: '',
      control: '',
      emergency: '',
      datasheetPath: '',
      location: '',
      unit: 'No.',
      quantity: 1,
      notes: '',
      sourceName: '',
      dimensions: '',
      bodyColorFinish: '',
    });
  }
  const projects = [
    {
      id: allowed,
      projectCode: 'P-1',
      projectName: 'Visible',
      clientName: '',
      siteLocation: '',
      updatedAt: '2026-09-12T00:00:00.000Z',
    },
  ] as Project[];
  const results = store.operations.search('Find', projects);
  expect(results.some((result) => result.type === 'Luminaire')).toBe(true);
  expect(results.some((result) => result.type === 'Action')).toBe(true);
  expect(results.every((result) => result.projectId === allowed)).toBe(true);
  expect(store.operations.search('Find', [])).toEqual([]);
  const literal = store.operations.search('50%', projects);
  expect(literal.map((item) => item.type).sort()).toEqual(['Action', 'Luminaire']);
  expect(store.operations.search('50_', projects)).toEqual([]);
});

function createTemporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'scli-personal-store-'));
  temporaryRoots.push(root);
  return root;
}

it('edits reply text with concurrency protection and preserves its original author and time', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-11T10:00:00Z'));
  const store = createStore();
  const projectId = '13131313-1313-4131-8131-131313131313';
  store.initializeProject(
    projectId,
    ['LightingLayout'],
    'Full Lighting Design',
    'Later',
    '2026-09-11',
  );
  const review = store.operations.createReview(projectId, {
    reference: 'C-1',
    title: 'Review',
    description: '',
    area: '',
    luminaireTag: '',
    drawingReference: '',
    sourceType: 'Manual',
    sourceId: null,
    status: 'Open',
    response: '',
    revisionId: null,
    receivedAt: '2026-09-11',
    dueDate: null,
  });
  const author = { id: 'original-author', displayName: 'Original Author', jobTitle: 'Designer' };
  const reply = store.operations.createReviewReply(
    projectId,
    review.id,
    { origin: 'Internal', body: 'Original text' },
    author,
  );
  vi.setSystemTime(new Date('2026-09-11T11:00:00Z'));
  const edited = store.operations.updateReviewReply(
    projectId,
    review.id,
    reply.id,
    { body: 'Corrected text', expectedUpdatedAt: reply.updatedAt },
    { ...author, id: 'editor', displayName: 'Editor' },
  );
  expect(edited).toMatchObject({
    body: 'Corrected text',
    authorId: author.id,
    authorNameSnapshot: author.displayName,
    createdAt: reply.createdAt,
  });
  expect(edited.updatedAt).not.toBe(reply.updatedAt);
  expect(() =>
    store.operations.updateReviewReply(
      projectId,
      review.id,
      reply.id,
      { body: 'Stale overwrite', expectedUpdatedAt: reply.updatedAt },
      author,
    ),
  ).toThrow('This reply changed');
  expect(() =>
    store.operations.updateReviewReply(
      'other-project',
      review.id,
      reply.id,
      { body: 'Cross-project', expectedUpdatedAt: edited.updatedAt },
      author,
    ),
  ).toThrow('not found');
});

afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (temporaryRoots.length) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

describe('personal project operations workspace', () => {
  it('preserves base and independent Meeting authority across legacy-compatible updates', () => {
    const store = createStore();
    const projectId = '13131313-1313-4131-8131-131313131313';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const input = {
      title: 'Original',
      purpose: 'Keep purpose',
      startAt: '2026-08-10T08:00:00.000Z',
      endAt: '2026-08-10T09:00:00.000Z',
      location: 'Room',
      attendees: ['A'],
      agenda: 'Legacy agenda',
      notes: 'Legacy notes',
      decisions: 'Legacy decision',
      onlineMeetingUrl: 'https://meet.example.test/a',
      externalEventId: 'event-1',
      status: 'Planned' as const,
      participants: [
        { id: '40000000-0000-4000-8000-000000000001', name: 'A', role: 'Client', sortOrder: 0 },
      ],
      agendaItems: [
        { id: '50000000-0000-4000-8000-000000000001', content: 'Legacy first', sortOrder: 0 },
      ],
    };
    const meeting = store.operations.createMeeting(projectId, input);
    const action = store.operations.createAction(projectId, {
      title: 'Linked',
      details: '',
      owner: 'Owner',
      ownerRole: '',
      dueDate: null,
      status: 'Open',
      priority: 'Normal',
      sourceType: 'Manual',
      sourceId: null,
      revisionId: null,
      notes: '',
    });
    store.operations.createMeetingNote(projectId, meeting.id, {
      content: 'Structured\nnote',
      authorName: 'Author',
    });
    store.operations.linkMeetingAction(projectId, meeting.id, {
      actionId: action.id,
      relationType: 'Linked',
    });
    for (const change of [
      { title: 'Title changed' },
      { status: 'Held' as const },
      { startAt: '2026-08-11T08:00:00.000Z', endAt: '2026-08-11T09:30:00.000Z' },
    ]) {
      const current = store.operations.getMeetingDetail(projectId, meeting.id);
      const legacy: ProjectMeetingInput = { ...input, ...change };
      delete legacy.purpose;
      delete legacy.participants;
      delete legacy.agendaItems;
      const updated = store.operations.updateMeeting(projectId, meeting.id, legacy);
      expect(updated.id).toBe(meeting.id);
      expect(updated).toMatchObject({
        purpose: 'Keep purpose',
        attendees: ['A'],
        agenda: 'Legacy agenda',
        notes: 'Legacy notes',
        decisions: 'Legacy decision',
        onlineMeetingUrl: 'https://meet.example.test/a',
        externalEventId: 'event-1',
      });
      expect(store.operations.getMeetingDetail(projectId, meeting.id)).toMatchObject({
        participants: current.participants,
        agendaItems: current.agendaItems,
        notesCount: 1,
        linkedActions: [expect.objectContaining({ id: action.id })],
      });
    }
  });

  it('reconciles Meeting children, notes, relations, and rolls back invalid nested updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T08:00:00.000Z'));
    const store = createStore();
    const projectId = '14141414-1414-4141-8141-141414141414';
    const otherProject = '15151515-1515-4151-8151-151515151515';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    store.initializeProject(
      otherProject,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const base = {
      title: 'Meeting',
      purpose: 'Purpose',
      startAt: '2026-08-10T08:00:00.000Z',
      endAt: '2026-08-10T09:00:00.000Z',
      location: '',
      attendees: [],
      agenda: 'Legacy agenda',
      notes: 'Legacy notes',
      decisions: '',
      onlineMeetingUrl: '',
      externalEventId: null,
      status: 'Planned' as const,
    };
    const meeting = store.operations.createMeeting(projectId, {
      ...base,
      participants: [
        { id: '60000000-0000-4000-8000-000000000001', name: 'Same', role: 'One', sortOrder: 0 },
        { id: '60000000-0000-4000-8000-000000000002', name: 'Same', role: 'Two', sortOrder: 1 },
      ],
      agendaItems: [
        { id: '70000000-0000-4000-8000-000000000001', content: 'One', sortOrder: 0 },
        { id: '70000000-0000-4000-8000-000000000002', content: 'Two', sortOrder: 1 },
      ],
    });
    const other = store.operations.createMeeting(otherProject, {
      ...base,
      participants: [
        { id: '60000000-0000-4000-8000-000000000099', name: 'Foreign', role: '', sortOrder: 0 },
      ],
    });
    const before = store.operations.updateMeeting(projectId, meeting.id, {
      ...base,
      title: 'Edited',
      participants: [
        { id: '60000000-0000-4000-8000-000000000002', name: 'Same', role: 'Changed', sortOrder: 0 },
        { id: '60000000-0000-4000-8000-000000000001', name: 'Same', role: 'One', sortOrder: 1 },
        { name: 'New', role: '', sortOrder: 2 },
      ],
      agendaItems: [
        { id: '70000000-0000-4000-8000-000000000002', content: 'Two edited', sortOrder: 0 },
      ],
    });
    const participants = store.operations.listMeetingParticipants(projectId, meeting.id);
    const agenda = store.operations.listMeetingAgendaItems(projectId, meeting.id);
    expect(participants.slice(0, 2).map((item) => item.id)).toEqual([
      '60000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000001',
    ]);
    expect(participants[2]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(agenda).toMatchObject([
      { id: '70000000-0000-4000-8000-000000000002', content: 'Two edited' },
    ]);
    expect(before.agenda).toBe('Legacy agenda');
    expect(() =>
      store.operations.updateMeeting(projectId, meeting.id, {
        ...base,
        title: 'Must rollback',
        participants: [
          {
            id: store.operations.listMeetingParticipants(otherProject, other.id)[0]!.id,
            name: 'Foreign',
            role: '',
            sortOrder: 0,
          },
        ],
      }),
    ).toThrow(/does not belong/i);
    expect(store.operations.getMeetingDetail(projectId, meeting.id).title).toBe('Edited');
    vi.setSystemTime(new Date('2026-08-01T09:00:00.000Z'));
    const first = store.operations.createMeetingNote(projectId, meeting.id, {
      content: 'First\nline',
      authorName: 'A',
    });
    vi.setSystemTime(new Date('2026-08-01T10:00:00.000Z'));
    const second = store.operations.createMeetingNote(projectId, meeting.id, {
      content: 'Second',
      authorName: 'B',
    });
    expect(store.operations.listMeetingNotes(projectId, meeting.id).map((note) => note.id)).toEqual(
      [second.id, first.id],
    );
    const changed = store.operations.updateMeetingNote(projectId, meeting.id, first.id, {
      content: 'Updated\nline',
      authorName: 'A2',
    });
    expect(changed.updatedAt).toBe('2026-08-01T10:00:00.000Z');
    store.operations.deleteMeetingNote(projectId, meeting.id, second.id);
    expect(store.operations.getMeetingDetail(projectId, meeting.id)).toMatchObject({
      notesCount: 1,
      latestNote: { id: first.id, content: 'Updated\nline' },
    });
    const action = store.operations.createAction(projectId, {
      title: 'A',
      details: '',
      owner: 'O',
      ownerRole: '',
      dueDate: null,
      status: 'Open',
      priority: 'High',
      sourceType: 'Manual',
      sourceId: null,
      revisionId: null,
      notes: '',
    });
    const link = store.operations.linkMeetingAction(projectId, meeting.id, {
      actionId: action.id,
      relationType: 'Linked',
    });
    expect(
      store.operations.linkMeetingAction(projectId, meeting.id, {
        actionId: action.id,
        relationType: 'CreatedFromMeeting',
      }).id,
    ).toBe(link.id);
    expect(store.operations.listActionMeetingLinks(projectId, action.id)).toMatchObject([
      { meetingId: meeting.id, relationType: 'Linked' },
    ]);
    store.operations.unlinkMeetingAction(projectId, meeting.id, action.id);
    expect(store.operations.getMeetingDetail(projectId, meeting.id).linkedActions).toHaveLength(0);
    expect(store.getWorkspace(projectId).actions).toHaveLength(1);
  });

  it('rolls back Action creation when the Meeting link insert fails after the Action insert', () => {
    const store = createStore();
    const projectId = '16161616-1616-4161-8161-161616161616';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const meeting = store.operations.createMeeting(projectId, {
      title: 'Rollback',
      startAt: '2026-08-10T08:00:00.000Z',
      endAt: '2026-08-10T09:00:00.000Z',
      location: '',
      attendees: [],
      agenda: '',
      notes: '',
      decisions: '',
      onlineMeetingUrl: '',
      externalEventId: null,
      status: 'Planned',
    });
    const database = store.getSharedDatabase();
    database.exec(
      `CREATE TRIGGER reject_meeting_action_link BEFORE INSERT ON meeting_action_links BEGIN SELECT RAISE(ABORT, 'forced link failure'); END`,
    );
    expect(() =>
      store.operations.createActionFromMeeting(projectId, meeting.id, {
        title: 'Must not persist',
        details: 'Rollback proof',
        owner: 'Owner',
        ownerRole: '',
        dueDate: null,
        status: 'Open',
        priority: 'Normal',
        revisionId: null,
        categoryId: null,
        notes: '',
      }),
    ).toThrow(/forced link failure/i);
    database.exec('DROP TRIGGER reject_meeting_action_link');
    expect(store.getWorkspace(projectId).actions).toHaveLength(0);
    expect(store.operations.listMeetingActionLinks(projectId, meeting.id)).toHaveLength(0);
    expect(store.getWorkspace(projectId).meetings).toHaveLength(1);
  });
  it('provides canonical Meeting list and detail authority without copying linked Actions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T08:00:00.000Z'));
    const store = createStore();
    const projectId = '12121212-1212-4121-8121-121212121212';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const action = store.operations.createAction(projectId, {
      title: 'Original linked action',
      details: '',
      owner: 'Sara',
      ownerRole: '',
      dueDate: '2026-08-20',
      status: 'Open',
      priority: 'High',
      sourceType: 'Manual',
      sourceId: null,
      revisionId: null,
      notes: '',
    });
    const meeting = store.operations.createMeeting(projectId, {
      title: 'Authority meeting',
      purpose: 'Prove the Inspector authority.',
      startAt: '2026-08-12T20:30:00.000Z',
      endAt: '2026-08-12T21:30:00.000Z',
      location: 'Dubai',
      attendees: ['legacy'],
      agenda: 'Legacy agenda',
      notes: 'Legacy notes',
      decisions: 'Proceed',
      onlineMeetingUrl: '',
      externalEventId: null,
      status: 'Planned',
      participants: [
        {
          id: '20000000-0000-4000-8000-000000000002',
          name: 'Second',
          role: 'Reviewer',
          sortOrder: 1,
        },
        { id: '20000000-0000-4000-8000-000000000001', name: 'First', role: 'Owner', sortOrder: 0 },
      ],
      agendaItems: [
        { id: '30000000-0000-4000-8000-000000000002', content: 'Second agenda', sortOrder: 1 },
        { id: '30000000-0000-4000-8000-000000000001', content: 'First agenda', sortOrder: 0 },
      ],
    });
    store.operations.linkMeetingAction(projectId, meeting.id, {
      actionId: action.id,
      relationType: 'Linked',
    });
    store.operations.createMeetingNote(projectId, meeting.id, {
      content: 'First note',
      authorName: 'Aisha',
    });
    vi.setSystemTime(new Date('2026-08-10T09:00:00.000Z'));
    const latest = store.operations.createMeetingNote(projectId, meeting.id, {
      content: 'Latest note',
      authorName: 'Omar',
    });
    const created = store.operations.createActionFromMeeting(projectId, meeting.id, {
      title: 'Created action',
      details: '',
      owner: 'Omar',
      ownerRole: '',
      dueDate: null,
      status: 'Open',
      priority: 'Normal',
      revisionId: null,
      categoryId: null,
      notes: '',
    });
    const list = store.operations.listMeetingReadModels(projectId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: meeting.id,
      purpose: 'Prove the Inspector authority.',
      participantsCount: 2,
      notesCount: 2,
      linkedActionsCount: 2,
      actionsCreatedCount: 1,
    });
    expect(list[0]?.participantPreview.map((participant) => participant.id)).toEqual([
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
    ]);
    expect(list[0]?.latestNoteSummary).toMatchObject({
      id: latest.id,
      authorName: 'Omar',
      updatedAt: '2026-08-10T09:00:00.000Z',
    });
    const updated = store.operations.updateAction(projectId, action.id, {
      ...action,
      title: 'Live linked action',
    });
    const detail = store.operations.getMeetingDetail(projectId, meeting.id);
    expect(detail.participants.map((participant) => participant.name)).toEqual(['First', 'Second']);
    expect(detail.agendaItems.map((item) => item.content)).toEqual([
      'First agenda',
      'Second agenda',
    ]);
    expect(detail).toMatchObject({
      notesCount: 2,
      latestNote: { id: latest.id },
      actionsCreatedCount: 1,
    });
    expect(detail.linkedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: updated.id,
          title: 'Live linked action',
          relationType: 'Linked',
        }),
        expect.objectContaining({ id: created.id, relationType: 'CreatedFromMeeting' }),
      ]),
    );
  });

  it('round-trips and clears canonical Action owner role and multiline notes without lifecycle changes', () => {
    const store = createStore();
    const projectId = '10101010-1010-4010-8010-101010101010';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const created = store.operations.createAction(projectId, {
      title: 'Review layout',
      details: 'Review the updated layout.',
      owner: 'Mohamed',
      ownerRole: 'Lighting Designer',
      dueDate: '2026-08-10',
      status: 'Open',
      priority: 'High',
      sourceType: 'Manual',
      sourceId: null,
      revisionId: null,
      notes: 'First line\nSecond line',
    });
    expect(store.getWorkspace(projectId).actions).toContainEqual(
      expect.objectContaining({ ownerRole: 'Lighting Designer', notes: 'First line\nSecond line' }),
    );
    const completed = store.operations.updateAction(projectId, created.id, {
      title: created.title,
      details: created.details,
      owner: created.owner,
      ownerRole: created.ownerRole,
      dueDate: created.dueDate,
      status: 'Completed',
      priority: created.priority,
      sourceType: created.sourceType,
      sourceId: created.sourceId,
      revisionId: created.revisionId,
      categoryId: created.categoryId,
      notes: created.notes,
    });
    expect(completed).toMatchObject({
      status: 'Completed',
      ownerRole: 'Lighting Designer',
      notes: 'First line\nSecond line',
    });
    const cleared = store.operations.updateAction(projectId, completed.id, {
      title: 'Review layout title edit',
      details: completed.details,
      owner: completed.owner,
      ownerRole: '',
      dueDate: completed.dueDate,
      status: completed.status,
      priority: completed.priority,
      sourceType: completed.sourceType,
      sourceId: completed.sourceId,
      revisionId: completed.revisionId,
      categoryId: completed.categoryId,
      notes: '',
    });
    expect(cleared).toMatchObject({
      title: 'Review layout title edit',
      status: 'Completed',
      ownerRole: '',
      notes: '',
    });
  });

  it('seeds scope checklists and persists the full project operating record', () => {
    const store = createStore();
    const projectId = '11111111-1111-4111-8111-111111111111';
    store.initializeProject(
      projectId,
      ['LightingLayout', 'DialuxReport', 'Visualization3D'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const initial = store.getWorkspace(projectId);
    expect(initial.checklist.length).toBeGreaterThan(10);
    expect(initial.health.checklistPercent).toBe(0);

    store.operations.createRequirement(projectId, {
      category: 'Client Information',
      title: 'Latest reflected ceiling plan',
      details: 'Required before layout coordination.',
      requestedFrom: 'Client',
      requestedAt: '2026-08-02',
      dueDate: '2026-08-03',
      status: 'Requested',
      impact: 'Blocking',
      sourceType: 'Email',
      sourceReference: 'mail-1',
      notes: '',
      sortOrder: 0,
    });
    store.operations.createAction(projectId, {
      title: 'Update ground floor layout',
      details: 'Apply the received comments.',
      owner: 'Mohamed',
      ownerRole: '',
      dueDate: '2026-08-01',
      status: 'Open',
      priority: 'High',
      sourceType: 'Manual',
      sourceId: null,
      revisionId: null,
      notes: '',
    });
    store.operations.createMeeting(projectId, {
      title: 'Client design review',
      startAt: '2026-08-04T08:00:00.000Z',
      endAt: '2026-08-04T09:00:00.000Z',
      location: 'Online',
      attendees: ['client@example.com'],
      agenda: 'Review lighting comments.',
      notes: '',
      decisions: 'Revise the entrance feature lighting.',
      onlineMeetingUrl: '',
      externalEventId: null,
      status: 'Planned',
    });
    store.operations.createReview(projectId, {
      reference: 'C-01',
      title: 'Entrance lighting update',
      description: 'Revise the decorative pendant arrangement.',
      area: 'Entrance',
      luminaireTag: 'PD01',
      drawingReference: 'L-101',
      sourceType: 'Meeting',
      sourceId: null,
      status: 'Open',
      response: '',
      revisionId: null,
      receivedAt: '2026-08-02',
      dueDate: '2026-08-07',
    });
    store.operations.createRevision(projectId, {
      revisionNumber: 1,
      reissueNumber: 0,
      title: 'Client comments revision',
      status: 'InProgress',
      receivedAt: '2026-08-02',
      dueDate: '2026-08-07',
      issuedAt: null,
      summary: 'Entrance and living room lighting comments.',
      changeLog: '',
      sourceType: 'Meeting',
      sourceReference: '',
    });
    store.operations.createDocument(projectId, {
      category: 'Drawing',
      documentNumber: 'L-101',
      title: 'Ground Floor Lighting Layout',
      revision: 'REV_01',
      status: 'Working',
      filePath: 'C:\\Projects\\L-101.dwg',
      issuedTo: '',
      issueDate: null,
      notes: '',
    });
    store.operations.createContact(projectId, {
      name: 'Client Contact',
      email: 'client@example.com',
      company: 'Client',
      role: 'Client',
    });
    store.operations.upsertCommunication({
      externalId: 'mail-1',
      kind: 'Email',
      conversationId: 'conversation-1',
      subject: 'Lighting comments',
      sender: 'client@example.com',
      participants: ['designer@example.com'],
      occurredAt: '2026-08-02T07:00:00.000Z',
      endAt: null,
      preview: 'Please revise the entrance lighting.',
      webLink: 'https://outlook.office.com/mail/id/mail-1',
      hasAttachments: true,
      projectId,
    });

    const workspace = store.getWorkspace(projectId);
    expect(workspace.requirements).toHaveLength(1);
    expect(workspace.actions).toHaveLength(1);
    expect(workspace.meetings).toHaveLength(1);
    expect(workspace.reviewItems).toHaveLength(1);
    expect(workspace.revisions).toHaveLength(1);
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.contacts).toHaveLength(1);
    expect(workspace.communications).toHaveLength(1);
    expect(workspace.activity.length).toBeGreaterThanOrEqual(7);
    expect(workspace.health.blockingRequirements).toBe(1);
    expect(workspace.health.score).toBeLessThan(60);
  });

  it('permanently deletes a requirement from the canonical workspace', () => {
    const store = createStore();
    const projectId = '11111111-1111-4111-8111-111111111111';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const created = store.operations.createRequirement(projectId, {
      category: 'Client Information',
      title: 'Latest reflected ceiling plan',
      details: 'Required before layout coordination.',
      requestedFrom: 'Client',
      requestedAt: null,
      dueDate: null,
      status: 'Requested',
      impact: 'Blocking',
      sourceType: 'Manual',
      sourceReference: '',
      notes: '',
      sortOrder: 0,
    });
    expect(store.getWorkspace(projectId).requirements).toHaveLength(1);

    store.operations.deleteRequirement(projectId, created.id);

    // The requirement is gone from the canonical read model and health counts.
    const after = store.getWorkspace(projectId);
    expect(after.requirements).toHaveLength(0);
    expect(after.health.blockingRequirements).toBe(0);
    // A Requirement Deleted activity record was appended for auditability.
    expect(
      after.activity.some(
        (entry) => entry.entityType === 'Requirement' && entry.action === 'Deleted',
      ),
    ).toBe(true);
  });

  it('throws NOT_FOUND when deleting a requirement that does not exist', () => {
    const store = createStore();
    const projectId = '11111111-1111-4111-8111-111111111111';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    expect(() => store.operations.deleteRequirement(projectId, 'missing-requirement-id')).toThrow(
      /not found/i,
    );
  });

  it('denies cross-project requirement deletion and preserves the source requirement', () => {
    const store = createStore();
    const projectA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const projectB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    store.initializeProject(
      projectA,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    store.initializeProject(
      projectB,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const requirementA = store.operations.createRequirement(projectA, {
      category: 'Client Information',
      title: 'Project A requirement',
      details: '',
      requestedFrom: 'Client',
      requestedAt: null,
      dueDate: null,
      status: 'Requested',
      impact: 'Medium',
      sourceType: 'Manual',
      sourceReference: '',
      notes: '',
      sortOrder: 0,
    });

    // Attempting to delete Project A's requirement through Project B must fail.
    expect(() => store.operations.deleteRequirement(projectB, requirementA.id)).toThrow(
      /not found/i,
    );

    // Requirement A still exists in Project A.
    const projectAWorkspace = store.getWorkspace(projectA);
    expect(projectAWorkspace.requirements.some((item) => item.id === requirementA.id)).toBe(true);
    // No Requirement Deleted activity was recorded for either project.
    expect(
      projectAWorkspace.activity.some(
        (entry) => entry.entityType === 'Requirement' && entry.action === 'Deleted',
      ),
    ).toBe(false);
    const projectBWorkspace = store.getWorkspace(projectB);
    expect(
      projectBWorkspace.activity.some(
        (entry) => entry.entityType === 'Requirement' && entry.action === 'Deleted',
      ),
    ).toBe(false);
  });

  it('keeps Microsoft configuration separate from an encrypted connection session', () => {
    const store = createStore();
    const settings = store.operations.updateMicrosoftSettings({
      tenantId: 'organizations',
      clientId: '22222222-2222-4222-8222-222222222222',
      mailSyncEnabled: true,
      calendarSyncEnabled: true,
      syncIntervalMinutes: 30,
    });
    expect(settings.connected).toBe(false);
    expect(settings.clientId).toBe('22222222-2222-4222-8222-222222222222');
    expect(store.operations.getMicrosoftToken()).toBeNull();
  });

  it('searches project records by CRM Reference alongside SCLI and SCT codes', () => {
    const store = createStore();
    const projects = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        projectCode: '023_SCT260807_DUBAI_HILLS_VILLA',
        projectName: 'Dubai Hills Villa',
        clientName: 'Client',
        siteLocation: 'Dubai',
        crmReference: 'CRM-48572',
        updatedAt: '2026-08-07T00:00:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        projectCode: '001_SCLI250919_ARKOS',
        projectName: 'ARKOS',
        clientName: 'Legacy Client',
        siteLocation: 'Sharjah',
        crmReference: null,
        updatedAt: '2026-08-06T00:00:00.000Z',
      },
    ] as unknown as Project[];

    expect(store.operations.search('CRM-48572', projects)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: projects[0]!.id, type: 'Project' }),
      ]),
    );
    expect(store.operations.search('SCT260807', projects)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: projects[0]!.id, type: 'Project' }),
      ]),
    );
    expect(store.operations.search('SCLI250919', projects)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: projects[1]!.id, type: 'Project' }),
      ]),
    );
  });

  it('uses the company calendar date when classifying overdue work', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T21:30:00.000Z'));
    const store = createStore();
    const projectId = '33333333-3333-4333-8333-333333333333';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Manual',
      '2026-08-30',
    );
    store.operations.createAction(projectId, {
      title: 'Issue coordinated layout',
      details: '',
      owner: 'Mohamed',
      ownerRole: '',
      dueDate: '2026-08-01',
      status: 'Open',
      priority: 'High',
      sourceType: 'Manual',
      sourceId: null,
      revisionId: null,
      notes: '',
    });

    expect(store.operations.portfolioOperations().overdueActions).toHaveLength(1);
    expect(store.getWorkspace(projectId).health.overdueActions).toBe(1);
  });
});

describe('flexible personal project scope', () => {
  it('persists custom scope items and keeps built-in services configurable', () => {
    const store = createStore();
    const projectId = '44444444-4444-4444-8444-444444444444';
    store.initializeProject(
      projectId,
      ['LightingDesign', 'TechnicalBoq'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
      undefined,
      undefined,
      [
        { code: 'LightingDesign', label: 'Lighting Design', custom: false },
        { code: 'TechnicalBoq', label: 'Technical BOQ', custom: false },
        { label: 'Mockup Review', custom: true },
      ],
    );
    const workspace = store.getWorkspace(projectId);
    expect(workspace.services).toEqual(['LightingDesign', 'TechnicalBoq']);
    expect(workspace.scopeItems.map((item) => item.id)).toEqual([
      'LightingDesign',
      'TechnicalBoq',
      'custom:mockup-review',
    ]);
    expect(workspace.scopeItems[2]).toMatchObject({
      label: 'Mockup Review',
      custom: true,
    });
  });

  it('removes a built-in service from scope without deleting its data', () => {
    const store = createStore();
    const projectId = '55555555-5555-4555-8555-555555555555';
    store.initializeProject(
      projectId,
      ['LightingDesign', 'TechnicalBoq', 'Datasheets'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const luminaire = store.addLuminaire(projectId, {
      tag: 'DL01',
      category: 'Downlight',
      imagePath: '',
      description: 'Trimless recessed LED downlight',
      manufacturer: 'ERCO',
      model: 'QA-100',
      wattage: '8W',
      lumens: '720 lm',
      lightColor: '3000K',
      cri: '90',
      beamAngle: '24 deg',
      ipRating: 'IP44',
      mounting: 'Recessed',
      cutout: '85 mm',
      driver: 'Remote',
      control: 'DALI',
      emergency: 'No',
      datasheetPath: '',
      location: 'Ground Floor',
      unit: 'No.',
      quantity: 12,
      notes: '',
      sourceName: '',
      dimensions: '',
      bodyColorFinish: '',
    });
    const before = store.getWorkspace(projectId);
    expect(before.deliverables.some((item) => item.serviceCode === 'TechnicalBoq')).toBe(true);

    store.updateScope(projectId, [
      { code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { code: 'Datasheets', label: 'Datasheets Package', custom: false },
    ]);
    const after = store.getWorkspace(projectId);
    expect(after.services).toEqual(['LightingDesign', 'Datasheets']);
    expect(after.deliverables.some((item) => item.serviceCode === 'TechnicalBoq')).toBe(true);
    expect(after.deliverables.find((item) => item.serviceCode === 'TechnicalBoq')?.required).toBe(
      false,
    );
    expect(after.luminaires.map((item) => item.id)).toContain(luminaire.id);
  });

  it('adds and removes custom scope items after creation', () => {
    const store = createStore();
    const projectId = '66666666-6666-4666-8666-666666666666';
    store.initializeProject(
      projectId,
      ['LightingDesign'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    store.updateScope(projectId, [
      { code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { label: 'Authority Submission', custom: true },
    ]);
    let workspace = store.getWorkspace(projectId);
    expect(workspace.scopeItems.map((item) => item.id)).toEqual([
      'LightingDesign',
      'custom:authority-submission',
    ]);

    store.updateScope(projectId, [
      { code: 'LightingDesign', label: 'Lighting Design', custom: false },
    ]);
    workspace = store.getWorkspace(projectId);
    expect(workspace.scopeItems.map((item) => item.id)).toEqual(['LightingDesign']);
  });

  it('rejects duplicate custom scope items by normalized label', () => {
    const store = createStore();
    const projectId = '77777777-7777-4777-8777-777777777777';
    store.initializeProject(
      projectId,
      ['LightingDesign'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    store.updateScope(projectId, [
      { code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { label: 'Mockup Review', custom: true },
      { label: '  mockup  review ', custom: true },
    ]);
    const workspace = store.getWorkspace(projectId);
    expect(workspace.scopeItems).toHaveLength(2);
  });

  it('preserves unknown legacy scope entries across read/write round trips', () => {
    const store = createStore();
    const projectId = '88888888-8888-4888-8888-888888888888';
    store.initializeProject(
      projectId,
      ['LightingDesign'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    store.updateScope(projectId, [
      { code: 'LightingDesign', label: 'Lighting Design', custom: false },
      { label: 'Legacy Unknown Item', custom: true },
    ]);
    const workspace = store.getWorkspace(projectId);
    expect(workspace.scopeItems.map((item) => item.label)).toEqual([
      'Lighting Design',
      'Legacy Unknown Item',
    ]);
  });
});

describe('global Action Category catalog', () => {
  it('normalizes globally, auto-appends, preserves order on update, and emits no project activity', () => {
    const store = createStore();
    const projectId = 'a1111111-1111-4111-8111-111111111111';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const initialCount = store.operations.listActionCategories().length;
    const first = store.operations.createActionCategory({
      label: '  A0   Design   Review ',
      iconKey: 'lightbulb',
      colorKey: 'teal',
    });
    const second = store.operations.createActionCategory({
      label: 'A0 Coordination',
      iconKey: 'people',
      colorKey: 'blue',
    });
    expect([first.label, first.sortOrder, second.sortOrder]).toEqual([
      'A0 Design Review',
      initialCount + 1,
      initialCount + 2,
    ]);
    expect(() =>
      store.operations.createActionCategory({
        label: 'a0 design review',
        iconKey: 'sun',
        colorKey: 'blue',
      }),
    ).toThrow(/already exists/i);
    const updated = store.operations.updateActionCategory(first.id, {
      label: 'A0 Technical Review',
      iconKey: 'checklist',
      colorKey: 'green',
    });
    expect(updated).toMatchObject({
      label: 'A0 Technical Review',
      iconKey: 'checklist',
      colorKey: 'green',
      sortOrder: initialCount + 1,
    });
    expect(store.getWorkspace(projectId).activity).toHaveLength(0);
  });

  it.each([false, true])(
    'reassigns cross-project Actions atomically on category deletion (replacement=%s)',
    (withReplacement) => {
      const store = createStore();
      const projectA = 'a2222222-2222-4222-8222-222222222222';
      const projectB = 'b2222222-2222-4222-8222-222222222222';
      store.initializeProject(
        projectA,
        ['LightingLayout'],
        'Full Lighting Design',
        'Later',
        '2026-08-30',
      );
      store.initializeProject(
        projectB,
        ['LightingLayout'],
        'Full Lighting Design',
        'Later',
        '2026-08-30',
      );
      const category = store.operations.createActionCategory({
        label: 'A0 Cross Project',
        iconKey: 'people',
        colorKey: 'teal',
      });
      const action = (projectId: string, title: string) =>
        store.operations.createAction(projectId, {
          title,
          details: '',
          owner: 'Mohamed',
          ownerRole: '',
          dueDate: null,
          status: 'Open',
          priority: 'Normal',
          sourceType: 'Manual',
          sourceId: null,
          revisionId: null,
          categoryId: category.id,
          notes: '',
        });
      action(projectA, 'Project A action');
      action(projectB, 'Project B action');
      const replacement = withReplacement
        ? store.operations.createActionCategory({
            label: 'Replacement',
            iconKey: 'people',
            colorKey: 'teal',
          })
        : null;
      expect(() => store.operations.deleteActionCategory(category.id, category.id)).toThrow();
      expect(store.getWorkspace(projectA).actions[0]?.categoryId).toBe(category.id);
      store.operations.deleteActionCategory(category.id, replacement?.id ?? null);
      expect(store.getWorkspace(projectA).actions).toHaveLength(1);
      expect(store.getWorkspace(projectB).actions).toHaveLength(1);
      expect(store.getWorkspace(projectA).actions[0]?.categoryId).toBe(replacement?.id ?? null);
      expect(store.getWorkspace(projectB).actions[0]?.categoryId).toBe(replacement?.id ?? null);
      expect(
        store.getWorkspace(projectA).activity.filter((entry) => entry.entityType === 'Action'),
      ).toHaveLength(2);
      expect(
        store.getWorkspace(projectB).activity.filter((entry) => entry.entityType === 'Action'),
      ).toHaveLength(2);
    },
  );

  it('ProjectDocument create/read/update preserves canonical identity and project ownership', () => {
    const store = createStore();
    const projectId = '14141414-1414-4141-8141-141414141414';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );

    const created = store.operations.createDocument(projectId, {
      category: 'Drawing',
      documentNumber: 'L-101',
      title: 'Ground Floor Lighting Layout',
      revision: 'REV_01',
      status: 'Working',
      filePath: 'C:\\Projects\\L-101.dwg',
      issuedTo: '',
      issueDate: null,
      notes: 'Initial working layout',
    });

    expect(created.projectId).toBe(projectId);
    expect(created.category).toBe('Drawing');
    expect(created.title).toBe('Ground Floor Lighting Layout');
    expect(created.filePath).toBe('C:\\Projects\\L-101.dwg');

    // Read via the workspace register.
    const workspace = store.getWorkspace(projectId);
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.documents[0]?.id).toBe(created.id);

    // Update preserves canonical identity (id + projectId unchanged).
    const updated = store.operations.updateDocument(projectId, created.id, {
      category: 'Drawing',
      documentNumber: 'L-101',
      title: 'Ground Floor Lighting Layout (Rev B)',
      revision: 'REV_02',
      status: 'Working',
      filePath: 'C:\\Projects\\L-101B.dwg',
      issuedTo: '',
      issueDate: null,
      notes: 'Updated working layout',
    });
    expect(updated.id).toBe(created.id);
    expect(updated.projectId).toBe(projectId);
    expect(updated.title).toBe('Ground Floor Lighting Layout (Rev B)');
    expect(updated.filePath).toBe('C:\\Projects\\L-101B.dwg');
    expect(store.getWorkspace(projectId).documents).toHaveLength(1);
  });

  it('unreferenced ProjectDocument can be removed from the register without deleting the source file', () => {
    const store = createStore();
    const projectId = '15151515-1515-4151-8151-151515151515';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );

    // Create a REAL physical working file on disk.
    const root = createTemporaryRoot();
    const physicalPath = path.join(root, 'datasheet.pdf');
    writeFileSync(physicalPath, 'P2C-01 physical file must survive register removal.');

    const created = store.operations.createDocument(projectId, {
      category: 'Datasheet',
      documentNumber: '',
      title: 'Luminaire Datasheet',
      revision: '',
      status: 'Working',
      filePath: physicalPath,
      issuedTo: '',
      issueDate: null,
      notes: '',
    });

    const result = store.operations.removeDocument(projectId, created.id);
    expect(result.removed).toBe(true);
    expect(store.getWorkspace(projectId).documents).toHaveLength(0);
    // The physical source file STILL EXISTS after removing the registration.
    // Remove From Register != Delete Physical File.
    expect(existsSync(physicalPath)).toBe(true);
    expect(readFileSync(physicalPath, 'utf8')).toBe(
      'P2C-01 physical file must survive register removal.',
    );
    // The removal is audited as a Document activity entry.
    expect(
      store.getWorkspace(projectId).activity.some((entry) => entry.entityType === 'Document'),
    ).toBe(true);
  });

  it('removeDocument fails closed when the ProjectDocument is referenced by a review attachment', () => {
    const store = createStore();
    const projectId = '17171717-1717-4171-8171-171717171717';
    store.initializeProject(
      projectId,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );

    const document = store.operations.createDocument(projectId, {
      category: 'Drawing',
      documentNumber: '',
      title: 'Review-Referenced Drawing',
      revision: '',
      status: 'Working',
      filePath: 'C:\\Projects\\reviewed.dwg',
      issuedTo: '',
      issueDate: null,
      notes: '',
    });

    // Create a review item, then link it to the document via the canonical
    // review-attachment authority (project_review_attachments).
    const review = store.operations.createReview(projectId, {
      reference: 'C-REV',
      title: 'Reviewed drawing',
      description: 'Comments on the drawing.',
      area: 'Entrance',
      luminaireTag: 'PD01',
      drawingReference: 'reviewed.dwg',
      sourceType: 'Meeting',
      sourceId: null,
      status: 'Open',
      response: '',
      revisionId: null,
      receivedAt: '2026-08-02',
      dueDate: '2026-08-07',
    });
    const actor = { id: 'a1', displayName: 'Test Designer', jobTitle: 'Designer' };
    const attachment = store.operations.linkReviewItemDocument(
      projectId,
      review.id,
      document.id,
      actor,
    );
    expect(attachment.documentId).toBe(document.id);

    // Removal must fail closed with a truthful CONFLICT before any SQL DELETE.
    expect(() => store.operations.removeDocument(projectId, document.id)).toThrowError(
      new DomainError(
        'CONFLICT',
        'This working file is referenced by a review attachment and cannot be removed from the register.',
        409,
      ),
    );

    // Registration remains present.
    expect(store.getWorkspace(projectId).documents).toHaveLength(1);
    // Review attachment remains present.
    const remaining = store
      .getSharedDatabase()
      .prepare('SELECT COUNT(*) AS c FROM project_review_attachments WHERE document_id = ?')
      .get(document.id) as { c: number };
    expect(Number(remaining.c)).toBe(1);
  });
});
