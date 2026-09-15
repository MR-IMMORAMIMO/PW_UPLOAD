import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  History,
  MessageSquareText,
  PencilLine,
  RotateCcw,
  Send,
  UserRoundPlus,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import {
  allowedStatusTransitions,
  canRoleSetStatus,
  statusLabels,
  type Project,
  type ProjectStatus,
} from '@scli/domain';
import type { UpdateProjectInput } from '@scli/contracts';
import { api } from '../api';
import { useAppContext } from '../app-context';
import { AssignmentDrawer } from '../components/assignment-drawer';
import { LiveTimerCard } from '../components/live-timer';
import { ProjectTypeSelect } from '../components/project-type-select';
import { useToast } from '../components/toast';
import {
  Avatar,
  Deadline,
  ErrorState,
  formatDate,
  LoadingState,
  PageHeader,
  PriorityBadge,
  ProgressBar,
  StatusBadge,
} from '../components/ui';

interface EditValues {
  projectName: string;
  clientName: string;
  projectType: string;
  description: string;
  siteLocation: string;
  designStage: Project['designStage'];
  lightingScope: string;
  luxRequirements: string;
  drawingReference: string;
  progressPercent: number;
  actualHours: number;
  estimatedHours: number;
  priority: Project['priority'];
  complexity: Project['complexity'];
  requiredDeliveryDate: string;
  projectFolderUrl: string;
}

function valuesFrom(project: Project): EditValues {
  return {
    projectName: project.projectName,
    clientName: project.clientName,
    projectType: project.projectType,
    description: project.description,
    siteLocation: project.siteLocation,
    designStage: project.designStage,
    lightingScope: project.lightingScope,
    luxRequirements: project.luxRequirements,
    drawingReference: project.drawingReference,
    progressPercent: project.progressPercent,
    actualHours: project.actualHours,
    estimatedHours: project.estimatedHours,
    priority: project.priority,
    complexity: project.complexity,
    requiredDeliveryDate: project.requiredDeliveryDate,
    projectFolderUrl: project.projectFolderUrl ?? '',
  };
}

