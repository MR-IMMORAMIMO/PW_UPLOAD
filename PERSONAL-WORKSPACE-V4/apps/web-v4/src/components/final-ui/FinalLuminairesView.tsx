import { V4ResizableTable } from '../common/V4ResizableTable';
import * as InlineGlyphs from '../common/SctIcons';
import { sctIcons as ApprovedIcons } from '../common/SctIcons';
import { V4ActionMenu } from '../common/V4ActionMenu';
import { useEffect, useState, useRef } from 'react';
import { V4Button } from '../common/V4Button';
import { Link } from 'react-router-dom';
import { C, SHADOW, RADIUS, LAYOUT } from './tokens';
import type { LuminaireRecord } from '@scli/domain';
import { LuminaireImage } from '../../pages/project-luminaires/LuminaireImage';
import {
  luminaireCompleteness,
  luminaireFileName,
} from '../../pages/project-luminaires/luminairesViewModel';
import { displayLuminaireTechnicalValue } from '../common/luminaireTechnicalDisplay';
import { V4FilterSelect } from '../common/V4FilterSelect';
export interface FinalLuminairesBinding {
  imageSources?: Record<string, string>;
  attachments?: Array<{ label: string; path: string; name?: string }> | undefined;
  attachmentsError?: boolean;
  items: LuminaireRecord[];
  allItems?: LuminaireRecord[];
  bulk?: (ids: Set<string>, mode: 'edit' | 'remove') => void;
  selected: LuminaireRecord | null;
  query: string;
  setQuery: (value: string) => void;
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  requestedPageSize?: number;
  setPage: (value: number) => void;
  setPageSize: (value: number) => void;
  reportCapacity?: (value: number) => void;
  select: (id: string | null) => void;
  edit: (item: LuminaireRecord) => void;
  duplicate: (item: LuminaireRecord) => void;
  remove: (item: LuminaireRecord) => void;
  add: () => void;
  filters: () => void;
  columns: () => void;
  import: () => void;
  summaryHref: string;
  openAsset: (path: string) => void;
  toolbar: React.ReactNode;
  notice: React.ReactNode;
  libraryActions?: React.ReactNode;
  filterMenu: React.ReactNode;
  columnMenu: React.ReactNode;
  importMenu: React.ReactNode;
  addMenu: React.ReactNode;
  columnsShown: Array<{ key: keyof LuminaireRecord; label: string }>;
  sort: (key: keyof LuminaireRecord) => void;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Luminaire = LuminaireRecord & { status: 'Complete' | 'Missing DS' | 'Review' };
const present = (item: LuminaireRecord): Luminaire => ({
  ...item,
  status: luminaireCompleteness(item),
});
const specs = (item: LuminaireRecord) => [
  ['Tag', item.tag],
  ['Manufacturer', item.manufacturer],
  ['Model', item.model],
  ['Wattage', displayLuminaireTechnicalValue('wattage', item.wattage)],
  ['CCT', displayLuminaireTechnicalValue('lightColor', item.lightColor)],
  ['Beam Angle', displayLuminaireTechnicalValue('beamAngle', item.beamAngle)],
  ['IP Rating', displayLuminaireTechnicalValue('ipRating', item.ipRating)],
  ['Mounting', item.mounting],
  ['Finish', item.bodyColorFinish],
  ['Dimensions', item.dimensions],
  ['Driver', item.driver],
  ['Control', item.control],
];

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Luminaire['status'] }) {
  const map = {
    Complete: { bg: '#dcfce7', text: '#16a34a', border: '#bbf7d0' },
    'Missing DS': { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa' },
    Review: { bg: '#f5f3ff', text: '#7c3aed', border: '#ddd6fe' },
  };
  const s = map[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 99,
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.text,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "'Inter', sans-serif",
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function SearchIcon() {
  return <ApprovedIcons.search size={16} />;
}
function FilterIcon() {
  return <ApprovedIcons.filter size={16} />;
}
function ColumnsIcon() {
  return <ApprovedIcons.columns size={16} />;
}
function ImportIcon() {
  return <ApprovedIcons.upload size={16} />;
}
function PlusIcon() {
  return <ApprovedIcons.add size={16} />;
}
function ChevronDown() {
  return <InlineGlyphs.SctExpand width="11" height="11" color="currentColor" />;
}
function ChevronLeft() {
  return <InlineGlyphs.SctBack width="12" height="12" color="currentColor" />;
}
function ChevronRight() {
  return <InlineGlyphs.SctNext width="12" height="12" color="currentColor" />;
}
function ChevronsLeft() {
  return <InlineGlyphs.SctBack width="12" height="12" color="currentColor" />;
}
function ChevronsRight() {
  return <InlineGlyphs.SctNext width="12" height="12" color="currentColor" />;
}
function GearIcon() {
  return <ApprovedIcons.settings size={16} />;
}
function CloseIcon() {
  return <ApprovedIcons.close size={16} />;
}
function EditPencilIcon() {
  return <ApprovedIcons.edit size={16} />;
}
function DuplicateIcon() {
  return <ApprovedIcons.duplicate size={16} />;
}
function TrashIcon() {
  return <ApprovedIcons.delete size={16} />;
}
function FileIcon() {
  return <ApprovedIcons.pdf size={20} />;
}
function AttachIcon() {
  return <ApprovedIcons.attachment size={16} />;
}
function CheckCircle() {
  return <InlineGlyphs.SctSuccess width="12" height="12" color="#16a34a" />;
}
function ChevronRightSmall() {
  return <InlineGlyphs.SctNext width="12" height="12" color={C.textMuted} />;
}

// ── Toolbar button ─────────────────────────────────────────────────────────────

function TBtn({
  children,
  hasArrow,
  onClick,
}: {
  children: React.ReactNode;
  hasArrow?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '0 11px',
        height: 34,
        background: C.white,
        border: `1px solid ${C.border}`,
        borderRadius: RADIUS.control,
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 500,
        color: C.textDark,
        fontFamily: "'Inter', sans-serif",
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v4-surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = C.white)}
    >
      {children}
      {hasArrow && <ChevronDown />}
    </button>
  );
}

// ── Column header ─────────────────────────────────────────────────────────────

function TH({
  children,
  width,
  align = 'left',
  onSort,
}: {
  children: React.ReactNode;
  width?: number;
  align?: string;
  onSort?: () => void;
}) {
  return (
    <th
      style={{
        width,
        textAlign: align as never,
        padding: '0 8px',
        height: 36,
        fontSize: 11,
        fontWeight: 600,
        color: C.textMuted,
        fontFamily: "'Inter', sans-serif",
        letterSpacing: '0.02em',
        background: 'var(--v4-surface-subtle)',
        borderBottom: `1px solid ${C.border}`,
        whiteSpace: 'nowrap',
        userSelect: 'none',
        position: 'sticky',
        top: 0,
        zIndex: 2,
      }}
    >
      <button
        type="button"
        disabled={!onSort}
        onClick={onSort}
        style={{
          background: 'none',
          border: 0,
          padding: 0,
          font: 'inherit',
          color: 'inherit',
          cursor: onSort ? 'pointer' : 'default',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
        }}
      >
        {children}
        {children && typeof children === 'string' && (
          <InlineGlyphs.SctSort width="9" height="9" style={{ opacity: 0.5 }} />
        )}
      </button>
      <span data-resize-host="" />
    </th>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  lum,
  onClose,
  b,
}: {
  lum: Luminaire;
  onClose: () => void;
  b: FinalLuminairesBinding;
}) {
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  useEffect(() => setAttachmentsOpen(false), [lum.id]);
  const attachments =
    b.attachments ??
    [
      { label: 'Datasheet', path: lum.datasheetPath },
      { label: 'Product image', path: lum.imagePath },
    ].filter((item) => item.path);
  return (
    <div
      role="complementary"
      aria-label="Selected luminaire inspector"
      style={{
        width: '25%',
        minWidth: 260,
        flexShrink: 0,
        minHeight: 0,
        background: C.white,
        borderRadius: RADIUS.section,
        border: `1px solid ${C.border}`,
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
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px 10px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: C.text,
            fontFamily: "'Inter', sans-serif",
          }}
        >
          {lum.tag}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusBadge status={lum.status} />
          <button
            aria-label="Close luminaire details"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 4,
            }}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowWrap: 'anywhere' }}>
        {attachmentsOpen ? (
          <section aria-label="Luminaire attachments" style={{ padding: 14 }}>
            <V4Button onClick={() => setAttachmentsOpen(false)}>
              <InlineGlyphs.SctBack />
              Back to details
            </V4Button>
            <h3>Attachments</h3>
            {b.attachmentsError && (
              <p role="alert">Attachment versions could not be loaded. Showing known files.</p>
            )}
            {attachments.length ? (
              attachments.map((item) => (
                <V4Button
                  key={item.path}
                  onClick={() => b.openAsset(item.path)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    marginBottom: 8,
                    height: 'auto',
                    whiteSpace: 'normal',
                    textAlign: 'left',
                  }}
                >
                  {item.label === 'Datasheet' ? <FileIcon /> : <InlineGlyphs.SctImage />}
                  <span>
                    {item.label}
                    <br />
                    {luminaireFileName(item.path)}
                  </span>
                </V4Button>
              ))
            ) : (
              <p>No files attached.</p>
            )}
          </section>
        ) : (
          <>
            {/* Subtitle */}
            <div style={{ padding: '8px 14px 0', flexShrink: 0 }}>
              <p
                style={{
                  fontSize: 11,
                  color: C.textSub,
                  fontFamily: "'Inter', sans-serif",
                  margin: 0,
                  lineHeight: 1.4,
                }}
              >
                {lum.manufacturer} – {lum.model}
              </p>
            </div>

            {/* Image + specs */}
            <div style={{ padding: '10px 14px 0', display: 'flex', gap: 10, flexShrink: 0 }}>
              <div
                className="final-luminaire-image"
                style={{
                  width: 80,
                  height: 80,
                  flexShrink: 0,
                  background: 'var(--v4-surface-base)',
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                <LuminaireImage
                  path={b.imageSources?.[lum.id] ?? lum.imagePath}
                  alt={`${lum.tag} product`}
                />
              </div>
              <V4ResizableTable
                tableKey="FinalLuminairesView-1"
                style={{
                  flex: 1,
                  borderCollapse: 'collapse',
                  fontSize: 11,
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                <tbody>
                  {specs(lum)
                    .slice(0, 4)
                    .map(([label, val]) => (
                      <tr key={label}>
                        <td
                          style={{
                            color: C.textMuted,
                            paddingBottom: 3,
                            paddingRight: 6,
                            whiteSpace: 'nowrap',
                            verticalAlign: 'top',
                          }}
                        >
                          {label}
                        </td>
                        <td
                          style={{
                            color: C.textDark,
                            fontWeight: 600,
                            paddingBottom: 3,
                            verticalAlign: 'top',
                          }}
                        >
                          {val || '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </V4ResizableTable>
            </div>

            {/* Remaining specs */}
            <div style={{ padding: '6px 14px 0', flexShrink: 0 }}>
              <V4ResizableTable
                tableKey="FinalLuminairesView-2"
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 11,
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                <tbody>
                  {specs(lum)
                    .slice(4)
                    .map(([label, val]) => (
                      <tr key={label} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                        <td
                          style={{
                            color: C.textMuted,
                            padding: '3px 6px 3px 0',
                            width: '40%',
                            verticalAlign: 'top',
                          }}
                        >
                          {label}
                        </td>
                        <td
                          style={{
                            color: C.textDark,
                            fontWeight: 500,
                            padding: '3px 0',
                            verticalAlign: 'top',
                          }}
                        >
                          {val || '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </V4ResizableTable>
            </div>

            {/* Notes */}
            <div style={{ padding: '8px 14px 0', flexShrink: 0 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.textDark,
                  fontFamily: "'Inter', sans-serif",
                  margin: '0 0 3px',
                }}
              >
                Notes
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: C.textSub,
                  fontFamily: "'Inter', sans-serif",
                  margin: 0,
                  lineHeight: 1.45,
                }}
              >
                {lum.notes || '—'}
              </p>
            </div>

            {/* Datasheet */}
            <div style={{ padding: '8px 14px 0', flexShrink: 0 }}>
              <div
                role="button"
                tabIndex={lum.datasheetPath ? 0 : -1}
                aria-label="Open datasheet"
                aria-disabled={!lum.datasheetPath}
                onClick={() => {
                  if (lum.datasheetPath) b.openAsset(lum.datasheetPath);
                }}
                onKeyDown={(event) => {
                  if (lum.datasheetPath && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    b.openAsset(lum.datasheetPath);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  cursor: lum.datasheetPath ? 'pointer' : 'default',
                  gap: 8,
                  padding: '8px 10px',
                  background: C.cardBg,
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                }}
              >
                <FileIcon />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: C.textDark,
                        fontFamily: "'Inter', sans-serif",
                      }}
                    >
                      Datasheet
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11,
                        color: lum.datasheetPath ? 'var(--v4-success)' : 'var(--v4-warning)',
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: 600,
                      }}
                    >
                      {lum.datasheetPath ? <CheckCircle /> : null}{' '}
                      {lum.datasheetPath ? 'Attached' : 'Missing'}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: C.textMuted,
                      fontFamily: "'Inter', sans-serif",
                      marginTop: 2,
                    }}
                  >
                    {lum.datasheetPath ? luminaireFileName(lum.datasheetPath) : '—'}
                  </div>
                  <div
                    style={{ fontSize: 10, color: C.textMuted, fontFamily: "'Inter', sans-serif" }}
                  >
                    {/* Upload time must come from its AssetVersion, never the luminaire update time. */}
                  </div>
                </div>
              </div>
            </div>

            {/* Attachments */}
            <div style={{ padding: '6px 14px 0', flexShrink: 0 }}>
              <div
                role="button"
                tabIndex={0}
                aria-label="Open luminaire attachments"
                onClick={() => setAttachmentsOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setAttachmentsOpen(true);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  background: C.cardBg,
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  cursor: 'pointer',
                }}
              >
                <AttachIcon />
                <div style={{ flex: 1 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: C.textDark,
                      fontFamily: "'Inter', sans-serif",
                    }}
                  >
                    Attachments
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: C.textMuted,
                      fontFamily: "'Inter', sans-serif",
                      marginLeft: 6,
                    }}
                  >
                    {attachments.length} files
                  </span>
                </div>
                <ChevronRightSmall />
              </div>
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />
          </>
        )}
      </div>
      {/* Action buttons */}
      {b.libraryActions}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '10px 14px',
          borderTop: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => b.edit(lum)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '7px 0',
            borderRadius: RADIUS.control,
            border: `1px solid ${C.border}`,
            background: C.white,
            fontSize: 12,
            fontWeight: 600,
            color: C.textDark,
            fontFamily: "'Inter', sans-serif",
            cursor: 'pointer',
          }}
        >
          <EditPencilIcon /> Edit
        </button>
        <button
          onClick={() => b.duplicate(lum)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '7px 0',
            borderRadius: RADIUS.control,
            border: `1px solid ${C.border}`,
            background: C.white,
            fontSize: 12,
            fontWeight: 600,
            color: C.textDark,
            fontFamily: "'Inter', sans-serif",
            cursor: 'pointer',
          }}
        >
          <DuplicateIcon /> Duplicate
        </button>
        <button
          onClick={() => b.remove(lum)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '7px 0',
            borderRadius: RADIUS.control,
            border: `1px solid #fca5a5`,
            background: '#fff5f5',
            fontSize: 12,
            fontWeight: 600,
            color: '#dc2626',
            fontFamily: "'Inter', sans-serif",
            cursor: 'pointer',
          }}
        >
          <TrashIcon /> Remove
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FinalLuminairesView({
  binding: b,
  addButtonRef,
}: {
  binding: FinalLuminairesBinding;
  addButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const selectedTag = b.selected?.id;
  const tableViewport = useRef<HTMLDivElement>(null);
  const measuredRow = useRef({ width: 0, height: 52 });
  useEffect(() => {
    const container = tableViewport.current;
    if (!container || !b.reportCapacity) return;
    const update = () => {
      if (!container.clientHeight) return;
      const header = container.querySelector('thead')?.getBoundingClientRect().height ?? 36;
      const reset = container.querySelector('.v4-table-reset')?.getBoundingClientRect().height ?? 0;
      if (measuredRow.current.width !== container.clientWidth)
        measuredRow.current = { width: container.clientWidth, height: 52 };
      measuredRow.current.height = Math.max(
        measuredRow.current.height,
        ...[...container.querySelectorAll('tbody tr')].map(
          (row) => row.getBoundingClientRect().height,
        ),
      );
      b.reportCapacity?.(
        Math.max(
          1,
          Math.floor((container.clientHeight - header - reset - 16) / measuredRow.current.height),
        ),
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(container);
    const table = container.querySelector('table');
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [b.reportCapacity, b.items]);
  const setSelectedTag = b.select;
  const [checkedRows, setCheckedRows] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (b.allItems)
      setCheckedRows(
        (previous) =>
          new Set([...previous].filter((id) => b.allItems!.some((item) => item.id === id))),
      );
  }, [b.allItems]);
  const selectedLum = b.selected ? present(b.selected) : null;
  const LUMINAIRES = b.items.map(present);
  function toggleCheck(tag: string) {
    setCheckedRows((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  return (
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
      {/* ── Page title ──────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0 }}>
        <h1
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 22,
            fontWeight: 700,
            color: C.text,
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          Luminaires
        </h1>
        <p
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            color: C.textMid,
            margin: '4px 0 0',
          }}
        >
          Manage tags, technical data, and luminaire records for{' '}
          <Link
            to={b.summaryHref}
            style={{ color: 'var(--v4-accent-ink)', textDecoration: 'none' }}
          >
            this project
          </Link>
          .
        </p>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <span
            style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }}
          >
            <SearchIcon />
          </span>
          <input
            type="text"
            aria-label="Search luminaires"
            value={b.query}
            onChange={(event) => b.setQuery(event.target.value)}
            placeholder="Search luminaires..."
            style={{
              paddingLeft: 30,
              paddingRight: 10,
              height: 34,
              width: 210,
              borderRadius: RADIUS.control,
              border: `1px solid ${C.border}`,
              background: C.white,
              fontSize: 12,
              color: C.text,
              fontFamily: "'Inter', sans-serif",
              outline: 'none',
            }}
          />
        </div>
        <div className="final-luminaire-menu">
          <TBtn hasArrow onClick={b.filters}>
            <FilterIcon /> Filters
          </TBtn>
          {b.filterMenu}
        </div>
        <div className="final-luminaire-menu">
          <TBtn onClick={b.columns}>
            <ColumnsIcon /> Columns
          </TBtn>
          {b.columnMenu}
        </div>
        <div className="final-luminaire-menu">
          <TBtn hasArrow onClick={b.import}>
            <ImportIcon /> Import
          </TBtn>
          {b.importMenu}
        </div>

        <div className="final-luminaire-menu" style={{ marginLeft: 'auto' }}>
          <button
            ref={addButtonRef}
            onClick={b.add}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 16px',
              height: 34,
              background: 'var(--v4-action-primary)',
              color: 'var(--v4-action-primary-foreground)',
              border: 'none',
              borderRadius: RADIUS.control,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'Inter', sans-serif",
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(37,99,235,0.3)',
            }}
          >
            <PlusIcon /> Add Luminaire
          </button>
          {b.addMenu}
        </div>
      </div>

      {b.toolbar}
      {!!checkedRows.size && b.bulk && (
        <div
          role="toolbar"
          aria-label="Selected luminaires"
          style={{ display: 'flex', gap: 10, alignItems: 'center' }}
        >
          <strong>{checkedRows.size} selected</strong>
          <V4Button onClick={() => b.bulk?.(checkedRows, 'edit')}>
            <InlineGlyphs.SctEdit />
            Bulk edit
          </V4Button>
          <V4Button variant="danger" onClick={() => b.bulk?.(checkedRows, 'remove')}>
            <InlineGlyphs.SctRemove />
            Remove from project
          </V4Button>
          <V4Button onClick={() => setCheckedRows(new Set())}>Clear selection</V4Button>
        </div>
      )}
      {b.notice}
      {/* ── Main content: table + detail panel ──────────────────────────────── */}
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
            background: C.white,
            borderRadius: RADIUS.section,
            border: `1px solid ${C.border}`,
            boxShadow: SHADOW.card,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Table */}
          <div ref={tableViewport} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <V4ResizableTable
              tableKey="FinalLuminairesView-3"
              style={{
                width: '100%',
                minWidth: 950,
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
              }}
            >
              <colgroup>
                <col style={{ width: 38 }} />
                <col style={{ width: 68 }} />
                <col style={{ width: 52 }} />
                {b.columnsShown.map((column) => (
                  <col
                    key={column.key}
                    style={
                      column.key === 'model'
                        ? undefined
                        : {
                            width:
                              (
                                {
                                  manufacturer: 110,
                                  mounting: 82,
                                  wattage: 58,
                                  lightColor: 64,
                                  beamAngle: 86,
                                  ipRating: 50,
                                  quantity: 56,
                                } as Partial<Record<keyof LuminaireRecord, number>>
                              )[column.key] ?? 70,
                          }
                    }
                  />
                ))}
                <col style={{ width: 98 }} />
                <col style={{ width: 36 }} />
              </colgroup>
              <thead>
                <tr>
                  <th
                    style={{
                      width: 38,
                      padding: '0 0 0 12px',
                      height: 36,
                      background: 'var(--v4-surface-subtle)',
                      borderBottom: `1px solid ${C.border}`,
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                    }}
                  >
                    <input
                      type="checkbox"
                      aria-label="Select visible luminaires"
                      checked={
                        LUMINAIRES.length > 0 && LUMINAIRES.every((lum) => checkedRows.has(lum.id))
                      }
                      onChange={() =>
                        setCheckedRows((current) =>
                          LUMINAIRES.every((lum) => current.has(lum.id))
                            ? new Set(
                                [...current].filter(
                                  (id) => !LUMINAIRES.some((lum) => lum.id === id),
                                ),
                              )
                            : new Set([...current, ...LUMINAIRES.map((lum) => lum.id)]),
                        )
                      }
                      style={{ width: 14, height: 14, accentColor: 'var(--v4-accent)' }}
                    />
                  </th>
                  <TH onSort={() => b.sort('tag')}>Tag</TH>
                  <TH>Image</TH>
                  {b.columnsShown.map((column) => (
                    <TH
                      key={column.key}
                      onSort={() => b.sort(column.key)}
                      align={
                        ['wattage', 'lightColor', 'beamAngle', 'ipRating', 'quantity'].includes(
                          column.key,
                        )
                          ? 'center'
                          : 'left'
                      }
                    >
                      {column.label}
                    </TH>
                  ))}
                  <TH>Status</TH>
                  <th
                    style={{
                      width: 36,
                      background: 'var(--v4-surface-subtle)',
                      borderBottom: `1px solid ${C.border}`,
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                      padding: 0,
                      textAlign: 'center',
                    }}
                  >
                    <button
                      aria-label="Configure luminaire columns"
                      onClick={b.columns}
                      style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      <GearIcon />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {LUMINAIRES.map((lum) => {
                  const isSelected = selectedTag === lum.id;
                  const isChecked = checkedRows.has(lum.id);
                  return (
                    <tr
                      key={lum.id}
                      onClick={() => setSelectedTag(lum.id)}
                      style={{
                        background: isSelected
                          ? C.selectedRow
                          : isChecked
                            ? C.selectedRow
                            : C.white,
                        borderBottom: `1px solid ${C.borderLight}`,
                        cursor: 'pointer',
                        transition: 'background 100ms',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.background =
                            'var(--v4-surface-hover)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = isSelected
                          ? C.selectedRow
                          : C.white;
                      }}
                    >
                      <td style={{ padding: '0 0 0 12px' }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${lum.tag}`}
                          checked={isChecked}
                          onChange={() => toggleCheck(lum.id)}
                          style={{ width: 14, height: 14, accentColor: 'var(--v4-accent)' }}
                        />
                      </td>
                      <td style={{ padding: '0 8px' }}>
                        <button
                          type="button"
                          style={{
                            background: 'none',
                            border: 0,
                            padding: 0,
                            color: 'var(--v4-accent-ink)',
                            fontSize: 12,
                            fontWeight: 600,
                            textDecoration: 'none',
                            fontFamily: "'Inter', sans-serif",
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            b.select(lum.id);
                          }}
                        >
                          {lum.tag}
                        </button>
                      </td>
                      <td style={{ padding: '0 8px' }}>
                        <div
                          className="final-luminaire-image"
                          style={{
                            width: 40,
                            height: 40,
                            background: 'var(--v4-surface-base)',
                            borderRadius: 5,
                            border: `1px solid ${C.borderLight}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                          }}
                        >
                          <LuminaireImage
                            path={b.imageSources?.[lum.id] ?? lum.imagePath}
                            alt={`${lum.tag} product`}
                          />
                        </div>
                      </td>
                      {b.columnsShown.map((column) => (
                        <td
                          key={column.key}
                          style={{
                            padding: '6px 8px',
                            fontSize: 12,
                            color: C.textDark,
                            fontFamily: "'Inter', sans-serif",
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: ['model', 'description', 'notes'].includes(column.key)
                              ? 'normal'
                              : 'nowrap',
                            overflowWrap: 'anywhere',
                            textAlign: [
                              'wattage',
                              'lightColor',
                              'beamAngle',
                              'ipRating',
                              'quantity',
                            ].includes(column.key)
                              ? 'center'
                              : 'left',
                          }}
                        >
                          {displayLuminaireTechnicalValue(
                            column.key,
                            String(lum[column.key] ?? ''),
                          )}
                        </td>
                      ))}
                      <td style={{ padding: '0 8px' }}>
                        <StatusBadge status={lum.status} />
                      </td>
                      <td
                        style={{ padding: 0, textAlign: 'center' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <V4ActionMenu
                          label={`Actions for ${lum.tag}`}
                          actions={[
                            { label: 'Edit', icon: <EditPencilIcon />, run: () => b.edit(lum) },
                            {
                              label: 'Duplicate',
                              icon: <DuplicateIcon />,
                              run: () => b.duplicate(lum),
                            },
                            {
                              label: 'Remove from project',
                              icon: <TrashIcon />,
                              run: () => b.remove(lum),
                            },
                          ]}
                        />
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
              borderTop: `1px solid ${C.border}`,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 12, color: C.textMid, fontFamily: "'Inter', sans-serif" }}>
              Showing {b.total ? b.page * b.pageSize + 1 : 0} to{' '}
              {b.page * b.pageSize + b.items.length} of {b.total} luminaires
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: C.textMid, fontFamily: "'Inter', sans-serif" }}>
                  Rows per page
                </span>
                <V4FilterSelect
                  label="Rows per page"
                  value={String(b.requestedPageSize ?? b.pageSize)}
                  options={[...new Set([0, b.pageSize, 10, 25, 50])]
                    .sort((a, b) => a - b)
                    .map((value) => ({
                      value: String(value),
                      label: value ? String(value) : 'Auto / window',
                    }))}
                  onChange={(value) => b.setPageSize(Number(value))}
                  triggerStyle={{
                    padding: '4px 8px',
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    fontSize: 12,
                    color: C.textDark,
                    background: C.white,
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {[
                  { icon: <ChevronsLeft />, disabled: b.page === 0, page: 0, label: 'First page' },
                  {
                    icon: <ChevronLeft />,
                    disabled: b.page === 0,
                    page: b.page - 1,
                    label: 'Previous page',
                  },
                ].map((btn, i) => (
                  <button
                    key={i}
                    aria-label={btn.label}
                    onClick={() => b.setPage(btn.page)}
                    disabled={btn.disabled}
                    style={{
                      width: 28,
                      height: 28,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      background: C.white,
                      cursor: btn.disabled ? 'default' : 'pointer',
                      opacity: btn.disabled ? 0.4 : 1,
                    }}
                  >
                    {btn.icon}
                  </button>
                ))}
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
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {b.page + 1}
                </button>
                {[
                  {
                    icon: <ChevronRight />,
                    disabled: b.page >= b.pages - 1,
                    page: b.page + 1,
                    label: 'Next page',
                  },
                  {
                    icon: <ChevronsRight />,
                    disabled: b.page >= b.pages - 1,
                    page: b.pages - 1,
                    label: 'Last page',
                  },
                ].map((btn, i) => (
                  <button
                    key={i}
                    aria-label={btn.label}
                    onClick={() => b.setPage(btn.page)}
                    disabled={btn.disabled}
                    style={{
                      width: 28,
                      height: 28,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      background: C.white,
                      cursor: btn.disabled ? 'default' : 'pointer',
                      opacity: btn.disabled ? 0.4 : 1,
                    }}
                  >
                    {btn.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selectedLum && (
          <DetailPanel b={b} lum={selectedLum} onClose={() => setSelectedTag(null)} />
        )}
      </div>
    </div>
  );
}
