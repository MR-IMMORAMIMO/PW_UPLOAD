/** @vitest-environment jsdom */
/**
 * H11 structural tests — shared multi-branch tree parity between Extended and
 * Minimal Project modes.
 *
 * When a Minimal Project group is open, the reserved subtree footprint carries
 * a FULL multi-branch tree — one curved branch per flyout child — from the SAME
 * group.items collection that drives the flyout, in the same child order.
 *
 * These assert the structural/behavioral contract (branch presence, count,
 * ordering, state transfer); visual quality is gated by owner UAT.
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

function getBranchSet() {
  return screen.getAllByTestId('v4-minimal-tree');
}

describe('H11 minimal multi-branch tree', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('A: opening a Minimal group exposes a minimal multi-branch tree state', () => {
    stubMatchMedia();
    renderMinimalProject();
    // No tree before any group is open.
    expect(screen.queryByTestId('v4-minimal-tree')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-tree')).toBeInTheDocument();
  });

  it('B/D: branch count equals the group actual child count (Coordination = 5)', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    const tree = screen.getByTestId('v4-minimal-tree');
    expect(tree).toHaveAttribute('data-branch-count', String(coordination.items.length));
    expect(tree.querySelectorAll('.v4-sidebar__minimal-branch')).toHaveLength(
      coordination.items.length,
    );
  });

  it('C: branch ordering derives from the same child order as the flyout', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    const tree = screen.getByTestId('v4-minimal-tree');
    // Each subtree row pairs one branch with one child row; the row carries
    // the child id in group.items order.
    const branchChildIds = Array.from(
      tree.querySelectorAll('.v4-sidebar__minimal-subtree-row'),
    ).map((el) => el.getAttribute('data-child-id'));
    // Branch order equals the flyout child order (which equals the canonical
    // group.items order).
    expect(branchChildIds).toEqual(coordination.items.map((item) => item.id));
    const flyoutChildIds = Array.from(
      screen.getByTestId('v4-minimal-flyout').querySelectorAll('.v4-minimal-flyout__item'),
    ).map((el) => el.textContent);
    expect(flyoutChildIds).toEqual(coordination.items.map((item) => item.label));
  });

  it('E: a group with a different child count produces a different branch count', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    const overview = PROJECT_NAV_GROUPS.find((g) => g.id === 'overview')!;
    expect(screen.getByTestId('v4-minimal-tree')).toHaveAttribute(
      'data-branch-count',
      String(overview.items.length),
    );
    expect(
      screen.getByTestId('v4-minimal-tree').querySelectorAll('.v4-sidebar__minimal-branch'),
    ).toHaveLength(overview.items.length);
  });

  it('F: switching Group A -> Group B transfers the branch set to B in one click', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-tree')).toHaveAttribute('data-branch-count', '5');
    const files = screen.getByRole('button', { name: 'Files & History' });
    fireEvent.pointerDown(files);
    fireEvent.click(files);
    const filesGroup = PROJECT_NAV_GROUPS.find((g) => g.id === 'files-history')!;
    // One-click switch: branch set now belongs to Files & History.
    const tree = screen.getByTestId('v4-minimal-tree');
    expect(tree).toHaveAttribute('data-branch-count', String(filesGroup.items.length));
    expect(screen.getByTestId('v4-minimal-subtree')).toHaveAttribute(
      'data-group-id',
      'files-history',
    );
  });

  it('G: closing the flyout removes the branch set', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-tree')).toBeInTheDocument();
    // Same-group click closes (toggle).
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Coordination' }));
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.queryByTestId('v4-minimal-tree')).toBeNull();
  });

  it('H: no closed group renders a branch set', () => {
    stubMatchMedia();
    renderMinimalProject();
    expect(screen.queryByTestId('v4-minimal-tree')).toBeNull();
    expect(screen.queryByTestId('v4-minimal-subtree')).toBeNull();
  });

  it('H13: flow-owned subtree lane owns the child-stack height', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const lane = screen.getByTestId('v4-minimal-subtree');
    // The lane carries the real child count (owns the vertical flow height);
    // no measured spacer is the downstream-flow authority.
    expect(lane).toHaveAttribute('data-child-count', '5');
  });

  it('I: only the open group owns a branch set', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    // Exactly one branch set exists (the open group's).
    expect(getBranchSet()).toHaveLength(1);
  });
});
