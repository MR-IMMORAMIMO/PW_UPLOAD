import * as InlineGlyphs from '../common/SctIcons';
import { useLayoutEffect, useRef, useState } from 'react';
import './referenceUtilities.css';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg: 'var(--v4-surface-raised)',
  pageBg: 'var(--v4-surface-subtle)',
  border: 'var(--v4-border-subtle)',
  borderLight: 'var(--v4-surface-muted)',
  text: 'var(--v4-text-primary)',
  textMid: 'var(--v4-text-secondary)',
  textMuted: 'var(--v4-text-muted)',
  textSub: 'var(--v4-text-disabled)',
  blue: '#2563eb',
  blueLight: 'var(--v4-accent-selected)',
  blueBorder: '#bfdbfe',
  blueMid: '#3b82f6',
  green: '#22c55e',
  greenDark: '#16a34a',
  teal: 'var(--v4-action-primary)',
  tealLight: 'var(--v4-accent-soft)',
  amber: '#f59e0b',
  amberLight: '#fff7ed',
  red: '#dc2626',
  gray: 'var(--v4-text-disabled)',
  grayLight: 'var(--v4-surface-muted)',
  shadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
};

// ── Types ─────────────────────────────────────────────────────────────────────
type EventStatus = 'completed' | 'active' | 'pending';
type EventType = 'workflow' | 'revision' | 'meeting' | 'action' | 'activity';

export interface FinalTimelineEvent {
  statusLabel: string;
  openRevision: (() => void) | null;
  openEntity?: (() => void) | null;
  openEntityLabel?: string | undefined;
  viewOutputs: (() => void) | null;
  more: () => void;
  id: string;
  title: string;
  desc: string;
  date: string;
  time: string;
  avatar: string;
  avatarBg: string;
  performer: string;
  role: string;
  status: EventStatus;
  type: EventType;
  iconKind:
    | 'check'
    | 'people'
    | 'warning'
    | 'document'
    | 'gear'
    | 'doc-plain'
    | 'flag'
    | 'contact'
    | 'project'
    | 'luminaire'
    | 'add'
    | 'edit'
    | 'remove'
    | 'import'
    | 'export';
  iconBg: string;
  iconColor: string;
  eventTypeName: string;
  stage: string;
  inProgress: boolean;
  notes: string;
  outputs: Output[];
}

interface Output {
  icon: 'pdf' | 'folder' | 'xlsx';
  name: string;
  meta: string;
  date: string;
  time: string;
  action: 'download' | 'arrow';
  open: (() => void) | null;
}

// ── Data ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'revision', label: 'Revisions' },
  { id: 'meeting', label: 'Meetings' },
  { id: 'action', label: 'Actions' },
];

// ── Icons ─────────────────────────────────────────────────────────────────────
function EventIcon({
  kind,
  bg,
  color,
}: {
  kind: FinalTimelineEvent['iconKind'];
  bg: string;
  color: string;
}) {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: bg,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
        zIndex: 1,
      }}
    >
      {kind === 'add' && <InlineGlyphs.SctAdd width="18" height="18" />}
      {kind === 'edit' && <InlineGlyphs.SctEdit width="18" height="18" />}
      {kind === 'remove' && <InlineGlyphs.SctRemove width="18" height="18" />}
      {kind === 'import' && <InlineGlyphs.SctSmartImport width="18" height="18" />}
      {kind === 'export' && <InlineGlyphs.SctExport width="18" height="18" />}
      {kind === 'check' && <InlineGlyphs.SctCheck width="18" height="18" />}
      {kind === 'people' && <InlineGlyphs.SctMeetings width="18" height="18" />}
      {kind === 'warning' && <InlineGlyphs.SctWarning width="18" height="18" />}
      {kind === 'document' && <InlineGlyphs.SctRevisions width="18" height="18" />}
      {kind === 'gear' && <InlineGlyphs.SctTimeline width="18" height="18" />}
      {kind === 'doc-plain' && <InlineGlyphs.SctFile width="18" height="18" />}
      {kind === 'flag' && <InlineGlyphs.SctActions width="18" height="18" />}
      {kind === 'contact' && <InlineGlyphs.SctContacts width="18" height="18" />}
      {kind === 'project' && <InlineGlyphs.SctProjects width="18" height="18" />}
      {kind === 'luminaire' && <InlineGlyphs.SctLuminaires width="18" height="18" />}
    </div>
  );
}

