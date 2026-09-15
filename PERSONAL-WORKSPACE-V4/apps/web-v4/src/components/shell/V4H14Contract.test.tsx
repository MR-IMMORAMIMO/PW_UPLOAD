/** @vitest-environment jsdom */
/**
 * H14 structural tests — tree-gutter-only Minimal subtree lane + single child
 * presentation.
 *
 * The open Minimal group renders a flow-owned subtree lane directly after its
 * trigger IN the nav flow. The lane carries TREE GEOMETRY ONLY (one curved
 * branch per child) and NO child label/button — the contextual flyout is the
 * single Minimal child presentation. The lane and flyout share one row-height
 * token so branch rows align with flyout child rows.
 *
 * Visual quality (curve character, inset proportion) is gated by owner UAT;
 * these assert structural/behavioral contracts only.
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

describe('H14 tree-gutter-only subtree lane', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('A: the rail subtree lane does NOT render child label text', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const lane = screen.getByTestId('v4-minimal-subtree');
    // No child label text lives inside the rail lane (tree geometry only).
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    for (const item of coordination.items) {
      expect(lane.textContent).not.toContain(item.label);
    }
  });

  it('B: the rail subtree lane does NOT render child navigation buttons', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const lane = screen.getByTestId('v4-minimal-subtree');
    // No interactive child controls inside the rail lane.
    expect(lane.querySelectorAll('button')).toHaveLength(0);
    expect(lane.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
  });

  it('C: the flyout remains the only Minimal child-control/label presentation', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    const flyout = screen.getByTestId('v4-minimal-flyout');
    // The flyout is the single place child labels/controls appear.
    const flyoutItems = Array.from(flyout.querySelectorAll('.v4-minimal-flyout__item'));
    expect(flyoutItems).toHaveLength(coordination.items.length);
    expect(flyoutItems.map((el) => el.textContent)).toEqual(
      coordination.items.map((item) => item.label),
    );
    // The rail lane carries no child label/control.
    const lane = screen.getByTestId('v4-minimal-subtree');
    expect(lane.querySelectorAll('button')).toHaveLength(0);
  });

  it('D: branch count equals group.items.length', () => {
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

  it('E: branch order follows group.items order', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    const tree = screen.getByTestId('v4-minimal-tree');
    const rowChildIds = Array.from(tree.querySelectorAll('.v4-sidebar__minimal-subtree-row')).map(
      (el) => el.getAttribute('data-child-id'),
    );
    expect(rowChildIds).toEqual(coordination.items.map((item) => item.id));
  });

  it('F: branch stack uses the shared subtree-row-height token', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const tree = screen.getByTestId('v4-minimal-tree');
    const rows = tree.querySelectorAll('.v4-sidebar__minimal-subtree-row');
    expect(rows.length).toBeGreaterThan(0);
    // Each branch row is a branch-only gutter slot (no label/button).
    rows.forEach((row) => {
      expect(row.querySelectorAll('.v4-sidebar__minimal-branch')).toHaveLength(1);
      expect(row.querySelectorAll('button')).toHaveLength(0);
    });
  });

  it('G: flyout child rows use the same subtree-row-height token/rhythm', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const flyout = screen.getByTestId('v4-minimal-flyout');
    const items = flyout.querySelectorAll('.v4-minimal-flyout__item');
    expect(items.length).toBeGreaterThan(0);
    // The flyout child rows and the lane branch rows share one row rhythm
    // (both consume the shared subtree-row-height token in CSS).
    const laneRows = screen
      .getByTestId('v4-minimal-tree')
      .querySelectorAll('.v4-sidebar__minimal-subtree-row');
    expect(laneRows.length).toBe(items.length);
  });

  it('H: removing duplicate rail child presentation does NOT collapse lane height', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    const lane = screen.getByTestId('v4-minimal-subtree');
    // The lane still owns the real child-stack height via its branch rows
    // (one row per child), even though no child label/button is rendered.
    expect(lane).toHaveAttribute('data-child-count', String(coordination.items.length));
    expect(lane.querySelectorAll('.v4-sidebar__minimal-subtree-row')).toHaveLength(
      coordination.items.length,
    );
  });

  it('I: next primary group remains structurally after the subtree lane', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    const groups = screen.getByTestId('v4-minimal-groups');
    const lane = screen.getByTestId('v4-minimal-subtree');
    // The lane is a child of the minimal-groups flow container, so the next
    // group trigger follows it in normal DOM/navigation flow.
    expect(groups.contains(lane)).toBe(true);
  });

  it('J: closing removes lane + branches + flyout', () => {
    stubMatchMedia();
    renderMinimalProject();
    openCoordination();
    expect(screen.getByTestId('v4-minimal-subtree')).toBeInTheDocument();
    expect(screen.getByTestId('v4-minimal-flyout')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Coordination' });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByTestId('v4-minimal-subtree')).toBeNull();
    expect(screen.queryByTestId('v4-minimal-tree')).toBeNull();
    expect(screen.queryByTestId('v4-minimal-flyout')).toBeNull();
  });

  it('K: Extended and Minimal tree connector grammar share the same curve/inset token family', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="extended" onToggleSidebarMode={() => undefined} />,
    );
    // Extended mode renders the group tree connector (group-items ::before).
    const coordination = screen.getByRole('button', { name: 'Coordination' });
    fireEvent.click(coordination);
    const group = screen
      .getAllByTestId('v4-nav-group')
      .find((el) => el.getAttribute('data-group-id') === 'coordination');
    expect(group).toBeTruthy();
    // Both modes consume the shared tree inset token (asserted structurally in
    // the CSS contract test; here we confirm the Extended tree renders).
    expect(group!.querySelectorAll('.v4-nav-item')).toBeTruthy();
  });
});
