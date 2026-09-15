/** @vitest-environment node */
/**
 * V4 Global Accent Token Adoption — focused contract tests.
 *
 * These assert that the stylesheet correctly wires non-semantic primary
 * surfaces to the global `--v4-accent` token, while preserving semantic
 * authority (Success, Warning, Danger, Info, KPI differentiated tones,
 * Work Session states, status pills, and scope tag/category colors).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = [
  readFileSync(resolve(here, '../styles/v4-tokens.css'), 'utf8'),
  readFileSync(resolve(here, '../styles-v4.css'), 'utf8'),
  readFileSync(resolve(here, '../styles/v4-primitives.css'), 'utf8'),
  readFileSync(resolve(here, '../styles/v4-shell.css'), 'utf8'),
].join('\n');

function declarationsFor(selector: string): string {
  const blocks: string[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    const selectorList = m[1] ?? '';
    const declarations = m[2] ?? '';
    const selectors = selectorList.split(',').map((s: string) => s.trim().replace(/\r?\n/g, ' '));
    if (selectors.some((s: string) => s === selector || s.endsWith(' ' + selector))) {
      blocks.push(declarations);
    }
  }
  return blocks.join('\n');
}

describe('Global Accent Token Adoption', () => {
  it('uses --v4-accent for Dashboard primary CTA', () => {
    const block = declarationsFor('.v4-dashboard__header-actions .v4-dashboard__new-project');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Dashboard page header icon', () => {
    const block = declarationsFor('.v4-dashboard-page-header .v4-page-header__icon');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Dashboard card title icons', () => {
    const block = declarationsFor('.v4-dashboard-card__title svg');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Dashboard progress bars', () => {
    const block = declarationsFor('.v4-dashboard-projects__progress i b');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Dashboard empty state icon', () => {
    const block = declarationsFor('.v4-dashboard__empty-portfolio > svg');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Projects page header icon', () => {
    const block = declarationsFor('.v4-projects-page-header .v4-page-header__icon');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Projects New button', () => {
    const block = declarationsFor('.v4-projects-new');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for selected view-switcher border', () => {
    const block = declarationsFor(".v4-projects-view-switcher button[aria-pressed='true']");
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Projects empty state icon', () => {
    const block = declarationsFor('.v4-projects-empty > svg');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for table row hover background', () => {
    const block = declarationsFor('.v4-projects-table tbody tr:hover');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for project active session badge background', () => {
    const block = declarationsFor('.v4-project-active-session');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for project progress bar fill', () => {
    const block = declarationsFor('.v4-project-progress > i > b');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for project grid card hover border', () => {
    const block = declarationsFor('.v4-project-grid-card:hover');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for project actions trigger hover', () => {
    const block = declarationsFor('.v4-project-actions__trigger:hover');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for planner scrollbar thumb', () => {
    const block = declarationsFor('.v4-projects-planner__board');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for planner lane drop valid border', () => {
    const block = declarationsFor(".v4-planner-lane[data-drop-state='valid']");
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Scope edit primary buttons', () => {
    const block = declarationsFor('.v4-scope-edit__save');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Scope add icon', () => {
    const block = declarationsFor('.v4-scope__add-icon');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Scope pagination active button', () => {
    const block = declarationsFor('.v4-scope__pagination .v4-scope__page-button--active');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for Scope checkbox accent-color', () => {
    const block = declarationsFor('.v4-scope-edit__check input');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses --v4-accent for active sidebar nav item edge', () => {
    const block = declarationsFor('.v4-nav-item--active .v4-nav-item__edge');
    expect(block).toContain('var(--v4-accent)');
  });

  it('uses accent-soft for active sidebar nav item icon tint', () => {
    const block = declarationsFor('.v4-nav-item--active .v4-nav-item__icon');
    expect(block).toContain('var(--v4-accent-soft');
  });

  it('uses accent-soft for active-child icon tint', () => {
    const block = declarationsFor('.v4-active-child .v4-nav-item__icon');
    expect(block).toContain('var(--v4-accent-soft');
  });

  it('uses --v4-accent for Settings primary save button (via --v4-action-primary alias)', () => {
    const block = declarationsFor('.v4-settings__primary');
    expect(block).toContain('var(--v4-action-primary)');
  });

  it('uses the promoted global focus-ring alias without a Settings-only override', () => {
    const block = declarationsFor('.v4-settings');
    expect(css).toContain('--v4-focus-ring: var(--v4-action-primary)');
    expect(block).not.toContain('--v4-focus-ring:');
  });
});

describe('Semantic Color Preservation', () => {
  it('keeps --v4-success green', () => {
    expect(css).toContain('--v4-success: #22c55e');
  });

  it('keeps --v4-warning amber', () => {
    expect(css).toContain('--v4-warning: #f59e0b');
  });

  it('keeps --v4-danger red', () => {
    expect(css).toContain('--v4-danger: #ef4444');
  });

  it('keeps --v4-info blue', () => {
    expect(css).toContain('--v4-info: #3b82f6');
  });

  it('keeps Work Session Running state green', () => {
    const block = declarationsFor('.v4-dashboard-session__state i');
    expect(block).toContain('var(--v4-success)');
  });

  it('keeps Work Session Paused state amber', () => {
    const block = declarationsFor(".v4-dashboard-session__state[data-state='PAUSED'] i");
    expect(block).toContain('var(--v4-warning)');
  });

  it('keeps KPI differentiated semantic tones', () => {
    const block = declarationsFor('.v4-dashboard-kpi');
    expect(block).toContain('var(--v4-accent)');
    const due = declarationsFor(".v4-dashboard-kpi[data-tone='dueThisWeek']");
    expect(due).toContain('var(--v4-warning)');
    const rev = declarationsFor(".v4-dashboard-kpi[data-tone='revisionRequired']");
    expect(rev).toContain('#805ad5');
    const review = declarationsFor(".v4-dashboard-kpi[data-tone='clientReview']");
    expect(review).toContain('var(--v4-info)');
  });

  it('keeps status pills using semantic colors', () => {
    const block = declarationsFor(".v4-comments__status[data-status='Resolved']");
    expect(block).toContain('var(--v4-success)');
    const accepted = declarationsFor(".v4-comments__status[data-status='Accepted']");
    expect(accepted).toContain('var(--v4-brand-teal)');
    const rejected = declarationsFor(".v4-comments__status[data-status='Rejected']");
    expect(rejected).toContain('var(--v4-danger)');
  });

  it('keeps scope tag semantic teal color intact', () => {
    const block = declarationsFor('.v4-scope__item-icon--teal');
    expect(block).toContain('#479ba2');
  });

  it('keeps scope card icon semantic teal intact', () => {
    const block = declarationsFor('.v4-scope-card__icon--teal');
    expect(block).toContain('#27717a');
  });

  it('keeps Settings card icon semantic teal intact', () => {
    const block = declarationsFor('.v4-settings-card__icon.is-teal');
    expect(block).toContain('var(--v4-brand-teal)');
  });

  it('keeps brand identity chip colors intact', () => {
    const block = declarationsFor('.v4-icon-chip--brandTeal');
    expect(block).toContain('#479ba2');
  });

  it('keeps card header icon brand teal intact', () => {
    const block = declarationsFor('.v4-card__header-icon--brandTeal');
    // Light mode shows a slightly brighter tint; dark mode override restores #479ba2.
    expect(block).toMatch(/#479ba2|#5fa9b0/);
  });
});

describe('Token Default / Fallback', () => {
  it('declares --v4-accent with Brand Teal default', () => {
    const block = declarationsFor(':root');
    expect(block).toContain('--v4-accent: #479ba2');
  });

  it('leaves --v4-brand-teal as an independent constant', () => {
    const block = declarationsFor(':root');
    expect(block).toContain('--v4-brand-teal: #479ba2');
  });
});
