/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ProjectReviewItem, ProjectReviewReply } from '@scli/domain';
import { V4Router as ProductionRouter } from '../../router/V4Router';
import { Route, Routes } from 'react-router-dom';
import { ProjectCommentsWorkspace } from './ProjectCommentsWorkspace';
function V4Router() {
  return (
    <Routes>
      <Route path="/projects/:projectId/comments" element={<ProjectCommentsWorkspace />} />
      <Route path="*" element={<ProductionRouter />} />
    </Routes>
  );
}
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const project = {
  id: 'p1',
  projectCode: '001_SCT_TEST',
  projectName: 'Comments project',
  clientName: 'Scientechnic',
  projectType: 'Lighting Design',
  designStage: 'Technical',
  requiredDeliveryDate: null,
  status: 'InProgress',
  version: 1,
};

const root = (id: string, overrides: Partial<ProjectReviewItem> = {}): ProjectReviewItem => ({
  id,
  projectId: 'p1',
  reference: '',
  title: `Thread ${id}`,
  description: `Description ${id}`,
  area: '',
  luminaireTag: '',
  drawingReference: '',
  sourceType: 'Manual',
  sourceId: null,
  status: 'Open',
  response: '',
  revisionId: null,
  origin: 'Internal',
  authorId: `author-${id}`,
  authorNameSnapshot: `Author ${id}`,
  authorRoleSnapshot: 'Lighting Designer',
  luminaireId: null,
  receivedAt: '2026-08-15',
  dueDate: null,
  createdAt: `2026-08-${String(20 - Number(id)).padStart(2, '0')}T10:00:00.000Z`,
  updatedAt: `2026-08-${String(20 - Number(id)).padStart(2, '0')}T10:00:00.000Z`,
  ...overrides,
});

const reply = (id: string, overrides: Partial<ProjectReviewReply> = {}): ProjectReviewReply => ({
  id,
  projectId: 'p1',
  reviewItemId: '1',
  body: `Reply ${id}`,
  authorId: `reply-author-${id}`,
  authorNameSnapshot: `Reply Author ${id}`,
  authorRoleSnapshot: 'Engineer',
  origin: 'Internal',
  createdAt: `2026-08-15T1${id}:00:00.000Z`,
  updatedAt: `2026-08-15T1${id}:00:00.000Z`,
  ...overrides,
});

const workspace = (reviewItems: ProjectReviewItem[], documents: unknown[] = []) => ({
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
  tags: [],
  scopeNotes: [],
  checklist: [],
  actions: [],
  meetings: [],
  reviewItems,
  revisions: [],
  documents,
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
  updatedAt: '2026-08-15T00:00:00.000Z',
});

const response = (data: unknown, ok = true, message = 'Request failed') => ({
  ok,
  status: ok ? 200 : 500,
  headers: { get: () => 'correlation-id' },
  json: () => Promise.resolve(ok ? { data } : { error: { message } }),
});

