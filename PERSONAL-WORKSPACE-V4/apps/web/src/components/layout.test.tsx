/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './layout';

const { useAppContextMock } = vi.hoisted(() => ({
  useAppContextMock: vi.fn(),
}));

vi.mock('../app-context', () => ({ useAppContext: useAppContextMock }));
vi.mock('../api', () => ({
  api: {
    notifications: vi.fn().mockResolvedValue([]),
    personalOperations: vi.fn().mockResolvedValue({
      blockingRequirements: [],
      overdueActions: [],
      openReviews: [],
    }),
    markNotificationRead: vi.fn(),
    project: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('./personal-work-session-timer', () => ({
  PersonalWorkSessionTimer: () => <div data-testid="personal-work-session-timer" />,
  WorkSessionTopBar: () => <div data-testid="work-session-top-bar" />,
  WorkSessionMinimalControls: () => <div data-testid="work-session-minimal-controls" />,
}));

describe('Personal workspace global sidebar branding', () => {
  beforeEach(() => {
    useAppContextMock.mockReturnValue({
      currentUser: {
        id: '11111111-1111-4111-8111-111111111111',
        entraObjectId: null,
        displayName: 'Mohamed',
        email: 'mohamed@scientechnic.local',
        role: 'Admin',
        isActive: true,
      },
      mockUsers: [],
      integrationStatus: { mode: 'standalone', workspaceVariant: 'personal' },
      switchMockUser: vi.fn(),
      logout: vi.fn(),
      themePreference: 'dark',
      resolvedTheme: 'dark',
      setThemePreference: vi.fn(),
    });
    window.localStorage.removeItem('scli.sidebarMode');
  });

  it('renders the official logo above SCT Workspace while preserving navigation', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<div>Dashboard content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const logo = screen.getByRole('img', { name: 'Scientechnic' });
    const productName = screen.getByText('SCT Workspace');
    expect(logo).toHaveAttribute('src', expect.stringContaining('scientechnic-official-logo'));
    expect(
      logo.compareDocumentPosition(productName) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText('SCLI Workspace')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New Project' })).toBeInTheDocument();
    // "My Projects" is replaced by the canonical "Projects" global item.
    expect(screen.queryByRole('link', { name: 'My Projects' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
  });
});
