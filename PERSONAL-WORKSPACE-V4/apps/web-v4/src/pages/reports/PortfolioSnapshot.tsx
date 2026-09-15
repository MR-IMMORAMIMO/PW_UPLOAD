import { useState } from 'react';
import { Link } from 'react-router-dom';
import { statusLabels, type PeriodActivityReport, type ProjectStatus } from '@scli/domain';
import { Bars } from './ReportCharts';
import { V4Button } from '../../components/common/V4Button';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import {
  formatBusinessDateOnly,
  formatBusinessDateTime,
  businessDateKey,
} from '../../date-time/businessDateTime';

type Snapshot = NonNullable<PeriodActivityReport['currentProjects']>[number];
export function PortfolioSnapshot({
  report,
  workload = false,
}: {
  report: PeriodActivityReport;
  workload?: boolean;
}) {
  const [detail, setDetail] = useState<{ title: string; rows: Snapshot[] } | null>(null);
  const [search, setSearch] = useState('');
  const projects = report.currentProjects ?? [];
  const active = (p: Snapshot) => !['Completed', 'Cancelled', 'Archived'].includes(p.status);
  const open = (title: string, rows: Snapshot[]) => {
    setSearch('');
    setDetail({ title, rows });
  };
  const today = businessDateKey(report.generatedAt);
  const breakdown = (key: 'stage' | 'designerName' | 'salesOwnerName') => {
    const counts = new Map<string, number>();
    projects.filter(active).forEach((p) => {
      const label = p[key] || 'Unassigned';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });
    return [...counts]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  };
  const upcoming = projects
    .filter((p) => active(p) && p.dueDate && p.dueDate >= today)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return (
    <section aria-label={workload ? 'Current assignments' : 'Current portfolio'}>
      <h2>{workload ? 'Current assignments and deadlines' : 'Current portfolio'}</h2>
      <p>
        As of {formatBusinessDateTime(report.generatedAt)}. Owner and search filters apply; these
        current figures are separate from activity dates.
      </p>
      {!workload && (
        <div className="v4-report-summary">
          {[
            { label: 'All current projects', rows: projects },
            { label: 'Active now', rows: projects.filter(active) },
            { label: 'Completed now', rows: projects.filter((p) => p.status === 'Completed') },
            {
              label: 'Overdue now',
              rows: projects.filter((p) => active(p) && p.dueDate && p.dueDate < today),
            },
          ].map((item) => (
            <button key={item.label} type="button" onClick={() => open(item.label, item.rows)}>
              <span>{item.label}</span>
              <strong>{item.rows.length}</strong>
            </button>
          ))}
        </div>
      )}
      <div className="v4-report-charts">
        {(workload ? (['designerName', 'salesOwnerName'] as const) : (['stage'] as const)).map(
          (key) => (
            <Bars
              key={key}
              title={
                key === 'stage'
                  ? 'Active projects by stage'
                  : key === 'designerName'
                    ? 'Assigned to designers'
                    : 'Assigned to sales owners'
              }
              rows={breakdown(key)}
              onSelect={(label) =>
                open(
                  label,
                  projects.filter((p) => active(p) && (p[key] || 'Unassigned') === label),
                )
              }
            />
          ),
        )}
      </div>
      {workload && (
        <V4Button onClick={() => open('Upcoming deadlines', upcoming)}>
          View upcoming deadlines ({upcoming.length})
        </V4Button>
      )}
      {detail && (
        <V4FloatingWorkspace
          open
          title={detail.title}
          bodyClassName="v4-report-detail"
          onRequestClose={() => setDetail(null)}
          footer={<V4Button onClick={() => setDetail(null)}>Close</V4Button>}
        >
          <label>
            Search current projects
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <table aria-label="Current project details">
            <thead>
              <tr>
                {['Project', 'Status', 'Stage', 'Designer', 'Sales owner', 'Due date'].map(
                  (label) => (
                    <th key={label}>{label}</th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {detail.rows
                .filter((p) =>
                  `${p.projectName} ${p.projectCode}`.toLowerCase().includes(search.toLowerCase()),
                )
                .map((p) => (
                  <tr key={p.projectId}>
                    <td>
                      <Link to={`/projects/${p.projectId}/summary`}>{p.projectName}</Link>
                      <small>{p.projectCode}</small>
                    </td>
                    <td>{statusLabels[p.status as ProjectStatus] ?? p.status}</td>
                    <td>{p.stage || '—'}</td>
                    <td>{p.designerName || 'Unassigned'}</td>
                    <td>{p.salesOwnerName}</td>
                    <td>{p.dueDate ? formatBusinessDateOnly(p.dueDate) : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </V4FloatingWorkspace>
      )}
    </section>
  );
}
