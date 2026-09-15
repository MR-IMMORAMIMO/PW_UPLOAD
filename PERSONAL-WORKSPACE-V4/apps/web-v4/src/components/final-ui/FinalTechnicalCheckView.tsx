import { V4ResizableTable } from '../common/V4ResizableTable';
import * as FinalGlyphs from '../common/SctIcons';
import * as InlineGlyphs from '../common/SctIcons';
import { sctIcons as ApprovedIcons } from '../common/SctIcons';
import { C as TC, SHADOW, RADIUS, LAYOUT } from './tokens';
import type {
  TechnicalCheckRow,
  TechnicalResultFilter,
} from '../../pages/technical-check/technicalCheckViewModel';
import { V4FilterSelect, type V4FilterSelectOption } from '../common/V4FilterSelect';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
export interface FinalTechnicalBinding {
  items: TechnicalCheckRow[];
  selected: TechnicalCheckRow | null;
  query: string;
  setQuery: (value: string) => void;
  result: string;
  setResult: (value: TechnicalResultFilter) => void;
  resultOptions: V4FilterSelectOption[];
  field: string;
  setField: (value: string) => void;
  fieldOptions: V4FilterSelectOption[];
  hideMatched: boolean;
  setHideMatched: (value: boolean) => void;
  counts: {
    needsAttention: number;
    missingIncomplete: number;
    matched: number | null;
    analyzed: number | null;
  };
  linked: number;
  luminaireCount: number;
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  requestedPageSize?: number;
  setPage: (value: number) => void;
  setPageSize: (value: number) => void;
  select: (id: string | null) => void;
  review: (row: TechnicalCheckRow, origin: HTMLElement) => void;
  run: () => void;
  pending: boolean;
  filters: () => void;
  filterMenu: React.ReactNode;
  analysisFilter: string;
  setAnalysisFilter: (value: string) => void;
  notice: React.ReactNode;
  viewDatasheet: (row: TechnicalCheckRow) => void;
  viewLuminaire: (row: TechnicalCheckRow) => void;
  useValue: (row: TechnicalCheckRow) => void;
  sort: () => void;
}

const F = "'Inter', sans-serif";

// ── Data ──────────────────────────────────────────────────────────────────────

type ResultType = string;
type CheckRow = {
  record: TechnicalCheckRow;
  id: string;
  tag: string;
  tagSub: string;
  field: string;
  scheduleValue: string;
  datasheetValue: string;
  result: string;
  evidence: string;
  confidence: string;
  rowIcon: 'doc-missing' | 'img-missing';
};
const present = (row: TechnicalCheckRow): CheckRow => ({
  record: row,
  id: row.id,
  tag: row.luminaire.tag,
  tagSub: row.luminaire.category || 'Uncategorized',
  field: row.fieldLabel,
  scheduleValue: row.scheduleValue || '—',
  datasheetValue: row.datasheetValue || '—',
  result:
    row.fieldKey === 'datasheet' && row.status === 'MissingDatasheet'
      ? 'Missing Datasheet'
      : row.resultLabel,
  evidence: row.fileName
    ? [row.fileName, row.pageNumber === null ? '' : `p. ${row.pageNumber}`]
        .filter(Boolean)
        .join(' · ')
    : row.evidence || '—',
  confidence: row.confidence === null ? '—' : `${row.confidence}%`,
  rowIcon: row.fieldKey === 'productImage' ? 'img-missing' : 'doc-missing',
});
// ── Icons ─────────────────────────────────────────────────────────────────────

function ShieldIcon() {
  const Glyph = ApprovedIcons['technical-check'];
  return <Glyph size={16} />;
}

function RefreshIcon() {
  return <ApprovedIcons.refresh size={16} />;
}

function SearchIcon() {
  return <ApprovedIcons.search size={16} />;
}

function ChevronDown() {
  return <InlineGlyphs.SctExpand width="11" height="11" color="currentColor" />;
}

function ChevLeft() {
  return <FinalGlyphs.SctBack width="12" height="12" />;
}

