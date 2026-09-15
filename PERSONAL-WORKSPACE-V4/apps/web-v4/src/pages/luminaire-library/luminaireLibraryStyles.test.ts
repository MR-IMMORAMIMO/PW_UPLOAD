/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, './luminaireLibrary.css'), 'utf8');

describe('Luminaire Library approved Static geometry contract', () => {
  it('preserves the 742px three-column Golden workspace and 10px gutters', () => {
    const layout = css.match(/\.v4-library-static \{[^}]*\}/)?.[0] ?? '';
    expect(layout).toContain('clamp(245px, 18.48%, 289px)');
    expect(layout).toContain('clamp(320px, 24.49%, 383px)');
    expect(layout).toContain('gap: 10px');
    expect(layout).toContain('height: min(742px, calc(100vh - 114px))');
  });

  it('preserves four 84px KPI cards and a 60px filter band', () => {
    const kpis = css.match(/\.v4-library-static__kpis \{[^}]*\}/)?.[0] ?? '';
    const kpi = css.match(/\.v4-library-static__kpi \{[^}]*\}/)?.[0] ?? '';
    const toolbar = css.match(/\.v4-library-static__toolbar \{[^}]*\}/)?.[0] ?? '';
    expect(kpis).toContain('repeat(4, minmax(0, 1fr))');
    expect(kpi).toContain('height: 84px');
    expect(toolbar).toContain('height: 60px');
  });

  it('owns dense table overflow without whole-page transform scaling', () => {
    const scroller = css.match(/\.v4-library-static__table-scroll \{[^}]*\}/)?.[0] ?? '';
    const rows = css.match(/\.v4-library-static__table-card tbody tr \{[^}]*\}/)?.[0] ?? '';
    expect(scroller).toContain('overflow: hidden auto');
    expect(rows).toContain('height: 48px');
    expect(css).not.toMatch(/\.v4-library-static[^}]*transform:\s*scale/);
  });
});
