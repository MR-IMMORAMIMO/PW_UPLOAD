import * as InlineGlyphs from '../common/SctIcons';
import * as CustomGlyphs from '../common/SctIcons';
import { sctIcons as ApprovedIcons } from '../common/SctIcons';
import { useRef, type ReactNode } from 'react';
import { V4AnchoredSurface } from '../interaction/V4AnchoredSurface';
import type { MeetingListItem, MeetingDetail } from '@scli/domain';
import {
  meetingDateParts,
  meetingTime,
  meetingTimeRange,
  meetingDuration,
  meetingRelativeDay,
  type MeetingTab,
} from '../../pages/project-meetings/meetingsViewModel';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
export interface FinalMeetingsBinding {
  upcoming: MeetingListItem[];
  past: MeetingListItem[];
  all: MeetingListItem[];
  detail: MeetingDetail | null;
  tab: MeetingTab;
  setTab: (tab: MeetingTab) => void;
  query: string;
  setQuery: (query: string) => void;
  select: (item: MeetingListItem, element: HTMLElement) => void;
  edit: (item: MeetingListItem) => void;
  editOutcome?: (item: Pick<MeetingListItem, 'id'>) => void;
  add: () => void;
  close: () => void;
  editDetail: () => void;
  subview: (view: 'participants' | 'agenda' | 'actions' | 'notes') => void;
  filter: () => void;
  filterContent: ReactNode;
  notice: ReactNode;
  detailContent: ReactNode;
}
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
import { C, SHADOW, RADIUS, LAYOUT } from './tokens';

// ── Icons ────────────────────────────────────────────────────────────────────

function IconSearch() {
  return <ApprovedIcons.search size={16} />;
}

function IconFilter() {
  return <ApprovedIcons.filter size={16} />;
}

function IconChevronRight() {
  return <CustomGlyphs.SctNext size="14" style={{ color: '#9ca3af' }} />;
}

function IconClock() {
  return <CustomGlyphs.SctDuration size="13" style={{ color: '#6b7280' }} />;
}

function IconTeams() {
  return <CustomGlyphs.SctCoordination size="16" style={{ color: 'currentColor' }} />;
}

function IconNote() {
  return <CustomGlyphs.SctNotes size="14" style={{ color: '#6b7280' }} />;
}

function IconCheck() {
  return <ApprovedIcons.check size={16} />;
}

function IconClose() {
  return <ApprovedIcons.close size={16} />;
}

function IconNoteDetail() {
  return <CustomGlyphs.SctNotes size="20" style={{ color: '#6A42AB' }} />;
}

// ── Avatar ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS: Record<string, string> = {
  MA: '#2563eb',
  SA: '#16a34a',
  AK: '#7c3aed',
  JS: '#dc2626',
  RA: '#d97706',
  MF: '#0891b2',
};

function Avatar({ initials, size = 28 }: { initials: string; size?: number }) {
  const bg = AVATAR_COLORS[initials] ?? 'var(--v4-text-muted)';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size < 26 ? 9 : 11,
        fontWeight: 700,
        color: 'var(--v4-action-primary-foreground)',
        fontFamily: "'Inter', sans-serif",
        border: '2px solid #fff',
      }}
    >
      {initials}
    </div>
  );
}

// ── Data ─────────────────────────────────────────────────────────────────────

