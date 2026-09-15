/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ActionCategory,
  MeetingDetail,
  MeetingListItem,
  ProjectActionItem,
} from '@scli/domain';
import { V4Router as ProductionRouter } from '../../router/V4Router';
import { Route, Routes } from 'react-router-dom';
import { ProjectMeetingsWorkspace } from './ProjectMeetingsWorkspace';
function V4Router() {
  return (
    <Routes>
      <Route path="/projects/:projectId/meetings" element={<ProjectMeetingsWorkspace />} />
      <Route path="*" element={<ProductionRouter />} />
    </Routes>
  );
}
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { MeetingDateBlock } from './MeetingDateBlock';

const project = {
  id: 'p1',
  projectCode: '001_SCT_TEST',
  projectName: 'Golden project',
  clientName: 'Client',
  projectType: 'Commercial',
  designStage: 'Technical',
  requiredDeliveryDate: null,
  status: 'InProgress',
  version: 1,
};
const meeting: MeetingListItem = {
  id: 'm1',
  projectId: 'p1',
  title: 'Technical Coordination',
  purpose: 'Review layout',
  startAt: '2099-09-29T06:00:00.000Z',
  endAt: '2099-09-29T07:00:00.000Z',
  location: 'Microsoft Teams',
  attendees: [],
  agenda: '',
  notes: '',
  decisions: '',
  onlineMeetingUrl: '',
  externalEventId: null,
  status: 'Planned',
  createdAt: '2099-09-01T00:00:00.000Z',
  updatedAt: '2099-09-01T00:00:00.000Z',
  participantsCount: 0,
  participantPreview: [],
  notesCount: 0,
  latestNoteSummary: null,
  linkedActionsCount: 0,
  actionsCreatedCount: 0,
};
const detail: MeetingDetail = {
  ...meeting,
  participants: [],
  agendaItems: [],
  notesCount: 0,
  latestNote: null,
  linkedActions: [],
  actionsCreatedCount: 0,
};
const category: ActionCategory = {
  id: '33333333-3333-4333-8333-333333333333',
  label: 'Coordination',
  iconKey: 'tags',
  colorKey: 'teal',
  sortOrder: 1,
  createdAt: meeting.createdAt,
  updatedAt: meeting.updatedAt,
};
const projectAction = (
  id: string,
  title: string,
  overrides: Partial<ProjectActionItem> = {},
): ProjectActionItem => ({
  id,
  projectId: 'p1',
  title,
  details: '',
  owner: 'Owner',
  ownerRole: 'Designer',
  dueDate: '2099-10-01',
  status: 'Open',
  priority: 'Normal',
  sourceType: 'Manual',
  sourceId: null,
  revisionId: null,
  categoryId: category.id,
  notes: '',
  completedAt: null,
  createdAt: meeting.createdAt,
  updatedAt: meeting.updatedAt,
  ...overrides,
});
const response = (data: unknown, ok = true, message = 'Request failed') => ({
  ok,
  status: ok ? 200 : 500,
  headers: { get: () => 'c1' },
  json: () => Promise.resolve(ok ? { data } : { error: { message } }),
});

