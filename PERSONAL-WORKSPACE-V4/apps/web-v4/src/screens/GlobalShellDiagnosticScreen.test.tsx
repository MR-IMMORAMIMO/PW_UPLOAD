/** @vitest-environment jsdom */
/**
 * Global shell diagnostic route test.
 *
 *   A. Global shell renders.
 *   C. Extended is the default mode.
 *   E. Extended <-> Minimal toggle works via the diagnostic control.
 *   O. Light/Dark theme classes/tokens remain usable.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { GlobalShellDiagnosticScreen } from './GlobalShellDiagnosticScreen';
import { cleanupV4, renderV4, stubMatchMedia } from '../test-utils/renderV4';

describe('GlobalShellDiagnosticScreen', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('renders the GLOBAL shell with a PageHeader (A, C)', () => {
    stubMatchMedia();
    renderV4(<GlobalShellDiagnosticScreen />, ['/diagnostic/shell']);
    expect(screen.getByTestId('v4-shell')).toBeInTheDocument();
    expect(screen.getByTestId('v4-shell')).toHaveAttribute('data-context', 'global');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Shell Foundation');
    expect(screen.getByRole('navigation', { name: 'Global navigation' })).toBeInTheDocument();
    expect(screen.getByTestId('v4-diag-sidebar-mode')).toHaveTextContent('extended');
  });

  it('toggles the sidebar mode through the diagnostic control (E)', async () => {
    stubMatchMedia();
    renderV4(<GlobalShellDiagnosticScreen />, ['/diagnostic/shell']);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar to minimal' }));
    await waitFor(() =>
      expect(screen.getByTestId('v4-diag-sidebar-mode')).toHaveTextContent('minimal'),
    );
    expect(window.localStorage.getItem('scli.v4.sidebar.mode')).toBe('minimal');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar to extended' }));
    await waitFor(() =>
      expect(screen.getByTestId('v4-diag-sidebar-mode')).toHaveTextContent('extended'),
    );
  });

  it('keeps theme tokens usable (O)', () => {
    stubMatchMedia({ dark: true });
    renderV4(<GlobalShellDiagnosticScreen />, ['/diagnostic/shell']);
    expect(document.documentElement.dataset.theme).toBe('dark');
    // Theme resolves from the V4 theme provider; the shell relies on tokens.
    expect(document.documentElement.classList.contains('v4-reduced-motion')).toBe(false);
  });
});
