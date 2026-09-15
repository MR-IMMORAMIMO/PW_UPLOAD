import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Clock3, Download, FolderCheck, History, TriangleAlert } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ReportSeriesItem } from '@scli/domain';
import { api } from '../api';
import { useToast } from '../components/toast';
import { ErrorState, KpiCard, LoadingState, PageHeader, SectionHeading } from '../components/ui';

function AccessibleBarChart({
  title,
  data,
  color = '#008c95',
}: {
  title: string;
  data: ReportSeriesItem[];
  color?: string;
}) {
  return (
    <section className="report-chart-card">
      <SectionHeading
        title={title}
        detail={`${data.reduce((sum, item) => sum + item.value, 0)} projects represented`}
      />
      <div className="chart-canvas" role="img" aria-label={`${title} bar chart`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.slice(0, 10)} margin={{ top: 8, right: 8, bottom: 24, left: -14 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--chart-text)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={62}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--chart-text)', fontSize: 11 }}
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
            <Bar dataKey="value" name="Projects" fill={color} radius={[6, 6, 2, 2]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="chart-data-table">
        <summary>View underlying data</summary>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Projects</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.label}>
                <td>{item.label}</td>
                <td>{item.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export function ReportsScreen() {
  const reportQuery = useQuery({ queryKey: ['report-summary'], queryFn: api.reportSummary });
  const { showToast } = useToast();
  const [exporting, setExporting] = useState(false);
  if (reportQuery.isLoading) return <LoadingState label="Calculating reports…" />;
  if (reportQuery.error || !reportQuery.data)
    return (
      <ErrorState
        message={(reportQuery.error as Error | null)?.message ?? 'Report unavailable.'}
        onRetry={() => reportQuery.refetch()}
      />
    );
  const report = reportQuery.data;
  const hoursData = [
    { label: 'Estimated', value: report.totalEstimatedHours },
    { label: 'Actual', value: report.totalActualHours },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Portfolio intelligence"
        title="Reports"
        description="Understand workload, delivery performance and revision patterns with accessible charts and exportable data."
        actions={
          <button
            className="button primary"
            type="button"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await api.downloadCsv();
                showToast('CSV export downloaded.');
              } catch (error) {
                showToast((error as Error).message, 'error');
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download size={17} /> {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      />
      <section className="kpi-grid four-up">
        <KpiCard
          icon={<FolderCheck />}
          label="Total projects"
          value={report.totalProjects}
          detail={`${report.activeProjects} currently active`}
          tone="accent"
        />
        <KpiCard
          icon={<TriangleAlert />}
          label="Overdue projects"
          value={report.overdueProjects}
          detail="Past the required delivery date"
          tone={report.overdueProjects ? 'danger' : 'default'}
        />
        <KpiCard
          icon={<Clock3 />}
          label="Average completion"
          value={`${report.averageCompletionDays}d`}
          detail="Creation to completion"
        />
        <KpiCard
          icon={<History />}
          label="Total revisions"
          value={report.revisionCounts.reduce((sum, item) => sum + item.value, 0)}
          detail={`${report.revisionCounts.length} projects revised`}
        />
      </section>
      <div className="reports-grid">
        <AccessibleBarChart
          title="Projects by Lighting Designer"
          data={report.projectsByDesigner}
        />
        <AccessibleBarChart
          title="Projects by Sales Owner"
          data={report.projectsBySalesOwner}
          color="#77a7ff"
        />
        <AccessibleBarChart
          title="Projects by status"
          data={report.projectsByStatus}
          color="#ffd166"
        />
        <AccessibleBarChart
          title="Completed projects by month"
          data={report.completedByMonth}
          color="#c49cff"
        />
      </div>
      <section className="hours-comparison-card">
        <SectionHeading
          title="Estimated versus actual hours"
          detail="Portfolio-level delivery effort"
        />
        <div className="hours-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hoursData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: 'var(--chart-text)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                dataKey="label"
                type="category"
                tick={{ fill: 'var(--chart-text)' }}
                axisLine={false}
                tickLine={false}
                width={76}
              />
              <Tooltip
                contentStyle={{
                  background: '#111820',
                  border: '1px solid #263543',
                  borderRadius: 12,
                }}
              />
              <Legend />
              <Bar dataKey="value" name="Hours" fill="#008c95" radius={[0, 7, 7, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>Estimated versus actual hours</caption>
          <tbody>
            {hoursData.map((item) => (
              <tr key={item.label}>
                <th>{item.label}</th>
                <td>{item.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="revision-table-section">
        <SectionHeading title="Revision counts" detail="Projects with at least one revision" />
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Project code</th>
                <th>Revisions</th>
              </tr>
            </thead>
            <tbody>
              {report.revisionCounts.map((item) => (
                <tr key={item.label}>
                  <td>
                    <BarChart3 size={15} /> {item.label}
                  </td>
                  <td>{item.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
