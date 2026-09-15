import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, RefreshCw } from '../common/SctIcons';
import type { ProjectStorageReconnectIntent } from '@scli/domain';
import type { Project } from '@scli/domain';
import { api } from '../../api/environment';

export function ProjectStorageHealth({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const health = useQuery({
    queryKey: ['v4', 'project', project.id, 'storage-health'],
    queryFn: () => api.projectStorageHealth(project.id),
  });
  const reconnect = useMutation({
    mutationFn: async (intent: ProjectStorageReconnectIntent) => {
      const candidatePath = await window.scliDesktop?.selectFolder?.();
      if (!candidatePath) return null;
      return api.reconnectProjectStorage(project.id, {
        candidatePath,
        intent,
        expectedVersion: project.version,
      });
    },
    onMutate: () => setError(null),
    onSuccess: async (result) => {
      if (!result) return;
      queryClient.setQueryData(['v4', 'project', project.id, 'storage-health'], result.health);
      queryClient.setQueriesData<Project>(
        { predicate: (query) => query.queryKey.includes(project.id) },
        (current) => (current?.id === project.id ? result.project : current),
      );
      await queryClient.invalidateQueries({
        queryKey: ['v4', 'technical-check', 'legacy-adoption', project.id],
      });
    },
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : 'The selected folder was rejected.'),
  });

  if (health.isLoading) return <p className="v4-storage-health__state">Checking storage…</p>;
  if (health.isError || !health.data) {
    return (
      <div className="v4-storage-health" role="alert">
        <p>Storage health is unavailable. Project details remain usable.</p>
        <button type="button" onClick={() => void health.refetch()}>
          <RefreshCw aria-hidden="true" /> Retry health
        </button>
      </div>
    );
  }
  const value = health.data;
  return (
    <div className="v4-storage-health" data-state={value.state}>
      <div>
        <strong>{value.state.replaceAll('_', ' ')}</strong>
        <span>{value.reason?.replaceAll('_', ' ') ?? 'Verified UUID marker'}</span>
      </div>
      {value.canonicalPath ? <code title={value.canonicalPath}>{value.canonicalPath}</code> : null}
      <div className="v4-storage-health__actions">
        {value.canOpenFolder && value.canonicalPath ? (
          <button
            type="button"
            onClick={() => void window.scliDesktop?.openPath?.(value.canonicalPath!)}
          >
            <FolderOpen aria-hidden="true" /> Open Folder
          </button>
        ) : null}
        {value.canReconnect ? (
          value.state === 'LEGACY_UNVERIFIED' ? (
            <button
              type="button"
              onClick={() => reconnect.mutate('ADOPT_LEGACY')}
              disabled={reconnect.isPending}
            >
              {reconnect.isPending ? 'Checking…' : 'Verify / Adopt legacy folder'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => reconnect.mutate('MATCHING_MARKER')}
                disabled={reconnect.isPending}
              >
                {reconnect.isPending ? 'Checking…' : 'Reconnect marked folder'}
              </button>
              {value.state === 'DISCONNECTED' ? (
                <button
                  type="button"
                  onClick={() => reconnect.mutate('INITIAL_BINDING')}
                  disabled={reconnect.isPending}
                >
                  Bind empty folder
                </button>
              ) : null}
            </>
          )
        ) : null}
        <button type="button" onClick={() => void health.refetch()}>
          <RefreshCw aria-hidden="true" /> Retry health
        </button>
      </div>
      {value.state === 'UNAVAILABLE' ? (
        <p>No replacement folder will be created automatically.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
