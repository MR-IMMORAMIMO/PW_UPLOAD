import { AddMeetingNote } from './AddMeetingNote';
import { FinalProjectHeader } from '../../components/final-ui/ProjectHeader';
import FinalMeetingsView from '../../components/final-ui/FinalMeetingsView';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generatePath, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  SctBack as ArrowLeft,
  SctFilter as Filter,
  SctQueue as List,
  SctMore as MoreVertical,
  SctRemove as Unlink,
} from '../../components/common/SctIcons';
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  ExternalLink,
  History,
  Link2,
  MapPin,
  Plus,
  Search,
  X,
} from '../../components/common/SctIcons';
import type {
  ActionCategory,
  ActionCategoryColorKey,
  ActionCategoryIconKey,
  MeetingActionRelationType,
  MeetingDetail,
  MeetingListItem,
  MeetingNote,
} from '@scli/domain';
import type { ProjectMeetingInput } from '@scli/contracts';
import { api } from '../../api/environment';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { V4AppShell } from '../../components/shell/V4AppShell';
import { V4PageHeader } from '../../components/common/V4PageHeader';
import { V4ProjectContextHeader } from '../../components/project/V4ProjectContextHeader';
import { V4ProjectEditAction } from '../../components/project/V4ProjectEditAction';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { V4Drawer } from '../../components/common/V4Drawer';
import { V4Pagination } from '../../components/common/V4Pagination';
import { V4RouteErrorState } from '../../components/common/V4RouteErrorState';
import { v4SemanticIcons } from '../../components/common/V4SemanticIcons';
import {
  readStoredSidebarMode,
  writeStoredSidebarMode,
  type SidebarMode,
} from '../../components/sidebar/sidebarMode';
import {
  ROUTE_PROJECT_ACTIONS,
  ROUTE_PROJECT_MEETINGS,
  ROUTE_PROJECT_COMMENTS,
  ROUTE_PROJECT_DATASHEETS_IMAGES,
  ROUTE_PROJECT_TECHNICAL_CHECK,
  ROUTE_PROJECT_LUMINAIRE_SCHEDULE,
  ROUTE_PROJECT_TECHNICAL_BOQ,
  ROUTE_PROJECT_SCOPE,
  ROUTE_PROJECT_SUMMARY,
  ROUTE_PROJECT_WORKFLOW_TIMELINE,
} from '../../router/routes';
import { MeetingDateBlock } from './MeetingDateBlock';
import { MeetingDrawer } from './MeetingDrawer';
import { ActionDrawer, type ActionDraft } from '../project-actions/ActionDrawer';
import {
  filterMeetings,
  meetingRelativeDay,
  meetingTime,
  meetingTimeRange,
  meetingsForTab,
  type MeetingFilters,
  type MeetingTab,
} from './meetingsViewModel';

const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
const formatNoteTime = (value: string) => formatBusinessDateTime(value);
const MEETINGS_PER_PAGE = 5;
const NoteIcon = v4SemanticIcons.note;
const ActionIcon = v4SemanticIcons.action;
const relationLabel = (relationType: MeetingActionRelationType, context: 'meeting' | 'action') =>
  relationType === 'CreatedFromMeeting'
    ? context === 'meeting'
      ? 'Created here'
      : 'Created in this meeting'
    : context === 'meeting'
      ? 'Linked'
      : 'Linked to this meeting';

