/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type {
  ActionCategory,
  MeetingActionLink,
  MeetingListItem,
  ProjectActionItem,
} from '@scli/domain';
import { actionCategoryIconEntries } from '../../components/common/actionCategoryIconCatalog';
import { V4Router as ProductionRouter } from '../../router/V4Router';
import { Route, Routes } from 'react-router-dom';
import { ProjectActionsWorkspace } from './ProjectActionsWorkspace';
function V4Router() {
  return (
    <Routes>
      <Route path="/projects/:projectId/actions" element={<ProjectActionsWorkspace />} />
      <Route path="*" element={<ProductionRouter />} />
    </Routes>
  );
}
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

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
const category: ActionCategory = {
  id: '33333333-3333-4333-8333-333333333333',
  label: 'Coordination',
  iconKey: 'tags',
  colorKey: 'teal',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const secondCategory: ActionCategory = {
  ...category,
  id: '55555555-5555-4555-8555-555555555555',
  label: 'Lighting Design',
  iconKey: 'lightbulb',
  colorKey: 'purple',
  sortOrder: 2,
};
const linkedMeeting = (id: string, title: string, startAt: string): MeetingListItem => ({
  id,
  projectId: 'p1',
  title,
  purpose: '',
  startAt,
  endAt: startAt,
  location: '',
  attendees: [],
  agenda: '',
  notes: '',
  decisions: '',
  onlineMeetingUrl: '',
  externalEventId: null,
  status: 'Planned',
  createdAt: startAt,
  updatedAt: startAt,
  participantsCount: 0,
  participantPreview: [],
  notesCount: 0,
  latestNoteSummary: null,
  linkedActionsCount: 1,
  actionsCreatedCount: 0,
});
const meetingLink = (
  id: string,
  meetingId: string,
  relationType: MeetingActionLink['relationType'],
): MeetingActionLink => ({
  id,
  projectId: 'p1',
  meetingId,
  actionId: 'a1',
  relationType,
  createdAt: '2026-01-01T00:00:00.000Z',
});
const chooseFilter = (label: string, option: string) => {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const action = (
  id: string,
  title: string,
  overrides: Partial<ProjectActionItem> = {},
): ProjectActionItem => ({
  id,
  projectId: 'p1',
  title,
  details: `${title} detail`,
  owner: id === 'a2' ? '' : 'Sarah Ahmed',
  ownerRole: 'Lighting Designer',
  dueDate: '2026-08-20',
  status: 'Open',
  priority: 'High',
  sourceType: 'Meeting',
  sourceId: '11111111-1111-4111-8111-111111111111',
  revisionId: '22222222-2222-4222-8222-222222222222',
  categoryId: category.id,
  notes: `${title} notes`,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ...overrides,
});
const workspace = (
  actions = [
    action('a1', 'Layout review'),
    action('a2', 'Schedule follow-up', { categoryId: null, status: 'Waiting', priority: 'Urgent' }),
  ],
) => ({
  projectId: 'p1',
  folderPath: null,
  folderProfile: 'default',
  folderStructure: [],
  outputFolders: {},
  services: [],
  scopeItems: [],
  deliverables: [],
  lightingPackage: {},
  luminaires: [],
  exports: [],
  revisionPackages: [],
  requirements: [],
  checklist: [],
  actions,
  meetings: [],
  reviewItems: [],
  revisions: [],
  documents: [],
  fileCenter: [],
  contacts: [],
  communications: [],
  activity: [],
  health: {
    score: 0,
    checklistPercent: 0,
    openRequirements: 0,
    blockingRequirements: 0,
    overdueActions: 0,
    unresolvedReviews: 0,
    checks: [],
  },
  updatedAt: '2026-01-02T00:00:00.000Z',
});
const response = (
  data: unknown,
  ok = true,
  errorMessage = 'Request failed',
  status = ok ? 200 : 500,
) => ({
  ok,
  status,
  headers: { get: () => 'c1' },
  json: () => Promise.resolve(ok ? { data } : { error: { message: errorMessage } }),
});

function stubApi(
  options: {
    actions?: ProjectActionItem[];
    categories?: ActionCategory[];
    categoryFailure?: boolean;
    createActionFailure?: string;
    createCategoryFailure?: { message: string; status: number };
    createdCategory?: ActionCategory;
    updateCategoryFailure?: { message: string; status: number };
    updatedCategory?: ActionCategory;
    update?: ProjectActionItem;
    meetings?: MeetingListItem[];
    meetingLinks?: MeetingActionLink[];
    meetingLinksFailure?: boolean;
    meetingLinksPending?: boolean;
    linkMeetingFailure?: string;
    unlinkMeetingFailure?: string;
    workspaceFailure?: string;
    workspacePending?: boolean;
  } = {},
) {
  let currentActions = [...workspace(options.actions).actions];
  let currentCategories = [...(options.categories ?? [category])];
  let currentMeetings = [...(options.meetings ?? [])];
  let currentMeetingLinks = [...(options.meetingLinks ?? [])];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/workspace')) {
      if (options.workspacePending) return new Promise(() => {});
      return Promise.resolve(
        options.workspaceFailure
          ? response({}, false, options.workspaceFailure)
          : response(workspace(currentActions)),
      );
    }
    if (url.endsWith('/action-categories') && init?.method === 'GET')
      return Promise.resolve(
        response(options.categoryFailure ? {} : currentCategories, !options.categoryFailure),
      );
    if (url.endsWith('/action-categories') && init?.method === 'POST') {
      if (options.createCategoryFailure)
        return Promise.resolve(
          response(
            {},
            false,
            options.createCategoryFailure.message,
            options.createCategoryFailure.status,
          ),
        );
      const created = options.createdCategory ?? secondCategory;
      currentCategories = [...currentCategories, created];
      return Promise.resolve(response(created));
    }
    if (/\/action-categories\//.test(url) && init?.method === 'PATCH') {
      if (options.updateCategoryFailure)
        return Promise.resolve(
          response(
            {},
            false,
            options.updateCategoryFailure.message,
            options.updateCategoryFailure.status,
          ),
        );
      const id = url.split('/').at(-1)!;
      const updated = options.updatedCategory ?? currentCategories.find((item) => item.id === id)!;
      currentCategories = currentCategories.map((item) => (item.id === id ? updated : item));
      return Promise.resolve(response(updated));
    }
    if (/\/action-categories\//.test(url) && init?.method === 'DELETE') {
      const id = url.split('/').at(-1)!;
      currentCategories = currentCategories.filter((item) => item.id !== id);
      currentActions = currentActions.map((item) =>
        item.categoryId === id ? { ...item, categoryId: null } : item,
      );
      return Promise.resolve(response({ deleted: true }));
    }
    if (/\/actions\/[^/]+\/meeting-links$/.test(url) && (!init?.method || init.method === 'GET')) {
      if (options.meetingLinksPending) return new Promise(() => {});
      return Promise.resolve(
        options.meetingLinksFailure
          ? response({}, false, 'Meeting links unavailable')
          : response(currentMeetingLinks),
      );
    }
    if (/\/meetings\/[^/]+\/action-links$/.test(url) && init?.method === 'POST') {
      if (options.linkMeetingFailure)
        return Promise.resolve(response({}, false, options.linkMeetingFailure));
      const meetingId = url.split('/').at(-2)!;
      const body = JSON.parse(init.body as string) as { actionId: string };
      const created: MeetingActionLink = {
        id: `link-${meetingId}-${body.actionId}`,
        projectId: 'p1',
        meetingId,
        actionId: body.actionId,
        relationType: 'Linked',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      currentMeetingLinks = [...currentMeetingLinks, created];
      currentMeetings = currentMeetings.map((meeting) =>
        meeting.id === meetingId
          ? { ...meeting, linkedActionsCount: meeting.linkedActionsCount + 1 }
          : meeting,
      );
      return Promise.resolve(response(created));
    }
    if (/\/meetings\/[^/]+\/action-links\/[^/]+$/.test(url) && init?.method === 'DELETE') {
      if (options.unlinkMeetingFailure)
        return Promise.resolve(response({}, false, options.unlinkMeetingFailure));
      const meetingId = url.split('/').at(-3)!;
      const actionId = url.split('/').at(-1)!;
      currentMeetingLinks = currentMeetingLinks.filter(
        (link) => !(link.meetingId === meetingId && link.actionId === actionId),
      );
      currentMeetings = currentMeetings.map((meeting) =>
        meeting.id === meetingId
          ? { ...meeting, linkedActionsCount: meeting.linkedActionsCount - 1 }
          : meeting,
      );
      return Promise.resolve(response({ deleted: true }));
    }
    if (url.endsWith('/meetings') && (!init?.method || init.method === 'GET'))
      return Promise.resolve(response(currentMeetings));
    if (/\/meetings\/[^/]+$/.test(url) && (!init?.method || init.method === 'GET')) {
      const id = url.split('/').at(-1)!;
      const item = currentMeetings.find((meeting) => meeting.id === id);
      return Promise.resolve(
        response(
          item
            ? { ...item, participants: [], agendaItems: [], latestNote: null, linkedActions: [] }
            : {},
        ),
      );
    }
    if (/\/actions\//.test(url) && init?.method === 'PATCH') {
      const id = url.split('/').at(url.endsWith('/merge') ? -2 : -1)!;
      const body = JSON.parse(init.body as string);
      const original = currentActions.find((item) => item.id === id)!;
      const updated = options.update ?? { ...original, ...body };
      currentActions = currentActions.map((item) => (item.id === id ? updated : item));
      return Promise.resolve(response(updated));
    }
    if (url.endsWith('/actions') && init?.method === 'POST') {
      if (options.createActionFailure)
        return Promise.resolve(response({}, false, options.createActionFailure));
      const body = JSON.parse(init.body as string);
      const created = action('new', body.title, body);
      currentActions = [...currentActions, created];
      return Promise.resolve(response(created));
    }
    if (/\/projects\/p1$/.test(url)) return Promise.resolve(response(project));
    return Promise.resolve(response({}));
  });
  vi.stubGlobal('fetch', fetch);
  return Object.assign(fetch, {
    currentMeetings: () => currentMeetings,
    currentActions: () => currentActions,
  });
}

