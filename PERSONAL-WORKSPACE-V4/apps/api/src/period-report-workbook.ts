import ExcelJS from 'exceljs';
import { statusLabels, type PeriodActivityReport } from '@scli/domain';

const accent = '008C95';
const dark = '173034';
const light = 'EAF5F5';
const muted = '607679';
const readableDate = (value: string | null | undefined, withTime = false) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...(withTime ? ({ hour: '2-digit', minute: '2-digit', hour12: false } as const) : {}),
      }).format(new Date(value))
    : '';

export async function buildPeriodReportWorkbook(report: PeriodActivityReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Scientechnic';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Activity Report', {
    views: [{ state: 'frozen', ySplit: 9 }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });
  sheet.columns = [
    { key: 'code', width: 19 },
    { key: 'project', width: 30 },
    { key: 'client', width: 24 },
    { key: 'sales', width: 22 },
    { key: 'status', width: 22 },
    { key: 'new', width: 11 },
    { key: 'completed', width: 13 },
    { key: 'cancelled', width: 13 },
    { key: 'reopened', width: 12 },
    { key: 'revisions', width: 11 },
    { key: 'packages', width: 11 },
    { key: 'activity', width: 11 },
    { key: 'lastActivity', width: 18 },
    { key: 'reason', width: 30 },
    { key: 'workHours', width: 16 },
    { key: 'sessions', width: 12 },
    { key: 'openSessions', width: 12 },
    { key: 'toolSessions', width: 14 },
  ];
  sheet.mergeCells('A1:R1');
  const title = sheet.getCell('A1');
  title.value = 'SCIENTECHNIC · SCT WORKSPACE · PERIOD ACTIVITY REPORT';
  title.font = { name: 'Montserrat', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${dark}` } };
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 42;
  sheet.mergeCells('A2:R2');
  sheet.getCell('A2').value =
    `${readableDate(report.from)} to ${readableDate(report.to)} · Generated ${readableDate(report.generatedAt)}`;
  sheet.getCell('A2').font = { color: { argb: `FF${muted}` }, size: 10 };
  sheet.getRow(2).height = 22;

  const metrics: Array<[string, number]> = [
    ['Worked on', report.projectsWorkedOn],
    ['New', report.newProjects],
    ['Completed', report.completedProjects],
    ['Active', report.activeAtEnd],
    ['Waiting', report.waitingAtEnd],
    ['On hold', report.onHoldAtEnd],
    ['Cancelled', report.cancelledProjects],
    ['Reopened', report.reopenedProjects],
    ['Revisions', report.revisionsCreated],
    ['Packages', report.packagesCreated],
    ['Deliverables', report.deliverablesCompleted],
  ];
  metrics.forEach(([label, value], index) => {
    const column = index + 1;
    const labelCell = sheet.getCell(4, column);
    const valueCell = sheet.getCell(5, column);
    labelCell.value = label.toUpperCase();
    labelCell.font = { size: 8, bold: true, color: { argb: `FF${muted}` } };
    labelCell.alignment = { horizontal: 'center' };
    valueCell.value = value;
    valueCell.font = { size: 18, bold: true, color: { argb: `FF${accent}` } };
    valueCell.alignment = { horizontal: 'center' };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${light}` } };
    valueCell.border = { bottom: { style: 'medium', color: { argb: `FF${accent}` } } };
  });
  sheet.getRow(5).height = 32;

  const headerRow = sheet.getRow(9);
  headerRow.values = [
    'Project Code',
    'Project',
    'Client',
    'Salesperson',
    'Status at Period End',
    'New',
    'Completed',
    'Cancelled',
    'Reopened',
    'Revisions',
    'Packages',
    'Activities',
    'Last Activity (UTC)',
    'Cancellation Reason',
    'Closed session hours',
    'Work sessions',
    'Open sessions',
    'Tool sessions',
  ];
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${accent}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  report.projects.forEach((project, index) => {
    const row = sheet.addRow({
      workHours: project.workSeconds === undefined ? null : project.workSeconds / 3600,
      sessions: project.workSessionCount ?? null,
      openSessions: project.openWorkSessionCount ?? null,
      toolSessions: project.toolSessionCount ?? null,
      code: project.projectCode,
      project: project.projectName,
      client: project.clientName,
      sales: project.salesOwnerName,
      status: statusLabels[project.statusAtPeriodEnd] ?? project.statusAtPeriodEnd,
      new: project.createdInPeriod ? 'Yes' : '',
      completed: project.completedInPeriod ? 'Yes' : '',
      cancelled: project.cancelledInPeriod ? 'Yes' : '',
      reopened: project.reopenedInPeriod ? 'Yes' : '',
      revisions: project.revisionCount,
      packages: project.packageCount,
      activity: project.activityCount,
      lastActivity: readableDate(project.lastActivityAt, true),
      reason: project.cancellationReason,
    });
    row.height = 24;
    row.eachCell((cell, column) => {
      cell.alignment = { vertical: 'middle', wrapText: column === 2 || column === 14 };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9E4E5' } } };
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6FAFA' } };
      }
    });
  });
  sheet.autoFilter = 'A9:R9';
  sheet.getColumn(15).numFmt = '0.00';
  sheet.headerFooter.oddFooter = '&LSCT Workspace&CPeriod Activity Report&RPage &P of &N';
  const insights = workbook.addWorksheet('Report insights');
  insights.columns = [{ width: 48 }, { width: 22 }];
  insights.addRow(['Report insights', `${report.from} to ${report.to}`]);
  insights.addRow([
    'Work time definition',
    'Net closed sessions started in period; pauses excluded.',
  ]);
  for (const [title, items] of [
    ['Workload by sales owner', report.bySales],
    ['Project status', report.byStatus],
    [
      'Delivery activity',
      [
        { label: 'Revisions created', value: report.revisionsCreated },
        { label: 'Packages created', value: report.packagesCreated },
        { label: 'Deliverables completed', value: report.deliverablesCompleted },
      ],
    ],
  ] as const) {
    insights.addRow([]);
    const header = insights.addRow([title, 'Value']);
    header.font = { bold: true, color: { argb: `FF${accent}` } };
    for (const item of items) insights.addRow([item.label, item.value]);
  }
  insights.getRow(2).height = 38;
  insights.getRow(2).alignment = { wrapText: true };
  const detailSheet = (
    name: string,
    headers: string[],
    rows: Array<Array<string | number | null>>,
  ) => {
    const detail = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 3 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    detail.columns = headers.map((_, index) => ({ width: index < 2 ? 30 : 22 }));
    detail.addRow([name]);
    detail.addRow([
      name === 'Work sessions'
        ? `Sessions started ${report.from} to ${report.to}; timestamps UTC; open sessions excluded from net time.`
        : `Current workspace snapshot ${readableDate(report.generatedAt, true)} UTC; owner filter applied, independent of activity dates.`,
    ]);
    detail.mergeCells(2, 1, 2, headers.length);
    detail.getRow(2).alignment = { wrapText: true };
    detail.getRow(2).height = 32;
    const heading = detail.addRow(headers);
    heading.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${accent}` } };
    heading.alignment = { wrapText: true };
    rows.forEach((values) => detail.addRow(values));
    detail.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } };
  };
  const snapshots = report.currentProjects ?? [];
  detailSheet(
    'Current portfolio',
    ['Project code', 'Project', 'Status', 'Stage', 'Designer', 'Sales owner', 'Due date'],
    snapshots.map((p) => [
      p.projectCode,
      p.projectName,
      statusLabels[p.status as keyof typeof statusLabels] ?? p.status,
      p.stage ?? null,
      p.designerName ?? null,
      p.salesOwnerName,
      p.dueDate ?? null,
    ]),
  );
  detailSheet(
    'Registered delivery',
    [
      'Project',
      'Revisions',
      'Generated outputs',
      'Issued packages',
      'Latest revision',
      'Readiness',
      'Blockers',
      'Warnings',
    ],
    snapshots.map((p) => [
      p.projectName,
      p.revisions ?? null,
      p.generatedOutputs ?? null,
      p.issuedPackages ?? null,
      p.readiness?.revisionLabel ?? null,
      p.readiness?.level.replaceAll('_', ' ') ?? null,
      p.readiness?.blockers ?? null,
      p.readiness?.warnings ?? null,
    ]),
  );
  detailSheet(
    'Technical',
    [
      'Project code',
      'Project',
      'Luminaires',
      'Missing datasheets',
      'Missing images',
      'Incomplete W / lm / CCT',
      'Open requirements',
      'Project checks needing attention',
    ],
    snapshots.map((p) => [
      p.projectCode,
      p.projectName,
      p.luminaires,
      p.missingDatasheets,
      p.missingImages,
      p.incompleteTechnical,
      p.openRequirements,
      p.failedQualityChecks ?? null,
    ]),
  );
  detailSheet(
    'Deliverables',
    ['Project code', 'Project', 'Required / optional outputs', 'Completed outputs'],
    snapshots.map((p) => [p.projectCode, p.projectName, p.deliverables, p.completedDeliverables]),
  );
  detailSheet(
    'Follow-up',
    [
      'Project code',
      'Project',
      'Open actions',
      'Overdue actions',
      'Unresolved reviews',
      'Upcoming meetings',
    ],
    snapshots.map((p) => [
      p.projectCode,
      p.projectName,
      p.openActions,
      p.overdueActions,
      p.unresolvedReviews,
      p.upcomingMeetings,
    ]),
  );
  detailSheet(
    'Work sessions',
    [
      'Project',
      'Session ID',
      'Started UTC',
      'Ended UTC',
      'State',
      'Paused seconds',
      'Net seconds',
      'Operator',
      'Operator ID',
    ],
    (report.sessions ?? []).map((s) => [
      s.projectName,
      s.id,
      readableDate(s.startedAt, true),
      readableDate(s.endedAt, true),
      s.state,
      s.pausedSeconds,
      s.netSeconds,
      s.actorName ?? 'Operator not recorded',
      s.actorId ?? null,
    ]),
  );
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}
