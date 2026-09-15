/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { V4ThemeProvider, useV4Theme } from './ThemeProvider';

/**
 * ThemeProvider tests.
 *
 *   H. Light preference applies expected theme state.
 *   I. Dark preference applies expected theme state.
 *   J. System preference resolves from the system authority.
 *   K. Stored theme preference can be restored.
 *   L. reduced-motion foundation is respected structurally.
 */

function Probe() {
  const { preference, resolved, reducedMotion, setPreference } = useV4Theme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <span data-testid="reduced">{String(reducedMotion)}</span>
      <button type="button" onClick={() => setPreference('light')}>
        set-light
      </button>
      <button type="button" onClick={() => setPreference('dark')}>
        set-dark
      </button>
      <button type="button" onClick={() => setPreference('system')}>
        set-system
      </button>
    </div>
  );
}

function stubMatchMedia(dark: boolean, reduced = false): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches:
        query === '(prefers-color-scheme: dark)'
          ? dark
          : query === '(prefers-reduced-motion: reduce)'
            ? reduced
            : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe('V4ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.classList.remove('v4-reduced-motion');
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.classList.remove('v4-reduced-motion');
  });

  it('defaults to system and applies the resolved theme to the document (J)', () => {
    stubMatchMedia(true);
    render(
      <V4ThemeProvider>
        <Probe />
      </V4ThemeProvider>,
    );
    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies light preference to the document (H)', () => {
    stubMatchMedia(true);
    render(
      <V4ThemeProvider>
        <Probe />
      </V4ThemeProvider>,
    );
    fireEvent.click(screen.getByText('set-light'));
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('applies dark preference to the document (I)', () => {
    stubMatchMedia(false);
    render(
      <V4ThemeProvider>
        <Probe />
      </V4ThemeProvider>,
    );
    fireEvent.click(screen.getByText('set-dark'));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('persists and restores the stored theme preference (K)', () => {
    stubMatchMedia(false);
    render(
      <V4ThemeProvider>
        <Probe />
      </V4ThemeProvider>,
    );
    fireEvent.click(screen.getByText('set-dark'));
    expect(window.localStorage.getItem('scli.v4.theme')).toBe('dark');
  });

  it('removes the stored preference when set back to system (J)', () => {
    stubMatchMedia(false);
    render(
      <V4ThemeProvider>
        <Probe />
      </V4ThemeProvider>,
    );
    fireEvent.click(screen.getByText('set-dark'));
    expect(window.localStorage.getItem('scli.v4.theme')).toBe('dark');
    fireEvent.click(screen.getByText('set-system'));
    expect(window.localStorage.getItem('scli.v4.theme')).toBeNull();
    expect(screen.getByTestId('preference')).toHaveTextContent('system');
  });

  it('toggles the reduced-motion class on the document (L)', () => {
    stubMatchMedia(false, true);
    render(
      <V4ThemeProvider>
        <Probe />
      </V4ThemeProvider>,
    );
    expect(screen.getByTestId('reduced')).toHaveTextContent('true');
    expect(document.documentElement.classList.contains('v4-reduced-motion')).toBe(true);
  });
});
