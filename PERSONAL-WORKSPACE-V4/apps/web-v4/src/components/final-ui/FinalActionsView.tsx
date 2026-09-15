import { useResizableGridColumns } from '../common/useResizableGridColumns';
import * as InlineGlyphs from '../common/SctIcons';
import * as CustomGlyphs from '../common/SctIcons';
import { actionCategoryIconFor } from '../common/actionCategoryIconCatalog';
import { createElement, useState, type ReactNode } from 'react';
import type {
  ProjectActionItem,
  ProjectWorkspace,
  ActionCategory,
  MeetingListItem,
} from '@scli/domain';
import {
  actionDueState,
  actionDueLabel,
  actionStatusLabel,
} from '../../pages/project-actions/actionsViewModel';
import { V4FilterSelect, type V4FilterSelectOption } from '../common/V4FilterSelect';
import { formatBusinessDateOnly, formatBusinessDateTime } from '../../date-time/businessDateTime';
export interface FinalActionsBinding {
  items: ProjectActionItem[];
  selected: ProjectActionItem | null;
  workspace: ProjectWorkspace;
  categories: ActionCategory[];
  today: string;
  kpis: { open: number; dueSoon: number; overdue: number; completed: number };
  kpi: (key: 'open' | 'dueSoon' | 'overdue' | 'completed') => void;
  activeKpi?: string;
  clearFilters?: () => void;
  hasFilters?: boolean;
  filters: Array<{
    label: string;
    value: string;
    options: V4FilterSelectOption[];
    change: (value: string) => void;
  }>;
  query: string;
  setQuery: (query: string) => void;
  page: number;
  pages: number;
  total: number;
  setPage: (page: number) => void;
  select: (id: string | null) => void;
  edit: (item: ProjectActionItem) => void;
  editText?: (item: ProjectActionItem, field: 'details' | 'notes') => void;
  add: () => void;
  status: (item: ProjectActionItem, status: ProjectActionItem['status']) => void;
  pending: boolean;
  bulk?: (
    ids: string[],
    changes: Partial<Pick<ProjectActionItem, 'status' | 'priority' | 'owner' | 'ownerRole'>>,
  ) => Promise<void>;
  linkedMeetings: MeetingListItem[];
  meetingsState: 'loading' | 'error' | 'ready';
  meetings: () => void;
  comment: () => void;
  linked: () => void;
  more: () => void;
  notice: ReactNode;
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
const columns =
  '28px minmax(150px,1.7fr) minmax(70px,.7fr) minmax(100px,1fr) minmax(110px,1.2fr) minmax(85px,.9fr) minmax(110px,1.2fr) minmax(80px,.8fr) 20px';

const F = "'Inter', sans-serif";

const C = {
  teal: 'var(--v4-action-primary)',
  bg: 'var(--v4-surface-base)',
  white: 'var(--v4-surface-raised)',
  border: 'var(--v4-border-control)',
  text: 'var(--v4-text-primary)',
  textMid: 'var(--v4-text-secondary)',
  textSub: 'var(--v4-text-muted)',
  textFaint: 'var(--v4-text-disabled)',
  blue: '#2563eb',
  blueLight: 'var(--v4-accent-selected)',
  blueBorder: '#bfdbfe',
  green: '#16a34a',
  greenLight: '#f0fdf4',
  orange: '#ea580c',
  orangeLight: '#fff7ed',
  orangeBorder: '#fed7aa',
  red: '#dc2626',
  redLight: '#fef2f2',
  amber: '#d97706',
  amberLight: '#fffbeb',
  gray: 'var(--v4-text-muted)',
  grayLight: 'var(--v4-surface-muted)',
  grayBorder: 'var(--v4-border-control)',
};

// ── Icons ─────────────────────────────────────────────────────────────────────

function IcoClipboard() {
  return <CustomGlyphs.SctActions size="22" style={{ color: C.blue }} />;
}
function IcoClock() {
  return <CustomGlyphs.SctDuration size="22" style={{ color: C.orange }} />;
}
function IcoWarn() {
  return <CustomGlyphs.SctWarning size="22" style={{ color: C.red }} />;
}
function IcoCheckCircle() {
  return <CustomGlyphs.SctSuccess size="22" style={{ color: C.green }} />;
}
function IcoSearch() {
  return <CustomGlyphs.SctSearch size="14" style={{ color: C.textFaint }} />;
}
function IcoChevDown() {
  return <CustomGlyphs.SctExpand size="12" style={{ color: 'currentColor' }} />;
}
function IcoFilter() {
  return <CustomGlyphs.SctFilter size="13" style={{ color: C.textSub }} />;
}
function IcoPlus() {
  return <CustomGlyphs.SctAdd size="13" style={{ color: '#fff' }} />;
}
function IcoChevRight() {
  return <CustomGlyphs.SctNext size="13" style={{ color: C.textFaint }} />;
}
function IcoX() {
  return <CustomGlyphs.SctClose size="13" style={{ color: C.textSub }} />;
}
function IcoCalSmall() {
  return <CustomGlyphs.SctDate size="13" style={{ color: 'currentColor' }} />;
}
function IcoCheck() {
  return <CustomGlyphs.SctCheck size="13" style={{ color: '#fff' }} />;
}
function IcoExternal() {
  return <CustomGlyphs.SctOpen size="13" style={{ color: 'currentColor' }} />;
}
function IcoCal() {
  return <CustomGlyphs.SctDate size="14" style={{ color: C.textSub }} />;
}
function IcoComment() {
  return <CustomGlyphs.SctComments size="14" style={{ color: C.textSub }} />;
}

// category icons

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ initials, color }: { initials: string; color: string }) {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: color,
        color: 'var(--v4-action-primary-foreground)',
        fontSize: 10,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontFamily: F,
      }}
    >
      {initials}
    </div>
  );
}