function renderMeetings(
  list: MeetingListItem[] = [meeting],
  meetingDetail: MeetingDetail = detail,
  options: {
    actions?: ProjectActionItem[];
    linkFailure?: string;
    createFailure?: string;
    unlinkFailure?: string;
    finalView?: boolean;
  } = {},
) {
  stubMatchMedia();
  let currentDetail = meetingDetail;
  let currentList = list;
  const actions = options.actions ?? [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (/\/projects\/p1$/.test(url)) return Promise.resolve(response(project));
    if (url.endsWith('/workspace')) return Promise.resolve(response({ actions }));
    if (url.endsWith('/action-categories') && (!init?.method || init.method === 'GET'))
      return Promise.resolve(response([category]));
    if (url.endsWith('/meetings/m1/action-links') && init?.method === 'POST') {
      if (options.linkFailure) return Promise.resolve(response({}, false, options.linkFailure));
      const body = JSON.parse(init.body as string) as { actionId: string };
      const action = actions.find((item) => item.id === body.actionId)!;
      currentDetail = {
        ...currentDetail,
        linkedActions: [
          ...currentDetail.linkedActions,
          { ...action, relationType: 'Linked' as const },
        ],
      };
      currentList = currentList.map((item) =>
        item.id === 'm1' ? { ...item, linkedActionsCount: item.linkedActionsCount + 1 } : item,
      );
      return Promise.resolve(
        response({
          id: `link-${body.actionId}`,
          projectId: 'p1',
          meetingId: 'm1',
          actionId: body.actionId,
          relationType: 'Linked',
          createdAt: meeting.createdAt,
        }),
      );
    }
    if (/\/meetings\/m1\/action-links\/[^/]+$/.test(url) && init?.method === 'DELETE') {
      if (options.unlinkFailure) return Promise.resolve(response({}, false, options.unlinkFailure));
      const actionId = url.split('/').at(-1)!;
      currentDetail = {
        ...currentDetail,
        linkedActions: currentDetail.linkedActions.filter((item) => item.id !== actionId),
      };
      currentList = currentList.map((item) =>
        item.id === 'm1' ? { ...item, linkedActionsCount: item.linkedActionsCount - 1 } : item,
      );
      return Promise.resolve(response({ deleted: true }));
    }
    if (url.endsWith('/meetings/m1/actions') && init?.method === 'POST') {
      if (options.createFailure) return Promise.resolve(response({}, false, options.createFailure));
      const body = JSON.parse(init.body as string) as Partial<ProjectActionItem>;
      const created = projectAction('created-action', String(body.title), {
        ...body,
        sourceType: 'Meeting',
        sourceId: 'm1',
      });
      currentDetail = {
        ...currentDetail,
        linkedActions: [
          ...currentDetail.linkedActions,
          { ...created, relationType: 'CreatedFromMeeting' as const },
        ],
      };
      currentList = currentList.map((item) =>
        item.id === 'm1'
          ? {
              ...item,
              linkedActionsCount: item.linkedActionsCount + 1,
              actionsCreatedCount: item.actionsCreatedCount + 1,
            }
          : item,
      );
      return Promise.resolve(response(created));
    }
    if (url.endsWith('/meetings')) return Promise.resolve(response(currentList));
    if (url.endsWith('/meetings/m1')) return Promise.resolve(response(currentDetail));
    return Promise.resolve(response({}));
  });
  vi.stubGlobal('fetch', fetch);
  return {
    ...renderV4(options.finalView ? <ProductionRouter /> : <V4Router />, ['/projects/p1/meetings']),
    fetch,
  };
}

afterEach(cleanupV4);

