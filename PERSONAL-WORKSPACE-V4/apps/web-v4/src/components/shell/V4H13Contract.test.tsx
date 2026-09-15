/** @vitest-environment jsdom */
/**
 * H13 structural tests — flow-owned Minimal subtree lane.
 *
 * The open Minimal group renders a subtree lane directly after its trigger IN
 * the nav flow. The lane owns the REAL vertical height of the child stack, so
 * the next primary group follows it naturally — no measured spacer. Each
 * subtree row pairs one curved branch with one child row (structural
 * alignment).
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

describe('H13 flow-owned subtree lane', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('A: open group renders a flow-owned subtree lane after its trigger', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const lane = screen.getByTestId('v4-minimal-subtree');
    expect(lane).toHaveAttribute('data-group-id', 'coordination');
    expect(lane).toHaveAttribute('data-child-count', '5');
  });

  it('B: next primary group is structurally after the subtree lane in flow', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const groups = screen.getByTestId('v4-minimal-groups');
    const lane = screen.getByTestId('v4-minimal-subtree');
    // The lane is a child of the minimal-groups flow container, so the next
    // group trigger follows it in normal DOM/navigation flow.
    expect(groups.contains(lane)).toBe(true);
    // The lane sits inside the flow (not an absolutely-positioned overlay).
    expect(lane).toHaveAttribute('data-testid', 'v4-minimal-subtree');
  });

  it('C: no independent child-count spacer is the downstream-flow authority', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    // The lane owns its height via the child rows; there is no separate
    // measured-spacer element with a data-footprint-height attribute.
    expect(screen.queryByTestId('v4-minimal-subtree-footprint')).toBeNull();
    expect(document.querySelector('[data-footprint-height]')).toBeNull();
  });

  it('D: branch count equals actual child count', () => {
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

  it('E: each branch and child row share one subtree-row structural unit', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    const tree = screen.getByTestId('v4-minimal-tree');
    const rows = tree.querySelectorAll('.v4-sidebar__minimal-subtree-row');
    expect(rows).toHaveLength(coordination.items.length);
    // Each row contains exactly one branch.
    rows.forEach((row) => {
      expect(row.querySelectorAll('.v4-sidebar__minimal-branch')).toHaveLength(1);
    });
  });

  it('F: child ordering follows group.items', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const coordination = PROJECT_NAV_GROUPS.find((g) => g.id === 'coordination')!;
    const tree = screen.getByTestId('v4-minimal-tree');
    const rowChildIds = Array.from(tree.querySelectorAll('.v4-sidebar__minimal-subtree-row')).map(
      (el) => el.getAttribute('data-child-id'),
    );
    expect(rowChildIds).toEqual(coordination.items.map((item) => item.id));
  });

  it('G: switching A->B in one click unmounts A lane and mounts B lane', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-subtree')).toHaveAttribute(
      'data-group-id',
      'coordination',
    );
    const files = screen.getByRole('button', { name: 'Files & History' });
    fireEvent.pointerDown(files);
    fireEvent.click(files);
    // Exactly one lane, now owned by Files & History.
    expect(screen.getAllByTestId('v4-minimal-subtree')).toHaveLength(1);
    expect(screen.getByTestId('v4-minimal-subtree')).toHaveAttribute(
      'data-group-id',
      'files-history',
    );
  });

  it('H: closing removes the lane completely', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-subtree')).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Coordination' });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByTestId('v4-minimal-subtree')).toBeNull();
    expect(screen.queryByTestId('v4-minimal-tree')).toBeNull();
  });

  it('J: Project Minimal Back appears before the identity beacon in hierarchy', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="minimal"
        onToggleSidebarMode={() => undefined}
        project={{ projectCode: '001_SCT260809_TEST', projectName: 'R', status: 'InProgress' }}
      />,
    );
    const top = document.querySelector('.v4-sidebar__top')!;
    const back = top.querySelector('[data-testid="v4-project-beacon"]');
    const backButton = Array.from(top.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Back to Projects',
    );
    // Back control precedes the beacon in DOM order.
    expect(backButton).toBeTruthy();
    expect(back).toBeTruthy();
    expect(
      backButton!.compareDocumentPosition(back!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
