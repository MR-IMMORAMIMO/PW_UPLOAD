import { useResizableGridColumns } from '../common/useResizableGridColumns';
import * as CustomGlyphs from '../common/SctIcons';
import React, { useState, useRef } from 'react';
import { C, SHADOW, RADIUS, LAYOUT } from './tokens';
import type { CanonicalRevisionRecord, CanonicalOutputPresenceRecord } from '@scli/domain';
import {
  buildCompatibilitySummary,
  sourceDisplay,
  formatIsoDateTime,
  type RevisionRow,
  type RevisionKpi,
  type RevisionFilters,
  DATE_FILTER_OPTIONS,
  emptyRevisionFilters,
  type RevisionsTab,
} from '../../pages/project-revisions/revisionsViewModel';
import type { ProjectWorkspace } from '@scli/domain';
import { V4AnchoredSurface } from '../interaction/V4AnchoredSurface';
import { V4FilterSelect } from '../common/V4FilterSelect';
export interface FinalRevisionsBinding {
  phase: string;
  setPhase: (phase: string) => void;
  rows: RevisionRow[];
  allRows: RevisionRow[];
  workspace: ProjectWorkspace | null;
  outputs: CanonicalOutputPresenceRecord[];
  deliverables: import('@scli/domain').RevisionDeliverable[];
  openDeliverable: (item: import('@scli/domain').RevisionDeliverable) => void;
  attentionOnly: boolean;
  setAttentionOnly: (value: boolean) => void;
  selected: CanonicalRevisionRecord | null;
  select: (item: CanonicalRevisionRecord) => void;
  close: () => void;
  details: (item: CanonicalRevisionRecord) => void;
  kpis: RevisionKpi;
  completed: number;
  tab: RevisionsTab;
  setTab: (tab: RevisionsTab) => void;
  filters: RevisionFilters;
  setFilters: (filters: RevisionFilters) => void;
  options: { lifecycles: string[]; sources: string[]; createdBy: string[] };
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  create: () => void;
  createPending: boolean;
  exportReport: () => void;
  menu: React.ReactNode;
  otherTab: React.ReactNode;
  openOutput: (output: CanonicalOutputPresenceRecord) => void;
  notice: React.ReactNode;
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');

// ── shared ────────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: C.white,
  borderRadius: RADIUS.card,
  border: `1px solid ${C.border}`,
  boxShadow: SHADOW.card,
};

const G = LAYOUT.sectionGap; // 15px

// ── icons ─────────────────────────────────────────────────────────────────────

const IcoRevisions = () => (
  <CustomGlyphs.SctRevisions size="28" style={{ color: 'currentColor' }} />
);
const IcoKpiRevision = () => (
  <CustomGlyphs.SctRevisions size="22" style={{ color: 'currentColor' }} />
);
const IcoKpiLatest = () => <CustomGlyphs.SctLive size="22" style={{ color: 'currentColor' }} />;
const IcoKpiOutputs = () => (
  <CustomGlyphs.SctDeliverables size="22" style={{ color: 'currentColor' }} />
);
const IcoKpiAttention = () => (
  <CustomGlyphs.SctWarning size="22" style={{ color: 'currentColor' }} />
);
const IcoKpiCompleted = () => (
  <CustomGlyphs.SctSuccess size="22" style={{ color: 'currentColor' }} />
);
const IcoChevRight = ({ color = C.textMid, size = 13 }: { color?: string; size?: number }) => (
  <CustomGlyphs.SctNext size={size} style={{ color: color }} />
);
const IcoChevDown = ({ color = C.textMid }: { color?: string }) => (
  <CustomGlyphs.SctExpand size="12" style={{ color: color }} />
);
const IcoSearch = () => <CustomGlyphs.SctSearch size="13" style={{ color: C.textMid }} />;

