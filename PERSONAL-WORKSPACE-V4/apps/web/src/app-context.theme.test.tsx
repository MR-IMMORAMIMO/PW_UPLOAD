/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useAppContext } from './app-context';
import { THEME_STORAGE_KEY } from './theme';

/**
 * AppContext theme integration tests (see P2-UX-01-H1 requirements 7-9):
 * explicit Theme selection persists to `scli.theme`, and a restart/remount
 * restores the saved preference.
 *
 * We render the REAL AppProvider (not a mock) so the actual initializer,
 * persistence write, and dataset.theme application are exercised. The api
 * module is mocked so queries resolve deterministically.
 */

const { mockUser } = vi.hoisted(() => ({
  mockUser: {
    id: '11111111-1111-4111-8111-111111111111',
    entraObjectId: 'entra-user',
    displayName: 'Mohamed',
    email: 'mohamed@scientechnic.local',
    jobTitle: 'Design Manager',
    department: 'Design Studio',
    role: 'Admin',
    weeklyCapacityHours: 0,
    availabilityStatus: 'Available',
    avatarUrl: null,
    isActive: true,
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-01T08:00:00.000Z',
  },
}));

vi.mock('./api', () => ({
  api: {
    integrationStatus: vi.fn().mockResolvedValue({
      mode: 'mock',
      workspaceVariant: 'team',
      personalAutoLogin: false,
      configured: true,
      teamsSsoConfigured: false,
      sharePointConfigured: false,
      proactiveNotificationsConfigured: false,
      missing: [],
    }),
    devUsers: vi.fn().mockResolvedValue([mockUser]),
    me: vi.fn().mockResolvedValue(mockUser),
    personalSettings: vi.fn().mockResolvedValue({
      projectRoot: '/tmp',
      defaultFolderProfile: 'factory',
      defaultInputMode: 'catalogue',
      autoOpenProjectFolder: false,
      designerName: 'Mohamed',
      companyName: 'Scientechnic',
      companyLogoPath: '',
      accentColor: '#008C95',
      timeZone: 'UTC',
      backupRetention: 30,
      updatedAt: '2026-08-01T08:00:00.000Z',
    }),
  },
  setApiMode: vi.fn(),
  setMockUserId: vi.fn(),
  setStandaloneToken: vi.fn(),
}));

function Harness({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>{children}</AppProvider>
    </QueryClientProvider>
  );
}

function ThemeProbe() {
  const { themePreference, setThemePreference } = useAppContext();
  return (
    <div>
      <span data-testid="resolved-theme">{themePreference}</span>
      <button type="button" onClick={() => setThemePreference('dark')}>
        Set Dark
      </button>
      <button type="button" onClick={() => setThemePreference('light')}>
        Set Light
      </button>
    </div>
  );
}

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  queryClient.clear();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.clearAllMocks();
});

describe('AppContext theme persistence', () => {
  it('explicit Dark selection persists to scli.theme', async () => {
    render(
      <Harness>
        <ThemeProbe />
      </Harness>,
    );
    // Wait until the app settles into a stable rendered children state
    // (rides through the transient dev-user selection remount), then click.
    await waitFor(() => expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light'));
    const setDark = await screen.findByRole('button', { name: 'Set Dark' });
    fireEvent.click(setDark);
    await waitFor(() => expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark'));
    await waitFor(() => expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('remount after explicit Dark restores Dark', async () => {
    // Simulate a prior session that saved Dark.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { unmount } = render(
      <Harness>
        <ThemeProbe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');

    unmount();
    // New QueryClient + remount = "restart".
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <Harness>
        <ThemeProbe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark'));
  });

  it('remount after explicit Light restores Light', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { unmount } = render(
      <Harness>
        <ThemeProbe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light'));
    expect(document.documentElement.dataset.theme).toBe('light');

    unmount();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <Harness>
        <ThemeProbe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light'));
  });

  it('saved Dark survives a full remount even when the OS prefers Light', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { unmount } = render(
      <Harness>
        <ThemeProbe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark'));
    unmount();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <Harness>
        <ThemeProbe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('resolved-theme')).toHaveTextContent('dark'));
    vi.unstubAllGlobals();
  });

  it('saved Light survives a full remount even when the OS prefers Dark', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { unmount } = render(
      <Harness>
        <ThemeProbe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light'));
    unmount();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <Harness>
        <ThemeProbe />
      </Harness>,
    );
    await waitFor(() => expect(screen.getByTestId('resolved-theme')).toHaveTextContent('light'));
    vi.unstubAllGlobals();
  });
});
