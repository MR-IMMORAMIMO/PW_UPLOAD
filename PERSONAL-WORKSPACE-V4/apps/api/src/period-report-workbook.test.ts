import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { PeriodActivityReport } from '@scli/domain';
import { buildPeriodReportWorkbook } from './period-report-workbook';

describe('period report workbook', () => {
  it('builds a readable branded report without any pricing columns', async () => {
    const report: PeriodActivityReport = {
      from: '2026-08-01',
      to: '2026-08-02',
      generatedAt: '2026-08-02T10:00:00.000Z',
      projectsWorkedOn: 1,
      newProjects: 1,
      completedProjects: 0,
      activeAtEnd: 1,
      waitingAtEnd: 0,
      onHoldAtEnd: 0,
      cancelledProjects: 0,
      reopenedProjects: 0,
      revisionsCreated: 1,
      packagesCreated: 1,
      deliverablesCompleted: 2,
      bySales: [{ label: 'Maya Hassan', value: 1 }],
      byStatus: [{ label: 'In Progress', value: 1 }],
      projects: [
        {
          projectId: 'project-1',
          projectCode: '001_SCLI260801_QA',
          projectName: 'QA Villa Lighting',
          clientName: 'QA Client',
          salesOwnerId: 'sales-1',
          salesOwnerName: 'Maya Hassan',
          statusAtPeriodEnd: 'InProgress',
          workedOn: true,
          createdInPeriod: true,
          completedInPeriod: false,
          cancelledInPeriod: false,
          reopenedInPeriod: false,
          revisionCount: 1,
          packageCount: 1,
          activityCount: 4,
          cancellationReason: '',
          lastActivityAt: '2026-08-02T09:30:00.000Z',
        },
      ],
    };

    const bytes = await buildPeriodReportWorkbook(report);
    const testFolder = mkdtempSync(path.join(tmpdir(), 'scli-period-workbook-'));
    const workbookPath = path.join(testFolder, 'Activity Report.xlsx');
    writeFileSync(workbookPath, bytes);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    rmSync(testFolder, { recursive: true, force: true });
    const sheet = workbook.getWorksheet('Activity Report')!;
    const rawHeaderValues = sheet.getRow(9).values;
    const headerValues = Array.isArray(rawHeaderValues)
      ? rawHeaderValues
      : Object.values(rawHeaderValues);

    expect(workbook.creator).toBe('Scientechnic');
    expect(sheet.getCell('A1').value).toBe('SCIENTECHNIC · SCT WORKSPACE · PERIOD ACTIVITY REPORT');
    expect(sheet.getCell('A2').value).toContain('01 Aug 2026 to 02 Aug 2026 · Generated');
    expect(sheet.getCell('A5').value).toBe(1);
    expect(headerValues).toContain('Project Code');
    expect(sheet.getRow(10).values).toContain('QA Villa Lighting');
    expect(sheet.autoFilter).toBe('A9:R9');
    expect(sheet.pageSetup.orientation).toBe('landscape');
    expect(sheet.headerFooter.oddFooter).toContain('SCT Workspace');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 9 });
    expect(headerValues.join(' ').toLowerCase()).not.toMatch(/price|cost|rate|amount/);
  });
});
