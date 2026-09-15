/** @vitest-environment jsdom */
/**
 * V4 shell-contract regression tests (H1-D2, owner-approved narrow policy).
 *
 * Automated tests protect load-bearing behavior/contracts only. Visual/layout/
 * motion quality is gated by owner visual UAT. These four protections are:
 *
 *   1. Sidebar three-zone structure: TOP fixed, NAVIGATION is the only
 *      scrollable sidebar region, BOTTOM fixed; Work Session / Profile / mode
 *      control remain outside the navigation scroll region.
 *   2. Project navigation group behavior: active section's owning group
 *      auto-opens; group expansion is session-local React state; group
 *      interaction does NOT write localStorage/sessionStorage; multiple groups
 *      may remain open.
 *   3. Project Context Header sticky contract: sticky structural class/state
 *      exists; scrolled-state hook/contract can be triggered reliably.
 *   4. Minimal-mode accessibility: icon-only controls retain accessible
 *      aria-labels (at least one nav item + the sidebar expand/back control).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LegacyAppShell as V4AppShell } from './LegacyAppShell';
import { V4ProjectContextHeader } from '../project/V4ProjectContextHeader';
import { useV4StickyScrolled } from '../project/useV4StickyScrolled';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const PROJECT = {
  projectCode: 'SCT-1042',
  projectName: 'Riverside HQ Lighting',
  status: 'InProgress',
};

describe('V4 shell contract (H1-D2)', () => {
  afterEach(() => {
    cleanupV4();
  });

  // ---- 1. Three-zone sidebar structure ----

  it('sidebar has TOP / NAVIGATION / BOTTOM structural zones', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        project={PROJECT}
      />,
    );
    const aside = screen.getByRole('complementary');
    expect(aside.querySelector('.v4-sidebar__top')).toBeInTheDocument();
    expect(aside.querySelector('.v4-sidebar__nav')).toBeInTheDocument();
    expect(aside.querySelector('.v4-sidebar__footer')).toBeInTheDocument();
  });

  it('navigation is the only scrollable sidebar region (top/bottom are not)', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        project={PROJECT}
      />,
    );
    const aside = screen.getByRole('complementary');
    const nav = aside.querySelector('.v4-sidebar__nav');
    const top = aside.querySelector('.v4-sidebar__top');
    const footer = aside.querySelector('.v4-sidebar__footer');
    // The nav region owns the scroll contract.
    expect(nav).toBeTruthy();
    expect(nav?.className).toContain('v4-sidebar__nav');
    // Top and bottom zones do NOT use the navigation scroll-region class.
    expect(top?.className).not.toContain('v4-sidebar__nav');
    expect(footer?.className).not.toContain('v4-sidebar__nav');
  });

  it('Work Session / Profile / Settings live in the fixed bottom zone, outside nav', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        project={PROJECT}
      />,
    );
    const aside = screen.getByRole('complementary');
    const nav = aside.querySelector('.v4-sidebar__nav');
    const footer = aside.querySelector('.v4-sidebar__footer');
    expect(footer).toBeTruthy();
    // Each bottom control is inside the footer, not inside the nav region.
    for (const testId of ['v4-work-session-zone', 'v4-profile-zone']) {
      const zone = aside.querySelector(`[data-testid="${testId}"]`);
      expect(zone).toBeTruthy();
      expect(nav?.contains(zone)).toBe(false);
      expect(footer?.contains(zone)).toBe(true);
    }
    // H2: Settings is a bottom-utility item inside the footer, outside nav.
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(nav?.contains(settings)).toBe(false);
    expect(footer?.contains(settings)).toBe(true);
  });

  it('H2: floating edge toggle is outside nav and footer (attached to rail edge)', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        project={PROJECT}
      />,
    );
    const aside = screen.getByRole('complementary');
    const nav = aside.querySelector('.v4-sidebar__nav');
    const footer = aside.querySelector('.v4-sidebar__footer');
    const toggle = document.querySelector('.v4-sidebar-edge-toggle');
    expect(toggle).toBeTruthy();
    // The edge toggle is NOT a bottom utility item and NOT inside nav.
    expect(nav?.contains(toggle)).toBe(false);
    expect(footer?.contains(toggle)).toBe(false);
  });

  // ---- 2. Project navigation group behavior ----

  it('active section owning group auto-opens; multiple groups may remain open', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    // Coordination (contains Actions) auto-opens.
    expect(document.querySelector('[data-group-id="coordination"]')).toHaveAttribute(
      'data-open',
      'true',
    );
    // Open Overview too — both remain open (non-exclusive).
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(document.querySelector('[data-group-id="overview"]')).toHaveAttribute(
      'data-open',
      'true',
    );
    expect(document.querySelector('[data-group-id="coordination"]')).toHaveAttribute(
      'data-open',
      'true',
    );
  });

  it('group expansion is session-local and does NOT write localStorage/sessionStorage', () => {
    stubMatchMedia();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    // Toggle a group open/closed — this must not persist anything.
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    // No storage write should have occurred from group interaction.
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  // ---- 3. Project Context Header sticky contract ----

  it('Project Context Header exposes the sticky structural class/state', () => {
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
    const header = screen.getByTestId('v4-project-context-header');
    expect(header.className).toContain('v4-pch');
    // The sticky structural contract is expressed via the v4-pch class (CSS
    // position: sticky) plus a data-scrolled state attribute.
    expect(header).toHaveAttribute('data-scrolled');
  });

  it('sticky scrolled-state hook flips when the header rises above the threshold', () => {
    stubMatchMedia();
    function Probe() {
      const { ref, scrolled } = useV4StickyScrolled();
      return (
        <div>
          <span ref={ref} data-testid="probe-header" />
          <span data-testid="probe-scrolled">{String(scrolled)}</span>
        </div>
      );
    }
    render(<Probe />);
    const header = screen.getByTestId('probe-header');
    // Simulate the header having scrolled up (top < threshold).
    header.getBoundingClientRect = () =>
      ({
        top: -10,
        bottom: 30,
        left: 0,
        right: 0,
        width: 0,
        height: 40,
        x: 0,
        y: -10,
        toJSON: () => ({}),
      }) as DOMRect;
    fireEvent.scroll(window);
    expect(screen.getByTestId('probe-scrolled')).toHaveTextContent('true');
  });

  // ---- 4. Minimal-mode accessibility ----

  it('minimal mode icon-only controls retain accessible aria-labels', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    // H2: Minimal Project is a group-level icon rail; each group keeps its
    // accessible label.
    expect(screen.getByRole('button', { name: 'Coordination' })).toBeInTheDocument();
    // Back to Projects control keeps its accessible label.
    expect(screen.getByRole('button', { name: 'Back to Projects' })).toBeInTheDocument();
    // The floating edge toggle keeps its accessible label.
    expect(screen.getByRole('button', { name: 'Expand sidebar to extended' })).toBeInTheDocument();
  });
});
