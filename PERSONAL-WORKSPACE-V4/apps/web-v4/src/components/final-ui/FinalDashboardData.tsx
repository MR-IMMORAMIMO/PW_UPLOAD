import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, generatePath } from 'react-router-dom';
import { api } from '../../api/environment';
import {
  dateKeyInTimezone,
  deriveDashboardView,
  dueDetail,
  formatDashboardDate,
  formatMeetingDateTime,
  needAttentionReason,
} from '../../pages/dashboard/dashboardViewModel';
import { formatProjectStatus } from '../project/statusDisplay';
import {
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_REVISIONS,
} from '../../router/routes';
import { useFinalUiPreferences } from './useFinalUiPreferences';
import { C } from './tokens';

export interface DashboardListItem {
  key: string;
  primary: string;
  secondary: string;
  open(): void;
}
function useData() {
  const navigate = useNavigate();
  const preferences = useFinalUiPreferences();
  const projectsQuery = useQuery({
    queryKey: ['v4', 'dashboard', 'projects'],
    queryFn: () => api.projects(),
    staleTime: 30_000,
  });
  const operationsQuery = useQuery({
    queryKey: ['v4', 'dashboard', 'operations'],
    queryFn: () => api.personalOperations(),
    staleTime: 30_000,
  });
  const projects = projectsQuery.data ?? [];
  const today = dateKeyInTimezone(new Date());
  const dashboard = deriveDashboardView(projects, today);
  const open = (route: string, projectId: string) => () =>
    navigate(generatePath(route, { projectId }));
  const projectCode = (id: string) =>
    projects.find((project) => project.id === id)?.projectCode ?? 'Project unavailable';
  const ATTENTION = dashboard.needAttention
    .filter((project) => {
      const reviewed = preferences.items.find(
        (item) => item.kind === 'PROJECT' && item.targetId === project.id,
      )?.reviewedAt;
      return (
        !reviewed || dateKeyInTimezone(new Date(reviewed)) !== today || reviewed < project.updatedAt
      );
    })
    .map((project) => {
      const reason = needAttentionReason(project, today);
      return {
        key: project.id,
        code: project.projectCode,
        type: project.projectType,
        city: project.siteLocation,
        status:
          reason === 'overdue'
            ? 'Overdue'
            : reason === 'revision'
              ? 'Revision Required'
              : 'Due Soon',
        statusColor: reason === 'overdue' ? C.red : C.orange,
        due: `Due ${formatDashboardDate(project.requiredDeliveryDate)}`,
        iconBg: reason === 'overdue' ? C.redLight : C.orangeLight,
        iconType: reason === 'due' ? 'calendar' : 'clock',
        iconColor: reason === 'overdue' ? C.red : C.orange,
        open: open(ROUTE_PROJECT_SUMMARY, project.id),
      };
    });
  const PROJECTS = dashboard.activeProjects.map((project) => ({
    key: project.id,
    id: project.projectCode,
    sub: project.projectType,
    city: project.siteLocation,
    status: formatProjectStatus(project.status),
    due: formatDashboardDate(project.requiredDeliveryDate),
    days: dueDetail(project.requiredDeliveryDate, today),
    pct: project.progressPercent,
    open: open(ROUTE_PROJECT_SUMMARY, project.id),
  }));
  const OVERDUE_ALL: DashboardListItem[] = (operationsQuery.data?.overdueActions ?? []).map(
    (item) => ({
      key: item.id,
      primary: projectCode(item.projectId),
      secondary: item.title,
      open: () =>
        navigate(
          `${generatePath(ROUTE_PROJECT_ACTIONS, { projectId: item.projectId })}?actionId=${encodeURIComponent(item.id)}`,
        ),
    }),
  );
  const MEETINGS_ALL = (operationsQuery.data?.upcomingMeetings ?? []).map((item) => ({
    key: item.id,
    name: item.title,
    dt: formatMeetingDateTime(item.startAt),
    open: () =>
      navigate(
        `${generatePath(ROUTE_PROJECT_MEETINGS, { projectId: item.projectId })}?meetingId=${encodeURIComponent(item.id)}`,
      ),
  }));
  const BLOCKING_ALL = (operationsQuery.data?.blockingRequirements ?? []).map((item) => ({
    key: item.id,
    id: projectCode(item.projectId),
    note: item.title,
    open: open(ROUTE_PROJECT_SCOPE, item.projectId),
  }));
  // The approved card lists Project delivery dates. These are planned deliveries,
  // never claims that an output has already been generated or finalized.
  const DELIVERABLES_ALL = dashboard.activeProjects
    .filter((project) => project.requiredDeliveryDate >= today)
    .map((project) => ({
      key: project.id,
      id: project.projectCode,
      date: formatDashboardDate(project.requiredDeliveryDate),
      open: open(ROUTE_PROJECT_REVISIONS, project.id),
    }));
  const OPERATIONS_ALL = [
    { section: 'Overdue Actions', color: C.red, bg: C.redLight, items: OVERDUE_ALL },
    {
      section: 'Upcoming Meetings',
      color: C.blueAlt,
      bg: C.blueLight,
      items: MEETINGS_ALL.map((item) => ({ ...item, primary: item.name, secondary: item.dt })),
    },
    {
      section: 'Blocking Requirements',
      color: C.orangeAlt,
      bg: C.orangeLight2,
      items: BLOCKING_ALL.map((item) => ({ ...item, primary: item.id, secondary: item.note })),
    },
    {
      section: 'Upcoming Deliverables',
      color: C.indigoAlt,
      bg: C.indigoLight,
      items: DELIVERABLES_ALL.map((item) => ({ ...item, primary: item.id, secondary: item.date })),
    },
  ];
  return {
    ATTENTION,
    PROJECTS,
    OVERDUE_ALL,
    MEETINGS_ALL,
    BLOCKING_ALL,
    DELIVERABLES_ALL,
    OPERATIONS_ALL,
    dashboard,
    markReviewed: () =>
      ATTENTION.forEach((item) =>
        preferences.update({ kind: 'PROJECT', targetId: item.key, markReviewed: true }),
      ),
    loading: projectsQuery.isLoading || operationsQuery.isLoading,
    error:
      projectsQuery.error?.message ?? operationsQuery.error?.message ?? preferences.error?.message,
    retry: () => {
      void projectsQuery.refetch();
      void operationsQuery.refetch();
    },
  };
}
const Context = createContext<ReturnType<typeof useData> | null>(null);
export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const value = useData();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDashboardData() {
  const value = useContext(Context);
  if (!value) throw new Error('Dashboard data provider required.');
  return value;
}