function stubApi(
  options: {
    roots?: ProjectReviewItem[];
    replies?: ProjectReviewReply[];
    contextFailure?: boolean;
    replyFailure?: boolean;
    attachmentFailure?: boolean;
    documents?: unknown[];
    workspaceDelay?: Promise<void>;
  } = {},
) {
  let roots = options.roots ?? [root('1'), root('2'), root('3'), root('4')];
  let replies = options.replies ?? [reply('2'), reply('1')];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/review-thread-context')) {
      return Promise.resolve(
        options.contextFailure
          ? response({}, false, 'Context failed')
          : response({ replies, attachments: [] }),
      );
    }
    if (url.endsWith('/workspace')) {
      const result = () => response(workspace(roots, options.documents));
      return options.workspaceDelay
        ? options.workspaceDelay.then(result)
        : Promise.resolve(result());
    }
    if (url.endsWith('/api/projects/p1')) return Promise.resolve(response(project));
    if (url.endsWith('/replies') && init?.method === 'POST') {
      if (options.replyFailure) return Promise.resolve(response({}, false, 'Reply failed'));
      const body = JSON.parse(String(init.body)) as { body: string; origin: 'Internal' | 'Client' };
      const created = reply(String(9 + replies.length), {
        body: body.body,
        origin: body.origin,
        createdAt: '2026-08-15T19:00:00.000Z',
      });
      replies = [...replies, created];
      return Promise.resolve(response(created));
    }
    if (url.endsWith('/attachments') && init?.method === 'POST') {
      return Promise.resolve(
        options.attachmentFailure
          ? response({}, false, 'Link failed')
          : response({ id: 'attachment-1' }),
      );
    }
    if (/\/review-items\//.test(url) && init?.method === 'PATCH') {
      const id = url.split('/').at(-1)!;
      const body = JSON.parse(String(init.body)) as Partial<ProjectReviewItem>;
      const current = roots.find((item) => item.id === id)!;
      const updated = { ...current, ...body };
      roots = roots.map((item) => (item.id === id ? updated : item));
      return Promise.resolve(response(updated));
    }
    return Promise.resolve(response({}));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const renderPage = () => {
  stubMatchMedia();
  renderV4(<V4Router />, ['/projects/p1/comments']);
};

