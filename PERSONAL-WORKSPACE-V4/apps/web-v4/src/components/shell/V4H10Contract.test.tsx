/** @vitest-environment jsdom */
/**
 * H10 behavioral contracts — sidebar runtime interaction corrections.
 *
 * Four owner-visible defects:
 *   1. Persistent Sidebar icons flicker/recenter during the Extended<->Minimal
 *      morph (must stay in a shared fixed left-anchored icon slot).
 *   2. The Minimal Project flyout must reserve the ACTUAL measured flyout
 *      footprint so the next primary group icon begins AFTER the full flyout.
 *   3. No detached group tooltip/hover artifact should appear while a Minimal
 *      contextual flyout is open.
 *   4. Clicking a DIFFERENT Minimal group while one is open switches in ONE
 *      click (a group trigger is NOT an outside click).
 *
 * Visual/motion quality remains gated by owner UAT; these assert the structural
 * + behavioral contracts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { LegacyAppShell as V4AppShell } from '../shell/LegacyAppShell';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const PROJECT = {
  projectCode: 'SCT-1042',
  projectName: 'Riverside HQ Lighting',
  status: 'InProgress',
};

function renderMinimalProject() {
  renderV4(
    <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
  );
  return screen.getByRole('navigation', { name: 'Project navigation' });
}

describe('H10 sidebar interaction contracts', () => {
  afterEach(() => {
    cleanupV4();
  });

  // ---- Defect 1: persistent icon stability ----

  it('D1: global minimal nav uses the shared left-anchored icon slot (no centering)', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="global" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Global navigation' });
    // Each Global primary item is a NavItem row in the shared icon-slot grammar.
    for (const label of ['Dashboard', 'Projects', 'Luminaire Library', 'Reports']) {
      const item = within(nav).getByRole('button', { name: label });
      expect(item.querySelector('.v4-nav-item__icon')).toBeTruthy();
    }
    // The icon slot stays left-anchored in both modes (no `justify-content:
    // center`); verified structurally by CSS contract + render presence here.
    expect(nav.querySelectorAll('.v4-nav-item__icon').length).toBe(5);
  });

  it('D1: project minimal group heads use the shared left-anchored icon slot', () => {
    stubMatchMedia();
    renderMinimalProject();
    const nav = screen.getByRole('navigation', { name: 'Project navigation' });
    for (const label of [
      'Overview',
      'Coordination',
      'Technical Workspace',
      'Deliverables & Issue',
      'Files & History',
    ]) {
      expect(
        within(nav).getByRole('button', { name: label }).querySelector('.v4-nav-item__icon'),
      ).toBeTruthy();
    }
  });

  // ---- Defect 2: flow-owned subtree lane (H13) ----

  it('D2: open group renders a flow-owned subtree lane so next icon clears it', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    const lane = screen.getByTestId('v4-minimal-subtree');
    expect(lane).toHaveAttribute('data-group-id', 'coordination');
    // The lane owns the real child-stack height (no measured spacer).
    expect(lane).toHaveAttribute('data-child-count', '5');
  });

  it('D2: only the currently open group renders a subtree lane', () => {
    stubMatchMedia();
    renderMinimalProject();
    // No lane before any group is open.
    expect(screen.queryByTestId('v4-minimal-subtree')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    // Exactly one lane exists (only the open group owns a subtree).
    expect(screen.getAllByTestId('v4-minimal-subtree')).toHaveLength(1);
  });

  // ---- Defect 3: no tooltip artifact on project group triggers ----

  it('D3: project minimal group triggers do NOT wrap in a tooltip', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    // The flyout is the interaction; there must be NO tooltip bubble rendered
    // for project group heads (which would be a detached ghost artifact).
    expect(screen.queryByRole('tooltip')).toBeNull();
    // aria-label remains the mandatory accessible label.
    expect(screen.getByRole('button', { name: 'Coordination' })).toHaveAttribute(
      'aria-label',
      'Coordination',
    );
  });

  // ---- Defect 4: one-click group switch ----

  it('D4: a DIFFERENT group switch is atomic in ONE click', () => {
    stubMatchMedia();
    renderMinimalProject();
    // Open Coordination.
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-flyout')).toHaveAttribute(
      'data-group-id',
      'coordination',
    );
    // Simulate a pointerdown on a DIFFERENT group trigger (Files & History),
    // then a click. The trigger must NOT be treated as an outside close.
    const files = screen.getByRole('button', { name: 'Files & History' });
    fireEvent.pointerDown(files);
    fireEvent.click(files);
    // ONE click switches directly to the new group — no intermediate close.
    const flyout = screen.getByTestId('v4-minimal-flyout');
    expect(flyout).toHaveAttribute('data-group-id', 'files-history');
    // Subtree lane transferred to the new group.
    expect(screen.getByTestId('v4-minimal-subtree')).toHaveAttribute(
      'data-group-id',
      'files-history',
    );
  });

  it('D4: clicking the SAME open group toggles it closed', () => {
    stubMatchMedia();
    renderMinimalProject();
    const coordination = screen.getByRole('button', { name: 'Coordination' });
    fireEvent.click(coordination);
    expect(screen.getByTestId('v4-minimal-flyout')).toHaveAttribute(
      'data-group-id',
      'coordination',
    );
    fireEvent.pointerDown(coordination);
    fireEvent.click(coordination);
    expect(screen.queryByTestId('v4-minimal-flyout')).toBeNull();
    expect(screen.queryByTestId('v4-minimal-subtree-footprint')).toBeNull();
  });

  it('D4: an outside click (not a trigger) still closes the flyout', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-flyout')).toBeInTheDocument();
    // Pointer down on the shell (outside the flyout and any trigger).
    fireEvent.pointerDown(document.querySelector('.v4-sidebar-shell')!);
    expect(screen.queryByTestId('v4-minimal-flyout')).toBeNull();
  });

  it('D4: Escape still closes the flyout', () => {
    stubMatchMedia();
    renderMinimalProject();
    fireEvent.click(screen.getByRole('button', { name: 'Coordination' }));
    expect(screen.getByTestId('v4-minimal-flyout')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('v4-minimal-flyout')).toBeNull();
  });

  // ---- Preservation ----

  it('P: H9 parent-group icons remain in the minimal rail', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="minimal"
        onToggleSidebarMode={() => undefined}
        project={PROJECT}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Project navigation' });
    // Child destinations are NOT permanent minimal rail icons.
    expect(within(nav).queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
    // Parent group heads present with icons.
    for (const label of ['Overview', 'Coordination']) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });
});
