import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarClock,
  ChevronDown,
  Clock3,
  Gauge,
  Save,
  UserCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AvailabilityStatus, WorkloadMetrics } from '@scli/domain';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { useToast } from '../components/toast';
import {
  Avatar,
  Deadline,
  EmptyState,
  ErrorState,
  KpiCard,
  LoadingState,
  PageHeader,
  ProgressBar,
  StatusBadge,
} from '../components/ui';

export function DesignerCard({
  workload,
  canConfigure,
  onSave,
}: {
  workload: WorkloadMetrics;
  canConfigure: boolean;
  onSave: (id: string, capacity: number, status: AvailabilityStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [capacity, setCapacity] = useState(workload.weeklyCapacityHours);
  const [availability, setAvailability] = useState(workload.designer.availabilityStatus);
  return (
    <article className="designer-workload-card">
      <header>
        <Avatar user={workload.designer} size="lg" />
        <div>
          <div className="designer-title-line">
            <h2>{workload.designer.displayName}</h2>
            <span className={`availability-badge availability-${workload.classification}`}>
              {workload.classification}
            </span>
          </div>
          <p>{workload.designer.jobTitle}</p>
          <span>{workload.designer.email}</span>
        </div>
      </header>
      <div className="workload-ring-row">
        <div
          className="workload-ring"
          style={
            {
              '--value': `${Math.min(workload.utilizationPercent, 100) * 3.6}deg`,
            } as React.CSSProperties
          }
        >
          <span>
            <strong>{workload.utilizationPercent}%</strong>
            <small>utilized</small>
          </span>
        </div>
        <dl>
          <div>
            <dt>Active projects</dt>
            <dd>{workload.activeProjectCount}</dd>
          </div>
          <div>
            <dt>Estimated load</dt>
            <dd>{workload.activeEstimatedHours}h</dd>
          </div>
          <div>
            <dt>Capacity left</dt>
            <dd>{workload.remainingCapacity}h</dd>
          </div>
          <div>
            <dt>Overdue</dt>
            <dd className={workload.overdueProjectCount ? 'danger-text' : ''}>
              {workload.overdueProjectCount}
            </dd>
          </div>
        </dl>
      </div>
      <ProgressBar
        value={Math.min(workload.utilizationPercent, 100)}
        label={`${workload.activeEstimatedHours}h of ${workload.weeklyCapacityHours}h weekly capacity`}
      />
      <div className="workload-next">
        <CalendarClock size={16} />
        <span>
          <small>Next deadline</small>
          <strong>
            {workload.nextDeadline ? (
              <Deadline date={workload.nextDeadline} />
            ) : (
              'No active deadline'
            )}
          </strong>
        </span>
      </div>
      {canConfigure ? (
        <div className="capacity-controls">
          <label>
            Weekly capacity
            <input
              type="number"
              min="0"
              max="168"
              value={capacity}
              onChange={(event) => setCapacity(Number(event.target.value))}
            />
          </label>
          <label>
            Manual availability
            <select
              value={availability}
              onChange={(event) => setAvailability(event.target.value as AvailabilityStatus)}
            >
              <option>Available</option>
              <option>Limited</option>
              <option>FullyLoaded</option>
              <option>Unavailable</option>
            </select>
          </label>
          <button
            className="icon-button accent"
            type="button"
            title="Save capacity"
            aria-label={`Save capacity for ${workload.designer.displayName}`}
            onClick={() => onSave(workload.designer.id, capacity, availability)}
          >
            <Save size={17} />
          </button>
        </div>
      ) : null}
      <button
        className="expand-projects"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Active project list <span>{workload.activeProjectCount}</span>
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className="designer-project-list">
          {workload.activeProjects.map((project) => (
            <Link to={`/projects/${project.id}`} key={project.id}>
              <span>
                <strong>{project.projectName}</strong>
                <small>
                  {project.projectCode} · {project.estimatedHours}h
                </small>
              </span>
              <StatusBadge status={project.status} />
            </Link>
          ))}
          {!workload.activeProjects.length ? <p>No active projects.</p> : null}
        </div>
      ) : null}
    </article>
  );
}

export function DesignersScreen() {
  const { currentUser } = useAppContext();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const workloadQuery = useQuery({ queryKey: ['workloads'], queryFn: api.workloads });
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      weeklyCapacityHours,
      availabilityStatus,
    }: {
      id: string;
      weeklyCapacityHours: number;
      availabilityStatus: AvailabilityStatus;
    }) => api.updateUser(id, { weeklyCapacityHours, availabilityStatus }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workloads'] });
      showToast('Lighting Designer capacity updated.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const workloads = workloadQuery.data ?? [];
  const totalCapacity = workloads.reduce((sum, item) => sum + item.weeklyCapacityHours, 0);
  const totalLoad = workloads.reduce((sum, item) => sum + item.activeEstimatedHours, 0);
  const averageUtilization = totalCapacity ? Math.round((totalLoad / totalCapacity) * 100) : 0;

  if (workloadQuery.isLoading)
    return <LoadingState label="Calculating Lighting Designer workload…" />;
  if (workloadQuery.error)
    return (
      <ErrorState
        message={(workloadQuery.error as Error).message}
        onRetry={() => workloadQuery.refetch()}
      />
    );

  return (
    <>
      <PageHeader
        eyebrow="Studio capacity"
        title="Lighting Designer workload"
        description="Availability is a recommendation based on active hours, capacity, deadlines and explicit availability."
      />
      <section className="kpi-grid four-up">
        <KpiCard
          icon={<UserCheck />}
          label="Active Lighting Designers"
          value={workloads.length}
          detail={`${workloads.filter((item) => item.classification === 'Available').length} available now`}
          tone="accent"
        />
        <KpiCard
          icon={<Clock3 />}
          label="Weekly capacity"
          value={`${totalCapacity}h`}
          detail={`${Math.max(totalCapacity - totalLoad, 0)}h remaining`}
        />
        <KpiCard
          icon={<Gauge />}
          label="Average utilization"
          value={`${averageUtilization}%`}
          detail="Across the active studio"
          tone={averageUtilization > 90 ? 'warning' : 'default'}
        />
        <KpiCard
          icon={<AlertTriangle />}
          label="Overdue workload"
          value={workloads.reduce((sum, item) => sum + item.overdueProjectCount, 0)}
          detail="Projects beyond required date"
          tone="danger"
        />
      </section>
      <div className="designer-workload-grid">
        {workloads.map((workload) => (
          <DesignerCard
            key={workload.designer.id}
            workload={workload}
            canConfigure={currentUser.role === 'Admin'}
            onSave={(id, capacity, status) =>
              updateMutation.mutate({
                id,
                weeklyCapacityHours: capacity,
                availabilityStatus: status,
              })
            }
          />
        ))}
      </div>
      {!workloads.length ? (
        <EmptyState
          title="No Lighting Designers configured"
          description="An Admin can activate Lighting Designer users in Settings."
        />
      ) : null}
      <div className="recommendation-note">
        <BriefcaseBusiness size={18} />
        <div>
          <strong>How recommendations work</strong>
          <p>
            Lighting Designers are ranked by remaining capacity, active projects, overdue work and
            availability. Line Managers can override the recommendation with an audited reason.
          </p>
        </div>
      </div>
    </>
  );
}
