import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { workSessionState, type Project, type WorkSession } from '@scli/domain';
import { ApiError } from '@scli/api-client';
import { api } from '../../api/environment';
import { workSessionElapsedSeconds } from './workSessionTime';

export const V4_ACTIVE_WORK_SESSION_QUERY_KEY = ['v4', 'work-session', 'active'] as const;

function projectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return fallback;
}

export interface V4WorkSessionContextValue {
  active: WorkSession | null;
  activeProject: Project | null;
  currentProject: Project | null;
  currentProjectId: string | null;
  state: 'RUNNING' | 'PAUSED' | null;
  elapsedSeconds: number;
  statusLoading: boolean;
  statusUnavailable: boolean;
  trayOpen: boolean;
  setTrayOpen: (open: boolean) => void;
  error: string | null;
  clearError: () => void;
  start: (projectId?: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  startPending: boolean;
  pausePending: boolean;
  resumePending: boolean;
  stopPending: boolean;
}

const V4WorkSessionContext = createContext<V4WorkSessionContextValue | null>(null);

export function V4WorkSessionProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const currentProjectId = projectIdFromPath(location.pathname);
  const [now, setNow] = useState(() => Date.now());
  const [trayOpen, setTrayOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeQuery = useQuery({
    queryKey: V4_ACTIVE_WORK_SESSION_QUERY_KEY,
    queryFn: api.activeWorkSession,
    staleTime: 30_000,
  });
  const active = activeQuery.data ?? null;
  const state = active ? workSessionState(active) : null;

  const currentProjectQuery = useQuery({
    queryKey: ['v4', 'work-session', 'project', currentProjectId],
    queryFn: () => api.project(currentProjectId!),
    enabled: Boolean(currentProjectId),
    staleTime: 30_000,
  });
  const activeProjectQuery = useQuery({
    queryKey: ['v4', 'work-session', 'project', active?.projectId],
    queryFn: () => api.project(active!.projectId),
    enabled: Boolean(active),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (state !== 'RUNNING') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [state, active?.id]);

  const reconcile = (session: WorkSession | null) => {
    queryClient.setQueryData(V4_ACTIVE_WORK_SESSION_QUERY_KEY, session);
    void queryClient.invalidateQueries({
      queryKey: V4_ACTIVE_WORK_SESSION_QUERY_KEY,
      refetchType: 'none',
    });
  };

  const startMutation = useMutation({
    mutationFn: (selectedProjectId?: string) => {
      const projectId = selectedProjectId ?? currentProjectId;
      if (!projectId) throw new Error('Choose a project before starting a work session.');
      return api.startWorkSession({
        projectId,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    onMutate: () => setError(null),
    onSuccess: (result) => reconcile(result.session),
    onError: (mutationError) => {
      setError(errorMessage(mutationError, 'The work session could not be started.'));
      void queryClient.invalidateQueries({ queryKey: V4_ACTIVE_WORK_SESSION_QUERY_KEY });
    },
  });
  const pauseMutation = useMutation({
    mutationFn: () => api.pauseWorkSession({ idempotencyKey: crypto.randomUUID() }),
    onMutate: () => setError(null),
    onSuccess: (result) => reconcile(result.session),
    onError: (mutationError) =>
      setError(errorMessage(mutationError, 'The work session could not be paused.')),
  });
  const resumeMutation = useMutation({
    mutationFn: () => api.resumeWorkSession({ idempotencyKey: crypto.randomUUID() }),
    onMutate: () => setError(null),
    onSuccess: (result) => reconcile(result.session),
    onError: (mutationError) =>
      setError(errorMessage(mutationError, 'The work session could not be resumed.')),
  });
  const stopMutation = useMutation({
    mutationFn: () => api.stopWorkSession({ idempotencyKey: crypto.randomUUID() }),
    onMutate: () => setError(null),
    onSuccess: () => reconcile(null),
    onError: (mutationError) =>
      setError(errorMessage(mutationError, 'The work session could not be stopped.')),
  });

  const value = useMemo<V4WorkSessionContextValue>(
    () => ({
      active,
      activeProject: activeProjectQuery.data ?? null,
      currentProject: currentProjectQuery.data ?? null,
      currentProjectId,
      state: state === 'RUNNING' || state === 'PAUSED' ? state : null,
      elapsedSeconds: active ? workSessionElapsedSeconds(active, now) : 0,
      statusLoading: activeQuery.isLoading,
      statusUnavailable: activeQuery.isError,
      trayOpen,
      setTrayOpen,
      error:
        error ??
        (activeQuery.isError
          ? errorMessage(activeQuery.error, 'The Work Session status could not be loaded.')
          : null),
      clearError: () => setError(null),
      start: (projectId?: string) => startMutation.mutate(projectId),
      pause: () => pauseMutation.mutate(),
      resume: () => resumeMutation.mutate(),
      stop: () => stopMutation.mutate(),
      startPending: startMutation.isPending,
      pausePending: pauseMutation.isPending,
      resumePending: resumeMutation.isPending,
      stopPending: stopMutation.isPending,
    }),
    [
      active,
      activeQuery.error,
      activeQuery.isError,
      activeQuery.isLoading,
      activeProjectQuery.data,
      currentProjectQuery.data,
      currentProjectId,
      state,
      now,
      trayOpen,
      error,
      startMutation,
      pauseMutation,
      resumeMutation,
      stopMutation,
    ],
  );

  return <V4WorkSessionContext.Provider value={value}>{children}</V4WorkSessionContext.Provider>;
}

export function useV4WorkSession(): V4WorkSessionContextValue {
  const value = useContext(V4WorkSessionContext);
  if (!value) throw new Error('useV4WorkSession must be used within V4WorkSessionProvider.');
  return value;
}

export function useOptionalV4WorkSession(): V4WorkSessionContextValue | null {
  return useContext(V4WorkSessionContext);
}
