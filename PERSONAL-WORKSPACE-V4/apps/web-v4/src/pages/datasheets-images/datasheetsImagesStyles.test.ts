/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../../styles-v4.css'), 'utf8');

describe('Datasheets & Images bounded reference contract', () => {
  it('keeps the page bounded with a non-scrolling desktop table and an internally scrolling inspector', () => {
    expect(css).toMatch(
      /\.v4-datasheets__workspace\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*hidden;/,
    );
    expect(css).toMatch(
      /\.v4-datasheets__main\s*\{[\s\S]*?grid-area:\s*main;[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /\.v4-datasheets__table-card\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/,
    );
    expect(css).toMatch(
      /\.v4-datasheets__table-scroll\s*\{[\s\S]*?overflow-x:\s*auto;[\s\S]*?overflow-y:\s*hidden;/,
    );
    expect(css).toMatch(/\.v4-datasheets__table-scroll table\s*\{[\s\S]*?min-width:\s*700px;/);
    expect(css).toMatch(/\.v4-datasheets__table-scroll th\s*\{[\s\S]*?position:\s*static;/);
    expect(css).toMatch(/\.v4-datasheets__inspector-scroll\s*\{[\s\S]*?overflow-y:\s*auto;/);
  });

  it('puts the title above both columns and aligns the KPI-table lane with the inspector', () => {
    expect(css).toMatch(
      /\.v4-datasheets__workspace\s*\{[\s\S]*?grid-template-areas:\s*'title title'\s*'main inspector';[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(/\.v4-datasheets__title\s*\{[\s\S]*?grid-area:\s*title;/);
    expect(css).toMatch(/\.v4-datasheets__inspector\s*\{[\s\S]*?grid-area:\s*inspector;/);
    expect(css).toContain('grid-template-columns: minmax(0, 29fr) minmax(330px, 11fr);');
    expect(css).toMatch(
      /@media \(max-width:\s*1160px\)[\s\S]*?\.v4-datasheets__workspace\s*\{[\s\S]*?grid-template-areas:\s*'title'\s*'main'\s*'inspector';[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
  });

  it('keeps four compact rows above bottom-anchored pagination and uses micro status capsules', () => {
    expect(css).toMatch(/\.v4-datasheets__table-scroll td\s*\{[\s\S]*?height:\s*72px;/);
    expect(css).toMatch(
      /\.v4-datasheets__complete-pill,[\s\S]*?\.v4-datasheets__count-pill\s*\{[\s\S]*?height:\s*21px;[\s\S]*?font-size:\s*11px;/,
    );
  });
});
