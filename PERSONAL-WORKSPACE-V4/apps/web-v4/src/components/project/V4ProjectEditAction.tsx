import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from '../common/SctIcons';
import type { FullProjectEditInput } from '@scli/contracts';
import type { Project } from '@scli/domain';
import { api } from '../../api/environment';
import { V4ProjectEditWorkspace } from './V4ProjectEditWorkspace';
import { V4ProjectStatusControl } from './V4ProjectStatusControl';
import { V4Button } from '../common/V4Button';

export interface V4ProjectEditActionProps {
  project: Project | null | undefined;
  projectQueryKey: readonly unknown[];
  renderTrigger?: (open: (trigger: HTMLElement) => void, pending: boolean) => ReactNode;
}

/** Shared project-level edit controller for the Project Context Header action slot. */
export function V4ProjectEditAction({
  project,
  projectQueryKey,
  renderTrigger,
}: V4ProjectEditActionProps) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const openGenerationRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [projectTruth, setProjectTruth] = useState<Project | null>(project ?? null);
  useEffect(() => setProjectTruth(project ?? null), [project]);
  const currentProject = projectTruth ?? project;
  const queryClient = useQueryClient();
  const projectTypesQuery = useQuery({
    queryKey: ['v4', 'project-types', 'catalog'],
    queryFn: () => api.projectTypeCatalogue(),
    enabled: open,
  });
  const projectTypes = useMemo(
    () =>
      Array.isArray(projectTypesQuery.data)
        ? projectTypesQuery.data.filter(
            (item) => item.isActive || item.name === currentProject?.projectType,
          )
        : [],
    [currentProject?.projectType, projectTypesQuery.data],
  );
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'project', currentProject?.id, 'workspace'],
    queryFn: () => api.projectWorkspace(currentProject!.id),
    enabled: open && !!currentProject,
  });
  const meQuery = useQuery({ queryKey: ['v4', 'me'], queryFn: api.me, enabled: open });
  const salesQuery = useQuery({
    queryKey: ['v4', 'sales-users'],
    queryFn: api.salesUsers,
    enabled: open,
  });
  const save = useMutation({
    mutationFn: (payload: FullProjectEditInput) =>
      api.updateProjectConfiguration(currentProject!.id, payload),
    onMutate: () => setSaved(false),
    onSuccess: ({ project: updated, workspace }) => {
      queryClient.setQueriesData<Project>(
        {
          predicate: (candidate) => {
            const key = candidate.queryKey;
            return key[0] === 'v4' && key[2] === 'project' && key[3] === project?.id;
          },
        },
        updated,
      );
      queryClient.setQueryData(projectQueryKey, updated);
      queryClient.setQueryData(['v4', 'project', updated.id, 'workspace'], workspace);
      setProjectTruth(updated);
      void queryClient.invalidateQueries({
        predicate: (candidate) => {
          const key = candidate.queryKey;
          return key[0] === 'v4' && key[2] === 'project' && key[3] === project?.id;
        },
        refetchType: 'none',
      });
      setSaved(true);
    },
  });

  if (!currentProject) return null;

  const requestOpen = (trigger: HTMLElement) => {
    openGenerationRef.current += 1;
    returnFocusRef.current = trigger;
    setSaved(false);
    setOpen(true);
  };
  const closeWorkspace = () => {
    openGenerationRef.current += 1;
    setOpen(false);
  };

  return (
    <>
      {renderTrigger ? (
        <ProjectEditTrigger render={renderTrigger} onOpen={requestOpen} pending={save.isPending} />
      ) : (
        <>
          <V4ProjectStatusControl project={currentProject} />
          <V4Button
            variant="tertiary"
            size="compact"
            className="v4-project-edit-action"
            onClick={(event) => requestOpen(event.currentTarget)}
            disabled={save.isPending}
          >
            <Pencil aria-hidden="true" />
            Edit Project
          </V4Button>
        </>
      )}
      {workspaceQuery.data ? (
        <V4ProjectEditWorkspace
          open={open}
          project={currentProject}
          workspace={workspaceQuery.data}
          projectTypes={projectTypes}
          salesUsers={salesQuery.data ?? []}
          actor={meQuery.data}
          saving={save.isPending}
          error={save.error instanceof Error ? save.error.message : null}
          saved={saved}
          onClose={closeWorkspace}
          onSave={(payload) => save.mutate(payload)}
          returnFocusRef={returnFocusRef}
        />
      ) : null}
    </>
  );
}

function ProjectEditTrigger({
  render,
  onOpen,
  pending,
}: {
  render: NonNullable<V4ProjectEditActionProps['renderTrigger']>;
  onOpen: (trigger: HTMLElement) => void;
  pending: boolean;
}) {
  return render(onOpen, pending);
}
