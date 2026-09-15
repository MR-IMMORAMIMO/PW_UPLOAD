/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ProjectContactsPage } from './ProjectContactsPage';
import { V4OverlayProvider } from '../../components/interaction/V4OverlayProvider';
import { stubMatchMedia } from '../../test-utils/renderV4';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  workspace: vi.fn(),
  me: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  salesUsers: vi.fn(),
}));
vi.mock('../../api/environment', () => ({
  api: {
    project: mocks.project,
    projectWorkspace: mocks.workspace,
    me: mocks.me,
    createContact: mocks.createContact,
    updateContact: mocks.updateContact,
    salesUsers: mocks.salesUsers,
  },
}));
const contact = (
  id: string,
  projectId = first,
  role = 'Client',
  email = 'person@example.test',
) => ({
  id,
  projectId,
  name: id,
  email,
  company: '',
  role,
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-02T10:00:00Z',
});
function mount() {
  const router = createMemoryRouter(
    [
      {
        path: '/projects/:projectId/contacts',
        element: (
          <V4OverlayProvider>
            <ProjectContactsPage />
          </V4OverlayProvider>
        ),
      },
    ],
    { initialEntries: [`/projects/${first}/contacts`] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
beforeEach(() => {
  stubMatchMedia();
  mocks.project.mockImplementation(async (id: string) => ({
    id,
    projectCode: 'UAT-01',
    projectName: `Project ${id}`,
    clientName: '',
    projectType: 'Lighting',
    designStage: 'Concept',
    status: 'InProgress',
    requiredDeliveryDate: null,
  }));
  mocks.workspace.mockResolvedValue({
    projectId: first,
    contacts: [
      contact('Alice'),
      contact('Bob', first, 'Lighting Designer', ''),
      contact('Intruder', second),
    ],
  });
  mocks.salesUsers.mockResolvedValue([]);
  mocks.createContact.mockResolvedValue(contact('Saved'));
  mocks.updateContact.mockResolvedValue(contact('Alice'));
  mocks.me.mockResolvedValue({ displayName: 'Local Owner', email: 'owner@example.test' });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
describe('final Contacts integration', () => {
  it('uses route-scoped records and does not infer team, primary or phone values', async () => {
    mount();
    await screen.findByRole('button', { name: 'Alice' });
    expect(mocks.workspace).toHaveBeenCalledWith(first);
    expect(screen.queryByText('Intruder')).not.toBeInTheDocument();
    expect(screen.getAllByText('Lighting Designer').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Call Alice' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByText('Sarah Al-Mansoori')).not.toBeInTheDocument();
    expect(screen.queryByText('Maya Kim')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Contact' })).toBeEnabled();
  });
  it('selects, searches, filters and copies real fields without mutations', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Alice' }));
    expect(screen.getByTestId('v4-project-contacts')).toHaveAttribute(
      'data-selected-contact',
      'Alice',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy details for Alice' }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'Alice\nClient\nperson@example.test',
      ),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search contacts' }), {
      target: { value: 'Bob' },
    });
    expect(screen.queryByRole('button', { name: 'Alice' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter contacts by role' }), {
      target: { value: 'Client' },
    });
    expect(screen.getByText('No contacts match this search or filter.')).toBeVisible();
  });
  it('clears selection and suppresses old records while switching Projects', async () => {
    const router = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Alice' }));
    let release: (value: unknown) => void = () => {};
    mocks.workspace.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await act(() => router.navigate(`/projects/${second}/contacts`));
    expect(screen.queryByRole('button', { name: 'Alice' })).not.toBeInTheDocument();
    expect(screen.getByTestId('v4-project-contacts')).toHaveAttribute('data-selected-contact', '');
    await act(async () => release({ projectId: second, contacts: [contact('Second', second)] }));
    expect(await screen.findByRole('button', { name: 'Second' })).toBeVisible();
  });
  it('keeps the same regions for loading, empty and error states', async () => {
    mocks.workspace.mockRejectedValue(new Error('Unavailable'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Contacts could not be loaded');
    expect(screen.getByText('Contact Summary')).toBeVisible();
    mocks.workspace.mockResolvedValue({ projectId: first, contacts: [] });
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No contacts yet.')).toBeVisible();
  });
  it('reports clipboard failures instead of fake success', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
    mount();
    await screen.findByRole('button', { name: 'Alice' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy details for Alice' }));
    expect(await screen.findByText('Contact details could not be copied.')).toBeInTheDocument();
  });
  it('creates and edits through the preserved editor using the current Project UUID', async () => {
    mount();
    await screen.findByRole('button', { name: 'Alice' });
    fireEvent.click(screen.getByRole('button', { name: 'Add Contact' }));
    const drawer = await screen.findByRole('dialog', { name: 'Add Contact' });
    fireEvent.change(within(drawer).getByLabelText('Full name *'), {
      target: { value: 'Charlie' },
    });
    fireEvent.change(within(drawer).getByLabelText('Email (optional)'), {
      target: { value: 'charlie@example.test' },
    });
    fireEvent.change(within(drawer).getByLabelText('Phone'), {
      target: { value: '+971 50 1234567' },
    });
    fireEvent.click(within(drawer).getByLabelText('Primary contact'));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add Contact' }));
    await waitFor(() =>
      expect(mocks.createContact).toHaveBeenCalledWith(first, {
        name: 'Charlie',
        email: 'charlie@example.test',
        company: '',
        role: '',
        phone: '+971 50 1234567',
        isPrimary: true,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Add Contact' })).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Alice' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Contact details' })).getByRole('button', {
        name: 'Edit contact',
      }),
    );
    const edit = await screen.findByRole('dialog', { name: 'Edit Contact' });
    fireEvent.change(within(edit).getByLabelText('Company'), {
      target: { value: 'Updated company' },
    });
    fireEvent.click(within(edit).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(mocks.updateContact).toHaveBeenCalledWith(
        first,
        'Alice',
        expect.objectContaining({ company: 'Updated company' }),
      ),
    );
  });

  it('requires explicit confirmation before replacing the primary contact and preserves a cancelled draft', async () => {
    mocks.workspace.mockResolvedValue({
      projectId: first,
      contacts: [{ ...contact('Alice', first, ''), isPrimary: true }],
    });
    mount();
    await screen.findByRole('button', { name: 'Alice' });
    fireEvent.click(screen.getByRole('button', { name: 'Add Contact' }));
    const editor = await screen.findByRole('dialog', { name: 'Add Contact' });
    fireEvent.change(within(editor).getByLabelText('Full name *'), {
      target: { value: 'Charlie' },
    });
    fireEvent.click(within(editor).getByLabelText('Primary contact'));
    fireEvent.click(within(editor).getByRole('button', { name: 'Add Contact' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Replace primary contact' });
    expect(mocks.createContact).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Replace primary contact' }),
      ).not.toBeInTheDocument(),
    );
    expect(within(editor).getByLabelText('Full name *')).toHaveValue('Charlie');
    fireEvent.click(within(editor).getByRole('button', { name: 'Add Contact' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Replace primary contact' })).getByRole(
        'button',
        { name: 'Replace primary contact' },
      ),
    );
    await waitFor(() =>
      expect(mocks.createContact).toHaveBeenCalledWith(
        first,
        expect.objectContaining({ name: 'Charlie', isPrimary: true }),
      ),
    );
  });

  it('renders persisted primary/phone and uses the narrow desktop contact action', async () => {
    mocks.workspace.mockResolvedValue({
      projectId: first,
      contacts: [{ ...contact('Alice'), phone: '+971 50 1234567', isPrimary: true }],
    });
    const openContactLink = vi.fn().mockResolvedValue(true);
    window.scliDesktop = { openContactLink };
    try {
      mount();
      await screen.findByRole('button', { name: 'Alice' });
      expect(screen.getByText('Primary')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Call Alice' }));
      await waitFor(() =>
        expect(openContactLink).toHaveBeenCalledWith({ kind: 'phone', value: '+971 50 1234567' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Email Alice' }));
      await waitFor(() =>
        expect(openContactLink).toHaveBeenCalledWith({
          kind: 'email',
          value: 'person@example.test',
        }),
      );
    } finally {
      delete window.scliDesktop;
    }
  });
  it('offers the actual number when the desktop cannot launch a calling application', async () => {
    mocks.workspace.mockResolvedValue({
      projectId: first,
      contacts: [{ ...contact('Alice'), phone: '+971 50 1234567' }],
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.scliDesktop = { openContactLink: vi.fn().mockResolvedValue(false) };
    try {
      mount();
      await screen.findByRole('button', { name: 'Alice' });
      fireEvent.click(screen.getByRole('button', { name: 'Call Alice' }));
      const dialog = await screen.findByRole('dialog', { name: 'Call contact' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Copy number' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('+971 50 1234567'));
    } finally {
      delete window.scliDesktop;
    }
  });
});