const IcoClose = () => <CustomGlyphs.SctClose size="14" style={{ color: C.textMid }} />;
const IcoDoc = () => <CustomGlyphs.SctFile size="13" style={{ color: C.textMid }} />;
const IcoDocDetail = () => <CustomGlyphs.SctFile size="36" style={{ color: 'currentColor' }} />;
const IcoExport = () => <CustomGlyphs.SctExport size="14" style={{ color: C.text }} />;
const IcoPlus = () => <CustomGlyphs.SctAdd size="13" style={{ color: 'white' }} />;
const IcoLock = () => <CustomGlyphs.SctLocked size="11" style={{ color: '#16a34a' }} />;
const IcoPdfFile = () => <CustomGlyphs.SctPdf size="28" style={{ color: 'var(--v4-danger)' }} />;
const IcoXlsxFile = () => <CustomGlyphs.SctExcel size="28" style={{ color: 'currentColor' }} />;
const IcoOpenBox = () => <CustomGlyphs.SctPackages size="14" style={{ color: C.textDark }} />;

// ── avatar ────────────────────────────────────────────────────────────────────

function Av({ init, bg = '#0d9488', size = 22 }: { init: string; bg?: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {init}
    </div>
  );
}

// ── lifecycle badge ───────────────────────────────────────────────────────────

type LcType = string;
type CompatType = string;

function LcBadge({ type }: { type: LcType }) {
  const s =
    type === 'FINALIZED'
      ? { bg: '#dcfce7', color: '#16a34a', border: '#bbf7d0', label: 'Finalized' }
      : type === 'FAILED_RECOVERABLE'
        ? { bg: '#fff7ed', color: '#ea580c', border: '#fed7aa', label: 'Failed Recoverable' }
        : { bg: 'var(--v4-accent-selected)', color: '#2563eb', border: '#bfdbfe', label: type };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        fontSize: 10,
        fontWeight: 600,
        borderRadius: 4,
        padding: '2px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  );
}

