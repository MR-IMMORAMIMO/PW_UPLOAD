/** @vitest-environment node */
/**
 * H7-R2 structural CSS-contract regression tests (owner-approved narrow policy).
 *
 * jsdom does not load the V4 stylesheet, so the runtime visual contracts are
 * enforced here by asserting the authored CSS rules directly. These protect
 * the SIX owner-visible runtime defects as structural contracts (not subjective
 * visual beauty), matching the H7-R2 testing governance:
 *
 *   A. Toggle hit-target center uses seam-centering geometry (`translateY(-50%)`
 *      on top, not a top-edge anchor), so the 32px control center = seam.
 *   B. Global Minimal primary nav has an explicit single vertical-column layout.
 *   C. Metadata `dt/dd` margin reset / exact left-origin contract.
 *   D. Due Date has a meaningful minimum track.
 *   E. Project top-zone token is shared across Extended/Minimal Project.
 *   F. The Sidebar shell is the single width authority (width + transition).
 *   G. No mode-specific instantaneous flex-basis width authority remains.
 *   H. Reduced motion disables the shell width transition.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = [
  readFileSync(resolve(here, './styles/v4-tokens.css'), 'utf8'),
  readFileSync(resolve(here, './styles-v4.css'), 'utf8'),
  readFileSync(resolve(here, './styles/v4-primitives.css'), 'utf8'),
  readFileSync(resolve(here, './styles/v4-shell.css'), 'utf8'),
].join('\n');
const actionsPage = readFileSync(
  resolve(here, './pages/project-actions/ProjectActionsWorkspace.tsx'),
  'utf8',
);
const actionDrawer = readFileSync(
  resolve(here, './pages/project-actions/ActionDrawer.tsx'),
  'utf8',
);
const technicalCheckPage = readFileSync(
  resolve(here, './pages/technical-check/ProjectTechnicalCheckWorkspace.tsx'),
  'utf8',
);
const technicalVerificationWorkspace = readFileSync(
  resolve(here, './pages/technical-check/TechnicalVerificationWorkspace.tsx'),
  'utf8',
);

function actionsDeclarationBlocks(stylesheet: string): string {
  const blocks: string[] = [];
  for (const match of stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1];
    const declarations = match[2];
    if (selector?.includes('.v4-actions') && declarations !== undefined)
      blocks.push(`${selector}{${declarations}}`);
  }
  return blocks.join('\n');
}

function v4ReferencesWithoutFallback(stylesheet: string): string[] {
  const references = new Set<string>();
  for (const match of stylesheet.matchAll(/var\(\s*(--v4-[a-z0-9-]+)\s*(,)?/gi)) {
    const token = match[1];
    if (token !== undefined && match[2] === undefined) references.add(token);
  }
  return [...references].sort();
}

function definedV4Tokens(stylesheet: string): Set<string> {
  const definitions = new Set<string>();
  for (const match of stylesheet.matchAll(/^\s*(--v4-[a-z0-9-]+)\s*:/gim)) {
    const token = match[1];
    if (token !== undefined) definitions.add(token);
  }
  return definitions;
}

describe('H7-R2 sidebar/header CSS contracts', () => {
  // A. Toggle seam-center geometry
  it('A: edge toggle centers its 32px hit target on the top/nav seam', () => {
    // `top` anchors the seam line; `translateY(-50%)` pulls the control up so
    // its midpoint (and the inner circle's center) land exactly on the seam.
    const block = css.match(/\.v4-sidebar-edge-toggle \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('top: var(--v4-sidebar-top-height, 0px)');
    expect(block).toContain('translateY(-50%)');
    expect(block).toContain('width: 32px');
    expect(block).toContain('height: 32px');
  });

  // B. Global Minimal explicit vertical column
  it('B: Global primary nav is an explicit single vertical column', () => {
    const block = css.match(/\.v4-sidebar__global-list \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('display: flex');
    expect(block).toContain('flex-direction: column');
    expect(block).toContain('align-items: stretch');
  });

  // C. Metadata dt/dd margin reset / exact left-origin
  it('C: pch label and value reset browser margins to align on one left origin', () => {
    const block = css.match(/\.v4-pch__label,\s*\n\.v4-pch__value \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('margin: 0');
    // The field is a left-aligned column so both label and value start at X=0.
    const field = css.match(/\.v4-pch__field \{[^}]*\}/)?.[0] ?? '';
    expect(field).toContain('align-items: flex-start');
  });

  // D. Due Date meaningful minimum track
  it('D: Due Date column carries a meaningful minimum track', () => {
    const fields = css.match(/\.v4-pch__fields \{[^}]*\}/)?.[0] ?? '';
    // Sixth (last) track = Due Date.
    const tracks = fields.match(/minmax\((\d+)px/g) ?? [];
    expect(tracks.length).toBe(6);
    const dueTrack = tracks[5];
    expect(dueTrack).toBeTruthy();
    const due = Number(dueTrack?.match(/(\d+)/)?.[1]);
    expect(due).toBeGreaterThanOrEqual(128);
  });

  // E. Project top-zone shared across modes
  it('E: Project top-zone height is a single shared shell token', () => {
    // The project token is defined once on the shell (not per mode).
    const project = css.match(/\.v4-sidebar-shell\[data-context='project'\] \{[^}]*\}/)?.[0] ?? '';
    expect(project).toContain('--v4-sidebar-top-height');
    // Only `data-context` selectors set the top height — no `data-mode`
    // selector couples mode to a different top-zone height.
    const dataModeBlocks = css.match(/\[data-mode=[^\]]+\] \{[^}]*\}/g) ?? [];
    for (const block of dataModeBlocks) {
      expect(block).not.toContain('--v4-sidebar-top-height');
    }
  });

  // F. Sidebar shell is the single width authority
  it('F: the sidebar shell owns the animated width; inner surface is width:100%', () => {
    const shell = css.match(/\.v4-sidebar-shell \{[^}]*\}/)?.[0] ?? '';
    expect(shell).toContain('width: var(--v4-sidebar-width, 272px)');
    expect(shell).toContain('transition: width 210ms');
    const aside = css.match(/\.v4-sidebar \{[^}]*\}/)?.[0] ?? '';
    expect(aside).toContain('width: 100%');
    // The inner surface no longer carries the width transition.
    expect(aside).not.toMatch(/transition:\s*width/);
  });

  // G. No mode-specific instantaneous flex-basis width authority
  it('G: no mode-specific instantaneous flex-basis remains for the rail track', () => {
    expect(css).not.toMatch(/flex:\s*0\s*0\s*272px/);
    expect(css).not.toMatch(/flex:\s*0\s*0\s*76px/);
  });

  // H. Reduced motion disables the shell width transition
  it('H: reduced motion disables the shell width transition', () => {
    expect(css).toMatch(/:root\.v4-reduced-motion \.v4-sidebar-shell \{\s*transition: none;\s*\}/);
  });
});

describe('H8 sidebar polish CSS contracts', () => {
  // 1. Extended group connector is a soft curved branched tree (not a harsh
  //    straight 1px line).
  it('1: Extended group connector uses a curved SVG branch tile', () => {
    const block = css.match(/\.v4-sidebar__group-items::before \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('background-image: url("data:image/svg+xml');
    expect(block).toContain('background-repeat: repeat-y');
    // The SVG carries a curved branch path (Q command) + rounded caps.
    expect(block).toMatch(/stroke-linecap='round'/);
    expect(block).toMatch(/Q6 20 8 20/);
  });

  // 2. Flyout no longer renders a parent-group title/header.
  it('2: flyout title rule is removed (no repeated parent group header)', () => {
    expect(css).not.toMatch(/\.v4-minimal-flyout__title/);
  });

  // 3. Footer utility (Settings) icon stays in a fixed left slot in both modes.
  it('3: footer utility rows keep a stable left-aligned icon slot', () => {
    const block = css.match(/\.v4-sidebar__footer \.v4-nav-item \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('justify-content: flex-start');
    expect(block).toContain('padding: 0 var(--v4-space-3)');
  });
});

describe('V4-DS1 bounded-page CSS contracts', () => {
  it('preserves the shell viewport owner and exposes a reusable desktop bounded-page contract', () => {
    const shell = css.match(/\.v4-shell \{[^}]*\}/)?.[0] ?? '';
    const content = css.match(/\.v4-shell__content--bounded \{[^}]*\}/)?.[0] ?? '';
    const page =
      css.match(/\.v4-shell__page--bounded,\s*\n\s*\.v4-bounded-page \{[^}]*\}/)?.[0] ?? '';

    expect(shell).toContain('height: 100dvh');
    expect(content).toContain('min-height: 0');
    expect(content).toContain('overflow: hidden');
    expect(page).toContain('height: 100%');
    expect(page).toContain('min-height: 0');
    expect(css).not.toContain(':has(.v4-scope)');
  });

  it('keeps the narrow escape hatch reachable with normal scrolling', () => {
    expect(css).toMatch(
      /@media \(max-width: 1180px\) \{[\s\S]*?\.v4-shell__content--bounded \{\s*overflow: auto;[\s\S]*?\.v4-bounded-page \{\s*height: auto;/,
    );
  });
});

describe('V4-DS1 Scope primitive collision boundaries', () => {
  it('keeps the Scope content selector from matching the shared status pill', () => {
    const selector = css.match(/\.v4-scope__scope-list > li > span[^{]+\{/)?.[0] ?? '';
    expect(selector).toContain(':not(.v4-status-pill)');
  });

  it('keeps deliverable and requirement content layouts from matching the shared trailing slot', () => {
    const selectors =
      css.match(
        /\.v4-scope__deliverable-list li > div:not\(\.v4-row-trailing\),\s*\n\.v4-scope__requirement-list li > div:not\(\.v4-row-trailing\) \{/,
      )?.[0] ?? '';
    expect(selectors).toContain('v4-scope__deliverable-list');
    expect(selectors).toContain('v4-scope__requirement-list');
  });

  it('keeps supporting-text selectors from overriding the shared status pill colors', () => {
    const selectors =
      css.match(
        /\.v4-scope__deliverable-list span:not\(\.v4-scope__status\):not\(\.v4-status-pill\),\s*\n\.v4-scope__requirement-list span:not\(\.v4-scope__status\):not\(\.v4-status-pill\) \{/,
      )?.[0] ?? '';
    expect(selectors).toContain('v4-scope__deliverable-list');
    expect(selectors).toContain('v4-scope__requirement-list');
  });
});

describe('V4-DS1 shared form and table contracts', () => {
  it('keeps the shared project-edit form and controls width-contained in the floating workspace', () => {
    const form = css.match(/\.v4-project-edit \{[^}]*\}/)?.[0] ?? '';
    const fields = css.match(/\.v4-project-edit__fields \{[^}]*\}/)?.[0] ?? '';
    const controls =
      css.match(
        /\.v4-project-edit input,\s*\n\.v4-project-edit select,\s*\n\.v4-project-edit textarea \{[^}]*\}/,
      )?.[0] ?? '';

    expect(form).toContain('width: 100%');
    expect(form).toContain('max-width: 100%');
    expect(form).toContain('min-width: 0');
    expect(fields).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(controls).toContain('width: 100%');
    expect(controls).toContain('max-width: 100%');
    expect(controls).toContain('min-width: 0');
    expect(controls).toContain('box-sizing: border-box');
  });

  it('keeps the floating Edit workspace horizontally contained at a 1080px viewport', () => {
    const workspace = css.match(/\.v4-floating-workspace \{[^}]*\}/)?.[0] ?? '';
    const body = css.match(/\.v4-floating-workspace__body \{[^}]*\}/)?.[0] ?? '';
    expect(workspace).toContain('width: min(1480px, calc(100vw - clamp(24px, 4vw, 56px)))');
    expect(workspace).toContain('min-width: 0');
    expect(workspace).toContain('overflow: hidden');
    expect(body).toContain('overflow-x: hidden');
    expect(css).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.v4-project-edit \{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
    );
  });

  it('defines the shared table, state, density, and pagination grammar for future pages', () => {
    const table = css.match(/\.v4-table \{[^}]*\}/)?.[0] ?? '';
    const cells = css.match(/\.v4-table th,\s*\n\.v4-table td \{[^}]*\}/)?.[0] ?? '';

    expect(table).toContain('width: 100%');
    expect(table).toContain('border-collapse: collapse');
    expect(cells).toContain('padding: var(--v4-space-3)');
    expect(css).toContain('.v4-row--compact');
    expect(css).toContain('.v4-row--standard');
    expect(css).toContain('.v4-row--rich');
    expect(css).toContain(".v4-table [data-selected='true']");
    expect(css).toContain('.v4-state');
    expect(css).toContain('.v4-pagination');
  });
});

describe('ACTIONS-A1 bounded, responsive and tokenized structural contracts', () => {
  it('defines every Actions V4 custom-property reference that has no explicit fallback', () => {
    const actionsCss = actionsDeclarationBlocks(css);
    const references = v4ReferencesWithoutFallback(actionsCss);
    const definitions = definedV4Tokens(css);
    const undefinedTokens = references.filter((token) => !definitions.has(token));

    expect(actionsCss).not.toBe('');
    expect(references).toContain('--v4-border');
    expect(v4ReferencesWithoutFallback('color: var(--v4-fallback-probe, inherit);')).toEqual([]);
    expect(
      undefinedTokens,
      `Undefined Actions V4 tokens: ${undefinedTokens.join(', ') || 'none'}`,
    ).toEqual([]);
  });

  it('keeps Actions inside the shared bounded page and one extracted shared Drawer', () => {
    const block = css.match(/\.v4-actions \{[^}]*\}/)?.[0] ?? '';
    expect(actionsPage).toMatch(/<V4AppShell[\s\S]*?boundedPage/);
    expect(actionsPage).toContain('<ActionDrawer');
    expect(actionDrawer.match(/<V4Drawer/g)).toHaveLength(1);
    expect(block).toContain('min-height: 0');
    expect(block).toContain('height: 100%');
    expect(block).not.toMatch(/100d?vh/);
    expect(block).not.toMatch(/overflow-x/);
  });

  it('keeps Linked Meetings bounded inside the Action Inspector', () => {
    const expanded = css.match(/\.v4-actions__linked-meeting-list--expanded \{[^}]*\}/)?.[0] ?? '';
    const detailsIndex = actionsPage.indexOf('<strong>Details</strong>');
    const linkedIndex = actionsPage.indexOf("'Linked Meetings'");
    const notesIndex = actionsPage.indexOf('<strong>Notes</strong>');
    expect(detailsIndex).toBeGreaterThan(-1);
    expect(linkedIndex).toBeGreaterThan(detailsIndex);
    expect(notesIndex).toBeGreaterThan(linkedIndex);
    expect(expanded).toContain('max-height: 240px');
    expect(expanded).toContain('overflow-y: auto');
    expect(css).toContain('.v4-actions__linked-meeting-row');
  });

  it('contains Action-side Meeting management without horizontal overflow', () => {
    const section = css.match(/\.v4-actions__linked-meetings \{[^}]*\}/)?.[0] ?? '';
    const picker = css.match(/\.v4-actions__meeting-picker,[\s\S]*?\{[^}]*\}/)?.[0] ?? '';
    const candidates = css.match(/\.v4-actions__meeting-candidates \{[^}]*\}/)?.[0] ?? '';
    expect(section).toContain('min-width: 0');
    expect(section).toContain('overflow-x: hidden');
    expect(picker).toContain('overflow-x: hidden');
    expect(candidates).toContain('max-height: 240px');
    expect(candidates).toContain('overflow-y: auto');
    expect(css).toMatch(
      /@media \(max-width: 650px\)[\s\S]*?\.v4-actions__meeting-picker-controls \{[\s\S]*?flex-direction: column/,
    );
  });

  it('keeps KPI and collection in a main column, opening the desktop Inspector in a sibling right-side track', () => {
    const workspace = css.match(/\.v4-actions__workspace \{[^}]*\}/)?.[0] ?? '';
    const tableWrap = css.match(/\.v4-actions__table-wrap \{[^}]*\}/)?.[0] ?? '';
    const collection = css.match(/\.v4-actions__collection \{[^}]*\}/)?.[0] ?? '';
    const inspector = css.match(/\.v4-actions__inspector \{[^}]*overflow: auto;[^}]*\}/)?.[0] ?? '';
    const openWorkspace = css.match(/\.v4-actions__workspace--inspector-open \{[^}]*\}/)?.[0] ?? '';
    expect(actionsPage).toMatch(
      /v4-actions__workspace[\s\S]*?v4-actions__main[\s\S]*?v4-actions__kpis/,
    );
    expect(actionsPage).toMatch(
      /v4-actions__main[\s\S]*?v4-actions__collection[\s\S]*?\{selected \?/,
    );
    expect(openWorkspace).toContain(
      'grid-template-columns: minmax(0, 1fr) clamp(360px, 27vw, 380px)',
    );
    expect(workspace).toContain('min-height: 0');
    expect(tableWrap).toContain('overflow-x: auto');
    expect(tableWrap).toContain('overflow-y: visible');
    expect(collection).toContain('overflow: hidden');
    expect(inspector).toContain('overflow: auto');
  });

  it('keeps toolbar tracks filled, container-responsive and free of horizontal toolbar scrolling', () => {
    const toolbar =
      css.match(/\.v4-actions__toolbar \{[^}]*--v4-actions-toolbar-tracks:[^}]*\}/)?.[0] ?? '';
    expect(toolbar).toContain('max-content');
    expect(toolbar).toContain('32px');
    expect(toolbar).toContain('minmax(0, 29fr)');
    expect(toolbar).toContain('minmax(0, 14fr)');
    expect(toolbar).toContain('minmax(0, 8fr)');
    expect(toolbar).not.toMatch(/minmax\((?:80|86|95|100|105|155)px/);
    expect(css).toMatch(/\.v4-actions__toolbar-add \{[^}]*min-width: max-content/);
    expect(css).toMatch(/container-name: v4-actions-collection/);
    expect(css).toMatch(/@container v4-actions-collection \(max-width: 1120px\)/);
    expect(css).toMatch(/@container v4-actions-collection \(max-width: 680px\)/);
    expect(css).not.toMatch(/\.v4-actions__toolbar\s*\{[^}]*overflow-x:\s*(?:auto|scroll)/);
    expect(actionsPage).toMatch(/v4-actions__toolbar[\s\S]*?v4-actions__toolbar-add/);
    expect(actionsPage).toMatch(/v4-actions__row-menu[\s\S]*?MoreHorizontal/);
  });

  it('keeps the mapped filter tracks readable without changing their approved order', () => {
    const priority = css.match(/\.v4-actions__filter--priority \{[^}]*\}/g)?.join('\n') ?? '';
    expect(actionsPage).toMatch(
      /v4-actions__filter v4-actions__filter--priority[\s\S]*?label="Priority"/,
    );
    expect(priority).toContain('gap: 4px');
    expect(priority).toContain('padding-inline: 5px');
    expect(css).toMatch(/\.v4-actions__toolbar > \.v4-actions__search,[\s\S]*?width: 100%/);
  });

  it('uses a V4-owned themed listbox for filter popup surfaces rather than native toolbar selects', () => {
    expect(actionsPage).toContain('import { V4FilterSelect }');
    expect(actionsPage.match(/<V4FilterSelect/g)).toHaveLength(8);
    expect(css).toMatch(
      /\.v4-filter-select__menu \{[\s\S]*?background: var\(--v4-surface-elevated\)/,
    );
    expect(css).toMatch(/\.v4-actions__table-wrap > table \{[\s\S]*?min-width: 920px/);
    expect(css).toMatch(/\.v4-actions__collection \{[\s\S]*?flex: 1 1 0/);
  });

  it('keeps the inspector title and accessible close control in a fixed first row above one Status control', () => {
    const titleRow = css.match(/\.v4-actions__inspector-title-row \{[^}]*\}/)?.[0] ?? '';
    expect(titleRow).toContain('grid-template-columns: minmax(0, 1fr) 30px');
    expect(titleRow).toContain('min-width: 0');
    expect(css).toMatch(
      /\.v4-actions__inspector-title-row \.v4-actions__close \{\s*justify-self: end;/,
    );
    expect(actionsPage).toMatch(
      /<header>[\s\S]*?v4-actions__inspector-title-row[\s\S]*?Close action details[\s\S]*?v4-actions__inspector-status[\s\S]*?<V4FilterSelect[\s\S]*?variant="status"[\s\S]*?label="Status"/,
    );
    expect(actionsPage.match(/v4-actions__inspector-status/g)).toHaveLength(1);
    expect(actionsPage).not.toMatch(/v4-actions__inspector-status[\s\S]*?<select/);
  });

  it('reflows the toolbar before filter text is forced into an ellipsis and keeps Drawer Cancel secondary', () => {
    const reflow =
      css.match(/@container v4-actions-collection \(max-width: 1120px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    const drawerCancel =
      css.match(/\.v4-actions__drawer-footer \.v4-actions__secondary \{[^}]*\}/)?.[0] ?? '';

    expect(reflow).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
    expect(reflow).toContain('grid-column: auto');
    expect(reflow).toContain('display: none');
    expect(css).not.toMatch(/\.v4-actions__toolbar\s*\{[^}]*overflow-x:\s*(?:auto|scroll)/);
    expect(drawerCancel).toContain('border: 1px solid var(--v4-border)');
    expect(drawerCancel).toContain('background: transparent');
  });

  it('keeps semantic Inspector Status and lifecycle Cancel Action on V4-owned treatments', () => {
    expect(css).toMatch(
      /\.v4-filter-select--status \.v4-filter-select__trigger \{[\s\S]*?border-radius: 999px/,
    );
    expect(css).toMatch(/\.v4-filter-select--status \[data-tone='warning'\]/);
    expect(css).toMatch(/\.v4-actions__lifecycle-cancel \{[\s\S]*?color: var\(--v4-danger\)/);
    expect(actionsPage).toContain('Cancel Action');
  });

  it('stacks collection and Inspector at the narrow breakpoint', () => {
    expect(css).toMatch(
      /@media \(max-width: 1060px\) \{[\s\S]*?\.v4-actions__workspace \{\s*grid-template-columns: 1fr;/,
    );
  });

  it('keeps Category manager and picker foreground/background rules tokenized', () => {
    const categoryBlocks =
      css
        .match(/\.v4-actions__(?:category|picker|icon-grid|swatch|manager-row)[^{]*\{[^}]*\}/g)
        ?.join('\n') ?? '';
    expect(categoryBlocks).not.toBe('');
    expect(categoryBlocks).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const value of categoryBlocks.matchAll(/(?:background|color):\s*([^;]+);/g))
      expect(value[1]).toMatch(/var\(|inherit|transparent/);
  });
});

describe('H10 sidebar interaction CSS contracts', () => {
  // Defect 1: NO mode switch re-centers persistent icons. The Minimal mode must
  // not use `justify-content: center` for nav items / group heads.
  it('D1: minimal nav items do NOT switch to center-justification', () => {
    const block = css.match(/\.v4-sidebar--minimal \.v4-nav-item \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('justify-content: flex-start');
    expect(block).not.toMatch(/justify-content:\s*center/);
  });

  it('D1: minimal active tile stays left-anchored (margin 0, not 0 auto)', () => {
    const block = css.match(/\.v4-sidebar--minimal \.v4-nav-item--active \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('margin: 0');
    expect(block).not.toMatch(/margin:\s*0\s+auto/);
  });

  it('D1: project minimal group heads do NOT center-justify', () => {
    const block = css.match(/\.v4-sidebar__minimal-group \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('justify-content: flex-start');
    expect(block).not.toMatch(/justify-content:\s*center/);
  });
});

describe('H11 multi-branch tree CSS contracts', () => {
  it('H11: shared tree connector tokens are defined', () => {
    expect(css).toMatch(/--v4-tree-trunk-width:\s*1px/);
    expect(css).toMatch(/--v4-tree-opacity:\s*0\.1/);
    expect(css).toMatch(/--v4-tree-cap:\s*round/);
  });

  it('H11/H13: minimal multi-branch tree + branch rules exist', () => {
    const tree = css.match(/\.v4-sidebar__minimal-tree \{[^}]*\}/)?.[0] ?? '';
    // H13: the tree is a vertical flex stack of subtree rows (flow-owned lane).
    expect(tree).toContain('display: flex');
    expect(tree).toContain('flex-direction: column');
    const row = css.match(/\.v4-sidebar__minimal-subtree-row \{[^}]*\}/)?.[0] ?? '';
    // Each subtree row pairs one branch with one child row (structural
    // alignment), using the shared tree inset.
    expect(row).toContain('display: flex');
    expect(row).toContain('--v4-tree-inset');
    const branch = css.match(/\.v4-sidebar__minimal-branch \{[^}]*\}/)?.[0] ?? '';
    // One branch tile per child row, using the same curved SVG family as
    // Extended (curved path + rounded cap + restrained opacity).
    expect(branch).toContain('background-image: url("data:image/svg+xml');
    expect(branch).toMatch(/stroke-linecap='round'/);
    expect(branch).toMatch(/A6 6 0 0 1 8 18 L24 18/);
  });

  it('H15: shared branch-reach tokens exist for Minimal and Extended', () => {
    expect(css).toMatch(/--v4-tree-branch-minimal:\s*24px/);
    expect(css).toMatch(/--v4-tree-branch-extended:\s*8px/);
  });

  it('H15: Extended trunk is positioned from the shared inset (not the rail edge)', () => {
    const block = css.match(/\.v4-sidebar__group-items::before \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('left: var(--v4-tree-inset, 24px)');
  });

  it('H14: subtree rows and flyout rows share the subtree-row-height token', () => {
    const row = css.match(/\.v4-sidebar__minimal-subtree-row \{[^}]*\}/)?.[0] ?? '';
    expect(row).toContain('--v4-subtree-row-height');
    const flyoutItem = css.match(/\.v4-minimal-flyout__item \{[^}]*\}/)?.[0] ?? '';
    expect(flyoutItem).toContain('--v4-subtree-row-height');
  });

  it('H14: the rail subtree lane carries NO child label rule', () => {
    // The duplicate in-rail child label presentation is removed entirely.
    expect(css).not.toMatch(/\.v4-sidebar__minimal-row-label/);
  });
});

describe('H12 flyout geometry + identity CSS contracts', () => {
  it('H12: shared tree tokens include the inset + curve radius', () => {
    expect(css).toMatch(/--v4-tree-inset:\s*24px/);
    expect(css).toMatch(/--v4-tree-curve-radius:\s*8px/);
  });

  it('H12: Extended tree consumes the shared inward inset', () => {
    const items = css.match(/\.v4-sidebar__group-items \{[^}]*\}/)?.[0] ?? '';
    expect(items).toContain('--v4-tree-inset');
    expect(items).toContain('padding-left');
  });

  it('H12: Project Minimal identity beacon rules exist', () => {
    const beacon = css.match(/\.v4-sidebar__project-beacon \{[^}]*\}/)?.[0] ?? '';
    expect(beacon).toContain('display: flex');
    const icon = css.match(/\.v4-sidebar__beacon-icon \{[^}]*\}/)?.[0] ?? '';
    expect(icon).toContain('width: 20px');
    const status = css.match(/\.v4-sidebar__beacon-status \{[^}]*\}/)?.[0] ?? '';
    expect(status).toContain('border-radius: 50%');
  });
});

describe('Meetings high-fidelity layout contracts', () => {
  it('uses a wider sibling inspector with fixed desktop section tracks', () => {
    const workspace = css.match(/\.v4-meetings__workspace \{[^}]*\}/)?.[0] ?? '';
    const inspector =
      [...css.matchAll(/\.v4-meetings__inspector \{[^}]*\}/g)]
        .map(([block]) => block)
        .find((block) => block.includes('grid-template-rows')) ?? '';
    expect(workspace).toContain('clamp(420px, 34vw, 520px)');
    expect(inspector).toContain('display: grid');
    expect(inspector).toContain(
      'grid-template-rows: 54px 132px 180px 142px 150px minmax(118px, 1fr)',
    );
    expect(inspector).toContain('overflow: hidden');
  });

  it('protects single-line featured time and the date/content divider grammar', () => {
    const featured = css.match(/\.v4-meetings__featured \{[^}]*\}/)?.[0] ?? '';
    const time = css.match(/\.v4-meetings__featured-time strong \{[^}]*\}/)?.[0] ?? '';
    const body = css.match(/\.v4-meetings__featured-body \{[^}]*\}/)?.[0] ?? '';
    expect(featured).toContain('grid-template-columns: 68px 126px minmax(0, 1fr) auto');
    expect(time).toContain('white-space: nowrap');
    expect(body).toContain('border-left: 1px solid var(--v4-border)');
    expect(css).toContain('.v4-meetings__date-tile');
  });

  it('uses fixed Past-row tracks, two dividers, and compact semantic metrics', () => {
    const row = css.match(/\.v4-meetings__past-row \{[^}]*\}/)?.[0] ?? '';
    const time = css.match(/\.v4-meetings__past-time \{[^}]*\}/)?.[0] ?? '';
    const main =
      [...css.matchAll(/\.v4-meetings__past-main \{[^}]*\}/g)]
        .map(([block]) => block)
        .find((block) => block.includes('padding:')) ?? '';
    const metric = css.match(/\.v4-meetings__past-metric \{[^}]*\}/)?.[0] ?? '';
    expect(row).toContain('grid-template-columns: 58px 108px minmax(0, 1fr) 92px 122px 20px');
    expect(time).toContain('padding: 0 16px');
    expect(main).toContain('padding: 0 18px');
    expect(css).toMatch(
      /\.v4-meetings__past-time,[\s\S]*?\.v4-meetings__past-main \{[\s\S]*?border-left: 1px solid var\(--v4-border\)/,
    );
    expect(metric).toContain('grid-template-columns: 16px minmax(0, 1fr)');
  });

  it('locks inspector date, Linked Actions, and Notes Summary containment', () => {
    const identityDate =
      css.match(/\.v4-meetings__identity > \.v4-meetings__date \{[^}]*\}/)?.[0] ?? '';
    const action = css.match(/\.v4-meetings__linked-actions > div \{[^}]*\}/)?.[0] ?? '';
    const priority = css.match(/\.v4-meetings__linked-actions em \{[^}]*\}/)?.[0] ?? '';
    const note = css.match(/\.v4-meetings__note-summary \{[^}]*\}/)?.[0] ?? '';
    expect(identityDate).toContain('flex: 0 0 66px');
    expect(action).toContain('grid-template-columns: 56px minmax(0, 1fr)');
    expect(priority).toContain('width: 56px');
    expect(css).toContain('.v4-meetings__notes-heading');
    expect(note).toContain('max-height: 82px');
    expect(note).toContain('overflow: hidden');
  });

  it('uses shrink-safe schedule tracks and owns horizontal overflow locally', () => {
    const form = css.match(/\.v4-meetings__form \{[^}]*\}/)?.[0] ?? '';
    const schedule = css.match(/\.v4-meetings__form-grid \{[^}]*\}/)?.[0] ?? '';
    expect(form).toContain('overflow-x: hidden');
    expect(schedule).toContain('repeat(3, minmax(0, 1fr))');
    expect(schedule).toContain('min-width: 0');
  });

  it('uses a large floating editor and compact fixed icon rails', () => {
    const editor = css.match(/\.v4-drawer\.v4-meetings__editor \{[^}]*\}/)?.[0] ?? '';
    const row = css.match(/\.v4-meetings__draft-row \{[^}]*\}/)?.[0] ?? '';
    const agenda = css.match(/\.v4-meetings__agenda-row \{[^}]*\}/)?.[0] ?? '';
    expect(editor).toContain('width: min(900px, calc(100vw - 48px))');
    expect(editor).toContain('height: min(880px, calc(100vh - 48px))');
    expect(row).toContain('34px 34px 34px');
    expect(agenda).toContain('22px minmax(0, 1fr) 34px 34px 34px');
    expect(css).toContain('.v4-meetings__editor .v4-drawer__footer');
  });

  it('provides bounded local overflow and a short-height fallback', () => {
    const subview = css.match(/\.v4-meetings__subview-body \{[^}]*\}/)?.[0] ?? '';
    expect(subview).toContain('overflow: auto');
    expect(css).toContain('@media (max-height: 760px) and (min-width: 1061px)');
    expect(css).toMatch(
      /@media \(max-height: 760px\)[\s\S]*?\.v4-meetings__inspector \{[\s\S]*?overflow-y: auto;/,
    );
  });

  it('contains the linked-Action manager and picker without horizontal overflow', () => {
    const manager = css.match(/\.v4-meetings__actions-manager \{[^}]*\}/)?.[0] ?? '';
    const candidates = css.match(/\.v4-meetings__action-candidates \{[^}]*\}/)?.[0] ?? '';
    expect(manager).toContain('min-width: 0');
    expect(manager).toContain('overflow-x: hidden');
    expect(candidates).toContain('overflow-y: auto');
    expect(css).toMatch(
      /@media \(max-width: 650px\)[\s\S]*?\.v4-meetings__action-controls \{[\s\S]*?flex-direction: column/,
    );
  });
});

describe('Comments reference workspace contracts', () => {
  it('uses the exact three-part toolbar and a dominant thread column', () => {
    const toolbar = css.match(/\.v4-comments__toolbar \{[^}]*\}/)?.[0] ?? '';
    const workspace = css.match(/\.v4-comments__workspace--inspector-open \{[^}]*\}/)?.[0] ?? '';
    expect(toolbar).toContain('grid-template-columns: max-content minmax(220px, 1fr) 38px');
    expect(workspace).toContain('grid-template-columns: minmax(0, 1fr) 340px');
  });

  it('locks the desktop inspector to exactly seven bounded section tracks', () => {
    const inspector = css.match(/\.v4-comments__inspector \{[^}]*\}/)?.[0] ?? '';
    expect(inspector).toContain('display: grid');
    expect(inspector).toContain('grid-template-rows: 44px 106px 92px 156px 168px 106px 48px');
    expect(inspector).toContain('overflow: hidden');
  });

  it('keeps the root list locally scrollable and avoids a squeezed narrow inspector', () => {
    const list = css.match(/\.v4-comments__thread-list \{[^}]*\}/)?.[0] ?? '';
    expect(list).toContain('overflow-y: auto');
    expect(css).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.v4-comments__inspector \{[\s\S]*?position: absolute/,
    );
  });

  it('uses only V4 semantic tokens for Client, Internal, Open, and Resolved treatments', () => {
    expect(css).toMatch(/\.v4-comments__origin\[data-origin='Client'\][\s\S]*?--v4-brand-purple/);
    expect(css).toMatch(/\.v4-comments__status \{[\s\S]*?--v4-info/);
    expect(css).toMatch(/\.v4-comments__status\[data-status='Resolved'\][\s\S]*?--v4-success/);
  });
});

describe('Technical Check reference workspace contracts', () => {
  it('keeps the title/action band above the shared KPI and inspector top edge', () => {
    const workspace = css.match(/\.v4-technical-check__workspace \{[^}]*\}/)?.[0] ?? '';
    const body = css.match(/\.v4-technical-check__body \{[^}]*\}/)?.[0] ?? '';
    const main = css.match(/\.v4-technical-check__main \{[^}]*\}/)?.[0] ?? '';
    expect(workspace).toContain('grid-template-rows: auto minmax(0, 1fr)');
    expect(body).toContain('grid-template-columns: minmax(0, 29fr) minmax(318px, 10.5fr)');
    expect(main).toContain('grid-template-rows: 108px minmax(0, 1fr)');
    expect(technicalCheckPage.indexOf('v4-technical-check__title-band')).toBeLessThan(
      technicalCheckPage.indexOf('v4-technical-check__body'),
    );
  });

  it('keeps table, inspector, and pagination overflow locally bounded', () => {
    const table = css.match(/\.v4-technical-check__table-scroll \{[^}]*\}/)?.[0] ?? '';
    const inspector =
      [...css.matchAll(/\.v4-technical-check__inspector \{[^}]*\}/g)]
        .map(([block]) => block)
        .find((block) => block.includes('height: 100%')) ?? '';
    const inspectorScroll =
      css.match(/\.v4-technical-check__inspector-scroll \{[^}]*\}/)?.[0] ?? '';
    const pagination = css.match(/\.v4-technical-check__pagination \{[^}]*\}/)?.[0] ?? '';
    expect(table).toContain('overflow-x: auto');
    expect(table).toContain('overflow-y: visible');
    expect(inspector).toContain('height: 100%');
    expect(inspector).toContain('overflow: hidden');
    expect(inspectorScroll).toContain('overflow-y: auto');
    expect(pagination).toContain('flex: 0 0 auto');
  });

  it('uses an internal table minimum at intermediate widths and an overlay inspector when narrow', () => {
    const table = css.match(/\.v4-technical-check__table-scroll table \{[^}]*\}/)?.[0] ?? '';
    expect(table).toContain('min-width: 760px');
    expect(css).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.v4-technical-check__inspector \{[\s\S]*?position: fixed/,
    );
  });

  it('keeps the Inspector compact and delegates decisions to the floating verification workspace', () => {
    for (const heading of ['Luminaire Summary', 'Review Actions'])
      expect(technicalCheckPage).toContain(heading);
    expect(technicalCheckPage).toContain('TechnicalVerificationWorkspace');
    expect(technicalCheckPage).not.toContain('v4-technical-check__child-check');
    for (const contract of [
      'Technical Verification —',
      'Show differences only',
      'POSSIBLE WRONG DATASHEET',
      'Open Library Correction Draft',
      'Close Review',
    ])
      expect(technicalVerificationWorkspace).toContain(contract);
    for (const forbidden of ['Mark Reviewed', '>Accept<', '>Dismiss<', '>Approve<', '>Reject<'])
      expect(`${technicalCheckPage}\n${technicalVerificationWorkspace}`).not.toContain(forbidden);
  });
});
