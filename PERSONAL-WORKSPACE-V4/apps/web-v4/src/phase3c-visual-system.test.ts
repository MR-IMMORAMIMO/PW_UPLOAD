/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(resolve(here, './styles/v4-tokens.css'), 'utf8');
const primitives = readFileSync(resolve(here, './styles/v4-primitives.css'), 'utf8');
const shell = readFileSync(resolve(here, './styles/v4-shell.css'), 'utf8');
const legacy = readFileSync(resolve(here, './styles-v4.css'), 'utf8');
const main = readFileSync(resolve(here, './main.tsx'), 'utf8');

function luminance(hex: string): number {
  const values = hex
    .replace('#', '')
    .match(/.{2}/g)!
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * values[0]! + 0.7152 * values[1]! + 0.0722 * values[2]!;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe('Phase 3C token and theme authority', () => {
  it('loads tokens, page authority, primitives and shell in deterministic cascade order', () => {
    const imports = [
      "import './styles/v4-tokens.css';",
      "import './styles-v4.css';",
      "import './styles/v4-primitives.css';",
      "import './styles/v4-shell.css';",
    ];
    let previous = -1;
    for (const stylesheetImport of imports) {
      const index = main.indexOf(stylesheetImport);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
  });

  it('declares the complete Light and Dark base/raised/floating hierarchy', () => {
    for (const [name, light, dark] of [
      ['surface-shell', '#f4f6f8', '#090d12'],
      ['surface-base', '#f4f6f8', '#0d1218'],
      ['surface-raised', '#ffffff', '#151c24'],
      ['surface-floating', '#ffffff', '#1b2530'],
      ['surface-disabled', '#f1f5f9', '#111820'],
      ['text-primary', '#111827', '#f1f5f9'],
      ['text-secondary', '#334155', '#cbd5e1'],
      ['text-muted', '#64748b', '#94a3b8'],
      ['text-disabled', '#94a3b8', '#64748b'],
      ['border-subtle', '#e5eaf0', '#27313b'],
      ['border-control', '#cbd5e1', '#364250'],
      ['border-strong', '#94a3b8', '#526173'],
    ] as const) {
      expect(tokens).toContain(`--v4-${name}: ${light}`);
      expect(tokens).toContain(`--v4-${name}: ${dark}`);
    }
    expect(tokens).toContain('--v4-canvas: var(--v4-surface-base)');
    expect(tokens).toContain('--v4-surface: var(--v4-surface-raised)');
    expect(tokens).toContain('--v4-surface-elevated: var(--v4-surface-floating)');
    expect(tokens).toContain('--v4-border: var(--v4-border-subtle)');
  });

  it('keeps the Phase 3B motion timing authority exact', () => {
    expect(tokens).toContain('--v4-duration-fast: 140ms');
    expect(tokens).toContain('--v4-duration-standard: 180ms');
    expect(tokens).toContain('--v4-duration-workspace: 210ms');
    expect(legacy).toContain(':root.v4-reduced-motion');
    expect(legacy).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('Phase 3C contrast authority', () => {
  it.each([
    ['Light primary', '#111827', '#f4f6f8'],
    ['Light secondary', '#334155', '#f4f6f8'],
    ['Light muted on raised', '#64748b', '#ffffff'],
    ['Dark primary', '#f1f5f9', '#0d1218'],
    ['Dark secondary', '#cbd5e1', '#0d1218'],
    ['Dark muted', '#94a3b8', '#0d1218'],
  ])('%s text meets normal-text contrast', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['#2f7379', '#006e75', '#2563eb', '#7e22ce', '#c2410c', '#dc2626', '#475569'])(
    '%s filled action remains readable with white text',
    (background) => expect(contrast('#ffffff', background)).toBeGreaterThanOrEqual(4.5),
  );

  it.each([
    ['Light info', '#1d4ed8', '#eff6ff'],
    ['Light success', '#15803d', '#f0fdf4'],
    ['Light warning', '#92400e', '#fffbeb'],
    ['Light critical', '#b91c1c', '#fef2f2'],
    ['Dark info', '#93c5fd', '#172554'],
    ['Dark success', '#86efac', '#11351f'],
    ['Dark warning', '#fcd34d', '#3b2a0d'],
    ['Dark critical', '#fca5a5', '#3f171b'],
  ])('%s status foreground meets normal-text contrast', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Phase 3C shared visual contracts', () => {
  it('defines button, field, status, row, toolbar, Inspector and state-panel families', () => {
    for (const selector of [
      '.v4-button',
      '.v4-field',
      '.v4-status-pill',
      '.v4-row',
      '.v4-toolbar',
      '.v4-inspector',
      '.v4-state-panel',
    ])
      expect(primitives).toContain(selector);
  });

  it('keeps authored V4 text at or above the 10px caption floor', () => {
    expect(`${legacy}\n${primitives}\n${shell}`).not.toMatch(/font-size:\s*(?:8|8\.5|9|9\.5)px/);
  });

  it('keeps focus visible distinct and supports the 1080 containment contract', () => {
    expect(primitives).toContain(':focus-visible');
    expect(primitives).toContain('box-shadow: var(--v4-focus-shadow)');
    expect(shell).toContain('@media (max-width: 1180px)');
    expect(shell).toContain('grid-template-columns:');
    expect(shell).toContain('minmax(82px, 0.72fr)');
    expect(shell).toContain('minmax(106px, 1fr)');
  });

  it('gives Sidebar, Project Header and Work Session theme-correct shared surfaces', () => {
    expect(shell).toContain('--v4-sidebar-bg: var(--v4-surface-raised)');
    expect(shell).toContain('--v4-sidebar-bg: var(--v4-surface-shell)');
    expect(shell).toMatch(/\.v4-pch \{[\s\S]*?border-radius: var\(--v4-radius-floating\)/);
    expect(shell).toMatch(
      /\.v4-work-session-tray \{[\s\S]*?background: var\(--v4-surface-floating\)/,
    );
    expect(shell).toContain('backdrop-filter: none');
  });

  it('retains semantic icons in legacy title bands and the approved text-only Contacts header', () => {
    const contacts = readFileSync(
      resolve(here, './pages/project-contacts/FinalContactsView.tsx'),
      'utf8',
    );
    expect(contacts).toMatch(/<h1[^>]*>\s*Contacts\s*<\/h1>/);
    for (const [file, title] of [
      ['FinalDashboardView.tsx', 'Dashboard'],
      ['FinalProjectsView.tsx', 'Projects'],
      ['FinalNewProjectModal.tsx', 'New Project'],
    ]) {
      expect(readFileSync(resolve(here, './components/final-ui', file!), 'utf8')).toMatch(
        new RegExp(`<h1[^>]*>\\s*${title}\\s*</h1>`),
      );
    }
    const pages = [
      'dashboard/LegacyDashboardPage.tsx',
      'new-project/LegacyNewProjectPage.tsx',
      'project-actions/ProjectActionsWorkspace.tsx',
      'project-meetings/ProjectMeetingsWorkspace.tsx',
      'project-packages/ProjectPackagesWorkspace.tsx',
      'workflow-timeline/LegacyWorkflowTimelinePage.tsx',
      'projects/ProjectsWorkspaceController.tsx',
      'project-summary/ProjectSummaryPage.tsx',
      'project-files/ProjectFilesPage.tsx',
      'project-revisions/ProjectRevisionsWorkspace.tsx',
      'project-scope/ProjectScopeWorkspace.tsx',
      'settings/SettingsWorkspace.tsx',
      'project-comments/ProjectCommentsWorkspace.tsx',
      'technical-check/ProjectTechnicalCheckWorkspace.tsx',
      'project-luminaires/ProjectLuminairesWorkspace.tsx',
      'luminaire-schedule/ProjectLuminaireScheduleWorkspace.tsx',
      'technical-boq/ProjectTechnicalBoqWorkspace.tsx',
      'datasheets-images/ProjectDatasheetsWorkspace.tsx',
    ];
    for (const page of pages) {
      const source = readFileSync(resolve(here, './pages', page), 'utf8');
      const header = source.match(/<V4PageHeader[\s\S]*?\/>/)?.[0];
      expect(header, page).toContain('icon=');
    }
  });
});

describe('Phase 3C owner visual hardening contracts', () => {
  it('uses user Accent/Action authority for selected controls instead of semantic info blue', () => {
    for (const selector of [
      ".v4-comments__primary-filters > button[aria-pressed='true']",
      ".v4-comments__composer-author button[aria-pressed='true']",
      ".v4-comments__origin-choice button[aria-pressed='true']",
      ".v4-luminaires__import-source button[aria-pressed='true']",
      '.v4-timeline__filter--active',
    ]) {
      const start = legacy.indexOf(selector);
      expect(start, selector).toBeGreaterThan(-1);
      const block = legacy.slice(start, legacy.indexOf('}', start) + 1);
      expect(block, selector).toContain('var(--v4-action-primary)');
      expect(block, selector).not.toContain('var(--v4-info)');
    }
  });

  it('keeps primary project collections free of internal vertical scroll', () => {
    for (const selector of [
      '.v4-schedule__table-scroll',
      '.v4-technical-check__table-scroll',
      '.v4-luminaires__table-scroll',
      '.v4-actions__table-wrap',
      '.v4-meetings__collection',
      '.v4-packages__table-scroll',
      '.v4-files__list',
      '.v4-revisions__table-scroll',
    ]) {
      const start = legacy.indexOf(selector);
      expect(start, selector).toBeGreaterThan(-1);
      const block = legacy.slice(start, legacy.indexOf('}', start) + 1);
      expect(block, selector).not.toMatch(/overflow(?:-y)?:\s*(?:auto|scroll)/);
    }
    expect(legacy).toMatch(/\.v4-technical-check__inspector-scroll\s*\{[^}]*overflow-y:\s*auto/s);
    expect(legacy).toMatch(/\.v4-files__inspector\s*\{[^}]*overflow:\s*auto/s);
  });
});