function renderActions(options?: Parameters<typeof stubApi>[0]) {
  stubMatchMedia();
  const fetch = stubApi(options);
  renderV4(<V4Router />, ['/projects/p1/actions']);
  return fetch;
}

afterEach(cleanupV4);

describe('ProjectActionsPage', () => {
  it('renders the bounded Actions workspace, canonical rows, KPIs, and an expanding main column before selection', async () => {
    renderActions();
    expect(await screen.findByRole('heading', { name: 'Actions' })).toBeInTheDocument();
    await screen.findByText('Layout review');
    expect(screen.getByRole('button', { name: /add action/i })).toBeInTheDocument();
    expect(screen.getByTestId('v4-project-actions')).toHaveClass('v4-bounded-page');
    for (const name of [
      'Open',
      'Due Soon',
      'Overdue',
      'Completed',
      'Action',
      'Priority',
      'Due Date',
      'Owner',
      'Category',
      'Status',
    ])
      expect(screen.getAllByText(name, { exact: true }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Action details')).not.toBeInTheDocument();
    expect(screen.getByText('Layout review')).toBeInTheDocument();
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Search actions')).toBeInTheDocument();
    for (const label of ['Status', 'Owner', 'Priority', 'Category'])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('drives search, filters, clear filters, selection and keyboard inspector behavior', async () => {
    renderActions();
    await screen.findByText('Layout review');
    const search = screen.getByPlaceholderText('Search actions...');
    fireEvent.change(search, { target: { value: 'schedule' } });
    expect(screen.queryByText('Layout review')).not.toBeInTheDocument();
    expect(screen.getByText('Schedule follow-up')).toBeInTheDocument();
    chooseFilter('Status', 'Waiting');
    chooseFilter('Priority', 'Urgent');
    expect(screen.getByRole('button', { name: 'Clear Filters' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    expect(search).toHaveValue('');
    const row = screen.getByText('Layout review').closest('tr')!;
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(await screen.findByLabelText('Action details')).toHaveTextContent('Layout review');
    fireEvent.click(screen.getByLabelText('Close action details'));
    expect(screen.queryByLabelText('Action details')).not.toBeInTheDocument();
  });

  it('uses an accessible keyboard-operable V4 filter listbox and closes it safely', async () => {
    renderActions();
    await screen.findByText('Layout review');
    const priority = screen.getByRole('button', { name: 'Priority' });
    fireEvent.keyDown(priority, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox', { name: 'Priority' })).toBeInTheDocument();
    expect(priority).toHaveTextContent('Low');
    fireEvent.keyDown(priority, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Priority' })).not.toBeInTheDocument();
    fireEvent.click(priority);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox', { name: 'Priority' })).not.toBeInTheDocument();
  });

  it('integrates six-row pagination and reconciles a filtered second page without stranding it', async () => {
    const actions = Array.from({ length: 8 }, (_, index) =>
      action(`page-${index + 1}`, `Paged action ${index + 1}`),
    );
    renderActions({ actions });
    await screen.findByText('Paged action 1');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(screen.getByText('Paged action 6')).toBeInTheDocument();
    expect(screen.queryByText('Paged action 7')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1–6 of 8 actions')).toBeInTheDocument();

    const pagination = screen.getByRole('navigation', { name: 'Action pages' });
    fireEvent.click(within(pagination).getByRole('button', { name: 'Page 2 of 2' }));
    expect(screen.getByText('Paged action 7')).toBeInTheDocument();
    expect(screen.getByText('Paged action 8')).toBeInTheDocument();
    expect(screen.queryByText('Paged action 1')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 7–8 of 8 actions')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search actions...'), {
      target: { value: 'Paged action 8' },
    });
    expect(screen.getByText('Paged action 8')).toBeInTheDocument();
    expect(screen.queryByText('No actions match the current filters.')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Action pages' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1–1 of 1 action')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    expect(screen.getByText('Paged action 1')).toBeInTheDocument();
    expect(screen.getByText('Paged action 6')).toBeInTheDocument();
    expect(screen.queryByText('Paged action 7')).not.toBeInTheDocument();
  });

  it('presents null, resolved and unresolved Categories truthfully in the table and Inspector', async () => {
    const unresolvedCategoryId = '44444444-4444-4444-8444-444444444444';
    renderActions({
      actions: [
        action('a1', 'Resolved category'),
        action('a2', 'Null category', { categoryId: null }),
        action('a3', 'Unresolved category', { categoryId: unresolvedCategoryId }),
      ],
    });
    await screen.findByText('Resolved category');

    const resolvedRow = screen.getByText('Resolved category').closest<HTMLTableRowElement>('tr')!;
    expect(within(resolvedRow).getByText(category.label)).toBeInTheDocument();
    expect(within(resolvedRow).queryByText('Category unavailable')).not.toBeInTheDocument();

    const nullRow = screen.getByText('Null category').closest<HTMLTableRowElement>('tr')!;
    expect(within(nullRow).getByText('Uncategorized')).toBeInTheDocument();

    const unresolvedRow = screen
      .getByText('Unresolved category')
      .closest<HTMLTableRowElement>('tr')!;
    expect(within(unresolvedRow).getByText('Category unavailable')).toBeInTheDocument();
    expect(within(unresolvedRow).queryByText('Uncategorized')).not.toBeInTheDocument();
    expect(within(unresolvedRow).queryByText(unresolvedCategoryId)).not.toBeInTheDocument();

    fireEvent.click(resolvedRow);
    const inspector = screen.getByLabelText('Action details');
    for (const label of [
      'Status',
      'Priority',
      'Due Date',
      'Owner',
      'Category',
      'Details',
      'Created',
      'Updated',
    ])
      expect(within(inspector).getByText(label, { exact: true })).toBeInTheDocument();
    expect(within(inspector).getAllByLabelText('Status')).toHaveLength(1);
    expect(within(inspector).getByLabelText('Close action details')).toBeInTheDocument();
    expect(inspector).toHaveTextContent('Resolved category');
    expect(inspector).toHaveTextContent('Sarah Ahmed');
    expect(inspector).toHaveTextContent('Resolved category detail');
    expect(inspector).toHaveTextContent('Resolved category notes');
    expect(inspector).toHaveTextContent('Lighting Designer');
    expect(within(inspector).getByText(category.label)).toBeInTheDocument();
    expect(within(inspector).getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
    expect(inspector).not.toHaveTextContent(/ACT-\d+/);
    fireEvent.keyDown(nullRow, { key: 'Enter' });
    expect(inspector).toHaveTextContent('Null category');
    expect(inspector).toHaveTextContent('Unassigned');
    expect(within(inspector).getByText('Uncategorized')).toBeInTheDocument();
    fireEvent.keyDown(unresolvedRow, { key: ' ' });
    expect(inspector).toHaveTextContent('Unresolved category');
    expect(within(inspector).getByText('Category unavailable')).toBeInTheDocument();
    expect(within(inspector).queryByText('Uncategorized')).not.toBeInTheDocument();
    expect(within(inspector).queryByText(unresolvedCategoryId)).not.toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Close action details' }));
    expect(screen.queryByLabelText('Action details')).not.toBeInTheDocument();
  });

  it('joins, orders, expands, collapses and navigates linked Meetings from the Action Inspector', async () => {
    const meetings = [
      linkedMeeting('m-old', 'Old meeting', '2026-08-01T06:00:00.000Z'),
      linkedMeeting('m-new', 'Newest meeting', '2026-08-20T06:00:00.000Z'),
      linkedMeeting('m-mid', 'Middle meeting', '2026-08-10T06:00:00.000Z'),
    ];
    renderActions({
      meetings,
      meetingLinks: [
        meetingLink('l-old', 'm-old', 'Linked'),
        meetingLink('l-new', 'm-new', 'CreatedFromMeeting'),
        meetingLink('l-mid', 'm-mid', 'Linked'),
      ],
    });
    fireEvent.click((await screen.findByText('Layout review')).closest('tr')!);
    const inspector = await screen.findByLabelText('Action details');
    const details = within(inspector).getByText('Details', { exact: true }).closest('section')!;
    const linked = within(inspector)
      .getByText('Linked Meetings', { exact: true })
      .closest('section')!;
    const notes = within(inspector).getByText('Notes', { exact: true }).closest('section')!;
    expect(details.compareDocumentPosition(linked) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(linked.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(linked).findByText('Newest meeting')).toBeInTheDocument();
    expect(within(linked).getByText('Middle meeting')).toBeInTheDocument();
    expect(within(linked).queryByText('Old meeting')).not.toBeInTheDocument();
    expect(within(linked).getByText('Created in this meeting')).toBeInTheDocument();
    expect(within(linked).getByText('Linked to this meeting')).toBeInTheDocument();

    fireEvent.click(within(linked).getByRole('button', { name: 'View all (3)' }));
    expect(within(linked).getByText('Old meeting')).toBeInTheDocument();
    expect(linked.querySelector('.v4-actions__linked-meeting-list--expanded')).toBeInTheDocument();
    fireEvent.click(within(linked).getByRole('button', { name: 'Show less' }));
    expect(within(linked).queryByText('Old meeting')).not.toBeInTheDocument();

    fireEvent.click(within(linked).getByRole('button', { name: /Newest meeting/ }));
    expect(await screen.findByRole('heading', { name: 'Meetings' })).toBeInTheDocument();
  });

  it('links the selected Manual Action to a filtered same-project Meeting without caller provenance', async () => {
    const meetings = [
      linkedMeeting('m-linked', 'Already linked meeting', '2026-08-01T06:00:00.000Z'),
      {
        ...linkedMeeting('m-target', 'Coordination target', '2026-08-20T06:00:00.000Z'),
        linkedActionsCount: 0,
      },
      {
        ...linkedMeeting('m-other', 'Other meeting', '2026-08-10T06:00:00.000Z'),
        linkedActionsCount: 0,
      },
    ];
    const fetch = renderActions({
      actions: [action('a1', 'Manual action', { sourceType: 'Manual', sourceId: null })],
      meetings,
      meetingLinks: [meetingLink('l-existing', 'm-linked', 'CreatedFromMeeting')],
    });
    fireEvent.click((await screen.findByText('Manual action')).closest('tr')!);
    const inspector = await screen.findByLabelText('Action details');
    expect(within(inspector).getByRole('button', { name: 'Link Meeting' })).toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Link Meeting' }));
    const search = within(inspector).getByLabelText('Search meetings');
    fireEvent.change(search, { target: { value: '  coordination  ' } });
    expect(
      await within(inspector).findByRole('radio', { name: /Coordination target/ }),
    ).toBeInTheDocument();
    expect(within(inspector).queryByRole('radio', { name: /Already linked meeting/ })).toBeNull();
    expect(within(inspector).queryByRole('radio', { name: /Other meeting/ })).toBeNull();
    expect(within(inspector).getByRole('button', { name: 'Link Meeting' })).toBeDisabled();
    fireEvent.click(within(inspector).getByRole('radio', { name: /Coordination target/ }));
    fireEvent.click(within(inspector).getByRole('button', { name: 'Link Meeting' }));

    expect(await within(inspector).findByText('Linked to this meeting')).toBeInTheDocument();
    const request = fetch.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/meetings/m-target/action-links') && init?.method === 'POST',
    );
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({ actionId: 'a1' });
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    expect(fetch.currentActions()[0]).toMatchObject({ sourceType: 'Manual', sourceId: null });
    expect(fetch.currentMeetings().find((item) => item.id === 'm-target')).toMatchObject({
      linkedActionsCount: 1,
      actionsCreatedCount: 0,
    });
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/meetings'))).toHaveLength(2),
    );
  });

  it('preserves Meeting picker search and selection on failure and reports truthful empty states', async () => {
    const target = linkedMeeting('m-target', 'Retry coordination', '2026-08-20T06:00:00.000Z');
    renderActions({ meetings: [target], linkMeetingFailure: 'Meeting link failed.' });
    fireEvent.click((await screen.findByText('Layout review')).closest('tr')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Link Meeting' }));
    const search = screen.getByLabelText('Search meetings');
    fireEvent.change(search, { target: { value: 'missing' } });
    expect(screen.getByText('No meetings match “missing”.')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'retry' } });
    const radio = await screen.findByRole('radio', { name: /Retry coordination/ });
    fireEvent.click(radio);
    fireEvent.click(screen.getByRole('button', { name: 'Link Meeting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Meeting link failed.');
    expect(search).toHaveValue('retry');
    expect(radio).toBeChecked();
    expect(screen.getByRole('button', { name: 'Link Meeting' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Link Meeting' })).toHaveFocus());
    cleanup();
    cleanupV4();

    renderActions({ meetings: [] });
    fireEvent.click((await screen.findByText('Layout review')).closest('tr')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Link Meeting' }));
    expect(
      await screen.findByText('No project meetings are available to link.'),
    ).toBeInTheDocument();
    cleanup();
    cleanupV4();

    renderActions({
      meetings: [target],
      meetingLinks: [meetingLink('l-target', 'm-target', 'Linked')],
    });
    fireEvent.click((await screen.findByText('Layout review')).closest('tr')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Link Meeting' }));
    expect(
      await screen.findByText('All project meetings are already linked to this action.'),
    ).toBeInTheDocument();
  });

  it('allows Action-side unlink only for Linked relations and reconciles canonically', async () => {
    const linked = linkedMeeting('m-linked', 'Linked meeting', '2026-08-20T06:00:00.000Z');
    const created = linkedMeeting('m-created', 'Created meeting', '2026-08-10T06:00:00.000Z');
    const fetch = renderActions({
      meetings: [linked, created],
      meetingLinks: [
        meetingLink('l-linked', 'm-linked', 'Linked'),
        meetingLink('l-created', 'm-created', 'CreatedFromMeeting'),
      ],
    });
    fireEvent.click((await screen.findByText('Layout review')).closest('tr')!);
    const inspector = await screen.findByLabelText('Action details');
    const unlink = await within(inspector).findByRole('button', {
      name: 'Unlink Linked meeting from this action',
    });
    expect(within(inspector).queryByRole('button', { name: /Unlink Created meeting/ })).toBeNull();
    unlink.focus();
    fireEvent.click(unlink);
    const confirmation = await screen.findByRole('dialog', {
      name: 'Unlink meeting from this action?',
    });
    expect(confirmation).toHaveTextContent('The Action and Meeting remain unchanged.');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(unlink).toHaveFocus());
    fireEvent.click(unlink);
    fireEvent.click(
      within(
        await screen.findByRole('dialog', { name: 'Unlink meeting from this action?' }),
      ).getByRole('button', { name: 'Unlink' }),
    );
    await waitFor(() => expect(within(inspector).queryByText('Linked meeting')).toBeNull());
    expect(within(inspector).getByText('Created meeting')).toBeInTheDocument();
    expect(fetch.currentActions().find((item) => item.id === 'a1')).toBeDefined();
    expect(fetch.currentMeetings().find((item) => item.id === 'm-linked')).toMatchObject({
      linkedActionsCount: 0,
      actionsCreatedCount: 0,
    });
  });

  it('keeps a failed Action-side unlink relation visible and retryable', async () => {
    const linked = linkedMeeting('m-linked', 'Persistent meeting', '2026-08-20T06:00:00.000Z');
    renderActions({
      meetings: [linked],
      meetingLinks: [meetingLink('l-linked', 'm-linked', 'Linked')],
      unlinkMeetingFailure: 'Meeting unlink failed.',
    });
    fireEvent.click((await screen.findByText('Layout review')).closest('tr')!);
    const inspector = await screen.findByLabelText('Action details');
    fireEvent.click(
      await within(inspector).findByRole('button', {
        name: 'Unlink Persistent meeting from this action',
      }),
    );
    const confirmation = await screen.findByRole('dialog', {
      name: 'Unlink meeting from this action?',
    });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Unlink' }));
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent(
      'Meeting unlink failed.',
    );
    expect(within(inspector).getByText('Persistent meeting')).toBeInTheDocument();
    expect(within(confirmation).getByRole('button', { name: 'Unlink' })).toBeEnabled();
  });

  it('keeps linked-Meeting loading, localized error/retry and empty states inside the Inspector', async () => {
    const pending = renderActions({ meetingLinksPending: true });
    fireEvent.click((await screen.findByText('Layout review')).closest('tr')!);
    expect(await screen.findByText('Loading linked meetings…')).toBeInTheDocument();
    expect(pending).toHaveBeenCalled();
    cleanup();
    cleanupV4();

    const failed = renderActions({ meetingLinksFailure: true });
    fireEvent.click((await screen.findByText('Layout review')).closest('tr')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Linked meetings could not be loaded.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        failed.mock.calls.filter(([url]) => /\/actions\/a1\/meeting-links$/.test(String(url))),
      ).toHaveLength(2),
    );
    cleanup();
    cleanupV4();

    renderActions();
    fireEvent.click((await screen.findByText('Layout review')).closest('tr')!);
    expect(await screen.findByText('No linked meetings.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link Meeting' })).toBeInTheDocument();
  });

  it('creates an Action from canonical defaults and reconciles the workspace after success', async () => {
    const fetch = renderActions();
    await screen.findByText('Layout review');
    fireEvent.click(screen.getByRole('button', { name: /add action/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Action' });
    expect(within(dialog).getByLabelText('Status')).toHaveValue('Open');
    expect(within(dialog).getByLabelText('Priority')).toHaveValue('Normal');
    expect(within(dialog).getByLabelText('Owner')).toHaveValue('');
    expect(within(dialog).getByLabelText('Owner Role')).toHaveValue('');
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('');
    const categoryGroup = within(dialog).getByRole('group', { name: 'Category' });
    expect(within(categoryGroup).getByRole('button', { name: 'Category' })).toHaveTextContent(
      'Uncategorized',
    );
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: '  New canonical action  ' },
    });

    fireEvent.change(within(dialog).getByLabelText('Notes'), {
      target: { value: 'Confirm against the reflected ceiling plan.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add action' }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/actions$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = fetch.mock.calls.find(
      ([url, init]) => /\/actions$/.test(url) && init?.method === 'POST',
    )!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      title: 'New canonical action',
      area: '',
      luminaireId: null,
      reviewItemId: null,
      details: '',
      owner: '',
      ownerRole: '',
      dueDate: null,
      status: 'Open',
      priority: 'Normal',
      categoryId: null,
      notes: 'Confirm against the reflected ceiling plan.',
      sourceType: 'Manual',
      sourceId: null,
      revisionId: null,
    });
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([url]) => url.endsWith('/workspace'))).toHaveLength(2),
    );
    expect(screen.queryByRole('dialog', { name: 'Add Action' })).not.toBeInTheDocument();
  });

  it('keeps the complete Action draft and Drawer open when creation fails', async () => {
    renderActions({ createActionFailure: 'Action could not be created.' });
    await screen.findByText('Layout review');
    fireEvent.click(screen.getByRole('button', { name: /add action/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Action' });
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: 'Failed action' },
    });
    fireEvent.change(within(dialog).getByLabelText('Details'), {
      target: { value: 'Retained details' },
    });

    fireEvent.change(within(dialog).getByLabelText('Notes'), {
      target: { value: 'Retained notes' },
    });
    fireEvent.change(within(dialog).getByLabelText('Due Date'), {
      target: { value: '2026-10-15' },
    });
    fireEvent.change(within(dialog).getByLabelText('Priority'), {
      target: { value: 'Urgent' },
    });
    fireEvent.change(within(dialog).getByLabelText('Status'), {
      target: { value: 'Waiting' },
    });
    chooseActionCategory(dialog, 'Coordination');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add action' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Action could not be created.',
    );
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Failed action');
    expect(within(dialog).getByLabelText('Details')).toHaveValue('Retained details');
    expect(within(dialog).getByLabelText('Owner')).toHaveValue('');
    expect(within(dialog).getByLabelText('Owner Role')).toHaveValue('');
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('Retained notes');
    expect(within(dialog).getByLabelText('Due Date')).toHaveValue('2026-10-15');
    expect(within(dialog).getByLabelText('Priority')).toHaveValue('Urgent');
    expect(within(dialog).getByLabelText('Status')).toHaveValue('Waiting');
    expect(within(dialog).getByRole('button', { name: 'Category' })).toHaveTextContent(
      'Coordination',
    );
    expect(screen.getByRole('dialog', { name: 'Add Action' })).toBeInTheDocument();
  });

  it('sends a complete canonical PATCH for an edit and exposes lifecycle menu actions', async () => {
    const fetch = renderActions();
    await screen.findByText('Layout review');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Layout review' }));
    expect(screen.getByRole('menu')).toHaveTextContent('Edit');
    expect(screen.getByRole('menu')).toHaveTextContent('Mark Complete');
    expect(screen.getByRole('menu')).toHaveTextContent('Cancel Action');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Updated title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/actions\/a1$/),
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const call = fetch.mock.calls.find(
      ([url, init]) => /\/actions\/a1$/.test(url) && init?.method === 'PATCH',
    )!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      title: 'Updated title',
      sourceType: 'Meeting',
      sourceId: action('a1', '').sourceId,
      revisionId: action('a1', '').revisionId,
      categoryId: category.id,
    });
    expect(body).not.toHaveProperty('completedAt');
  });

  it('uses one semantic Inspector Status trigger and preserves the canonical PATCH path', async () => {
    const fetch = renderActions();
    await screen.findByText('Layout review');
    fireEvent.click(screen.getByText('Layout review'));
    const inspector = screen.getByLabelText('Action details');
    const trigger = within(inspector).getByRole('button', { name: 'Status' });

    expect(within(inspector).getAllByRole('button', { name: 'Status' })).toHaveLength(1);
    expect(trigger).toHaveClass('v4-filter-select__trigger');
    expect(inspector.querySelector('select')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const menu = screen.getByRole('listbox', { name: 'Status' });
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    fireEvent.click(within(menu).getByRole('option', { name: 'Waiting' }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/actions\/a1$/),
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const call = fetch.mock.calls.find(
      ([url, init]) => /\/actions\/a1$/.test(url) && init?.method === 'PATCH',
    )!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({
      status: 'Waiting',
      ownerRole: 'Lighting Designer',
      notes: 'Layout review notes',
      categoryId: category.id,
      sourceType: 'Meeting',
      sourceId: action('a1', '').sourceId,
      revisionId: action('a1', '').revisionId,
    });
  });

  it('exposes the complete lifecycle menu matrix and preserves canonical fields in transitions', async () => {
    const items = [
      action('open-complete', 'Open complete', { status: 'Open' }),
      action('progress', 'In progress', { status: 'InProgress' }),
      action('waiting', 'Waiting complete', { status: 'Waiting' }),
      action('completed', 'Completed reopen', { status: 'Completed' }),
      action('open-cancel', 'Open cancel', { status: 'Open' }),
      action('cancelled', 'Cancelled reopen', { status: 'Cancelled' }),
    ];
    const fetch = renderActions({ actions: items });
    await screen.findByText('Open complete');

    const matrix = [
      ['Open complete', ['Edit', 'Mark Complete', 'Cancel Action']],
      ['In progress', ['Edit', 'Mark Complete', 'Cancel Action']],
      ['Waiting complete', ['Edit', 'Mark Complete', 'Cancel Action']],
      ['Completed reopen', ['Edit', 'Reopen']],
      ['Cancelled reopen', ['Edit', 'Reopen']],
    ] as const;
    for (const [title, expected] of matrix) {
      const trigger = screen.getByRole('button', { name: `Actions for ${title}` });
      fireEvent.click(trigger);
      const menu = screen.getByRole('menu');
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent),
      ).toEqual(expected);
      expect(within(menu).queryByText(/delete action/i)).not.toBeInTheDocument();
      fireEvent.click(trigger);
    }

    const transitions = [
      ['Open complete', 'Mark Complete', 'Completed'],
      ['Waiting complete', 'Mark Complete', 'Completed'],
      ['Completed reopen', 'Reopen', 'Open'],
      ['Open cancel', 'Cancel Action', 'Cancelled'],
      ['Cancelled reopen', 'Reopen', 'Open'],
    ] as const;
    for (const [title, command, status] of transitions) {
      fireEvent.click(screen.getByRole('button', { name: `Actions for ${title}` }));
      fireEvent.click(screen.getByRole('menuitem', { name: command }));
      await waitFor(() =>
        expect(
          fetch.mock.calls.filter(
            ([url, init]) => /\/actions\//.test(url) && init?.method === 'PATCH',
          ),
        ).toHaveLength(transitions.findIndex((entry) => entry[0] === title) + 1),
      );
      const calls = fetch.mock.calls.filter(
        ([url, init]) => /\/actions\//.test(url) && init?.method === 'PATCH',
      );
      const body = JSON.parse((calls.at(-1)![1] as RequestInit).body as string);
      expect(body).toMatchObject({
        status,
        sourceType: 'Meeting',
        sourceId: items[0]!.sourceId,
        revisionId: items[0]!.revisionId,
        categoryId: category.id,
      });
      expect(body).not.toHaveProperty('completedAt');
    }
  });

  it('keeps canonical Category order and submits the selected Category UUID with its icon/color cue', async () => {
    const fetch = renderActions({ categories: [secondCategory, category] });
    await screen.findByText('Layout review');
    fireEvent.click(screen.getByRole('button', { name: /add action/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Action' });
    const categoryGroup = within(dialog).getByRole('group', { name: 'Category' });
    fireEvent.click(within(categoryGroup).getByRole('button', { name: 'Category' }));
    const list = screen.getByRole('listbox', { name: 'Category' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Uncategorized', 'Lighting Design', 'Coordination']);
    const selected = within(list).getByRole('option', { name: 'Lighting Design' });
    expect(selected.querySelector('svg')).toBeInTheDocument();
    fireEvent.click(selected);
    expect(within(categoryGroup).getByRole('button', { name: 'Category' })).toHaveTextContent(
      'Lighting Design',
    );
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: 'Category identity action' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add action' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/actions$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = fetch.mock.calls.find(
      ([url, init]) => /\/actions$/.test(url) && init?.method === 'POST',
    )!;
    expect(JSON.parse((call[1] as RequestInit).body as string).categoryId).toBe(secondCategory.id);
  });

  it('preserves every Action draft field through Create, Manage and Edit Category round-trips', async () => {
    renderActions({ categories: [category, secondCategory] });
    await screen.findByText('Layout review');
    fireEvent.click(screen.getByRole('button', { name: /add action/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Action' });
    const values = {
      Title: 'Complete retained draft',
      Details: 'Every field survives',
      Owner: '',
      'Owner Role': '',
      'Due Date': '2026-09-30',
      Priority: 'Urgent',
      Status: 'Waiting',
      Notes: 'Parent note survives category work',
    };
    for (const [label, value] of Object.entries(values))
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    chooseActionCategory(dialog, 'Lighting Design');

    const assertDraft = () => {
      for (const [label, value] of Object.entries(values))
        expect(within(dialog).getByLabelText(label)).toHaveValue(value);
      expect(within(dialog).getByRole('button', { name: 'Category' })).toHaveTextContent(
        'Lighting Design',
      );
    };

    fireEvent.click(within(dialog).getByRole('button', { name: /new category/i }));
    expect(within(dialog).getByRole('heading', { name: 'Create Category' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    assertDraft();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Manage Categories' }));
    expect(within(dialog).getByRole('heading', { name: 'Manage Categories' })).toBeInTheDocument();
    const categoryRow = within(dialog)
      .getByText('Coordination')
      .closest<HTMLDivElement>('.v4-actions__manager-row')!;
    fireEvent.click(within(categoryRow).getByRole('button', { name: 'Edit' }));
    expect(within(dialog).getByRole('heading', { name: 'Edit Category' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    assertDraft();
  });

  it('creates a Category with the complete curated icon/color contract and auto-selects its UUID', async () => {
    const fetch = renderActions({ categories: [category], createdCategory: secondCategory });
    await screen.findByText('Layout review');
    fireEvent.click(screen.getByRole('button', { name: /add action/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Action' });
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: 'Draft survives Category creation' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /new category/i }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByRole('heading', { name: 'Create Category' })).toBeInTheDocument();
    const name = within(dialog).getByLabelText('Name');
    expect(name).toBeRequired();

    const iconGroup = within(dialog).getByRole('group', { name: 'Icon' });
    const iconButtons = within(iconGroup).getAllByRole('button');
    expect(iconButtons).toHaveLength(32);
    expect(iconButtons.map((button) => button.getAttribute('aria-label'))).toEqual(
      actionCategoryIconEntries.map((entry) => entry.label),
    );
    expect(within(iconGroup).getByRole('button', { name: 'Tags' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(iconGroup).getByRole('button', { name: 'Upload' }));
    expect(within(iconGroup).getByRole('button', { name: 'Upload' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(iconGroup).queryByRole('textbox')).not.toBeInTheDocument();

    const colorGroup = within(dialog).getByRole('group', { name: 'Color' });
    const colorButtons = within(colorGroup).getAllByRole('button');
    expect(colorButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'teal color',
      'blue color',
      'purple color',
      'gold color',
      'green color',
      'red color',
      'slate color',
    ]);
    expect(within(colorGroup).getByRole('button', { name: 'teal color' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(colorGroup).getByRole('button', { name: 'purple color' }));
    expect(within(colorGroup).getByRole('button', { name: 'purple color' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(colorGroup).queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.change(name, { target: { value: '  Lighting Design  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Category' }));
    await within(dialog).findByRole('heading', { name: 'Add Action' });
    const createCall = fetch.mock.calls.find(
      ([url, init]) => url.endsWith('/action-categories') && init?.method === 'POST',
    )!;
    expect(JSON.parse((createCall[1] as RequestInit).body as string)).toEqual({
      label: 'Lighting Design',
      iconKey: 'upload',
      colorKey: 'purple',
    });
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(
          ([url, init]) => url.endsWith('/action-categories') && init?.method === 'GET',
        ),
      ).toHaveLength(2),
    );
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Draft survives Category creation');
    expect(within(dialog).getByRole('button', { name: 'Category' })).toHaveTextContent(
      'Lighting Design',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add action' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/actions$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const actionCall = fetch.mock.calls.find(
      ([url, init]) => /\/actions$/.test(url) && init?.method === 'POST',
    )!;
    expect(JSON.parse((actionCall[1] as RequestInit).body as string).categoryId).toBe(
      secondCategory.id,
    );
  });

  it.each([
    [
      'duplicate',
      { message: 'A category with this name already exists.', status: 409 },
      'A category with this name already exists.',
    ],
    [
      'generic',
      { message: 'Catalog service unavailable.', status: 503 },
      'The category could not be saved. Please try again.',
    ],
  ])(
    'preserves Category and Action drafts after a %s Category creation failure',
    async (_kind, failure, expectedCopy) => {
      renderActions({ createCategoryFailure: failure });
      await screen.findByText('Layout review');
      fireEvent.click(screen.getByRole('button', { name: /add action/i }));
      const dialog = screen.getByRole('dialog', { name: 'Add Action' });
      fireEvent.change(within(dialog).getByLabelText('Title'), {
        target: { value: 'Retained parent draft' },
      });
      fireEvent.change(within(dialog).getByLabelText('Details'), {
        target: { value: 'Retained parent details' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: /new category/i }));
      fireEvent.change(within(dialog).getByLabelText('Name'), {
        target: { value: 'Retained Category name' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'purple color' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Category' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(expectedCopy);
      expect(within(dialog).getByRole('heading', { name: 'Create Category' })).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Retained Category name');
      expect(within(dialog).getByRole('button', { name: 'Upload' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(within(dialog).getByRole('button', { name: 'purple color' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
      expect(within(dialog).getByLabelText('Title')).toHaveValue('Retained parent draft');
      expect(within(dialog).getByLabelText('Details')).toHaveValue('Retained parent details');
    },
  );

  it('manages API-ordered Categories and edits name, icon and color by stable UUID', async () => {
    const updatedCategory: ActionCategory = {
      ...secondCategory,
      label: 'Updated Lighting',
      iconKey: 'upload',
      colorKey: 'green',
    };
    const fetch = renderActions({
      categories: [secondCategory, category],
      updatedCategory,
    });
    await screen.findByText('Layout review');
    fireEvent.click(screen.getByRole('button', { name: /add action/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Action' });
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: 'Manager parent draft' },
    });
    chooseActionCategory(dialog, 'Lighting Design');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Manage Categories' }));
    expect(dialog).toHaveTextContent('Categories are shared across all projects.');
    const rows = [...dialog.querySelectorAll<HTMLElement>('.v4-actions__manager-row')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'Lighting Design Edit Delete',
      'Coordination Edit Delete',
    ]);
    expect(rows[0]!.querySelector('.v4-actions__category')).toHaveClass(
      'v4-actions__category--purple',
    );
    expect(rows[1]!.querySelector('.v4-actions__category')).toHaveClass(
      'v4-actions__category--teal',
    );
    for (const row of rows) {
      expect(row.querySelector('svg')).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'Edit' })).toBeEnabled();
      expect(within(row).getByRole('button', { name: 'Delete' })).toBeEnabled();
    }
    expect(within(dialog).queryByRole('button', { name: /reorder|move up|move down/i })).toBeNull();

    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Edit' }));
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Lighting Design');
    expect(within(dialog).getByRole('button', { name: 'Lightbulb' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: 'purple color' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).queryByLabelText(/sort order/i)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Updated Lighting' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'green color' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Category' }));
    await within(dialog).findByRole('heading', { name: 'Manage Categories' });
    const updateCall = fetch.mock.calls.find(
      ([url, init]) =>
        url.endsWith(`/action-categories/${secondCategory.id}`) && init?.method === 'PATCH',
    )!;
    const body = JSON.parse((updateCall[1] as RequestInit).body as string);
    expect(body).toEqual({ label: 'Updated Lighting', iconKey: 'upload', colorKey: 'green' });
    expect(body).not.toHaveProperty('sortOrder');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Manager parent draft');
    expect(within(dialog).getByRole('button', { name: 'Category' })).toHaveTextContent(
      'Updated Lighting',
    );
  });

  it('retains Category edit and parent Action drafts when Category update fails', async () => {
    renderActions({
      categories: [category],
      updateCategoryFailure: { message: 'Update rejected.', status: 500 },
    });
    await screen.findByText('Layout review');
    fireEvent.click(screen.getByRole('button', { name: /add action/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Action' });
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: 'Parent survives update error' },
    });
    chooseActionCategory(dialog, 'Coordination');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Manage Categories' }));
    const row = within(dialog)
      .getByText('Coordination')
      .closest<HTMLDivElement>('.v4-actions__manager-row')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Failed edited name' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'red color' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Category' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The category could not be saved. Please try again.',
    );
    expect(within(dialog).getByRole('heading', { name: 'Edit Category' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Failed edited name');
    expect(within(dialog).getByRole('button', { name: 'Upload' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: 'red color' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Parent survives update error');
    expect(within(dialog).getByRole('button', { name: 'Category' })).toHaveTextContent(
      'Coordination',
    );
  });

  it('deletes a shared Category and reconciles the filter, draft, table and selected Inspector', async () => {
    const item = action('delete-action', 'Delete Category relation', { categoryId: category.id });
    const fetch = renderActions({ actions: [item], categories: [category] });
    await screen.findByText('Delete Category relation');
    const row = screen.getByText('Delete Category relation').closest<HTMLTableRowElement>('tr')!;
    fireEvent.click(row);
    chooseFilter('Category', 'Coordination');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Delete Category relation' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Action' });
    expect(within(dialog).getByRole('button', { name: 'Category' })).toHaveTextContent(
      'Coordination',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Manage Categories' }));
    const managerRow = within(dialog)
      .getByText('Coordination')
      .closest<HTMLDivElement>('.v4-actions__manager-row')!;
    fireEvent.click(within(managerRow).getByRole('button', { name: 'Delete' }));
    expect(dialog).toHaveTextContent('shared across all projects');
    expect(dialog).toHaveTextContent('Existing actions retain their identity');
    expect(within(dialog).getByRole('button', { name: 'Replacement category' })).toHaveTextContent(
      'Uncategorized',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Category' }));
    await within(dialog).findByRole('heading', { name: 'Manage Categories' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/action-categories/${category.id}$`)),
      expect.objectContaining({ method: 'DELETE' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Delete Category relation');
    expect(within(dialog).getByRole('button', { name: 'Category' })).toHaveTextContent(
      'Uncategorized',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent('Category: All'),
    );
    const reconciledRow = within(screen.getByRole('table'))
      .getByText('Delete Category relation')
      .closest<HTMLTableRowElement>('tr')!;
    expect(within(reconciledRow).getByText('Uncategorized')).toBeInTheDocument();
    const inspector = screen.getByLabelText('Action details');
    expect(inspector).toHaveTextContent('Delete Category relation');
    expect(within(inspector).getByText('Uncategorized')).toBeInTheDocument();
    expect(
      fetch.mock.calls.some(([url, init]) => /\/actions\//.test(url) && init?.method === 'DELETE'),
    ).toBe(false);
  });

  it('keeps the action draft while navigating Category creation/manager and exposes all picker controls', async () => {
    renderActions();
    await screen.findByText('Layout review');
    fireEvent.click(screen.getByRole('button', { name: /add action/i }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Preserved draft' } });
    expect(screen.getAllByText('Uncategorized').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /new category/i }));
    expect(screen.getAllByRole('button', { name: /lightbulb/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /color/i })).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Preserved draft');
    fireEvent.click(screen.getByRole('button', { name: 'Manage Categories' }));
    expect(
      screen.getAllByText('Categories are shared across all projects.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('keeps Actions visible and disables Category controls when catalog loading fails', async () => {
    const fetch = renderActions({ categoryFailure: true });
    expect(await screen.findByText('Layout review')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Category catalog is unavailable');
    expect(screen.getByLabelText('Category')).toBeDisabled();
    expect(screen.queryByText(category.id)).not.toBeInTheDocument();
    const categorizedRow = screen.getByText('Layout review').closest<HTMLTableRowElement>('tr')!;
    expect(within(categorizedRow).getByText('Category unavailable')).toBeInTheDocument();
    expect(within(categorizedRow).queryByText('Uncategorized')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add action/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Action' });
    const categoryGroup = within(dialog).getByRole('group', { name: 'Category' });
    expect(categoryGroup).toBeDisabled();
    expect(categoryGroup).toHaveTextContent('Category catalog is unavailable');
    expect(within(dialog).queryByRole('button', { name: /new category/i })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Manage Categories' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry categories' }));
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(
          ([url, init]) => url.endsWith('/action-categories') && init?.method === 'GET',
        ),
      ).toHaveLength(2),
    );
  });

  it('keeps the bounded page shell stable while the canonical workspace is loading', async () => {
    renderActions({ workspacePending: true });
    expect(await screen.findByRole('heading', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByTestId('v4-project-actions')).toHaveClass('v4-bounded-page');
    expect(screen.getByText('Loading actions…')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a bounded truthful workspace error without exposing technical detail', async () => {
    renderActions({ workspaceFailure: 'SQLITE_INTERNAL: stack trace details' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Project actions could not be loaded.',
    );
    expect(screen.getByTestId('v4-project-actions')).toHaveClass('v4-bounded-page');
    expect(screen.queryByText(/SQLITE_INTERNAL|stack trace/i)).not.toBeInTheDocument();
  });

  it('shows the true-empty state without describing it as filtered', async () => {
    renderActions({ actions: [] });
    const emptyState = (await screen.findByText('No actions yet')).closest<HTMLDivElement>(
      '.v4-actions__empty',
    )!;
    expect(emptyState).toHaveTextContent(
      'Create an action to track project follow-ups and design work.',
    );
    expect(screen.queryByText('No actions match the current filters.')).not.toBeInTheDocument();
    fireEvent.click(within(emptyState).getByRole('button', { name: /add action/i }));
    expect(await screen.findByRole('heading', { name: 'Add Action' })).toBeInTheDocument();
  });

  it('shows filtered-empty copy and restores canonical rows with Clear Filters', async () => {
    renderActions();
    await screen.findByText('Layout review');
    fireEvent.change(screen.getByPlaceholderText('Search actions...'), {
      target: { value: 'nothing matches' },
    });
    const emptyState = screen
      .getByText('No actions match the current filters.')
      .closest<HTMLDivElement>('.v4-actions__empty')!;
    expect(screen.queryByText('No actions yet')).not.toBeInTheDocument();
    fireEvent.click(within(emptyState).getByRole('button', { name: 'Clear Filters' }));
    expect(screen.getByText('Layout review')).toBeInTheDocument();
    expect(screen.getByText('Schedule follow-up')).toBeInTheDocument();
  });
});

describe('Final Actions production route', () => {
  it('saves completion with the current row version without rewriting provenance', async () => {
    stubMatchMedia();
    const fetch = stubApi({
      actions: [action('a1', 'Canonical linked task', { rowVersion: 7, area: 'Lobby' })],
    });
    renderV4(<ProductionRouter />, ['/projects/p1/actions']);
    fireEvent.click(await screen.findByRole('button', { name: 'Canonical linked task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark Complete' }));
    await waitFor(() => expect(fetch.currentActions()[0]?.status).toBe('Completed'));
    const call = fetch.mock.calls.find(
      ([url, init]) => url.endsWith('/actions/a1/merge') && init?.method === 'PATCH',
    );
    expect(call).toBeDefined();
    const body = JSON.parse(call![1]!.body as string);
    expect(body).toMatchObject({ rowVersion: 7, status: 'Completed', area: 'Lobby' });
    expect(body).not.toHaveProperty('sourceType');
    expect(body).not.toHaveProperty('sourceId');
    expect(body).not.toHaveProperty('revisionId');
    expect(fetch.currentActions()[0]?.sourceId).toBe('11111111-1111-4111-8111-111111111111');
  });
  it('filters real overdue actions and opens the existing editor', async () => {
    stubMatchMedia();
    stubApi({
      actions: [
        action('a1', 'Overdue task', { dueDate: '2000-01-01' }),
        action('a2', 'Future task', { dueDate: '2099-01-01' }),
      ],
    });
    renderV4(<ProductionRouter />, ['/projects/p1/actions']);
    await screen.findByRole('button', { name: 'Future task' });
    fireEvent.click(screen.getByRole('button', { name: 'View Overdue actions' }));
    expect(screen.queryByRole('button', { name: 'Future task' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overdue task' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Area')).toHaveValue('');
  });
});

function chooseActionCategory(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Category' }));
  fireEvent.click(
    within(screen.getByRole('listbox', { name: 'Category' })).getByRole('option', { name }),
  );
}
