import { FinalProjectHeader } from '../../components/final-ui/ProjectHeader';
import FinalActionsView from '../../components/final-ui/FinalActionsView';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generatePath, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { V4Button } from '../../components/common/V4Button';
import {
  SctSuccess as CheckCircle2,
  SctWarning as CircleAlert,
  SctLive as CircleDot,
  SctMore as MoreHorizontal,
  SctActions as ListTodo,
  SctRemove as Unlink,
} from '../../components/common/SctIcons';
import {
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Flag,
  Link2,
  Plus,
  Search,
  Tags,
  UserRound,
  X,
} from '../../components/common/SctIcons';
import type {
  ActionCategory,
  ActionCategoryColorKey,
  ActionCategoryIconKey,
  MeetingActionLink,
  MeetingListItem,
  ProjectActionItem,
} from '@scli/domain';
import { api } from '../../api/environment';
import {
  businessTodayKey,
  formatBusinessDateOnly,
  formatBusinessDateTime,
} from '../../date-time/businessDateTime';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { V4Drawer } from '../../components/common/V4Drawer';
import { V4TextEditor } from '../../components/common/V4TextEditor';
import { ActionDetailsEditor } from './ActionDetailsEditor';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4Pagination } from '../../components/common/V4Pagination';
import { V4RouteErrorState } from '../../components/common/V4RouteErrorState';
import { V4StatusPill, type V4StatusPillVariant } from '../../components/common/V4StatusPill';
import { actionCategoryIconFor } from '../../components/common/actionCategoryIconCatalog';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { V4AppShell } from '../../components/shell/V4AppShell';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import {
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_COMMENTS,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
} from '../../router/routes';
import {
  ACTIONS_PER_PAGE,
  actionDueState,
  actionDueLabel,
  actionKpis,
  actionStatusLabel,
  actionUpdateInput,
  effectiveActionPage,
  filterActions,
} from './actionsViewModel';
import {
  ActionDrawer,
  actionPriorities as priorities,
  actionStatuses as statuses,
  type ActionDraft as Draft,
} from './ActionDrawer';

const today = () => businessTodayKey();
const variantFor = (status: ProjectActionItem['status']): V4StatusPillVariant =>
  status === 'Completed'
    ? 'success'
    : status === 'Cancelled'
      ? 'neutral'
      : status === 'Waiting'
        ? 'warning'
        : 'info';
const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
const dateLabel = (value: string | null) =>
  value ? formatBusinessDateOnly(value) || value : 'No due date';
const meetingDateTime = (value: string) =>
  formatBusinessDateTime(value, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
  });
const actionMeetingRelationLabel = (relationType: MeetingActionLink['relationType']) =>
  relationType === 'CreatedFromMeeting' ? 'Created in this meeting' : 'Linked to this meeting';

type ActionCategoryPresentation = {
  label: string;
  iconKey: ActionCategoryIconKey;
  colorKey: ActionCategoryColorKey;
};

const actionCategoryPresentation = (
  categoryId: ProjectActionItem['categoryId'],
  categoryMap: ReadonlyMap<string, ActionCategory>,
): ActionCategoryPresentation => {
  if (categoryId === null) return { label: 'Uncategorized', iconKey: 'tags', colorKey: 'slate' };
  const category = categoryMap.get(categoryId);
  return category
    ? { label: category.label, iconKey: category.iconKey, colorKey: category.colorKey }
    : { label: 'Category unavailable', iconKey: 'tags', colorKey: 'slate' };
};

