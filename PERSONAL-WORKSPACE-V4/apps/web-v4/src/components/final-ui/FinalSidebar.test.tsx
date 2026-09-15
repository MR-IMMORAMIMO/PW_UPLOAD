/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useState } from 'react';
import { FinalSidebar } from './FinalSidebar';
import { stubMatchMedia } from '../../test-utils/renderV4';
const id = '11111111-1111-4111-8111-111111111111';
vi.mock('../../api/environment', () => ({
  api: {
    me: async () => ({ displayName: 'Owner', email: 'owner@example.test' }),
    project: async (projectId: string) => ({
      id: projectId,
      projectCode: 'UAT-01',
      projectName: 'UAT Contacts',
      status: 'InProgress',
    }),
  },
}));
function Harness() {
  const [minimal, setMinimal] = useState(false);
  return (
    <FinalSidebar
      mode={minimal ? 'minimal' : 'extended'}
      onToggleMode={() => setMinimal((v) => !v)}
    />
  );
}
beforeEach(() => stubMatchMedia());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('final contextual shell', () => {
  it('replaces the primary sidebar from canonical routes and navigates back', async () => {
    const router = createMemoryRouter([{ path: '*', element: <Harness /> }], {
      initialEntries: ['/projects'],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(screen.getByRole('complementary', { name: 'Global workspace sidebar' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await act(() => router.navigate(`/projects/${id}/contacts`));
    expect(
      screen.queryByRole('complementary', { name: 'Global workspace sidebar' }),
    ).not.toBeInTheDocument();
    const sidebar = screen.getByRole('complementary', { name: 'Project workspace sidebar' });
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(within(sidebar).getByRole('button', { name: 'Contacts' })).toBeVisible();
    expect(within(sidebar).getByRole('button', { name: 'Contacts' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(screen.getByTitle('Collapse sidebar'));
    expect(document.querySelector('[data-final-shell]')).toHaveAttribute(
      'data-sidebar-mode',
      'minimal',
    );
    fireEvent.click(screen.getByTitle('Expand sidebar'));
    fireEvent.click(screen.getByRole('button', { name: /Back to Projects/i }));
    expect(router.state.location.pathname).toBe('/projects');
    expect(screen.getByRole('complementary', { name: 'Global workspace sidebar' })).toBeVisible();
  });
});
