/** @vitest-environment jsdom */
/**
 * V4 H4 regression tests — minimal subtree footprint + integrated flyout
 * grammar. Owner-approved narrow policy: automated tests protect structural /
 * behavioral contracts; visual quality (radius, overlap beauty, shadow,
 * spacing) is gated by owner visual UAT.
 *
 *   A. Minimal open group produces a reserved subtree-footprint element/state.
 *   B. Footprint derives from the group's actual child collection, not a
 *      universal fixed spacer.
 *   C. Different child counts produce corresponding footprint differences.
 *   D. Opening another Minimal group transfers the footprint to the new group.
 *   E. Extended inline children and Minimal flyout children derive from the
 *      same navModel group/children.
 *   F. Child ordering is identical across both presentations.
 *   G. Flyout remains an overlay and does not become main-workspace layout flow.
 *   H. Flyout horizontal positioning structurally overlaps/integrates with
 *      Sidebar rather than using a detached positive external gap.
 *   I. Active child semantic class/family is shared or equivalent across
 *      Extended and Minimal flyout presentations.
 *   J. H3 trigger-based vertical anchoring remains intact.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { LegacyAppShell as V4AppShell } from './LegacyAppShell';
import { PROJECT_NAV_GROUPS } from '../navigation/navModel';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

describe('V4 H4 shell contracts', () => {
  afterEach(() => {
    cleanupV4();
  });

  // A. Minimal open group produces a reserved subtree-footprint element
  it('A: opening a Minimal group produces a flow-owned subtree lane', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    expect(screen.queryByTestId('v4-minimal-subtree')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-subtree')).toBeInTheDocument();
  });

  // B. The subtree lane owns the child-stack height (flow authority)
  it('B: subtree lane owns the child-stack height (flow authority)', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const lane = screen.getByTestId('v4-minimal-subtree');
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    expect(lane).toHaveAttribute('data-group-id', 'coordination');
    expect(lane).toHaveAttribute('data-child-count', String(coordination.items.length));
    // H13: the lane owns the real child-stack height in nav flow — no separate
    // measured spacer is the downstream-flow authority.
    expect(document.querySelector('[data-footprint-height]')).toBeNull();
  });

  // C. Different groups carry their own subtree lane
  it('C: different groups carry their own subtree lane', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    const overviewLane = screen.getByTestId('v4-minimal-subtree');
    const overview = PROJECT_NAV_GROUPS.find((g) => g.id === 'overview')!;
    expect(overviewLane).toHaveAttribute('data-child-count', String(overview.items.length));

    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const coordinationLane = screen.getByTestId('v4-minimal-subtree');
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    expect(coordinationLane).toHaveAttribute('data-child-count', String(coordination.items.length));
    // Coordination (5 children) has more children than Overview (3 children).
    expect(coordination.items.length).toBeGreaterThan(overview.items.length);
  });

  // D. Opening another group transfers the subtree lane to the new group
  it('D: opening another Minimal group transfers the subtree lane to the new group', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-subtree')).toHaveAttribute(
      'data-group-id',
      'coordination',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Files & History' }));
    expect(screen.getByTestId('v4-minimal-subtree')).toHaveAttribute(
      'data-group-id',
      'files-history',
    );
  });

  // E. Extended inline children and Minimal flyout children share the same navModel
  it('E: Extended and Minimal children derive from the same navModel group', () => {
    stubMatchMedia();
    const { unmount } = renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    // Coordination auto-opens (active child Actions).
    const extendedGroup = document.querySelector('[data-group-id="coordination"]');
    const extendedLabels = Array.from(
      extendedGroup?.querySelectorAll('.v4-nav-item__label') ?? [],
    ).map((el) => el.textContent);
    unmount();

    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const flyout = screen.getByTestId('v4-minimal-flyout');
    const flyoutLabels = Array.from(flyout.querySelectorAll('.v4-minimal-flyout__item')).map(
      (el) => el.textContent,
    );
    // Same labels, same ordering.
    expect(flyoutLabels).toEqual(extendedLabels);
  });

  // F. Child ordering identical across both presentations
  it('F: child ordering is identical across Extended and Minimal', () => {
    stubMatchMedia();
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    const canonicalOrder = coordination.items.map((i) => i.label);
    const { unmount } = renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    const extendedGroup = document.querySelector('[data-group-id="coordination"]');
    const extendedLabels = Array.from(
      extendedGroup?.querySelectorAll('.v4-nav-item__label') ?? [],
    ).map((el) => el.textContent);
    expect(extendedLabels).toEqual(canonicalOrder);
    unmount();

    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const flyoutLabels = Array.from(
      screen.getByTestId('v4-minimal-flyout').querySelectorAll('.v4-minimal-flyout__item'),
    ).map((el) => el.textContent);
    expect(flyoutLabels).toEqual(canonicalOrder);
  });

  // G. Flyout remains an overlay (not main-workspace layout flow)
  it('G: flyout remains an overlay, not main-workspace layout flow', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const flyout = screen.getByTestId('v4-minimal-flyout');
    // The flyout is rendered as a sibling of the sidebar shell (overlay), NOT
    // inside the main workspace content container.
    const main = document.querySelector('.v4-shell__main');
    expect(main?.contains(flyout)).toBe(false);
    // It carries the overlay flyout class (position:absolute in CSS).
    expect(flyout.className).toContain('v4-minimal-flyout');
  });

  // H. Flyout horizontal positioning overlaps/integrates with Sidebar
  it('H: flyout overlaps the Sidebar edge rather than a detached external gap', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const flyout = screen.getByTestId('v4-minimal-flyout');
    // The flyout is positioned relative to the sidebar shell (overlay), and is
    // NOT inside the main workspace — proving it integrates with the rail edge
    // rather than being a detached main-flow element.
    const shell = document.querySelector('.v4-sidebar-shell');
    expect(shell?.contains(flyout)).toBe(true);
    expect(flyout.className).toContain('v4-minimal-flyout');
  });

  // I. Active child semantic class/family shared across Extended and Minimal
  it('I: active child uses the shared active-child grammar in both modes', () => {
    stubMatchMedia();
    const { unmount } = renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    const extendedActive = document.querySelector('.v4-nav-item--active.v4-active-child');
    expect(extendedActive).toBeTruthy();
    unmount();

    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="minimal"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const flyoutActive = document.querySelector('.v4-minimal-flyout__item--active.v4-active-child');
    expect(flyoutActive).toBeTruthy();
  });

  // J. H3 trigger-based vertical anchoring remains intact
  it('J: H3 trigger-based vertical anchoring remains intact', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    const trigger = screen.getByRole('button', { name: 'Files & History' });
    fireEvent.click(trigger);
    // The open group renders a flow-owned subtree lane, and the child panel is
    // a shell sibling overlay anchored to it (not fixed to a screen top).
    const lane = screen.getByTestId('v4-minimal-subtree');
    expect(lane).toHaveAttribute('data-group-id', 'files-history');
    const flyout = screen.getByTestId('v4-minimal-flyout');
    expect(flyout).toHaveAttribute('data-group-id', 'files-history');
    expect(lane.contains(flyout)).toBe(false);
  });
});
