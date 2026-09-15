import { Link } from 'react-router-dom';
import type { Project, ProjectWorkspace, RevisionCycle, WorkspaceActivity } from '@scli/domain';
import { formatDate } from './ui';
import {
  DUE_SEMANTIC_LABEL,
  needAttention,
  nextAction,
  projectContextHeader,
  projectSnapshot,
  recentActivity,
  stageRail,
  type AttentionItem,
  type NextAction,
  type ProjectContextHeader,
  type ProjectSnapshot,
  type StageRail,
} from '../project-summary-model';
import { projectSectionHref } from '../navigation';

/**
 * P2-UX-04A Summary composition. Pure presentation over canonical data.
 * No persistence, no fabricated history, no speculative upcoming content.
 */

function dueClass(semantic: ProjectContextHeader['dueSemantic']): string {
  if (semantic === 'overdue') return 'due-overdue';
  if (semantic === 'dueSoon') return 'due-soon';
  return 'due-normal';
}

export function ProjectContextHeaderView({ header }: { header: ProjectContextHeader }) {
  return (
    <section className="content-card project-context-header" aria-label="Project context">
      <dl className="project-context-grid">
        <div>
          <dt>Project Code</dt>
          <dd>{header.projectCode}</dd>
        </div>
        <div>
          <dt>Project Name</dt>
          <dd>{header.projectName}</dd>
        </div>
        <div>
          <dt>Client</dt>
          <dd>{header.client}</dd>
        </div>
        <div>
          <dt>Project Type</dt>
          <dd>{header.projectType}</dd>
        </div>
        <div>
          <dt>Design Stage</dt>
          <dd>{header.designStage}</dd>
        </div>
        <div>
          <dt>Due Date</dt>
          <dd className={dueClass(header.dueSemantic)}>
            {formatDate(header.dueDate)}
            {DUE_SEMANTIC_LABEL[header.dueSemantic] ? (
              <span className="due-semantic-label">
                {' '}
                · {DUE_SEMANTIC_LABEL[header.dueSemantic]}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function StageRailView({ rail }: { rail: StageRail }) {
  return (
    <section className="content-card stage-rail-card" aria-label="Workflow progress">
      <div className="stage-rail-heading">
        <h2>Workflow Progress</h2>
        {rail.cycleNumber !== null ? (
          <span className="cycle-badge">Revision Cycle {rail.cycleNumber}</span>
        ) : null}
      </div>
      <ol className="stage-rail">
        {rail.nodes.map((node) => (
          <li key={node.id} className={`stage-rail-node ${node.state}`}>
            <span className="stage-rail-dot" aria-hidden="true" />
            <span className="stage-rail-label">{node.label}</span>
          </li>
        ))}
      </ol>
      {rail.auxiliary.length ? (
        <div className="stage-rail-auxiliary">
          {rail.auxiliary.map((label) => (
            <span key={label} className="stage-rail-aux-chip">
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AttentionItemRow({ projectId, item }: { projectId: string; item: AttentionItem }) {
  return (
    <Link
      to={projectSectionHref(projectId, item.targetSection)}
      className={`attention-item attention-${item.severity.toLowerCase()}`}
    >
      <span className="attention-severity">{item.severity}</span>
      <span className="attention-reason">{item.reason}</span>
      <span className="attention-detail">{item.detail}</span>
    </Link>
  );
}

export function NeedAttentionView({
  projectId,
  items,
}: {
  projectId: string;
  items: AttentionItem[];
}) {
  return (
    <section className="content-card" aria-label="Need your attention">
      <h2>Need Your Attention</h2>
      {items.length ? (
        <div className="attention-list">
          {items.map((item) => (
            <AttentionItemRow key={item.key} projectId={projectId} item={item} />
          ))}
        </div>
      ) : (
        <p className="muted-copy">Nothing needs your attention right now.</p>
      )}
    </section>
  );
}

export function ProjectSnapshotView({ snapshot }: { snapshot: ProjectSnapshot }) {
  return (
    <section className="content-card" aria-label="Project snapshot">
      <h2>Project Snapshot</h2>
      <dl className="detail-list">
        <div>
          <dt>Luminaires</dt>
          <dd>{snapshot.luminaireCount}</dd>
        </div>
        <div>
          <dt>Latest Revision</dt>
          <dd>
            {snapshot.latestRevision
              ? `Revision ${String(snapshot.latestRevision.revisionNumber).padStart(2, '0')}`
              : 'No revision yet'}
          </dd>
        </div>
        <div>
          <dt>Due Date</dt>
          <dd className={dueClass(snapshot.dueSemantic)}>
            {formatDate(snapshot.dueDate)}
            {DUE_SEMANTIC_LABEL[snapshot.dueSemantic] ? (
              <span className="due-semantic-label">
                {' '}
                · {DUE_SEMANTIC_LABEL[snapshot.dueSemantic]}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Open Actions</dt>
          <dd>{snapshot.openActions}</dd>
        </div>
      </dl>
    </section>
  );
}

export function NextActionView({ projectId, action }: { projectId: string; action: NextAction }) {
  return (
    <section className="content-card" aria-label="Next action">
      <h2>Next Action</h2>
      <p className="next-action-title">{action.title}</p>
      <p className="muted-copy">{action.detail}</p>
      <Link to={projectSectionHref(projectId, action.targetSection)} className="button secondary">
        {action.ctaLabel}
      </Link>
    </section>
  );
}

export function RecentActivityView({ items }: { items: ReturnType<typeof recentActivity> }) {
  return (
    <section className="content-card" aria-label="Recent activity">
      <h2>Recent Activity</h2>
      {items.length ? (
        <ol className="recent-activity-list">
          {items.map((item) => (
            <li key={item.id} className="recent-activity-item">
              <div className="recent-activity-head">
                <strong className="recent-activity-title">{item.title}</strong>
                <time className="recent-activity-time" dateTime={item.timestamp}>
                  {formatDate(item.timestamp, { month: 'short', day: 'numeric' })}
                </time>
              </div>
              <p className="recent-activity-detail">{item.detail}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted-copy">No activity recorded yet.</p>
      )}
    </section>
  );
}

export interface ProjectSummaryProps {
  project: Project;
  workspace: ProjectWorkspace;
  cycles: RevisionCycle[];
  activity: WorkspaceActivity[];
}

export function ProjectSummary({ project, workspace, cycles, activity }: ProjectSummaryProps) {
  const header = projectContextHeader(project);
  const rail = stageRail(project, cycles);
  const attention = needAttention(workspace.health);
  const snapshot = projectSnapshot(project, workspace);
  const action = nextAction(project, workspace.health);
  const recent = recentActivity(activity);

  return (
    <div className="operations-main-stack">
      <ProjectContextHeaderView header={header} />
      <StageRailView rail={rail} />
      <div className="project-overview-grid">
        <NeedAttentionView projectId={project.id} items={attention} />
        <ProjectSnapshotView snapshot={snapshot} />
      </div>
      <div className="project-overview-grid">
        <NextActionView projectId={project.id} action={action} />
        <RecentActivityView items={recent} />
      </div>
    </div>
  );
}