describe('Preserved Comments workspace and editors', () => {
  afterEach(() => {
    cleanup();
    cleanupV4();
  });

  it('renders the direct route, reference toolbar, exactly three roots, and pagination', async () => {
    stubApi();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Comments' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Comment' })).toBeInTheDocument();
    expect(
      await screen.findByLabelText('Search comments, people, or keywords'),
    ).toBeInTheDocument();
    const collection = screen.getByRole('region', { name: 'Project comment threads' });
    expect(collection.querySelectorAll(':scope .v4-comments__thread')).toHaveLength(3);
    expect(screen.getByRole('navigation', { name: 'Comment pages' })).toBeInTheDocument();
  });

  it('selects the first visible root once and keeps an explicit inspector close closed across view rerenders', async () => {
    stubApi({ roots: [root('1', { origin: 'Client' }), root('2'), root('3'), root('4')] });
    renderPage();

    const first = await screen.findByRole('button', { name: 'Thread 1' });
    await waitFor(() => expect(first).toHaveAttribute('aria-pressed', 'true'));
    expect(first.closest('article')).toHaveClass('v4-comments__thread--selected');
    expect(screen.getByRole('complementary', { name: 'Thread details' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close thread details' }));
    expect(screen.queryByRole('complementary', { name: 'Thread details' })).not.toBeInTheDocument();
    const toolbar = screen.getByLabelText('Comment filters');
    fireEvent.click(within(toolbar).getByRole('button', { name: /Client/ }));
    fireEvent.click(within(toolbar).getByRole('button', { name: /All/ }));
    fireEvent.change(screen.getByLabelText('Search comments, people, or keywords'), {
      target: { value: 'Thread' },
    });
    fireEvent.change(screen.getByLabelText('Search comments, people, or keywords'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.queryByRole('complementary', { name: 'Thread details' })).not.toBeInTheDocument();
  });

  it('keeps an initially empty collection unselected', async () => {
    stubApi({ roots: [] });
    renderPage();
    expect(await screen.findByText('No comments yet')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Thread details' })).not.toBeInTheDocument();
  });

  it('selects once when the first populated workspace arrives asynchronously', async () => {
    let releaseWorkspace!: () => void;
    const workspaceDelay = new Promise<void>((resolve) => {
      releaseWorkspace = resolve;
    });
    stubApi({ roots: [root('1')], workspaceDelay });
    renderPage();
    expect(screen.queryByRole('complementary', { name: 'Thread details' })).not.toBeInTheDocument();

    await act(async () => releaseWorkspace());
    expect(
      await screen.findByRole('complementary', { name: 'Thread details' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thread 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('presents InProgress consistently while preserving the canonical select value', async () => {
    stubApi({ roots: [root('1', { status: 'InProgress' })] });
    renderPage();
    await screen.findByRole('button', { name: 'Thread 1' });
    await waitFor(() => expect(document.querySelectorAll('.v4-comments__status')).toHaveLength(2));
    document.querySelectorAll('.v4-comments__status').forEach((element) => {
      expect(element).toHaveTextContent('In Progress');
      expect(element).toHaveAttribute('data-status', 'InProgress');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filter comments' }));
    const statusFilter = screen.getByRole('combobox', { name: 'Status' });
    expect(within(statusFilter).getByRole('option', { name: 'In Progress' })).toHaveValue(
      'InProgress',
    );
    fireEvent.change(statusFilter, { target: { value: 'InProgress' } });
    expect(statusFilter).toHaveValue('InProgress');
    expect(screen.getByRole('button', { name: 'Thread 1' })).toBeInTheDocument();
  });

  it('filters roots with complete counts before pagination and searches reply content', async () => {
    stubApi({
      roots: [
        root('1', { origin: 'Client' }),
        root('2'),
        root('3', { status: 'Resolved' }),
        root('4', { origin: null }),
      ],
    });
    renderPage();
    await screen.findByText('Thread 1');
    const client = within(screen.getByLabelText('Comment filters')).getByRole('button', {
      name: /Client/,
    });
    expect(client).toHaveTextContent('1');
    fireEvent.click(client);
    expect(screen.getByRole('button', { name: 'Thread 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thread 2' })).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByLabelText('Comment filters')).getByRole('button', { name: /All/ }),
    );
    fireEvent.change(screen.getByLabelText('Search comments, people, or keywords'), {
      target: { value: 'Reply 2' },
    });
    expect(await screen.findByRole('button', { name: 'Thread 1' })).toBeInTheDocument();
  });

  it('expands only the selected thread, orders replies, and shows seven inspector sections', async () => {
    stubApi();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thread 1' }));
    expect(screen.getByLabelText('Thread replies')).toBeInTheDocument();
    const replyRows = screen
      .getByLabelText('Thread replies')
      .querySelectorAll('.v4-comments__reply');
    expect(replyRows[0]).toHaveTextContent('Reply 1');
    expect(replyRows[1]).toHaveTextContent('Reply 2');
    const inspector = screen.getByRole('complementary', { name: 'Thread details' });
    expect(within(inspector).getByRole('heading', { name: 'Thread Details' })).toBeInTheDocument();
    expect(inspector.querySelectorAll(':scope > section')).toHaveLength(7);
    expect(within(inspector).getByText('Thread Participants (3)')).toBeInTheDocument();
  });

  it('posts an Internal reply from the composer and reconciles server truth', async () => {
    const fetch = stubApi({ replies: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thread 1' }));
    fireEvent.change(screen.getByLabelText('Write a reply'), {
      target: { value: 'Updated calculation.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/replies$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(await screen.findByText('Updated calculation.')).toBeInTheDocument();
    expect(screen.getByLabelText('Write a reply')).toHaveValue('');
  });

  it('retains a failed reply draft and reports a localized context failure truthfully', async () => {
    stubApi({ contextFailure: true });
    renderPage();
    expect(
      await screen.findByText('Replies and linked documents could not be loaded.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Replies unavailable').length).toBeGreaterThan(0);
  });

  it('keeps a posted reply truthful when its selected document link fails', async () => {
    const registeredDocument = {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: 'p1',
      title: 'Registered document',
      documentNumber: 'DOC-1',
      category: 'Other',
      revision: '',
      status: 'Working',
      filePath: '',
      issuedTo: '',
      issueDate: null,
      notes: '',
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    };
    const options = { replies: [], documents: [registeredDocument], attachmentFailure: true };
    const fetch = stubApi(options);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thread 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link existing project document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Existing project document' }));
    fireEvent.click(screen.getByRole('option', { name: registeredDocument.title }));
    fireEvent.change(screen.getByLabelText('Write a reply'), {
      target: { value: 'Posted before link' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(await screen.findByText('Posted before link')).toBeInTheDocument();
    expect(
      await screen.findByText('Reply posted, but the document could not be linked.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry link' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Write a reply'), {
      target: { value: 'Another saved reply' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await screen.findByText('Another saved reply');
    expect(screen.getByRole('button', { name: 'Retry link' })).toBeInTheDocument();
    options.attachmentFailure = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry link' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Retry link' })).not.toBeInTheDocument(),
    );
    expect(
      fetch.mock.calls.filter(([url, init]) => url.endsWith('/replies') && init?.method === 'POST'),
    ).toHaveLength(2);
    const linked = fetch.mock.calls.filter(
      ([url, init]) => url.endsWith('/attachments') && init?.method === 'POST',
    );
    expect(linked).toHaveLength(2);
    expect(linked[1]?.[0]).toEqual(linked[0]?.[0]);
  });

  it('opens Add Comment using the shared drawer and protects a dirty draft', async () => {
    stubApi({ roots: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Comment' }));
    expect(screen.getByRole('dialog', { name: 'Add Comment' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New client note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Unsaved comment changes' }),
    ).toBeInTheDocument();
  });
});

describe('Final Comments production route', () => {
  afterEach(() => {
    cleanup();
    cleanupV4();
  });
  it('binds every persisted thread, filters, replies, and lifecycle through the production router', async () => {
    const fetch = stubApi();
    stubMatchMedia();
    renderV4(<ProductionRouter />, ['/projects/p1/comments']);
    const collection = await screen.findByRole('region', { name: 'Project comment threads' });
    expect(await screen.findByRole('region', { name: 'Project metadata' })).toBeVisible();
    await waitFor(() => expect(within(collection).getAllByRole('article')).toHaveLength(4));
    const thread = within(collection).getByRole('article', { name: 'Thread 1' });
    fireEvent.click(within(thread).getByRole('button', { name: 'Thread 1' }));
    expect(within(thread).queryByRole('textbox', { name: 'Reply to Thread 1' })).toBeNull();
    fireEvent.click(within(thread).getByRole('button', { name: 'Reply' }));
    fireEvent.change(within(thread).getByRole('textbox', { name: 'Reply to Thread 1' }), {
      target: { value: 'Persisted final reply' },
    });
    fireEvent.click(within(thread).getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(within(thread).getByText('Persisted final reply')).toBeVisible());
    expect(
      fetch.mock.calls.some(
        ([url, init]) =>
          url.endsWith('/review-items/1/replies') &&
          init?.method === 'POST' &&
          String(init.body).includes('Persisted final reply'),
      ),
    ).toBe(true);
    fireEvent.click(within(thread).getByRole('button', { name: 'Resolve' }));
    await waitFor(() =>
      expect(within(thread).getByRole('button', { name: 'Reopen' })).toBeVisible(),
    );
    fireEvent.change(screen.getByLabelText('Search comments, people, or keywords'), {
      target: { value: 'Thread 4' },
    });
    expect(within(collection).getAllByRole('article')).toHaveLength(1);
    expect(within(collection).getByRole('article', { name: 'Thread 4' })).toBeVisible();
  });
  it('retains the final inline reply when persistence fails', async () => {
    stubApi({ replyFailure: true });
    stubMatchMedia();
    renderV4(<ProductionRouter />, ['/projects/p1/comments']);
    const thread = await screen.findByRole('article', { name: 'Thread 1' });
    fireEvent.click(within(thread).getByRole('button', { name: 'Reply' }));
    await waitFor(() =>
      expect(within(thread).getByRole('textbox', { name: 'Reply to Thread 1' })).toBeVisible(),
    );
    const input = within(thread).getByRole('textbox', { name: 'Reply to Thread 1' });
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fireEvent.click(within(thread).getByRole('button', { name: 'Send reply' }));
    await screen.findByText('Reply failed');
    expect(input).toHaveValue('Keep this draft');
  });
});