function CompatBadge({ type }: { type: CompatType }) {
  const styles: Record<
    string,
    { bg: string; color: string; border: string; icon: React.ReactNode; label: string }
  > = {
    Locked: {
      bg: '#dcfce7',
      color: '#16a34a',
      border: '#bbf7d0',
      icon: <IcoLock />,
      label: 'Locked',
    },
    Issued: {
      bg: 'var(--v4-accent-selected)',
      color: '#2563eb',
      border: '#bfdbfe',
      icon: null,
      label: 'Issued',
    },
    InProgress: {
      bg: '#f5f3ff',
      color: '#7c3aed',
      border: '#ddd6fe',
      icon: null,
      label: 'In Progress',
    },
  };
  const m = styles[type] ?? {
    bg: C.cardBg,
    color: C.textMid,
    border: C.border,
    icon: null,
    label: type,
  };
  return (
    <span
      style={{
        background: m.bg,
        color: m.color,
        border: `1px solid ${m.border}`,
        fontSize: 10,
        fontWeight: 600,
        borderRadius: 4,
        padding: '2px 7px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        whiteSpace: 'nowrap',
      }}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

// ── table data ────────────────────────────────────────────────────────────────

export default function FinalRevisionsView({ binding: b }: { binding: FinalRevisionsBinding }) {
  const sizing = useResizableGridColumns(
    'FinalRevisionsView',
    [100, 160, 130, 120, 140, 110, 65, 140, 45],
  );
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const { phase, setPhase } = b;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRoot = useRef<HTMLDivElement>(null),
    filterTrigger = useRef<HTMLButtonElement>(null);
  const filtersActive = Boolean(
    phase || b.attentionOnly || Object.values(b.filters).some((value) => value && value !== 'all'),
  );
  const reset = () => {
    b.setFilters(emptyRevisionFilters());
    b.setPhase('');
    b.setAttentionOnly(false);
  };
  const latest = b.allRows.reduce<CanonicalRevisionRecord | null>(
    (current, row) =>
      !current || row.revision.revisionSequence > current.revisionSequence ? row.revision : current,
    null,
  );
  const activateKpi = (label: string) => {
    reset();
    b.setTab(label === 'Registered Outputs' ? 'deliverables' : 'revisions');
    if (label === 'Latest Revision' && latest) {
      b.select(latest);
      b.setFilters({ ...emptyRevisionFilters(), search: latest.revisionLabel });
    }
    if (label === 'Registered Outputs' && !b.selected && latest) b.select(latest);
    if (label === 'Needs Attention') b.setAttentionOnly(true);
    if (label === 'Completed Revisions')
      b.setFilters({ ...emptyRevisionFilters(), lifecycle: 'FINALIZED' });
  };
  const phaseOf = (revision: CanonicalRevisionRecord) =>
    typeof revision.projectSnapshot?.designStage === 'string'
      ? revision.projectSnapshot.designStage
      : '—';
  const ROWS = b.rows.map((row) => ({
    record: row.revision,
    id: row.revision.revisionLabel,
    latest: row.revision.revisionLabel === b.kpis.latestRevisionLabel,
    op: sourceDisplay(row.revision),
    src: row.revision.provenanceClassification,
    lc: row.revision.lifecycleState,
    avBg: '#0d9488',
    init: initials(row.revision.createdByName ?? ''),
    name: row.revision.createdByName ?? '—',
    date: formatIsoDateTime(row.revision.createdAt),
    time: '',
    snap: String(row.revision.luminaireSnapshot?.length ?? 0),
    out: row.outputsCount,
    outDot: b.outputs.some(
      (output) =>
        output.revisionId === row.revision.revisionId && output.artifactPresence !== 'Present',
    ),
    compat: buildCompatibilitySummary(row.revision, b.workspace)?.locked
      ? 'Locked'
      : (row.compatibilityStatus ?? '—'),
  }));
  const selected = b.selected;
  const compatibility = selected ? buildCompatibilitySummary(selected, b.workspace) : null;
  const selectedOutputs = b.outputs.filter((output) => output.revisionId === selected?.revisionId);
  const attachments = b.deliverables.filter(
    (item) => item.revisionId === selected?.revisionId && item.sourceType === 'DocumentSnapshot',
  );
  const activeTab = b.tab === 'deliverables' ? 'outputs' : b.tab;
  const setActiveTab = (tab: 'revisions' | 'outputs' | 'recovery') =>
    b.setTab(tab === 'outputs' ? 'deliverables' : tab);
  const detailOpen = Boolean(selected);
  return (
    <div
      data-resizable-grid
      style={{
        padding: G,
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: G,
        boxSizing: 'border-box',
        overflow: 'hidden',
        fontFamily: "'SCT Final Inter', sans-serif",
      }}
    >
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IcoRevisions />
          <div>
            <h1
              style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.2 }}
            >
              Revisions &amp; Outputs
            </h1>
            <p style={{ fontSize: 11, color: C.textSub, margin: 0 }}>
              Track revisions, outputs, and generated artifacts across all project phases.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Export Report — fge-108: 183×45px, border blue */}
          <button
            onClick={b.exportReport}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              width: 183,
              height: 45,
              border: `1px solid ${C.teal}`,
              borderRadius: RADIUS.control,
              background: C.white,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              color: C.text,
              boxSizing: 'border-box',
            }}
          >
            <IcoExport /> Export Report
          </button>
          {/* New Revision — fge-112: height 45px */}
          <div style={{ display: 'flex', height: 45 }}>
            <button
              onClick={b.create}
              disabled={b.createPending}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: C.teal,
                color: 'white',
                border: 'none',
                borderRadius: `${RADIUS.control}px 0 0 ${RADIUS.control}px`,
                padding: '0 16px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <IcoPlus /> New Revision
            </button>
            {b.menu}
          </div>
        </div>
      </div>

      {b.notice}
      {/* ── KPI cards ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: G, flexShrink: 0 }}>
        {[
          {
            icon: <IcoKpiRevision />,
            label: 'Total Revisions',
            value: String(b.kpis.totalRevisions),
            sub: 'All time',
          },
          {
            icon: <IcoKpiLatest />,
            label: 'Latest Revision',
            value: b.kpis.latestRevisionLabel ?? '—',
            sub: b.kpis.captions.latestRevision,
          },
          {
            icon: <IcoKpiOutputs />,
            label: 'Registered Outputs',
            value: String(b.kpis.generatedOutputs),
            sub: 'Across all phases',
          },
          {
            icon: <IcoKpiAttention />,
            label: 'Needs Attention',
            value: String(b.kpis.needsAttention),
            sub: 'Failed recoverable / Missing',
          },
          {
            icon: <IcoKpiCompleted />,
            label: 'Completed Revisions',
            value: String(b.completed),
            sub: `${b.kpis.totalRevisions ? Math.round((b.completed / b.kpis.totalRevisions) * 1000) / 10 : 0}% of total`,
          },
        ].map((kpi) => (
          <button
            type="button"
            onClick={() => activateKpi(kpi.label)}
            aria-pressed={
              kpi.label === 'Needs Attention'
                ? b.attentionOnly
                : kpi.label === 'Completed Revisions'
                  ? b.filters.lifecycle === 'FINALIZED'
                  : kpi.label === 'Registered Outputs'
                    ? b.tab === 'deliverables'
                    : kpi.label === 'Latest Revision'
                      ? Boolean(latest && b.filters.search === latest.revisionLabel)
                      : !filtersActive && b.tab === 'revisions'
            }
            key={kpi.label}
            style={{
              ...card,
              textAlign: 'left',
              cursor: 'pointer',
              flex: 1,
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            {kpi.icon}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: C.textSub, marginBottom: 1 }}>{kpi.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.text, lineHeight: 1.1 }}>
                {kpi.value}
              </div>
              <div style={{ fontSize: 10, color: C.textSub, marginTop: 1 }}>{kpi.sub}</div>
            </div>
            <IcoChevRight color={C.border} />
          </button>
        ))}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
          marginBottom: -G,
        }}
      >
        {(['revisions', 'outputs', 'recovery'] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '8px 18px 9px',
              fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? C.teal : C.textMid,
              borderBottom: activeTab === tab ? `2px solid ${C.teal}` : '2px solid transparent',
              marginBottom: -1,
              fontFamily: "'SCT Final Inter', sans-serif",
              textTransform: 'capitalize',
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab !== 'revisions' ? (
        b.otherTab
      ) : (
        <>
          {/* ── Main content row (table + side panel) ─────────────────────── */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: G }}>
            {/* ── Table card ──────────────────────────────────────────────── */}
            <div
              style={{
                ...card,
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Filters */}
              <div
                style={{
                  padding: '11px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  borderBottom: `1px solid ${C.border}`,
                  flexShrink: 0,
                }}
              >
                {/* Search */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    border: `1px solid ${C.border}`,
                    borderRadius: RADIUS.control,
                    padding: '0 10px',
                    height: 30,
                    flex: '0 0 180px',
                  }}
                >
                  <IcoSearch />
                  <input
                    aria-label="Search revisions"
                    value={b.filters.search}
                    onChange={(event) => b.setFilters({ ...b.filters, search: event.target.value })}
                    placeholder="Search revisions..."
                    style={{
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      fontSize: 11,
                      color: C.text,
                      width: '100%',
                      fontFamily: "'SCT Final Inter', sans-serif",
                    }}
                  />
                </div>
                <div ref={filterRoot}>
                  <button
                    ref={filterTrigger}
                    type="button"
                    aria-label="Revision filters"
                    aria-expanded={filtersOpen}
                    onClick={() => setFiltersOpen((value) => !value)}
                  >
                    Filters{filtersActive ? ' · Active' : ''}
                  </button>
                  <V4AnchoredSurface
                    anchorToTrigger
                    open={filtersOpen}
                    ownerRef={filterRoot}
                    triggerRef={filterTrigger}
                    onRequestClose={() => setFiltersOpen(false)}
                    // These listboxes are portaled outside the filter panel.
                    ignoreOutside={(target) =>
                      target instanceof Element &&
                      [
                        'Phase filter',
                        'Lifecycle filter',
                        'Author filter',
                        'Date range',
                        'Source filter',
                      ].includes(
                        target.closest('[role="listbox"]')?.getAttribute('aria-label') ?? '',
                      )
                    }
                    role="dialog"
                    ariaLabel="Revision filters"
                    className="v4-revision-filter-panel"
                  >
                    {' '}
                    {/* Dropdowns */}
                    <V4FilterSelect
                      label="Phase filter"
                      value={phase}
                      onChange={setPhase}
                      options={[
                        { value: '', label: 'All Phases' },
                        ...[...new Set(b.allRows.map((row) => phaseOf(row.revision)))]
                          .filter((value) => value !== '—')
                          .map((value) => ({ value, label: value })),
                      ]}
                      triggerStyle={{
                        height: 30,
                        minHeight: 0,
                        fontSize: 11,
                        padding: '0 9px',
                        border: `1px solid ${C.border}`,
                        borderRadius: RADIUS.control,
                        background: C.white,
                      }}
                    />
                    <V4FilterSelect
                      label="Lifecycle filter"
                      value={b.filters.lifecycle}
                      onChange={(value) => b.setFilters({ ...b.filters, lifecycle: value })}
                      options={[
                        { value: '', label: 'All Statuses' },
                        ...b.options.lifecycles.map((value) => ({ value, label: value })),
                      ]}
                      triggerStyle={{
                        height: 30,
                        minHeight: 0,
                        fontSize: 11,
                        padding: '0 9px',
                        border: `1px solid ${C.border}`,
                        borderRadius: RADIUS.control,
                        background: C.white,
                      }}
                    />
                    <V4FilterSelect
                      label="Author filter"
                      value={b.filters.createdBy}
                      onChange={(value) => b.setFilters({ ...b.filters, createdBy: value })}
                      options={[
                        { value: '', label: 'All Authors' },
                        ...b.options.createdBy.map((value) => ({ value, label: value })),
                      ]}
                      triggerStyle={{
                        height: 30,
                        minHeight: 0,
                        fontSize: 11,
                        padding: '0 9px',
                        border: `1px solid ${C.border}`,
                        borderRadius: RADIUS.control,
                        background: C.white,
                      }}
                    />
                    <V4FilterSelect
                      label="Date range"
                      value={b.filters.date}
                      onChange={(value) => {
                        const option = DATE_FILTER_OPTIONS.find((item) => item.value === value);
                        if (option) b.setFilters({ ...b.filters, date: option.value });
                      }}
                      options={DATE_FILTER_OPTIONS}
                      triggerStyle={{
                        height: 30,
                        minHeight: 0,
                        fontSize: 11,
                        padding: '0 9px',
                        border: `1px solid ${C.border}`,
                        borderRadius: RADIUS.control,
                        background: C.white,
                      }}
                    />
                    <V4FilterSelect
                      label="Source filter"
                      value={b.filters.source}
                      onChange={(value) => b.setFilters({ ...b.filters, source: value })}
                      options={[
                        { value: '', label: 'All Sources' },
                        ...b.options.sources.map((value) => ({ value, label: value })),
                      ]}
                      triggerStyle={{
                        height: 30,
                        minHeight: 0,
                        fontSize: 11,
                        padding: '0 9px',
                        border: `1px solid ${C.border}`,
                        borderRadius: RADIUS.control,
                        background: C.white,
                      }}
                    />
                    <button type="button" onClick={reset}>
                      Clear filters
                    </button>
                  </V4AnchoredSurface>
                </div>
                {filtersActive ? (
                  <button type="button" onClick={reset}>
                    Clear filters
                  </button>
                ) : null}
              </div>

              {/* Table section heading */}
              <div style={{ padding: '10px 14px 6px', flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                  Revision History ({b.total})
                </span>
              </div>

              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <div
                  style={{
                    minWidth: 950,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: '100%',
                  }}
                >
                  {sizing.reset}
                  {/* Table header */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'minmax(85px, .8fr) minmax(130px, 1.4fr) minmax(110px, 1.1fr) minmax(105px, 1fr) minmax(110px, 1.2fr) minmax(90px, .8fr) 65px minmax(110px, 1.1fr) 45px',
                      ...sizing.style,
                      padding: '0 14px',
                      borderBottom: `1px solid ${C.border}`,
                      background: C.tableHeader,
                      flexShrink: 0,
                    }}
                  >
                    {[
                      'Revision',
                      'Operation / Source',
                      'Lifecycle',
                      'Created By',
                      'Created At ↓',
                      'Luminaire Snapshot',
                      'Outputs',
                      'Compatibility Status',
                      'Actions',
                    ].map((h, index) => (
                      <div
                        key={h}
                        data-resizable-row-header
                        style={{
                          padding: '7px 5px',
                          position: 'relative',
                          fontSize: 10,
                          fontWeight: 600,
                          color: C.textLabel,
                          whiteSpace: 'normal',
                          overflowWrap: 'anywhere',
                          minWidth: 0,
                        }}
                      >
                        {h}
                        {sizing.handle(index, h)}
                      </div>
                    ))}
                  </div>

                  {/* Table body */}
                  <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    {ROWS.map((row, i) => (
                      <div
                        key={row.record.revisionId}
                        data-resizable-row
                        role="button"
                        tabIndex={0}
                        aria-label={`Select Revision ${row.id}`}
                        onClick={() => b.select(row.record)}
                        onKeyDown={(event) => {
                          if (
                            event.target === event.currentTarget &&
                            (event.key === 'Enter' || event.key === ' ')
                          ) {
                            event.preventDefault();
                            b.select(row.record);
                          }
                        }}
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            'minmax(85px, .8fr) minmax(130px, 1.4fr) minmax(110px, 1.1fr) minmax(105px, 1fr) minmax(110px, 1.2fr) minmax(90px, .8fr) 65px minmax(110px, 1.1fr) 45px',
                          ...sizing.style,
                          padding: '0 14px',
                          borderBottom: i < ROWS.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                          alignItems: 'center',
                        }}
                      >
                        {/* Revision */}
                        <div
                          style={{
                            padding: '9px 5px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <div
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: C.teal,
                              flexShrink: 0,
                            }}
                          />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                              {row.id}
                            </div>
                            {row.latest && (
                              <span
                                style={{
                                  fontSize: 9,
                                  fontWeight: 600,
                                  color: 'var(--v4-accent-ink)',
                                  background: '#f0fdfa',
                                  border: `1px solid #ccfbf1`,
                                  borderRadius: 3,
                                  padding: '1px 5px',
                                }}
                              >
                                Latest
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Op/Source */}
                        <div style={{ padding: '9px 5px' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>
                            {row.op}
                          </div>
                          <div style={{ fontSize: 10, color: C.textSub }}>{row.src}</div>
                        </div>
                        {/* Lifecycle */}
                        <div style={{ padding: '9px 5px' }}>
                          <LcBadge type={row.lc} />
                        </div>
                        {/* Created By */}
                        <div
                          style={{
                            padding: '9px 5px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <Av init={row.init} bg={row.avBg} size={22} />
                          <div>
                            {row.name.split('\n').map((n, ni) => (
                              <div
                                key={ni}
                                style={{
                                  fontSize: ni === 0 ? 11 : 10,
                                  fontWeight: ni === 0 ? 600 : 400,
                                  color: ni === 0 ? C.text : C.textSub,
                                  lineHeight: 1.2,
                                }}
                              >
                                {n}
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Created At */}
                        <div style={{ padding: '9px 5px' }}>
                          <div style={{ fontSize: 11, color: C.text }}>{row.date}</div>
                          <div style={{ fontSize: 10, color: C.textSub }}>{row.time}</div>
                        </div>
                        {/* Snapshot */}
                        <div style={{ padding: '9px 5px' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>
                            {row.snap}
                          </div>
                          <div style={{ fontSize: 10, color: C.textSub }}>rows</div>
                        </div>
                        {/* Outputs */}
                        <div
                          style={{
                            padding: '9px 5px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {row.out > 0 ? (
                            <>
                              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                                {row.out}
                              </span>
                              <IcoDoc />
                              {row.outDot && (
                                <div
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    background: C.red,
                                  }}
                                />
                              )}
                            </>
                          ) : (
                            <span style={{ fontSize: 12, color: C.textSub }}>0 —</span>
                          )}
                        </div>
                        {/* Compat */}
                        <div style={{ padding: '9px 5px' }}>
                          <CompatBadge type={row.compat} />
                        </div>
                        {/* Actions */}
                        <div style={{ padding: '9px 5px', display: 'flex', alignItems: 'center' }}>
                          <button
                            aria-label={`View Revision details for ${row.id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              b.details(row.record);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 2,
                              display: 'flex',
                              borderRadius: 4,
                            }}
                          >
                            <CustomGlyphs.SctInspect size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Pagination */}
              <div
                style={{
                  padding: '8px 14px',
                  borderTop: `1px solid ${C.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 11, color: C.textSub }}>
                  Showing {b.total ? b.page * b.pageSize + 1 : 0} to{' '}
                  {Math.min((b.page + 1) * b.pageSize, b.total)} of {b.total} revisions
                </span>
                <div style={{ flex: 1 }} />
                <button
                  aria-label="Previous page"
                  disabled={b.page === 0}
                  onClick={() => b.setPage(b.page - 1)}
                  style={{
                    width: 26,
                    height: 26,
                    border: `1px solid ${C.border}`,
                    borderRadius: 5,
                    background: C.white,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IcoChevRight color={C.textMid} size={11} />
                </button>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    border: `1px solid ${C.teal}`,
                    borderRadius: 5,
                    background: '#f0fdfa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--v4-accent-ink)',
                  }}
                >
                  {b.page + 1}
                </div>
                <button
                  aria-label="Next page"
                  disabled={b.page >= b.pages - 1}
                  onClick={() => b.setPage(b.page + 1)}
                  style={{
                    width: 26,
                    height: 26,
                    border: `1px solid ${C.border}`,
                    borderRadius: 5,
                    background: C.white,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IcoChevRight color={C.textMid} size={11} />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                  <span style={{ fontSize: 11, color: C.textSub }}>Rows per page:</span>
                  <select
                    aria-label="Rows per page"
                    value={b.pageSize}
                    onChange={(event) => b.setPageSize(Number(event.target.value))}
                    style={{
                      height: 26,
                      border: `1px solid ${C.border}`,
                      borderRadius: 5,
                      fontSize: 11,
                    }}
                  >
                    {[10, 25, 50].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* ── Revision Details panel ──────────────────────────────────── */}
            {detailOpen && selected && (
              <div
                style={{
                  ...card,
                  width: '25%',
                  minWidth: 270,
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                {/* Panel header */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderBottom: `1px solid ${C.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                    Revision Details
                  </span>
                  <button
                    aria-label="Close Revision Details"
                    onClick={b.close}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 2,
                      display: 'flex',
                    }}
                  >
                    <IcoClose />
                  </button>
                </div>

                {/* Detail content — no scroll */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: 'auto',
                    padding: '10px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {/* Revision identity */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <IcoDocDetail />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          marginBottom: 3,
                          flexWrap: 'wrap',
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                          {selected.revisionLabel}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#16a34a',
                            background: '#dcfce7',
                            border: '1px solid #bbf7d0',
                            borderRadius: 4,
                            padding: '1px 6px',
                          }}
                        >
                          {selected.lifecycleState}
                        </span>
                      </div>
                      <div
                        style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 3 }}
                      >
                        {selected.purpose ?? '—'}
                      </div>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}
                      >
                        <span style={{ fontSize: 10, color: C.textSub }}>
                          {formatIsoDateTime(selected.createdAt)}
                        </span>
                        <Av init={initials(selected.createdByName ?? '')} size={15} />
                        <span style={{ fontSize: 10, color: C.textSub }}>
                          by {selected.createdByName ?? '—'}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: C.blue,
                          background: 'var(--v4-accent-selected)',
                          border: `1px solid ${C.blueBorder}`,
                          borderRadius: 4,
                          padding: '1px 6px',
                        }}
                      >
                        {phaseOf(selected)}
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <div
                      style={{ fontSize: 10, fontWeight: 600, color: C.textLabel, marginBottom: 3 }}
                    >
                      Description
                    </div>
                    <div style={{ fontSize: 11, color: C.textDark, lineHeight: 1.4 }}>
                      {descriptionOpen
                        ? (selected.purpose ?? '—')
                        : (selected.purpose ?? '—').slice(0, 160)}
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setDescriptionOpen(!descriptionOpen)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setDescriptionOpen(!descriptionOpen);
                        }
                      }}
                      style={{
                        marginTop: 3,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        cursor: 'pointer',
                      }}
                    >
                      <span
                        style={{ fontSize: 11, color: 'var(--v4-accent-ink)', fontWeight: 500 }}
                      >
                        {descriptionOpen ? 'Show less' : 'Show more'}
                      </span>
                      <IcoChevDown color={C.teal} />
                    </div>
                  </div>

                  {/* Detail grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                    {[
                      { label: 'Operation / Source', value: sourceDisplay(selected), icon: null },
                      {
                        label: 'Lifecycle',
                        value: selected.lifecycleState,
                        badge: { bg: '#dcfce7', color: '#16a34a', border: '#bbf7d0' },
                      },
                      {
                        label: 'Project Snapshot',
                        value: formatIsoDateTime(selected.createdAt),
                        sub: true,
                      },
                      {
                        label: 'Created By',
                        value: selected.createdByName ?? '—',
                        av: initials(selected.createdByName ?? ''),
                      },
                      {
                        label: 'Luminaire Snapshot',
                        value: `${selected.luminaireSnapshot?.length ?? 0} rows`,
                        icon: null,
                      },
                      {
                        label: 'Outputs',
                        value:
                          selectedOutputs.length +
                          ' generated · ' +
                          attachments.length +
                          ' attachments',
                        icon: null,
                      },
                      {
                        label: 'Compatibility',
                        value: compatibility?.locked
                          ? 'Locked'
                          : (compatibility?.statusLabel ?? '—'),
                        badge: { bg: '#dcfce7', color: '#16a34a', border: '#bbf7d0' },
                      },
                      { label: 'Next Revision', value: '—', icon: null },
                    ].map(({ label, value, badge, av, sub }) => (
                      <div key={label}>
                        <div style={{ fontSize: 9, color: C.textSub, marginBottom: 3 }}>
                          {label}
                        </div>
                        {badge ? (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: badge.color,
                              background: badge.bg,
                              border: `1px solid ${badge.border}`,
                              borderRadius: 4,
                              padding: '1px 6px',
                            }}
                          >
                            {value}
                          </span>
                        ) : av ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Av init={av} size={16} />
                            <span style={{ fontSize: 11, color: C.text, fontWeight: 500 }}>
                              {value}
                            </span>
                          </div>
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              color: sub ? C.textSub : C.text,
                              fontWeight: sub ? 400 : 500,
                            }}
                          >
                            {value}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  <section aria-label="Revision attachments">
                    <strong>Attachments ({attachments.length})</strong>
                    {attachments.map((item) => (
                      <button
                        className="v4-revision-file-link"
                        key={item.deliverableId}
                        disabled={item.presence !== 'Present'}
                        onClick={() => b.openDeliverable(item)}
                      >
                        {/\.pdf$/i.test(item.fileName ?? '') ? (
                          <CustomGlyphs.SctPdf size={18} style={{ color: 'var(--v4-danger)' }} />
                        ) : (
                          <IcoDoc />
                        )}
                        <span>
                          {item.fileName ?? item.title}
                          <small>{item.presence}</small>
                        </span>
                      </button>
                    ))}
                  </section>
                  {/* Outputs in revision */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>
                        Outputs in this Revision ({selectedOutputs.length})
                      </span>
                      <button
                        onClick={() => b.setTab('deliverables')}
                        style={{
                          fontSize: 10,
                          color: 'var(--v4-accent-ink)',
                          cursor: 'pointer',
                          fontWeight: 500,
                          border: 0,
                          background: 'none',
                        }}
                      >
                        View All Outputs
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                      {selectedOutputs
                        .map((output) => ({
                          output,
                          icon:
                            output.outputFormat.toLowerCase() === 'pdf' ? (
                              <IcoPdfFile />
                            ) : (
                              <IcoXlsxFile />
                            ),
                          name: `${output.outputFamily ?? 'Output'}.${output.outputFormat.toLowerCase()}`,
                          size: output.artifactPresence,
                        }))
                        .map((f) => (
                          <button
                            key={f.output.outputId}
                            disabled={
                              f.output.artifactPresence !== 'Present' || !f.output.artifactOpenPath
                            }
                            onClick={() => b.openOutput(f.output)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              background: C.cardBg,
                              border: `1px solid ${C.border}`,
                              borderRadius: 7,
                              padding: '5px 7px',
                            }}
                          >
                            {f.icon}
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: C.text,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {f.name}
                              </div>
                              <div style={{ fontSize: 10, color: C.textSub }}>{f.size}</div>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                </div>

                {/* Bottom action */}
                <div
                  style={{
                    padding: '10px 14px',
                    borderTop: `1px solid ${C.border}`,
                    flexShrink: 0,
                  }}
                >
                  <button
                    disabled={
                      !selectedOutputs.some(
                        (output) =>
                          output.artifactPresence === 'Present' && output.artifactOpenPath,
                      )
                    }
                    onClick={() => selectedOutputs.forEach((output) => b.openOutput(output))}
                    style={{
                      width: '100%',
                      height: 34,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      border: `1px solid ${C.border}`,
                      borderRadius: RADIUS.control,
                      background: C.white,
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                      color: C.text,
                    }}
                  >
                    <IcoOpenBox /> Open All Outputs ({selectedOutputs.length})
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
