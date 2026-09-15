/**
 * V4 React theme provider.
 *
 * Wraps the shared NON-VISUAL theme mechanics from `@scli/theme` in a small
 * React context. It owns:
 *   - the stored preference (light | dark | system)
 *   - the resolved light/dark value applied to `document.documentElement.dataset.theme`
 *   - reduced-motion awareness (structural only; no lighting-motion effect yet)
 *
 * It contains NO visual styles. The V4 stylesheet reads `data-theme` and the
 * reduced-motion class to drive its token surface.
 */
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  isThemePreference,
  prefersReducedMotion,
  readStoredThemePreference,
  resolveTheme,
  subscribeReducedMotion,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from '@scli/theme';

export interface V4ThemeContextValue {
  /** The user's stored preference (light | dark | system). */
  preference: ThemePreference;
  /** The concrete light/dark value currently applied. */
  resolved: ResolvedTheme;
  /** Whether the user has requested reduced motion. */
  reducedMotion: boolean;
  /** Persist a new preference and apply it. */
  setPreference: (preference: ThemePreference) => void;
}

const V4ThemeContext = createContext<V4ThemeContextValue | null>(null);

function applyResolvedTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

function applyReducedMotion(reduced: boolean): void {
  document.documentElement.classList.toggle('v4-reduced-motion', reduced);
}

export function V4ThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    const stored = readStoredThemePreference();
    return stored ?? 'system';
  });
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => prefersReducedMotion());
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  // The resolved light/dark value is derived from the preference so it stays in
  // sync when the preference changes (stored -> system -> light -> dark).
  const resolved = useMemo<ResolvedTheme>(
    () => (preference === 'system' ? (systemDark ? 'dark' : 'light') : resolveTheme(preference)),
    [preference, systemDark],
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // Apply the resolved theme to the document on mount and whenever it changes.
  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  // Structural reduced-motion awareness. No lighting-motion effect is
  // implemented in F1B; this only keeps the class in sync for future effects.
  useEffect(() => {
    applyReducedMotion(reducedMotion);
    return subscribeReducedMotion(setReducedMotion);
  }, [reducedMotion]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable — the in-memory preference still applies.
    }
  }, []);

  const value = useMemo<V4ThemeContextValue>(
    () => ({ preference, resolved, reducedMotion, setPreference }),
    [preference, resolved, reducedMotion, setPreference],
  );

  return <V4ThemeContext.Provider value={value}>{children}</V4ThemeContext.Provider>;
}

export function useV4Theme(): V4ThemeContextValue {
  const context = useContext(V4ThemeContext);
  if (!context) {
    throw new Error('useV4Theme must be used within a V4ThemeProvider.');
  }
  return context;
}

export { isThemePreference };
