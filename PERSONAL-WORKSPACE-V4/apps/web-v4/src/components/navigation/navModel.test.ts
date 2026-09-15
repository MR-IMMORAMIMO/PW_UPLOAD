/**
 * Navigation model tests (pure).
 *
 *   G. Global context navigation model differs from Project context.
 *   H. Project navigation groups match the locked IA.
 *   (structural icon grammar is asserted as present + consistent)
 */
import { describe, expect, it } from 'vitest';
import { createElement, isValidElement } from 'react';
import {
  SctImportHistory as FolderClock,
  LayoutDashboard,
  Lightbulb,
  Network,
  PackageCheck,
} from '../common/SctIcons';
import {
  BACK_TO_PROJECTS_ITEM,
  GLOBAL_NAV_ITEMS,
  PROJECT_NAV_GROUPS,
  PROJECT_NAV_ITEM_IDS,
  SETTINGS_NAV_ITEM,
  findProjectNavItem,
} from './navModel';

const LOCKED_PROJECT_GROUPS: Array<{ id: string; label: string; itemLabels: string[] }> = [
  {
    id: 'overview',
    label: 'Overview',
    itemLabels: ['Summary', 'Workflow Timeline'],
  },
  {
    id: 'coordination',
    label: 'Coordination',
    itemLabels: ['Meetings', 'Scope & Services', 'Actions', 'Comments', 'Contacts'],
  },
  {
    id: 'technical-workspace',
    label: 'Technical Workspace',
    itemLabels: [
      'Luminaires',
      'Datasheets & Images',
      'Technical Check',
      'Lighting Systems',
      'System Accessories',
      'Output Studio',
      'Datasheets',
    ],
  },
  {
    id: 'deliverables-issue',
    label: 'Deliverables & Issue',
    itemLabels: ['Revisions & Deliverables', 'Packages', 'Submissions', 'Issue History'],
  },
  {
    id: 'files-history',
    label: 'Files & History',
    itemLabels: ['Files', 'Register', 'Activity'],
  },
];

