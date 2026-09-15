import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FolderKanban,
  FileDown,
  FileSpreadsheet,
  Gauge,
  MessageSquareText,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { isActiveProject, projectServiceLabels, type ProjectStatus } from '@scli/domain';
import { api, downloadPeriodActivityExcel } from '../api';
import { workspaceDateKey } from '../local-date';
import {
  ErrorState,
  KpiCard,
  LoadingState,
  PageHeader,
  SectionHeading,
  StatusBadge,
  formatDate,
} from '../components/ui';
import { desktop } from '../desktop';
import { salesTone } from '../sales-color';
import { personalStatusLabel } from '../personal-status';
import { useToast } from '../components/toast';

function startOfMonth(): string {
  return `${workspaceDateKey().slice(0, 7)}-01`;
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function activityReportHtml(
  report: Awaited<ReturnType<typeof api.periodActivityReport>>,
  options: { details: boolean; sales: boolean },
): string {
  const metrics = [
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
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#173034;font:10px Arial,sans-serif}
    header{display:flex;justify-content:space-between;align-items:end;padding:0 0 14px;border-bottom:3px solid #008c95}
    .brand{font:700 9px Arial;letter-spacing:2px;color:#008c95}.title{margin:5px 0 0;font-size:22px}.period{text-align:right;color:#607679}
    .metrics{display:grid;grid-template-columns:repeat(10,1fr);gap:5px;margin:14px 0}.metric{padding:9px 5px;text-align:center;background:#edf6f6;border-radius:6px}
    .metric strong{display:block;color:#008c95;font-size:17px}.metric span{display:block;margin-top:3px;color:#607679;font-size:7px;text-transform:uppercase;letter-spacing:.5px}
    h2{margin:18px 0 8px;font-size:12px}table{width:100%;table-layout:fixed;border-collapse:collapse}th{padding:7px 4px;color:#fff;background:#008c95;text-align:left;font-size:7px;overflow-wrap:anywhere}
    th:nth-child(1){width:9%}th:nth-child(2){width:20%}th:nth-child(3){width:10%}th:nth-child(4){width:10%}th:nth-child(12){width:13%}
    td{padding:6px 4px;border-bottom:1px solid #dbe7e8;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}tr:nth-child(even) td{background:#f7fafa}.yes{color:#008c95;font-weight:700}
    .sales{display:flex;gap:7px;flex-wrap:wrap}.sales span{padding:7px 10px;border-radius:6px;background:#edf6f6}.muted{color:#607679}
    footer{position:fixed;bottom:0;left:0;right:0;padding-top:5px;border-top:1px solid #dbe7e8;color:#607679;font-size:7px}
  </style></head><body><header><div><div class="brand">SCIENTECHNIC · SCT WORKSPACE</div><h1 class="title">Period Activity Report</h1></div><div class="period"><strong>${escapeHtml(report.from)} — ${escapeHtml(report.to)}</strong><br>Generated ${escapeHtml(report.generatedAt.slice(0, 16).replace('T', ' '))}</div></header>
  <section class="metrics">${metrics.map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('')}</section>
  ${options.sales ? `<h2>Projects worked on by Salesperson</h2><div class="sales">${report.bySales.map((item) => `<span><strong>${escapeHtml(item.label)}</strong> · ${item.value}</span>`).join('') || '<span>No activity</span>'}</div>` : ''}
  ${options.details ? `<h2>Detailed project activity</h2><table><thead><tr><th>Code</th><th>Project / Client</th><th>Salesperson</th><th>Status at end</th><th>New</th><th>Completed</th><th>Cancelled</th><th>Reopened</th><th>Revisions</th><th>Packages</th><th>Activities</th><th>Cancellation reason</th></tr></thead><tbody>${report.projects.map((project) => `<tr><td>${escapeHtml(project.projectCode)}</td><td><strong>${escapeHtml(project.projectName)}</strong><br><span class="muted">${escapeHtml(project.clientName)}</span></td><td>${escapeHtml(project.salesOwnerName)}</td><td>${escapeHtml(personalStatusLabel(project.statusAtPeriodEnd))}</td><td class="yes">${project.createdInPeriod ? 'Yes' : ''}</td><td class="yes">${project.completedInPeriod ? 'Yes' : ''}</td><td>${project.cancelledInPeriod ? 'Yes' : ''}</td><td>${project.reopenedInPeriod ? 'Yes' : ''}</td><td>${project.revisionCount}</td><td>${project.packageCount}</td><td>${project.activityCount}</td><td>${escapeHtml(project.cancellationReason)}</td></tr>`).join('') || '<tr><td colspan="12">No project activity in this period.</td></tr>'}</tbody></table>` : ''}
  <footer>No pricing, cost or commercial values are included in this report.</footer></body></html>`;
}

function MetricBarChart({
  title,
  detail,
  data,
}: {
  title: string;
  detail: string;
  data: Array<{ label: string; value: number }>;
}) {
  return (
    <section className="report-chart-card">
      <SectionHeading title={title} detail={detail} />
      <div className="chart-canvas" role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 10, bottom: 48, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--chart-text)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={-24}
              textAnchor="end"
              height={80}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--chart-text)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(0,140,149,.06)' }}
              contentStyle={{
                background: '#111820',
                border: '1px solid #263543',
                borderRadius: 12,
                color: '#f3f6f9',
              }}
            />
            <Bar dataKey="value" name="Projects" fill="#008c95" radius={[6, 6, 2, 2]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function PersonalReportsScreen() {
  const { showToast } = useToast();
  const [period, setPeriod] = useState({ from: startOfMonth(), to: workspaceDateKey() });
  const [salesOwnerId, setSalesOwnerId] = useState('');
  const [sections, setSections] = useState({ details: true, sales: true });
  const projectsQuery = useQuery({
    queryKey: ['projects', 'personal-reports'],
    queryFn: () => api.projects(),
  });
  const operationsQuery = useQuery({
    queryKey: ['personal-operations', 'reports'],
    queryFn: api.personalOperations,
  });
  const salesQuery = useQuery({ queryKey: ['sales-users'], queryFn: api.salesUsers });
  const activityQuery = useQuery({
    queryKey: ['period-activity-report', period, salesOwnerId],
    queryFn: () =>
      api.periodActivityReport({
        ...period,
        ...(salesOwnerId ? { salesOwnerId } : {}),
      }),
    enabled: Boolean(period.from && period.to && period.to >= period.from),
  });
  const excelMutation = useMutation({
    mutationFn: () =>
      downloadPeriodActivityExcel({
        ...period,
        ...(salesOwnerId ? { salesOwnerId } : {}),
      }),
    onSuccess: () => showToast('Excel activity report exported.'),
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const pdfMutation = useMutation({
    mutationFn: async () => {
      if (!activityQuery.data) throw new Error('Generate the report first.');
      if (!desktop.available()) throw new Error('PDF export is available in the portable app.');
      return desktop.exportPdf({
        html: activityReportHtml(activityQuery.data, sections),
        suggestedName: `SCT_Activity_${period.from}_${period.to}.pdf`,
      });
    },
    onSuccess: (result) =>
      showToast(result ? `PDF report saved to ${result}` : 'PDF export was cancelled.'),
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const projects = projectsQuery.data ?? [];
  const today = workspaceDateKey();
  const data = useMemo(() => {
    const active = projects.filter(isActiveProject);
    const completed = projects.filter(
      (project) => project.status === 'Completed' || project.status === 'Archived',
    );
    const overdue = active.filter((project) => project.requiredDeliveryDate < today);
    const averageProgress = active.length
      ? Math.round(
          active.reduce((sum, project) => sum + project.progressPercent, 0) / active.length,
        )
      : 0;
    const statusMap = new Map<string, number>();
    const serviceMap = new Map<string, number>();
    projects.forEach((project) => {
      statusMap.set(project.status, (statusMap.get(project.status) ?? 0) + 1);
      project.services?.forEach((service) =>
        serviceMap.set(service, (serviceMap.get(service) ?? 0) + 1),
      );
    });
    const statuses = [...statusMap].map(([status, value]) => ({
      label: personalStatusLabel(status as ProjectStatus),
      value,
    }));
    const services = [...serviceMap]
      .sort((a, b) => b[1] - a[1])
      .map(([service, value]) => ({
        label: projectServiceLabels[service as keyof typeof projectServiceLabels],
        value,
      }));
    return { active, completed, overdue, averageProgress, statuses, services };
  }, [projects, today]);
  if (projectsQuery.isLoading || operationsQuery.isLoading)
    return <LoadingState label="Calculating personal project metrics…" />;
  if (projectsQuery.error || operationsQuery.error)
    return (
      <ErrorState
        message={((projectsQuery.error ?? operationsQuery.error) as Error).message}
        onRetry={() => {
          void projectsQuery.refetch();
          void operationsQuery.refetch();
        }}
      />
    );
  const operations = operationsQuery.data!;
  return (
    <>
      <PageHeader
        eyebrow="Live local data"
        title="Lighting project reports"
        description="A portfolio view calculated directly from your local project workspace. Active excludes Completed, Archived and Cancelled projects."
      />
      <section className="content-card period-report-card">
        <SectionHeading
          title="Period Activity Report"
          detail="Based on real project activity inside the selected period — not simply projects opened on screen."
        />
        <div className="period-report-toolbar">
          <div className="period-presets" role="group" aria-label="Report period presets">
            <button
              type="button"
              className="button secondary"
              onClick={() => setPeriod({ from: dateDaysAgo(6), to: workspaceDateKey() })}
            >
              This week
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setPeriod({ from: startOfMonth(), to: workspaceDateKey() })}
            >
              This month
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setPeriod({ from: dateDaysAgo(89), to: workspaceDateKey() })}
            >
              Last 90 days
            </button>
          </div>
          <label>
            From
            <input
              type="date"
              value={period.from}
              max={period.to}
              onChange={(event) => setPeriod({ ...period, from: event.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={period.to}
              min={period.from}
              onChange={(event) => setPeriod({ ...period, to: event.target.value })}
            />
          </label>
          <label>
            Salesperson
            <select value={salesOwnerId} onChange={(event) => setSalesOwnerId(event.target.value)}>
              <option value="">All salespeople</option>
              {salesQuery.data?.map((salesperson) => (
                <option value={salesperson.id} key={salesperson.id}>
                  {salesperson.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="period-report-options">
          <label className="inline-check">
            <input
              type="checkbox"
              checked={sections.details}
              onChange={(event) => setSections({ ...sections, details: event.target.checked })}
            />
            Include detailed project table
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={sections.sales}
              onChange={(event) => setSections({ ...sections, sales: event.target.checked })}
            />
            Include Sales breakdown
          </label>
          <div className="period-export-actions">
            <button
              className="button secondary"
              type="button"
              disabled={!activityQuery.data || excelMutation.isPending}
              onClick={() => excelMutation.mutate()}
            >
              <FileSpreadsheet /> Export Excel
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!activityQuery.data || pdfMutation.isPending}
              onClick={() => pdfMutation.mutate()}
            >
              <FileDown /> Export PDF
            </button>
          </div>
        </div>

        {activityQuery.isLoading ? <LoadingState label="Building period activity…" /> : null}
        {activityQuery.error ? (
          <ErrorState message={(activityQuery.error as Error).message} />
        ) : null}
        {activityQuery.data ? (
          <>
            <div className="period-metrics">
              {[
                ['Worked on', activityQuery.data.projectsWorkedOn],
                ['New', activityQuery.data.newProjects],
                ['Completed', activityQuery.data.completedProjects],
                ['Still active', activityQuery.data.activeAtEnd],
                ['Waiting', activityQuery.data.waitingAtEnd],
                ['On hold', activityQuery.data.onHoldAtEnd],
                ['Cancelled', activityQuery.data.cancelledProjects],
                ['Reopened', activityQuery.data.reopenedProjects],
                ['Revisions', activityQuery.data.revisionsCreated],
                ['Packages', activityQuery.data.packagesCreated],
              ].map(([label, value]) => (
                <div key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {sections.sales ? (
              <div className="period-sales-summary">
                {activityQuery.data.bySales.map((item) => (
                  <Link
                    className={salesTone(
                      salesQuery.data?.find((user) => user.displayName === item.label)?.id ??
                        item.label,
                    )}
                    key={item.label}
                    to={`/projects?search=${encodeURIComponent(item.label)}&sortBy=salesOwner`}
                  >
                    <span>{item.label}</span>
                    <strong>{item.value} project(s)</strong>
                  </Link>
                ))}
              </div>
            ) : null}
            {sections.details ? (
              <div className="table-shell period-report-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Salesperson</th>
                      <th>Status at period end</th>
                      <th>Activity</th>
                      <th>Revisions / Packages</th>
                      <th>Period events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityQuery.data.projects.map((project) => (
                      <tr key={project.projectId}>
                        <td>
                          <Link to={`/projects/${project.projectId}`} title={project.projectName}>
                            <strong>{project.projectName}</strong>
                            <span>
                              {project.projectCode} · {project.clientName}
                            </span>
                          </Link>
                        </td>
                        <td>
                          <span
                            className={`sales-chip ${salesTone(project.salesOwnerId)}`}
                            title={project.salesOwnerName}
                          >
                            {project.salesOwnerName}
                          </span>
                        </td>
                        <td>
                          <StatusBadge
                            status={project.statusAtPeriodEnd}
                            label={personalStatusLabel(project.statusAtPeriodEnd)}
                          />
                        </td>
                        <td>
                          <strong>{project.activityCount} events</strong>
                          <span>{formatDate(project.lastActivityAt)}</span>
                        </td>
                        <td>
                          <strong>
                            {project.revisionCount} / {project.packageCount}
                          </strong>
                        </td>
                        <td>
                          <div className="period-event-tags">
                            {project.createdInPeriod ? <span>New</span> : null}
                            {project.completedInPeriod ? <span>Completed</span> : null}
                            {project.cancelledInPeriod ? (
                              <span className="danger">Cancelled</span>
                            ) : null}
                            {project.reopenedInPeriod ? <span>Reopened</span> : null}
                          </div>
                          {project.cancellationReason ? (
                            <small>{project.cancellationReason}</small>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <SectionHeading title="Current portfolio snapshot" detail="Live status and workload now" />
      <section className="kpi-grid personal-kpi-grid">
        <KpiCard
          icon={<FolderKanban />}
          label="Total projects"
          value={projects.length}
          detail="All projects in the local workspace"
          tone="accent"
        />
        <KpiCard
          icon={<Gauge />}
          label="Active projects"
          value={data.active.length}
          detail="Currently requiring work"
        />
        <KpiCard
          icon={<CheckCircle2 />}
          label="Completed / archived"
          value={data.completed.length}
          detail="Finished project records"
        />
        <KpiCard
          icon={<AlertTriangle />}
          label="Overdue active"
          value={data.overdue.length}
          detail="Required date is before today"
          tone={data.overdue.length ? 'danger' : 'default'}
        />
        <KpiCard
          icon={<Clock3 />}
          label="Average active progress"
          value={`${data.averageProgress}%`}
          detail="Mean of active project progress"
        />
        <KpiCard
          icon={<ClipboardCheck />}
          label="Overdue actions"
          value={operations.overdueActions.length}
          detail="Open project commitments"
          tone={operations.overdueActions.length ? 'danger' : 'default'}
        />
        <KpiCard
          icon={<MessageSquareText />}
          label="Open comments"
          value={operations.openReviews.length}
          detail="Review register items"
        />
        <KpiCard
          icon={<CalendarDays />}
          label="Upcoming meetings"
          value={operations.upcomingMeetings.length}
          detail="Local project calendar"
        />
      </section>
      <div className="report-grid">
        <MetricBarChart
          title="Projects by status"
          detail="Current portfolio lifecycle mix"
          data={data.statuses}
        />
        <MetricBarChart
          title="Deliverable scope mix"
          detail="How often each lighting service appears"
          data={data.services}
        />
      </div>
    </>
  );
}
