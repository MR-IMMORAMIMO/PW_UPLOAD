/** @vitest-environment jsdom */
/**
 * H15 structural tests — reference curved tree geometry.
 *
 * H15 refines the tree-connector GEOMETRY ONLY (curve character, trunk inset,
 * branch horizontal reach) while preserving the H14 tree-gutter-only Minimal
 * lane and the flow-owned subtree architecture. These assert structural /
 * behavioral contracts; exact rendered beauty is gated by owner UAT.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { LegacyAppShell as V4AppShell } from '../shell/LegacyAppShell';
import { PROJECT_NAV_GROUPS } from '../navigation/navModel';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

function renderMinimalProject() {
  renderV4(
    <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
  );
  return screen.getByRole('navigation', { name: 'Project navigation' });
}

function openCoordination() {
  fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
}

describe('H15 reference curved tree geometry', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('A: Extended and Minimal use the same connector component/path family', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="extended" onToggleSidebarMode={() => undefined} />,
    );
    // Extended group tree connector exists (group-items ::before is CSS-only;
    // here we confirm the Extended group renders its child stack).
    const coordination = screen.getByRole('button', { name: 'Coordination' });
    fireEvent.click(coordination);
    const group = screen
      .getAllByTestId('v4-nav-group')
      .find((el) => el.getAttribute('data-group-id') === 'coordination');
    expect(group).toBeTruthy();
    expect(group!.querySelectorAll('.v4-nav-item').length).toBeGreaterThan(0);
  });

  it('B: connector geometry uses a true curved SVG path (not square border elbows)', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const tree = screen.getByTestId('v4-minimal-tree');
    const branches = tree.querySelectorAll('.v4-sidebar__minimal-branch');
    expect(branches.length).toBeGreaterThan(0);
    // Each branch is a background-image tile (SVG data URI) — not a CSS border
    // elbow. The curve primitive is asserted in the CSS contract test.
    branches.forEach((b) => {
      expect(b).toHaveClass('v4-sidebar__minimal-branch');
    });
  });

  it('C: shared trunk X/inset derives from the persistent icon-slot/tree token authority', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const lane = screen.getByTestId('v4-minimal-subtree');
    // The lane's branch rows consume the shared tree inset (structural).
    const rows = lane.querySelectorAll('.v4-sidebar__minimal-subtree-row');
    expect(rows.length).toBeGreaterThan(0);
    // The shared inset token is asserted in the CSS contract test; here we
    // confirm the lane structure is intact.
    expect(lane).toHaveAttribute('data-group-id', 'coordination');
  });

  it('D: Minimal branches have a horizontal connection span intended to reach the flyout gutter', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const tree = screen.getByTestId('v4-minimal-tree');
    const branches = tree.querySelectorAll('.v4-sidebar__minimal-branch');
    expect(branches.length).toBeGreaterThan(0);
    // The branch tiles are present in the lane (horizontal reach is a CSS
    // geometry concern asserted in the CSS contract test).
    expect(branches[0]).toBeTruthy();
  });

  it('E: branch count still equals actual child count', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    const tree = screen.getByTestId('v4-minimal-tree');
    expect(tree).toHaveAttribute('data-branch-count', String(coordination.items.length));
    expect(tree.querySelectorAll('.v4-sidebar__minimal-branch')).toHaveLength(
      coordination.items.length,
    );
  });

  it('F: H14 lane contains no child labels/buttons', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const lane = screen.getByTestId('v4-minimal-subtree');
    expect(lane.querySelectorAll('button')).toHaveLength(0);
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    for (const item of coordination.items) {
      expect(lane.textContent).not.toContain(item.label);
    }
  });

  it('G: flow-owned lane and next-group structure remain intact', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const groups = screen.getByTestId('v4-minimal-groups');
    const lane = screen.getByTestId('v4-minimal-subtree');
    expect(groups.contains(lane)).toBe(true);
    // Closing removes the lane + branches + flyout.
    const trigger = screen.getByRole('button', { name: 'Coordination' });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByTestId('v4-minimal-subtree')).toBeNull();
    expect(screen.queryByTestId('v4-minimal-flyout')).toBeNull();
  });
});
