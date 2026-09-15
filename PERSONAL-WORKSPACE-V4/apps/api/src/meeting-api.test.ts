import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@scli/config';
import { seedProjects, seedUserIds } from '@scli/test-data';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app';
import { MockDataProvider } from './mock-data-provider';
import { PersonalWorkspaceStore } from './personal-workspace-store';

const config = loadConfig({
  APP_MODE: 'mock',
  WORKSPACE_VARIANT: 'personal',
  PERSONAL_AUTO_LOGIN: 'false',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  COMPANY_TIMEZONE: 'Asia/Dubai',
});
const project = seedProjects.find((item) => item.salesOwnerId === seedUserIds.salesOne)!;
const otherProject = seedProjects.find((item) => item.salesOwnerId === seedUserIds.salesTwo)!;
const actor = { 'x-mock-user-id': seedUserIds.salesOne };

describe('Meeting foundation API', () => {
  let app: FastifyInstance;
  let store: PersonalWorkspaceStore;
  beforeEach(async () => {
    store = new PersonalWorkspaceStore(config);
    store.initializeProject(
      project.id,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    app = await createApp({ config, provider: new MockDataProvider(), personalStore: store });
  });
  afterEach(async () => {
    await app.close();
    store.close();
  });

  it('persists final-UI Low action priority while retaining project authorization', async () => {
    const payload = { title: 'Low priority follow-up', owner: 'Actual owner', priority: 'Low' };
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/actions`,
      headers: actor,
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.priority).toBe('Low');
    expect(
      store.getWorkspace(project.id).actions.find((item) => item.id === created.json().data.id)
        ?.priority,
    ).toBe('Low');
    const denied = await app.inject({
      method: 'POST',
      url: `/api/projects/${otherProject.id}/actions`,
      headers: actor,
      payload,
    });
    expect(denied.statusCode).toBe(403);
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/actions`,
      headers: actor,
      payload: { ...payload, priority: 'Imaginary' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('serializes canonical Meeting reads and preserves omitted children through the real routes', async () => {
    const payload = {
      title: 'HTTP Meeting',
      purpose: 'Route authority',
      startAt: '2026-08-10T08:00:00.000Z',
      endAt: '2026-08-10T09:00:00.000Z',
      location: 'Dubai',
      attendees: ['Legacy'],
      agenda: 'Legacy agenda',
      notes: 'Legacy notes',
      decisions: 'Proceed',
      onlineMeetingUrl: '',
      externalEventId: null,
      status: 'Planned',
      participants: [
        { id: '80000000-0000-4000-8000-000000000001', name: 'First', role: 'Owner', sortOrder: 0 },
        {
          id: '80000000-0000-4000-8000-000000000002',
          name: 'Second',
          role: 'Client',
          sortOrder: 1,
        },
      ],
      agendaItems: [
        { id: '81000000-0000-4000-8000-000000000001', content: 'First agenda', sortOrder: 0 },
      ],
    };
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/meetings`,
      headers: actor,
      payload,
    });
    expect(created.statusCode).toBe(201);
    const meetingId = created.json().data.id as string;
    const action = store.operations.createAction(project.id, {
      title: 'Existing',
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
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/meetings/${meetingId}/action-links`,
          headers: actor,
          payload: { actionId: action.id, relationType: 'CreatedFromMeeting' },
        })
      ).statusCode,
    ).toBe(201);
    const storedLink = store.operations.listMeetingActionLinks(project.id, meetingId)[0]!;
    expect(storedLink.relationType).toBe('Linked');
    expect(
      store.getWorkspace(project.id).actions.find((item) => item.id === action.id),
    ).toMatchObject({
      sourceType: 'Manual',
      sourceId: null,
    });
    const duplicateLink = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/meetings/${meetingId}/action-links`,
      headers: actor,
      payload: { actionId: action.id },
    });
    expect(duplicateLink.statusCode).toBe(201);
    expect(duplicateLink.json().data.id).toBe(storedLink.id);
    expect(store.operations.listMeetingActionLinks(project.id, meetingId)).toHaveLength(1);
    const note = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/meetings/${meetingId}/notes`,
      headers: actor,
      payload: { content: 'HTTP\nnote', authorName: 'Author' },
    });
    expect(note.statusCode).toBe(201);
    const list = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/meetings`,
      headers: actor,
    });
    expect(list.json().data[0]).toMatchObject({
      id: meetingId,
      purpose: 'Route authority',
      participantsCount: 2,
      notesCount: 1,
      linkedActionsCount: 1,
      actionsCreatedCount: 0,
      latestNoteSummary: { content: 'HTTP\nnote' },
    });
    expect(list.json().data[0].notes).toBe('Legacy notes');
    expect(list.json().data[0].meetingNotes).toBeUndefined();
    const detail = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/meetings/${meetingId}`,
      headers: actor,
    });
    expect(detail.json().data).toMatchObject({
      id: meetingId,
      participants: [{ id: payload.participants[0]!.id }, { id: payload.participants[1]!.id }],
      agendaItems: [{ id: payload.agendaItems[0]!.id }],
      notesCount: 1,
      linkedActions: [expect.objectContaining({ id: action.id, relationType: 'Linked' })],
    });
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/meetings/${meetingId}`,
      headers: actor,
      payload: { ...payload, title: 'Updated', participants: undefined, agendaItems: undefined },
    });
    expect(updated.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/meetings/${meetingId}`,
          headers: actor,
        })
      ).json().data,
    ).toMatchObject({
      title: 'Updated',
      participants: [{ id: payload.participants[0]!.id }, { id: payload.participants[1]!.id }],
      agendaItems: [{ id: payload.agendaItems[0]!.id }],
    });
    const fromMeeting = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/meetings/${meetingId}/actions`,
      headers: actor,
      payload: {
        title: 'Created through HTTP',
        details: '',
        owner: 'Owner',
        ownerRole: '',
        dueDate: null,
        status: 'Open',
        priority: 'High',
        revisionId: null,
        categoryId: null,
        notes: '',
      },
    });
    expect(fromMeeting.statusCode).toBe(201);
    expect(fromMeeting.json().data).toMatchObject({
      sourceType: 'Meeting',
      sourceId: meetingId,
      title: 'Created through HTTP',
    });
    expect(
      store.operations
        .listMeetingActionLinks(project.id, meetingId)
        .find((link) => link.actionId === fromMeeting.json().data.id),
    ).toMatchObject({ relationType: 'CreatedFromMeeting' });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/meetings`,
          headers: actor,
        })
      ).json().data[0],
    ).toMatchObject({ linkedActionsCount: 2, actionsCreatedCount: 1 });
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/projects/${project.id}/meetings/${meetingId}/notes/${note.json().data.id}`,
          headers: actor,
          payload: { content: 'Updated', authorName: 'Author' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/meetings/${meetingId}/notes`,
          headers: actor,
        })
      ).json().data,
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/projects/${project.id}/meetings/${meetingId}/notes/${note.json().data.id}`,
          headers: actor,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/projects/${project.id}/meetings/${meetingId}/action-links/${action.id}`,
          headers: actor,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('enforces validation, project scope, missing-resource behavior, and has no Meeting delete route', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/meetings`,
      headers: actor,
      payload: {
        title: 'Bad',
        startAt: '2026-08-10T09:00:00.000Z',
        endAt: '2026-08-10T08:00:00.000Z',
        location: '',
        attendees: [],
        agenda: '',
        notes: '',
        decisions: '',
        onlineMeetingUrl: '',
        externalEventId: null,
        status: 'Planned',
        participants: [{ name: '', role: '', sortOrder: 0 }],
      },
    });
    expect(malformed.statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/meetings/00000000-0000-4000-8000-000000000000`,
          headers: actor,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${otherProject.id}/meetings`,
          headers: actor,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/projects/${project.id}/meetings/00000000-0000-4000-8000-000000000000`,
          headers: actor,
        })
      ).statusCode,
    ).toBe(404);

    store.initializeProject(
      otherProject.id,
      ['LightingLayout'],
      'Full Lighting Design',
      'Later',
      '2026-08-30',
    );
    const foreignAction = store.operations.createAction(otherProject.id, {
      title: 'Foreign action',
      details: '',
      owner: 'Other owner',
      ownerRole: '',
      dueDate: null,
      status: 'Open',
      priority: 'Normal',
      sourceType: 'Manual',
      sourceId: null,
      revisionId: null,
      categoryId: null,
      notes: '',
    });
    const localMeeting = store.operations.createMeeting(project.id, {
      title: 'Local meeting',
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
    const crossProjectLink = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/meetings/${localMeeting.id}/action-links`,
      headers: actor,
      payload: { actionId: foreignAction.id },
    });
    expect(crossProjectLink.statusCode).toBe(404);
    expect(store.operations.listMeetingActionLinks(project.id, localMeeting.id)).toHaveLength(0);
  });
});