function TabIcon({ id, active }: { id: string; active: boolean }) {
  const c = active ? C.blue : C.textMuted;
  if (id === 'all') return <InlineGlyphs.SctTimeline width="13" height="13" color={c} />;
  if (id === 'workflow') return <InlineGlyphs.SctTimeline width="13" height="13" color={c} />;
  if (id === 'revision') return <InlineGlyphs.SctRevisions width="13" height="13" color={c} />;
  if (id === 'meeting') return <InlineGlyphs.SctMeetings width="13" height="13" color={c} />;
  if (id === 'action') return <InlineGlyphs.SctActions width="13" height="13" color={c} />;
  return null;
}

function OutputFileIcon({ type }: { type: Output['icon'] }) {
  if (type === 'pdf')
    return (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: '#fee2e2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <InlineGlyphs.SctPdf width="16" height="16" color="#dc2626" />
      </div>
    );
  if (type === 'folder')
    return (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: '#dbeafe',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <InlineGlyphs.SctFolder width="16" height="16" color="#2563eb" />
      </div>
    );
  if (type === 'xlsx')
    return (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: '#dcfce7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <InlineGlyphs.SctExcel width="16" height="16" color="#16a34a" />
      </div>
    );
  return null;
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function DetailPanel({ event }: { event: FinalTimelineEvent }) {
  return (
    <div
      role="region"
      aria-label="Event details"
      style={{
        width: '40%',
        minWidth: 0,
        overflowWrap: 'anywhere',
        overflowX: 'hidden',
        flexShrink: 0,
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        boxShadow: C.shadow,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          {/* Icon */}
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: event.status === 'active' ? '#dbeafe' : C.grayLight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <EventIcon
              kind={event.iconKind}
              bg="transparent"
              color={event.status === 'active' ? C.blue : C.gray}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 15,
                  fontWeight: 700,
                  color: C.text,
                }}
              >
                {event.title}
              </div>
              {event.status === 'active' && (
                <span
                  style={{
                    flexShrink: 0,
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 11,
                    fontWeight: 600,
                    color: C.blue,
                    background: C.blueLight,
                    padding: '3px 10px',
                    borderRadius: 20,
                    border: `1px solid ${C.blueBorder}`,
                  }}
                >
                  Current Event
                </span>
              )}
            </div>
            <div
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                color: C.textMuted,
                lineHeight: 1.4,
              }}
            >
              {event.desc}
            </div>
          </div>
        </div>
      </div>

      {/* Fields */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {[
          {
            icon: <InlineGlyphs.SctDate width="16" height="16" color={C.textMuted} />,
            label: 'Date & Time',
            value: event.date ? `${event.date}, ${event.time}` : '—',
            valueColor: C.text,
          },
          {
            icon: <InlineGlyphs.SctProfile width="16" height="16" color={C.textMuted} />,
            label: 'Performed By',
            value: 'Not recorded',
            valueColor: C.text,
            custom: event.performer ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: event.avatarBg,
                    color: 'var(--v4-action-primary-foreground)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    fontWeight: 800,
                    fontFamily: "'Inter', sans-serif",
                    flexShrink: 0,
                  }}
                >
                  {event.avatar}
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      fontWeight: 600,
                      color: C.text,
                      lineHeight: 1.2,
                    }}
                  >
                    {event.performer}
                  </div>
                  <div
                    style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: C.textMuted }}
                  >
                    {event.role}
                  </div>
                </div>
              </div>
            ) : null,
          },
          {
            icon: <InlineGlyphs.SctOutputActivity width="16" height="16" color={C.textMuted} />,
            label: 'Event Type',
            value: event.eventTypeName,
            valueColor: C.text,
          },
          {
            icon: <InlineGlyphs.SctPending width="16" height="16" color={C.textMuted} />,
            label: 'Stage',
            value: event.stage,
            valueColor: event.status === 'active' ? C.blue : C.text,
            valueWeight: 600,
          },
          {
            icon: <InlineGlyphs.SctPending width="16" height="16" color={C.textMuted} />,
            label: 'Status',
            value: null,
            valueColor: C.text,
            custom: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: event.inProgress
                      ? C.blue
                      : event.status === 'completed'
                        ? C.green
                        : C.gray,
                    display: 'inline-block',
                  }}
                />
                <span
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13,
                    color: event.inProgress
                      ? C.blue
                      : event.status === 'completed'
                        ? C.greenDark
                        : C.textMuted,
                    fontWeight: 500,
                  }}
                >
                  {event.statusLabel}
                </span>
              </div>
            ),
          },
        ].map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 20, paddingTop: 1, flexShrink: 0 }}>{row.icon}</div>
            <div
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                color: C.textMuted,
                width: 96,
                flexShrink: 0,
              }}
            >
              {row.label}
            </div>
            {row.custom ?? (
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 13,
                  color: row.valueColor,
                  fontWeight: row.valueWeight ?? 400,
                }}
              >
                {row.value}
              </div>
            )}
          </div>
        ))}

        {/* Notes */}
        {event.notes && event.notes !== event.desc && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 20, paddingTop: 1, flexShrink: 0 }}>
              <InlineGlyphs.SctNotes width="16" height="16" color={C.textMuted} />
            </div>
            <div
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                color: C.textMuted,
                width: 96,
                flexShrink: 0,
              }}
            >
              Notes
            </div>
            <div
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                color: C.textMid,
                lineHeight: 1.6,
                flex: 1,
              }}
            >
              {event.notes}
            </div>
          </div>
        )}
      </div>

      {/* Related Outputs */}
      {event.outputs.length > 0 && (
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                fontWeight: 600,
                color: C.text,
              }}
            >
              Related Outputs ({event.outputs.length})
            </div>
            <button
              onClick={event.viewOutputs ?? undefined}
              disabled={!event.viewOutputs}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                fontWeight: 500,
                color: C.blueMid,
                padding: 0,
              }}
            >
              View all
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {event.outputs.map((o, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <OutputFileIcon type={o.icon} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12,
                      fontWeight: 600,
                      color: C.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {o.name}
                  </div>
                  <div
                    style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: C.textMuted }}
                  >
                    {o.meta}
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div
                    style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: C.textMuted }}
                  >
                    {o.date}
                  </div>
                  <div
                    style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: C.textMuted }}
                  >
                    {o.time}
                  </div>
                </div>
                <button
                  aria-label={`Open ${o.name}`}
                  onClick={o.open ?? undefined}
                  disabled={!o.open}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    background: C.bg,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {o.action === 'download' ? (
                    <InlineGlyphs.SctOpen width="13" height="13" color={C.textMid} />
                  ) : (
                    <InlineGlyphs.SctPreview width="13" height="13" color={C.textMid} />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ padding: '14px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(event.openEntity || event.openRevision) && (
          <button
            onClick={event.openEntity ?? event.openRevision ?? undefined}
            disabled={!event.openEntity && !event.openRevision}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              background: C.teal,
              color: 'var(--v4-action-primary-foreground)',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              padding: '9px 14px',
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {event.openEntityLabel ?? 'Open Revision'}
            <InlineGlyphs.SctOpen width="14" height="14" />
          </button>
        )}
        {event.viewOutputs && (
          <button
            onClick={event.viewOutputs ?? undefined}
            disabled={!event.viewOutputs}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: C.bg,
              color: C.textMid,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              cursor: 'pointer',
              padding: '9px 14px',
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            View Outputs
            <InlineGlyphs.SctPreview width="12" height="12" color={C.textMid} />
          </button>
        )}
        <button
          onClick={event.more}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            padding: '9px 12px',
            background: C.bg,
            color: C.textMid,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            cursor: 'pointer',
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          View details
          <InlineGlyphs.SctOpen width="14" height="14" />
        </button>
      </div>
    </div>
  );
}