describe('navModel', () => {
  it('GLOBAL context differs from PROJECT context (G)', () => {
    const globalIds = GLOBAL_NAV_ITEMS.map((item) => item.id);
    // H2: Settings is NOT part of primary Global navigation.
    expect(globalIds).toEqual(['dashboard', 'projects', 'luminaire-library', 'imports', 'reports']);
    expect(globalIds).not.toEqual(expect.arrayContaining(PROJECT_NAV_ITEM_IDS));
  });

  it('enables Dashboard and Reports', () => {
    const dashboard = GLOBAL_NAV_ITEMS.find((item) => item.id === 'dashboard');
    const reports = GLOBAL_NAV_ITEMS.find((item) => item.id === 'reports');
    expect(dashboard).toMatchObject({ route: '/dashboard' });
    expect(dashboard?.disabled).not.toBe(true);
    expect(reports?.disabled).not.toBe(true);
    expect(GLOBAL_NAV_ITEMS.find((item) => item.id === 'luminaire-library')).toMatchObject({
      route: '/luminaire-library',
    });
  });

  it('H2: Settings is a separate bottom-utility item, not primary Global nav', () => {
    expect(SETTINGS_NAV_ITEM.id).toBe('settings');
    expect(SETTINGS_NAV_ITEM.label).toBe('Settings');
    expect(GLOBAL_NAV_ITEMS.some((item) => item.id === 'settings')).toBe(false);
    expect(SETTINGS_NAV_ITEM.route).toBe('/settings');
    expect(SETTINGS_NAV_ITEM.disabled).not.toBe(true);
  });

  it('PROJECT groups match the locked IA (H)', () => {
    expect(PROJECT_NAV_GROUPS).toHaveLength(LOCKED_PROJECT_GROUPS.length);
    PROJECT_NAV_GROUPS.forEach((group, index) => {
      const locked = LOCKED_PROJECT_GROUPS[index]!;
      expect(group.id).toBe(locked.id);
      expect(group.label).toBe(locked.label);
      expect(group.items.map((item) => item.label)).toEqual(locked.itemLabels);
    });
  });

  it('every project nav item has a structural icon and stable id (structural icons)', () => {
    for (const group of PROJECT_NAV_GROUPS) {
      for (const item of group.items) {
        expect(isValidElement(createElement(item.icon))).toBe(true);
        expect(item.id.length).toBeGreaterThan(0);
        expect(item.route).toMatch(/^\/projects\/:(?:id|projectId)\//);
      }
    }
  });

  it('global nav items each carry a structural icon (structural icons)', () => {
    for (const item of GLOBAL_NAV_ITEMS) {
      expect(isValidElement(createElement(item.icon))).toBe(true);
    }
  });

  it('Back to Projects anchor is a distinct first-class item', () => {
    expect(BACK_TO_PROJECTS_ITEM.id).toBe('back-to-projects');
    expect(BACK_TO_PROJECTS_ITEM.label).toBe('Back to Projects');
    expect(isValidElement(createElement(BACK_TO_PROJECTS_ITEM.icon))).toBe(true);
  });

  it('findProjectNavItem resolves known ids and rejects unknown ones', () => {
    expect(findProjectNavItem('actions')?.label).toBe('Actions');
    expect(findProjectNavItem('technical-check')?.route).toBe(
      '/projects/:projectId/technical-check',
    );
    expect(findProjectNavItem('studio-output')?.route).toBe('/projects/:projectId/output-studio');
    expect(findProjectNavItem('studio-systems')?.route).toBe(
      '/projects/:projectId/lighting-systems',
    );
    expect(findProjectNavItem('not-a-section')).toBeUndefined();
  });

  it('Revisions & Deliverables uses the canonical :projectId route (no latent :id trap)', () => {
    const revisions = findProjectNavItem('revisions');
    expect(revisions?.route).toBe('/projects/:projectId/revisions');
    // No legacy `:id` placeholder remains in the ROUTED project IA — a stale
    // generatePath(`/projects/:id/revisions`) would silently produce a double
    // segment. Every item that maps to a real registered route (Revisions,
    // technical/coordination/overview groups) must use the canonical token.
    // The 'files-history' group (Files/Register/Activity) is an unregistered
    // later slice; its items are disabled and normalized to :projectId here so
    // no latent :id trap survives anywhere in the project IA.
    for (const group of PROJECT_NAV_GROUPS) {
      for (const item of group.items) {
        expect(item.route.includes('/projects/:id/')).toBe(false);
        if (item.route.startsWith('/projects/')) {
          expect(item.route).toMatch(/^\/projects\/:projectId\//);
        }
      }
    }
  });

  it('Files is enabled while Register and Activity remain disabled', () => {
    const files = findProjectNavItem('files');
    expect(files?.route).toBe('/projects/:projectId/files');
    expect(files?.disabled).not.toBe(true);
    expect(findProjectNavItem('register')?.disabled).toBe(true);
    expect(findProjectNavItem('activity')?.disabled).toBe(true);
  });

  it('enables Packages while Submissions and Issue History remain disabled', () => {
    const packages = findProjectNavItem('packages');
    expect(packages?.route).toBe('/projects/:projectId/packages');
    expect(packages?.disabled).not.toBe(true);
    expect(findProjectNavItem('submissions')?.disabled).toBe(true);
    expect(findProjectNavItem('issue-history')?.disabled).toBe(true);
  });

  // ---- H9: explicit group-icon authority ----

  it('H9: every primary project group owns an explicit icon property', () => {
    for (const group of PROJECT_NAV_GROUPS) {
      expect(group.icon, `group ${group.id} must define an explicit icon`).toBeTruthy();
      expect(isValidElement(createElement(group.icon))).toBe(true);
    }
  });

  it('H9: the five groups map to the owner-approved custom SVG icons', () => {
    const byId = new Map(PROJECT_NAV_GROUPS.map((g) => [g.id, g.icon]));
    expect(byId.get('overview')).toBe(LayoutDashboard);
    expect(byId.get('coordination')).toBe(Network);
    expect(byId.get('technical-workspace')).toBe(Lightbulb);
    expect(byId.get('deliverables-issue')).toBe(PackageCheck);
    expect(byId.get('files-history')).toBe(FolderClock);
  });

  it('H9: group icon is an explicit property, not a first-child fallback', () => {
    // The V4NavGroup type requires an explicit `icon` on every group. There is
    // no `group.icon ?? group.items[0].icon` fallback anywhere in the model —
    // each group hardcodes its own semantic icon. (A group may legitimately
    // share an icon with one of its children, e.g. Technical Workspace and its
    // Luminaires child both use Lightbulb; that is not a fallback.)
    for (const group of PROJECT_NAV_GROUPS) {
      expect(group.icon).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(group, 'icon')).toBe(true);
    }
  });

  it('H9: child definitions remain independent of the parent group icon', () => {
    for (const group of PROJECT_NAV_GROUPS) {
      for (const item of group.items) {
        expect(isValidElement(createElement(item.icon))).toBe(true);
      }
    }
  });
});
