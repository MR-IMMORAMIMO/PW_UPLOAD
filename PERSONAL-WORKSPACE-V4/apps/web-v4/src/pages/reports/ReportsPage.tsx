import { V4DateInput } from '../../components/common/V4DateInput';
import { ReportCharts } from './ReportCharts';
import { PortfolioSnapshot } from './PortfolioSnapshot';
import { ReportDetailPane, type ReportTab } from './ReportDetailPane';
import { SctExcel, SctPdf } from '../../components/common/SctIcons';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, v4ApiClient } from '../../api/environment';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { V4Button } from '../../components/common/V4Button';
import { V4Pagination } from '../../components/common/V4Pagination';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { statusLabels, type PeriodActivityReport } from '@scli/domain';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import './reports.css';
import {
  businessTodayKey,
  formatBusinessDateOnly,
  formatBusinessDateTime,
} from '../../date-time/businessDateTime';

const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function activityReportHtml(report: PeriodActivityReport) {
  const detailTable = (title: string, headers: string[], rows: unknown[][]) =>
    `<h2>${escapeHtml(title)}</h2><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const snapshots = report.currentProjects ?? [];
  const details =
    `<h2>Current workspace snapshot</h2><p>As of ${escapeHtml(formatBusinessDateTime(report.generatedAt))} (Asia/Dubai); filtered by owner, independent of activity dates.</p>` +
    detailTable(
      'Current portfolio',
      ['Project', 'Status', 'Stage', 'Designer', 'Sales owner', 'Due date'],
      snapshots.map((p) => [
        p.projectName,
        statusLabels[p.status as keyof typeof statusLabels] ?? p.status,
        p.stage,
        p.designerName,
        p.salesOwnerName,
        p.dueDate ? formatBusinessDateOnly(p.dueDate) : '—',
      ]),
    ) +
    detailTable(
      'Registered delivery and readiness',
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
        p.revisions,
        p.generatedOutputs,
        p.issuedPackages,
        p.readiness?.revisionLabel,
        p.readiness?.level.replaceAll('_', ' '),
        p.readiness?.blockers,
        p.readiness?.warnings,
      ]),
    ) +
    detailTable(
      'Technical',
      [
        'Project',
        'Luminaires',
        'Missing datasheets',
        'Missing images',
        'Incomplete W / lm / CCT',
        'Open requirements',
        'Project checks needing attention',
      ],
      snapshots.map((p) => [
        p.projectName,
        p.luminaires,
        p.missingDatasheets,
        p.missingImages,
        p.incompleteTechnical,
        p.openRequirements,
        p.failedQualityChecks,
      ]),
    ) +
    detailTable(
      'Deliverables',
      ['Project', 'Required / optional outputs', 'Completed outputs'],
      snapshots.map((p) => [p.projectName, p.deliverables, p.completedDeliverables]),
    ) +
    detailTable(
      'Follow-up',
      ['Project', 'Open actions', 'Overdue actions', 'Unresolved reviews', 'Upcoming meetings'],
      snapshots.map((p) => [
        p.projectName,
        p.openActions,
        p.overdueActions,
        p.unresolvedReviews,
        p.upcomingMeetings,
      ]),
    ) +
    detailTable(
      'Work sessions — selected period; times Asia/Dubai',
      ['Project', 'Started', 'Ended', 'State', 'Paused seconds', 'Net seconds', 'Operator'],
      (report.sessions ?? []).map((s) => [
        s.projectName,
        formatBusinessDateTime(s.startedAt),
        s.endedAt ? formatBusinessDateTime(s.endedAt) : '',
        s.state,
        s.pausedSeconds,
        s.netSeconds,
        s.actorName ?? 'Operator not recorded',
      ]),
    );
  const breakdown = (title: string, rows: Array<{ label: string; value: number }>) =>
    `<h2>${escapeHtml(title)}</h2><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value)}</td></tr>`).join('')}</tbody></table>`;
  const insights =
    details +
    breakdown('Workload by sales owner', report.bySales) +
    breakdown('Project status', report.byStatus) +
    breakdown('Delivery activity', [
      { label: 'Revisions created', value: report.revisionsCreated },
      { label: 'Packages created', value: report.packagesCreated },
      { label: 'Deliverables completed', value: report.deliverablesCompleted },
    ]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Activity report</title><style>@page{size:A4 landscape;margin:14mm}body{font:11px Arial;color:#172b3a;padding:0}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}td{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #ddd;text-align:left}h1{font-size:24px}</style></head><body><h1>Workspace activity report</h1><p>${escapeHtml(formatBusinessDateOnly(report.from))} — ${escapeHtml(formatBusinessDateOnly(report.to))}</p><p>Projects worked on: ${report.projectsWorkedOn} · Revisions: ${report.revisionsCreated} · Packages: ${report.packagesCreated}</p><p>Work time: full net duration of closed sessions started in the selected period; pauses excluded. Open and tool sessions are separate.</p><table><thead><tr><th>Project</th><th>Client</th><th>Owner</th><th>Status</th><th>Revisions</th><th>Packages</th><th>Activity</th><th>Work hours</th><th>Sessions</th><th>Open</th><th>Tool sessions</th></tr></thead><tbody>${report.projects.map((p) => `<tr>${[p.projectCode + ' — ' + p.projectName, p.clientName, p.salesOwnerName, statusLabels[p.statusAtPeriodEnd] ?? p.statusAtPeriodEnd, p.revisionCount, p.packageCount, p.activityCount, p.workSeconds === undefined ? '—' : (p.workSeconds / 3600).toFixed(1), p.workSessionCount ?? '—', p.openWorkSessionCount ?? '—', p.toolSessionCount ?? '—'].map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>${insights}</body></html>`;
}

export function ReportsPage() {
  const today = businessTodayKey();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [owner, setOwner] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<ReportTab>('Overview');
  const [metric, setMetric] = useState('');
  const [detailSearch, setDetailSearch] = useState('');
  const [detailSort, setDetailSort] = useState('name');
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const tableCard = useRef<HTMLElement>(null);
  const [pageSize, setPageSize] = useState(4);
  const filters = {
    from,
    to,
    ...(owner ? { salesOwnerId: owner } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  };
  const valid = Boolean(from && to && from <= to);
  const report = useQuery({
    queryKey: ['v4', 'reports', filters],
    queryFn: () => api.periodActivityReport(filters),
    enabled: valid,
  });
  const sales = useQuery({ queryKey: ['v4', 'reports', 'sales'], queryFn: api.salesUsers });
  const excel = useMutation({ mutationFn: () => v4ApiClient.downloadPeriodActivityExcel(filters) });
  const pdf = useMutation({
    mutationFn: async () => {
      if (!report.data) return;
      const html = activityReportHtml(report.data);
      if (window.scliDesktop?.exportPdf)
        return window.scliDesktop.exportPdf({
          html,
          suggestedName: `SCT_Activity_${from}_${to}.pdf`,
        });
      const preview = window.open('', '_blank');
      if (!preview) throw new Error('Allow the report preview window to print or save a PDF.');
      preview.document.open();
      preview.document.write(html);
      preview.document.close();
      preview.focus();
      preview.print();
    },
  });
  const rows = report.data?.projects ?? [];
  const detailRows = rows
    .filter((row) => {
      const contributes =
        metric === 'Projects worked on'
          ? row.workedOn
          : metric === 'New projects'
            ? row.createdInPeriod
            : metric === 'Completed'
              ? row.completedInPeriod
              : metric === 'Active'
                ? !['Completed', 'Archived', 'Cancelled'].includes(row.statusAtPeriodEnd)
                : metric === 'Revisions'
                  ? row.revisionCount > 0
                  : row.packageCount > 0;
      return (
        contributes &&
        `${row.projectName} ${row.projectCode} ${row.clientName} ${row.salesOwnerName}`
          .toLowerCase()
          .includes(detailSearch.toLowerCase())
      );
    })
    .sort((a, b) =>
      detailSort === 'activity'
        ? b.activityCount - a.activityCount
        : a.projectName.localeCompare(b.projectName),
    );
  useEffect(() => {
    const card = tableCard.current;
    if (!card || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const rowHeight = card.querySelector('tbody tr')?.getBoundingClientRect().height || 64;
      setPageSize(Math.max(1, Math.floor((card.clientHeight - 120) / rowHeight)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    measure();
    return () => observer.disconnect();
  }, [report.data]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  return (
    <V4AppShell
      context="global"
      sidebarMode={mode}
      onToggleSidebarMode={() => {
        const next = mode === 'extended' ? 'minimal' : 'extended';
        writeStoredSidebarMode(window.localStorage, next);
        setMode(next);
      }}
      boundedPage
    >
      <main className="v4-reports final-ui-reference">
        <header className="v4-reports__header">
          <div>
            <h1>Reports</h1>
            <p>Project activity and productivity for the selected period.</p>
          </div>
          <div className="v4-reports__actions">
            <V4Button
              variant="secondary"
              disabled={!valid || !report.data || report.isFetching || excel.isPending}
              onClick={() => excel.mutate()}
            >
              <SctExcel size={18} /> Export Excel
            </V4Button>
            <V4Button
              variant="primary"
              disabled={!valid || !report.data || report.isFetching || pdf.isPending}
              onClick={() => pdf.mutate()}
            >
              <SctPdf size={18} /> Export PDF
            </V4Button>
          </div>
        </header>
        <section className="v4-reports__filters" aria-label="Report filters">
          <label>
            Search projects
            <input
              value={search}
              maxLength={200}
              placeholder="Name, code or client"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label htmlFor="report-from">
            From
            <V4DateInput
              id="report-from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label htmlFor="report-to">
            To
            <V4DateInput
              id="report-to"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <V4FilterSelect
            label="Sales owner"
            value={owner}
            onChange={(value) => {
              setOwner(value);
              setPage(0);
            }}
            options={[
              { value: '', label: 'All sales owners' },
              ...(sales.data ?? []).map((s) => ({ value: s.id, label: s.displayName })),
            ]}
          />
        </section>
        <nav className="v4-reports__actions" aria-label="Report sections">
          {(['Overview', 'Workload', 'Technical', 'Deliverables', 'Follow-up'] as const).map(
            (item) => (
              <V4Button
                key={item}
                variant={tab === item ? 'primary' : 'secondary'}
                aria-pressed={tab === item}
                onClick={() => {
                  setTab(item);
                  setPage(0);
                }}
              >
                {item}
              </V4Button>
            ),
          )}
        </nav>
        {!valid ? (
          <p role="alert">Choose a valid date range.</p>
        ) : report.isPending ? (
          <p role="status">Loading activity…</p>
        ) : report.isError ? (
          <div role="alert">
            {report.error.message}
            <V4Button onClick={() => void report.refetch()}>Retry</V4Button>
          </div>
        ) : null}
        {excel.isError || pdf.isError ? (
          <p role="alert">{excel.error?.message ?? pdf.error?.message}</p>
        ) : null}
        {valid && report.data ? (
          tab !== 'Overview' ? (
            <ReportDetailPane key={tab} report={report.data} tab={tab} />
          ) : (
            <>
              <PortfolioSnapshot report={report.data} />
              <h2>Activity in the selected period</h2>
              <section className="v4-reports__kpis" aria-label="Activity totals">
                {[
                  ['Projects worked on', report.data.projectsWorkedOn],
                  ['New projects', report.data.newProjects],
                  ['Completed', report.data.completedProjects],
                  ['Active', report.data.activeAtEnd],
                  ['Revisions', report.data.revisionsCreated],
                  ['Packages', report.data.packagesCreated],
                ].map(([label, value]) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => {
                      setMetric(String(label));
                      setDetailSearch('');
                    }}
                    aria-label={`${label}: ${value}`}
                  >
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </button>
                ))}
              </section>
              <ReportCharts report={report.data} />
              <section ref={tableCard} className="v4-reports__table" aria-label="Project activity">
                <table>
                  <thead>
                    <tr>
                      {[
                        'Project',
                        'Client',
                        'Sales owner',
                        'Status',
                        'Revisions',
                        'Packages',
                        'Activity',
                        'Work hours',
                        'Sessions',
                        'Open',
                        'Tool sessions',
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(current * pageSize, current * pageSize + pageSize).map((p) => (
                      <tr key={p.projectId}>
                        <td>
                          <Link to={`/projects/${p.projectId}/summary`}>{p.projectName}</Link>
                          <small>{p.projectCode}</small>
                        </td>
                        <td>{p.clientName}</td>
                        <td>{p.salesOwnerName}</td>
                        <td>{statusLabels[p.statusAtPeriodEnd] ?? p.statusAtPeriodEnd}</td>
                        <td>{p.revisionCount}</td>
                        <td>{p.packageCount}</td>
                        <td>{p.activityCount}</td>
                        <td>
                          {p.workSeconds === undefined ? '—' : (p.workSeconds / 3600).toFixed(1)}
                        </td>
                        <td>{p.workSessionCount ?? '—'}</td>
                        <td>{p.openWorkSessionCount ?? '—'}</td>
                        <td>{p.toolSessionCount ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length ? <p>No project activity in this period.</p> : null}
                <V4Pagination
                  currentPage={current}
                  pageCount={pages}
                  onChange={setPage}
                  ariaLabel="Report pages"
                />
              </section>
            </>
          )
        ) : null}
        {metric ? (
          <V4FloatingWorkspace
            bodyClassName="v4-report-detail"
            open
            title={`${metric} — project details`}
            description="Projects contributing to the selected period metric. Revision and Package values count records, so one project may contribute more than one."
            onRequestClose={() => setMetric('')}
            footer={<V4Button onClick={() => setMetric('')}>Close</V4Button>}
          >
            <label>
              Search projects
              <input
                value={detailSearch}
                onChange={(event) => setDetailSearch(event.target.value)}
              />
            </label>
            <V4FilterSelect
              label="Sort projects"
              value={detailSort}
              onChange={setDetailSort}
              options={[
                { value: 'name', label: 'Project name' },
                { value: 'activity', label: 'Most activity' },
              ]}
            />
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Sales owner</th>
                  <th>Status at period end</th>
                  <th>Revisions</th>
                  <th>Packages</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((row) => (
                  <tr key={row.projectId}>
                    <td>
                      <Link
                        to={`/projects/${row.projectId}/${metric === 'Revisions' ? 'revisions' : metric === 'Packages' ? 'packages' : 'summary'}`}
                      >
                        {row.projectCode} — {row.projectName}
                      </Link>
                    </td>
                    <td>{row.clientName}</td>
                    <td>{row.salesOwnerName}</td>
                    <td>{statusLabels[row.statusAtPeriodEnd] ?? row.statusAtPeriodEnd}</td>
                    <td>{row.revisionCount}</td>
                    <td>{row.packageCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!detailRows.length ? <p>No matching projects.</p> : null}
          </V4FloatingWorkspace>
        ) : null}
      </main>
    </V4AppShell>
  );
}
