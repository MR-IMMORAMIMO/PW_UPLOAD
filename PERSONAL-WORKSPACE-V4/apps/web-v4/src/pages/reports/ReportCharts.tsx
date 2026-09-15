import { statusLabels, type PeriodActivityReport } from '@scli/domain';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { V4Button } from '../../components/common/V4Button';
import { SctToolSession, SctWorkSession, SctDeliverables } from '../../components/common/SctIcons';
export function Bars({
  title,
  rows,
  unit = 'projects',
  onSelect,
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
  unit?: string;
  onSelect?: (label: string) => void;
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.value));
  return (
    <article className="v4-report-chart">
      <h2>{title}</h2>
      {!rows.length ? (
        <p>No data in this period.</p>
      ) : (
        <>
          <div>
            {rows.slice(0, 8).map((row, index) => (
              <button
                className="v4-report-bar"
                key={row.label}
                type="button"
                title={row.label}
                onClick={() => onSelect?.(row.label)}
                disabled={!onSelect}
              >
                <span>{row.label}</span>
                <span className="v4-report-bar-track" aria-hidden="true">
                  <i
                    style={{
                      width: `${(row.value / maximum) * 100}%`,
                      background: `var(--report-color-${index % 4})`,
                    }}
                  />
                </span>
                <strong>{row.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong>
              </button>
            ))}
          </div>
          <details>
            <summary>View all data</summary>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>{unit}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </article>
  );
}
export function ReportCharts({ report }: { report: PeriodActivityReport }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [detail, setDetail] = useState<{
    title: string;
    rows: PeriodActivityReport['projects'];
  } | null>(null);
  const closeDetail = () => {
    setDetail(null);
    setSearch('');
    setSort('name');
  };
  const hours = report.projects.reduce((n, p) => n + (p.workSeconds ?? 0), 0) / 3600;
  const open = report.projects.reduce((n, p) => n + (p.openWorkSessionCount ?? 0), 0);
  const tools = report.projects.reduce((n, p) => n + (p.toolSessionCount ?? 0), 0);
  const detailRows = (detail?.rows ?? [])
    .filter((p) =>
      `${p.projectName} ${p.projectCode} ${p.salesOwnerName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'hours'
        ? (b.workSeconds ?? 0) - (a.workSeconds ?? 0)
        : a.projectName.localeCompare(b.projectName),
    );
  return (
    <section aria-label="Report insights" className="v4-report-insights">
      <div className="v4-report-summary">
        <button
          type="button"
          onClick={() => {
            setSearch('');
            setDetail({
              title: 'Closed session hours',
              rows: report.projects.filter((p) => (p.workSeconds ?? 0) > 0),
            });
          }}
        >
          <SctWorkSession />
          <span>Closed session hours</span>
          <strong>{hours.toFixed(1)}</strong>
        </button>
        <button
          type="button"
          onClick={() => {
            setSearch('');
            setDetail({
              title: 'Open work sessions',
              rows: report.projects.filter((p) => (p.openWorkSessionCount ?? 0) > 0),
            });
          }}
        >
          <SctWorkSession />
          <span>Open work sessions</span>
          <strong>{open}</strong>
        </button>
        <button
          type="button"
          onClick={() => {
            setSearch('');
            setDetail({
              title: 'Tool sessions started',
              rows: report.projects.filter((p) => (p.toolSessionCount ?? 0) > 0),
            });
          }}
        >
          <SctToolSession />
          <span>Tool sessions started</span>
          <strong>{tools}</strong>
        </button>
        <button
          type="button"
          onClick={() => {
            setSearch('');
            setDetail({
              title: 'Deliverables completed',
              rows: report.projects.filter((p) => (p.completedDeliverableCount ?? 0) > 0),
            });
          }}
        >
          <SctDeliverables />
          <span>Deliverables completed</span>
          <strong>{report.deliverablesCompleted}</strong>
        </button>
      </div>
      <p className="v4-report-time-note">
        Time totals cover the full net duration of closed Work Sessions started in the selected
        period, excluding pauses. Open sessions are shown separately. Tool sessions are counted
        separately and never added to work hours.
      </p>
      <div className="v4-report-charts">
        <Bars
          title="Workload by sales owner"
          rows={report.bySales}
          onSelect={(label) =>
            setDetail({
              title: label,
              rows: report.projects.filter((p) => p.salesOwnerName === label),
            })
          }
        />
        <Bars
          title="Project status"
          rows={report.byStatus}
          onSelect={(label) =>
            setDetail({
              title: label,
              rows: report.projects.filter((p) => statusLabels[p.statusAtPeriodEnd] === label),
            })
          }
        />
        <Bars
          title="Work hours by project"
          unit="hours"
          onSelect={(label) =>
            setDetail({
              title: label,
              rows: report.projects.filter((p) => `${p.projectCode} · ${p.projectName}` === label),
            })
          }
          rows={report.projects
            .map((p) => ({
              label: p.projectCode + ' · ' + p.projectName,
              value: (p.workSeconds ?? 0) / 3600,
            }))
            .sort((a, b) => b.value - a.value)}
        />
        <Bars
          title="Revisions & packages"
          unit="records"
          onSelect={(label) =>
            setDetail({
              title: label,
              rows: report.projects.filter((p) =>
                label === 'Revisions created'
                  ? p.revisionCount > 0
                  : label === 'Packages created'
                    ? p.packageCount > 0
                    : (p.completedDeliverableCount ?? 0) > 0,
              ),
            })
          }
          rows={[
            { label: 'Revisions created', value: report.revisionsCreated },
            { label: 'Packages created', value: report.packagesCreated },
            { label: 'Deliverables completed', value: report.deliverablesCompleted },
          ]}
        />
      </div>
      {detail && (
        <V4FloatingWorkspace
          open
          title={detail.title}
          onRequestClose={closeDetail}
          footer={<V4Button onClick={closeDetail}>Close</V4Button>}
        >
          <label>
            Search projects
            <input value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <V4FilterSelect
            label="Sort projects"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'name', label: 'Project name' },
              { value: 'hours', label: 'Most work hours' },
            ]}
          />
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Work hours</th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map((p) => (
                <tr key={p.projectId}>
                  <td>
                    <Link to={`/projects/${p.projectId}/summary`}>
                      {p.projectCode} · {p.projectName}
                    </Link>
                  </td>
                  <td>{p.salesOwnerName}</td>
                  <td>{statusLabels[p.statusAtPeriodEnd] ?? p.statusAtPeriodEnd}</td>
                  <td>{((p.workSeconds ?? 0) / 3600).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!detailRows.length && <p>No matching projects.</p>}
        </V4FloatingWorkspace>
      )}
    </section>
  );
}
