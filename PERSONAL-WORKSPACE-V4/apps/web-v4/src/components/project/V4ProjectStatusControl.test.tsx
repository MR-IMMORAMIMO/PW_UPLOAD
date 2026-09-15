/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Project } from '@scli/domain';
import { V4ProjectStatusControl } from './V4ProjectStatusControl';

const project = {
  id: '00000000-0000-4000-8000-000000000001',
  projectName: 'Status Test',
  status: 'ClientReview',
} as Project;

function reply(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 409,
    headers: { get: () => 'correlation' },
    json: () =>
      Promise.resolve(ok ? { data } : { error: { code: 'CONFLICT', message: 'Stale status' } }),
  };
}

describe('V4ProjectStatusControl', () => {
  it('shows the complete shared lifecycle with truthful availability classifications', async () => {
    const updated = { ...project, status: 'OnHold' as const };
    const fetchMock = vi.fn().mockResolvedValue(reply(updated));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    client.setQueryData(['v4', 'summary', 'project', project.id], project);
    render(
      <QueryClientProvider client={client}>
        <V4ProjectStatusControl project={project} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Client Review/i }));
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(7);
    expect(items.map((item) => item.textContent)).toEqual([
      'In ProgressNot available from current state',
      'On HoldDirectly available',
      'Client ReviewCurrent',
      'Revision RequiredSpecialized available — reason required',
      'Ready to IssueNot available from current state',
      'IssuedNot available from current state',
      'CompletedDirectly available',
    ]);
    const current = screen.getByRole('menuitem', { name: /Client Review.*Current/i });
    const specialized = screen.getByRole('menuitem', {
      name: /Revision Required.*Specialized available.*reason required/i,
    });
    expect(current).toBeDisabled();
    expect(current).toHaveAttribute('aria-disabled', 'true');
    expect(specialized).toBeEnabled();
    fireEvent.click(current);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: /On Hold.*Available/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ status: 'OnHold', expectedCurrentStatus: 'ClientReview' });
    expect(body.transitionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(client.getQueryData<Project>(['v4', 'summary', 'project', project.id])?.status).toBe(
      'OnHold',
    );
  });

  it('requires a reason and sends the exact specialized transition payload', async () => {
    const updated = { ...project, status: 'RevisionRequired' as const };
    const fetchMock = vi.fn().mockResolvedValue(reply(updated));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    client.setQueryData(['v4', 'summary', 'project', project.id], project);
    render(
      <QueryClientProvider client={client}>
        <V4ProjectStatusControl project={project} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Client Review/i }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Revision Required.*Specialized available/i }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Revision Required' });
    expect(dialog).toHaveTextContent('Keep Current Status');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Revision Required' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Reason is required.');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: '  Revise the client-requested wall-wash aiming.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Revision Required' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({
      status: 'RevisionRequired',
      reason: 'Revise the client-requested wall-wash aiming.',
      expectedCurrentStatus: 'ClientReview',
    });
    expect(body.transitionId).toMatch(/^[0-9a-f-]{36}$/i);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Revision Required' })).not.toBeInTheDocument(),
    );
  });

  it('keeps the specialized dialog pending and rolls optimistic state back on rejection', async () => {
    let resolveRequest!: (value: ReturnType<typeof reply>) => void;
    const fetchMock = vi.fn(
      () => new Promise<ReturnType<typeof reply>>((resolve) => (resolveRequest = resolve)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['v4', 'summary', 'project', project.id], project);
    render(
      <QueryClientProvider client={client}>
        <V4ProjectStatusControl project={project} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Client Review/i }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Revision Required.*Specialized available/i }),
    );
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Client feedback.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Revision Required' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog', { name: 'Revision Required' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Revision Required' })).toBeDisabled();
    expect(client.getQueryData<Project>(['v4', 'summary', 'project', project.id])?.status).toBe(
      'RevisionRequired',
    );

    resolveRequest(reply(null, false));
    expect(await screen.findByRole('alert')).toHaveTextContent('Stale status');
    expect(client.getQueryData<Project>(['v4', 'summary', 'project', project.id])?.status).toBe(
      'ClientReview',
    );
    expect(screen.getByRole('dialog', { name: 'Revision Required' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Revision Required' })).toBeEnabled();
  });

  it('rolls optimistic state back on a stale-state rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(null, false)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['v4', 'summary', 'project', project.id], project);
    render(
      <QueryClientProvider client={client}>
        <V4ProjectStatusControl project={project} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Client Review/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /On Hold.*Available/i }));
    await screen.findByRole('alert');
    expect(client.getQueryData<Project>(['v4', 'summary', 'project', project.id])?.status).toBe(
      'ClientReview',
    );
  });

  it('prevents duplicate pending transitions', async () => {
    let resolveRequest!: (value: ReturnType<typeof reply>) => void;
    const fetchMock = vi.fn(
      () => new Promise<ReturnType<typeof reply>>((resolve) => (resolveRequest = resolve)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <V4ProjectStatusControl project={project} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Client Review/i }));
    const available = screen.getByRole('menuitem', { name: /Completed.*Available/i });
    fireEvent.click(available);
    fireEvent.click(available);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Client Review/i })).toBeDisabled(),
    );
    resolveRequest(reply({ ...project, status: 'Completed' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Client Review/i })).not.toBeDisabled(),
    );
  });

  it('keeps anchored Escape, outside-click, and focus-return behavior', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <V4ProjectStatusControl project={project} />
      </QueryClientProvider>,
    );
    const trigger = screen.getByRole('button', { name: /Client Review/i });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Change Project status' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: 'Change Project status' })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: 'Change Project status' })).not.toBeInTheDocument(),
    );
  });
});