// ── Priority badge ────────────────────────────────────────────────────────────

function PriorityBadge({ level }: { level: 'High' | 'Medium' | 'Low' | 'Urgent' }) {
  const map = {
    High: { bg: C.orangeLight, color: C.orange, border: C.orangeBorder, dot: C.red },
    Medium: { bg: C.blueLight, color: C.blue, border: C.blueBorder, dot: C.blue },
    Low: { bg: C.grayLight, color: C.gray, border: C.grayBorder, dot: C.gray },
  };
  const s = map[level === 'Urgent' ? 'High' : level];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 10,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, flexShrink: 0 }}
      />
      {level}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; border: string }> = {
    'In Progress': { bg: C.blueLight, color: C.blue, border: C.blueBorder },
    Open: { bg: C.white, color: C.gray, border: C.grayBorder },
    Overdue: { bg: C.redLight, color: C.red, border: '#fca5a5' },
    Completed: { bg: C.greenLight, color: C.green, border: '#86efac' },
  };
  const s = map[status] ?? { bg: C.white, color: C.gray, border: C.grayBorder };
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 6,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}

// ── Category cell ─────────────────────────────────────────────────────────────

function CategoryCell({ cat, category }: { cat: string; category?: ActionCategory | undefined }) {
  const Icon = actionCategoryIconFor(category?.iconKey ?? 'tags');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      {createElement(Icon, {
        size: 16,
        className: category ? 'v4-settings__color--' + category.colorKey : undefined,
      })}
      <span style={{ fontSize: 12, color: C.textMid }}>{cat}</span>
    </div>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────────

export default function FinalActionsView({ binding: b }: { binding: FinalActionsBinding }) {
  const sizing = useResizableGridColumns(
    'FinalActionsView',
    [28, 190, 90, 120, 130, 110, 150, 100, 20],
  );
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState('status');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [dueSort, setDueSort] = useState<'asc' | 'desc'>('desc');
  const selectedId = b.selected?.id;
  function present(item: ProjectActionItem) {
    const due = actionDueState(item, b.today);
    const luminaire = item.luminaireId
      ? b.workspace.luminaires.find((row) => row.id === item.luminaireId)
      : null;
    return {
      record: item,
      id: item.id,
      title: item.title,
      desc: item.details,
      priority: item.priority === 'Normal' ? ('Medium' as const) : item.priority,
      dueDate: item.dueDate ? formatBusinessDateOnly(item.dueDate) : '—',
      dueSub: actionDueLabel(due, item.dueDate, b.today),
      dueColor: due === 'overdue' ? C.red : due === 'today' ? C.orange : C.textSub,
      ownerInitials: initials(item.owner),
      ownerColor: C.blue,
      ownerName: item.owner || '—',
      ownerRole: item.ownerRole,
      category:
        b.categories.find((category) => category.id === item.categoryId)?.label ??
        (item.categoryId ? 'Category unavailable' : 'Uncategorized'),
      linkedArea: item.area || '—',
      linkedSub: luminaire ? luminaire.tag : item.luminaireId ? 'Unavailable luminaire' : '',
      status: actionStatusLabel(item.status),
    };
  }
  const ACTIONS = [...b.items]
    .sort((a, z) => {
      if (!a.dueDate) return z.dueDate ? 1 : 0;
      if (!z.dueDate) return -1;
      return a.dueDate.localeCompare(z.dueDate) * (dueSort === 'asc' ? 1 : -1);
    })
    .map(present);
  const allChecked = ACTIONS.length > 0 && ACTIONS.every((action) => checkedIds.has(action.id));
  const selectedAction = b.selected ? present(b.selected) : null;
  const linkedMeeting = b.linkedMeetings[0];
  const linkedComment = b.selected?.reviewItemId
    ? b.workspace.reviewItems.find((item) => item.id === b.selected?.reviewItemId)
    : null;
  const buttonStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '7px 11px',
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    fontSize: 12,
    color: C.textMid,
    fontFamily: F,
    cursor: 'pointer',
    boxShadow: 'none',
  } as const;
  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      data-resizable-grid
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: C.bg,
        fontFamily: F,
        padding: '16px 16px 12px',
        boxSizing: 'border-box',
      }}
    >
      {/* Page title */}
      <div style={{ marginBottom: 12, flexShrink: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>Actions</h1>
        <p style={{ fontSize: 12, color: C.textSub, margin: '3px 0 0' }}>
          Track design tasks, follow-ups, and issue-related work.
        </p>
      </div>

      {/* Main content: table + detail panel */}
      <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0 }}>
        {/* Left column */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            minHeight: 0,
          }}
        >
          {/* Stats row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 10,
              flexShrink: 0,
            }}
          >
            {[
              {
                icon: <IcoClipboard />,
                label: 'Open',
                value: b.kpis.open,
                key: 'open' as const,
                sub: null,
                link: 'View all',
                bg: C.blueLight,
              },
              {
                icon: <IcoClock />,
                label: 'Due Soon',
                value: b.kpis.dueSoon,
                key: 'dueSoon' as const,
                sub: 'Due in next 7 days',
                link: 'View',
                bg: '#fff7ed',
              },
              {
                icon: <IcoWarn />,
                label: 'Overdue',
                value: b.kpis.overdue,
                key: 'overdue' as const,
                sub: 'Overdue actions',
                link: 'View',
                bg: C.redLight,
              },
              {
                icon: <IcoCheckCircle />,
                label: 'Completed',
                value: b.kpis.completed,
                key: 'completed' as const,
                sub: 'This project',
                link: null,
                bg: C.greenLight,
              },
            ].map((stat, i) => (
              <button
                type="button"
                aria-label={`View ${stat.label} actions`}
                aria-pressed={b.activeKpi === stat.key}
                onClick={() => b.kpi(stat.key)}
                key={i}
                style={{
                  background: b.activeKpi === stat.key ? C.blueLight : C.white,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: F,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: stat.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {stat.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: C.textSub, fontWeight: 500, marginBottom: 2 }}>
                    {stat.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: C.text, lineHeight: 1 }}>
                      {stat.value}
                    </span>
                    {stat.link && (
                      <span
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--v4-accent-ink)',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                          padding: 0,
                          fontFamily: F,
                        }}
                      >
                        {stat.link}
                      </span>
                    )}
                  </div>
                  {stat.sub && (
                    <div style={{ fontSize: 10, color: C.textFaint, marginTop: 2 }}>{stat.sub}</div>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Filter bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 7,
                padding: '7px 10px',
                flex: '0 0 180px',
              }}
            >
              <IcoSearch />
              <input
                aria-label="Search actions"
                value={b.query}
                onChange={(event) => b.setQuery(event.target.value)}
                placeholder="Search actions..."
                style={{
                  border: 'none',
                  outline: 'none',
                  fontSize: 12,
                  color: C.text,
                  fontFamily: F,
                  background: 'none',
                  width: '100%',
                }}
              />
            </div>
            {b.filters.map((filter) => (
              <V4FilterSelect
                key={filter.label}
                label={filter.label}
                value={filter.value}
                options={filter.options}
                onChange={filter.change}
                triggerStyle={buttonStyle}
                chevron={<IcoChevDown />}
              />
            ))}
            <button
              onClick={b.more}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 11px',
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 7,
                fontSize: 12,
                color: C.textMid,
                fontFamily: F,
                cursor: 'pointer',
              }}
            >
              <IcoFilter /> More filters
            </button>
            {b.hasFilters && (
              <button type="button" onClick={b.clearFilters} style={{ color: C.teal }}>
                Clear filters
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={b.add}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 16px',
                background: C.teal,
                color: 'var(--v4-action-primary-foreground)',
                border: 'none',
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: F,
                cursor: 'pointer',
              }}
            >
              <IcoPlus /> Add Action
            </button>
          </div>

          {b.notice}
          {checkedIds.size > 0 && b.bulk ? (
            <div
              className="v4-bulk-actions"
              aria-label="Selected actions"
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                padding: 10,
                flexWrap: 'wrap',
              }}
            >
              <strong>{checkedIds.size} selected</strong>
              <V4FilterSelect
                label="Bulk action field"
                value={bulkField}
                onChange={(value) => {
                  setBulkField(value);
                  setBulkValue('');
                }}
                options={[
                  { value: 'status', label: 'Status' },
                  { value: 'priority', label: 'Priority' },
                  { value: 'owner', label: 'Owner' },
                ]}
              />
              <V4FilterSelect
                label="Bulk action value"
                value={bulkValue}
                onChange={setBulkValue}
                options={[
                  { value: '', label: 'Choose a value' },
                  ...(bulkField === 'status'
                    ? ['Open', 'InProgress', 'Waiting', 'Completed', 'Cancelled']
                    : bulkField === 'priority'
                      ? ['Low', 'Normal', 'High', 'Urgent']
                      : Array.from(new Set(b.workspace.contacts.map((contact) => contact.name)))
                  ).map((value) => ({
                    value,
                    label:
                      value === 'Normal'
                        ? 'Medium'
                        : value === 'InProgress'
                          ? 'In Progress'
                          : value,
                  })),
                ]}
              />
              <button
                type="button"
                disabled={bulkPending || !bulkValue}
                onClick={() => {
                  setBulkPending(true);
                  setBulkError(null);
                  const changes =
                    bulkField === 'status'
                      ? { status: bulkValue as ProjectActionItem['status'] }
                      : bulkField === 'priority'
                        ? { priority: bulkValue as ProjectActionItem['priority'] }
                        : {
                            owner: bulkValue,
                            ownerRole:
                              b.workspace.contacts.find(
                                (contact) => contact.name === bulkValue && !contact.archived,
                              )?.role ?? '',
                          };
                  void b.bulk!([...checkedIds], changes)
                    .then(() => setCheckedIds(new Set()))
                    .catch((error: unknown) =>
                      setBulkError(
                        error instanceof Error
                          ? error.message
                          : 'Some actions could not be updated.',
                      ),
                    )
                    .finally(() => setBulkPending(false));
                }}
              >
                Apply to selected
              </button>
              <button type="button" disabled={bulkPending} onClick={() => setCheckedIds(new Set())}>
                Clear selection
              </button>
              {bulkError && <span role="alert">{bulkError}</span>}
            </div>
          ) : null}
          {/* Table */}
          <div
            style={{
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              overflow: 'auto',
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {sizing.reset}
            {/* Table header */}
            <div
              style={{
                display: 'grid',
                minWidth: 930,
                gridTemplateColumns: columns,
                ...sizing.style,
                padding: '10px 14px',
                background: C.bg,
                borderBottom: `1px solid ${C.border}`,
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div
                role="checkbox"
                aria-label="Select visible actions"
                aria-checked={
                  ACTIONS.length > 0 && ACTIONS.every((action) => checkedIds.has(action.id))
                }
                tabIndex={0}
                onClick={() =>
                  setCheckedIds((current) =>
                    ACTIONS.every((action) => current.has(action.id))
                      ? new Set()
                      : new Set(ACTIONS.map((action) => action.id)),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === ' ') {
                    event.preventDefault();
                    setCheckedIds((current) =>
                      ACTIONS.every((action) => current.has(action.id))
                        ? new Set()
                        : new Set(ACTIONS.map((action) => action.id)),
                    );
                  }
                }}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `1.5px solid ${allChecked ? C.blue : C.grayBorder}`,
                  background: allChecked ? C.blue : C.white,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {allChecked && <InlineGlyphs.SctCheck width="10" height="10" color="#fff" />}
              </div>
              {[
                'Action',
                'Priority',
                `Due Date ${dueSort === 'asc' ? '↑' : '↓'}`,
                'Owner',
                'Category',
                'Linked Area / Luminaire',
                'Status',
                '',
              ].map((h, i) => (
                <span
                  key={i}
                  role={i === 2 ? 'button' : undefined}
                  tabIndex={i === 2 ? 0 : undefined}
                  aria-label={
                    i === 2
                      ? `Sort by due date, ${dueSort === 'asc' ? 'ascending' : 'descending'}`
                      : undefined
                  }
                  onClick={
                    i === 2
                      ? () => setDueSort((value) => (value === 'asc' ? 'desc' : 'asc'))
                      : undefined
                  }
                  onKeyDown={
                    i === 2
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setDueSort((value) => (value === 'asc' ? 'desc' : 'asc'));
                          }
                        }
                      : undefined
                  }
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: C.textFaint,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    position: 'relative',
                  }}
                >
                  {h}
                  {sizing.handle(i + 1, h || 'Actions')}
                </span>
              ))}
            </div>

            {/* Rows */}
            <div
              role="region"
              aria-label="Project actions"
              style={{ flex: 1, minWidth: 930, overflowY: 'auto' }}
            >
              {ACTIONS.length === 0 ? (
                <p style={{ padding: 20 }}>No actions match the current filters.</p>
              ) : null}
              {ACTIONS.map((action, idx) => {
                const checked = checkedIds.has(action.id);
                const selected = selectedId === action.id;
                return (
                  <div
                    key={action.id}
                    data-resizable-row
                    role="button"
                    tabIndex={0}
                    aria-label={action.title}
                    aria-pressed={selectedId === action.id}
                    onClick={() => b.select(action.id)}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        (event.key === 'Enter' || event.key === ' ')
                      ) {
                        event.preventDefault();
                        b.select(action.id);
                      }
                    }}
                    style={{
                      display: 'grid',
                      minWidth: 930,
                      gridTemplateColumns: columns,
                      ...sizing.style,
                      padding: '12px 14px',
                      borderBottom: idx < ACTIONS.length - 1 ? `1px solid ${C.border}` : 'none',
                      alignItems: 'center',
                      gap: 8,
                      background: selected ? C.blueLight : C.white,
                      borderLeft: selected ? `3px solid ${C.blue}` : '3px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {/* Checkbox */}
                    <div
                      role="checkbox"
                      tabIndex={0}
                      aria-label={`Select ${action.title}`}
                      aria-checked={checked}
                      onKeyDown={(event) => {
                        if (event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleCheck(action.id);
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCheck(action.id);
                      }}
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        border: `1.5px solid ${checked ? C.blue : C.grayBorder}`,
                        background: checked ? C.blue : C.white,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      {checked && <InlineGlyphs.SctCheck width="10" height="10" color="#fff" />}
                    </div>

                    {/* Action title + desc */}
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: C.text,
                          marginBottom: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {action.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: C.textSub,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {action.desc}
                      </div>
                    </div>

                    {/* Priority */}
                    <div>
                      <PriorityBadge level={action.priority} />
                    </div>

                    {/* Due date */}
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          color: action.dueColor,
                        }}
                      >
                        <IcoCalSmall />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{action.dueDate}</span>
                      </div>
                      <div style={{ fontSize: 11, color: action.dueColor, marginTop: 1 }}>
                        {action.dueSub}
                      </div>
                    </div>

                    {/* Owner */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <Avatar initials={action.ownerInitials} color={action.ownerColor} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                          {action.ownerName}
                        </div>
                        <div style={{ fontSize: 10, color: C.textFaint }}>{action.ownerRole}</div>
                      </div>
                    </div>

                    {/* Category */}
                    <CategoryCell
                      cat={action.category}
                      category={b.categories.find((c) => c.id === action.record.categoryId)}
                    />

                    {/* Linked area */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: C.text }}>
                        {action.linkedArea}
                      </div>
                      <div style={{ fontSize: 11, color: C.textFaint }}>{action.linkedSub}</div>
                    </div>

                    {/* Status */}
                    <div>
                      <StatusBadge status={action.status} />
                    </div>

                    {/* Arrow */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <IcoChevRight />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pagination footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 2px',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 12, color: C.textSub }}>
              Showing {b.total ? b.page * 6 + 1 : 0} to {b.page * 6 + ACTIONS.length} of {b.total}{' '}
              actions
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {[
                { label: '←', page: Math.max(0, b.page - 1), disabled: b.page === 0 },
                ...Array.from({ length: b.pages }, (_, i) => ({
                  label: String(i + 1),
                  page: i,
                  disabled: false,
                })),
                {
                  label: '→',
                  page: Math.min(b.pages - 1, b.page + 1),
                  disabled: b.page >= b.pages - 1,
                },
                { label: '»', page: b.pages - 1, disabled: b.page >= b.pages - 1 },
              ].map((p, i) => (
                <button
                  key={i}
                  aria-label={
                    p.label === '←'
                      ? 'Previous page'
                      : p.label === '→'
                        ? 'Next page'
                        : p.label === '»'
                          ? 'Last page'
                          : `Page ${p.label}`
                  }
                  disabled={p.disabled}
                  onClick={() => b.setPage(p.page)}
                  style={{
                    minWidth: 28,
                    height: 28,
                    borderRadius: 6,
                    border: `1px solid ${p.label === String(b.page + 1) ? C.teal : C.border}`,
                    background: p.label === String(b.page + 1) ? C.teal : C.white,
                    color: p.label === String(b.page + 1) ? '#fff' : C.textMid,
                    fontSize: 12,
                    fontWeight: p.label === String(b.page + 1) ? 700 : 400,
                    fontFamily: F,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Detail panel ─────────────────────────────────────────── */}
        {selectedAction && (
          <div
            role="region"
            aria-label="Action details"
            style={{
              width: '25%',
              minWidth: 260,
              overflowWrap: 'anywhere',
              flexShrink: 0,
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {/* Header */}
            <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${C.border}` }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>
                  {selectedAction.title}
                </span>
                <button
                  aria-label="Close action details"
                  onClick={() => b.select(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 3,
                    flexShrink: 0,
                  }}
                >
                  <IcoX />
                </button>
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <V4FilterSelect
                  label="Action status"
                  value={selectedAction.record.status}
                  options={(
                    ['Open', 'InProgress', 'Waiting', 'Completed', 'Cancelled'] as const
                  ).map((value) => ({ value, label: actionStatusLabel(value) }))}
                  disabled={b.pending}
                  onChange={(value) => {
                    if (['Open', 'InProgress', 'Waiting', 'Completed', 'Cancelled'].includes(value))
                      b.status(selectedAction.record, value as ProjectActionItem['status']);
                  }}
                  triggerStyle={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: C.blueLight,
                    border: `1px solid ${C.blueBorder}`,
                    color: C.blue,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                  chevron={<IcoChevDown />}
                />
              </div>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px' }}>
              {/* Details */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 7,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Details</span>
                <button
                  aria-label="Edit action details"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: 'var(--v4-accent-ink)',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: F,
                  }}
                  onClick={() =>
                    b.editText
                      ? b.editText(selectedAction.record, 'details')
                      : b.edit(selectedAction.record)
                  }
                >
                  Edit
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 10 }}>
                {[
                  {
                    label: 'Priority',
                    content: <PriorityBadge level={selectedAction.priority} />,
                  },
                  {
                    label: 'Due Date',
                    content: (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          color: C.orange,
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        <IcoCal />
                        {selectedAction.dueDate} ({selectedAction.dueSub})
                      </span>
                    ),
                  },
                  {
                    label: 'Owner',
                    content: (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Avatar initials={selectedAction.ownerInitials} color={C.blue} />
                        <span style={{ fontSize: 12 }}>
                          <span style={{ fontWeight: 600, color: C.text, display: 'block' }}>
                            {selectedAction.ownerName}
                          </span>
                          <span style={{ color: C.textFaint }}>{selectedAction.ownerRole}</span>
                        </span>
                      </span>
                    ),
                  },
                  {
                    label: 'Category',
                    content: (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 12,
                          color: C.textMid,
                        }}
                      >
                        <CategoryCell
                          cat={selectedAction.category}
                          category={b.categories.find(
                            (c) => c.id === selectedAction.record.categoryId,
                          )}
                        />
                      </span>
                    ),
                  },
                  {
                    label: 'Linked Area / Luminaire',
                    content: (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <InlineGlyphs.SctLink width="14" height="14" color={C.textSub} />
                        <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>
                          {selectedAction.linkedArea}
                          <br />
                          <span style={{ color: C.textFaint, fontWeight: 400 }}>
                            {selectedAction.linkedSub}
                          </span>
                        </span>
                      </span>
                    ),
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: C.textFaint,
                        width: 110,
                        flexShrink: 0,
                        paddingTop: 2,
                      }}
                    >
                      {row.label}
                    </span>
                    <div>{row.content}</div>
                  </div>
                ))}
              </div>

              {/* Notes */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Notes</span>
                <button
                  aria-label="Edit action notes"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: 'var(--v4-accent-ink)',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: F,
                  }}
                  onClick={() =>
                    b.editText
                      ? b.editText(selectedAction.record, 'notes')
                      : b.edit(selectedAction.record)
                  }
                >
                  Edit
                </button>
              </div>
              <p
                style={{
                  fontSize: 11,
                  color: C.textMid,
                  lineHeight: 1.5,
                  margin: '0 0 10px',
                  padding: '8px 10px',
                  background: C.bg,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                }}
              >
                {selectedAction.record.notes || 'No notes added.'}
              </p>

              {/* Linked Meeting */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Linked Meeting</span>
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: 'var(--v4-accent-ink)',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: F,
                  }}
                  onClick={b.meetings}
                  hidden={!linkedMeeting}
                >
                  View
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  background: C.bg,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  marginBottom: 10,
                }}
              >
                <IcoCal />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                    {b.meetingsState === 'loading'
                      ? 'Loading linked meetings…'
                      : b.meetingsState === 'error'
                        ? 'Linked meetings could not be loaded.'
                        : (linkedMeeting?.title ?? 'No linked meetings.')}
                  </div>
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 1 }}>
                    {linkedMeeting ? formatBusinessDateTime(linkedMeeting.startAt) : '—'}
                  </div>
                </div>
              </div>

              {/* Linked Comment */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Linked Comment</span>
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: 'var(--v4-accent-ink)',
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: F,
                  }}
                  disabled={!linkedComment}
                  hidden={!linkedComment}
                  onClick={b.comment}
                >
                  View
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '7px 10px',
                  background: C.bg,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  marginBottom: 0,
                }}
              >
                <IcoComment />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                    {linkedComment?.title ??
                      (b.selected?.reviewItemId ? 'Unavailable comment' : 'No linked comment.')}
                  </div>
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2 }}>
                    {linkedComment
                      ? `${formatBusinessDateTime(linkedComment.createdAt)} · ${linkedComment.authorNameSnapshot ?? '—'}`
                      : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div
              style={{
                padding: '12px 16px',
                borderTop: `1px solid ${C.border}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                flexShrink: 0,
              }}
            >
              <button
                disabled={b.pending}
                onClick={() =>
                  b.status(
                    selectedAction.record,
                    selectedAction.record.status === 'Completed' ||
                      selectedAction.record.status === 'Cancelled'
                      ? 'Open'
                      : 'Completed',
                  )
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  padding: '10px',
                  background: C.teal,
                  color: 'var(--v4-action-primary-foreground)',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: F,
                  cursor: 'pointer',
                }}
              >
                <IcoCheck />{' '}
                {selectedAction.record.status === 'Completed' ||
                selectedAction.record.status === 'Cancelled'
                  ? 'Reopen Action'
                  : 'Mark Complete'}
              </button>
              <button
                onClick={b.linked}
                disabled={
                  !selectedAction.record.luminaireId &&
                  !selectedAction.record.reviewItemId &&
                  !b.linkedMeetings.length
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  padding: '10px',
                  background: C.white,
                  color: C.textMid,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: F,
                  cursor: 'pointer',
                }}
              >
                Open Linked Record <IcoExternal />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
