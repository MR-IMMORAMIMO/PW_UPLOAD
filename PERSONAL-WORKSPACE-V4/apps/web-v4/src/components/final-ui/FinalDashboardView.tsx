import * as InlineGlyphs from '../common/SctIcons';
import { V4PagedRows } from '../common/V4PagedRows';
import { useState } from 'react';
import { V4FloatingWorkspace } from '../common/V4FloatingWorkspace';
import { V4FilterSelect } from '../common/V4FilterSelect';
import { V4Button } from '../common/V4Button';
import { useNavigate } from 'react-router-dom';
import { useDashboardData, type DashboardListItem } from './FinalDashboardData';
import { useV4WorkSession } from '../work-session/WorkSessionProvider';
import './referenceUtilities.css';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { C, GAP, SHADOW, DIM, RADIUS, LAYOUT } from './tokens';
import StatusChip from './ds/StatusChip';

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function fmtTime(s: number) {
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// StatusPill replaced by shared StatusChip from ds/StatusChip

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] font-semibold text-gray-700 w-7 text-right shrink-0">
        {pct}%
      </span>
      <div className="flex-1 h-[5px] rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/* ── Generic paper-open modal ──────────────────────────── */
function PaperModal({
  open,
  onClose,
  title,
  subtitle,
  iconBg,
  icon,
  children,
  footerLabel,
  footerAction,
  footerDisabled = false,
}: {
  open: boolean;
  origin: { x: number; y: number } | null;
  onClose: () => void;
  title: string;
  subtitle: string;
  iconBg: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  footerLabel?: string | undefined;
  footerAction?: () => void;
  footerDisabled?: boolean;
}) {
  return (
    <V4FloatingWorkspace
      open={open}
      title={title}
      description={subtitle}
      onRequestClose={onClose}
      panelClassName="v4-dashboard-paper"
      headerActions={
        <span style={{ background: iconBg, borderRadius: 8, padding: 8 }}>{icon}</span>
      }
      footer={
        footerLabel ? (
          <V4Button variant="primary" onClick={footerAction} disabled={footerDisabled}>
            {footerLabel}
          </V4Button>
        ) : null
      }
    >
      {children}
    </V4FloatingWorkspace>
  );
}

