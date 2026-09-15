/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../../styles-v4.css'), 'utf8');

describe('V4 Luminaires reference CSS contract', () => {
  it('keeps the desktop schedule and inspector in a bounded sibling composition', () => {
    const workspace = css.match(/\.v4-luminaires__workspace \{[^}]*\}/)?.[0] ?? '';
    const schedule = css.match(/\.v4-luminaires__schedule \{[^}]*\}/)?.[0] ?? '';
    const tableScroll = css.match(/\.v4-luminaires__table-scroll \{[^}]*\}/)?.[0] ?? '';
    const inspector = css.match(/\.v4-luminaires__inspector \{\s*display: flex;[^}]*\}/)?.[0] ?? '';
    expect(workspace).toContain('height: 100%');
    expect(workspace).toContain('grid-template-columns: minmax(0, 3fr) minmax(330px, 1fr)');
    expect(workspace).toContain('overflow: hidden');
    expect(schedule).toContain('flex-direction: column');
    expect(tableScroll).toContain('overflow-x: auto');
    expect(tableScroll).toContain('overflow-y: visible');
    expect(inspector).toContain('flex-direction: column');
  });

  it('keeps pagination visible inside the schedule and the action bar stable at the inspector bottom', () => {
    const pagination = css.match(/\.v4-luminaires__pagination \{[^}]*\}/)?.[0] ?? '';
    const actions = css.match(/\.v4-luminaires__inspector-actions \{[^}]*\}/)?.[0] ?? '';
    expect(pagination).toContain('flex: 0 0 auto');
    expect(pagination).toContain(
      'grid-template-columns: minmax(190px, 1fr) auto minmax(190px, 1fr)',
    );
    expect(actions).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(actions).toContain('flex: 0 0 auto');
  });

  it('contains table horizontal scrolling and stacks the inspector without document horizontal overflow', () => {
    const narrow = css.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(narrow).toContain('.v4-luminaires__workspace');
    expect(narrow).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toMatch(/\.v4-luminaires__table-scroll table \{[^}]*min-width: 1390px;/);
  });

  it('keeps core identity cells sticky and uses only scoped discoverable scrollbars', () => {
    expect(css).toMatch(
      /\.v4-luminaires__table-scroll th:nth-child\(-n \+ 3\),[\s\S]*?position: sticky;/,
    );
    expect(css).toContain('.v4-luminaires__table-scroll::-webkit-scrollbar-thumb');
    expect(css).toContain('height: 9px');
    expect(css).toContain('border-radius: 999px');
    expect(css).not.toMatch(/(^|\n)\*::?-webkit-scrollbar/);
  });
});