describe('ProjectMeetingsPage MUX-01', () => {
  it('keeps the weekday outside the bordered month and day tile', () => {
    const { container } = render(<MeetingDateBlock value={meeting.startAt} />);
    const tile = container.querySelector('.v4-meetings__date-tile');
    expect(tile).toHaveTextContent('SEP29');
    expect(tile).not.toHaveTextContent('TUE');
    expect(tile?.nextElementSibling).toHaveTextContent('TUE');
  });

  it('keeps featured time on one semantic line and caps attendee preview at four plus overflow', async () => {
    const participants = Array.from({ length: 6 }, (_, index) => ({
      id: `participant-${index + 1}`,
      meetingId: 'm1',
      name: `Participant ${index + 1}`,
      role: 'Role',
      sortOrder: index,
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt,
    }));
    renderMeetings([{ ...meeting, participantsCount: 6, participantPreview: participants }]);
    const time = await screen.findByText('10:00 AM');
    expect(time.tagName).toBe('STRONG');
    expect(document.querySelectorAll('.v4-meetings__avatars b')).toHaveLength(4);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('uses fixed past-row groups with semantic Notes and Actions Created icons', async () => {
    const pastMeeting: MeetingListItem = {
      ...meeting,
      id: 'past-meeting',
      title: 'Past coordination review',
      startAt: '2020-05-09T05:15:00.000Z',
      endAt: '2020-05-09T06:00:00.000Z',
      decisions: 'Confirmed the issue sequence.',
      notesCount: 3,
      actionsCreatedCount: 2,
    };
    const { container } = renderMeetings([meeting, pastMeeting]);

    await screen.findByText('Past coordination review');
    const row = container.querySelector('.v4-meetings__past-row');
    expect(row?.querySelectorAll('.v4-meetings__past-metric')).toHaveLength(2);
    expect(row?.querySelector('[data-metric="notes"] svg')).toBeInTheDocument();
    expect(row?.querySelector('[data-metric="actions-created"] svg')).toBeInTheDocument();
    expect(row?.querySelector('.v4-meetings__past-time')).toBeInTheDocument();
    expect(row?.querySelector('.v4-meetings__past-main')).toBeInTheDocument();
  });

  it('auto-selects only once and keeps the inspector closed after a manual close', async () => {
    renderMeetings();
    expect(
      await screen.findByRole('complementary', { name: 'Meeting details' }),
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Close meeting details' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('complementary', { name: 'Meeting details' }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('complementary', { name: 'Meeting details' }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(
      await screen.findByRole('complementary', { name: 'Meeting details' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close meeting details' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('complementary', { name: 'Meeting details' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('keeps inspector previews bounded and opens overflow in local subviews', async () => {
    const participants = Array.from({ length: 7 }, (_, index) => ({
      id: `participant-${index + 1}`,
      meetingId: 'm1',
      name: `Participant ${index + 1}`,
      role: `Role ${index + 1}`,
      sortOrder: index,
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt,
    }));
    const agendaItems = Array.from({ length: 5 }, (_, index) => ({
      id: `agenda-${index + 1}`,
      meetingId: 'm1',
      content: `Agenda ${index + 1}`,
      sortOrder: index,
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt,
    }));
    const linkedActions = Array.from({ length: 4 }, (_, index) => ({
      id: `action-${index + 1}`,
      title: `Action ${index + 1}`,
      priority: 'Normal' as const,
      owner: 'Owner',
      dueDate: null,
      status: 'Open' as const,
      relationType: index === 3 ? ('Linked' as const) : ('CreatedFromMeeting' as const),
    }));
    const latestNote = {
      id: 'note-1',
      meetingId: 'm1',
      content: 'The team confirmed the revised coordination sequence and next issue date.',
      authorName: 'Mohamed Rabea',
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt,
    };
    const { container } = renderMeetings(undefined, {
      ...detail,
      participants,
      agendaItems,
      linkedActions,
      notesCount: 3,
      latestNote,
    });

    await screen.findByText('Participants (7)');
    const identity = container.querySelector('.v4-meetings__identity');
    const inspectorDateTile = identity?.querySelector('.v4-meetings__date-tile');
    expect(inspectorDateTile).toHaveTextContent('SEP29');
    expect(inspectorDateTile?.nextElementSibling).toHaveTextContent('TUE');
    expect(screen.getByText('Participant 6')).toBeInTheDocument();
    expect(screen.queryByText('Participant 7')).not.toBeInTheDocument();
    expect(screen.getByText('Agenda 4')).toBeInTheDocument();
    expect(screen.queryByText('Agenda 5')).not.toBeInTheDocument();
    expect(screen.getByText('Action 3')).toBeInTheDocument();
    expect(screen.queryByText('Action 4')).not.toBeInTheDocument();
    expect(
      screen.getByText('Action 1').closest('.v4-meetings__linked-action-row'),
    ).toHaveTextContent('Created here');
    const actionRows = container.querySelectorAll('.v4-meetings__linked-action-row');
    expect(actionRows).toHaveLength(3);
    actionRows.forEach((row) => {
      expect(row.firstElementChild?.tagName).toBe('EM');
      expect(row.lastElementChild?.tagName).toBe('SPAN');
    });
    expect(container.querySelector('.v4-meetings__notes-heading svg')).toBeInTheDocument();
    expect(container.querySelector('.v4-meetings__note-summary small')).toHaveTextContent(
      'Mohamed Rabea',
    );

    fireEvent.click(screen.getByRole('button', { name: 'View all participants' }));
    expect(screen.getByText('Participant 7')).toBeInTheDocument();
    expect(screen.queryByText('Agenda 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Meeting Details' }));

    fireEvent.click(screen.getByRole('button', { name: 'View all agenda items' }));
    expect(screen.getByText('Agenda 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Meeting Details' }));

    fireEvent.click(screen.getByRole('button', { name: 'Manage linked actions' }));
    expect(screen.getByText('Action 4')).toBeInTheDocument();
    expect(screen.getByText('Linked Actions (4)')).toBeInTheDocument();
    expect(screen.getByText('Linked')).toBeInTheDocument();
  });

  it('reports truthful Link Existing empty states and returns Back to the linked list', async () => {
    renderMeetings();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Manage linked actions' }, { timeout: 5000 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Link Existing' }));
    expect(
      await screen.findByText('No project actions are available to link.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Create Action' })).toBeInTheDocument();
    cleanup();
    cleanupV4();

    const only = projectAction('a1', 'Only action');
    renderMeetings(
      undefined,
      { ...detail, linkedActions: [{ ...only, relationType: 'Linked' }] },
      { actions: [only] },
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Manage linked actions' }, { timeout: 5000 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Link Existing' }));
    expect(
      await screen.findByText('All project actions are already linked to this meeting.'),
    ).toBeInTheDocument();
  });

  it('links a filtered existing project Action with actionId-only authority and canonical reconciliation', async () => {
    const alreadyLinked = projectAction('a1', 'Already linked');
    const candidate = projectAction('a2', 'Link candidate', { owner: 'Needle Owner' });
    const other = projectAction('a3', 'Other action', { owner: 'Another Owner' });
    const { fetch } = renderMeetings(
      undefined,
      {
        ...detail,
        linkedActions: [{ ...alreadyLinked, relationType: 'CreatedFromMeeting' }],
      },
      { actions: [alreadyLinked, candidate, other] },
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Manage linked actions' }, { timeout: 5000 }),
    );
    expect(screen.getByText('Created here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Link Existing' }));
    const search = await screen.findByLabelText('Search actions');
    expect(screen.queryByRole('radio', { name: /Already linked/ })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: '  needle owner  ' } });
    expect(screen.getByRole('radio', { name: /Link candidate/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Other action/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link Action' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Link candidate/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Link Action' }));

    expect(await screen.findByText('Linked')).toBeInTheDocument();
    const request = fetch.mock.calls.find(
      ([url, init]) => String(url).endsWith('/meetings/m1/action-links') && init?.method === 'POST',
    );
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({ actionId: 'a2' });
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/meetings/m1'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Link candidate' }));
    expect(await screen.findByRole('heading', { name: 'Actions' })).toBeInTheDocument();
  });

  it('preserves Link Existing search and selection after a local link error', async () => {
    const candidate = projectAction('a2', 'Retry candidate');
    renderMeetings(undefined, detail, {
      actions: [candidate],
      linkFailure: 'The relation could not be saved.',
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Manage linked actions' }, { timeout: 5000 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Link Existing' }));
    const search = await screen.findByLabelText('Search actions');
    fireEvent.change(search, { target: { value: 'retry' } });
    const radio = screen.getByRole('radio', { name: /Retry candidate/ });
    fireEvent.click(radio);
    fireEvent.click(screen.getByRole('button', { name: 'Link Action' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The relation could not be saved.');
    expect(search).toHaveValue('retry');
    expect(radio).toBeChecked();
    expect(screen.getByRole('button', { name: 'Link Action' })).toBeEnabled();
  });

  it('creates from the Meeting with the canonical Action drawer and no caller provenance fields', async () => {
    const { fetch } = renderMeetings();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Manage linked actions' }, { timeout: 5000 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Action' }));
    const drawer = await screen.findByRole('dialog', { name: 'Create Action from Meeting' });
    fireEvent.change(within(drawer).getByLabelText('Title'), {
      target: { value: 'Created in coordination' },
    });
    expect(within(drawer).getByLabelText('Owner Role')).toHaveAttribute('readonly');
    fireEvent.change(within(drawer).getByLabelText('Notes'), {
      target: { value: 'Retain the full canonical draft.' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create action' }));
    expect(await screen.findByText('Created here')).toBeInTheDocument();
    const request = fetch.mock.calls.find(
      ([url, init]) => String(url).endsWith('/meetings/m1/actions') && init?.method === 'POST',
    );
    const body = JSON.parse(request?.[1]?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      title: 'Created in coordination',
      ownerRole: '',
      notes: 'Retain the full canonical draft.',
    });
    expect(body).not.toHaveProperty('sourceType');
    expect(body).not.toHaveProperty('sourceId');
    expect(
      screen.queryByRole('dialog', { name: 'Create Action from Meeting' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a failed create draft and applies Linked-only unlink confirmation and reconciliation', async () => {
    const linked = projectAction('linked-action', 'Linked action');
    const created = projectAction('created-action', 'Created action', {
      sourceType: 'Meeting',
      sourceId: 'm1',
    });
    const rendered = renderMeetings(
      undefined,
      {
        ...detail,
        linkedActions: [
          { ...linked, relationType: 'Linked' },
          { ...created, relationType: 'CreatedFromMeeting' },
        ],
      },
      { createFailure: 'Create failed.' },
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Manage linked actions' }, { timeout: 5000 }),
    );
    expect(
      screen.getByRole('button', { name: 'Unlink Linked action from this meeting' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unlink Created action/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Action' }));
    const drawer = await screen.findByRole('dialog', { name: 'Create Action from Meeting' });
    fireEvent.change(within(drawer).getByLabelText('Title'), {
      target: { value: 'Retained failed draft' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Create action' }));
    expect(await within(drawer).findByRole('alert')).toHaveTextContent('Create failed.');
    expect(within(drawer).getByLabelText('Title')).toHaveValue('Retained failed draft');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: 'Unsaved action changes' })).getByRole(
        'button',
        { name: 'Discard' },
      ),
    );

    const unlink = screen.getByRole('button', { name: 'Unlink Linked action from this meeting' });
    unlink.focus();
    fireEvent.click(unlink);
    const confirmation = await screen.findByRole('dialog', {
      name: 'Unlink action from this meeting?',
    });
    expect(confirmation).toHaveTextContent('The Action remains unchanged.');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(unlink).toHaveFocus());
    fireEvent.click(unlink);
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: 'Unlink action from this meeting?' }),
      ).getByRole('button', { name: 'Unlink' }),
    );
    await waitFor(() => expect(screen.queryByText('Linked action')).not.toBeInTheDocument());
    expect(screen.getByText('Created action')).toBeInTheDocument();
    expect(
      rendered.fetch.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/meetings/m1/action-links/linked-action') &&
          init?.method === 'DELETE',
      ),
    ).toBe(true);
  });

  it('keeps a failed unlink relation visible with retry available', async () => {
    const linked = projectAction('linked-action', 'Persistent linked action');
    renderMeetings(
      undefined,
      { ...detail, linkedActions: [{ ...linked, relationType: 'Linked' }] },
      { unlinkFailure: 'Unlink failed.' },
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Manage linked actions' }, { timeout: 5000 }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Unlink Persistent linked action from this meeting' }),
    );
    const confirmation = await screen.findByRole('dialog', {
      name: 'Unlink action from this meeting?',
    });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Unlink' }));
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent('Unlink failed.');
    expect(
      screen.getByRole('button', { name: 'Persistent linked action', hidden: true }),
    ).toBeInTheDocument();
    expect(within(confirmation).getByRole('button', { name: 'Unlink' })).toBeEnabled();
  });

  it('retains every empty inspector section in the fixed composition', async () => {
    renderMeetings();
    expect(await screen.findByText('No participants recorded.')).toBeInTheDocument();
    expect(screen.getByText('No agenda items recorded.')).toBeInTheDocument();
    expect(screen.getByText('No linked actions.')).toBeInTheDocument();
    expect(screen.getByText('No meeting notes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage linked actions' })).toBeInTheDocument();
  });
});