function ChevRight() {
  return <InlineGlyphs.SctNext width="12" height="12" color="currentColor" />;
}

function CloseIcon() {
  return <ApprovedIcons.close size={16} />;
}

function DotsIcon() {
  return <ApprovedIcons.more size={16} />;
}

function ExternalLinkIcon({ color = '#2563eb' }: { color?: string }) {
  return <InlineGlyphs.SctOpen width="11" height="11" color={color} />;
}

function SortIcon() {
  return <ApprovedIcons.sort size={16} />;
}

// ── Row status icon ───────────────────────────────────────────────────────────

function RowIcon({ type }: { type: CheckRow['rowIcon'] }) {
  if (type === 'doc-missing') {
    return (
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 6,
          background: '#fee2e2',
          border: '1px solid #fca5a5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <InlineGlyphs.SctWarning width="13" height="13" color="#dc2626" />
      </div>
    );
  }
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        background: '#fff7ed',
        border: '1px solid #fed7aa',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <InlineGlyphs.SctFile width="13" height="13" color="#ea580c" />
    </div>
  );
}

// ── Result badge ──────────────────────────────────────────────────────────────

function ResultBadge({ result }: { result: ResultType }) {
  const styles: Record<ResultType, { bg: string; border: string; color: string }> = {
    'Missing Datasheet': { bg: '#fff1f1', border: '#fca5a5', color: '#dc2626' },
    'Missing Image': { bg: '#fff7ed', border: '#fed7aa', color: '#ea580c' },
  };
  const s =
    styles[result] ??
    (result === 'Matched'
      ? { bg: '#f0fdf4', border: '#bbf7d0', color: '#16a34a' }
      : result === 'Needs Review'
        ? { bg: '#f5f3ff', border: '#ddd6fe', color: '#7c3aed' }
        : { bg: '#fff1f1', border: '#fca5a5', color: '#dc2626' });
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 6,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.color,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: F,
        whiteSpace: 'nowrap',
      }}
    >
      {result}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  value,
  label,
  sub,
  valueColor,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  sub: string;
  valueColor: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      style={{
        cursor: 'pointer',
        textAlign: 'left',
        outline: active ? '2px solid var(--v4-accent-ink)' : undefined,
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: TC.white,
        borderRadius: RADIUS.card,
        border: `1px solid ${TC.border}`,
        boxShadow: SHADOW.card,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 9,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <div>
        <div
          style={{
            fontSize: 19,
            fontWeight: 700,
            color: valueColor,
            fontFamily: F,
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: TC.text, fontFamily: F, marginTop: 1 }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: TC.textMid, fontFamily: F }}>{sub}</div>
      </div>
    </button>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  row,
  onClose,
  b,
}: {
  row: CheckRow;
  onClose: () => void;
  b: FinalTechnicalBinding;
}) {
  return (
    <div
      style={{
        width: '25%',
        minWidth: 260,
        flexShrink: 0,
        minHeight: 0,
        background: TC.white,
        borderRadius: RADIUS.section,
        border: `1px solid ${TC.border}`,
        boxShadow: SHADOW.card,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '9px 12px 8px',
          borderBottom: `1px solid ${TC.border}`,
          flexShrink: 0,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: TC.text, fontFamily: F }}>
            {row.tag}
          </div>
          <div style={{ fontSize: 11, color: TC.textMid, fontFamily: F }}>{row.tagSub}</div>
        </div>
        <button
          aria-label="Close selected check inspector"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 2,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <CloseIcon />
        </button>
      </div>

      <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {/* Section 1: Luminaire Details */}
        <div style={{ padding: '7px 12px 0', flexShrink: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: TC.textMuted,
              fontFamily: F,
              letterSpacing: '0.05em',
              marginBottom: 4,
            }}
          >
            1. Luminaire Details
          </div>
          <V4ResizableTable
            tableKey="FinalTechnicalCheckView-1"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: F }}
          >
            <tbody>
              {[
                ['Category', row.record.luminaire.category || '—'],
                ['Manufacturer', row.record.luminaire.manufacturer || '—'],
                ['Model', row.record.luminaire.model || '—'],
                ['Location', row.record.luminaire.location || '—'],
                ['Quantity', String(row.record.luminaire.quantity)],
              ].map(([label, val]) => (
                <tr key={label} style={{ borderBottom: `1px solid ${TC.borderLight}` }}>
                  <td
                    style={{
                      color: TC.textMuted,
                      padding: '2px 8px 2px 0',
                      width: '45%',
                      verticalAlign: 'middle',
                    }}
                  >
                    {label}
                  </td>
                  <td
                    style={{
                      color: TC.textDark,
                      fontWeight: 500,
                      padding: '2px 0',
                      verticalAlign: 'middle',
                    }}
                  >
                    {val}
                  </td>
                </tr>
              ))}
            </tbody>
          </V4ResizableTable>
        </div>

        {/* Divider */}
        <div style={{ margin: '6px 12px 0', borderTop: `1px solid ${TC.border}` }} />

        {/* Section 2: Selected Check */}
        <div style={{ padding: '6px 12px 0', flexShrink: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: TC.textMuted,
              fontFamily: F,
              letterSpacing: '0.05em',
              marginBottom: 4,
            }}
          >
            2. Selected Check
          </div>
          <V4ResizableTable
            tableKey="FinalTechnicalCheckView-2"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: F }}
          >
            <tbody>
              <tr style={{ borderBottom: `1px solid ${TC.borderLight}` }}>
                <td
                  style={{
                    color: TC.textMuted,
                    padding: '2px 8px 2px 0',
                    width: '45%',
                    verticalAlign: 'middle',
                  }}
                >
                  Field
                </td>
                <td
                  style={{
                    color: TC.textDark,
                    fontWeight: 500,
                    padding: '2px 0',
                    verticalAlign: 'middle',
                  }}
                >
                  {row.field}
                </td>
              </tr>
              <tr style={{ borderBottom: `1px solid ${TC.borderLight}` }}>
                <td
                  style={{ color: TC.textMuted, padding: '2px 8px 2px 0', verticalAlign: 'middle' }}
                >
                  Result
                </td>
                <td style={{ padding: '2px 0', verticalAlign: 'middle' }}>
                  <ResultBadge result={row.result} />
                </td>
              </tr>
              {[
                ['Severity', row.record.severity || '—'],
                ['Analysis', row.record.analysisStatus || 'Not run'],
                [
                  'Analyzed',
                  row.record.analyzedAt ? formatBusinessDateTime(row.record.analyzedAt) : 'Not run',
                ],
              ].map(([label, val]) => (
                <tr key={label} style={{ borderBottom: `1px solid ${TC.borderLight}` }}>
                  <td
                    style={{
                      color: TC.textMuted,
                      padding: '2px 8px 2px 0',
                      verticalAlign: 'middle',
                    }}
                  >
                    {label}
                  </td>
                  <td
                    style={{
                      color: TC.textDark,
                      fontWeight: 500,
                      padding: '2px 0',
                      verticalAlign: 'middle',
                    }}
                  >
                    {val}
                  </td>
                </tr>
              ))}
            </tbody>
          </V4ResizableTable>
        </div>

        {/* Divider */}
        <div style={{ margin: '6px 12px 0', borderTop: `1px solid ${TC.border}` }} />

        {/* Section 3: Comparison */}
        <div style={{ padding: '6px 12px 0', flexShrink: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: TC.textMuted,
              fontFamily: F,
              letterSpacing: '0.05em',
              marginBottom: 4,
            }}
          >
            3. Comparison
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: TC.textDark, fontFamily: F }}>
              Schedule Value
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: TC.textDark, fontFamily: F }}>
              Datasheet Value
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: TC.textDark, fontFamily: F }}>
                {row.scheduleValue}
              </div>
              <div style={{ fontSize: 10, color: TC.textMuted, fontFamily: F }}>
                {row.record.scheduleValue ? '' : 'Not provided'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: TC.textDark, fontFamily: F }}>
                {row.datasheetValue}
              </div>
              <div style={{ fontSize: 10, color: TC.textMuted, fontFamily: F }}>
                {row.record.datasheetValue ? '' : 'Not available'}
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ margin: '6px 12px 0', borderTop: `1px solid ${TC.border}` }} />

        {/* Section 4: Evidence */}
        <div style={{ padding: '6px 12px 0', flexShrink: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: TC.textMuted,
              fontFamily: F,
              letterSpacing: '0.05em',
              marginBottom: 4,
            }}
          >
            4. Evidence
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 8px',
              background: 'var(--v4-surface-subtle)',
              borderRadius: 6,
              border: `1px solid ${TC.border}`,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <InlineGlyphs.SctAttachment width="11" height="11" color="#dc2626" />
            </div>
            <span
              style={{ fontSize: 11, color: TC.textDark, fontWeight: 500, fontFamily: F, flex: 1 }}
            >
              {row.record.fileName || 'No evidence file'}
            </span>
            <span style={{ fontSize: 12, color: TC.textMuted, fontFamily: F }}>
              {row.record.pageNumber === null ? '—' : `p. ${row.record.pageNumber}`}
            </span>
          </div>
          <p
            style={{
              fontSize: 10,
              color: TC.textMuted,
              fontFamily: F,
              margin: '4px 0 0',
              lineHeight: 1.4,
            }}
          >
            {row.record.evidence ||
              row.record.analysisMessage ||
              'No evidence is available for this check.'}
          </p>
        </div>

        {/* Divider */}
        <div style={{ margin: '6px 12px 0', borderTop: `1px solid ${TC.border}` }} />

        {/* Section 5: Confidence & Alternatives */}
        <div style={{ padding: '6px 12px 0', flexShrink: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: TC.textMuted,
              fontFamily: F,
              letterSpacing: '0.05em',
              marginBottom: 4,
            }}
          >
            5. Confidence &amp; Alternatives
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 3,
            }}
          >
            <span style={{ fontSize: 11, color: TC.textDark, fontFamily: F }}>
              Confidence Score
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: row.confidence === '—' ? TC.textMuted : '#16a34a',
                fontFamily: F,
              }}
            >
              {row.confidence === '—' ? 'Unavailable' : row.confidence}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: TC.textDark, fontFamily: F }}>Alternatives</span>
            <span style={{ fontSize: 11, color: TC.textMuted, fontFamily: F }}>
              {row.record.alternatives.length ? row.record.alternatives.join(' · ') : 'None found'}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div style={{ margin: '6px 12px 0', borderTop: `1px solid ${TC.border}` }} />

        {/* Section 6: Actions */}
        <div style={{ padding: '6px 12px 0', flexShrink: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: TC.textMuted,
              fontFamily: F,
              letterSpacing: '0.05em',
              marginBottom: 5,
            }}
          >
            6. Actions
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
            <button
              onClick={() => b.viewDatasheet(row.record)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: 0,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--v4-accent-ink)',
                fontFamily: F,
              }}
            >
              View Datasheet <ExternalLinkIcon />
            </button>
            <button
              onClick={() => b.viewLuminaire(row.record)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: 0,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--v4-accent-ink)',
                fontFamily: F,
              }}
            >
              View in Luminaires <ExternalLinkIcon />
            </button>
          </div>
          <button
            disabled={b.pending || !row.record.canUseDatasheetValue}
            title={
              !row.record.canUseDatasheetValue
                ? 'No eligible reviewed value is available, or this field is Library controlled.'
                : undefined
            }
            onClick={() => b.useValue(row.record)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '7px 0',
              background: 'var(--v4-action-primary)',
              color: 'var(--v4-action-primary-foreground)',
              border: 'none',
              borderRadius: RADIUS.control,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: F,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(37,99,235,0.25)',
            }}
          >
            <InlineGlyphs.SctApply width="12" height="12" color="#fff" />
            {row.record.canUseDatasheetValue
              ? `Use Datasheet Value: ${row.record.datasheetValue}`
              : 'Use Datasheet Value'}
          </button>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />
      </div>
      {/* Footer */}
      <div
        style={{
          padding: '6px 12px',
          borderTop: `1px solid ${TC.border}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, color: TC.textMuted, fontFamily: F }}>
          {row.record.privacyMode === 'LocalOnly' ? 'Local analysis only' : '—'} &nbsp;•&nbsp;{' '}
          {row.record.engine || 'Not run'}
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FinalTechnicalCheckView({
  binding: b,
}: {
  binding: FinalTechnicalBinding;
}) {
  const grouped = b.items.some((row) => row.groupSummary);
  const ROWS = b.items.map((row) => {
    const displayed = present(row);
    const summary = row.groupSummary;
    return summary
      ? {
          ...displayed,
          field: `${summary.checks} checks`,
          scheduleValue: `${summary.conflicts} conflicts`,
          datasheetValue: `${summary.missing} missing · ${summary.review} review`,
          result: summary.label,
          confidence: '—',
        }
      : displayed;
  });
  const selectedRow = b.selected ? present(b.selected) : null;
  const selectedIdx = b.selected?.id;
  const setSelectedIdx = b.select;
  const hideMatched = b.hideMatched;
  const setHideMatched = b.setHideMatched;
  return (
    <>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: LAYOUT.sectionGap,
          gap: LAYOUT.sectionGap,
          overflow: 'hidden',
        }}
      >
        {/* ── Page title row ──────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldIcon />
            <div>
              <h1
                style={{
                  fontFamily: F,
                  fontSize: 22,
                  fontWeight: 700,
                  color: TC.text,
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                Technical Check
              </h1>
              <p style={{ fontFamily: F, fontSize: 13, color: TC.textMid, margin: '3px 0 0' }}>
                Review incomplete and inconsistent luminaire information before issue.
              </p>
            </div>
          </div>
          <button
            disabled={b.pending || !b.luminaireCount}
            onClick={b.run}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              height: 34,
              background: TC.white,
              border: `1px solid ${TC.border}`,
              borderRadius: RADIUS.control,
              fontSize: 13,
              fontWeight: 600,
              color: TC.textDark,
              fontFamily: F,
              cursor: 'pointer',
            }}
          >
            <RefreshIcon /> {b.pending ? 'Running…' : 'Run Technical Check'}
          </button>
        </div>

        {/* ── Stat cards ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: LAYOUT.sectionGap, flexShrink: 0 }}>
          <StatCard
            icon={
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: '#fff1f1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <InlineGlyphs.SctWarning width="22" height="22" color="#dc2626" />
              </div>
            }
            value={String(b.counts.needsAttention)}
            label="Needs Attention"
            active={b.result === 'needs-attention'}
            onClick={() => b.setResult(b.result === 'needs-attention' ? 'all' : 'needs-attention')}
            sub="Check results needing attention"
            valueColor="#dc2626"
          />
          <StatCard
            icon={
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: '#fff7ed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <InlineGlyphs.SctWarning width="22" height="22" color="#ea580c" />
              </div>
            }
            value={String(b.counts.missingIncomplete)}
            label="Missing / Incomplete"
            active={b.result === 'missing-incomplete'}
            onClick={() =>
              b.setResult(b.result === 'missing-incomplete' ? 'all' : 'missing-incomplete')
            }
            sub="Check results: missing or incomplete"
            valueColor="#ea580c"
          />
          <StatCard
            icon={
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: '#f0fdf4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <InlineGlyphs.SctSuccess width="22" height="22" color="#16a34a" />
              </div>
            }
            value={b.counts.matched === null ? 'Not run' : String(b.counts.matched)}
            label="Matched"
            active={b.result === 'matched'}
            onClick={() => b.setResult(b.result === 'matched' ? 'all' : 'matched')}
            sub="Matched check results"
            valueColor="#16a34a"
          />
          <StatCard
            icon={
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 10,
                  background: 'var(--v4-accent-selected)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <InlineGlyphs.SctDatasheets width="22" height="22" color="#2563eb" />
              </div>
            }
            value={b.counts.analyzed === null ? 'Not run' : String(b.counts.analyzed)}
            label="Datasheets Analyzed"
            active={b.result === 'analyzed'}
            onClick={() => b.setResult(b.result === 'analyzed' ? 'all' : 'analyzed')}
            sub={`Luminaires analyzed · ${b.linked} linked of ${b.luminaireCount}`}
            valueColor="#2563eb"
          />
        </div>

        {b.notice}
        {/* ── Main content: table + detail panel ──────────────────────── */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            gap: LAYOUT.sectionGap,
            overflow: 'hidden',
          }}
        >
          {/* Table card */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              background: TC.white,
              borderRadius: RADIUS.section,
              border: `1px solid ${TC.border}`,
              boxShadow: SHADOW.card,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Toolbar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                borderBottom: `1px solid ${TC.border}`,
                flexShrink: 0,
              }}
            >
              {/* Search */}
              <div style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 9,
                    top: '50%',
                    transform: 'translateY(-50%)',
                  }}
                >
                  <SearchIcon />
                </span>
                <input
                  type="text"
                  aria-label="Search technical checks"
                  value={b.query}
                  onChange={(event) => b.setQuery(event.target.value)}
                  placeholder="Search by tag, manufacturer, model or field..."
                  style={{
                    paddingLeft: 30,
                    paddingRight: 10,
                    height: 34,
                    width: '100%',
                    borderRadius: RADIUS.control,
                    border: `1px solid ${TC.border}`,
                    background: TC.white,
                    fontSize: 12,
                    color: TC.text,
                    fontFamily: F,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Result dropdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: TC.textMuted,
                    fontFamily: F,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Result
                </span>
                <V4FilterSelect
                  label="Result"
                  value={b.result}
                  options={b.resultOptions}
                  onChange={(value) => b.setResult(value as TechnicalResultFilter)}
                  triggerStyle={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '0 10px',
                    height: 30,
                    background: TC.white,
                    border: `1px solid ${TC.border}`,
                    borderRadius: RADIUS.control,
                    fontSize: 12,
                    fontWeight: 500,
                    color: TC.textDark,
                    fontFamily: F,
                  }}
                  chevron={<ChevronDown />}
                />
              </div>

              {/* Field dropdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: TC.textMuted,
                    fontFamily: F,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Field
                </span>
                <V4FilterSelect
                  label="Field"
                  value={b.field}
                  options={b.fieldOptions}
                  onChange={b.setField}
                  triggerStyle={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '0 10px',
                    height: 30,
                    background: TC.white,
                    border: `1px solid ${TC.border}`,
                    borderRadius: RADIUS.control,
                    fontSize: 12,
                    fontWeight: 500,
                    color: TC.textDark,
                    fontFamily: F,
                  }}
                  chevron={<ChevronDown />}
                />
              </div>

              {/* Hide Matched toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div
                  role="switch"
                  tabIndex={0}
                  aria-label="Hide Matched"
                  aria-checked={hideMatched}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setHideMatched(!hideMatched);
                    }
                  }}
                  onClick={() => setHideMatched(!hideMatched)}
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    background: hideMatched ? '#2563eb' : 'var(--v4-border-control)',
                    position: 'relative',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'background 150ms',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: hideMatched ? 18 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: 'var(--v4-surface-raised)',
                      transition: 'left 150ms',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                  />
                </div>
                <span
                  style={{ fontSize: 12, color: TC.textMid, fontFamily: F, whiteSpace: 'nowrap' }}
                >
                  Hide Matched
                </span>
              </div>

              <V4FilterSelect
                label="Analysis status"
                value={b.analysisFilter}
                options={[
                  { value: 'all', label: 'All analysis states' },
                  { value: 'NotRun', label: 'Not run' },
                  { value: 'Ready', label: 'Ready' },
                  { value: 'NeedsReview', label: 'Needs Review' },
                  { value: 'Unavailable', label: 'Unavailable' },
                  { value: 'Unsupported', label: 'Unsupported' },
                ]}
                onChange={b.setAnalysisFilter}
              />
            </div>

            {/* Table */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <V4ResizableTable
                tableKey="FinalTechnicalCheckView-3"
                style={{
                  width: '100%',
                  minWidth: 950,
                  borderCollapse: 'collapse',
                  tableLayout: 'fixed',
                }}
              >
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: 36 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 120 }} />
                  <col />
                  <col />
                  <col style={{ width: 148 }} />
                  <col />
                  <col />
                  <col style={{ width: 40 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={thStyle} />
                    <th style={thStyle} />
                    {[
                      { label: 'Tag', sort: true },
                      { label: grouped ? 'Checks' : 'Field' },
                      { label: grouped ? 'Conflicts' : 'Schedule Value' },
                      { label: grouped ? 'Missing / Review' : 'Datasheet Value' },
                      { label: 'Result' },
                      { label: 'Evidence / Page' },
                      { label: 'Confidence' },
                    ].map(({ label, sort }) => (
                      <th key={label} style={thStyle}>
                        <button
                          disabled={!sort}
                          onClick={b.sort}
                          style={{
                            background: 'none',
                            border: 0,
                            padding: 0,
                            font: 'inherit',
                            color: 'inherit',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {label}
                          {sort && <SortIcon />}
                        </button>
                      </th>
                    ))}
                    <th style={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {!ROWS.length && (
                    <tr>
                      <td colSpan={12}>
                        <div className="v4-audit-empty" role="status">
                          <strong>No checks match these filters.</strong>
                          <button
                            type="button"
                            onClick={() => {
                              b.setQuery('');
                              b.setResult('all');
                              b.setField('');
                              b.setHideMatched(false);
                              b.setPage(0);
                            }}
                          >
                            Clear filters
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {ROWS.map((row) => {
                    const isSelected = selectedIdx === row.id;
                    return (
                      <tr
                        key={row.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${row.tag}: ${row.field}`}
                        onKeyDown={(event) => {
                          if (
                            event.target === event.currentTarget &&
                            (event.key === 'Enter' || event.key === ' ')
                          ) {
                            event.preventDefault();
                            setSelectedIdx(row.id);
                            b.review(row.record, event.currentTarget);
                          }
                        }}
                        onClick={(event) => {
                          setSelectedIdx(row.id === selectedIdx ? null : row.id);
                          b.review(row.record, event.currentTarget);
                        }}
                        style={{
                          background: isSelected ? 'var(--v4-accent-selected)' : TC.white,
                          borderBottom: `1px solid ${TC.borderLight}`,
                          borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent',
                          cursor: 'pointer',
                          transition: 'background 100ms',
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected)
                            (e.currentTarget as HTMLElement).style.background =
                              'var(--v4-surface-subtle)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.background = isSelected
                            ? 'var(--v4-accent-selected)'
                            : TC.white;
                        }}
                      >
                        {/* Radio */}
                        <td style={{ padding: '0 0 0 14px', verticalAlign: 'middle' }}>
                          <div
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 99,
                              border: `2px solid ${isSelected ? '#2563eb' : TC.border}`,
                              background: isSelected ? '#2563eb' : TC.white,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {isSelected && (
                              <div
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: 99,
                                  background: 'white',
                                }}
                              />
                            )}
                          </div>
                        </td>
                        {/* Icon */}
                        <td style={{ padding: '0 6px', verticalAlign: 'middle' }}>
                          <RowIcon type={row.rowIcon} />
                        </td>
                        {/* Tag */}
                        <td style={{ padding: '10px 10px', verticalAlign: 'middle' }}>
                          <div
                            style={{ fontSize: 13, fontWeight: 600, color: TC.text, fontFamily: F }}
                          >
                            {row.tag}
                          </div>
                          <div style={{ fontSize: 11, color: TC.textMid, fontFamily: F }}>
                            {row.tagSub}
                          </div>
                        </td>
                        {/* Field */}
                        <td
                          style={{
                            padding: '0 10px',
                            fontSize: 12,
                            color: TC.textDark,
                            fontFamily: F,
                            verticalAlign: 'middle',
                          }}
                        >
                          {row.field}
                        </td>
                        {/* Schedule Value */}
                        <td
                          style={{
                            padding: '0 10px',
                            fontSize: 12,
                            color: TC.textMid,
                            fontFamily: F,
                            verticalAlign: 'middle',
                            textAlign: 'center',
                          }}
                        >
                          {row.scheduleValue}
                        </td>
                        {/* Datasheet Value */}
                        <td
                          style={{
                            padding: '0 10px',
                            fontSize: 12,
                            color: TC.textMid,
                            fontFamily: F,
                            verticalAlign: 'middle',
                            textAlign: 'center',
                          }}
                        >
                          {row.datasheetValue}
                        </td>
                        {/* Result */}
                        <td style={{ padding: '0 10px', verticalAlign: 'middle' }}>
                          <ResultBadge result={row.result} />
                        </td>
                        {/* Evidence */}
                        <td
                          style={{
                            padding: '0 10px',
                            fontSize: 12,
                            color: TC.textMid,
                            fontFamily: F,
                            verticalAlign: 'middle',
                            textAlign: 'center',
                          }}
                        >
                          {row.evidence}
                        </td>
                        {/* Confidence */}
                        <td
                          style={{
                            padding: '0 10px',
                            fontSize: 12,
                            color: TC.textMid,
                            fontFamily: F,
                            verticalAlign: 'middle',
                            textAlign: 'center',
                          }}
                        >
                          {row.confidence}
                        </td>
                        {/* Actions */}
                        <td
                          style={{ padding: 0, verticalAlign: 'middle', textAlign: 'center' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            aria-label={`Review ${row.tag}: ${row.field}`}
                            onClick={(event) => b.review(row.record, event.currentTarget)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '4px 6px',
                              borderRadius: 4,
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <DotsIcon />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </V4ResizableTable>
            </div>

            {/* Pagination */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 16px',
                height: 44,
                borderTop: `1px solid ${TC.border}`,
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 12, color: TC.textMid, fontFamily: F }}>
                Showing {b.total ? b.page * b.pageSize + 1 : 0} to{' '}
                {b.page * b.pageSize + b.items.length} of {b.total}{' '}
                {grouped ? 'luminaires' : 'issues'}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  aria-label="Previous page"
                  disabled={b.page === 0}
                  onClick={() => b.setPage(b.page - 1)}
                  style={{
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${TC.border}`,
                    borderRadius: 6,
                    background: TC.white,
                    cursor: 'default',
                    opacity: 0.4,
                  }}
                >
                  <ChevLeft />
                </button>
                <button
                  style={{
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--v4-action-primary)',
                    borderRadius: 6,
                    background: 'var(--v4-action-primary)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--v4-action-primary-foreground)',
                    fontFamily: F,
                  }}
                >
                  {b.page + 1}
                </button>
                <button
                  aria-label="Next page"
                  disabled={b.page >= b.pages - 1}
                  onClick={() => b.setPage(b.page + 1)}
                  style={{
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${TC.border}`,
                    borderRadius: 6,
                    background: TC.white,
                    cursor: 'default',
                    opacity: 0.4,
                  }}
                >
                  <ChevRight />
                </button>
                <V4FilterSelect
                  label="Rows per page"
                  value={String(b.requestedPageSize ?? b.pageSize)}
                  options={[0, 8, 25, 50].map((value) => ({
                    value: String(value),
                    label: value ? `${value} / page` : 'Auto / window',
                  }))}
                  onChange={(value) => b.setPageSize(Number(value))}
                  triggerStyle={{
                    padding: '4px 8px',
                    marginLeft: 8,
                    border: `1px solid ${TC.border}`,
                    borderRadius: 6,
                    fontSize: 12,
                    color: TC.textDark,
                    background: TC.white,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Detail panel */}
          {selectedRow && (
            <DetailPanel b={b} row={selectedRow} onClose={() => setSelectedIdx(null)} />
          )}
        </div>
      </div>
    </>
  );
}

// ── Table header cell style ────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '0 10px',
  height: 38,
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--v4-text-disabled)',
  fontFamily: F,
  letterSpacing: '0.02em',
  background: 'var(--v4-surface-subtle)',
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 2,
};
