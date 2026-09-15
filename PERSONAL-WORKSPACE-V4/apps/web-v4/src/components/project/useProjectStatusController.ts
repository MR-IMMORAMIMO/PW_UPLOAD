import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project, ProjectStatus } from '@scli/domain';
import { api } from '../../api/environment';

function replaceProject(value: unknown, updated: Project): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === 'object' && 'id' in item && item.id === updated.id ? updated : item,
    );
  }
  return value && typeof value === 'object' && 'id' in value && value.id === updated.id
    ? updated
    : value;
}

interface ProjectStatusControllerOptions {
  onMutate?: () => void;
  onSuccess?: (project: Project) => void;
  onError?: (error: unknown) => void;
}

export function useProjectStatusController(options: ProjectStatusControllerOptions = {}) {
  const queryClient = useQueryClient();
  const pendingIdsRef = useRef(new Set<string>());
  const [pendingProjectIds, setPendingProjectIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const mutation = useMutation({
    mutationFn: ({
      project,
      target,
      reason,
    }: {
      project: Project;
      target: ProjectStatus;
      reason?: string;
    }) =>
      api.changeStatus(project.id, {
        status: target,
        ...(reason ? { reason } : {}),
        expectedCurrentStatus: project.status,
        transitionId: crypto.randomUUID(),
      }),
    onMutate: async ({ project, target }) => {
      setError(null);
      options.onMutate?.();
      await queryClient.cancelQueries({ queryKey: ['v4'] });
      const predicate = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === 'v4' &&
        (query.queryKey.includes(project.id) || query.queryKey[1] === 'projects');
      const snapshots = queryClient.getQueriesData({ predicate });
      queryClient.setQueriesData({ predicate }, (current) =>
        replaceProject(current, { ...project, status: target }),
      );
      return { snapshots };
    },
    onSuccess: (updated, { project }) => {
      const predicate = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === 'v4' &&
        (query.queryKey.includes(project.id) || query.queryKey[1] === 'projects');
      queryClient.setQueriesData({ predicate }, (current) => replaceProject(current, updated));
      options.onSuccess?.(updated);
    },
    onError: (caught, _variables, context) => {
      for (const [key, value] of context?.snapshots ?? []) queryClient.setQueryData(key, value);
      setError(caught);
      options.onError?.(caught);
    },
    onSettled: (_data, _error, { project }) => {
      pendingIdsRef.current.delete(project.id);
      setPendingProjectIds(new Set(pendingIdsRef.current));
      void queryClient.invalidateQueries({ queryKey: ['v4'] });
    },
  });

  const changeStatus = (project: Project, target: ProjectStatus, reason?: string) => {
    if (pendingIdsRef.current.has(project.id) || project.status === target) return;
    pendingIdsRef.current.add(project.id);
    setPendingProjectIds(new Set(pendingIdsRef.current));
    mutation.mutate({ project, target, ...(reason ? { reason } : {}) });
  };

  return {
    changeStatus,
    pendingProjectIds,
    isPending: mutation.isPending,
    error,
  };
}
