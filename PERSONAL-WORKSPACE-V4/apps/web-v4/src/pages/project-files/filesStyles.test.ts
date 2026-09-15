/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../styles-v4.css', import.meta.url), 'utf8');
const start = css.indexOf('Project Files — mutable working-file register.');
const end = css.indexOf('Dashboard — daily operational command center', start);
const filesCss = css.slice(start, end > start ? end : undefined);

describe('Project Files bounded viewport contract', () => {
  it('paginates the primary list while allowing only inspector detail scroll', () => {
    expect(start).toBeGreaterThan(-1);
    expect(filesCss).not.toContain('100vh');
    expect(filesCss).not.toContain('100dvh');
    expect(filesCss).toMatch(
      /\.v4-files__list\s*\{[^}]*overflow-x:\s*auto[^}]*overflow-y:\s*visible/s,
    );
    expect(filesCss).toMatch(/\.v4-files__inspector\s*\{[^}]*overflow:\s*auto/s);
  });

  it('keeps the desktop inspector in the approved technical width range', () => {
    expect(filesCss).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\) 16px minmax\(340px, 380px\)/,
    );
  });

  it('does not introduce document-level horizontal overflow ownership', () => {
    expect(filesCss).not.toMatch(/overflow-x:\s*(hidden|scroll)/);
  });

  it('stacks only the Files title-band actions at the 1080 usable-width breakpoint', () => {
    expect(filesCss).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*\.v4-files__page-header \.v4-page-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(filesCss).toMatch(
      /\.v4-files__page-header \.v4-page-header__actions\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*auto/s,
    );
  });
});
