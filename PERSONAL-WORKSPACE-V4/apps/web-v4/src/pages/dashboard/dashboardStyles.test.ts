import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles-v4.css'), 'utf8');

describe('Dashboard layout contract', () => {
  it('keeps the KPI cards on one equal-height four-column desktop grid', () => {
    expect(css).toMatch(/\.v4-dashboard-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
    expect(css).toMatch(/\.v4-dashboard-kpi\s*\{[^}]*min-height:\s*108px/s);
  });

  it('uses the approved aligned three-column command grid', () => {
    expect(css).toMatch(/\.v4-dashboard__command-grid\s*\{[^}]*grid-template-columns:/s);
  });

  it('uses bounded overflow without claiming viewport ownership', () => {
    expect(css).toMatch(/\.v4-dashboard\s*\{[^}]*height:\s*100%[^}]*overflow:\s*auto/s);
    expect(css).not.toMatch(/\.v4-dashboard\s*\{[^}]*100(?:d)?vh/s);
  });

  it('switches KPI controls to 2 by 2 at intermediate widths', () => {
    expect(css).toMatch(
      /@media \(max-width: 1040px\)[\s\S]*?\.v4-dashboard-kpis\s*\{[^}]*repeat\(2,/,
    );
  });

  it('stacks dashboard cards and operation groups at intermediate widths', () => {
    expect(css).toMatch(
      /@media \(max-width: 1040px\)[\s\S]*?\.v4-dashboard__command-grid\s*\{[^}]*1fr/s,
    );
    expect(css).toMatch(
      /@media \(max-width: 1040px\)[\s\S]*?\.v4-dashboard-operations__grid\s*\{[^}]*1fr/s,
    );
  });

  it('uses one-column KPI cards at narrow phone width', () => {
    expect(css).toMatch(/@media \(max-width: 520px\)[\s\S]*?\.v4-dashboard-kpis\s*\{[^}]*1fr/s);
  });

  it('provides visible selected, focusable button treatment and reduced motion', () => {
    expect(css).toContain(".v4-dashboard-kpi[aria-pressed='true']");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.v4-dashboard-kpi/);
  });
});
