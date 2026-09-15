import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppUser, IntegrationStatus } from '@scli/domain';
import { api, setApiMode, setMockUserId, setStandaloneToken } from './api';
import { LoginScreen } from './components/login-screen';
import { createAccessibleAccentPalette } from './theme-colors';
import { resolveInitialTheme, THEME_STORAGE_KEY, type ThemePreference } from './theme';

interface AppContextValue {
  currentUser: AppUser;
  mockUsers: AppUser[];
  integrationStatus: IntegrationStatus;
  switchMockUser: (userId: string) => void;
  logout: () => void;
  themePreference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setThemePreference: (theme: ThemePreference) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState(
    () => localStorage.getItem('scli.mockUserId') ?? '66666666-6666-4666-8666-666666666666',
  );
  const [hasStandaloneSession, setHasStandaloneSession] = useState(() =>
    Boolean(sessionStorage.getItem('scli.sessionToken')),
  );
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() =>
    resolveInitialTheme(),
  );
  setMockUserId(selectedUserId);

  const integrationQuery = useQuery({
    queryKey: ['integration-status'],
    queryFn: api.integrationStatus,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const mode = integrationQuery.data?.mode ?? 'mock';
  const personalSettingsQuery = useQuery({
    queryKey: ['personal-settings', 'appearance'],
    queryFn: api.personalSettings,
    enabled: integrationQuery.data?.workspaceVariant === 'personal',
  });
  const personalAutoLogin = Boolean(
    integrationQuery.data?.workspaceVariant === 'personal' &&
    integrationQuery.data.personalAutoLogin,
  );
  setApiMode(mode);

  const resolvedTheme = themePreference;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? '#071316' : '#f4f8f8');
  }, [resolvedTheme]);

  useEffect(() => {
    const accent = personalSettingsQuery.data?.accentColor;
    if (!accent) return;
    const palette = createAccessibleAccentPalette(accent, resolvedTheme);
    document.documentElement.style.setProperty('--accent-base', palette.base);
    document.documentElement.style.setProperty('--accent', palette.foreground);
    document.documentElement.style.setProperty('--accent-strong', palette.strong);
    document.documentElement.style.setProperty('--accent-soft', palette.soft);
  }, [personalSettingsQuery.data?.accentColor, resolvedTheme]);

  useEffect(() => {
    const expired = () => setHasStandaloneSession(false);
    window.addEventListener('scli:session-expired', expired);
    return () => window.removeEventListener('scli:session-expired', expired);
  }, []);

  const usersQuery = useQuery({
    queryKey: ['dev-users'],
    queryFn: api.devUsers,
    enabled: integrationQuery.isSuccess && mode === 'mock',
    staleTime: Number.POSITIVE_INFINITY,
  });
  const meQuery = useQuery({
    queryKey: ['me', selectedUserId, mode],
    queryFn: api.me,
    enabled:
      integrationQuery.isSuccess &&
      (mode !== 'standalone' || hasStandaloneSession || personalAutoLogin),
    retry: false,
  });

  useEffect(() => {
    if (mode !== 'mock' || !usersQuery.data?.length) return;
    if (!usersQuery.data.some((user) => user.id === selectedUserId)) {
      const fallback = usersQuery.data[0];
      if (fallback) {
        setSelectedUserId(fallback.id);
        setMockUserId(fallback.id);
      }
    }
  }, [mode, selectedUserId, usersQuery.data]);

  const switchMockUser = useCallback(
    (userId: string) => {
      setSelectedUserId(userId);
      setMockUserId(userId);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'integration-status',
      });
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    setStandaloneToken(null);
    setHasStandaloneSession(false);
    queryClient.clear();
  }, [queryClient]);

  const setThemePreference = useCallback((theme: ThemePreference) => {
    setThemePreferenceState(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, []);

  const value = useMemo<AppContextValue | null>(() => {
    if (!integrationQuery.data || !meQuery.data) return null;
    return {
      currentUser: meQuery.data,
      mockUsers: usersQuery.data ?? [],
      integrationStatus: integrationQuery.data,
      switchMockUser,
      logout,
      themePreference,
      resolvedTheme,
      setThemePreference,
    };
  }, [
    integrationQuery.data,
    logout,
    meQuery.data,
    resolvedTheme,
    setThemePreference,
    switchMockUser,
    themePreference,
    usersQuery.data,
  ]);

  if (
    integrationQuery.isLoading ||
    (mode !== 'standalone' && meQuery.isLoading) ||
    (mode === 'standalone' && (hasStandaloneSession || personalAutoLogin) && meQuery.isLoading) ||
    (mode === 'mock' && usersQuery.isLoading)
  ) {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <div className="boot-mark">S</div>
        <div className="boot-copy">
          <strong>SCT Workspace</strong>
          <span>Preparing your workspace…</span>
        </div>
      </div>
    );
  }

  if (integrationQuery.data?.mode === 'standalone' && !hasStandaloneSession && !personalAutoLogin) {
    return (
      <LoginScreen
        onLogin={async (email, password) => {
          const session = await api.login({ email, password });
          setStandaloneToken(session.token);
          setHasStandaloneSession(true);
          await queryClient.invalidateQueries({ queryKey: ['me'] });
        }}
      />
    );
  }

  const error =
    integrationQuery.error ?? (mode === 'mock' ? usersQuery.error : null) ?? meQuery.error;
  if (error || !value) {
    return (
      <main className="fatal-state">
        <div className="boot-mark">!</div>
        <h1>We couldn’t open the project tracker</h1>
        <p>{error instanceof Error ? error.message : 'Check that the local API is running.'}</p>
        <button className="button primary" type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useAppContext must be used inside AppProvider.');
  return value;
}
