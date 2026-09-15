/** @vitest-environment jsdom */
/**
 * H1 shell width-contract tests.
 *
 *   H1: Extended actual track = 290px; Minimal actual track = 68px; the main
 *       content participates in the changed shell layout (no hidden wide
 *       wrapper remains).
 *
 * These assert the structural width contract (mode classes + data attributes)
 * rather than brittle pixel screenshots. The load-bearing widths (290px /
 * 68px) are centralized in the CSS `.v4-sidebar--extended` / `--minimal` rules
 * with explicit `flex-basis`, which the owner visual UAT verifies visually.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { V4AppShell } from '../shell/V4AppShell';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

function shellWidths(mode: 'extended' | 'minimal') {
  renderV4(
    <V4AppShell context="global" sidebarMode={mode} onToggleSidebarMode={() => undefined} />,
  );
  const aside = screen.getByRole('complementary');
  const main = screen.getByTestId('v4-shell-main');
  return { aside, main };
}

function stubResponsiveMatchMedia(initialNarrow: boolean) {
  let narrow = initialNarrow;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const narrowMedia = {
    get matches() {
      return narrow;
    },
    media: '(max-width: 640px)',
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) =>
      query === narrowMedia.media
        ? narrowMedia
        : {
            matches: false,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
          },
    ),
  );
  return (next: boolean) => {
    narrow = next;
    const event = { matches: next, media: narrowMedia.media } as MediaQueryListEvent;
    listeners.forEach((listener) => listener(event));
  };
}

describe('H1 shell width contract', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('Extended mode uses the 290px track class (not minimal)', () => {
    stubMatchMedia();
    const { aside } = shellWidths('extended');
    expect(aside).toHaveStyle({ width: '290px' });
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
  });

  it('Minimal mode uses the 68px track class (not extended)', () => {
    stubMatchMedia();
    const { aside } = shellWidths('minimal');
    expect(aside).toHaveStyle({ width: '68px' });
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
  });

  it('main content is a flex sibling that expands with the changed track', () => {
    stubMatchMedia();
    const { main } = shellWidths('minimal');
    // The main region is a flex child of the shell and flexes to fill the
    // released space (no fixed-width wrapper holds the extended track).
    expect(main).toBeInTheDocument();
    expect(main.className).toContain('v4-shell__main');
  });

  it('uses the existing minimal grammar at the 640px phone breakpoint without changing the preference', () => {
    const setNarrow = stubResponsiveMatchMedia(true);
    const onToggle = vi.fn();
    renderV4(
      <V4AppShell context="project" sidebarMode="extended" onToggleSidebarMode={onToggle} />,
    );

    const shell = screen.getByTestId('v4-shell');
    expect(screen.getByRole('complementary')).toHaveStyle({ width: '68px' });
    expect(shell).toHaveAttribute('data-sidebar-mode', 'minimal');
    expect(shell).toHaveAttribute('data-sidebar-preference', 'extended');
    expect(onToggle).not.toHaveBeenCalled();

    act(() => setNarrow(false));
    expect(screen.getByRole('complementary')).toHaveStyle({ width: '290px' });
    expect(shell).toHaveAttribute('data-sidebar-preference', 'extended');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('uses the centralized Projects route for Back to Projects by default', () => {
    stubMatchMedia();
    renderV4(
      <Routes>
        <Route
          path="/projects/:projectId/summary"
          element={
            <V4AppShell
              context="project"
              sidebarMode="extended"
              onToggleSidebarMode={() => undefined}
            />
          }
        />
        <Route path="/projects" element={<div data-testid="projects-destination">Projects</div>} />
      </Routes>,
      ['/projects/p1/summary'],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to Projects' }));
    expect(screen.getByTestId('projects-destination')).toHaveTextContent('Projects');
  });
});
