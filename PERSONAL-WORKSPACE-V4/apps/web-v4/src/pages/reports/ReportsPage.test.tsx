import { describe, expect, it } from 'vitest';
import { activityReportHtml } from './ReportsPage';
import type { PeriodActivityReport } from '@scli/domain';

describe('Activity report document', () => {
  it('escapes project input and includes all rows, not only the visible page', () => {
    const report = {
      from: '2026-09-01',
      to: '2026-09-10',
      projectsWorkedOn: 12,
      revisionsCreated: 3,
      packagesCreated: 2,
      deliverablesCompleted: 1,
      bySales: [{ label: 'A&B', value: 12 }],
      byStatus: [{ label: 'Planning', value: 12 }],
      projects: Array.from({ length: 12 }, (_, i) => ({
        projectCode: `P-${i}`,
        projectName: '<script>alert(1)</script>',
        clientName: 'A&B',
        salesOwnerName: 'Owner',
        statusAtPeriodEnd: 'Planning',
        revisionCount: 1,
        packageCount: 0,
      })),
    } as PeriodActivityReport;
    const html = activityReportHtml(report);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A&amp;B');
    expect(html).toContain('P-11');
  });
});
