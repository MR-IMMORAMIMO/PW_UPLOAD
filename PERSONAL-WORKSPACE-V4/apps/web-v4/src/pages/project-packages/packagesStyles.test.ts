/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../styles-v4.css', import.meta.url), 'utf8');
const start = css.indexOf(
  'Packages — canonical Revision build / validate / local Issue workspace.',
);
const end = css.indexOf('Dashboard — daily operational command center', start);
const packagesCss = css.slice(start, end > start ? end : undefined);

describe('Packages bounded viewport contract', () => {
  it('owns internal scroll without creating a nested viewport', () => {
    expect(start).toBeGreaterThan(-1);
    expect(packagesCss).not.toContain('100vh');
    expect(packagesCss).not.toContain('100dvh');
    expect(packagesCss).toMatch(
      /\.v4-bounded-page\.v4-packages\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s,
    );
    expect(packagesCss).toMatch(/\.v4-packages__builder\s*\{[^}]*overflow:\s*auto/s);
    expect(packagesCss).toMatch(/\.v4-packages__inspector\s*\{[^}]*overflow:\s*auto/s);
  });

  it('keeps the desktop inspector in the approved technical width range', () => {
    expect(packagesCss).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\) 16px minmax\(360px, 390px\)/,
    );
  });

  it('does not introduce document-level horizontal overflow ownership', () => {
    expect(packagesCss).not.toMatch(/overflow-x:\s*(hidden|scroll)/);
  });
});
