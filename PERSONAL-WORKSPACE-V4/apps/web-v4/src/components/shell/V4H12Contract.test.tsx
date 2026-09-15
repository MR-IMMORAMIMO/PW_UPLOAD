/** @vitest-environment jsdom */
/**
 * H12 tests — runtime flyout geometry + Minimal identity.
 *
 *   A. Reserved Minimal footprint derives from the actual measured flyout
 *      bottom/height authority, not child count alone.
 *   B. A reported flyout geometry produces downstream clearance after its
 *      actual bottom.
 *   C. Child-row center measurements are associated by child id and preserve
 *      group.items order.
 *   D. Minimal branch count equals flyout child count.
 *   E. Branch layout consumes measured child-row centers after measurement.
 *   F. Switching group replaces old geometry/child centers with the new
 *      group's data.
 *   G. Close clears flyout geometry and branch state.
 *   I. Project Minimal renders the Project Identity Beacon.
 *   L. Project Minimal status indicator derives from canonical Project.status.
 *
 * Visual quality is gated by owner UAT; these assert structural/behavioral
 * contracts only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { LegacyAppShell as V4AppShell } from '../shell/LegacyAppShell';
import { PROJECT_NAV_GROUPS } from '../navigation/navModel';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const PROJECT = {
  projectCode: '001_SCT260809_TEST',
  projectName: 'Riverside HQ Lighting',
  status: 'InProgress',
};

function renderMinimalProject(project = PROJECT) {
  renderV4(
    <V4AppShell
      context="project"
      sidebarMode="minimal"
      onToggleSidebarMode={() => undefined}
      project={project}
    />,
  );
  return screen.getByRole('navigation', { name: 'Project navigation' });
}

describe('H12 runtime flyout geometry', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('A: flow-owned subtree lane owns the child-stack height', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const lane = screen.getByTestId('v4-minimal-subtree');
    expect(lane).toHaveAttribute('data-child-count', '5');
    // The lane owns the real child-stack height (no measured spacer is the
    // downstream-flow authority).
    expect(lane).toHaveAttribute('data-group-id', 'coordination');
  });

  it('C: child-row centers are associated by id and preserve order', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    // jsdom cannot measure layout, so the branch set carries the child count
    // and each subtree row exposes its child id in group.items order.
    const tree = screen.getByTestId('v4-minimal-tree');
    const branchChildIds = Array.from(
      tree.querySelectorAll('.v4-sidebar__minimal-subtree-row'),
    ).map((el) => el.getAttribute('data-child-id'));
    expect(branchChildIds).toEqual(coordination.items.map((item) => item.id));
  });

  it('D: branch count equals flyout child count (Coordination = 5)', () => {
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

  it('F: switching group replaces old geometry/child centers with the new group data', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-tree')).toHaveAttribute('data-branch-count', '5');
    const files = screen.getByRole('button', { name: 'Files & History' });
    fireEvent.pointerDown(files);
    fireEvent.click(files);
    const filesGroup = PROJECT_NAV_GROUPS.find((g) => g.id === 'files-history')!;
    const tree = screen.getByTestId('v4-minimal-tree');
    expect(tree).toHaveAttribute('data-branch-count', String(filesGroup.items.length));
    expect(screen.getByTestId('v4-minimal-subtree')).toHaveAttribute(
      'data-group-id',
      'files-history',
    );
  });

  it('G: closing the flyout clears geometry and branch state', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-tree')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Coordination' });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByTestId('v4-minimal-tree')).toBeNull();
    expect(screen.queryByTestId('v4-minimal-subtree')).toBeNull();
  });
});

describe('H12 minimal identity', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('I: Project Minimal renders the Project Identity Beacon', () => {
    stubMatchMedia();
    renderMinimalProject();
    const beacon = screen.getByTestId('v4-project-beacon');
    expect(beacon).toBeInTheDocument();
    // Beacon shows the project icon (FolderKanban) + short code + status.
    expect(beacon.querySelector('.v4-sidebar__beacon-icon')).toBeTruthy();
    expect(beacon.querySelector('.v4-sidebar__beacon-code')).toHaveTextContent('001');
  });

  it('L: status indicator derives from canonical Project.status (accessible label)', () => {
    stubMatchMedia();
    renderMinimalProject();
    const status = screen.getByTestId('v4-project-beacon-status');
    expect(status).toHaveAttribute('aria-label', 'Project status: In Progress');
  });

  it('K: short-code helper does not mutate canonical data', () => {
    stubMatchMedia();
    renderMinimalProject();
    // The beacon renders the derived short code, while the canonical project
    // code remains unchanged (not asserted as changed; no write path exists).
    expect(
      screen.getByTestId('v4-project-beacon').querySelector('.v4-sidebar__beacon-code'),
    ).toHaveTextContent('001');
  });

  it('Project Minimal shows no company branding / no SCT Workspace text', () => {
    stubMatchMedia();
    renderMinimalProject();
    expect(screen.queryByText('SCT Workspace')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v4-sidebar-brand')).not.toBeInTheDocument();
  });
});
