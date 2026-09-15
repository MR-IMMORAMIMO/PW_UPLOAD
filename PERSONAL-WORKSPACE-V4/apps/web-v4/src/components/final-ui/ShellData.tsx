import { useState } from 'react';
import type { PersonalProfile } from '@scli/contracts';
import { apiRequest } from '../../api/environment';
import { PersonalProfileEditor } from './PersonalProfileEditor';
import { V4FloatingWorkspace } from '../common/V4FloatingWorkspace';
import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project } from '@scli/domain';
import { api } from '../../api/environment';
import { useOptionalV4WorkSession } from '../work-session/WorkSessionProvider';
import { formatWorkSessionElapsed } from '../work-session/workSessionTime';
import { businessTodayKey, formatBusinessDateOnly } from '../../date-time/businessDateTime';

export interface ShellProject {
  code: string;
  name: string;
  client: string;
  type: string;
  stage: string;
  status: string;
  dueDate: string;
  overdue: boolean;
}
export function shellProject(project?: Project | null): ShellProject {
  return {
    code: project?.projectCode || '—',
    name: project?.projectName || '—',
    client: project?.clientName || '—',
    type: project?.projectType || '—',
    stage: project?.status?.replace(/([a-z])([A-Z])/g, '$1 $2') || '—',
    status: project?.status?.replace(/([a-z])([A-Z])/g, '$1 $2') || '—',
    dueDate: project?.requiredDeliveryDate
      ? formatBusinessDateOnly(project.requiredDeliveryDate.slice(0, 10))
      : '—',
    overdue: Boolean(
      project?.requiredDeliveryDate &&
      project.requiredDeliveryDate.slice(0, 10) < businessTodayKey(),
    ),
  };
}
const Context = createContext({
  identity: { name: '—', email: '—', initials: '', photo: null as string | null },
  editProfile: () => {},
  sessionLabel: 'Session unavailable',
  sessionProject: '—',
  sessionUnavailable: true,
  toggleSession: () => {},
});
export function ShellData({ children }: { children: ReactNode }) {
  const identity = useQuery({
    queryKey: ['v4', 'final-shell', 'me'],
    queryFn: () => api.me(),
    staleTime: 30_000,
  });
  const [editing, setEditing] = useState(false);
  const profile = useQuery({
    queryKey: ['v4', 'personal-profile'],
    queryFn: () => apiRequest<PersonalProfile>('/api/personal/profile'),
  });
  const session = useOptionalV4WorkSession();
  const unavailable =
    !session ||
    !session.active ||
    session.statusUnavailable ||
    session.statusLoading ||
    session.pausePending ||
    session.resumePending;
  const sessionLabel = session?.statusLoading
    ? 'Loading session…'
    : !session || session.statusUnavailable
      ? 'Session unavailable'
      : session.error
        ? 'Session action failed'
        : session.active
          ? `${session.state === 'RUNNING' ? 'Running' : 'Paused'} · ${formatWorkSessionElapsed(session.elapsedSeconds)}`
          : 'No active session';
  return (
    <Context.Provider
      value={{
        identity: {
          name: profile.data?.name || identity.data?.displayName || '—',
          email: profile.data?.email || identity.data?.email || '—',
          initials: (profile.data?.name || identity.data?.displayName || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((part) => part[0])
            .join('')
            .toUpperCase(),
          photo: profile.data?.photo ?? null,
        },
        editProfile: () => setEditing(true),
        sessionLabel,
        sessionProject: session?.activeProject?.projectName || '—',
        sessionUnavailable: unavailable,
        toggleSession: () => {
          if (unavailable || !session?.active) return;
          if (session.state === 'RUNNING') session.pause();
          else if (session.state === 'PAUSED') session.resume();
        },
      }}
    >
      {children}
      {editing && profile.data ? (
        <PersonalProfileEditor profile={profile.data} onClose={() => setEditing(false)} />
      ) : null}
      {editing && !profile.data ? (
        <V4FloatingWorkspace
          open
          title="My Profile"
          onRequestClose={() => setEditing(false)}
          footer={null}
          panelClassName="v4-profile-editor"
        >
          {profile.isError ? (
            <p role="alert">
              Your profile could not load.{' '}
              <button onClick={() => void profile.refetch()}>Retry</button>
            </p>
          ) : (
            <p role="status">Loading profile…</p>
          )}
        </V4FloatingWorkspace>
      ) : null}
    </Context.Provider>
  );
}
export const useShellData = () => useContext(Context);
