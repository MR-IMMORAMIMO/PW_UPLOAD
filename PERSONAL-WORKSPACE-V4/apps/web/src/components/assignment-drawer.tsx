import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, BriefcaseBusiness, CalendarDays, Check, Clock3, X } from 'lucide-react';
import type { Project, WorkloadMetrics } from '@scli/domain';
import { api, ApiError } from '../api';
import { useToast } from './toast';
import { Avatar, formatDate, LoadingState, ProgressBar } from './ui';

export function AssignmentDrawer({
  project,
  onClose,
}: {
  project: Project | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<WorkloadMetrics | null>(null);
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  const workloadQuery = useQuery({
    queryKey: ['workloads'],
    queryFn: api.workloads,
    enabled: Boolean(project),
  });
  useEffect(() => {
    setSelected(null);
    setCollaboratorIds(project?.collaboratorDesignerIds ?? []);
    setOverrideReason('');
  }, [project]);
  useEffect(() => {
    if (!project?.assignedDesignerId || !workloadQuery.data || selected) return;
    setSelected(
      workloadQuery.data.find((item) => item.designer.id === project.assignedDesignerId) ?? null,
    );
  }, [project, selected, workloadQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!project || !selected) throw new Error('Select a Primary Lighting Designer.');
      return api.assignProject(project.id, {
        designerId: selected.designer.id,
        collaboratorDesignerIds: collaboratorIds.filter((id) => id !== selected.designer.id),
        ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
      });
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['project', updated.id] }),
        queryClient.invalidateQueries({ queryKey: ['workloads'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      showToast(`${updated.assignedDesignerNameSnapshot} assigned successfully.`);
      onClose();
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Assignment failed.', 'error');
    },
  });

  const needsOverride =
    selected?.classification === 'FullyLoaded' || selected?.classification === 'Unavailable';

  return (
    <AnimatePresence>
      {project ? (
        <>
          <motion.button
            className="drawer-backdrop"
            type="button"
            aria-label="Close assignment drawer"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className="assignment-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assignment-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            <header className="drawer-header">
              <div>
                <span className="eyebrow">Lighting project team</span>
                <h2 id="assignment-title">Choose the Primary Lighting Designer</h2>
                <p>
                  {project.projectCode} · {project.projectName}
                </p>
              </div>
              <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
                <X size={20} />
              </button>
            </header>

            <div className="drawer-body">
              {workloadQuery.isLoading ? <LoadingState label="Calculating availability…" /> : null}
              {workloadQuery.error ? (
                <p className="inline-error">{(workloadQuery.error as Error).message}</p>
              ) : null}
              <div className="designer-choice-list">
                {workloadQuery.data?.map((workload, index) => (
                  <button
                    className={`designer-choice${selected?.designer.id === workload.designer.id ? ' selected' : ''}`}
                    type="button"
                    key={workload.designer.id}
                    onClick={() => {
                      setSelected(workload);
                      setCollaboratorIds((current) =>
                        current.filter((id) => id !== workload.designer.id),
                      );
                    }}
                  >
                    <span className="designer-rank">{index + 1}</span>
                    <Avatar user={workload.designer} size="lg" />
                    <span className="designer-choice-main">
                      <span className="designer-title-line">
                        <strong>{workload.designer.displayName}</strong>
                        <span
                          className={`availability-badge availability-${workload.classification}`}
                        >
                          {workload.classification}
                        </span>
                      </span>
                      <span>{workload.designer.jobTitle}</span>
                      <ProgressBar
                        value={Math.min(workload.utilizationPercent, 100)}
                        label={`${workload.activeEstimatedHours}h of ${workload.weeklyCapacityHours}h`}
                      />
                      <span className="designer-choice-stats">
                        <span>
                          <BriefcaseBusiness size={14} /> {workload.activeProjectCount} active
                        </span>
                        <span>
                          <Clock3 size={14} /> {workload.availabilityPercent}% free
                        </span>
                        <span>
                          <CalendarDays size={14} />{' '}
                          {workload.nextDeadline
                            ? formatDate(workload.nextDeadline)
                            : 'No deadline'}
                        </span>
                      </span>
                      <details>
                        <summary>View active projects</summary>
                        <ul>
                          {workload.activeProjects.length ? (
                            workload.activeProjects.map((item) => (
                              <li key={item.id}>
                                <span>{item.projectName}</span>
                                <small>
                                  {item.estimatedHours}h · {formatDate(item.requiredDeliveryDate)}
                                </small>
                              </li>
                            ))
                          ) : (
                            <li>No active projects</li>
                          )}
                        </ul>
                      </details>
                    </span>
                    {selected?.designer.id === workload.designer.id ? <Check size={20} /> : null}
                  </button>
                ))}
              </div>

              {selected ? (
                <fieldset className="collaborator-picker">
                  <legend>Lighting Designer collaborators</legend>
                  <p>
                    Collaborators can open and edit the project but do not own its workload
                    allocation.
                  </p>
                  <div>
                    {workloadQuery.data
                      ?.filter((item) => item.designer.id !== selected.designer.id)
                      .map((item) => (
                        <label key={item.designer.id}>
                          <input
                            type="checkbox"
                            checked={collaboratorIds.includes(item.designer.id)}
                            onChange={(event) =>
                              setCollaboratorIds((current) =>
                                event.target.checked
                                  ? [...new Set([...current, item.designer.id])]
                                  : current.filter((id) => id !== item.designer.id),
                              )
                            }
                          />
                          <Avatar user={item.designer} size="sm" />
                          <span>
                            <strong>{item.designer.displayName}</strong>
                            <small>{item.designer.jobTitle}</small>
                          </span>
                        </label>
                      ))}
                  </div>
                </fieldset>
              ) : null}

              {needsOverride ? (
                <div className="override-warning">
                  <AlertTriangle size={20} />
                  <div>
                    <strong>Capacity override required</strong>
                    <p>
                      This Lighting Designer is {selected?.classification.toLowerCase()}. Explain
                      why this assignment should proceed.
                    </p>
                    <label>
                      Override reason
                      <textarea
                        value={overrideReason}
                        onChange={(event) => setOverrideReason(event.target.value)}
                        minLength={5}
                        maxLength={500}
                        required
                      />
                    </label>
                  </div>
                </div>
              ) : null}
              {mutation.error instanceof ApiError ? (
                <p className="inline-error">{mutation.error.message}</p>
              ) : null}
            </div>

            <footer className="drawer-footer">
              <button className="button ghost" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="button primary"
                type="button"
                disabled={
                  !selected ||
                  mutation.isPending ||
                  (needsOverride && overrideReason.trim().length < 5)
                }
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? 'Assigning…' : 'Confirm assignment'}
              </button>
            </footer>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