// ── Connector line ────────────────────────────────────────────────────────────
// marginLeft = row borderLeft(3) + row paddingLeft(14) + iconHalf(18) - connectorHalf(1) = 34
function Connector({ fromCompleted }: { fromCompleted: boolean }) {
  return (
    <div
      style={{
        width: 2,
        height: 28,
        marginLeft: 34,
        flexShrink: 0,
        background: fromCompleted
          ? C.green
          : 'repeating-linear-gradient(180deg, #d1d5db 0, #d1d5db 4px, transparent 4px, transparent 8px)',
      }}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FinalWorkflowTimelineView({
  events: EVENTS,
  loading,
  error,
  retry,
  initialEventId,
}: {
  events: FinalTimelineEvent[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  initialEventId: string | null;
}) {
  const [activeTab, setActiveTab] = useState('all');
  const [selectedId, setSelectedId] = useState(initialEventId ?? '');

  const filtered = activeTab === 'all' ? EVENTS : EVENTS.filter((e) => e.type === activeTab);

  const selectedEvent = filtered.find((e) => e.id === selectedId) ?? filtered.at(-1);
  const eventsRegion = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const region = eventsRegion.current;
    const selected = region?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!region || !selected) return;
    const container = region.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    if (item.bottom > container.bottom) region.scrollTop += item.bottom - container.bottom;
    else if (item.top < container.top) region.scrollTop -= container.top - item.top;
  }, [selectedEvent?.id, activeTab]);

  return (
    <div
      className="final-ui-reference"
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        height: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Page heading */}
      <div style={{ flexShrink: 0 }}>
        <h1
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 26,
            fontWeight: 800,
            color: C.text,
            margin: '0 0 4px',
            letterSpacing: '-0.02em',
          }}
        >
          Workflow Timeline
        </h1>
        <p
          style={{ fontFamily: "'Inter', sans-serif", fontSize: 13, color: C.textMuted, margin: 0 }}
        >
          Track the full project journey from kickoff to latest revision activity.
        </p>
      </div>

      {loading ? (
        <div role="status">Loading timeline…</div>
      ) : error ? (
        <div role="alert">
          {error} <button onClick={retry}>Retry</button>
        </div>
      ) : EVENTS.length === 0 ? (
        <p>No timeline events yet.</p>
      ) : null}
      {/* Tabs */}
      <div
        role="toolbar"
        aria-label="Timeline filters"
        style={{ display: 'flex', gap: 6, flexShrink: 0 }}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              aria-pressed={active}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 14px',
                borderRadius: 8,
                border: active ? `1.5px solid ${C.teal}` : `1px solid ${C.border}`,
                background: active ? C.blueLight : C.bg,
                cursor: 'pointer',
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? C.teal : C.textMuted,
                transition: 'all 120ms',
              }}
            >
              <TabIcon id={tab.id} active={active} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>
        {/* Timeline list */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            boxShadow: C.shadow,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            role="region"
            aria-label="Timeline events"
            ref={eventsRegion}
            style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}
          >
            {!filtered.length && (
              <div className="v4-audit-empty" role="status">
                <strong>No events in this category.</strong>
                <button type="button" onClick={() => setActiveTab('all')}>
                  Show all events
                </button>
              </div>
            )}
            {filtered.map((event, i) => {
              const isSelected = event.id === selectedEvent?.id;
              const prevEvent = i > 0 ? filtered[i - 1] : null;
              const showConnector = i > 0;
              const prevCompleted = prevEvent?.status === 'completed';

              return (
                <div key={event.id}>
                  {showConnector && <Connector fromCompleted={prevCompleted} />}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={event.title}
                    aria-pressed={selectedEvent?.id === event.id}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(event.id);
                      }
                    }}
                    onClick={() => setSelectedId(event.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 14,
                      padding: '12px 14px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      border:
                        isSelected && event.status === 'active'
                          ? `1px solid ${C.blueBorder}`
                          : '1px solid transparent',
                      borderLeft:
                        isSelected && event.status === 'active'
                          ? `3px solid ${C.blue}`
                          : isSelected
                            ? `3px solid ${C.border}`
                            : '3px solid transparent',
                      background:
                        isSelected && event.status === 'active'
                          ? C.blueLight
                          : isSelected
                            ? C.grayLight
                            : 'transparent',
                      transition: 'background 120ms',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLElement).style.background = C.pageBg;
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <EventIcon kind={event.iconKind} bg={event.iconBg} color={event.iconColor} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 14,
                          fontWeight: 600,
                          color:
                            event.status === 'active'
                              ? C.blue
                              : event.status === 'pending'
                                ? C.textMuted
                                : C.text,
                          marginBottom: 2,
                        }}
                      >
                        {event.title}
                      </div>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 12,
                          color: C.textMuted,
                          lineHeight: 1.4,
                        }}
                      >
                        {event.desc}
                      </div>
                    </div>
                    {
                      <div
                        style={{
                          flexShrink: 0,
                          textAlign: 'right',
                          maxWidth: '34%',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        <div
                          style={{
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 12,
                            color: event.status === 'active' ? C.blue : C.textMuted,
                            fontWeight: event.status === 'active' ? 600 : 400,
                            whiteSpace: 'normal',
                          }}
                        >
                          {event.date}, {event.time}
                        </div>
                        {event.avatar && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              gap: 6,
                              marginTop: 4,
                            }}
                          >
                            <div
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                background: event.avatarBg,
                                color: 'var(--v4-action-primary-foreground)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 7,
                                fontWeight: 800,
                                fontFamily: "'Inter', sans-serif",
                              }}
                            >
                              {event.avatar}
                            </div>
                            <span
                              style={{
                                fontFamily: "'Inter', sans-serif",
                                fontSize: 11,
                                color: C.textMuted,
                              }}
                            >
                              by {event.performer}
                            </span>
                          </div>
                        )}
                      </div>
                    }
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        {selectedEvent && <DetailPanel event={selectedEvent} />}
      </div>
    </div>
  );
}
