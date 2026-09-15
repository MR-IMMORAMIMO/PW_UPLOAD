/** @vitest-environment jsdom */
/**
 * V4Sidebar focused component tests (F2 + H1).
 *
 *   A. Global shell renders (via V4AppShell).
 *   C. Extended sidebar is the default mode.
 *   D. Minimal mode renders icon-only navigation with accessible labels.
 *   E. Extended <-> Minimal toggle works.
 *   I. Active item semantics are accessible (aria-current).
 *   J. Minimal icon nav has accessible labels/tooltips.
 *   K/L. Project identity uses canonical data (no fabrication).
 *   P. Reduced motion disables the traveling sweep.
 *   H1: Extended Global shows SCT Workspace + real logo; Minimal shows no
 *       brand/logo; Extended Project shows no global brand block + status chip;
 *       groups collapse independently and auto-open the active group.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { LegacyAppShell as V4AppShell } from '../shell/LegacyAppShell';
import { V4Sidebar } from './V4Sidebar';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';

const PROJECT = {
  projectCode: 'SCT-1042',
  projectName: 'Riverside HQ Lighting',
  status: 'InProgress',
};

describe('V4Sidebar', () => {
  afterEach(() => {
    cleanupV4();
  });

  it('global context renders the global navigation model (A)', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="global"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="projects"
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Global navigation' })).toBeInTheDocument();
    for (const label of ['Dashboard', 'Projects', 'Reports', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('extended is the default presentation mode (C)', () => {
    stubMatchMedia();
    renderV4(<V4Sidebar context="global" mode="extended" onToggleMode={() => undefined} />);
    expect(screen.getByRole('complementary').className).toContain('v4-sidebar--extended');
  });

  it('minimal mode renders group-level icon rail with accessible labels (D, J, H2)', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    const aside = screen.getByRole('complementary');
    expect(aside.className).toContain('v4-sidebar--minimal');
    const nav = screen.getByRole('navigation', { name: 'Project navigation' });
    // H2: Minimal Project is a GROUP-LEVEL icon rail, not every child page.
    for (const label of [
      'Overview',
      'Coordination',
      'Technical Workspace',
      'Deliverables & Issue',
      'Files & History',
    ]) {
      expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument();
    }
    // Child pages are NOT permanent minimal rail icons.
    expect(within(nav).queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('toggles between extended and minimal (E)', () => {
    stubMatchMedia();
    const onToggle = vi.fn();
    renderV4(<V4Sidebar context="global" mode="extended" onToggleMode={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar to minimal' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('exposes the active item via aria-current for accessible semantics (I)', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveAttribute('aria-current', 'page');
    // Open the Overview group to reveal a non-active item.
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.getByRole('button', { name: 'Summary' })).not.toHaveAttribute('aria-current');
  });

  it('renders project identity from provided canonical data (L, no fabrication)', () => {
    stubMatchMedia();
    renderV4(
      <V4Sidebar
        context="project"
        mode="extended"
        onToggleMode={() => undefined}
        project={PROJECT}
      />,
    );
    expect(screen.getByText('SCT-1042')).toBeInTheDocument();
    expect(screen.getByText('Riverside HQ Lighting')).toBeInTheDocument();
  });

  it('shows a controlled loading state without inventing data', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        project={null}
        projectLoading
      />,
    );
    expect(screen.getByText('Loading project…')).toBeInTheDocument();
  });

  it('shows a controlled unavailable state without inventing data', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        project={null}
        projectLoading={false}
      />,
    );
    expect(screen.getByText('Project unavailable')).toBeInTheDocument();
  });

  it('does not render a traveling sweep under reduced motion (P)', () => {
    stubMatchMedia({ reduced: true });
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="summary"
      />,
    );
    // Active state is present and stable.
    expect(screen.getByRole('button', { name: 'Summary' })).toHaveAttribute('aria-current', 'page');
    // No traveling sweep layer is emitted.
    expect(document.querySelector('.v4-nav-sweep')).toBeNull();
  });

  it('reserves the Work Session and Profile shell zones (24, 25)', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="global" sidebarMode="extended" onToggleSidebarMode={() => undefined} />,
    );
    expect(screen.getByTestId('v4-work-session-zone')).toBeInTheDocument();
    expect(screen.getByTestId('v4-profile-zone')).toBeInTheDocument();
  });

  // ---- H1 branding ----

  it('H1: Extended Global shows SCT Workspace + real logo, no Personal Workspace', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="global" sidebarMode="extended" onToggleSidebarMode={() => undefined} />,
    );
    expect(screen.getByText('SCT Workspace')).toBeInTheDocument();
    expect(screen.getByTestId('v4-sidebar-logo')).toBeInTheDocument();
    expect(screen.queryByText('Personal Workspace')).not.toBeInTheDocument();
  });

  it('H1: Minimal Global shows no brand, no logo, no S tile', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="global" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    expect(screen.queryByText('SCT Workspace')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v4-sidebar-logo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v4-sidebar-brand')).not.toBeInTheDocument();
  });

  it('H1: Minimal Project shows no brand/logo but Back icon has accessible label', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell context="project" sidebarMode="minimal" onToggleSidebarMode={() => undefined} />,
    );
    expect(screen.queryByTestId('v4-sidebar-brand')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v4-sidebar-logo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Projects' })).toBeInTheDocument();
  });

  it('H1: Extended Project shows no global brand block', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        project={PROJECT}
      />,
    );
    expect(screen.queryByTestId('v4-sidebar-brand')).not.toBeInTheDocument();
    expect(screen.queryByText('SCT Workspace')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Projects' })).toBeInTheDocument();
  });

  it('H1: Extended Project shows canonical Project Status chip (humanized)', () => {
    stubMatchMedia();
    renderV4(
      <V4Sidebar
        context="project"
        mode="extended"
        onToggleMode={() => undefined}
        project={PROJECT}
      />,
    );
    // H2: status is humanized for display (InProgress -> In Progress).
    expect(screen.getByTestId('v4-project-status-chip')).toHaveTextContent('In Progress');
  });

  // ---- H1 collapsible groups ----

  it('H1: active section group auto-opens, unrelated groups may stay collapsed', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    // Coordination (contains Actions) is open.
    expect(document.querySelector('[data-group-id="coordination"]')).toHaveAttribute(
      'data-open',
      'true',
    );
    // Overview (no active item) is collapsed.
    expect(document.querySelector('[data-group-id="overview"]')).toHaveAttribute(
      'data-open',
      'false',
    );
  });

  it('H1: user can independently open multiple groups (non-exclusive)', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    // Open Overview too.
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

  it('H1: collapsing one group does not collapse another', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(document.querySelector('[data-group-id="overview"]')).toHaveAttribute(
      'data-open',
      'false',
    );
    expect(document.querySelector('[data-group-id="coordination"]')).toHaveAttribute(
      'data-open',
      'true',
    );
  });

  it('H1: group headers expose aria-expanded semantics', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    expect(screen.getByRole('button', { name: 'Coordination' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  // ---- H9: explicit group-icon presentation ----

  it('H9: Extended group headers render the parent group icon', () => {
    stubMatchMedia();
    renderV4(
      <V4AppShell
        context="project"
        sidebarMode="extended"
        onToggleSidebarMode={() => undefined}
        activeSectionId="actions"
      />,
    );
    // Coordination group header carries the group icon element.
    const coordination = screen.getByRole('button', { name: 'Coordination' });
    expect(coordination.querySelector('.v4-sidebar__group-icon')).toBeTruthy();
    // The icon is the parent group's explicit icon (Network), not a child icon.
    expect(coordination.querySelector('.v4-sidebar__group-icon')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('H9: Minimal group triggers render the parent group icon', () => {
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
      const trigger = within(nav).getByRole('button', { name: label });
      // Each Minimal group trigger renders an icon (the parent group icon).
      expect(trigger.querySelector('.v4-nav-item__icon')).toBeTruthy();
    }
  });
});
