/**
 * V4 canonical route constants.
 *
 * Application routes are canonical relative routes (no `/v4` prefix). The
 * renderer base/basename is applied once at the router level via
 * `V4_ROUTER_BASENAME`, so `/v4` is never duplicated into route definitions.
 *
 * F1B defines only the foundation routes. F2 adds the DIAGNOSTIC shell routes
 * that prove the GLOBAL and PROJECT shell contexts. Product routes (Dashboard,
 * Projects, Summary, Workflow, Scope, Actions, ...) are intentionally NOT
 * defined yet.
 */
export const ROUTE_FOUNDATION = '/';
/** Canonical Personal Workspace daily command center. */
export const ROUTE_DASHBOARD = '/dashboard';
export const ROUTE_DIAGNOSTIC = '/diagnostic';
export const ROUTE_DIAGNOSTIC_SHELL = '/diagnostic/shell';
export const ROUTE_DIAGNOSTIC_PROJECT_SHELL = '/diagnostic/project-shell/:projectId';
/** Canonical Personal Workspace global Projects route. */
export const ROUTE_PROJECTS = '/projects';
/** Canonical global Master Luminaire Library route. */
export const ROUTE_LUMINAIRE_LIBRARY = '/luminaire-library';
/** Canonical persistent Smart Import inspection workspace. */
export const ROUTE_IMPORTS = '/imports';
/** Canonical global Document Intelligence review workspace. */
export const ROUTE_DOCUMENTS = '/documents';
/** Canonical five-step Personal Workspace project creation route. */
export const ROUTE_NEW_PROJECT = '/new';
/** Canonical Personal Workspace global Settings route. */
export const ROUTE_SETTINGS = '/settings';
/** Canonical project Summary product route (PW-V4-F3-P1). */
export const ROUTE_PROJECT_SUMMARY = '/projects/:projectId/summary';
export const ROUTE_PROJECT_WORKFLOW_TIMELINE = '/projects/:projectId/workflow-timeline';
/** Canonical project Scope & Services route (PW-V4-F3-P3). */
export const ROUTE_PROJECT_SCOPE = '/projects/:projectId/scope';
/** Canonical project Actions product route (PW-V4-ACTIONS-A1). */
export const ROUTE_PROJECT_ACTIONS = '/projects/:projectId/actions';
/** Canonical project Meetings product route (MEETINGS-UX). */
export const ROUTE_PROJECT_MEETINGS = '/projects/:projectId/meetings';
/** Canonical project Comments / review threads route (COMMENTS-UX-01). */
export const ROUTE_PROJECT_COMMENTS = '/projects/:projectId/comments';
/** Canonical project Contacts route (V4-CONTACTS-UX-01). */
export const ROUTE_PROJECT_CONTACTS = '/projects/:projectId/contacts';
/** Canonical project Luminaires technical workspace route. */
export const ROUTE_PROJECT_LUMINAIRES = '/projects/:projectId/luminaires';
/** Canonical project Datasheets & Images technical workspace route. */
export const ROUTE_PROJECT_DATASHEETS_IMAGES = '/projects/:projectId/datasheets-images';
/** Canonical project Technical Check workspace route. */
export const ROUTE_PROJECT_TECHNICAL_CHECK = '/projects/:projectId/technical-check';
/** Canonical project Technical Luminaire Schedule workspace route. */
export const ROUTE_PROJECT_LUMINAIRE_SCHEDULE = '/projects/:projectId/luminaire-schedule';
/** Canonical project Technical BOQ workspace route. */
export const ROUTE_PROJECT_TECHNICAL_BOQ = '/projects/:projectId/technical-boq';
export const ROUTE_PROJECT_REVISIONS = '/projects/:projectId/revisions';
/** Canonical project Packages build / validate / local Issue route. */
export const ROUTE_PROJECT_PACKAGES = '/projects/:projectId/packages';
/** Canonical project Files (working-file register) route. */
export const ROUTE_PROJECT_FILES = '/projects/:projectId/files';
/** Canonical project Intelligence & Productivity route (P5D). */
export const ROUTE_PROJECT_INTELLIGENCE = '/projects/:projectId/intelligence';
export const ROUTE_NOT_FOUND = '*';

export function projectRoute(template: string, projectId: string): string {
  return template.replace(':projectId', encodeURIComponent(projectId));
}
