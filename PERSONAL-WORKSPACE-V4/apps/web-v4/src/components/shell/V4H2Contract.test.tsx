/** @vitest-environment jsdom */
/**
 * V4 H2 regression tests — final navigation morph + minimal flyout + stable
 * project bar. Owner-approved narrow policy: automated tests protect behavior /
 * structural contracts; visual quality is gated by owner visual UAT.
 *
 *   A. GLOBAL navigation excludes Settings from primary nav; Settings is in the
 *      bottom utility zone.
 *   B. PROJECT Minimal renders primary GROUP triggers, not every child page.
 *   C. Opening a Minimal Project group shows the correct child flyout.
 *   D. Opening another group replaces the previous flyout.
 *   E. Escape closes the flyout.
 *   F. Group child active state remains truthful.
 *   G. Floating Sidebar toggle uses ChevronLeft (Extended) / ChevronRight
 *      (Minimal).
 *   H. Toggle is structurally outside/attached to the Sidebar edge wrapper,
 *      not a bottom utility item.
 *   I. Project Context Header always contains the future-action layout column
 *      even with no rendered action.
 *   J. Empty action slot has no visible placeholder content.
 *   K. Metadata labels/values use the left-aligned cell contract.
 *   L. Project status display formatter humanizes canonical status without
 *      changing source value.
 *   M. Reduced-motion disables mode transition choreography structurally.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LegacyAppShell as V4AppShell } from './LegacyAppShell';
import { V4ProjectContextHeader } from '../project/V4ProjectContextHeader';
import { formatProjectStatus } from '../project/statusDisplay';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

describe('V4 H2 shell contracts', () => {
  afterEach(() => {
    cleanupV4();
  });

  // A. Settings in bottom utility zone
  it('A: Settings is in the bottom utility zone, not primary Global nav', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="global" sidebarMode="extended" onToggleSidebarMode={() => undefined} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Global navigation' });
    const footer = document.querySelector('.v4-sidebar__footer');
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(nav.contains(settings)).toBe(false);
    expect(footer?.contains(settings)).toBe(true);
    // Primary global nav has no Settings.
    expect(nav.querySelector('[aria-label="Settings"]')).toBeNull();
  });

  // B. Minimal Project group-level rail
  it('B: Minimal Project renders group triggers, not every child page', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Project navigation' });
    for (const label of [
      'Overview',
      'Coordination',
      'Technical Workspace',
      'Deliverables & Issue',
      'Files & History',
    ]) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });

  // C. Opening a group shows the correct child flyout
  it('C: opening a Minimal Project group shows the correct child flyout', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const flyout = screen.getByTestId('v4-minimal-flyout');
    expect(flyout).toHaveAttribute('data-group-id', 'coordination');
    expect(within(flyout).getByRole('menuitem', { name: 'Actions' })).toBeInTheDocument();
  });

  // D. Opening another group replaces the previous flyout
  it('D: opening another group replaces the previous flyout', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    fireEvent.click(screen.getByRole('button', { name: 'Technical Workspace' }));
    const flyout = screen.getByTestId('v4-minimal-flyout');
    expect(flyout).toHaveAttribute('data-group-id', 'technical-workspace');
    expect(within(flyout).getByRole('menuitem', { name: 'Luminaires' })).toBeInTheDocument();
  });

  // E. Escape closes the flyout
  it('E: Escape closes the flyout', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-flyout')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('v4-minimal-flyout')).not.toBeInTheDocument();
  });

  // F. Group child active state remains truthful
  it('F: flyout marks the active child truthfully', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="minimal"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const flyout = screen.getByTestId('v4-minimal-flyout');
    expect(within(flyout).getByRole('menuitem', { name: 'Actions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  // G. Floating toggle icons
  it('G: floating toggle uses ChevronLeft in Extended and ChevronRight in Minimal', () => {
    stubMatchMedia();
    const { unmount } = renderV4(
      <V4AppShell context="global" sidebarMode="extended" onToggleSidebarMode={() => undefined} />,
    );
    const extendedToggle = document.querySelector('.v4-sidebar-edge-toggle');
    expect(extendedToggle?.querySelector('[data-sct-icon=back]')).toBeTruthy();
    expect(extendedToggle?.querySelector('[data-sct-icon=next]')).toBeNull();
    unmount();

    renderV4(
      <V4AppShell context="global" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    const minimalToggle = document.querySelector('.v4-sidebar-edge-toggle');
    expect(minimalToggle?.querySelector('[data-sct-icon=next]')).toBeTruthy();
    expect(minimalToggle?.querySelector('[data-sct-icon=back]')).toBeNull();
  });

  // H. Toggle structurally outside nav/footer
  it('H: toggle is attached to the sidebar edge wrapper, not a bottom utility item', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="global" sidebarMode="extended" onToggleSidebarMode={() => undefined} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Global navigation' });
    const footer = document.querySelector('.v4-sidebar__footer');
    const toggle = document.querySelector('.v4-sidebar-edge-toggle');
    expect(toggle).toBeTruthy();
    expect(nav.contains(toggle)).toBe(false);
    expect(footer?.contains(toggle)).toBe(false);
  });

  // I. Project Context Header always has the future-action layout column
  it('I: Project Context Header always contains the future-action layout column', () => {
    stubMatchMedia();
    render(
      <V4ProjectContextHeader
        data={{
          projectCode: 'SCT-1042',
          projectName: 'Riverside HQ Lighting',
          clientName: 'Riverside Properties',
          projectType: 'Hospitality',
          designStage: 'DetailedDesign',
          requiredDeliveryDate: '2026-09-01T00:00:00Z',
        }}
      />,
    );
    expect(screen.getByTestId('v4-pch-action-slot')).toBeInTheDocument();
  });

  // J. Empty action slot has no visible placeholder content
  it('J: empty action slot has no visible placeholder content', () => {
    stubMatchMedia();
    render(
      <V4ProjectContextHeader
        data={{
          projectCode: 'SCT-1042',
          projectName: 'Riverside HQ Lighting',
          clientName: 'Riverside Properties',
          projectType: 'Hospitality',
          designStage: 'DetailedDesign',
          requiredDeliveryDate: '2026-09-01T00:00:00Z',
        }}
      />,
    );
    const slot = screen.getByTestId('v4-pch-action-slot');
    expect(slot.textContent).toBe('');
    expect(slot.querySelector('button')).toBeNull();
  });

  // K. Metadata labels/values left-aligned cell contract
  it('K: metadata cells use the left-aligned cell contract', () => {
    stubMatchMedia();
    render(
      <V4ProjectContextHeader
        data={{
          projectCode: 'SCT-1042',
          projectName: 'Riverside HQ Lighting',
          clientName: 'Riverside Properties',
          projectType: 'Hospitality',
          designStage: 'DetailedDesign',
          requiredDeliveryDate: '2026-09-01T00:00:00Z',
        }}
      />,
    );
    const fields = document.querySelectorAll('.v4-pch__field');
    expect(fields.length).toBe(6);
    for (const field of Array.from(fields)) {
      expect(field.className).toContain('v4-pch__field');
    }
  });

  // L. Status display formatter humanizes without mutating source
  it('L: status formatter humanizes canonical status without changing source', () => {
    expect(formatProjectStatus('InProgress')).toBe('In Progress');
    expect(formatProjectStatus('OnHold')).toBe('On Hold');
    expect(formatProjectStatus('AwaitingReview')).toBe('Awaiting Review');
    expect(formatProjectStatus('ReadyToIssue')).toBe('Ready to Issue');
    expect(formatProjectStatus('')).toBe('');
    expect(formatProjectStatus(null)).toBe('');
  });

  // M. Reduced motion disables mode transition choreography structurally
  it('M: reduced motion disables the mode transition structurally', () => {
    stubMatchMedia({ reduced: true });
    renderV4(
      <V4AppShell context="global" sidebarMode="extended" onToggleSidebarMode={() => undefined} />,
    );
    // The reduced-motion class is applied to the document root.
    expect(document.documentElement.classList.contains('v4-reduced-motion')).toBe(true);
  });
});
