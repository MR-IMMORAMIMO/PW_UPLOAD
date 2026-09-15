import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PortfolioSnapshot } from './PortfolioSnapshot';
import type { PeriodActivityReport } from '@scli/domain';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4Button } from '../../components/common/V4Button';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { formatBusinessDateTime, formatBusinessDateOnly } from '../../date-time/businessDateTime';

export type ReportTab = 'Overview' | 'Workload' | 'Technical' | 'Deliverables' | 'Follow-up';
type Snapshot = NonNullable<PeriodActivityReport['currentProjects']>[number];
type MetricKey = {
  [K in keyof Snapshot]-?: NonNullable<Snapshot[K]> extends number ? K : never;
}[keyof Snapshot];
const columns: Record<
  Exclude<ReportTab, 'Overview' | 'Workload'>,
  Array<{ label: string; key: MetricKey; route: string }>
> = {
  Technical: [
    { label: 'Luminaires', key: 'luminaires', route: 'luminaires' },
    { label: 'Missing datasheets', key: 'missingDatasheets', route: 'datasheets-images' },
    { label: 'Missing images', key: 'missingImages', route: 'datasheets-images' },
    { label: 'Incomplete W / lm / CCT', key: 'incompleteTechnical', route: 'luminaires' },
    { label: 'Open requirements', key: 'openRequirements', route: 'scope' },
    {
      label: 'Project checks needing attention',
      key: 'failedQualityChecks',
      route: 'technical-check',
    },
  ],
  Deliverables: [
    { label: 'Revisions', key: 'revisions', route: 'revisions' },
    { label: 'Generated outputs', key: 'generatedOutputs', route: 'revisions' },
    { label: 'Issued packages', key: 'issuedPackages', route: 'packages' },
    { label: 'Required / optional outputs', key: 'deliverables', route: 'scope' },
    { label: 'Completed outputs', key: 'completedDeliverables', route: 'scope' },
  ],
  'Follow-up': [
    { label: 'Open actions', key: 'openActions', route: 'actions' },
    { label: 'Overdue actions', key: 'overdueActions', route: 'actions' },
    { label: 'Unresolved reviews', key: 'unresolvedReviews', route: 'comments' },
    { label: 'Upcoming meetings', key: 'upcomingMeetings', route: 'meetings' },
  ],
};
const hours = (value: number) => `${(value / 3600).toFixed(1)} h`;
export function ReportDetailPane({
  report,
  tab,
}: {
  report: PeriodActivityReport;
  tab: Exclude<ReportTab, 'Overview'>;
}) {
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(0);
  const [project, setProject] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<{ title: string; ids: string[] } | null>(null);
  const [group, setGroup] = useState('day');
  const [detailSearch, setDetailSearch] = useState('');
  const [detailSort, setDetailSort] = useState('date');
  const [metric, setMetric] = useState<{
    label: string;
    key: MetricKey;
    route: string;
  } | null>(null);
  const sessions = report.sessions ?? [];
  const sessionTotal = sessions.reduce((sum, item) => sum + (item.netSeconds ?? 0), 0);
  const closed = sessions.filter((item) => item.netSeconds !== null).length;
  const times = [...report.projects].sort((a, b) =>
    sort === 'name'
      ? a.projectName.localeCompare(b.projectName)
      : (b.workSeconds ?? 0) - (a.workSeconds ?? 0),
  );
  const snapshots = [...(report.currentProjects ?? [])].sort((a, b) =>
    sort === 'name'
      ? a.projectName.localeCompare(b.projectName)
      : Number(b[tab === 'Workload' ? 'openActions' : columns[tab][0]!.key]) -
        Number(a[tab === 'Workload' ? 'openActions' : columns[tab][0]!.key]),
  );
  const series = new Map<string, number>();
  const seriesLabels = new Map<string, string>();
  const seriesSessions = new Map<string, string[]>();
  for (const item of sessions) {
    let key = item.day;
    if (group === 'week') {
      const date = new Date(`${key}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = `Week of ${date.toISOString().slice(0, 10)}`;
      seriesLabels.set(key, `Week of ${formatBusinessDateOnly(date.toISOString().slice(0, 10))}`);
    }
    if (group === 'day') seriesLabels.set(key, formatBusinessDateOnly(key));
    if (group === 'project') {
      key = item.projectId;
      seriesLabels.set(
        key,
        `${item.projectName} · ${report.projects.find((project) => project.projectId === item.projectId)?.projectCode ?? ''}`,
      );
    }
    if (group === 'user') {
      key = item.actorId ?? 'unrecorded';
      seriesLabels.set(key, item.actorName ?? 'Operator not recorded');
    }
    series.set(key, (series.get(key) ?? 0) + (item.netSeconds ?? 0));
    seriesSessions.set(key, [...(seriesSessions.get(key) ?? []), item.id]);
  }
  const chart = [...series].sort((a, b) =>
    group === 'user' || group === 'project'
      ? (seriesLabels.get(a[0]) ?? a[0]).localeCompare(seriesLabels.get(b[0]) ?? b[0])
      : a[0].localeCompare(b[0]),
  );
  const max = Math.max(1, ...chart.map((entry) => entry[1]));
  const count = tab === 'Workload' ? times.length : snapshots.length;
  const current = Math.min(page, Math.max(0, Math.ceil(count / 10) - 1));
  const detailMatches = (value: string) =>
    value.toLowerCase().includes(detailSearch.trim().toLowerCase());
  const selection = sessions
    .filter(
      (item) =>
        (sessionDetail ? sessionDetail.ids.includes(item.id) : item.projectId === project) &&
        detailMatches(
          `${item.projectName} ${item.actorName ?? 'Operator not recorded'} ${item.state}`,
        ),
    )
    .sort((a, b) =>
      detailSort === 'time'
        ? (b.netSeconds ?? -1) - (a.netSeconds ?? -1)
        : b.startedAt.localeCompare(a.startedAt),
    );
  const closeSessions = () => {
    setProject(null);
    setSessionDetail(null);
    setDetailSearch('');
  };
  return (
    <>
      <p>
        {tab === 'Workload'
          ? 'Closed session net time for sessions started in the selected period. Pauses excluded; open sessions and external tools are counted separately.'
          : `Current workspace snapshot as of ${formatBusinessDateTime(report.generatedAt)}. The date filter above applies to period activity in Overview and Workload.`}
      </p>
      {tab === 'Workload' ? (
        <>
          <PortfolioSnapshot report={report} workload />
          <section className="v4-report-summary" aria-label="Work session totals">
            {[
              ['Net work time', hours(sessionTotal)],
              ['Closed sessions', closed],
              ['Average closed session', closed ? hours(sessionTotal / closed) : '—'],
              ['Open sessions', sessions.length - closed],
            ].map(([label, value]) => (
              <button
                type="button"
                key={label}
                aria-label={`${label}: ${value}`}
                onClick={() => {
                  setDetailSearch('');
                  setProject(null);
                  setSessionDetail({
                    title: String(label),
                    ids: sessions
                      .filter((item) =>
                        label === 'Open sessions'
                          ? item.netSeconds === null
                          : item.netSeconds !== null,
                      )
                      .map((item) => item.id),
                  });
                }}
              >
                <span>{label}</span>
                <strong>{value}</strong>
              </button>
            ))}
          </section>
          <section className="v4-report-chart" aria-label="Work time trend">
            <V4FilterSelect
              label="Group work time"
              value={group}
              onChange={setGroup}
              options={[
                { value: 'day', label: 'By day' },
                { value: 'week', label: 'By week' },
                { value: 'project', label: 'By project' },
                { value: 'user', label: 'By user' },
              ]}
            />
            {!chart.length ? (
              <p>No recorded sessions in this period.</p>
            ) : (
              chart.map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '180px 1fr 70px',
                    gap: 12,
                    alignItems: 'center',
                    marginTop: 10,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setProject(null);
                      setSessionDetail({
                        title: seriesLabels.get(label) ?? label,
                        ids: seriesSessions.get(label) ?? [],
                      });
                    }}
                  >
                    {seriesLabels.get(label) ?? label}
                  </button>
                  <div
                    style={{ height: 16, background: 'var(--v4-surface-muted)', borderRadius: 8 }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${(value / max) * 100}%`,
                        background: 'var(--report-color-0)',
                        borderRadius: 8,
                      }}
                    />
                  </div>
                  <strong>{hours(value)}</strong>
                </div>
              ))
            )}
            <p>Sessions created before operator tracking appear as Operator not recorded.</p>
            <details>
              <summary>View work time data</summary>
              <table aria-label="Work time data">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Net seconds</th>
                    <th>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {chart.map(([key, value]) => (
                    <tr key={key}>
                      <th scope="row">{seriesLabels.get(key) ?? key}</th>
                      <td>{value}</td>
                      <td>{hours(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
        </>
      ) : (
        <section className="v4-report-summary" aria-label={`${tab} totals`}>
          {columns[tab].map((column) => (
            <button
              type="button"
              key={column.key}
              aria-label={`${column.label}: ${snapshots.reduce((sum, item) => sum + Number(item[column.key] ?? 0), 0)}`}
              onClick={() => {
                setMetric(column);
                setDetailSearch('');
                setDetailSort('value');
              }}
            >
              <span>{column.label}</span>
              <strong>
                {snapshots.reduce((sum, item) => sum + Number(item[column.key] ?? 0), 0)}
              </strong>
            </button>
          ))}
        </section>
      )}
      <div className="v4-reports__filters">
        <V4FilterSelect
          label="Sort report"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'name', label: 'Project name' },
            {
              value: 'value',
              label:
                tab === 'Workload'
                  ? 'Most work time'
                  : `Most ${columns[tab][0]!.label.toLowerCase()}`,
            },
          ]}
        />
      </div>
      <section className="v4-reports__table" aria-label={`${tab} project details`}>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              {tab === 'Workload' ? (
                <>
                  <th>Net time</th>
                  <th>Average closed session</th>
                  <th>Sessions</th>
                  <th>Open</th>
                  <th>Tool sessions</th>
                  <th>Details</th>
                </>
              ) : (
                columns[tab].map((column) => <th key={column.key}>{column.label}</th>)
              )}
            </tr>
          </thead>
          <tbody>
            {tab === 'Workload'
              ? times.slice(current * 10, current * 10 + 10).map((item) => (
                  <tr key={item.projectId}>
                    <td>
                      <Link to={`/projects/${item.projectId}/summary`}>{item.projectName}</Link>
                      <small>{item.projectCode}</small>
                    </td>
                    <td>{hours(item.workSeconds ?? 0)}</td>
                    <td>
                      {(item.workSessionCount ?? 0) - (item.openWorkSessionCount ?? 0) > 0
                        ? hours(
                            (item.workSeconds ?? 0) /
                              ((item.workSessionCount ?? 0) - (item.openWorkSessionCount ?? 0)),
                          )
                        : '—'}
                    </td>
                    <td>{item.workSessionCount ?? '—'}</td>
                    <td>{item.openWorkSessionCount ?? '—'}</td>
                    <td>{item.toolSessionCount ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setSessionDetail(null);
                          setProject(item.projectId);
                        }}
                      >
                        View sessions
                      </button>
                    </td>
                  </tr>
                ))
              : snapshots.slice(current * 10, current * 10 + 10).map((item) => (
                  <tr key={item.projectId}>
                    <td>
                      <Link to={`/projects/${item.projectId}/summary`}>{item.projectName}</Link>
                      <small>{item.projectCode}</small>
                    </td>
                    {columns[tab].map((column) => (
                      <td key={column.key}>
                        <Link to={`/projects/${item.projectId}/${column.route}`}>
                          {item[column.key] ?? '—'}
                        </Link>
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
        {!count && <p>No projects match these filters.</p>}
        {tab === 'Deliverables' && (
          <>
            <h2>Readiness of the latest revision</h2>
            <table aria-label="Latest revision readiness">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Revision</th>
                  <th>Readiness</th>
                  <th>Blockers</th>
                  <th>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((item) => (
                  <tr key={item.projectId}>
                    <td>
                      <Link to={`/projects/${item.projectId}/packages`}>{item.projectName}</Link>
                    </td>
                    <td>{item.readiness?.revisionLabel ?? 'No revision'}</td>
                    <td>{item.readiness?.level.replaceAll('_', ' ') ?? 'Not checked'}</td>
                    <td>{item.readiness?.blockers ?? '—'}</td>
                    <td>{item.readiness?.warnings ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Readiness is checked now for the named revision. Open its project to resolve findings
              before issue.
            </p>
          </>
        )}
        <div className="v4-reports__actions">
          <V4Button disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </V4Button>
          <span>
            Page {current + 1} of {Math.max(1, Math.ceil(count / 10))}
          </span>
          <V4Button disabled={(current + 1) * 10 >= count} onClick={() => setPage(current + 1)}>
            Next
          </V4Button>
        </div>
      </section>
      {(project || sessionDetail) && (
        <V4FloatingWorkspace
          bodyClassName="v4-report-detail"
          open
          title={sessionDetail ? `Work sessions · ${sessionDetail.title}` : 'Project work sessions'}
          onRequestClose={closeSessions}
          footer={<V4Button onClick={closeSessions}>Close</V4Button>}
        >
          <div className="v4-reports__filters">
            <label>
              Search sessions
              <input
                value={detailSearch}
                onChange={(event) => setDetailSearch(event.target.value)}
              />
            </label>
            <V4FilterSelect
              label="Sort sessions"
              value={detailSort}
              onChange={setDetailSort}
              options={[
                { value: 'date', label: 'Latest started' },
                { value: 'time', label: 'Most net time' },
              ]}
            />
          </div>
          <div className="v4-reports__table">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Started</th>
                  <th>Ended</th>
                  <th>State</th>
                  <th>Paused</th>
                  <th>Operator</th>
                  <th>Net time</th>
                </tr>
              </thead>
              <tbody>
                {selection.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/projects/${item.projectId}/summary`}>{item.projectName}</Link>
                    </td>
                    <td>{formatBusinessDateTime(item.startedAt)}</td>
                    <td>{item.endedAt ? formatBusinessDateTime(item.endedAt) : 'Open'}</td>
                    <td>{item.state}</td>
                    <td>{hours(item.pausedSeconds)}</td>
                    <td>{item.actorName ?? 'Operator not recorded'}</td>
                    <td>{item.netSeconds === null ? 'Not included' : hours(item.netSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!selection.length && <p>No session records in this period.</p>}
          </div>
        </V4FloatingWorkspace>
      )}
      {metric && (
        <V4FloatingWorkspace
          bodyClassName="v4-report-detail"
          open
          title={metric.label}
          onRequestClose={() => setMetric(null)}
          footer={<V4Button onClick={() => setMetric(null)}>Close</V4Button>}
        >
          <div className="v4-reports__filters">
            <label>
              Search metric projects
              <input
                value={detailSearch}
                onChange={(event) => setDetailSearch(event.target.value)}
              />
            </label>
            <V4FilterSelect
              label="Sort metric projects"
              value={detailSort}
              onChange={setDetailSort}
              options={[
                { value: 'value', label: 'Highest count' },
                { value: 'name', label: 'Project name' },
              ]}
            />
          </div>
          <div className="v4-reports__table">
            <table aria-label={`${metric.label} details`}>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>{metric.label}</th>
                </tr>
              </thead>
              <tbody>
                {snapshots
                  .filter(
                    (item) =>
                      Number(item[metric.key] ?? 0) > 0 &&
                      detailMatches(`${item.projectName} ${item.projectCode}`),
                  )
                  .sort((a, b) =>
                    detailSort === 'name'
                      ? a.projectName.localeCompare(b.projectName)
                      : Number(b[metric.key]) - Number(a[metric.key]),
                  )
                  .map((item) => (
                    <tr key={item.projectId}>
                      <td>
                        <Link to={`/projects/${item.projectId}/${metric.route}`}>
                          {item.projectName}
                        </Link>
                        <small>{item.projectCode}</small>
                      </td>
                      <td>{item[metric.key]}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p>Current workspace counts. Open a project to review its records.</p>
          </div>
        </V4FloatingWorkspace>
      )}
    </>
  );
}