describe('Final Meetings production route', () => {
  afterEach(() => {
    cleanup();
    cleanupV4();
  });
  it('shows persisted meeting details and opens the preserved agenda editor', async () => {
    renderMeetings([meeting], detail, { finalView: true });
    const meetingDetails = await screen.findByRole('region', { name: 'Meeting details' });
    expect(await screen.findByRole('region', { name: 'Project metadata' })).toBeVisible();
    expect(meetingDetails).toHaveTextContent('Technical Coordination');
    expect(meetingDetails).toHaveTextContent('Participants (0)');
    expect(screen.queryByText('Mohamed Ali')).not.toBeInTheDocument();
    fireEvent.click(within(meetingDetails).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('dialog', { name: 'Edit Meeting Agenda' })).toBeVisible();
  });
  it('filters actual upcoming meetings and preserves the past collection and counts', async () => {
    const past = {
      ...meeting,
      id: 'past-1',
      title: 'Actual past meeting',
      startAt: '2020-01-01T06:00:00Z',
      endAt: '2020-01-01T07:00:00Z',
      status: 'Held' as const,
      notesCount: 2,
      actionsCreatedCount: 1,
    };
    renderMeetings([meeting, past], detail, { finalView: true });
    expect(await screen.findByRole('button', { name: 'Actual past meeting' })).toHaveTextContent(
      'Actions Created',
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search meetings' }), {
      target: { value: 'Actual past' },
    });
    expect(
      screen.queryByRole('region', { name: 'Technical Coordination' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actual past meeting' })).toBeVisible();
  });
});
