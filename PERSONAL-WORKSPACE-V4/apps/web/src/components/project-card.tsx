import { motion } from 'motion/react';
import { ArrowUpRight, UserRoundPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Project } from '@scli/domain';
import { Deadline, PriorityBadge, ProgressBar, StatusBadge } from './ui';
import { useAppContext } from '../app-context';
import { personalStatusLabel } from '../personal-status';
import { salesTone } from '../sales-color';

export function ProjectCard({
  project,
  onAssign,
  compact = false,
}: {
  project: Project;
  onAssign?: (project: Project) => void;
  compact?: boolean;
}) {
  const { integrationStatus } = useAppContext();
  const personal = integrationStatus.workspaceVariant === 'personal';
  return (
    <motion.article
      layout
      className={`project-card${compact ? ' project-card-compact' : ''}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.22 }}
    >
      <div className="project-card-top">
        <span className="project-code" title={project.projectCode}>
          {project.projectCode}
        </span>
        <PriorityBadge priority={project.priority} />
      </div>
      <div>
        <h3>
          <Link to={`/projects/${project.id}`} title={project.projectName}>
            {project.projectName}
          </Link>
        </h3>
        <p title={project.clientName}>{project.clientName}</p>
      </div>
      <div className="project-card-badges">
        <StatusBadge
          status={project.status}
          label={personal ? personalStatusLabel(project.status) : undefined}
        />
        <Deadline date={project.requiredDeliveryDate} />
      </div>
      {!compact ? <ProgressBar value={project.progressPercent} /> : null}
      <div className="project-card-footer">
        {personal ? (
          <>
            <div>
              <small>Scope</small>
              <span>{project.services?.length ?? 0} deliverables</span>
            </div>
            <div>
              <small>Project folder</small>
              <span>{project.projectFolderPath ? 'Created' : 'Not created'}</span>
            </div>
            <div>
              <small>Salesperson</small>
              <span
                className={`sales-chip ${salesTone(project.salesOwnerId || project.salesOwnerNameSnapshot)}`}
                title={project.salesOwnerNameSnapshot || 'Direct'}
              >
                {project.salesOwnerNameSnapshot || 'Direct'}
              </span>
            </div>
          </>
        ) : (
          <>
            <div>
              <small>Sales Owner</small>
              <span>{project.salesOwnerNameSnapshot}</span>
            </div>
            <div>
              <small>Lighting Designer</small>
              <span>{project.assignedDesignerNameSnapshot ?? 'Not assigned'}</span>
            </div>
          </>
        )}
        <div className="card-actions">
          {onAssign ? (
            <button
              className="icon-button accent"
              type="button"
              onClick={() => onAssign(project)}
              aria-label={`Assign ${project.projectName}`}
              title="Quick assign"
            >
              <UserRoundPlus size={17} />
            </button>
          ) : null}
          <Link
            className="icon-button"
            to={`/projects/${project.id}`}
            aria-label={`Open ${project.projectName}`}
            title="Open project"
          >
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </div>
    </motion.article>
  );
}