export default function FinalMeetingsView({ binding: b }: { binding: FinalMeetingsBinding }) {
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const activeTab = b.tab;
  const UPCOMING = (b.tab === 'past' ? [] : b.upcoming).map((item) => ({
    record: item,
    id: item.id,
    ...meetingDateParts(item.startAt),
    dayName: meetingDateParts(item.startAt).weekday,
    time: meetingTime(item.startAt),
    duration: meetingDuration(item) + ' min',
    countdown: meetingRelativeDay(item.startAt),
    title: item.title,
    attendees: item.participantPreview.map((person) => ({
      id: person.id,
      initials: initials(person.name),
    })),
    extraAttendees: Math.max(0, item.participantsCount - item.participantPreview.length),
    purpose: item.purpose,
    platform: item.location,
  }));
  const remaining =
    b.tab === 'all'
      ? b.all.filter((item) => !b.upcoming.some((upcoming) => upcoming.id === item.id))
      : b.past;
  const PAST = remaining.map((item) => ({
    record: item,
    id: item.id,
    ...meetingDateParts(item.startAt),
    time: meetingTime(item.startAt),
    duration: meetingDuration(item) + ' min',
    title: item.title,
    outcome: item.decisions,
    notes: item.notesCount,
    actions: item.actionsCreatedCount,
  }));
  const d = b.detail;
  const DETAIL_MEETING = d
    ? {
        title: d.title,
        dateLabel: meetingDateParts(d.startAt).month,
        dateDay: meetingDateParts(d.startAt).day,
        dateDayName: meetingDateParts(d.startAt).weekday,
        time: meetingTimeRange(d),
        platform: d.location || '—',
        participants: d.participants.map((person) => ({
          id: person.id,
          initials: initials(person.name),
          name: person.name,
          role: person.role,
        })),
        agenda: d.agendaItems.map((item) => item.content),
        linkedActions: d.linkedActions.map((action) => ({
          id: action.id,
          priority: action.priority,
          text: action.title,
          assignee: action.owner,
          date: action.dueDate
            ? formatBusinessDateTime(action.dueDate, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : '—',
          priorityColor:
            action.priority === 'High'
              ? '#ef4444'
              : action.priority === 'Low'
                ? '#3b82f6'
                : '#f59e0b',
          priorityBg:
            action.priority === 'High'
              ? '#fef2f2'
              : action.priority === 'Low'
                ? 'var(--v4-accent-selected)'
                : '#fffbeb',
        })),
        noteSummary: {
          text: d.latestNote?.content || d.notes || 'No meeting notes yet.',
          updatedDate: d.latestNote ? formatBusinessDateTime(d.latestNote.updatedAt) : '—',
          updatedBy: d.latestNote?.authorName || '—',
        },
      }
    : null;
  const tabs: { id: 'upcoming' | 'past' | 'all'; label: string }[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
    { id: 'all', label: 'All' },
  ];

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: `12px ${LAYOUT.sectionGap}px ${LAYOUT.sectionGap}px`,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Content row */}
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Main area */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
            background: C.white,
            borderRadius: RADIUS.section,
            border: `1px solid ${C.border}`,
            boxShadow: SHADOW.card,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 20px 0',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div>
              <h1
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 20,
                  fontWeight: 700,
                  color: 'var(--v4-text-primary)',
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                Meetings
              </h1>
              <p
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  color: 'var(--v4-text-muted)',
                  margin: '3px 0 0',
                }}
              >
                Manage upcoming meetings, review past sessions, and capture decisions.
              </p>
            </div>
            <button
              onClick={b.add}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                background: 'var(--v4-action-primary)',
                color: 'var(--v4-action-primary-foreground)',
                border: 'none',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1, marginTop: -1 }}>
                +
              </span>
              Add Meeting
            </button>
          </div>

          {/* Tabs + Search */}
          <div
            style={{
              padding: '10px 20px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  aria-pressed={activeTab === t.id}
                  onClick={() => b.setTab(t.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 12px',
                    borderRadius: 7,
                    border:
                      activeTab === t.id
                        ? '1.5px solid var(--v4-action-primary)'
                        : '1.5px solid #e5e7eb',
                    background:
                      activeTab === t.id ? 'var(--v4-action-primary)' : 'var(--v4-surface-raised)',
                    color: activeTab === t.id ? '#fff' : 'var(--v4-text-muted)',
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "'Inter', sans-serif",
                    cursor: 'pointer',
                  }}
                >
                  <InlineGlyphs.SctMeetings
                    width="12"
                    height="12"
                    color={activeTab === t.id ? '#fff' : 'var(--v4-text-disabled)'}
                  />
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 10px',
                background: 'var(--v4-surface-subtle)',
                border: '1.5px solid #e5e7eb',
                borderRadius: 7,
                width: 180,
              }}
            >
              <IconSearch />
              <input
                aria-label="Search meetings"
                value={b.query}
                onChange={(event) => b.setQuery(event.target.value)}
                placeholder="Search meetings..."
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  color: 'var(--v4-text-secondary)',
                  minWidth: 0,
                  width: '100%',
                  border: 0,
                  background: 'transparent',
                }}
              />
            </div>
            <button
              ref={filterTrigger}
              aria-expanded={Boolean(b.filterContent)}
              aria-label="Filter meetings"
              onClick={b.filter}
              style={{
                width: 30,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1.5px solid #e5e7eb',
                borderRadius: 7,
                background: 'var(--v4-surface-raised)',
                cursor: 'pointer',
              }}
            >
              <IconFilter />
            </button>
          </div>

          <V4AnchoredSurface
            anchorToTrigger
            open={Boolean(b.filterContent)}
            ownerRef={filterTrigger}
            triggerRef={filterTrigger}
            onRequestClose={b.filter}
            className="v4-meetings__filter-popover"
            role="group"
            ariaLabel="Meeting filters"
          >
            {b.filterContent}
          </V4AnchoredSurface>
          {b.notice}
          {/* Fluid collection */}
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '12px 20px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
            }}
          >
            {/* Upcoming */}
            <div style={{ marginBottom: 12, flexShrink: 0 }}>
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--v4-text-secondary)',
                  marginBottom: 8,
                }}
              >
                Upcoming Meetings
              </div>
              {UPCOMING.length === 0 ? <p>No upcoming meetings.</p> : null}
              {UPCOMING.map((m) => (
                <div
                  key={m.id}
                  role="region"
                  aria-label={m.title}
                  style={{
                    border: '1.5px solid #2563eb30',
                    borderRadius: 9,
                    background: 'var(--v4-accent-selected)',
                    padding: '11px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      flexShrink: 0,
                      minWidth: 44,
                      background: 'var(--v4-surface-raised)',
                      borderRadius: 5,
                      padding: '4px 6px',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 10,
                        fontWeight: 600,
                        color: '#2563eb',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {m.month}
                    </div>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 22,
                        fontWeight: 800,
                        color: 'var(--v4-text-primary)',
                        lineHeight: 1.1,
                      }}
                    >
                      {m.day}
                    </div>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 9,
                        color: 'var(--v4-text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {m.dayName}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, minWidth: 80 }}>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--v4-text-primary)',
                      }}
                    >
                      {m.time}
                    </div>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 11,
                        color: 'var(--v4-text-muted)',
                      }}
                    >
                      ({m.duration})
                    </div>
                    <div
                      style={{
                        display: 'inline-block',
                        marginTop: 4,
                        padding: '2px 7px',
                        background: '#dbeafe',
                        borderRadius: 20,
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 10,
                        fontWeight: 500,
                        color: '#1d4ed8',
                      }}
                    >
                      {m.countdown}
                    </div>
                  </div>
                  <div
                    style={{
                      width: 1,
                      alignSelf: 'stretch',
                      background: 'var(--v4-border-control)',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--v4-text-primary)',
                        marginBottom: 8,
                      }}
                    >
                      {m.title}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
                      <div>
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 10,
                            fontWeight: 600,
                            color: 'var(--v4-text-muted)',
                            marginBottom: 5,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                          }}
                        >
                          Attendees
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          {m.attendees.map((a, i) => (
                            <div
                              key={a.id}
                              style={{
                                marginLeft: i === 0 ? 0 : -6,
                                zIndex: m.attendees.length - i,
                              }}
                            >
                              <Avatar initials={a.initials} size={24} />
                            </div>
                          ))}
                          <div
                            style={{
                              visibility: m.extraAttendees ? 'visible' : 'hidden',
                              width: 24,
                              height: 24,
                              borderRadius: '50%',
                              background: 'var(--v4-border-subtle)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 9,
                              fontWeight: 600,
                              color: 'var(--v4-text-muted)',
                              fontFamily: "'Inter', sans-serif",
                              border: '2px solid #fff',
                              marginLeft: -6,
                            }}
                          >
                            +{m.extraAttendees}
                          </div>
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 10,
                            fontWeight: 600,
                            color: 'var(--v4-text-muted)',
                            marginBottom: 5,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                          }}
                        >
                          Purpose
                        </div>
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 11,
                            color: 'var(--v4-text-secondary)',
                            lineHeight: 1.45,
                          }}
                        >
                          {m.purpose}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      flexShrink: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 6,
                    }}
                  >
                    <button
                      aria-label={`Edit ${m.title}`}
                      onClick={() => b.edit(m.record)}
                      style={{
                        padding: '3px',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <InlineGlyphs.SctEdit width="16" height="16" />
                    </button>
                    <button
                      onClick={(event) => b.select(m.record, event.currentTarget)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '7px 14px',
                        background: 'var(--v4-action-primary)',
                        color: 'var(--v4-action-primary-foreground)',
                        border: 'none',
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: "'Inter', sans-serif",
                        cursor: 'pointer',
                      }}
                    >
                      Open
                      <InlineGlyphs.SctNext width="11" height="11" color="#fff" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Past */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--v4-text-secondary)',
                  marginBottom: 8,
                  flexShrink: 0,
                }}
              >
                {b.tab === 'all' ? 'Other Meetings' : 'Past Meetings'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 15, flexShrink: 0 }}>
                {PAST.map((m) => (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    aria-label={m.title}
                    onClick={(event) => b.select(m.record, event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        b.select(m.record, event.currentTarget);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      background: 'var(--v4-surface-raised)',
                      border: '1px solid #e5e7eb',
                      borderRadius: 10,
                      cursor: 'pointer',
                      transition: 'background 120ms',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--v4-surface-subtle)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--v4-surface-raised)';
                    }}
                  >
                    <div style={{ flexShrink: 0, minWidth: 38, textAlign: 'center' }}>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#2563eb',
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}
                      >
                        {m.month}
                      </div>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 18,
                          fontWeight: 800,
                          color: 'var(--v4-text-primary)',
                          lineHeight: 1.1,
                        }}
                      >
                        {m.day}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, minWidth: 76 }}>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--v4-text-secondary)',
                        }}
                      >
                        {m.time}
                      </div>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 10,
                          color: 'var(--v4-text-disabled)',
                        }}
                      >
                        ({m.duration})
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--v4-text-primary)',
                          marginBottom: 2,
                        }}
                      >
                        {m.title}
                      </div>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          color: 'var(--v4-text-muted)',
                          lineHeight: 1.35,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>Outcome: </span>
                        {m.outcome}
                        {b.editOutcome && (
                          <button
                            type="button"
                            aria-label={`Edit outcome for ${m.title}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              b.editOutcome?.(m.record);
                            }}
                          >
                            <InlineGlyphs.SctEdit width="12" height="12" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 60 }}>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 10,
                          color: 'var(--v4-text-muted)',
                          marginBottom: 3,
                        }}
                      >
                        Notes
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          justifyContent: 'center',
                        }}
                      >
                        <IconNote />
                        <span
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 12,
                            fontWeight: 600,
                            color: 'var(--v4-text-secondary)',
                          }}
                        >
                          {m.notes}
                        </span>
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 80 }}>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 10,
                          color: 'var(--v4-text-muted)',
                          marginBottom: 3,
                        }}
                      >
                        Actions Created
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          justifyContent: 'center',
                        }}
                      >
                        <IconCheck />
                        <span
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 12,
                            fontWeight: 600,
                            color: 'var(--v4-text-secondary)',
                          }}
                        >
                          {m.actions}
                        </span>
                      </div>
                    </div>
                    <IconChevronRight />
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: 'auto', paddingTop: 0, flexShrink: 0 }}>
                <button
                  onClick={() => b.setTab('past')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'var(--v4-accent-ink)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '20px 0',
                  }}
                >
                  View all past meetings
                  <InlineGlyphs.SctNext width="11" height="11" color="#2563eb" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Meeting Details Panel */}
        {DETAIL_MEETING && (
          <div
            role="region"
            aria-label="Meeting details"
            style={{
              width: '33.333%',
              minWidth: 0,
              overflowWrap: 'anywhere',
              flexShrink: 0,
              background: C.white,
              borderRadius: RADIUS.section,
              border: `1px solid ${C.border}`,
              boxShadow: SHADOW.card,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Panel header */}
            <div
              style={{
                padding: '12px 16px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #f3f4f6',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'var(--v4-text-primary)',
                }}
              >
                Meeting Details
              </span>
              <button
                aria-label="Close meeting details"
                onClick={b.close}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                }}
              >
                <IconClose />
              </button>
            </div>

            {/* Panel content — no scroll, tightened spacing */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
              }}
            >
              {/* Date + Title */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 10, padding: '20px 0' }}>
                <div
                  style={{
                    flexShrink: 0,
                    width: 55,
                    height: 80,
                    background: '#2563eb',
                    borderRadius: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'rgba(255,255,255,0.8)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {DETAIL_MEETING.dateLabel}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 22,
                      fontWeight: 800,
                      color: 'var(--v4-action-primary-foreground)',
                      lineHeight: 1.1,
                    }}
                  >
                    {DETAIL_MEETING.dateDay}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 9,
                      color: 'rgba(255,255,255,0.7)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {DETAIL_MEETING.dateDayName}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--v4-text-primary)',
                      lineHeight: 1.4,
                      marginBottom: 5,
                    }}
                  >
                    {DETAIL_MEETING.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                    <IconClock />
                    <span
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 11,
                        color: 'var(--v4-text-muted)',
                      }}
                    >
                      {DETAIL_MEETING.time}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <IconTeams />
                    <span
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 11,
                        color: 'var(--v4-text-secondary)',
                        fontWeight: 500,
                      }}
                    >
                      {DETAIL_MEETING.platform}
                    </span>
                  </div>
                </div>
              </div>

              {/* Participants */}
              {d && /^https:\/\//i.test(d.onlineMeetingUrl) && (
                <a
                  className="v4-button v4-button--primary"
                  href={d.onlineMeetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <InlineGlyphs.SctMeetings size={16} /> Join Meeting
                </a>
              )}
              {d && (
                <section style={{ padding: '16px 0', borderBottom: `1px solid ${C.border}` }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <strong>Outcome</strong>
                    {b.editOutcome && (
                      <button
                        type="button"
                        className="v4-button v4-button--secondary"
                        aria-label="Edit meeting outcome"
                        onClick={() => b.editOutcome?.(d)}
                      >
                        <InlineGlyphs.SctEdit size={14} /> Edit
                      </button>
                    )}
                  </div>
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {d.decisions || 'No outcome recorded.'}
                  </p>
                </section>
              )}
              <div style={{ marginBottom: 8, padding: '20px 0' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--v4-text-primary)',
                    }}
                  >
                    Participants ({DETAIL_MEETING.participants.length})
                  </span>
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--v4-accent-ink)',
                    }}
                    onClick={() => b.subview('participants')}
                  >
                    View all
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                  {DETAIL_MEETING.participants.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Avatar initials={p.initials} size={26} />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--v4-text-primary)',
                            lineHeight: 1.3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {p.name}
                        </div>
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 10,
                            color: 'var(--v4-text-muted)',
                          }}
                        >
                          {p.role}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--v4-surface-muted)', margin: '8px 0' }} />

              {/* Agenda */}
              <div style={{ marginBottom: 8, padding: '9px 0' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--v4-text-primary)',
                    }}
                  >
                    Agenda
                  </span>
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--v4-accent-ink)',
                    }}
                    onClick={() => b.subview('agenda')}
                  >
                    Edit
                  </button>
                </div>
                <ol
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  {DETAIL_MEETING.agenda.map((item, i) => (
                    <li key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <span
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--v4-text-disabled)',
                          flexShrink: 0,
                          minWidth: 14,
                        }}
                      >
                        {i + 1}.
                      </span>
                      <span
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          color: 'var(--v4-text-secondary)',
                          lineHeight: 1.45,
                        }}
                      >
                        {item}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div style={{ height: 1, background: 'var(--v4-surface-muted)', margin: '8px 0' }} />

              {/* Linked Actions */}
              <div style={{ marginBottom: 8, padding: '7px 0' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--v4-text-primary)',
                    }}
                  >
                    Linked Actions
                  </span>
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--v4-accent-ink)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                    onClick={() => b.subview('actions')}
                  >
                    View all ({DETAIL_MEETING.linkedActions.length})
                    <InlineGlyphs.SctNext width="11" height="11" color="#2563eb" />
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {DETAIL_MEETING.linkedActions.map((a, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        padding: '6px 8px',
                        background: 'var(--v4-surface-subtle)',
                        borderRadius: 6,
                        border: '1px solid #f3f4f6',
                      }}
                    >
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: a.priorityBg,
                          color: a.priorityColor,
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 10,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {a.priority}
                      </span>
                      <span
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          color: 'var(--v4-text-secondary)',
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {a.text}
                      </span>
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 10,
                            color: 'var(--v4-text-secondary)',
                            fontWeight: 500,
                          }}
                        >
                          {a.assignee}
                        </div>
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 10,
                            color: 'var(--v4-text-disabled)',
                          }}
                        >
                          {a.date}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--v4-surface-muted)', margin: '8px 0' }} />

              {/* Notes Summary */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--v4-text-primary)',
                    }}
                  >
                    Notes Summary
                  </span>
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--v4-accent-ink)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                    onClick={() => b.subview('notes')}
                  >
                    View all ({d?.notesCount ?? 0})
                    <InlineGlyphs.SctNext width="11" height="11" color="#2563eb" />
                  </button>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Open meeting notes"
                  onClick={() => b.subview('notes')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      b.subview('notes');
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    background: 'var(--v4-surface-subtle)',
                    borderRadius: 8,
                    border: '1px solid #e9d5ff',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 7,
                      background: '#ede9fe',
                      border: '1px solid #c4b5fd',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <IconNoteDetail />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 11,
                        color: 'var(--v4-text-secondary)',
                        lineHeight: 1.4,
                      }}
                    >
                      {DETAIL_MEETING.noteSummary.text}
                    </div>
                    <div
                      style={{
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 10,
                        color: 'var(--v4-text-muted)',
                        marginTop: 2,
                      }}
                    >
                      {d?.notesCount ? (
                        <>
                          Last updated {DETAIL_MEETING.noteSummary.updatedDate} by{' '}
                          {DETAIL_MEETING.noteSummary.updatedBy}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <InlineGlyphs.SctNext width="13" height="13" color="#9ca3af" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {b.detailContent}
    </div>
  );
}