function Tabs({ tab, onChange }: { tab: MeetingTab; onChange: (value: MeetingTab) => void }) {
  const values = [
    { value: 'upcoming' as const, label: 'Upcoming', Icon: CalendarDays },
    { value: 'past' as const, label: 'Past', Icon: History },
    { value: 'all' as const, label: 'All', Icon: List },
  ];
  return (
    <div className="v4-meetings__tabs" role="tablist" aria-label="Meeting views">
      {values.map((item, index) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={tab === item.value}
          tabIndex={tab === item.value ? 0 : -1}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? values.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : values.length - 1)) %
                      values.length;
              onChange(values[next]!.value);
            }
          }}
        >
          <item.Icon aria-hidden="true" />
          {item.label}
        </button>
      ))}
    </div>
  );
}
function Featured({
  item,
  onOpen,
  onEdit,
}: {
  item: MeetingListItem;
  onOpen: (element: HTMLElement) => void;
  onEdit: () => void;
}) {
  const preview = item.participantPreview.slice(0, 4);
  return (
    <div
      className="v4-meetings__featured"
      role="button"
      tabIndex={0}
      onClick={(event) => onOpen(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(event.currentTarget);
        }
      }}
    >
      <MeetingDateBlock value={item.startAt} />
      <div className="v4-meetings__featured-time">
        <strong>{meetingTime(item.startAt)}</strong>
        <small>
          ({Math.round((Date.parse(item.endAt) - Date.parse(item.startAt)) / 60000)} min)
        </small>
        <span className="v4-meetings__relative-day">{meetingRelativeDay(item.startAt)}</span>
      </div>
      <div className="v4-meetings__featured-body">
        <strong>{item.title}</strong>
        <div className="v4-meetings__featured-meta">
          <div>
            <small>Attendees</small>
            <span className="v4-meetings__avatars">
              {preview.map((participant) => (
                <b key={participant.id} title={participant.name}>
                  {initials(participant.name)}
                </b>
              ))}
              {item.participantsCount > preview.length ? (
                <em>+{item.participantsCount - preview.length}</em>
              ) : null}
            </span>
          </div>
          <div>
            <small>Purpose</small>
            <p>{item.purpose || 'No purpose recorded.'}</p>
          </div>
        </div>
      </div>
      <div className="v4-meetings__featured-actions">
        <button
          type="button"
          aria-label={`Edit ${item.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          <MoreVertical aria-hidden="true" />
        </button>
        <button
          className="v4-meetings__primary"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(event.currentTarget);
          }}
        >
          Open <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
function PastRow({
  item,
  selected,
  onOpen,
}: {
  item: MeetingListItem;
  selected: boolean;
  onOpen: (element: HTMLElement) => void;
}) {
  return (
    <button
      className={`v4-meetings__past-row${selected ? ' v4-meetings__past-row--selected' : ''}`}
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <MeetingDateBlock value={item.startAt} compact />
      <span className="v4-meetings__past-time">
        <strong>{meetingTime(item.startAt)}</strong>
        <small>
          ({Math.round((Date.parse(item.endAt) - Date.parse(item.startAt)) / 60000)} min)
        </small>
      </span>
      <span className="v4-meetings__past-main">
        <strong>{item.title}</strong>
        <small>
          <b>Outcome:</b> {item.decisions || 'No outcome recorded.'}
        </small>
      </span>
      <span className="v4-meetings__past-metric" data-metric="notes">
        <NoteIcon aria-hidden="true" />
        <span>
          <small>Notes</small>
          <b>{item.notesCount}</b>
        </span>
      </span>
      <span className="v4-meetings__past-metric" data-metric="actions-created">
        <ActionIcon aria-hidden="true" />
        <span>
          <small>Actions Created</small>
          <b>{item.actionsCreatedCount}</b>
        </span>
      </span>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

export function ProjectMeetingsWorkspace({ finalView = false }: { finalView?: boolean }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedMeetingId = searchParams.get('meetingId');
  const appliedMeetingLink = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<SidebarMode>(() => readStoredSidebarMode(window.localStorage));
  const [tab, setTab] = useState<MeetingTab>('upcoming');
  const [filters, setFilters] = useState<MeetingFilters>({ query: '', status: '', location: '' });
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editing, updateEditing] = useState<MeetingDetail | 'new' | null>(null);
  const [editorScope, setEditorScope] = useState<'full' | 'agenda' | 'outcome'>('full');
  const setEditing = (
    value: MeetingDetail | 'new' | null,
    scope: 'full' | 'agenda' | 'outcome' = 'full',
  ) => {
    setEditorScope(scope);
    updateEditing(value);
  };
  const contactsQuery = useQuery({
    queryKey: ['v4', 'meetings', 'contacts', projectId],
    queryFn: () => api.projectWorkspace(projectId as string),
    enabled: !!projectId && !!editing,
  });
  const [inspectorView, setInspectorView] = useState<InspectorView>('details');
  const [page, setPage] = useState(0);
  const selectionRef = useRef<HTMLElement | null>(null);
  const hasAutoSelectedInitialMeeting = useRef(false);
  const projectQuery = useQuery({
    queryKey: ['v4', 'meetings', 'project', projectId],
    queryFn: () => api.project(projectId as string),
    enabled: !!projectId,
  });
  const listQuery = useQuery({
    queryKey: ['v4', 'meetings', 'list', projectId],
    queryFn: () => api.listMeetings(projectId as string),
    enabled: !!projectId,
  });
  const detailQuery = useQuery({
    queryKey: ['v4', 'meetings', 'detail', projectId, selectedId],
    queryFn: () => api.getMeetingDetail(projectId as string, selectedId as string),
    enabled: !!projectId && !!selectedId,
  });
  const notesQuery = useQuery({
    queryKey: ['v4', 'meetings', 'notes', projectId, selectedId],
    queryFn: () => api.listMeetingNotes(projectId as string, selectedId as string),
    enabled: !!projectId && !!selectedId && inspectorView === 'notes',
  });
  const save = useMutation({
    mutationFn: ({
      target,
      input,
    }: {
      target: MeetingDetail | 'new';
      input: ProjectMeetingInput;
    }) =>
      target === 'new'
        ? api.createMeeting(projectId as string, input)
        : api.updateMeeting(projectId as string, target.id, input),
    onSuccess: async (_, values) => {
      await queryClient.invalidateQueries({ queryKey: ['v4', 'meetings', 'list', projectId] });
      if (values.target !== 'new')
        await queryClient.invalidateQueries({
          queryKey: ['v4', 'meetings', 'detail', projectId, values.target.id],
        });
      setEditing(null);
    },
  });
  const items = listQuery.data ?? [];
  const projected = useMemo(
    () => filterMeetings(meetingsForTab(items, tab), filters),
    [items, tab, filters],
  );
  const upcoming = useMemo(
    () => filterMeetings(meetingsForTab(items, 'upcoming'), filters),
    [items, filters],
  );
  const past = useMemo(
    () => filterMeetings(meetingsForTab(items, 'past'), filters),
    [items, filters],
  );
  const collection = tab === 'upcoming' ? upcoming : projected;
  const pageCount = Math.max(1, Math.ceil(collection.length / MEETINGS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = collection.slice(
    safePage * MEETINGS_PER_PAGE,
    safePage * MEETINGS_PER_PAGE + MEETINGS_PER_PAGE,
  );
  const featured = tab === 'upcoming' ? pageItems[0] : undefined;
  useEffect(() => setPage(0), [filters, tab]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  useEffect(() => {
    if (!requestedMeetingId && !hasAutoSelectedInitialMeeting.current && featured) {
      hasAutoSelectedInitialMeeting.current = true;
      setSelectedId(featured.id);
    }
  }, [featured, requestedMeetingId]);
  useEffect(() => {
    if (!requestedMeetingId || !listQuery.data) return;
    const key = `${projectId}:${requestedMeetingId}`;
    if (appliedMeetingLink.current === key) return;
    appliedMeetingLink.current = key;
    hasAutoSelectedInitialMeeting.current = true;
    const target = listQuery.data.find(
      (item) => item.id === requestedMeetingId && item.projectId === projectId,
    );
    if (!target) {
      setSelectedId(null);
      setEditError('The linked meeting is not available in this project.');
      return;
    }
    setTab('all');
    setFilters({ query: '', status: '', location: '' });
    setSelectedId(target.id);
    setInspectorView('details');
  }, [requestedMeetingId, projectId, listQuery.data]);
  useEffect(() => {
    if (selectedId && !projected.some((item) => item.id === selectedId) && tab !== 'upcoming')
      setSelectedId(null);
  }, [projected, selectedId, tab]);
  const select = (item: MeetingListItem, element: HTMLElement) => {
    selectionRef.current = element;
    setInspectorView('details');
    setSelectedId(item.id);
  };
  const locations = [...new Set(items.map((item) => item.location.trim()).filter(Boolean))].sort();
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
  const loading = projectQuery.isLoading || listQuery.isLoading;
  const readError = projectQuery.isError || listQuery.isError;
  const retrying = projectQuery.isFetching || listQuery.isFetching;
  return (
    <V4AppShell
      context="project"
      finalContacts={finalView}
      boundedPage
      sidebarMode={mode}
      onToggleSidebarMode={() =>
        setMode((current) => {
          const next = current === 'extended' ? 'minimal' : 'extended';
          writeStoredSidebarMode(window.localStorage, next);
          return next;
        })
      }
      activeSectionId="meetings"
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
              projectQueryKey={['v4', 'meetings', 'project', projectId]}
            />
          }
        />
      }
      pageHeader={
        finalView ? undefined : (
          <V4PageHeader
            icon={CalendarDays}
            title="Meetings"
            description="Manage upcoming meetings, review past sessions, and capture decisions."
            actions={
              <button
                className="v4-meetings__primary"
                type="button"
                onClick={() => setEditing('new')}
              >
                <Plus aria-hidden="true" /> Add Meeting
              </button>
            }
          />
        )
      }
    >
      {finalView ? (
        <div
          className="final-ui-reference"
          data-testid="v4-project-meetings"
          style={{ flexDirection: 'column', minHeight: 0 }}
        >
          <FinalProjectHeader />
          {loading ? (
            <p role="status">Loading meetings…</p>
          ) : readError ? (
            <V4RouteErrorState
              title="Unable to load meetings"
              message="Project meeting data could not be loaded."
              retrying={retrying}
              onRetry={() => {
                void Promise.all([projectQuery.refetch(), listQuery.refetch()]);
              }}
            />
          ) : (
            <FinalMeetingsView
              binding={{
                upcoming,
                past,
                all: filterMeetings(items, filters),
                detail: detailQuery.data?.id === selectedId ? detailQuery.data : null,
                tab,
                setTab,
                query: filters.query,
                setQuery: (query) => setFilters((current) => ({ ...current, query })),
                select,
                add: () => setEditing('new'),
                close: () => {
                  setSelectedId(null);
                  setInspectorView('details');
                  selectionRef.current?.focus();
                },
                edit: (item) => {
                  setEditError(null);
                  void api
                    .getMeetingDetail(projectId as string, item.id)
                    .then((detail) => setEditing(detail))
                    .catch((error) =>
                      setEditError(
                        error instanceof Error ? error.message : 'Meeting could not be loaded.',
                      ),
                    );
                },
                editDetail: () => {
                  if (detailQuery.data) setEditing(detailQuery.data);
                },
                editOutcome: (item) => {
                  setEditError(null);
                  void api
                    .getMeetingDetail(projectId as string, item.id)
                    .then((detail) => setEditing(detail, 'outcome'))
                    .catch((error) =>
                      setEditError(
                        error instanceof Error ? error.message : 'Meeting could not be loaded.',
                      ),
                    );
                },
                subview: (view) => {
                  if (view === 'agenda' && detailQuery.data) setEditing(detailQuery.data, 'agenda');
                  else setInspectorView(view);
                },
                filter: () => setFilterOpen((current) => !current),
                filterContent: filterOpen ? (
                  <div className="v4-meetings__filter-fields">
                    <div>
                      Status
                      <V4FilterSelect
                        label="Status"
                        value={filters.status}
                        onChange={(status) => setFilters({ ...filters, status })}
                        options={[
                          { value: '', label: 'All' },
                          ...['Planned', 'Held', 'Cancelled'].map((value) => ({
                            value,
                            label: value,
                          })),
                        ]}
                      />
                    </div>
                    <div>
                      Location / Platform
                      <V4FilterSelect
                        label="Location or platform"
                        value={filters.location}
                        onChange={(location) => setFilters({ ...filters, location })}
                        options={[
                          { value: '', label: 'All' },
                          ...locations.map((value) => ({ value, label: value })),
                        ]}
                      />
                    </div>
                  </div>
                ) : null,
                notice: (
                  <>
                    {editError ? <p role="alert">{editError}</p> : null}
                    {detailQuery.isError ? (
                      <p role="alert">
                        Meeting details could not be loaded.
                        <button onClick={() => void detailQuery.refetch()}>Retry</button>
                      </p>
                    ) : null}
                    {detailQuery.isLoading && selectedId ? (
                      <p role="status">Loading meeting details…</p>
                    ) : null}
                  </>
                ),
                detailContent: (
                  <V4Drawer
                    open={inspectorView !== 'details' && Boolean(selectedId)}
                    title={
                      inspectorView === 'notes'
                        ? 'Meeting Notes'
                        : inspectorView === 'actions'
                          ? 'Linked Actions'
                          : 'Participants'
                    }
                    onClose={() => setInspectorView('details')}
                  >
                    {detailQuery.data && inspectorView !== 'details' ? (
                      <InspectorSubview
                        view={inspectorView}
                        detail={detailQuery.data}
                        notesLoading={notesQuery.isLoading}
                        notesError={notesQuery.isError}
                        notes={notesQuery.data ?? []}
                        onBack={() => setInspectorView('details')}
                      />
                    ) : null}
                  </V4Drawer>
                ),
              }}
            />
          )}{' '}
        </div>
      ) : (
        <div className="v4-meetings v4-bounded-page" data-testid="v4-project-meetings">
          {loading ? (
            <div className="v4-meetings__state">Loading meetings…</div>
          ) : readError ? (
            <V4RouteErrorState
              title="Unable to load meetings"
              message="Project meeting data could not be loaded."
              retrying={retrying}
              onRetry={() => void Promise.all([projectQuery.refetch(), listQuery.refetch()])}
            />
          ) : (
            <div className="v4-meetings__workspace">
              <main className="v4-meetings__collection">
                <div className="v4-meetings__toolbar">
                  <Tabs tab={tab} onChange={setTab} />
                  <label className="v4-meetings__search">
                    <Search aria-hidden="true" />
                    <span className="v4-visually-hidden">Search meetings</span>
                    <input
                      placeholder="Search meetings..."
                      value={filters.query}
                      onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                    />
                  </label>
                  <div className="v4-meetings__filter-wrap">
                    <button
                      type="button"
                      aria-label="Filter meetings"
                      aria-expanded={filterOpen}
                      onClick={() => setFilterOpen(!filterOpen)}
                    >
                      <Filter aria-hidden="true" />
                    </button>
                    {filterOpen ? (
                      <div className="v4-meetings__filter-popover">
                        <div>
                          Status
                          <V4FilterSelect
                            label="Status"
                            value={filters.status}
                            onChange={(status) => setFilters({ ...filters, status })}
                            options={[
                              { value: '', label: 'All' },
                              ...['Planned', 'Held', 'Cancelled'].map((value) => ({
                                value,
                                label: value,
                              })),
                            ]}
                          />
                        </div>
                        <div>
                          Location / Platform
                          <V4FilterSelect
                            label="Location or platform"
                            value={filters.location}
                            onChange={(location) => setFilters({ ...filters, location })}
                            options={[
                              { value: '', label: 'All' },
                              ...locations.map((value) => ({ value, label: value })),
                            ]}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                {tab === 'upcoming' ? (
                  <>
                    <h2>Upcoming Meetings</h2>
                    {featured ? (
                      <Featured
                        item={featured}
                        onOpen={(element) => select(featured, element)}
                        onEdit={() => {
                          if (detailQuery.data) setEditing(detailQuery.data);
                          else setSelectedId(featured.id);
                        }}
                      />
                    ) : (
                      <p className="v4-meetings__empty">No upcoming meetings.</p>
                    )}
                    {pageItems.slice(1).map((item) => (
                      <PastRow
                        key={item.id}
                        item={item}
                        selected={item.id === selectedId}
                        onOpen={(element) => select(item, element)}
                      />
                    ))}
                    {safePage === 0 ? <h2>Past Meetings</h2> : null}
                    {safePage === 0 ? (
                      <section className="v4-meetings__past-list">
                        {past.length ? (
                          past
                            .slice(0, 2)
                            .map((item) => (
                              <PastRow
                                key={item.id}
                                item={item}
                                selected={item.id === selectedId}
                                onOpen={(element) => select(item, element)}
                              />
                            ))
                        ) : (
                          <p className="v4-meetings__empty">No past meetings.</p>
                        )}
                      </section>
                    ) : null}
                    {safePage === 0 && past.length > 2 ? (
                      <button
                        className="v4-meetings__view-all"
                        type="button"
                        onClick={() => setTab('past')}
                      >
                        View all past meetings <ChevronRight aria-hidden="true" />
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <h2>{tab === 'past' ? 'Past Meetings' : 'All Meetings'}</h2>
                    <section className="v4-meetings__past-list">
                      {projected.length ? (
                        pageItems.map((item) => (
                          <PastRow
                            key={item.id}
                            item={item}
                            selected={item.id === selectedId}
                            onOpen={(element) => select(item, element)}
                          />
                        ))
                      ) : (
                        <p className="v4-meetings__empty">No meetings match the current view.</p>
                      )}
                    </section>
                  </>
                )}
                {collection.length ? (
                  <footer className="v4-meetings__pagination">
                    <span>
                      Showing {safePage * MEETINGS_PER_PAGE + 1}–
                      {safePage * MEETINGS_PER_PAGE + pageItems.length} of {collection.length}{' '}
                      meetings
                    </span>
                    <V4Pagination
                      pageCount={pageCount}
                      currentPage={safePage}
                      onChange={setPage}
                      ariaLabel="Meeting pages"
                    />
                  </footer>
                ) : null}
              </main>
              {selectedId ? (
                <aside
                  className={`v4-meetings__inspector${
                    inspectorView === 'details' ? '' : ' v4-meetings__inspector--subview'
                  }`}
                  aria-label="Meeting details"
                >
                  {detailQuery.isLoading ? (
                    <p>Loading meeting details…</p>
                  ) : detailQuery.isError ? (
                    <p role="alert">Meeting details could not be loaded.</p>
                  ) : detailQuery.data ? (
                    inspectorView !== 'details' ? (
                      <InspectorSubview
                        view={inspectorView}
                        detail={detailQuery.data}
                        notesLoading={notesQuery.isLoading}
                        notesError={notesQuery.isError}
                        notes={notesQuery.data ?? []}
                        onBack={() => setInspectorView('details')}
                      />
                    ) : (
                      <Inspector
                        detail={detailQuery.data}
                        onSubview={setInspectorView}
                        onEdit={() => setEditing(detailQuery.data)}
                        onClose={() => {
                          setInspectorView('details');
                          setSelectedId(null);
                          selectionRef.current?.focus();
                        }}
                      />
                    )
                  ) : (
                    <p>No meeting details available.</p>
                  )}
                </aside>
              ) : null}
            </div>
          )}
        </div>
      )}
      {editing ? (
        <MeetingDrawer
          scope={editorScope}
          meeting={editing === 'new' ? null : editing}
          contacts={contactsQuery.data?.contacts ?? []}
          onCreateContact={async (input) => {
            const existing = contactsQuery.data?.contacts.find(
              (contact) =>
                !contact.archived &&
                contact.name.trim().toLowerCase() === input.name.trim().toLowerCase() &&
                contact.email.trim().toLowerCase() === input.email.trim().toLowerCase(),
            );
            if (existing) return existing;
            const contact = await api.createContact(projectId as string, input);
            await queryClient.invalidateQueries({
              queryKey: ['v4', 'meetings', 'contacts', projectId],
            });
            return contact;
          }}
          saving={save.isPending}
          error={save.error instanceof Error ? save.error.message : null}
          onClose={() => setEditing(null)}
          onSave={(input) => save.mutate({ target: editing === 'new' ? 'new' : editing, input })}
        />
      ) : null}
    </V4AppShell>
  );
}
function Inspector({
  detail,
  onSubview,
  onEdit,
  onClose,
}: {
  detail: MeetingDetail;
  onSubview: (view: InspectorView) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const participants = detail.participants.slice(0, 6);
  const agenda = detail.agendaItems.slice(0, 4);
  const actions = detail.linkedActions.slice(0, 3);
  return (
    <>
      <header>
        <strong>Meeting Details</strong>
        <button type="button" aria-label="Close meeting details" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <section className="v4-meetings__identity">
        <MeetingDateBlock value={detail.startAt} />
        <div>
          <h2>{detail.title}</h2>
          <span>
            <Clock3 aria-hidden="true" />
            {meetingTimeRange(detail)}
          </span>
          {detail.location ? (
            <span>
              <MapPin aria-hidden="true" />
              {detail.location}
              {detail.onlineMeetingUrl ? (
                <a
                  href={detail.onlineMeetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open online meeting"
                >
                  <ExternalLink aria-hidden="true" />
                </a>
              ) : null}
            </span>
          ) : null}
        </div>
      </section>
      <InspectorSection
        title={`Participants (${detail.participants.length})`}
        action={
          detail.participants.length > 6 ? (
            <button
              type="button"
              aria-label="View all participants"
              onClick={() => onSubview('participants')}
            >
              View all
            </button>
          ) : null
        }
      >
        <div className="v4-meetings__participants">
          {participants.length ? (
            participants.map((item) => (
              <div key={item.id}>
                <b>{initials(item.name)}</b>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.role || '—'}</small>
                </span>
              </div>
            ))
          ) : (
            <p>No participants recorded.</p>
          )}
        </div>
      </InspectorSection>
      <InspectorSection
        title="Agenda"
        action={
          <span className="v4-meetings__section-actions">
            {detail.agendaItems.length > 4 ? (
              <button
                type="button"
                aria-label="View all agenda items"
                onClick={() => onSubview('agenda')}
              >
                View all
              </button>
            ) : null}
            <button type="button" onClick={onEdit}>
              Edit
            </button>
          </span>
        }
      >
        {agenda.length ? (
          <ol>
            {agenda.map((item) => (
              <li key={item.id}>{item.content}</li>
            ))}
          </ol>
        ) : (
          <p>No agenda items recorded.</p>
        )}
      </InspectorSection>
      <InspectorSection
        title="Linked Actions"
        action={
          <button
            type="button"
            aria-label="Manage linked actions"
            onClick={() => onSubview('actions')}
          >
            Manage
          </button>
        }
      >
        {actions.length ? (
          <div className="v4-meetings__linked-actions">
            {actions.map((item) => (
              <div className="v4-meetings__linked-action-row" key={item.id}>
                <em data-priority={item.priority}>{item.priority}</em>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.owner || 'Unassigned'} · {item.dueDate ?? 'No due date'} ·{' '}
                    {relationLabel(item.relationType, 'meeting')}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p>No linked actions.</p>
        )}
      </InspectorSection>
      <InspectorSection
        title={
          <span className="v4-meetings__notes-heading">
            <span aria-hidden="true">
              <NoteIcon />
            </span>
            Notes Summary
          </span>
        }
        action={
          detail.notesCount ? (
            <button
              type="button"
              aria-label="View all meeting notes"
              onClick={() => onSubview('notes')}
            >
              View all ({detail.notesCount})
            </button>
          ) : null
        }
      >
        {detail.latestNote ? (
          <article className="v4-meetings__note-summary">
            <p>{detail.latestNote.content}</p>
            <small>
              Last updated {formatNoteTime(detail.latestNote.updatedAt)} by{' '}
              {detail.latestNote.authorName}
            </small>
          </article>
        ) : (
          <p>No meeting notes.</p>
        )}
      </InspectorSection>
    </>
  );
}

type InspectorView = 'details' | 'participants' | 'agenda' | 'actions' | 'notes';

function InspectorSubview({
  view,
  detail,
  notesLoading,
  notesError,
  notes,
  onBack,
}: {
  view: Exclude<InspectorView, 'details'>;
  detail: MeetingDetail;
  notesLoading: boolean;
  notesError: boolean;
  notes: MeetingNote[];
  onBack: () => void;
}) {
  const title =
    view === 'participants'
      ? 'Participants'
      : view === 'agenda'
        ? 'Agenda'
        : view === 'actions'
          ? `Linked Actions (${detail.linkedActions.length})`
          : 'Meeting Notes';
  return (
    <>
      <header className="v4-meetings__subview-header">
        <button type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> Back to Meeting Details
        </button>
        <span className="v4-visually-hidden">{title}</span>
      </header>
      <div className="v4-meetings__subview-body">
        {view === 'notes' && <AddMeetingNote projectId={detail.projectId} meetingId={detail.id} />}
        {view === 'participants' ? (
          <div className="v4-meetings__participants v4-meetings__participants--all">
            {detail.participants.map((item) => (
              <div key={item.id}>
                <b>{initials(item.name)}</b>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.role || '—'}</small>
                </span>
              </div>
            ))}
          </div>
        ) : view === 'agenda' ? (
          <ol>
            {detail.agendaItems.map((item) => (
              <li key={item.id}>{item.content}</li>
            ))}
          </ol>
        ) : view === 'actions' ? (
          <LinkedActionsSubview detail={detail} />
        ) : notesLoading ? (
          <p>Loading notes…</p>
        ) : notesError ? (
          <p role="alert">Meeting notes could not be loaded.</p>
        ) : notes.length ? (
          <div className="v4-meetings__notes-list">
            {[...notes]
              .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
              .map((note) => (
                <article key={note.id}>
                  <p>{note.content}</p>
                  <small>
                    {formatNoteTime(note.updatedAt)} by {note.authorName}
                  </small>
                </article>
              ))}
          </div>
        ) : (
          <p>No meeting notes.</p>
        )}
      </div>
    </>
  );
}

type LinkedAction = MeetingDetail['linkedActions'][number];

function LinkedActionsSubview({ detail }: { detail: MeetingDetail }) {
  const navigate = useNavigate();

  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'LIST' | 'LINK_PICKER'>('LIST');
  const [search, setSearch] = useState('');
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<LinkedAction | null>(null);
  const projectId = detail.projectId;
  const actionsQuery = useQuery({
    queryKey: ['v4', 'actions', 'workspace', projectId],
    queryFn: () => api.projectWorkspace(projectId),
    enabled: mode === 'LINK_PICKER' || creating,
  });
  const categoryQuery = useQuery({
    queryKey: ['v4', 'action-categories'],
    queryFn: () => api.listActionCategories(),
    enabled: mode === 'LINK_PICKER' || creating,
  });
  const refreshRelations = (actionId: string) =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['v4', 'meetings', 'detail', projectId, detail.id],
      }),
      queryClient.invalidateQueries({ queryKey: ['v4', 'meetings', 'list', projectId] }),
      queryClient.invalidateQueries({
        queryKey: ['v4', 'actions', 'meeting-links', projectId, actionId],
      }),
    ]);
  const linkAction = useMutation({
    mutationFn: (actionId: string) => api.linkMeetingAction(projectId, detail.id, { actionId }),
    onSuccess: async (_, actionId) => {
      await refreshRelations(actionId);
      setMode('LIST');
      setSearch('');
      setSelectedActionId(null);
    },
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['v4', 'meetings', 'detail', projectId, detail.id],
        }),
        queryClient.invalidateQueries({ queryKey: ['v4', 'meetings', 'list', projectId] }),
      ]);
    },
  });
  const createAction = useMutation({
    mutationFn: (draft: ActionDraft) => api.createActionFromMeeting(projectId, detail.id, draft),
    onSuccess: async (created) => {
      await Promise.all([
        refreshRelations(created.id),
        queryClient.invalidateQueries({ queryKey: ['v4', 'actions', 'workspace', projectId] }),
      ]);
      setCreating(false);
    },
  });
  const unlinkAction = useMutation({
    mutationFn: (actionId: string) => api.unlinkMeetingAction(projectId, detail.id, actionId),
    onSuccess: async (_, actionId) => {
      await refreshRelations(actionId);
      setUnlinkTarget(null);
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
  const deleteCategory = async (category: ActionCategory, replacementId?: string | null) => {
    await api.replaceAndDeleteActionCategory(category.id, replacementId ?? null);
    await Promise.all([
      refreshCategories(),
      queryClient.invalidateQueries({ queryKey: ['v4', 'actions', 'workspace', projectId] }),
    ]);
  };
  const linkedIds = useMemo(
    () => new Set(detail.linkedActions.map((action) => action.id)),
    [detail.linkedActions],
  );
  const categories = categoryQuery.data ?? [];
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const availableActions = (actionsQuery.data?.actions ?? []).filter(
    (action) => !linkedIds.has(action.id),
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const candidates = availableActions.filter((action) => {
    if (!normalizedSearch) return true;
    const category = action.categoryId ? categoryById.get(action.categoryId)?.label : '';
    return [action.title, action.owner, category]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  });
  const openPicker = () => {
    linkAction.reset();
    setSearch('');
    setSelectedActionId(null);
    setMode('LINK_PICKER');
  };
  return (
    <div className="v4-meetings__actions-manager">
      {mode === 'LINK_PICKER' ? (
        <>
          <div className="v4-meetings__actions-manager-heading">
            <div>
              <strong>Link Existing Action</strong>
              <small>Choose an Action from this project.</small>
            </div>
            <button type="button" disabled={linkAction.isPending} onClick={() => setMode('LIST')}>
              <ArrowLeft aria-hidden="true" /> Back
            </button>
          </div>
          <label className="v4-meetings__action-search">
            <Search aria-hidden="true" />
            <span className="v4-visually-hidden">Search actions</span>
            <input
              placeholder="Search actions..."
              value={search}
              disabled={linkAction.isPending}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {actionsQuery.isLoading || categoryQuery.isLoading ? (
            <p>Loading project actions…</p>
          ) : actionsQuery.isError || categoryQuery.isError ? (
            <p role="alert">Project actions could not be loaded.</p>
          ) : (actionsQuery.data?.actions.length ?? 0) === 0 ? (
            <p>No project actions are available to link.</p>
          ) : availableActions.length === 0 ? (
            <p>All project actions are already linked to this meeting.</p>
          ) : candidates.length === 0 ? (
            <p>No actions match “{search.trim()}”.</p>
          ) : (
            <div className="v4-meetings__action-candidates" role="radiogroup" aria-label="Actions">
              {candidates.map((action) => {
                const category = action.categoryId ? categoryById.get(action.categoryId) : null;
                return (
                  <label key={action.id}>
                    <input
                      type="radio"
                      name="meeting-action-candidate"
                      value={action.id}
                      checked={selectedActionId === action.id}
                      disabled={linkAction.isPending}
                      onChange={() => setSelectedActionId(action.id)}
                    />
                    <em data-priority={action.priority}>{action.priority}</em>
                    <span>
                      <strong>{action.title}</strong>
                      <small>
                        {action.owner || 'Unassigned'} · {action.dueDate ?? 'No due date'} ·{' '}
                        {action.status}
                      </small>
                      <small>{category?.label ?? 'Uncategorized'}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {linkAction.isError ? (
            <p role="alert" className="v4-meetings__error">
              {linkAction.error instanceof Error
                ? linkAction.error.message
                : 'The Action could not be linked.'}
            </p>
          ) : null}
          <div className="v4-meetings__action-controls">
            <button type="button" disabled={linkAction.isPending} onClick={() => setMode('LIST')}>
              Cancel
            </button>
            <button
              type="button"
              className="v4-meetings__primary"
              disabled={!selectedActionId || linkAction.isPending}
              onClick={() => selectedActionId && linkAction.mutate(selectedActionId)}
            >
              {linkAction.isPending ? 'Linking…' : 'Link Action'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="v4-meetings__action-controls v4-meetings__action-controls--top">
            <button
              type="button"
              className="v4-meetings__primary"
              onClick={() => {
                createAction.reset();
                setCreating(true);
              }}
            >
              <Plus aria-hidden="true" /> Create Action
            </button>
            <button type="button" onClick={openPicker}>
              <Link2 aria-hidden="true" /> Link Existing
            </button>
          </div>
          {detail.linkedActions.length ? (
            <div className="v4-meetings__linked-actions v4-meetings__linked-actions--managed">
              {detail.linkedActions.map((action) => (
                <div className="v4-meetings__linked-action-row" key={action.id}>
                  <em data-priority={action.priority}>{action.priority}</em>
                  <span>
                    <button
                      type="button"
                      className="v4-meetings__action-navigation"
                      onClick={() =>
                        navigate(
                          generatePath(ROUTE_PROJECT_ACTIONS, { projectId: detail.projectId }),
                        )
                      }
                    >
                      {action.title}
                    </button>
                    <small>
                      {action.owner || 'Unassigned'} · {action.dueDate ?? 'No due date'} ·{' '}
                      {action.status}
                    </small>
                    <small className="v4-meetings__relation-label">
                      {relationLabel(action.relationType, 'meeting')}
                    </small>
                  </span>
                  {action.relationType === 'Linked' ? (
                    <button
                      type="button"
                      className="v4-meetings__unlink"
                      aria-label={`Unlink ${action.title} from this meeting`}
                      onClick={() => {
                        unlinkAction.reset();
                        setUnlinkTarget(action);
                      }}
                    >
                      <Unlink aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p>No linked actions.</p>
          )}
        </>
      )}
      {creating ? (
        <ActionDrawer
          action={null}
          categories={categories}
          categoriesAvailable={!categoryQuery.isError && !categoryQuery.isLoading}
          saving={createAction.isPending}
          error={createAction.error instanceof Error ? createAction.error.message : null}
          contacts={actionsQuery.data?.contacts ?? []}
          onCreateContact={async (draft) => {
            const contact = await api.createContact(projectId, draft);
            await queryClient.invalidateQueries({
              queryKey: ['v4', 'actions', 'workspace', projectId],
            });
            return contact;
          }}
          formTitle="Create Action from Meeting"
          formDescription={`Create an Action linked to ${detail.title}.`}
          submitLabel="Create action"
          onCreateCategory={createCategory}
          onUpdateCategory={updateCategory}
          onDeleteCategory={deleteCategory}
          onRetryCategories={() => void categoryQuery.refetch()}
          onClose={() => setCreating(false)}
          onSave={(draft) => createAction.mutate(draft)}
        />
      ) : null}
      {unlinkTarget ? (
        <V4Drawer
          open
          presentation="float"
          className="v4-meetings__unlink-small"
          title="Unlink action from this meeting?"
          description="This removes only the meeting link. The Action remains unchanged."
          onClose={() => {
            if (!unlinkAction.isPending) setUnlinkTarget(null);
          }}
        >
          <div className="v4-meetings__unlink-confirmation">
            <p>
              Unlink <strong>{unlinkTarget.title}</strong> from this meeting?
            </p>
            {unlinkAction.isError ? (
              <p role="alert" className="v4-meetings__error">
                {unlinkAction.error instanceof Error
                  ? unlinkAction.error.message
                  : 'The Action could not be unlinked.'}
              </p>
            ) : null}
            <div className="v4-meetings__action-controls">
              <button
                type="button"
                disabled={unlinkAction.isPending}
                onClick={() => setUnlinkTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="v4-meetings__danger"
                disabled={unlinkAction.isPending}
                onClick={() => unlinkAction.mutate(unlinkTarget.id)}
              >
                {unlinkAction.isPending ? 'Unlinking…' : 'Unlink'}
              </button>
            </div>
          </div>
        </V4Drawer>
      ) : null}
    </div>
  );
}

function InspectorSection({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="v4-meetings__inspector-section">
      <div>
        <strong>{title}</strong>
        {action}
      </div>
      {children}
    </section>
  );
}