export function ProjectActionsWorkspace({ finalView = false }: { finalView?: boolean }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [moreFilters, setMoreFilters] = useState(false);
  const [dueFilter, setDueFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [luminaireFilter, setLuminaireFilter] = useState('');
  const [textEdit, setTextEdit] = useState<{
    item: ProjectActionItem;
    field: 'details' | 'notes';
  } | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [owner, setOwner] = useState('');
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAllMeetings, setShowAllMeetings] = useState(false);
  const [meetingPickerOpen, setMeetingPickerOpen] = useState(false);
  const [meetingSearch, setMeetingSearch] = useState('');
  const [meetingCandidateId, setMeetingCandidateId] = useState<string | null>(null);
  const [unlinkMeetingTarget, setUnlinkMeetingTarget] = useState<{
    meeting: MeetingListItem;
    relation: MeetingActionLink;
  } | null>(null);
  const linkMeetingTriggerRef = useRef<HTMLButtonElement>(null);
  const meetingPickerWasOpen = useRef(false);
  const [editing, setEditing] = useState<ProjectActionItem | 'new' | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const projectQuery = useQuery({
    queryKey: ['v4', 'actions', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: !!projectId,
  });
  const workspaceQuery = useQuery({
    queryKey: ['v4', 'actions', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: !!projectId,
  });
  const requestedActionId = searchParams.get('actionId');
  useEffect(() => {
    if (
      requestedActionId &&
      workspaceQuery.data?.actions.some((row) => row.id === requestedActionId)
    ) {
      setSelectedId(requestedActionId);
    }
  }, [requestedActionId, workspaceQuery.data]);
  const categoryQuery = useQuery({
    queryKey: ['v4', 'action-categories'],
    queryFn: () => api.listActionCategories(),
  });
  const meetingLinksQuery = useQuery({
    queryKey: ['v4', 'actions', 'meeting-links', projectId, selectedId],
    queryFn: () => api.listActionMeetingLinks(projectId as string, selectedId as string),
    enabled: !!projectId && !!selectedId,
  });
  const meetingsQuery = useQuery({
    queryKey: ['v4', 'meetings', 'list', projectId],
    queryFn: () => api.listMeetings(projectId as string),
    enabled: !!projectId,
  });
  const saveAction = useMutation({
    mutationFn: async ({
      action,
      draft,
      meetingId,
    }: {
      action: ProjectActionItem | 'new';
      draft: Draft;
      meetingId?: string;
    }) => {
      const saved =
        action === 'new'
          ? await api.createAction(projectId!, {
              ...draft,
              sourceType: 'Manual',
              sourceId: null,
              revisionId: null,
            })
          : finalView
            ? await api.patchProjectAction(projectId!, action.id, {
                ...draft,
                rowVersion: action.rowVersion ?? 1,
              })
            : await api.updateAction(projectId!, action.id, actionUpdateInput(action, draft));
      if (meetingId) {
        try {
          await api.linkMeetingAction(projectId!, meetingId, { actionId: saved.id });
        } catch (cause) {
          setEditing(saved);
          await queryClient.invalidateQueries({
            queryKey: ['v4', 'actions', 'workspace', projectId],
          });
          throw new Error(
            'Action saved, but the meeting link failed. Retry saving to link this existing action. ' +
              (cause instanceof Error ? cause.message : ''),
          );
        }
        await refreshMeetingRelationship(meetingId, saved.id);
      }
      return saved;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v4', 'actions', 'workspace', projectId] });
      setEditing(null);
    },
  });
  const refreshMeetingRelationship = (meetingId: string, actionId: string) =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['v4', 'actions', 'meeting-links', projectId, actionId],
      }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'meetings', 'list', projectId] }),
      queryClient.invalidateQueries({
        queryKey: ['v4', 'meetings', 'detail', projectId, meetingId],
      }),
    ]);
  const linkMeeting = useMutation({
    mutationFn: ({ meetingId, actionId }: { meetingId: string; actionId: string }) =>
      api.linkMeetingAction(projectId as string, meetingId, { actionId }),
    onSuccess: async (_, { meetingId, actionId }) => {
      await refreshMeetingRelationship(meetingId, actionId);
      setMeetingPickerOpen(false);
      setMeetingSearch('');
      setMeetingCandidateId(null);
    },
  });
  const unlinkMeeting = useMutation({
    mutationFn: ({ meetingId, actionId }: { meetingId: string; actionId: string }) =>
      api.unlinkMeetingAction(projectId as string, meetingId, actionId),
    onSuccess: async (_, { meetingId, actionId }) => {
      await refreshMeetingRelationship(meetingId, actionId);
      setUnlinkMeetingTarget(null);
    },
  });
  const refreshCategories = () =>
    queryClient.invalidateQueries({ queryKey: ['v4', 'action-categories'] });
  const createCategory = async (input: {
    label: string;
    iconKey: ActionCategoryIconKey;
    colorKey: ActionCategoryColorKey;
  }) => {
    const created = await api.createActionCategory(input);
    await refreshCategories();
    return created;
  };
  const updateCategory = async (
    id: string,
    input: { label: string; iconKey: ActionCategoryIconKey; colorKey: ActionCategoryColorKey },
  ) => {
    const updated = await api.updateActionCategory(id, input);
    await refreshCategories();
    return updated;
  };
  const deleteCategory = async (item: ActionCategory, replacementId?: string | null) => {
    await api.replaceAndDeleteActionCategory(item.id, replacementId ?? null);
    if (category === item.id) setCategory('');
    await Promise.all([
      refreshCategories(),
      queryClient.invalidateQueries({ queryKey: ['v4', 'actions', 'workspace', projectId] }),
    ]);
    const refreshed = await workspaceQuery.refetch();
    setEditing((current) =>
      current && current !== 'new'
        ? (refreshed.data?.actions.find((action) => action.id === current.id) ?? current)
        : current,
    );
  };
  const actions = workspaceQuery.data?.actions ?? [];
  const categories = categoryQuery.data ?? [];
  const categoryMap = useMemo(
    () => new Map(categories.map((item) => [item.id, item])),
    [categories],
  );
  const currentToday = today();
  const filtered = useMemo(
    () =>
      filterActions(actions, { query, status, owner, priority, category })
        .filter(
          (item) =>
            !dueFilter ||
            (dueFilter === 'active'
              ? item.status !== 'Completed' && item.status !== 'Cancelled'
              : dueFilter === 'soon'
                ? ['today', 'soon'].includes(actionDueState(item, currentToday))
                : actionDueState(item, currentToday) === dueFilter),
        )
        .filter(
          (item) =>
            (!areaFilter || item.area === areaFilter) &&
            (!luminaireFilter || item.luminaireId === luminaireFilter),
        ),
    [
      actions,
      category,
      owner,
      priority,
      query,
      status,
      dueFilter,
      currentToday,
      areaFilter,
      luminaireFilter,
    ],
  );
  const safePage = effectiveActionPage(page, filtered.length);
  const pageItems = filtered.slice(safePage * ACTIONS_PER_PAGE, (safePage + 1) * ACTIONS_PER_PAGE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / ACTIONS_PER_PAGE));
  const selected = filtered.find((item) => item.id === selectedId) ?? null;
  const meetingMap = useMemo(
    () => new Map((meetingsQuery.data ?? []).map((meeting) => [meeting.id, meeting])),
    [meetingsQuery.data],
  );
  const linkedMeetings = useMemo(
    () =>
      (meetingLinksQuery.data ?? [])
        .map((relation) => {
          const meeting = meetingMap.get(relation.meetingId);
          return meeting ? { meeting, relation } : null;
        })
        .filter(
          (
            item,
          ): item is {
            meeting: MeetingListItem;
            relation: MeetingActionLink;
          } => item !== null,
        )
        .sort((a, b) => Date.parse(b.meeting.startAt) - Date.parse(a.meeting.startAt)),
    [meetingLinksQuery.data, meetingMap],
  );
  const linkedMeetingIds = useMemo(
    () => new Set(linkedMeetings.map(({ meeting }) => meeting.id)),
    [linkedMeetings],
  );
  const availableMeetings = (meetingsQuery.data ?? []).filter(
    (meeting) => !linkedMeetingIds.has(meeting.id),
  );
  const normalizedMeetingSearch = meetingSearch.trim().toLocaleLowerCase();
  const meetingCandidates = availableMeetings.filter((meeting) =>
    [meeting.title, meeting.status, meetingDateTime(meeting.startAt)]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedMeetingSearch),
  );
  useEffect(() => {
    setPage(safePage);
  }, [safePage]);
  useEffect(() => {
    if (selectedId && !filtered.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [filtered, selectedId]);
  useEffect(() => {
    setPage(0);
  }, [query, status, owner, priority, category, dueFilter, areaFilter, luminaireFilter, projectId]);
  useEffect(() => {
    setShowAllMeetings(false);
    setMeetingPickerOpen(false);
    setMeetingSearch('');
    setMeetingCandidateId(null);
    setUnlinkMeetingTarget(null);
  }, [selectedId]);
  useEffect(() => {
    if (meetingPickerWasOpen.current && !meetingPickerOpen) linkMeetingTriggerRef.current?.focus();
    meetingPickerWasOpen.current = meetingPickerOpen;
  }, [meetingPickerOpen]);
  const updateStatus = (item: ProjectActionItem, next: ProjectActionItem['status']) =>
    saveAction.mutate({
      action: item,
      draft: {
        title: item.title,
        details: item.details,
        owner: item.owner,
        ownerRole: item.ownerRole,
        dueDate: item.dueDate,
        status: next,
        priority: item.priority,
        categoryId: item.categoryId,
        notes: item.notes,
        ...(item.area === undefined ? {} : { area: item.area }),
        ...(item.luminaireId === undefined ? {} : { luminaireId: item.luminaireId }),
        ...(item.reviewItemId === undefined ? {} : { reviewItemId: item.reviewItemId }),
      },
    });
  const owners = [...new Set(actions.map((item) => item.owner.trim()).filter(Boolean))].sort();
  const hasFilters = Boolean(
    query || status || owner || priority || category || dueFilter || areaFilter || luminaireFilter,
  );
  const clearFilters = () => {
    setAreaFilter('');
    setLuminaireFilter('');
    setDueFilter('');
    setQuery('');
    setStatus('');
    setOwner('');
    setPriority('');
    setCategory('');
    setPage(0);
  };
  const kpis = actionKpis(actions, currentToday);
  const loading = projectQuery.isLoading || workspaceQuery.isLoading;
  const error = projectQuery.isError || workspaceQuery.isError;
  const retrying = projectQuery.isFetching || workspaceQuery.isFetching;
  const categoriesAvailable = !categoryQuery.isError && !categoryQuery.isLoading;
  const routes: Record<string, string> = {
    summary: ROUTE_PROJECT_SUMMARY,
    workflow: ROUTE_PROJECT_WORKFLOW_TIMELINE,
    scope: ROUTE_PROJECT_SCOPE,
    actions: ROUTE_PROJECT_ACTIONS,
    meetings: ROUTE_PROJECT_MEETINGS,
    comments: ROUTE_PROJECT_COMMENTS,
    datasheets: ROUTE_PROJECT_DATASHEETS_IMAGES,
    'technical-check': ROUTE_PROJECT_TECHNICAL_CHECK,
    'lighting-schedule': ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
    'technical-boq': ROUTE_PROJECT_TECHNICAL_BOQ,
  };
  return (
    <V4AppShell
      finalContacts={finalView}
      context="project"
      boundedPage
      sidebarMode={mode}
      onToggleSidebarMode={() =>
        setMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      activeSectionId="actions"
      onSelectSection={(id) => {
        if (projectId && routes[id]) navigate(generatePath(routes[id], { projectId }));
      }}
      project={
        projectQuery.data
          ? {
              projectCode: projectQuery.data.projectCode,
              projectName: projectQuery.data.projectName,
              status: projectQuery.data.status ?? null,
            }
          : null
      }
      projectLoading={loading}
      projectContextHeader={
        <V4ProjectContextHeader
          data={{
            projectCode: projectQuery.data?.projectCode ?? '',
            projectName: projectQuery.data?.projectName ?? '',
            clientName: projectQuery.data?.clientName ?? null,
            projectType: projectQuery.data?.projectType ?? null,
            designStage: projectQuery.data?.designStage ?? null,
            requiredDeliveryDate: projectQuery.data?.requiredDeliveryDate ?? null,
          }}
          actions={
            <V4ProjectEditAction
              project={projectQuery.data}
              projectQueryKey={['v4', 'actions', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        <V4PageHeader
          icon={ListTodo}
          title="Actions"
          description="Track design tasks, follow-ups, and issue-related work."
        />
      }
    >
      <div
        className={finalView ? 'final-ui-reference' : 'v4-actions v4-bounded-page'}
        style={finalView ? { flexDirection: 'column', minHeight: 0 } : undefined}
        data-testid="v4-project-actions"
      >
        {finalView ? <FinalProjectHeader /> : null}
        {loading ? (
          <div className="v4-actions__state" aria-busy="true">
            Loading actions…
          </div>
        ) : error ? (
          <V4RouteErrorState
            title="Unable to load actions"
            message="Project actions could not be loaded."
            retrying={retrying}
            onRetry={() => void Promise.all([projectQuery.refetch(), workspaceQuery.refetch()])}
          />
        ) : finalView && workspaceQuery.data ? (
          <FinalActionsView
            binding={{
              bulk: async (ids, changes) => {
                let saved = 0;
                const failures: string[] = [];
                for (const id of ids) {
                  const item = actions.find((candidate) => candidate.id === id);
                  if (!item) {
                    failures.push('A selected action no longer exists');
                    continue;
                  }
                  try {
                    await api.patchProjectAction(projectId!, id, {
                      ...changes,
                      rowVersion: item.rowVersion ?? 1,
                    });
                    saved++;
                  } catch (error) {
                    failures.push(
                      `${item.title}: ${error instanceof Error ? error.message : 'Update failed'}`,
                    );
                  }
                }
                await queryClient.invalidateQueries({
                  queryKey: ['v4', 'actions', 'workspace', projectId],
                });
                if (failures.length)
                  throw new Error(
                    `${saved} saved; ${failures.length} need attention. ${failures.join(' · ')}`,
                  );
              },
              items: pageItems,
              selected,
              workspace: workspaceQuery.data,
              categories,
              today: currentToday,
              kpis,
              activeKpi:
                status === 'Completed'
                  ? 'completed'
                  : dueFilter === 'active'
                    ? 'open'
                    : dueFilter === 'soon'
                      ? 'dueSoon'
                      : dueFilter === 'overdue'
                        ? 'overdue'
                        : '',
              clearFilters,
              hasFilters: Boolean(hasFilters),
              kpi: (key) => {
                clearFilters();
                if (key === 'completed') setStatus('Completed');
                else
                  setDueFilter(key === 'open' ? 'active' : key === 'dueSoon' ? 'soon' : 'overdue');
              },
              filters: [
                {
                  label: 'Status',
                  value: status,
                  options: [
                    { value: '', label: 'All Statuses' },
                    ...statuses.map((value) => ({ value, label: actionStatusLabel(value) })),
                  ],
                  change: setStatus,
                },
                {
                  label: 'Owner',
                  value: owner,
                  options: [
                    { value: '', label: 'All Owners' },
                    { value: '__unassigned__', label: 'Unassigned' },
                    ...owners.map((value) => ({ value, label: value })),
                  ],
                  change: setOwner,
                },
                {
                  label: 'Priority',
                  value: priority,
                  options: [
                    { value: '', label: 'All Priorities' },
                    ...priorities.map((value) => ({
                      value,
                      label: value === 'Normal' ? 'Medium' : value,
                    })),
                  ],
                  change: setPriority,
                },
                {
                  label: 'Category',
                  value: category,
                  options: [
                    { value: '', label: 'All Categories' },
                    { value: '__uncategorized__', label: 'Uncategorized' },
                    ...categories.map((item) => ({ value: item.id, label: item.label })),
                  ],
                  change: setCategory,
                },
              ],
              query,
              setQuery,
              page: safePage,
              pages: pageCount,
              total: filtered.length,
              setPage,
              select: setSelectedId,
              edit: setEditing,
              editText: (item, field) => setTextEdit({ item, field }),
              add: () => setEditing('new'),
              status: updateStatus,
              pending: saveAction.isPending,
              linkedMeetings: linkedMeetings.map((item) => item.meeting),
              meetingsState:
                meetingLinksQuery.isLoading || meetingsQuery.isLoading
                  ? 'loading'
                  : meetingLinksQuery.isError || meetingsQuery.isError
                    ? 'error'
                    : 'ready',
              meetings: () =>
                navigate(
                  generatePath(ROUTE_PROJECT_MEETINGS, { projectId: projectId! }) +
                    (linkedMeetings[0]
                      ? '?meetingId=' + encodeURIComponent(linkedMeetings[0].meeting.id)
                      : ''),
                ),
              comment: () =>
                navigate(
                  generatePath(ROUTE_PROJECT_COMMENTS, { projectId: projectId! }) +
                    (selected?.reviewItemId
                      ? '?threadId=' + encodeURIComponent(selected.reviewItemId)
                      : ''),
                ),
              linked: () =>
                navigate(
                  generatePath(
                    selected?.luminaireId
                      ? '/projects/:projectId/luminaires'
                      : selected?.reviewItemId
                        ? ROUTE_PROJECT_COMMENTS
                        : ROUTE_PROJECT_MEETINGS,
                    { projectId: projectId! },
                  ) +
                    (selected?.luminaireId
                      ? '?luminaireId=' + encodeURIComponent(selected.luminaireId)
                      : selected?.reviewItemId
                        ? '?threadId=' + encodeURIComponent(selected.reviewItemId)
                        : linkedMeetings[0]
                          ? '?meetingId=' + encodeURIComponent(linkedMeetings[0].meeting.id)
                          : ''),
                ),
              more: () => setMoreFilters(true),
              notice: saveAction.isError ? (
                <p role="alert">
                  {saveAction.error instanceof Error
                    ? saveAction.error.message
                    : 'Unable to save action.'}
                </p>
              ) : categoryQuery.isError ? (
                <p role="alert">
                  Action categories could not be loaded.{' '}
                  <button onClick={() => void categoryQuery.refetch()}>Retry categories</button>
                </p>
              ) : null,
            }}
          />
        ) : (
          <>
            <div
              className={`v4-actions__workspace${selected ? ' v4-actions__workspace--inspector-open' : ''}`}
            >
              <div className="v4-actions__main">
                <div className="v4-actions__kpis">
                  {[
                    [ListTodo, 'Open', kpis.open, 'Currently active work', 'info'],
                    [CalendarClock, 'Due Soon', kpis.dueSoon, 'Due in next 7 days', 'warning'],
                    [CircleAlert, 'Overdue', kpis.overdue, 'Needs attention', 'danger'],
                    [CheckCircle2, 'Completed', kpis.completed, 'Completed actions', 'success'],
                  ].map(([Icon, label, count, support, tone]) => {
                    const CardIcon = Icon as typeof CheckSquare;
                    return (
                      <section key={label as string} className="v4-actions__kpi" data-tone={tone}>
                        <span className="v4-actions__kpi-icon">
                          <CardIcon aria-hidden="true" />
                        </span>
                        <span className="v4-actions__kpi-label">{label as string}</span>
                        <strong>{count as number}</strong>
                        <small>{support as string}</small>
                      </section>
                    );
                  })}
                </div>
                <section className="v4-actions__collection" aria-label="Project actions">
                  <div className="v4-actions__toolbar" role="toolbar" aria-label="Action filters">
                    <label className="v4-actions__search">
                      <Search aria-hidden="true" />
                      <span className="v4-visually-hidden">Search actions</span>
                      <input
                        placeholder="Search actions..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <div className="v4-actions__filter v4-actions__filter--priority">
                      <Flag aria-hidden="true" />
                      <span className="v4-visually-hidden">Priority</span>
                      <V4FilterSelect
                        label="Priority"
                        value={priority}
                        onChange={setPriority}
                        options={[
                          { value: '', label: 'Priority: All' },
                          ...priorities.map((value) => ({ value, label: value })),
                        ]}
                      />
                    </div>
                    <span className="v4-actions__due-spacer" aria-hidden="true" />
                    <div className="v4-actions__filter v4-actions__filter--owner">
                      <UserRound aria-hidden="true" />
                      <span className="v4-visually-hidden">Owner</span>
                      <V4FilterSelect
                        label="Owner"
                        value={owner}
                        onChange={setOwner}
                        options={[
                          { value: '', label: 'Owner: All' },
                          ...(actions.some((item) => !item.owner.trim())
                            ? [{ value: '__unassigned__', label: 'Unassigned' }]
                            : []),
                          ...owners.map((value) => ({ value, label: value })),
                        ]}
                      />
                    </div>
                    <div className="v4-actions__filter v4-actions__filter--category">
                      <Tags aria-hidden="true" />
                      <span className="v4-visually-hidden">Category</span>
                      <V4FilterSelect
                        label="Category"
                        value={category}
                        disabled={!categoriesAvailable}
                        onChange={setCategory}
                        options={[
                          { value: '', label: 'Category: All' },
                          { value: '__uncategorized__', label: 'Uncategorized' },
                          ...categories.map((item) => ({ value: item.id, label: item.label })),
                        ]}
                      />
                    </div>
                    <div className="v4-actions__filter v4-actions__filter--status">
                      <CircleDot aria-hidden="true" />
                      <span className="v4-visually-hidden">Status</span>
                      <V4FilterSelect
                        label="Status"
                        value={status}
                        onChange={setStatus}
                        options={[
                          { value: '', label: 'Status: All' },
                          ...statuses.map((value) => ({ value, label: actionStatusLabel(value) })),
                        ]}
                      />
                    </div>
                    <button
                      className="v4-actions__primary v4-actions__toolbar-add"
                      type="button"
                      onClick={() => setEditing('new')}
                    >
                      <Plus aria-hidden="true" /> Add Action
                    </button>
                    {hasFilters ? (
                      <button
                        type="button"
                        className="v4-actions__secondary"
                        onClick={clearFilters}
                      >
                        Clear Filters
                      </button>
                    ) : null}
                    {!categoriesAvailable ? (
                      <p className="v4-actions__category-error" role="alert">
                        Category catalog is unavailable.{' '}
                        <button type="button" onClick={() => void categoryQuery.refetch()}>
                          Retry categories
                        </button>
                      </p>
                    ) : null}
                  </div>
                  {pageItems.length ? (
                    <div className="v4-actions__table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Action</th>
                            <th>Priority</th>
                            <th>Due Date</th>
                            <th>Owner</th>
                            <th>Category</th>
                            <th>Status</th>
                            <th>
                              <span className="v4-visually-hidden">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageItems.map((item) => {
                            const categoryPresentation = actionCategoryPresentation(
                              item.categoryId,
                              categoryMap,
                            );
                            const CategoryIcon = actionCategoryIconFor(
                              categoryPresentation.iconKey,
                            );
                            const due = actionDueState(item, currentToday);
                            return (
                              <tr
                                key={item.id}
                                className={
                                  selectedId === item.id ? 'v4-actions__row--selected' : ''
                                }
                                tabIndex={0}
                                onClick={() => setSelectedId(item.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setSelectedId(item.id);
                                  }
                                }}
                              >
                                <td>
                                  <span className="v4-actions__action-cell">
                                    <CategoryIcon
                                      className={`v4-actions__category-icon v4-actions__category--${categoryPresentation.colorKey}`}
                                      aria-hidden="true"
                                    />
                                    <span>
                                      <strong>{item.title}</strong>
                                      {item.details ? <small>{item.details}</small> : null}
                                    </span>
                                  </span>
                                </td>
                                <td>
                                  <V4StatusPill
                                    variant={
                                      item.priority === 'Urgent'
                                        ? 'danger'
                                        : item.priority === 'High'
                                          ? 'warning'
                                          : 'info'
                                    }
                                  >
                                    {item.priority}
                                  </V4StatusPill>
                                </td>
                                <td data-due-state={due}>
                                  <span className="v4-actions__due">
                                    <CalendarDays aria-hidden="true" />
                                    <span>{dateLabel(item.dueDate)}</span>
                                    <small>{actionDueLabel(due, item.dueDate, currentToday)}</small>
                                  </span>
                                </td>
                                <td>
                                  {item.owner ? (
                                    <span className="v4-actions__owner">
                                      <b>{initials(item.owner)}</b>
                                      <span>
                                        <strong>{item.owner}</strong>
                                        {item.ownerRole ? <small>{item.ownerRole}</small> : null}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="v4-actions__owner">
                                      <b>—</b>
                                      <span>
                                        <strong>Unassigned</strong>
                                      </span>
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <span
                                    className={`v4-actions__category v4-actions__category--${categoryPresentation.colorKey}`}
                                  >
                                    <CategoryIcon aria-hidden="true" />
                                    {categoryPresentation.label}
                                  </span>
                                </td>
                                <td>
                                  <V4StatusPill variant={variantFor(item.status)}>
                                    {actionStatusLabel(item.status)}
                                  </V4StatusPill>
                                </td>
                                <td className="v4-actions__row-menu">
                                  <button
                                    type="button"
                                    aria-label={`Actions for ${item.title}`}
                                    aria-expanded={menuId === item.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMenuId((current) =>
                                        current === item.id ? null : item.id,
                                      );
                                    }}
                                  >
                                    <MoreHorizontal aria-hidden="true" />
                                  </button>
                                  {menuId === item.id ? (
                                    <div role="menu">
                                      <button
                                        role="menuitem"
                                        type="button"
                                        onClick={() => {
                                          setEditing(item);
                                          setMenuId(null);
                                        }}
                                      >
                                        Edit
                                      </button>
                                      {item.status === 'Completed' ||
                                      item.status === 'Cancelled' ? (
                                        <button
                                          role="menuitem"
                                          type="button"
                                          onClick={() => {
                                            updateStatus(item, 'Open');
                                            setMenuId(null);
                                          }}
                                        >
                                          Reopen
                                        </button>
                                      ) : (
                                        <>
                                          <button
                                            className="v4-actions__lifecycle-cancel"
                                            role="menuitem"
                                            type="button"
                                            onClick={() => {
                                              updateStatus(item, 'Completed');
                                              setMenuId(null);
                                            }}
                                          >
                                            Mark Complete
                                          </button>
                                          <button
                                            role="menuitem"
                                            type="button"
                                            onClick={() => {
                                              updateStatus(item, 'Cancelled');
                                              setMenuId(null);
                                            }}
                                          >
                                            Cancel Action
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="v4-actions__empty">
                      {actions.length === 0 ? (
                        <>
                          <strong>No actions yet</strong>
                          <span>Create an action to track project follow-ups and design work.</span>
                          <button
                            type="button"
                            className="v4-actions__primary"
                            onClick={() => setEditing('new')}
                          >
                            <Plus aria-hidden="true" /> Add Action
                          </button>
                        </>
                      ) : (
                        <>
                          <strong>No actions match the current filters.</strong>
                          <button
                            type="button"
                            className="v4-actions__secondary"
                            onClick={clearFilters}
                          >
                            Clear Filters
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <footer className="v4-actions__collection-footer">
                    {filtered.length ? (
                      <span>
                        Showing {safePage * ACTIONS_PER_PAGE + 1}–
                        {safePage * ACTIONS_PER_PAGE + pageItems.length} of {filtered.length}{' '}
                        {filtered.length === 1 ? 'action' : 'actions'}
                      </span>
                    ) : null}
                    <V4Pagination
                      pageCount={pageCount}
                      currentPage={safePage}
                      onChange={setPage}
                      ariaLabel="Action pages"
                    />
                  </footer>
                </section>
              </div>
              {selected ? (
                <aside className="v4-actions__inspector" aria-label="Action details">
                  <>
                    <header>
                      <div className="v4-actions__inspector-title-row">
                        <strong>{selected.title}</strong>
                        <button
                          className="v4-actions__close"
                          type="button"
                          aria-label="Close action details"
                          onClick={() => setSelectedId(null)}
                        >
                          <X aria-hidden="true" />
                        </button>
                      </div>
                      <div className="v4-actions__inspector-status">
                        <span className="v4-visually-hidden">Status</span>
                        <V4FilterSelect
                          variant="status"
                          label="Status"
                          value={selected.status}
                          onChange={(value) =>
                            updateStatus(selected, value as ProjectActionItem['status'])
                          }
                          options={statuses.map((value) => ({
                            value,
                            label: actionStatusLabel(value),
                            tone: variantFor(value),
                          }))}
                        />
                      </div>
                    </header>
                    <section className="v4-actions__inspector-section">
                      <div className="v4-actions__section-heading">
                        <strong>Details</strong>
                        <button type="button" onClick={() => setEditing(selected)}>
                          Edit
                        </button>
                      </div>
                      <p className="v4-actions__details-copy">
                        {selected.details || 'No details added.'}
                      </p>
                      <dl>
                        <div>
                          <dt>Priority</dt>
                          <dd>
                            <V4StatusPill
                              variant={
                                selected.priority === 'Urgent'
                                  ? 'danger'
                                  : selected.priority === 'High'
                                    ? 'warning'
                                    : 'info'
                              }
                            >
                              {selected.priority}
                            </V4StatusPill>
                          </dd>
                        </div>
                        <div>
                          <dt>Due Date</dt>
                          <dd>
                            <span className="v4-actions__due">
                              <CalendarDays aria-hidden="true" />
                              <span>{dateLabel(selected.dueDate)}</span>
                              <small>
                                {actionDueLabel(
                                  actionDueState(selected, currentToday),
                                  selected.dueDate,
                                  currentToday,
                                )}
                              </small>
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt>Owner</dt>
                          <dd>
                            {selected.owner ? (
                              <span className="v4-actions__owner">
                                <b>{initials(selected.owner)}</b>
                                <span>
                                  <strong>{selected.owner}</strong>
                                  {selected.ownerRole ? <small>{selected.ownerRole}</small> : null}
                                </span>
                              </span>
                            ) : (
                              'Unassigned'
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Category</dt>
                          <dd>
                            {(() => {
                              const presentation = actionCategoryPresentation(
                                selected.categoryId,
                                categoryMap,
                              );
                              const Icon = actionCategoryIconFor(presentation.iconKey);
                              return (
                                <span
                                  className={`v4-actions__category v4-actions__category--${presentation.colorKey}`}
                                >
                                  <Icon aria-hidden="true" />
                                  {presentation.label}
                                </span>
                              );
                            })()}
                          </dd>
                        </div>
                      </dl>
                    </section>
                    <section className="v4-actions__inspector-section v4-actions__linked-meetings">
                      <div className="v4-actions__section-heading">
                        <strong>{meetingPickerOpen ? 'Link Meeting' : 'Linked Meetings'}</strong>
                        <span className="v4-actions__meeting-heading-actions">
                          {meetingPickerOpen ? (
                            <button
                              type="button"
                              disabled={linkMeeting.isPending}
                              onClick={() => setMeetingPickerOpen(false)}
                            >
                              Back
                            </button>
                          ) : (
                            <>
                              {linkedMeetings.length > 2 ? (
                                <button
                                  type="button"
                                  onClick={() => setShowAllMeetings((current) => !current)}
                                >
                                  {showAllMeetings
                                    ? 'Show less'
                                    : `View all (${linkedMeetings.length})`}
                                </button>
                              ) : null}
                              <button
                                ref={linkMeetingTriggerRef}
                                type="button"
                                onClick={() => {
                                  linkMeeting.reset();
                                  setMeetingSearch('');
                                  setMeetingCandidateId(null);
                                  setMeetingPickerOpen(true);
                                }}
                              >
                                <Link2 aria-hidden="true" /> Link Meeting
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                      {meetingPickerOpen ? (
                        <div className="v4-actions__meeting-picker">
                          <label className="v4-actions__meeting-search">
                            <Search aria-hidden="true" />
                            <span className="v4-visually-hidden">Search meetings</span>
                            <input
                              placeholder="Search meetings..."
                              value={meetingSearch}
                              disabled={linkMeeting.isPending}
                              onChange={(event) => setMeetingSearch(event.target.value)}
                            />
                          </label>
                          {meetingLinksQuery.isLoading || meetingsQuery.isLoading ? (
                            <p>Loading project meetings…</p>
                          ) : meetingLinksQuery.isError || meetingsQuery.isError ? (
                            <p role="alert">Project meetings could not be loaded.</p>
                          ) : (meetingsQuery.data?.length ?? 0) === 0 ? (
                            <p>No project meetings are available to link.</p>
                          ) : availableMeetings.length === 0 ? (
                            <p>All project meetings are already linked to this action.</p>
                          ) : meetingCandidates.length === 0 ? (
                            <p>No meetings match “{meetingSearch.trim()}”.</p>
                          ) : (
                            <div
                              className="v4-actions__meeting-candidates"
                              role="radiogroup"
                              aria-label="Meetings"
                            >
                              {meetingCandidates.map((meeting) => (
                                <label key={meeting.id}>
                                  <input
                                    type="radio"
                                    name="action-meeting-candidate"
                                    value={meeting.id}
                                    checked={meetingCandidateId === meeting.id}
                                    disabled={linkMeeting.isPending}
                                    onChange={() => setMeetingCandidateId(meeting.id)}
                                  />
                                  <CalendarDays aria-hidden="true" />
                                  <span>
                                    <strong>{meeting.title}</strong>
                                    <small>
                                      {meetingDateTime(meeting.startAt)} · {meeting.status}
                                    </small>
                                    {meeting.location ? <small>{meeting.location}</small> : null}
                                  </span>
                                </label>
                              ))}
                            </div>
                          )}
                          {linkMeeting.isError ? (
                            <p role="alert" className="v4-actions__meeting-error">
                              {linkMeeting.error instanceof Error
                                ? linkMeeting.error.message
                                : 'The Meeting could not be linked.'}
                            </p>
                          ) : null}
                          <div className="v4-actions__meeting-picker-controls">
                            <button
                              type="button"
                              disabled={linkMeeting.isPending}
                              onClick={() => setMeetingPickerOpen(false)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="v4-actions__primary"
                              disabled={!meetingCandidateId || linkMeeting.isPending}
                              onClick={() =>
                                meetingCandidateId &&
                                linkMeeting.mutate({
                                  meetingId: meetingCandidateId,
                                  actionId: selected.id,
                                })
                              }
                            >
                              {linkMeeting.isPending ? 'Linking…' : 'Link Meeting'}
                            </button>
                          </div>
                        </div>
                      ) : meetingLinksQuery.isLoading || meetingsQuery.isLoading ? (
                        <p>Loading linked meetings…</p>
                      ) : meetingLinksQuery.isError || meetingsQuery.isError ? (
                        <div className="v4-actions__linked-meetings-state">
                          <p role="alert">Linked meetings could not be loaded.</p>
                          <button
                            type="button"
                            onClick={() =>
                              void Promise.all([
                                meetingLinksQuery.refetch(),
                                meetingsQuery.refetch(),
                              ])
                            }
                          >
                            Retry
                          </button>
                        </div>
                      ) : linkedMeetings.length ? (
                        <div
                          className={`v4-actions__linked-meeting-list${
                            showAllMeetings ? ' v4-actions__linked-meeting-list--expanded' : ''
                          }`}
                        >
                          {(showAllMeetings ? linkedMeetings : linkedMeetings.slice(0, 2)).map(
                            ({ meeting, relation }) => (
                              <div className="v4-actions__linked-meeting-row" key={relation.id}>
                                <CalendarDays aria-hidden="true" />
                                <button
                                  type="button"
                                  className="v4-actions__meeting-navigation"
                                  onClick={() =>
                                    navigate(
                                      generatePath(ROUTE_PROJECT_MEETINGS, {
                                        projectId: selected.projectId,
                                      }),
                                    )
                                  }
                                >
                                  <span>
                                    <strong>{meeting.title}</strong>
                                    <small>{meetingDateTime(meeting.startAt)}</small>
                                    <small className="v4-actions__meeting-relation">
                                      {actionMeetingRelationLabel(relation.relationType)}
                                    </small>
                                  </span>
                                </button>
                                {relation.relationType === 'Linked' ? (
                                  <button
                                    type="button"
                                    className="v4-actions__meeting-unlink"
                                    aria-label={`Unlink ${meeting.title} from this action`}
                                    onClick={() => {
                                      unlinkMeeting.reset();
                                      setUnlinkMeetingTarget({ meeting, relation });
                                    }}
                                  >
                                    <Unlink aria-hidden="true" />
                                  </button>
                                ) : null}
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <p>No linked meetings.</p>
                      )}
                    </section>
                    <section className="v4-actions__inspector-section v4-actions__notes-section">
                      <div className="v4-actions__section-heading">
                        <strong>Notes</strong>
                        <button type="button" onClick={() => setEditing(selected)}>
                          Edit
                        </button>
                      </div>
                      <p className="v4-actions__details-copy">
                        {selected.notes || 'No notes added.'}
                      </p>
                    </section>
                    <dl className="v4-actions__metadata">
                      <div>
                        <dt>Created</dt>
                        <dd>{formatBusinessDateTime(selected.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{formatBusinessDateTime(selected.updatedAt)}</dd>
                      </div>
                    </dl>
                    <footer className="v4-actions__inspector-footer">
                      <button
                        className="v4-actions__primary"
                        type="button"
                        disabled={saveAction.isPending}
                        onClick={() =>
                          updateStatus(
                            selected,
                            selected.status === 'Completed' || selected.status === 'Cancelled'
                              ? 'Open'
                              : 'Completed',
                          )
                        }
                      >
                        {selected.status === 'Completed' || selected.status === 'Cancelled'
                          ? 'Reopen'
                          : 'Mark Complete'}
                      </button>
                    </footer>
                  </>
                </aside>
              ) : null}
            </div>
          </>
        )}
        {moreFilters ? (
          <V4Drawer open title="Action filters" onClose={() => setMoreFilters(false)}>
            <V4FilterSelect
              label="Due date"
              value={dueFilter}
              options={[
                { value: '', label: 'Any due date' },
                { value: 'active', label: 'Active actions' },
                { value: 'overdue', label: 'Overdue' },
                { value: 'today', label: 'Due today' },
                { value: 'soon', label: 'Due within 7 days' },
                { value: 'none', label: 'No due date' },
              ]}
              onChange={setDueFilter}
            />
            <V4FilterSelect
              label="Area"
              value={areaFilter}
              onChange={setAreaFilter}
              options={[
                { value: '', label: 'Any area' },
                ...Array.from(
                  new Set(
                    actions
                      .map((item) => item.area)
                      .filter((value): value is string => Boolean(value)),
                  ),
                )
                  .sort()
                  .map((value) => ({ value, label: value })),
              ]}
            />
            <V4FilterSelect
              label="Linked luminaire"
              value={luminaireFilter}
              onChange={setLuminaireFilter}
              options={[
                { value: '', label: 'Any luminaire' },
                ...(workspaceQuery.data?.luminaires ?? []).map((item) => ({
                  value: item.id,
                  label: item.tag,
                })),
              ]}
            />
            <V4Button type="button" onClick={clearFilters}>
              Clear filters
            </V4Button>
          </V4Drawer>
        ) : null}
        {textEdit?.field === 'details' && (
          <ActionDetailsEditor
            action={textEdit.item}
            contacts={workspaceQuery.data?.contacts ?? []}
            categories={categories}
            luminaires={workspaceQuery.data?.luminaires ?? []}
            onClose={() => setTextEdit(null)}
            onSave={async (draft) => {
              await api.patchProjectAction(projectId!, textEdit.item.id, {
                ...draft,
                rowVersion: textEdit.item.rowVersion ?? 1,
              });
              await queryClient.invalidateQueries({
                queryKey: ['v4', 'actions', 'workspace', projectId],
              });
            }}
          />
        )}
        {textEdit?.field === 'notes' && (
          <V4TextEditor
            key={`${textEdit.item.id}:${textEdit.field}`}
            title="Action notes"
            value={textEdit.item[textEdit.field]}
            onClose={() => setTextEdit(null)}
            onSave={async (value) => {
              await api.patchProjectAction(projectId as string, textEdit.item.id, {
                rowVersion: textEdit.item.rowVersion ?? 1,
                [textEdit.field]: value,
              });
              await queryClient.invalidateQueries({
                queryKey: ['v4', 'actions', 'workspace', projectId],
              });
            }}
          />
        )}
        {editing ? (
          <ActionDrawer
            meetings={meetingsQuery.data ?? []}
            contacts={workspaceQuery.data?.contacts ?? []}
            onCreateContact={async (draft) => {
              const existing = workspaceQuery.data?.contacts.find(
                (contact) =>
                  contact.name.trim().toLowerCase() === draft.name.trim().toLowerCase() &&
                  contact.email.trim().toLowerCase() === draft.email.trim().toLowerCase(),
              );
              if (existing) return existing;
              const contact = await api.createContact(projectId!, draft);
              await queryClient.invalidateQueries({
                queryKey: ['v4', 'actions', 'workspace', projectId],
              });
              return contact;
            }}
            action={editing === 'new' ? null : editing}
            context={{
              luminaires: workspaceQuery.data?.luminaires ?? [],
              reviews: workspaceQuery.data?.reviewItems ?? [],
            }}
            categories={categories}
            categoriesAvailable={categoriesAvailable}
            saving={saveAction.isPending}
            error={saveAction.error instanceof Error ? saveAction.error.message : null}
            onCreateCategory={createCategory}
            onUpdateCategory={updateCategory}
            onDeleteCategory={deleteCategory}
            onRetryCategories={() => void categoryQuery.refetch()}
            onClose={() => setEditing(null)}
            onSave={(draft, meetingId) =>
              saveAction.mutate({ action: editing, draft, ...(meetingId ? { meetingId } : {}) })
            }
          />
        ) : null}
        {unlinkMeetingTarget && selected ? (
          <V4Drawer
            open
            title="Unlink meeting from this action?"
            description="This removes only the meeting link. The Action and Meeting remain unchanged."
            onClose={() => {
              if (!unlinkMeeting.isPending) setUnlinkMeetingTarget(null);
            }}
          >
            <div className="v4-actions__meeting-unlink-confirmation">
              <p>
                Unlink <strong>{unlinkMeetingTarget.meeting.title}</strong> from this Action?
              </p>
              {unlinkMeeting.isError ? (
                <p role="alert" className="v4-actions__meeting-error">
                  {unlinkMeeting.error instanceof Error
                    ? unlinkMeeting.error.message
                    : 'The Meeting could not be unlinked.'}
                </p>
              ) : null}
              <div className="v4-actions__meeting-picker-controls">
                <button
                  type="button"
                  disabled={unlinkMeeting.isPending}
                  onClick={() => setUnlinkMeetingTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="v4-actions__danger"
                  disabled={unlinkMeeting.isPending}
                  onClick={() =>
                    unlinkMeeting.mutate({
                      meetingId: unlinkMeetingTarget.meeting.id,
                      actionId: selected.id,
                    })
                  }
                >
                  {unlinkMeeting.isPending ? 'Unlinking…' : 'Unlink'}
                </button>
              </div>
            </div>
          </V4Drawer>
        ) : null}
      </div>
    </V4AppShell>
  );
}