/* ── Modal content components ──────────────────────────── */
function AttentionModalContent() {
  const { ATTENTION } = useDashboardData();
  const [reason, setReason] = useState('all');
  const items = ATTENTION.filter((item) => reason === 'all' || item.status === reason);
  return (
    <div className="divide-y divide-gray-50">
      <V4FilterSelect
        label="Attention reason"
        value={reason}
        onChange={setReason}
        options={[
          { value: 'all', label: 'All reasons' },
          ...Array.from(new Set(ATTENTION.map((item) => item.status))).map((value) => ({
            value,
            label: value,
          })),
        ]}
      />
      {items.length === 0 ? (
        <p role="status" className="px-6 py-4">
          No items need your attention.
        </p>
      ) : null}
      <V4PagedRows label="ATTENTION pages">
        {items.map((a) => (
          <div
            key={a.key}
            role="button"
            tabIndex={0}
            onClick={a.open}
            onKeyDown={(event) => {
              if (event.key === 'Enter') a.open();
            }}
            className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors group cursor-pointer"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: a.iconBg }}
            >
              {a.iconType === 'clock' && <ClockSvg color={a.iconColor} />}
              {a.iconType === 'calendar' && <CalendarSvg color={a.iconColor} />}
              {a.iconType === 'sync' && <SyncSvg color={a.iconColor} bg={a.iconBg} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold truncate" style={{ color: C.text }}>
                {a.code}
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>
                {a.type} • {a.city}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div
                className="text-[12px] font-semibold whitespace-pre-line"
                style={{ color: a.statusColor }}
              >
                {a.status}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
                {a.due}
              </div>
            </div>
            <InlineGlyphs.SctNext
              width="14"
              height="14"
              className="shrink-0 group-hover:stroke-gray-400 transition-colors"
              color="#d1d5db"
            />
          </div>
        ))}
      </V4PagedRows>
    </div>
  );
}

function SimpleListContent({ items }: { items: DashboardListItem[] }) {
  return (
    <div className="divide-y divide-gray-50">
      {items.length === 0 ? (
        <p role="status" className="px-6 py-4">
          No items in this group.
        </p>
      ) : null}
      <V4PagedRows label="items pages">
        {items.map((item) => (
          <div
            key={item.key}
            role="button"
            tabIndex={0}
            onClick={item.open}
            onKeyDown={(event) => {
              if (event.key === 'Enter') item.open();
            }}
            className="flex items-center justify-between gap-3 px-6 py-4 hover:bg-gray-50 transition-colors group cursor-pointer"
          >
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate" style={{ color: C.text }}>
                {item.primary}
              </div>
              {item.secondary && (
                <div className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>
                  {item.secondary}
                </div>
              )}
            </div>
            <InlineGlyphs.SctNext
              width="14"
              height="14"
              className="shrink-0 group-hover:stroke-gray-400"
              color="#d1d5db"
            />
          </div>
        ))}
      </V4PagedRows>
    </div>
  );
}

function OperationsModalContent() {
  const { OPERATIONS_ALL } = useDashboardData();
  const [group, setGroup] = useState('all');
  return (
    <div className="divide-y divide-gray-100">
      <V4FilterSelect
        label="Operation group"
        value={group}
        onChange={setGroup}
        options={[
          { value: 'all', label: 'All groups' },
          ...OPERATIONS_ALL.map((section) => ({ value: section.section, label: section.section })),
        ]}
      />
      {OPERATIONS_ALL.filter((section) => group === 'all' || section.section === group).map(
        (section) => (
          <div key={section.section} className="px-6 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[13px] font-bold" style={{ color: C.text }}>
                {section.section}
              </span>
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: section.bg, color: section.color }}
              >
                {section.items.length}
              </span>
            </div>
            <div className="space-y-1">
              {section.items.length === 0 ? <p role="status">No items in this group.</p> : null}
              {section.items.map((item) => (
                <div
                  key={item.key}
                  role="button"
                  tabIndex={0}
                  onClick={item.open}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') item.open();
                  }}
                  className="flex items-center justify-between gap-3 py-2 px-2 hover:bg-gray-50 rounded-lg cursor-pointer group transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium truncate" style={{ color: C.textDark }}>
                      {item.primary}
                    </div>
                    {item.secondary && (
                      <div className="text-[11px]" style={{ color: C.textMuted }}>
                        {item.secondary}
                      </div>
                    )}
                  </div>
                  <InlineGlyphs.SctNext
                    width="13"
                    height="13"
                    className="shrink-0 group-hover:stroke-gray-400"
                    color="#d1d5db"
                  />
                </div>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

export default function FinalDashboardView() {
  const {
    ATTENTION,
    PROJECTS,
    OVERDUE_ALL,
    MEETINGS_ALL,
    BLOCKING_ALL,
    DELIVERABLES_ALL,
    dashboard,
    loading,
    error,
    retry,
    markReviewed,
  } = useDashboardData();
  const navigate = useNavigate();
  const workSession = useV4WorkSession();
  const [sessionProjectId, setSessionProjectId] = useState('');
  const secs = workSession.elapsedSeconds;
  const running = workSession.state === 'RUNNING';
  const unavailable =
    !workSession.active ||
    workSession.statusUnavailable ||
    workSession.pausePending ||
    workSession.resumePending ||
    workSession.stopPending;
  const sessionLabel = workSession.statusLoading
    ? 'Loading session…'
    : workSession.statusUnavailable
      ? 'Session unavailable'
      : running
        ? 'Running'
        : workSession.state === 'PAUSED'
          ? 'Paused'
          : 'No active session';
  const [bannerOpen, setBannerOpen] = useState(true);
  const toggleSession = () => {
    if (running) workSession.pause();
    else workSession.resume();
  };

  const [modal, setModal] = useState<{ type: string; origin: { x: number; y: number } } | null>(
    null,
  );

  const openModal = (type: string) => (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setModal({ type, origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
  };
  const closeModal = () => setModal(null);

  return (
    <div
      className="final-ui-reference flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden"
      style={{ background: C.pageBg, position: 'relative' }}
    >
      {/* ── Work session banner ─────────────────────────────── */}
      <div
        className="flex items-center gap-0 px-5 shrink-0 mx-4"
        style={{
          marginTop: LAYOUT.sectionGap,
          background: C.white,
          display: workSession.active ? 'flex' : 'none',
          height: bannerOpen ? DIM.bannerHeight : 32,
          borderRadius: RADIUS.section,
          border: `1px solid ${C.border}`,
          boxShadow: SHADOW.card,
        }}
      >
        <div className="flex items-center gap-1.5 pr-4 border-r border-gray-200">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: C.green }} />
          <span
            className="text-[11px] font-semibold tracking-widest uppercase"
            style={{ color: C.textMuted }}
          >
            Work Session
          </span>
        </div>
        <div
          className="flex items-center gap-2 pl-4"
          style={{ visibility: bannerOpen ? 'visible' : 'hidden' }}
        >
          <span className="w-4 h-4 flex items-center justify-center">
            <InlineGlyphs.SctWorkSession width="14" height="14" />
          </span>
          <span className="text-[13px] font-semibold" style={{ color: C.text }}>
            {workSession.activeProject?.projectName ?? 'No active project'}
          </span>
          <span className="text-[13px] font-mono tabular-nums" style={{ color: C.textMid }}>
            {fmtTime(secs)}
          </span>
          <span className="text-[13px] font-semibold" style={{ color: C.greenRunning }}>
            {sessionLabel}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            disabled={unavailable}
            onClick={toggleSession}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium border transition-colors hover:bg-gray-50"
            style={{ borderColor: C.border, color: C.textDark }}
          >
            {running ? <InlineGlyphs.SctPause size={11} /> : <InlineGlyphs.SctStart size={11} />}
            {running ? 'Pause' : 'Resume'}
          </button>
          <button
            disabled={unavailable}
            onClick={workSession.stop}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] font-medium border transition-colors hover:bg-red-50"
            style={{ borderColor: C.redBorder, color: C.red }}
          >
            <InlineGlyphs.SctEnd width="11" height="11" />
            Stop
          </button>
          <button
            aria-label={bannerOpen ? 'Collapse session banner' : 'Expand session banner'}
            aria-expanded={bannerOpen}
            onClick={() => setBannerOpen((open) => !open)}
            className="transition-colors"
            style={{ color: C.textMuted, paddingTop: 9, paddingBottom: 9 }}
          >
            <InlineGlyphs.SctCollapse width="16" height="16" color="currentColor" />
          </button>
        </div>
      </div>

      {/* ── Page header ─────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 bg-white px-6 py-3 mx-4"
        style={{
          marginTop: LAYOUT.sectionGap,
          borderRadius: DIM.sectionRadius,
          border: `1px solid ${C.border}`,
          boxShadow: SHADOW.card,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 flex items-center justify-center shrink-0"
            style={{ background: C.tealLight, borderRadius: 26 }}
          >
            <InlineGlyphs.SctDashboard width="20" height="20" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold leading-tight" style={{ color: C.text }}>
              Dashboard
            </h1>
            <p className="text-[13px] mt-0.5" style={{ color: C.textMuted }}>
              Your command center for what matters today.
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <button
            onClick={() => navigate('/projects')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border text-[13px] font-medium transition-colors hover:bg-gray-50"
            style={{ borderColor: C.border, color: C.textDark }}
          >
            <InlineGlyphs.SctNext width="15" height="15" color="currentColor" />
            View All Projects
          </button>
          <button
            onClick={(event) => {
              const r = event.currentTarget.getBoundingClientRect();
              navigate('/new', {
                state: {
                  origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
                  background: '/dashboard',
                },
              });
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors hover:opacity-90"
            style={{ background: C.teal }}
          >
            <InlineGlyphs.SctAdd width="13" height="13" color="currentColor" />
            New Project
          </button>
        </div>
      </div>

      {error || workSession.error ? (
        <p role="alert">
          {error || workSession.error}
          <button onClick={retry}>Retry</button>
        </p>
      ) : null}
      {loading ? <p role="status">Loading dashboard…</p> : null}
      {/* ── Body ────────────────────────────────────────────── */}
      <div
        className="flex-1 min-h-0 flex flex-col overflow-hidden px-4 py-3"
        style={{ gap: LAYOUT.sectionGap }}
      >
        {/* Stat cards — 4-column grid; sparklines become hidden when cards are narrower than ~240px */}
        <div className="grid grid-cols-4 shrink-0 min-w-0" style={{ gap: LAYOUT.sectionGap }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate('/projects?dashboard=active')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
            className="kpi-card-enter bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-4 btn-pressable"
            style={{ boxShadow: SHADOW.card, animationDelay: '0ms' }}
          >
            <div
              className="w-11 h-11 flex items-center justify-center shrink-0"
              style={{ background: C.kpiTeal, borderRadius: RADIUS.icon }}
            >
              <InlineGlyphs.SctWorkload width="26" height="26" color="white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium mb-0.5" style={{ color: C.textMuted }}>
                Active Projects
              </div>
              <div className="text-[28px] font-bold leading-none mb-1" style={{ color: C.text }}>
                {dashboard.kpis[0]?.count ?? 0}
              </div>
              <div className="text-[12px]" style={{ color: C.textMuted }}>
                Open projects
              </div>
            </div>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate('/projects?dashboard=dueThisWeek')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
            className="kpi-card-enter bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-4 btn-pressable"
            style={{ boxShadow: SHADOW.card, animationDelay: '80ms' }}
          >
            <div
              className="w-11 h-11 flex items-center justify-center shrink-0"
              style={{ background: C.kpiOrange, borderRadius: RADIUS.icon }}
            >
              <InlineGlyphs.SctNewProjects width="26" height="26" color="white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium mb-0.5" style={{ color: C.textMuted }}>
                Due This Week
              </div>
              <div className="text-[28px] font-bold leading-none mb-1" style={{ color: C.text }}>
                {dashboard.kpis[1]?.count ?? 0}
              </div>
              <div className="text-[12px]" style={{ color: C.textMuted }}>
                Due in 7 days
              </div>
            </div>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate('/projects?dashboard=revisionRequired')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
            className="kpi-card-enter bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-4 btn-pressable"
            style={{ boxShadow: SHADOW.card, animationDelay: '160ms' }}
          >
            <div
              className="w-11 h-11 flex items-center justify-center shrink-0"
              style={{ background: C.kpiPurple, borderRadius: RADIUS.icon }}
            >
              <InlineGlyphs.SctSuccess width="26" height="26" color="white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium mb-0.5" style={{ color: C.textMuted }}>
                Revision Required
              </div>
              <div className="text-[28px] font-bold leading-none mb-1" style={{ color: C.text }}>
                {dashboard.kpis[2]?.count ?? 0}
              </div>
              <div className="text-[12px]" style={{ color: C.textMuted }}>
                Awaiting your revisions
              </div>
            </div>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate('/projects?dashboard=clientReview')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
            className="kpi-card-enter bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-4 btn-pressable"
            style={{ boxShadow: SHADOW.card, animationDelay: '240ms' }}
          >
            <div
              className="w-11 h-11 flex items-center justify-center shrink-0"
              style={{ background: C.kpiBlue, borderRadius: RADIUS.icon }}
            >
              <InlineGlyphs.SctOverdue width="26" height="26" color="white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium mb-0.5" style={{ color: C.textMuted }}>
                Client Review
              </div>
              <div className="text-[28px] font-bold leading-none mb-1" style={{ color: C.text }}>
                {dashboard.kpis[3]?.count ?? 0}
              </div>
              <div className="text-[12px]" style={{ color: C.textMuted }}>
                Awaiting client feedback
              </div>
            </div>
          </div>
        </div>

        {/* Middle row — work session column is bounded: shrinks at 1366px, stays capped at 2560px */}
        <div
          className="grid min-h-0 flex-1"
          style={{
            gridTemplateColumns: `1fr 1.25fr clamp(280px, 21.9vw, 380px)`,
            gap: LAYOUT.sectionGap,
          }}
        >
          {/* Need Attention */}
          <div
            className="bg-white rounded-xl border border-gray-100 flex flex-col overflow-hidden min-h-0"
            style={{ boxShadow: SHADOW.card, gap: 0, rowGap: 0, columnGap: 0 }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <InlineGlyphs.SctWarning width="17" height="17" color={C.orange} />
                <span className="text-[14px] font-bold" style={{ color: C.text }}>
                  Need Attention
                </span>
              </div>
              <button
                onClick={openModal('attention')}
                className="text-[12px] font-semibold hover:underline"
                style={{ color: 'var(--v4-accent-ink)' }}
              >
                View all ({ATTENTION.length})
              </button>
            </div>
            <div
              className="flex-1 divide-y divide-gray-50 overflow-hidden"
              style={{ paddingTop: 32 }}
            >
              {ATTENTION.length === 0 ? (
                <p role="status" className="px-4 py-3 text-[13px]" style={{ color: C.textMuted }}>
                  No items need your attention.
                </p>
              ) : null}
              <V4PagedRows bounded label="ATTENTION pages">
                {ATTENTION.map((a) => (
                  <div
                    key={a.key}
                    role="button"
                    tabIndex={0}
                    onClick={a.open}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') a.open();
                    }}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group"
                    style={{ height: DIM.rowHeight }}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: a.iconBg }}
                    >
                      {a.iconType === 'clock' && <ClockSvg color={a.iconColor} />}
                      {a.iconType === 'calendar' && <CalendarSvg color={a.iconColor} />}
                      {a.iconType === 'sync' && <SyncSvg color={a.iconColor} bg={a.iconBg} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold truncate" style={{ color: C.text }}>
                        {a.code}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
                        {a.type} • {a.city}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className="text-[11px] font-semibold leading-tight whitespace-pre-line text-right"
                        style={{ color: a.statusColor }}
                      >
                        {a.status}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: C.textMuted }}>
                        {a.due}
                      </div>
                    </div>
                    <InlineGlyphs.SctNext
                      width="14"
                      height="14"
                      className="shrink-0 group-hover:stroke-gray-400 transition-colors"
                      color="#d1d5db"
                    />
                  </div>
                ))}
              </V4PagedRows>
            </div>
            <div className="px-4 py-2.5 border-t border-gray-100 text-center shrink-0">
              <button
                onClick={openModal('attention')}
                className="text-[12px] font-semibold hover:underline"
                style={{ color: 'var(--v4-accent-ink)' }}
              >
                View all attention items
              </button>
            </div>
          </div>

          {/* Active Projects */}
          <div
            className="bg-white rounded-xl border border-gray-100 flex flex-col overflow-hidden min-h-0"
            style={{ boxShadow: SHADOW.card, gap: 0, rowGap: 0, columnGap: 0 }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-2">
                <InlineGlyphs.SctProjects width="17" height="17" color={C.teal} />
                <span className="text-[14px] font-bold" style={{ color: C.text }}>
                  Active Projects
                </span>
              </div>
              <button
                onClick={() => navigate('/projects?dashboard=active')}
                className="text-[12px] font-semibold hover:underline"
                style={{ color: 'var(--v4-accent-ink)' }}
              >
                View all ({PROJECTS.length})
              </button>
            </div>
            <div
              className="grid px-4 py-2 border-b border-gray-100"
              style={{ gridTemplateColumns: '1fr 90px 110px 100px 20px' }}
            >
              {['PROJECT', 'STATUS', 'DUE DATE ↓', 'PROGRESS', ''].map((h, i) => (
                <div
                  key={i}
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: C.textMuted }}
                >
                  {h}
                </div>
              ))}
            </div>
            <div className="flex-1 divide-y divide-gray-50 overflow-hidden">
              <V4PagedRows bounded label="PROJECTS pages">
                {PROJECTS.map((p) => (
                  <div
                    key={p.key}
                    role="button"
                    tabIndex={0}
                    onClick={p.open}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') p.open();
                    }}
                    className="grid items-center px-4 py-2.5 hover:bg-gray-50 transition-colors group"
                    style={{
                      gridTemplateColumns: '1fr 90px 110px 100px 20px',
                      height: DIM.rowHeight,
                    }}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-[12px] font-semibold truncate" style={{ color: C.text }}>
                        {p.id}
                      </div>
                      <div className="text-[10px] mt-0.5 truncate" style={{ color: C.textMuted }}>
                        {p.sub} • {p.city}
                      </div>
                    </div>
                    <div>
                      <StatusChip status={p.status} />
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold" style={{ color: C.orange }}>
                        {p.due}
                      </div>
                      <div className="text-[10px]" style={{ color: C.textMuted }}>
                        {p.days}
                      </div>
                    </div>
                    <div>
                      <ProgressBar
                        pct={p.pct}
                        color={
                          p.status === 'In Progress'
                            ? C.teal
                            : p.status === 'Planning'
                              ? C.textFaint
                              : C.orange
                        }
                      />
                    </div>
                    <InlineGlyphs.SctNext
                      width="14"
                      height="14"
                      className="shrink-0 group-hover:stroke-gray-400 transition-colors"
                      color="#d1d5db"
                    />
                  </div>
                ))}
              </V4PagedRows>
            </div>
            <div className="px-4 py-2.5 border-t border-gray-100 text-center shrink-0">
              <button
                onClick={() => navigate('/projects?dashboard=active')}
                className="text-[12px] font-semibold hover:underline"
                style={{ color: 'var(--v4-accent-ink)' }}
              >
                View all active projects
              </button>
            </div>
          </div>

          {/* Work Session */}
          <div
            className="bg-white rounded-xl border border-gray-100 flex flex-col overflow-hidden min-h-0"
            style={{
              boxShadow: SHADOW.card,
              width: 'clamp(280px, 21.9vw, 380px)',
              flexShrink: 0,
              gap: 0,
              rowGap: 0,
              columnGap: 0,
            }}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
              <InlineGlyphs.SctWorkSession width="16" height="16" color={C.teal} />
              <span className="text-[14px] font-bold" style={{ color: C.text }}>
                Work Session
              </span>
            </div>
            {workSession.active ? (
              <div
                className="flex flex-col"
                style={{
                  background: 'var(--v4-surface-raised)',
                  borderRadius: 15,
                  margin: GAP.lg,
                  border: '1px solid var(--v4-border)',
                  paddingTop: 23,
                  paddingBottom: 23,
                  paddingLeft: 28,
                  paddingRight: 28,
                  height: 204,
                  marginTop: 2,
                  flexGrow: 0,
                  flexBasis: 'auto',
                  gap: 0,
                  rowGap: 0,
                  columnGap: 0,
                }}
              >
                <div>
                  <div className="text-[13px] font-bold" style={{ color: C.text }}>
                    {workSession.activeProject?.projectName ?? 'No active project'}
                  </div>
                  <div className="text-[11px] mt-0.5 truncate" style={{ color: C.textMuted }}>
                    {workSession.activeProject?.projectCode ?? '—'}
                  </div>
                  <div className="text-[12px] mt-1" style={{ color: C.textMid }}>
                    {workSession.activeProject
                      ? `${workSession.activeProject.status} – ${workSession.activeProject.designStage}`
                      : '—'}
                  </div>
                </div>
                <div style={{ marginTop: 0 }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: C.green }}
                    />
                    <span className="text-[11px]" style={{ color: C.textMuted }}>
                      {sessionLabel}
                    </span>
                  </div>
                  <div
                    className="text-[30px] font-bold tabular-nums leading-none"
                    style={{ color: 'var(--v4-accent-ink)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {fmtTime(secs)}
                  </div>
                </div>
                <div
                  className="flex"
                  style={{
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    gap: `${GAP.base}px ${GAP.sm}px`,
                    rowGap: GAP.base,
                    marginTop: 0,
                    height: 79,
                  }}
                >
                  <button
                    disabled={unavailable}
                    onClick={toggleSession}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors hover:bg-gray-50"
                    style={{ borderColor: C.border, color: C.textDark }}
                  >
                    {running ? (
                      <InlineGlyphs.SctPause size={11} />
                    ) : (
                      <InlineGlyphs.SctStart size={11} />
                    )}
                    {running ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    disabled={unavailable}
                    onClick={workSession.stop}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors hover:bg-red-50"
                    style={{ borderColor: C.redBorder, color: C.red }}
                  >
                    <InlineGlyphs.SctEnd width="11" height="11" />
                    Stop
                  </button>
                  <button
                    onClick={openModal('session')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors hover:bg-gray-50"
                    style={{ borderColor: C.border, color: C.textDark }}
                  >
                    <InlineGlyphs.SctPreview width="12" height="12" color="currentColor" />
                    View
                  </button>
                </div>
              </div>
            ) : (
              <div className="v4-dashboard-idle-session">
                <p>{sessionLabel}</p>
                <V4FilterSelect
                  label="Project for work session"
                  value={sessionProjectId}
                  onChange={setSessionProjectId}
                  options={[
                    { value: '', label: 'Choose a project' },
                    ...dashboard.activeProjects.map((project) => ({
                      value: project.id,
                      label: `${project.projectName} · ${project.projectCode}`,
                    })),
                  ]}
                />
                <V4Button
                  disabled={
                    !sessionProjectId ||
                    workSession.startPending ||
                    workSession.statusLoading ||
                    workSession.statusUnavailable
                  }
                  onClick={() => workSession.start(sessionProjectId)}
                >
                  <InlineGlyphs.SctStart size={16} />{' '}
                  {workSession.startPending ? 'Starting…' : 'Start Session'}
                </V4Button>
                {workSession.error ? <p role="alert">{workSession.error}</p> : null}
              </div>
            )}
            <div
              className="rounded-xl p-3 flex items-start gap-2.5"
              style={{
                background: C.tealLight,
                border: `1px solid ${C.tealBorder}`,
                marginTop: 'auto',
                marginRight: 15,
                marginBottom: 15,
                marginLeft: 15,
                height: 96,
                alignItems: 'center',
                justifyContent: 'flex-start',
              }}
            >
              <InlineGlyphs.SctInfo
                width="16"
                height="16"
                className="shrink-0 mt-0.5"
                color={C.teal}
              />
              <div>
                <div className="text-[12px] font-semibold" style={{ color: C.text }}>
                  Track your time accurately
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: C.textMid }}>
                  Your session is synced across all project pages.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Operations */}
        <div
          className="bg-white rounded-xl border border-gray-100 overflow-hidden shrink-0"
          style={{ boxShadow: SHADOW.card }}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <InlineGlyphs.SctActions width="16" height="16" color={C.textMid} />
              <span className="text-[14px] font-bold" style={{ color: C.text }}>
                Operations
              </span>
            </div>
            <button
              onClick={openModal('operations')}
              className="text-[12px] font-semibold hover:underline"
              style={{ color: 'var(--v4-accent-ink)' }}
            >
              View all operations
            </button>
          </div>
          <div className="grid grid-cols-4 divide-x divide-gray-100">
            {/* Overdue Actions */}
            <div className="relative p-4 pb-8">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <InlineGlyphs.SctOverdue width="15" height="15" color={C.red} />
                  <button
                    onClick={openModal('overdue')}
                    className="text-[13px] font-bold hover:underline"
                    style={{ color: C.text }}
                  >
                    Overdue Actions
                  </button>
                </div>
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: C.redLight, color: C.red }}
                >
                  {OVERDUE_ALL.length}
                </span>
              </div>
              <div className="space-y-2">
                {OVERDUE_ALL.slice(0, 2).map((item) => (
                  <div
                    key={item.key}
                    role="button"
                    tabIndex={0}
                    onClick={item.open}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') item.open();
                    }}
                    className="flex items-center justify-between gap-1 py-1 hover:bg-gray-50 rounded -mx-1 px-1 cursor-pointer group transition-colors"
                  >
                    <span className="text-[11px] truncate" style={{ color: C.textDark }}>
                      {item.primary}
                    </span>
                    <InlineGlyphs.SctNext
                      width="13"
                      height="13"
                      className="shrink-0 group-hover:stroke-gray-400"
                      color="#d1d5db"
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={openModal('overdue')}
                className="absolute bottom-3 left-4 text-[11px] font-semibold hover:underline"
                style={{ color: 'var(--v4-accent-ink)' }}
              >
                {Math.max(0, OVERDUE_ALL.length - 2)} more
              </button>
            </div>

            {/* Upcoming Meetings */}
            <div className="relative p-4 pb-8">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <InlineGlyphs.SctMeetings width="15" height="15" color={C.blue} />
                  <button
                    onClick={openModal('meetings')}
                    className="text-[13px] font-bold hover:underline"
                    style={{ color: C.text }}
                  >
                    Upcoming Meetings
                  </button>
                </div>
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: C.blueLight, color: C.blueAlt }}
                >
                  {MEETINGS_ALL.length}
                </span>
              </div>
              <div className="space-y-2">
                {MEETINGS_ALL.slice(0, 2).map((m) => (
                  <div
                    key={m.key}
                    role="button"
                    tabIndex={0}
                    onClick={m.open}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') m.open();
                    }}
                    className="flex items-center justify-between gap-2 py-1 hover:bg-gray-50 rounded -mx-1 px-1 cursor-pointer group transition-colors"
                  >
                    <div className="min-w-0">
                      <div
                        className="text-[11px] font-medium truncate"
                        style={{ color: C.textDark }}
                      >
                        {m.name}
                      </div>
                      <div className="text-[10px]" style={{ color: C.textMuted }}>
                        {m.dt}
                      </div>
                    </div>
                    <InlineGlyphs.SctNext
                      width="13"
                      height="13"
                      className="shrink-0 group-hover:stroke-gray-400"
                      color="#d1d5db"
                    />
                  </div>
                ))}
              </div>
              <button
                onClick={openModal('meetings')}
                className="absolute bottom-3 left-4 text-[11px] font-semibold hover:underline"
                style={{ color: 'var(--v4-accent-ink)' }}
              >
                {Math.max(0, MEETINGS_ALL.length - 2)} more
              </button>
            </div>

            {/* Blocking Requirements */}
            <div className="relative p-4 pb-8">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <InlineGlyphs.SctRequirements width="15" height="15" color={C.orange} />
                  <button
                    onClick={openModal('blocking')}
                    className="text-[13px] font-bold hover:underline"
                    style={{ color: C.text }}
                  >
                    Blocking Requirements
                  </button>
                </div>
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: C.orangeLight2, color: C.orangeAlt }}
                >
                  {BLOCKING_ALL.length}
                </span>
              </div>
              <div className="space-y-2">
                {BLOCKING_ALL.slice(0, 2).map((b) => (
                  <div
                    key={b.key}
                    role="button"
                    tabIndex={0}
                    onClick={b.open}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') b.open();
                    }}
                    className="flex items-start justify-between gap-1 py-1 hover:bg-gray-50 rounded -mx-1 px-1 cursor-pointer group transition-colors"
                  >
                    <div className="min-w-0">
                      <div
                        className="text-[11px] font-medium truncate"
                        style={{ color: C.textDark }}
                      >
                        {b.id}
                      </div>
                      <div className="text-[10px]" style={{ color: C.textMuted }}>
                        {b.note}
                      </div>
                    </div>
                    <InlineGlyphs.SctNext
                      width="13"
                      height="13"
                      className="shrink-0 mt-0.5 group-hover:stroke-gray-400"
                      color="#d1d5db"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Upcoming Deliverables */}
            <div className="relative p-4 pb-8">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <InlineGlyphs.SctDeliverables width="15" height="15" color={C.indigo} />
                  <button
                    onClick={openModal('deliverables')}
                    className="text-[13px] font-bold hover:underline"
                    style={{ color: C.text }}
                  >
                    Upcoming Deliverables
                  </button>
                </div>
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: C.indigoLight, color: C.indigoAlt }}
                >
                  {DELIVERABLES_ALL.length}
                </span>
              </div>
              <div className="space-y-2">
                {DELIVERABLES_ALL.slice(0, 2).map((d) => (
                  <div
                    key={d.key}
                    role="button"
                    tabIndex={0}
                    onClick={d.open}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') d.open();
                    }}
                    className="flex items-center justify-between gap-2 py-1 hover:bg-gray-50 rounded -mx-1 px-1 cursor-pointer group transition-colors"
                  >
                    <span
                      className="text-[11px] font-medium truncate"
                      style={{ color: C.textDark }}
                    >
                      {d.id}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px]" style={{ color: C.textMuted }}>
                        {d.date}
                      </span>
                      <InlineGlyphs.SctNext
                        width="13"
                        height="13"
                        className="group-hover:stroke-gray-400"
                        color="#d1d5db"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={openModal('deliverables')}
                className="absolute bottom-3 left-4 text-[11px] font-semibold hover:underline"
                style={{ color: 'var(--v4-accent-ink)' }}
              >
                {Math.max(0, DELIVERABLES_ALL.length - 2)} more
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 pb-2">
          <InlineGlyphs.SctInfo width="15" height="15" color={C.textMuted} />
          <span className="text-[11px]" style={{ color: C.textMuted }}>
            All dates are based on Asia/Dubai timezone. Keep your project information and due dates
            up to date.
          </span>
        </div>
      </div>

      {/* ── Paper modals ───────────────────────────────────── */}
      <PaperModal
        open={modal?.type === 'session'}
        origin={modal?.origin ?? null}
        onClose={closeModal}
        title="Work Session Details"
        subtitle={sessionLabel}
        iconBg={C.tealLight}
        icon={<InlineGlyphs.SctWorkSession size={17} />}
        footerLabel={workSession.active ? 'Open Project' : undefined}
        footerAction={() => {
          if (workSession.active) navigate(`/projects/${workSession.active.projectId}/summary`);
        }}
      >
        {workSession.active ? (
          <dl className="px-6 py-4 space-y-3">
            <div>
              <dt>Project</dt>
              <dd>{workSession.activeProject?.projectName ?? 'Project unavailable'}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{formatBusinessDateTime(workSession.active.startedAt)}</dd>
            </div>
            <div>
              <dt>Working time</dt>
              <dd>{fmtTime(secs)}</dd>
            </div>
            <div>
              <dt>Completed pauses</dt>
              <dd>{fmtTime(Math.floor(workSession.active.accumulatedPausedMs / 1000))}</dd>
            </div>
            {workSession.active.pausedAt ? (
              <div>
                <dt>Current pause started</dt>
                <dd>{formatBusinessDateTime(workSession.active.pausedAt)}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p role="status">No active session.</p>
        )}
      </PaperModal>
      <PaperModal
        open={modal?.type === 'blocking'}
        origin={modal?.origin ?? null}
        onClose={closeModal}
        title="Blocking Requirements"
        subtitle={`${BLOCKING_ALL.length} requirements need attention`}
        iconBg={C.orangeLight}
        icon={<InlineGlyphs.SctRequirements size={17} />}
      >
        <SimpleListContent
          items={BLOCKING_ALL.map((item) => ({ ...item, primary: item.id, secondary: item.note }))}
        />
      </PaperModal>
      <PaperModal
        open={modal?.type === 'attention'}
        origin={modal?.type === 'attention' ? modal.origin : null}
        onClose={closeModal}
        title="Need Attention"
        subtitle={`${ATTENTION.length} items require your review`}
        iconBg={C.orangeLight}
        footerLabel="Mark All as Reviewed"
        footerAction={markReviewed}
        footerDisabled={ATTENTION.length === 0}
        icon={<InlineGlyphs.SctWarning width="17" height="17" color={C.orange} />}
      >
        <AttentionModalContent />
      </PaperModal>

      <PaperModal
        open={modal?.type === 'operations'}
        origin={modal?.type === 'operations' ? modal.origin : null}
        onClose={closeModal}
        title="All Operations"
        subtitle="Overview of all active operational items"
        iconBg={C.modalBg}
        icon={<InlineGlyphs.SctActions width="16" height="16" color={C.textMid} />}
      >
        <OperationsModalContent />
      </PaperModal>

      <PaperModal
        open={modal?.type === 'overdue'}
        origin={modal?.type === 'overdue' ? modal.origin : null}
        onClose={closeModal}
        title="Overdue Actions"
        subtitle={`${OVERDUE_ALL.length} items need immediate attention`}
        iconBg={C.redLight}
        icon={<InlineGlyphs.SctOverdue width="15" height="15" color={C.red} />}
      >
        <SimpleListContent items={OVERDUE_ALL} />
      </PaperModal>

      <PaperModal
        open={modal?.type === 'meetings'}
        origin={modal?.type === 'meetings' ? modal.origin : null}
        onClose={closeModal}
        title="Upcoming Meetings"
        subtitle={`${MEETINGS_ALL.length} scheduled meetings`}
        iconBg={C.blueLight}
        icon={<InlineGlyphs.SctMeetings width="15" height="15" color={C.blueAlt} />}
      >
        <SimpleListContent
          items={MEETINGS_ALL.map((m) => ({ ...m, primary: m.name, secondary: m.dt }))}
        />
      </PaperModal>

      <PaperModal
        open={modal?.type === 'deliverables'}
        origin={modal?.type === 'deliverables' ? modal.origin : null}
        onClose={closeModal}
        title="Upcoming Deliverables"
        subtitle={`${DELIVERABLES_ALL.length} deliverables due`}
        iconBg={C.indigoLight}
        icon={<InlineGlyphs.SctDeliverables width="15" height="15" color={C.indigoAlt} />}
      >
        <SimpleListContent
          items={DELIVERABLES_ALL.map((d) => ({ ...d, primary: d.id, secondary: d.date }))}
        />
      </PaperModal>
    </div>
  );
}

/* ── inline SVG icons for Need Attention ────────────────── */
function ClockSvg({ color }: { color: string }) {
  return <InlineGlyphs.SctDuration width="18" height="18" color={color} />;
}
function CalendarSvg({ color }: { color: string }) {
  return <InlineGlyphs.SctDate width="18" height="18" color={color} />;
}
function SyncSvg({ color, bg }: { color: string; bg: string }) {
  void bg;
  return <InlineGlyphs.SctRefresh width="18" height="18" color={color} />;
}
