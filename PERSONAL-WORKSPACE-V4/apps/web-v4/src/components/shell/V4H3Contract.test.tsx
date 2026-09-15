/** @vitest-environment jsdom */
/**
 * V4 H3 regression tests — trigger-anchored flyouts + stable sidebar chrome +
 * final project bar geometry. Owner-approved narrow policy: automated tests
 * protect structural/behavioral contracts; visual quality is gated by owner
 * visual UAT.
 *
 *   A. Active child automatically opens its owning Extended group.
 *   B. Other manually open groups may remain open simultaneously.
 *   C. Minimal flyout positioning derives from the selected trigger rather than
 *      one fixed Sidebar-top position.
 *   D. Changing selected Minimal group updates/reanchors the flyout.
 *   E. Project Context Header metadata region and fixed action region are
 *      distinct structural tracks.
 *   F. Empty action region remains content-free.
 *   G. Global Minimal uses the same compact active-state class/grammar family
 *      as Minimal Project.
 *   H. Sidebar top-zone structure is shared/stable across Extended and Minimal
 *      for the same context.
 *   I. Bottom utility rows remain structurally present in both modes.
 *   J. Toggle remains structurally attached to the top/nav boundary and outside
 *      navigation/footer flow.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LegacyAppShell as V4AppShell } from './LegacyAppShell';
import { V4ProjectContextHeader } from '../project/V4ProjectContextHeader';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

describe('V4 H3 shell contracts', () => {
  afterEach(() => {
    cleanupV4();
  });

  // A. Active child auto-opens its owning Extended group
  it('A: active child auto-opens its owning Extended group', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="packages"
      />,
    );
    // Packages belongs to Deliverables & Issue, which must be open.
    expect(document.querySelector('[data-group-id="deliverables-issue"]')).toHaveAttribute(
      'data-open',
      'true',
    );
  });

  // B. Other manually open groups may remain open simultaneously
  it('B: other manually open groups may remain open simultaneously', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="packages"
      />,
    );
    // Open Overview manually too.
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(document.querySelector('[data-group-id="overview"]')).toHaveAttribute(
      'data-open',
      'true',
    );
    // Deliverables & Issue (active) remains open; both coexist (nonexclusive).
    expect(document.querySelector('[data-group-id="deliverables-issue"]')).toHaveAttribute(
      'data-open',
      'true',
    );
  });

  // C. Minimal flyout positioning derives from the selected trigger
  it('C: minimal flyout is anchored to the selected group subtree lane (not fixed top)', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    const trigger = screen.getByRole('button', { name: 'Files & History' });
    fireEvent.click(trigger);
    // The open group renders a flow-owned subtree lane, and the child panel is
    // a sibling overlay (not inside the lane / not fixed to a screen top).
    const lane = screen.getByTestId('v4-minimal-subtree');
    expect(lane).toHaveAttribute('data-group-id', 'files-history');
    const flyout = screen.getByTestId('v4-minimal-flyout');
    expect(flyout).toHaveAttribute('data-group-id', 'files-history');
    // The flyout is a shell sibling overlay, not nested inside the lane.
    expect(lane.contains(flyout)).toBe(false);
  });

  // D. Changing selected Minimal group updates/reanchors the flyout
  it('D: changing selected Minimal group reanchors the flyout', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    const coordination = screen.getByRole('button', { name: 'Coordination' });
    fireEvent.click(coordination);
    const firstLane = screen.getByTestId('v4-minimal-subtree');
    expect(firstLane).toHaveAttribute('data-group-id', 'coordination');
    const first = screen.getByTestId('v4-minimal-flyout');
    expect(first).toHaveAttribute('data-group-id', 'coordination');

    const files = screen.getByRole('button', { name: 'Files & History' });
    fireEvent.click(files);
    // The lane and flyout now belong to the new group (reanchored).
    const secondLane = screen.getByTestId('v4-minimal-subtree');
    expect(secondLane).toHaveAttribute('data-group-id', 'files-history');
    const second = screen.getByTestId('v4-minimal-flyout');
    expect(second).toHaveAttribute('data-group-id', 'files-history');
  });

  // E. Project Context Header metadata + action region are distinct tracks
  it('E: Project Context Header has distinct metadata and action tracks', () => {
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
    const fields = header.querySelector('.v4-pch__fields');
    const actionSlot = header.querySelector('.v4-pch__action-slot');
    expect(fields).toBeTruthy();
    expect(actionSlot).toBeTruthy();
    // The action slot is a sibling track, not inside the metadata fields.
    expect(fields?.contains(actionSlot)).toBe(false);
  });

  // F. Empty action region remains content-free
  it('F: empty action region remains content-free', () => {
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

  // G. Global Minimal uses the same compact active-tile grammar as Project Minimal
  it('G: Global Minimal active item uses the compact active-tile grammar', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="global"
        sidebarMode="minimal"
        onToggleSidebarMode={() => undefined}
        activeSectionId="dashboard"
      />,
    );
    const active = document.querySelector('.v4-nav-item--active');
    expect(active).toBeTruthy();
    // The active tile is inside a minimal sidebar (compact tile grammar).
    expect(active?.closest('.v4-sidebar--minimal')).toBeTruthy();
  });

  // H. Sidebar top-zone structure is shared/stable across modes for same context
  it('H: top-zone structure is present in both Extended and Minimal for the same context', () => {
    stubMatchMedia();
    const { unmount } = renderV4(
      <V4AppShell context="global" sidebarMode="extended" onToggleSidebarMode={() => undefined} />,
    );
    expect(document.querySelector('.v4-sidebar__top')).toBeTruthy();
    unmount();
    renderV4(
      <V4AppShell context="global" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    expect(document.querySelector('.v4-sidebar__top')).toBeTruthy();
  });

  // I. Bottom utility rows remain structurally present in both modes
  it('I: bottom utility rows remain structurally present in both modes', () => {
    stubMatchMedia();
    const { unmount } = renderV4(
      <V4AppShell context="global" sidebarMode="extended" onToggleSidebarMode={() => undefined} />,
    );
    expect(document.querySelector('.v4-sidebar__footer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByTestId('v4-work-session-zone')).toBeInTheDocument();
    expect(screen.getByTestId('v4-profile-zone')).toBeInTheDocument();
    unmount();
    renderV4(
      <V4AppShell context="global" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    expect(document.querySelector('.v4-sidebar__footer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByTestId('v4-work-session-zone')).toBeInTheDocument();
    expect(screen.getByTestId('v4-profile-zone')).toBeInTheDocument();
  });

  // J. Toggle structurally attached to top/nav boundary, outside nav/footer
  it('J: toggle is attached to the top/nav boundary, outside nav and footer', () => {
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

  // H8 (Issue 2): Minimal flyout opens directly with child items only — no
  // repeated parent-group title/header — and anchors slightly BELOW the icon.
  it('H8: minimal flyout omits the parent title and anchors to the subtree lane', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    const trigger = screen.getByRole('button', { name: 'Files & History' });
    fireEvent.click(trigger);
    const flyout = screen.getByTestId('v4-minimal-flyout');
    // No parent-group title/header is rendered inside the flyout.
    expect(flyout.querySelector('.v4-minimal-flyout__title')).toBeNull();
    // The flyout opens directly with the child items.
    expect(flyout.querySelectorAll('.v4-minimal-flyout__item').length).toBeGreaterThan(0);
    // The flyout is a shell sibling overlay anchored to the subtree lane.
    const lane = screen.getByTestId('v4-minimal-subtree');
    expect(lane).toHaveAttribute('data-group-id', 'files-history');
    expect(lane.contains(flyout)).toBe(false);
  });
});