export function ProjectDetailsScreen() {
  const { id = '' } = useParams();
  const { currentUser } = useAppContext();
  const manager = currentUser.role === 'LineManager' || currentUser.role === 'Admin';
  const [assigning, setAssigning] = useState<Project | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<EditValues | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const projectQuery = useQuery({
    queryKey: ['project', id, currentUser.id],
    queryFn: () => api.project(id),
    enabled: Boolean(id),
    retry: false,
  });
  const projectTypesQuery = useQuery({
    queryKey: ['project-type-catalogue'],
    queryFn: api.projectTypeCatalogue,
  });
  const activitiesQuery = useQuery({
    queryKey: ['activities', id, currentUser.id],
    queryFn: () => api.activities(id),
    enabled: projectQuery.isSuccess,
  });
  const commentsQuery = useQuery({
    queryKey: ['comments', id, currentUser.id],
    queryFn: () => api.comments(id),
    enabled: projectQuery.isSuccess,
  });
  const timesheetsQuery = useQuery({
    queryKey: ['project-timesheets', id, currentUser.id],
    queryFn: () => api.projectTimesheets(id),
    enabled: projectQuery.isSuccess,
  });
  const project = projectQuery.data;
  useEffect(() => {
    if (project) setEditValues(valuesFrom(project));
  }, [project]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project', id] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['activities', id] }),
      queryClient.invalidateQueries({ queryKey: ['comments', id] }),
      queryClient.invalidateQueries({ queryKey: ['workloads'] }),
      queryClient.invalidateQueries({ queryKey: ['project-timesheets', id] }),
      queryClient.invalidateQueries({ queryKey: ['time-tracking'] }),
    ]);
  };
  const updateMutation = useMutation({
    mutationFn: (body: UpdateProjectInput) => api.updateProject(id, body),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
      showToast('Project details updated.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const statusMutation = useMutation({
    mutationFn: ({ status, reason }: { status: ProjectStatus; reason?: string }) =>
      api.changeStatus(id, { status, ...(reason ? { reason } : {}) }),
    onSuccess: async (updated) => {
      await invalidate();
      showToast(`Status changed to ${statusLabels[updated.status]}.`);
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const commentMutation = useMutation({
    mutationFn: () =>
      api.addComment(id, { body: commentBody, ...(attachmentUrl ? { attachmentUrl } : {}) }),
    onSuccess: async () => {
      setCommentBody('');
      setAttachmentUrl('');
      await invalidate();
      showToast('Comment added.');
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const statusOptions = useMemo(() => {
    if (!project) return [];
    return allowedStatusTransitions[project.status].filter((status) =>
      canRoleSetStatus(currentUser.role, project.status, status),
    );
  }, [currentUser.role, project]);

  if (projectQuery.isLoading) return <LoadingState label="Opening project…" />;
  if (projectQuery.error || !project || !editValues) {
    return (
      <ErrorState
        message={(projectQuery.error as Error | null)?.message ?? 'Project not found.'}
        onRetry={() => projectQuery.refetch()}
      />
    );
  }

  const canEdit = manager || currentUser.role === 'Designer' || currentUser.role === 'Sales';
  const saveEdits = () => {
    const sharedBody = {
      projectName: editValues.projectName,
      clientName: editValues.clientName,
      projectType: editValues.projectType,
      description: editValues.description,
      siteLocation: editValues.siteLocation,
      designStage: editValues.designStage,
      lightingScope: editValues.lightingScope,
      luxRequirements: editValues.luxRequirements,
      drawingReference: editValues.drawingReference,
      requiredDeliveryDate: editValues.requiredDeliveryDate,
      projectFolderUrl: editValues.projectFolderUrl || null,
      expectedVersion: project.version,
    };
    const body =
      currentUser.role === 'Designer'
        ? {
            ...sharedBody,
            progressPercent: editValues.progressPercent,
          }
        : manager
          ? {
              ...sharedBody,
              progressPercent: editValues.progressPercent,
              actualHours: editValues.actualHours,
              estimatedHours: editValues.estimatedHours,
              priority: editValues.priority,
              complexity: editValues.complexity,
            }
          : sharedBody;
    updateMutation.mutate(body);
  };

  return (
    <>
      <Link className="back-link" to="/projects">
        <ArrowLeft size={16} /> Back to projects
      </Link>
      <PageHeader
        eyebrow={project.projectCode}
        title={project.projectName}
        description={`${project.clientName} · ${project.projectType}`}
        actions={
          <div className="details-header-actions">
            {manager ? (
              <button
                className="button secondary"
                type="button"
                onClick={() => setAssigning(project)}
              >
                <UserRoundPlus size={17} />{' '}
                {project.assignedDesignerId ? 'Manage project team' : 'Assign Lighting Designer'}
              </button>
            ) : null}
            {canEdit && project.status !== 'Cancelled' && project.status !== 'Completed' ? (
              <button
                className="button primary"
                type="button"
                onClick={() => setEditing((value) => !value)}
              >
                <PencilLine size={17} /> {editing ? 'Close editor' : 'Update project'}
              </button>
            ) : null}
          </div>
        }
      />

      <div className="details-layout">
        <div className="details-main">
          <section className="details-hero-card">
            <div className="details-status-row">
              <StatusBadge status={project.status} />
              <PriorityBadge priority={project.priority} />
              <span className="revision-pill">Revision {project.revisionNumber}</span>
            </div>
            <ProgressBar value={project.progressPercent} label="Overall delivery progress" />
            <div className="details-metrics">
              <div>
                <CalendarDays />
                <span>
                  <small>Required delivery</small>
                  <Deadline date={project.requiredDeliveryDate} />
                </span>
              </div>
              <div>
                <Clock3 />
                <span>
                  <small>Estimated / actual</small>
                  <strong>
                    {project.estimatedHours}h / {project.actualHours}h
                  </strong>
                </span>
              </div>
              <div>
                <Activity />
                <span>
                  <small>Complexity</small>
                  <strong>{project.complexity}</strong>
                </span>
              </div>
            </div>
          </section>

          {currentUser.role === 'Designer' &&
          !['Completed', 'Cancelled', 'Archived', 'Unassigned'].includes(project.status) ? (
            <LiveTimerCard projectId={project.id} projectName={project.projectName} />
          ) : null}

          <section className="project-time-summary">
            <div>
              <span className="timesheet-icon">
                <Clock3 size={19} />
              </span>
              <div>
                <small>Team tracked time</small>
                <strong>
                  {Math.round(
                    ((timesheetsQuery.data?.reduce((sum, sheet) => sum + sheet.totalMinutes, 0) ??
                      0) /
                      60) *
                      10,
                  ) / 10}
                  h
                </strong>
              </div>
            </div>
            <span>
              {timesheetsQuery.data?.length ?? 0} designer timesheet
              {(timesheetsQuery.data?.length ?? 0) === 1 ? '' : 's'}
            </span>
            {currentUser.role !== 'Sales' ? (
              <Link className="button ghost small" to="/timesheets">
                Open timesheets
              </Link>
            ) : null}
          </section>

          {editing ? (
            <section className="inline-editor" aria-label="Update project">
              <div className="section-heading">
                <div>
                  <h2>Update delivery details</h2>
                  <p>Only fields permitted for your role are shown.</p>
                </div>
              </div>
              <div className="form-grid">
                <label className="field field-wide">
                  Project name
                  <input
                    value={editValues.projectName}
                    onChange={(event) =>
                      setEditValues({ ...editValues, projectName: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Client / business unit
                  <input
                    value={editValues.clientName}
                    onChange={(event) =>
                      setEditValues({ ...editValues, clientName: event.target.value })
                    }
                  />
                </label>
                <ProjectTypeSelect
                  value={editValues.projectType}
                  catalogue={projectTypesQuery.data}
                  loading={projectTypesQuery.isLoading}
                  error={projectTypesQuery.isError}
                  disabled={updateMutation.isPending}
                  onChange={(projectType) => setEditValues({ ...editValues, projectType })}
                />
                <label className="field">
                  Site location
                  <input
                    value={editValues.siteLocation}
                    onChange={(event) =>
                      setEditValues({ ...editValues, siteLocation: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Design stage
                  <select
                    value={editValues.designStage}
                    onChange={(event) =>
                      setEditValues({
                        ...editValues,
                        designStage: event.target.value as Project['designStage'],
                      })
                    }
                  >
                    <option value="Concept">Concept</option>
                    <option value="SchematicDesign">Schematic Design</option>
                    <option value="DetailedDesign">Detailed Design</option>
                    <option value="Tender">Tender</option>
                    <option value="Construction">Construction</option>
                    <option value="AsBuilt">As Built</option>
                  </select>
                </label>
                <label className="field">
                  Required date
                  <input
                    type="date"
                    value={editValues.requiredDeliveryDate}
                    onChange={(event) =>
                      setEditValues({ ...editValues, requiredDeliveryDate: event.target.value })
                    }
                  />
                </label>
                <label className="field field-wide">
                  Lighting scope
                  <textarea
                    value={editValues.lightingScope}
                    onChange={(event) =>
                      setEditValues({ ...editValues, lightingScope: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Lux requirements
                  <textarea
                    value={editValues.luxRequirements}
                    onChange={(event) =>
                      setEditValues({ ...editValues, luxRequirements: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Drawing reference
                  <textarea
                    value={editValues.drawingReference}
                    onChange={(event) =>
                      setEditValues({ ...editValues, drawingReference: event.target.value })
                    }
                  />
                </label>
                <label className="field field-wide">
                  Project brief
                  <textarea
                    value={editValues.description}
                    onChange={(event) =>
                      setEditValues({ ...editValues, description: event.target.value })
                    }
                  />
                </label>
              </div>
              {currentUser.role !== 'Sales' ? (
                <div className="form-grid form-grid-three">
                  <label className="field">
                    Progress %
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={editValues.progressPercent}
                      onChange={(event) =>
                        setEditValues({
                          ...editValues,
                          progressPercent: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  {manager ? (
                    <label className="field">
                      Actual hours correction
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={editValues.actualHours}
                        onChange={(event) =>
                          setEditValues({ ...editValues, actualHours: Number(event.target.value) })
                        }
                      />
                      <small>Designer time is normally added by the live timer.</small>
                    </label>
                  ) : null}
                  {manager ? (
                    <label className="field">
                      Estimated hours
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={editValues.estimatedHours}
                        onChange={(event) =>
                          setEditValues({
                            ...editValues,
                            estimatedHours: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  ) : null}
                  {manager ? (
                    <>
                      <label className="field">
                        Priority
                        <select
                          value={editValues.priority}
                          onChange={(event) =>
                            setEditValues({
                              ...editValues,
                              priority: event.target.value as Project['priority'],
                            })
                          }
                        >
                          <option>Normal</option>
                          <option>High</option>
                          <option>Urgent</option>
                        </select>
                      </label>
                      <label className="field">
                        Complexity
                        <select
                          value={editValues.complexity}
                          onChange={(event) =>
                            setEditValues({
                              ...editValues,
                              complexity: event.target.value as Project['complexity'],
                            })
                          }
                        >
                          <option>Small</option>
                          <option>Medium</option>
                          <option>Large</option>
                        </select>
                      </label>
                    </>
                  ) : null}
                </div>
              ) : null}
              <label className="field">
                Project folder / reference URL
                <input
                  type="url"
                  value={editValues.projectFolderUrl}
                  onChange={(event) =>
                    setEditValues({ ...editValues, projectFolderUrl: event.target.value })
                  }
                  placeholder="https://…"
                />
              </label>
              <div className="editor-actions">
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => {
                    setEditValues(valuesFrom(project));
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  type="button"
                  onClick={saveEdits}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </section>
          ) : null}

          <section className="details-section">
            <div className="section-heading">
              <div>
                <h2>Project brief</h2>
                <p>The core context shared with the delivery team.</p>
              </div>
            </div>
            <div className="brief-card">
              <FileText size={20} />
              <p>{project.description || 'No description was provided.'}</p>
            </div>
            <dl className="detail-definition-grid">
              <div>
                <dt>Sales Owner</dt>
                <dd>
                  {project.salesOwnerNameSnapshot}
                  <span>{project.salesOwnerEmailSnapshot}</span>
                </dd>
              </div>
              <div>
                <dt>Created By</dt>
                <dd>
                  {project.createdByNameSnapshot}
                  <span>{project.createdByEmailSnapshot}</span>
                </dd>
              </div>
              <div>
                <dt>Primary Lighting Designer</dt>
                <dd>
                  {project.assignedDesignerNameSnapshot ?? 'Not assigned'}
                  <span>
                    {project.assignedDesignerId ? 'Active assignment' : 'Waiting in queue'}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Collaborators</dt>
                <dd>
                  {project.collaboratorDesignerNameSnapshots.length
                    ? project.collaboratorDesignerNameSnapshots.join(', ')
                    : 'No collaborators'}
                  <span>Lighting Designers with shared edit access</span>
                </dd>
              </div>
              <div>
                <dt>Site location</dt>
                <dd>
                  {project.siteLocation}
                  <span>{project.designStage.replace(/([A-Z])/g, ' $1').trim()}</span>
                </dd>
              </div>
              <div>
                <dt>Lighting scope</dt>
                <dd>
                  {project.lightingScope}
                  <span>Shared technical scope</span>
                </dd>
              </div>
              <div>
                <dt>Lux requirements</dt>
                <dd>
                  {project.luxRequirements || 'Not specified'}
                  <span>Targets and applicable standards</span>
                </dd>
              </div>
              <div>
                <dt>Drawing reference</dt>
                <dd>
                  {project.drawingReference || 'Not specified'}
                  <span>Drawing package / revision</span>
                </dd>
              </div>
              <div>
                <dt>Project folder</dt>
                <dd>
                  {project.projectFolderUrl ? (
                    <a href={project.projectFolderUrl} target="_blank" rel="noreferrer">
                      Open project folder <ExternalLink size={14} />
                    </a>
                  ) : (
                    'Not provided'
                  )}
                  <span>HTTPS reference link</span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="details-section comments-section">
            <div className="section-heading">
              <div>
                <h2>Comments</h2>
                <p>Keep decisions and requested information with the project.</p>
              </div>
              <MessageSquareText size={20} />
            </div>
            <div className="comment-list">
              {commentsQuery.data?.map((comment) => (
                <article className="comment-item" key={comment.id}>
                  <Avatar user={{ displayName: comment.authorNameSnapshot, avatarUrl: null }} />
                  <div>
                    <header>
                      <strong>{comment.authorNameSnapshot}</strong>
                      <time>
                        {formatDate(comment.createdAt, { hour: '2-digit', minute: '2-digit' })}
                      </time>
                    </header>
                    <p>{comment.body}</p>
                    {comment.attachmentUrl ? (
                      <a href={comment.attachmentUrl} target="_blank" rel="noreferrer">
                        Open attachment <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
              {!commentsQuery.data?.length ? (
                <p className="comments-empty">
                  No comments yet. Start the project conversation below.
                </p>
              ) : null}
            </div>
            {project.status !== 'Cancelled' && project.status !== 'Completed' ? (
              <div className="comment-composer">
                <Avatar user={currentUser} />
                <div>
                  <textarea
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    placeholder="Add a comment or request information…"
                    maxLength={2000}
                  />
                  <input
                    type="url"
                    value={attachmentUrl}
                    onChange={(event) => setAttachmentUrl(event.target.value)}
                    placeholder="Optional HTTPS attachment URL"
                  />
                  <button
                    className="button primary"
                    type="button"
                    disabled={commentBody.trim().length === 0 || commentMutation.isPending}
                    onClick={() => commentMutation.mutate()}
                  >
                    <Send size={16} /> {commentMutation.isPending ? 'Sending…' : 'Add comment'}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="details-sidebar">
          <section className="action-card">
            <h2>Project actions</h2>
            {statusOptions.length ? (
              <label className="field">
                Change status
                <select
                  value=""
                  onChange={(event) => {
                    const status = event.target.value as ProjectStatus;
                    if (status) statusMutation.mutate({ status });
                  }}
                >
                  <option value="">Select next status</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="muted-copy">No status actions are available for your role.</p>
            )}
            {currentUser.role === 'Sales' && project.status === 'Completed' ? (
              <button
                className="button warning full"
                type="button"
                onClick={() =>
                  statusMutation.mutate({
                    status: 'RevisionRequired',
                    reason: 'Revision requested by Sales Owner',
                  })
                }
              >
                <RotateCcw size={16} /> Request revision
              </button>
            ) : null}
            {statusMutation.isPending ? (
              <span className="action-pending">Updating status…</span>
            ) : null}
          </section>

          <section className="timeline-card">
            <div className="section-heading">
              <div>
                <h2>Activity history</h2>
                <p>Immutable project audit trail</p>
              </div>
              <History size={19} />
            </div>
            <ol className="timeline-list">
              {activitiesQuery.data?.map((item) => (
                <li key={item.id}>
                  <span className="timeline-marker">
                    <CheckCircle2 size={13} />
                  </span>
                  <div>
                    <strong>{item.message}</strong>
                    {item.fieldName ? (
                      <span>
                        {item.fieldName}: {item.oldValue ?? '—'} → {item.newValue ?? '—'}
                      </span>
                    ) : null}
                    <time>
                      {formatDate(item.createdAt, { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <AssignmentDrawer project={assigning} onClose={() => setAssigning(null)} />
    </>
  );
}
