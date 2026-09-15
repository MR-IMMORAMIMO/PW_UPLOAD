import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routerSource = readFileSync(
  path.join(projectRoot, 'apps', 'web-v4', 'src', 'router', 'V4Router.tsx'),
  'utf8',
);

const unifiedRouteConstants = [
  'ROUTE_PROJECT_SUMMARY',
  'ROUTE_PROJECT_WORKFLOW_TIMELINE',
  'ROUTE_PROJECT_SCOPE',
  'ROUTE_PROJECT_ACTIONS',
  'ROUTE_PROJECT_MEETINGS',
  'ROUTE_PROJECT_COMMENTS',
  'ROUTE_PROJECT_CONTACTS',
  'ROUTE_PROJECT_LUMINAIRES',
  'ROUTE_PROJECT_DATASHEETS_IMAGES',
  'ROUTE_PROJECT_TECHNICAL_CHECK',
  'ROUTE_PROJECT_LUMINAIRE_SCHEDULE',
  'ROUTE_PROJECT_TECHNICAL_BOQ',
  'ROUTE_PROJECT_REVISIONS',
  'ROUTE_PROJECT_PACKAGES',
  'ROUTE_PROJECT_FILES',
  'ROUTE_PROJECT_INTELLIGENCE',
] as const;

describe('Personal unified runtime guard', () => {
  it('unified V4 routes remain registered in the UI', () => {
    for (const routeName of unifiedRouteConstants) {
      expect(routerSource, `${routeName} must remain registered`).toContain(`path={${routeName}}`);
    }
  });
});
