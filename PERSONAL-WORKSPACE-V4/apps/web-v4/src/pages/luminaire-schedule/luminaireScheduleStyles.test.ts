/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../../styles-v4.css'), 'utf8');

describe('Luminaire Schedule style contract', () => {
  it('keeps the locked desktop table and Inspector split in a bounded workspace', () => {
    expect(css).toMatch(
      /\.v4-schedule__page\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*height:\s*100%[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s,
    );
    expect(css).toMatch(
      /\.v4-schedule__workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 29fr\) minmax\(330px, 11fr\)[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s,
    );
    expect(css).toMatch(
      /\.v4-schedule__main-card,\s*\.v4-schedule__inspector\s*\{[^}]*height:\s*100%/s,
    );
    expect(css).toMatch(/\.v4-schedule__main-card\s*\{[^}]*flex-direction:\s*column/s);
    expect(css).toMatch(/\.v4-schedule__inspector\s*\{[^}]*flex-direction:\s*column/s);
  });

  it('contains wide columns inside the Schedule table surface and anchors pagination below it', () => {
    expect(css).toMatch(
      /\.v4-schedule__table-scroll\s*\{[^}]*overflow-x:\s*auto[^}]*overflow-y:\s*visible/s,
    );
    expect(css).toMatch(
      /\.v4-schedule__table-scroll table\s*\{[^}]*width:\s*max-content[^}]*min-width:\s*100%/s,
    );
    expect(css).toMatch(
      /\.v4-schedule__table-scroll\s*\{[^}]*flex:\s*1 1 auto[^}]*overflow-x:\s*auto/s,
    );
    expect(css).toMatch(
      /\.v4-schedule__pagination\s*\{[^}]*grid-template-columns:[^}]*flex:\s*0 0 auto/s,
    );
    expect(css).toMatch(
      /\.v4-schedule__table-scroll th,\s*\.v4-schedule__table-scroll td\s*\{[^}]*height:\s*47px/s,
    );
  });

  it('keeps historical context compact instead of adding a full-width snapshot row', () => {
    expect(css).toMatch(/\.v4-schedule__snapshot-pill\s*\{[^}]*border-radius:\s*999px/s);
    expect(css).not.toMatch(/\.v4-schedule__snapshot-notice\s*\{/);
  });

  it('keeps the disabled Generate Output control visibly primary in the toolbar', () => {
    expect(css).toMatch(
      /\.v4-schedule__generate-anchor > \.v4-schedule__generate\s*\{[^}]*border-color:\s*var\(--v4-accent\)[^}]*background:\s*var\(--v4-accent\)/s,
    );
    expect(css).toMatch(
      /\.v4-schedule__generate-anchor > \.v4-schedule__generate:disabled\s*\{[^}]*opacity:\s*0\.68/s,
    );
  });

  it('stacks the Inspector and toolbar at narrow widths without page-level horizontal overflow', () => {
    expect(css).toMatch(
      /@media \(max-width: 1080px\)[\s\S]*?\.v4-schedule__workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.v4-schedule__toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
  });
});
