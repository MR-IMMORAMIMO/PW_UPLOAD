/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WorkspaceSearch } from './WorkspaceSearch';
import { stubMatchMedia } from '../../test-utils/renderV4';

const search = vi.hoisted(() => vi.fn());
vi.mock('../../api/environment', () => ({ api: { workspaceSearch: search } }));
beforeEach(() => {
  stubMatchMedia();
  search.mockReset();
});
afterEach(cleanup);
function mount() {
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <WorkspaceSearch onClose={close} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return close;
}
describe('Workspace search', () => {
  it('does not send one-character queries rejected by the server', async () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search workspace' }), {
      target: { value: 'a' },
    });
    expect(screen.getByText(/at least 2 characters/)).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(search).not.toHaveBeenCalled();
  });
  it.each([
    ['Meeting', 'meetings?meetingId=record'],
    ['Review', 'comments?threadId=record'],
    ['Document', 'files?documentId=record'],
    ['Luminaire', 'luminaires?luminaireId=record'],
  ])('opens the exact %s record', async (type, destination) => {
    search.mockResolvedValue([
      { id: 'record', projectId: 'project', type, title: 'Found record', detail: '' },
    ]);
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search workspace' }), {
      target: { value: 'record' },
    });
    expect(await screen.findByRole('link', { name: /Found record/ })).toHaveAttribute(
      'href',
      `/projects/project/${destination}`,
    );
  });
  it('waits for a query and links a server result to its owning project', async () => {
    search.mockResolvedValue([
      {
        id: 'action-id',
        projectId: 'project-id',
        type: 'Action',
        title: 'Review layout',
        detail: 'Audit project',
      },
    ]);
    const close = mount();
    expect(search).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search workspace' }), {
      target: { value: '  layout  ' },
    });
    const link = await screen.findByRole('link', { name: /Review layout/ });
    expect(search).toHaveBeenCalledWith('layout');
    expect(link).toHaveAttribute('href', '/projects/project-id/actions?actionId=action-id');
    fireEvent.click(link);
    expect(close).toHaveBeenCalledOnce();
  });
  it('explains empty results and lets an unsuccessful query retry', async () => {
    search.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search workspace' }), {
      target: { value: 'missing' },
    });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText(/No results for/)).toBeVisible());
    expect(search).toHaveBeenCalledTimes(2);
  });
});
