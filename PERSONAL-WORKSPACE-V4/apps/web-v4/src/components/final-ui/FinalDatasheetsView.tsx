import { V4ResizableTable } from '../common/V4ResizableTable';
import * as InlineGlyphs from '../common/SctIcons';
import { sctIcons as ApprovedIcons } from '../common/SctIcons';
import { Link } from 'react-router-dom';
import { C, SHADOW, RADIUS, LAYOUT } from './tokens';
import type { LuminaireAssetVersion, LuminaireAssetType } from '@scli/domain';
import type {
  LuminaireAssetRow,
  AssetFilter,
} from '../../pages/datasheets-images/datasheetsImagesViewModel';
import { LuminaireImage } from '../../pages/project-luminaires/LuminaireImage';
import { displayLuminaireTechnicalValue } from '../common/luminaireTechnicalDisplay';
import { V4FilterSelect } from '../common/V4FilterSelect';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
export interface FinalDatasheetsBinding {
  items: LuminaireAssetRow[];
  selected: LuminaireAssetRow | null;
  counts: { missingDatasheets: number; missingImages: number; complete: number };
  query: string;
  setQuery: (value: string) => void;
  filter: AssetFilter;
  setFilter: (value: AssetFilter) => void;
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  setPage: (value: number) => void;
  setPageSize: (value: number) => void;
  select: (id: string | null) => void;
  attach: (id: string | null, type: 'Datasheet' | 'ProductImage') => void;
  history: (id: string, type: LuminaireAssetType) => void;
  openAsset: (version: LuminaireAssetVersion) => void;
  saveAsset: (version: LuminaireAssetVersion) => void;
  editNotes: (row: LuminaireAssetRow) => void;
  luminaireHref: (id: string, edit?: boolean) => string;
  sort: () => void;
  notice: React.ReactNode;
}

// ── Data ──────────────────────────────────────────────────────────────────────

type LumRow = LuminaireAssetRow & {
  id: string;
  tag: string;
  typeName: string;
  typeDetail: string;
  dsStatus: 'complete' | 'missing';
  imgStatus: 'complete' | 'missing';
  dsVersion: string;
  dsDate: string;
  imgVersion: string;
  imgDate: string;
};
const versionDate = (version: LuminaireAssetVersion | null) =>
  version
    ? version.backfilled
      ? 'Migrated'
      : formatBusinessDateTime(version.attachedAt, { dateStyle: 'medium' })
    : '';
const present = (row: LuminaireAssetRow): LumRow => ({
  ...row,
  id: row.luminaire.id,
  tag: row.luminaire.tag,
  typeName: row.luminaire.category || '—',
  typeDetail: row.luminaire.description || '—',
  dsStatus: row.assets.datasheet ? 'complete' : 'missing',
  imgStatus: row.assets.productImage ? 'complete' : 'missing',
  dsVersion: row.assets.datasheet ? `v${row.assets.datasheet.versionSequence}` : '',
  dsDate: versionDate(row.assets.datasheet),
  imgVersion: row.assets.productImage ? `v${row.assets.productImage.versionSequence}` : '',
  imgDate: versionDate(row.assets.productImage),
});
const assetContentUrl = (file: LuminaireAssetVersion) =>
  `/api/projects/${file.projectId}/luminaires/${file.luminaireId}/asset-versions/${file.id}/content`;
const readableName = (file: LuminaireAssetVersion) =>
  file.fileName.replace(/^[a-f0-9]{64}[-_]/i, '');
const bytes = (value: number | null) =>
  value === null
    ? ''
    : value < 1024
      ? `${value} B`
      : value < 1048576
        ? `${Math.round(value / 1024)} KB`
        : `${(value / 1048576).toFixed(1)} MB`;
function CheckCircleIcon({ color = '#16a34a' }: { color?: string }) {
  return <InlineGlyphs.SctSuccess width="14" height="14" color={color} />;
}

function MissingIcon() {
  return <ApprovedIcons.warning size={16} />;
}

function SearchIcon() {
  return <ApprovedIcons.search size={16} />;
}

function ChevronDown() {
  return <InlineGlyphs.SctExpand width="11" height="11" color="currentColor" />;
}

function ChevronUp() {
  return <InlineGlyphs.SctCollapse width="8" height="8" color={C.textMuted} />;
}

function CloseIcon() {
  return <ApprovedIcons.close size={16} />;
}

function HistoryIcon() {
  return <InlineGlyphs.History size={16} />;
}

function AttachPaperclipIcon() {
  return <ApprovedIcons.attachment size={16} />;
}

function ChevLeft() {
  return <InlineGlyphs.SctBack width="12" height="12" color="currentColor" />;
}

function ChevRight() {
  return <InlineGlyphs.SctNext width="12" height="12" color="currentColor" />;
}

function DownloadIcon() {
  return <ApprovedIcons.download size={16} />;
}

function ExternalLink() {
  return <InlineGlyphs.SctOpen width="12" height="12" color="#2563eb" />;
}

function PdfIcon() {
  return <ApprovedIcons.pdf size={28} />;
}

function JpgIcon() {
  return <ApprovedIcons.image size={28} />;
}

// ── Status chip ───────────────────────────────────────────────────────────────

function StatusCell({
  status,
  version,
  date,
}: {
  status: 'complete' | 'missing';
  version?: string;
  date?: string;
}) {
  if (status === 'complete') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <CheckCircleIcon />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#16a34a',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            Complete
          </span>
        </div>
        {version && date && (
          <span style={{ fontSize: 11, color: C.textMuted, fontFamily: "'Inter', sans-serif" }}>
            {version} · {date}
          </span>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <MissingIcon />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#ea580c',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          Missing
        </span>
      </div>
      <span style={{ fontSize: 11, color: C.textMuted, fontFamily: "'Inter', sans-serif" }}>
        Not attached
      </span>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  value,
  label,
  valueColor,
  iconBg,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  valueColor: string;
  iconBg: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        cursor: 'pointer',
        textAlign: 'left',
        outline: active ? '2px solid var(--v4-accent-ink)' : undefined,
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 18px',
        background: C.white,
        borderRadius: RADIUS.card,
        border: `1px solid ${C.border}`,
        boxShadow: SHADOW.card,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: valueColor,
            fontFamily: "'Inter', sans-serif",
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
        <div
          style={{
            fontSize: 12,
            color: C.textMid,
            fontFamily: "'Inter', sans-serif",
            marginTop: 1,
          }}
        >
          {label}
        </div>
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
  row: LumRow;
  onClose: () => void;
  b: FinalDatasheetsBinding;
}) {
  const files = [row.assets.datasheet, row.assets.productImage].filter(
    (file): file is LuminaireAssetVersion => file !== null,
  );
  const missing = (['Datasheet', 'ProductImage'] as const).filter((type) =>
    type === 'Datasheet' ? !row.assets.datasheet : !row.assets.productImage,
  );
  const latest = [...files].sort((a, b) => b.attachedAt.localeCompare(a.attachedAt))[0];
  const actor = latest?.attachedByNameSnapshot ?? null;
  return (
    <div
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
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '14px 14px 10px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: C.text,
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {row.tag}
          </div>
          <div
            style={{
              fontSize: 12,
              color: C.textMid,
              fontFamily: "'Inter', sans-serif",
              marginTop: 1,
            }}
          >
            {row.typeName}
          </div>
        </div>
        <button
          aria-label="Close asset details"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 3,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <CloseIcon />
        </button>
      </div>

      <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
        {/* Product image + specs */}
        <div style={{ padding: '12px 14px 0', display: 'flex', gap: 12, flexShrink: 0 }}>
          <div
            role={row.assets.productImage ? 'button' : undefined}
            tabIndex={row.assets.productImage ? 0 : undefined}
            aria-label={row.assets.productImage ? `Open ${row.tag} product image` : undefined}
            onClick={(event) => {
              event.stopPropagation();
              if (row.assets.productImage) b.openAsset(row.assets.productImage);
            }}
            onKeyDown={(event) => {
              if (row.assets.productImage && ['Enter', ' '].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                b.openAsset(row.assets.productImage);
              }
            }}
            className="final-luminaire-image"
            style={{
              width: 90,
              height: 90,
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
              path={
                row.assets.productImage
                  ? assetContentUrl(row.assets.productImage)
                  : row.luminaire.imagePath
              }
              alt={`${row.tag} product`}
            />
          </div>
          <V4ResizableTable
            tableKey="FinalDatasheetsView-1"
            style={{
              flex: 1,
              borderCollapse: 'collapse',
              fontSize: 11,
              fontFamily: "'Inter', sans-serif",
              alignSelf: 'flex-start',
            }}
          >
            <tbody>
              {[
                ['Type', row.luminaire.category || '—'],
                ['Manufacturer', row.luminaire.manufacturer || '—'],
                ['Series / Model', row.luminaire.model || '—'],
                ['Wattage', displayLuminaireTechnicalValue('wattage', row.luminaire.wattage)],
                ['CCT', displayLuminaireTechnicalValue('lightColor', row.luminaire.lightColor)],
              ].map(([label, val]) => (
                <tr key={label}>
                  <td
                    style={{
                      color: C.textMuted,
                      paddingBottom: 4,
                      paddingRight: 8,
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
                      paddingBottom: 4,
                      verticalAlign: 'top',
                    }}
                  >
                    {val}
                  </td>
                </tr>
              ))}
            </tbody>
          </V4ResizableTable>
        </div>

        {/* View in Luminaires */}
        <div style={{ padding: '8px 14px 0', flexShrink: 0 }}>
          <Link
            to={b.luminaireHref(row.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
              color: '#2563eb',
              fontFamily: "'Inter', sans-serif",
              textDecoration: 'none',
            }}
          >
            View in Luminaires <ExternalLink />
          </Link>
        </div>

        {/* Divider */}
        <div style={{ margin: '10px 0 0', borderTop: `1px solid ${C.borderLight}` }} />

        {/* Linked Files */}
        <div style={{ padding: '10px 14px 0', flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: C.text,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              Linked Files
            </span>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 99,
                background: missing.length ? '#fff7ed' : '#dcfce7',
                border: `1px solid ${missing.length ? '#fed7aa' : '#bbf7d0'}`,
                color: missing.length ? '#c2410c' : '#16a34a',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {missing.length ? 'Incomplete' : 'Complete'}
            </span>
          </div>

          {files.map((file) => (
            <div
              key={file.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                padding: '7px 10px',
                background: C.cardBg,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                marginBottom: 6,
              }}
            >
              {file.assetType === 'Datasheet' ? <PdfIcon /> : <JpgIcon />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: C.textDark,
                    fontFamily: "'Inter', sans-serif",
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                  }}
                  title={readableName(file)}
                >
                  <button
                    type="button"
                    className="v4-asset-file-name"
                    onClick={() => b.openAsset(file)}
                  >
                    {readableName(file)}
                  </button>
                </div>
                <div
                  style={{ fontSize: 10, color: C.textMuted, fontFamily: "'Inter', sans-serif" }}
                >
                  {[
                    file.mimeType.split('/').at(-1)?.toUpperCase(),
                    bytes(file.sizeBytes),
                    `v${file.versionSequence}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: C.textMuted,
                  fontFamily: "'Inter', sans-serif",
                  whiteSpace: 'nowrap',
                }}
              >
                {versionDate(file)}
              </span>
              <button
                aria-label={`Save a copy of ${readableName(file)}`}
                title="Save a copy"
                onClick={() => b.saveAsset(file)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                }}
              >
                <DownloadIcon />
              </button>
              <button
                aria-label={`Version history for ${readableName(file)}`}
                title="Version History"
                onClick={() => b.history(row.id, file.assetType)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                }}
              >
                <HistoryIcon />
              </button>
            </div>
          ))}
        </div>

        {/* Missing Items */}
        <div style={{ padding: '10px 14px 0', flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: C.text,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              Missing Items
            </span>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 99,
                background: '#ea580c',
                color: 'var(--v4-action-primary-foreground)',
                fontSize: 10,
                fontWeight: 700,
                fontFamily: "'Inter', sans-serif",
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {missing.length}
            </span>
          </div>
          {missing.map((type) => (
            <div
              key={type}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                background: C.cardBg,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
              }}
            >
              {type === 'Datasheet' ? (
                <ApprovedIcons.pdf size={16} />
              ) : (
                <ApprovedIcons.image size={16} />
              )}
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: C.textDark,
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {type === 'Datasheet' ? 'Datasheet' : 'Product image'}
                </div>
                <div
                  style={{ fontSize: 10, color: C.textMuted, fontFamily: "'Inter', sans-serif" }}
                >
                  {type === 'Datasheet' ? 'No datasheet attached' : 'No product image attached'}
                </div>
              </div>
              <button
                onClick={() => b.attach(row.id, type)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid #bfdbfe',
                  background: 'var(--v4-accent-selected)',
                  color: 'var(--v4-accent-ink)',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "'Inter', sans-serif",
                  cursor: 'pointer',
                }}
              >
                Attach
              </button>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div style={{ padding: '10px 14px 0', flexShrink: 0 }}>
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
                fontSize: 13,
                fontWeight: 600,
                color: C.text,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              Notes
            </span>
            <button
              type="button"
              aria-label="Edit luminaire notes"
              onClick={() => b.editNotes(row)}
              style={{
                textDecoration: 'none',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                color: '#2563eb',
                fontFamily: "'Inter', sans-serif",
                padding: 0,
              }}
            >
              Edit
            </button>
          </div>
          <p
            style={{
              fontSize: 12,
              color: C.textSub,
              fontFamily: "'Inter', sans-serif",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {row.luminaire.notes || '—'}
          </p>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />
      </div>
      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderTop: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{ fontSize: 11, color: C.textMuted, fontFamily: "'Inter', sans-serif", flex: 1 }}
        >
          Last updated {latest ? versionDate(latest) : '—'}
        </span>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 99,
            background: '#6A42AB',
            color: 'var(--v4-action-primary-foreground)',
            fontSize: 9,
            fontWeight: 700,
            fontFamily: "'Inter', sans-serif",
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {actor
            ? actor
                .split(/\s+/)
                .map((part) => part[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()
            : '—'}
        </div>
        <span
          style={{
            fontSize: 11,
            color: C.textMuted,
            fontFamily: "'Inter', sans-serif",
            whiteSpace: 'nowrap',
          }}
        >
          {actor ? `by ${actor}` : '—'}
        </span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FinalDatasheetsView({ binding: b }: { binding: FinalDatasheetsBinding }) {
  const selectedTag = b.selected?.luminaire.id;
  const setSelectedTag = b.select;
  const selectedRow = b.selected ? present(b.selected) : null;
  const ROWS = b.items.map(present);
  const missingDs = b.counts.missingDatasheets;
  const missingImg = b.counts.missingImages;
  const complete = b.counts.complete;
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
      {/* ── Page title ──────────────────────────────────────────────── */}
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
          Datasheets &amp; Images
        </h1>
        <p
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            color: C.textMid,
            margin: '4px 0 0',
          }}
        >
          Track datasheet and product image completeness for all luminaires.
        </p>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: LAYOUT.sectionGap, flexShrink: 0 }}>
        <StatCard
          icon={<InlineGlyphs.SctWarning width="20" height="20" color="#dc2626" />}
          value={missingDs}
          label="Missing Datasheets"
          active={b.filter === 'missing-datasheet'}
          onClick={() =>
            b.setFilter(b.filter === 'missing-datasheet' ? 'all' : 'missing-datasheet')
          }
          valueColor="#dc2626"
          iconBg="#fee2e2"
        />
        <StatCard
          icon={<InlineGlyphs.SctImage width="20" height="20" color="#ea580c" />}
          value={missingImg}
          label="Images Missing"
          active={b.filter === 'missing-image'}
          onClick={() => b.setFilter(b.filter === 'missing-image' ? 'all' : 'missing-image')}
          valueColor="#ea580c"
          iconBg="#fff7ed"
        />
        <StatCard
          icon={<InlineGlyphs.SctSuccess width="20" height="20" color="#16a34a" />}
          value={complete}
          label="Complete"
          active={b.filter === 'complete'}
          onClick={() => b.setFilter(b.filter === 'complete' ? 'all' : 'complete')}
          valueColor="#16a34a"
          iconBg="#dcfce7"
        />
      </div>

      {b.notice}
      {/* ── Main content: table card + detail panel ──────────────────── */}
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
          {/* Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              borderBottom: `1px solid ${C.border}`,
              flexShrink: 0,
            }}
          >
            <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
              <span
                style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)' }}
              >
                <SearchIcon />
              </span>
              <input
                type="text"
                aria-label="Search assets"
                value={b.query}
                onChange={(event) => b.setQuery(event.target.value)}
                placeholder="Search by tag, type, manufacturer..."
                style={{
                  paddingLeft: 30,
                  paddingRight: 10,
                  height: 34,
                  width: '100%',
                  borderRadius: RADIUS.control,
                  border: `1px solid ${C.border}`,
                  background: C.white,
                  fontSize: 12,
                  color: C.text,
                  fontFamily: "'Inter', sans-serif",
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <V4FilterSelect
              label="Asset completeness"
              value={b.filter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'missing', label: 'Missing Only' },
                { value: 'missing-datasheet', label: 'Missing Datasheet' },
                { value: 'missing-image', label: 'Missing Image' },
                { value: 'complete', label: 'Complete' },
              ]}
              onChange={(value) => b.setFilter(value as AssetFilter)}
              triggerStyle={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 12px',
                height: 34,
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: RADIUS.control,
                fontSize: 12,
                fontWeight: 500,
                color: C.textDark,
                fontFamily: "'Inter', sans-serif",
              }}
              chevron={<ChevronDown />}
            />

            <div style={{ marginLeft: 'auto' }}>
              <button
                disabled={!b.total && !b.selected}
                onClick={() => b.attach(selectedTag ?? null, 'Datasheet')}
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
                <AttachPaperclipIcon /> Attach Document
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <V4ResizableTable
              tableKey="FinalDatasheetsView-2"
              style={{
                width: '100%',
                minWidth: 660,
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
              }}
            >
              <colgroup>
                <col style={{ width: 40 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 52 }} />
              </colgroup>
              <thead>
                <tr>
                  <th
                    style={{
                      padding: '0 0 0 14px',
                      height: 38,
                      background: 'var(--v4-surface-subtle)',
                      borderBottom: `1px solid ${C.border}`,
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                    }}
                  />
                  {[
                    { label: 'Tag', hasSort: true },
                    { label: 'Type' },
                    { label: 'Datasheet Status' },
                    { label: 'Image Status' },
                    { label: 'Preview' },
                    { label: 'Actions' },
                  ].map(({ label, hasSort }) => (
                    <th
                      key={label}
                      style={{
                        padding: '0 12px',
                        height: 38,
                        textAlign: 'left',
                        fontSize: 11,
                        fontWeight: 600,
                        color: C.textMuted,
                        fontFamily: "'Inter', sans-serif",
                        letterSpacing: '0.02em',
                        background: 'var(--v4-surface-subtle)',
                        borderBottom: `1px solid ${C.border}`,
                        whiteSpace: 'nowrap',
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                      }}
                    >
                      <button
                        disabled={!hasSort}
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
                        {hasSort && <ChevronUp />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const isSelected = selectedTag === row.id;
                  return (
                    <tr
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Assets for ${row.tag}`}
                      onKeyDown={(event) => {
                        if (
                          event.target === event.currentTarget &&
                          (event.key === 'Enter' || event.key === ' ')
                        ) {
                          event.preventDefault();
                          setSelectedTag(row.id);
                        }
                      }}
                      onClick={() => setSelectedTag(row.id)}
                      style={{
                        background: isSelected ? 'var(--v4-accent-selected)' : C.white,
                        borderBottom: `1px solid ${C.borderLight}`,
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
                          : C.white;
                      }}
                    >
                      <td style={{ padding: '0 0 0 14px', verticalAlign: 'middle' }}>
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 99,
                            border: `2px solid ${isSelected ? '#2563eb' : C.border}`,
                            background: isSelected ? '#2563eb' : C.white,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isSelected && (
                            <div
                              style={{ width: 6, height: 6, borderRadius: 99, background: 'white' }}
                            />
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: C.text,
                            fontFamily: "'Inter', sans-serif",
                          }}
                        >
                          {row.tag}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: C.textMid,
                            fontFamily: "'Inter', sans-serif",
                          }}
                        >
                          {row.typeName}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                        <div
                          style={{
                            fontSize: 12,
                            color: C.textDark,
                            fontFamily: "'Inter', sans-serif",
                          }}
                        >
                          {row.typeName}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: C.textMid,
                            fontFamily: "'Inter', sans-serif",
                          }}
                        >
                          {row.typeDetail}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                        <StatusCell
                          status={row.dsStatus}
                          version={row.dsVersion}
                          date={row.dsDate}
                        />
                      </td>
                      <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                        <StatusCell
                          status={row.imgStatus}
                          version={row.imgVersion}
                          date={row.imgDate}
                        />
                      </td>
                      <td style={{ padding: '8px 12px', verticalAlign: 'middle' }}>
                        <div
                          role={row.assets.productImage ? 'button' : undefined}
                          tabIndex={row.assets.productImage ? 0 : undefined}
                          aria-label={
                            row.assets.productImage ? `Open ${row.tag} product image` : undefined
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            if (row.assets.productImage) b.openAsset(row.assets.productImage);
                          }}
                          onKeyDown={(event) => {
                            if (row.assets.productImage && ['Enter', ' '].includes(event.key)) {
                              event.preventDefault();
                              event.stopPropagation();
                              b.openAsset(row.assets.productImage);
                            }
                          }}
                          className="final-luminaire-image"
                          style={{
                            width: 48,
                            height: 48,
                            background: 'var(--v4-surface-base)',
                            borderRadius: 6,
                            border: `1px solid ${C.borderLight}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                          }}
                        >
                          <LuminaireImage
                            path={
                              row.assets.productImage
                                ? assetContentUrl(row.assets.productImage)
                                : row.luminaire.imagePath
                            }
                            alt={`${row.tag} product`}
                          />
                        </div>
                      </td>
                      <td
                        style={{ padding: '0 12px', verticalAlign: 'middle', textAlign: 'center' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          aria-label={`Attach document to ${row.tag}`}
                          title="Attach Document"
                          onClick={() => b.attach(row.id, 'Datasheet')}
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
                          <AttachPaperclipIcon />
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
              borderTop: `1px solid ${C.border}`,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 12, color: C.textMid, fontFamily: "'Inter', sans-serif" }}>
              Showing {b.total ? b.page * b.pageSize + 1 : 0} to{' '}
              {b.page * b.pageSize + b.items.length} of {b.total} luminaires
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
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  background: C.white,
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
                  fontFamily: "'Inter', sans-serif",
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
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  background: C.white,
                  cursor: 'default',
                  opacity: 0.4,
                }}
              >
                <ChevRight />
              </button>
              <V4FilterSelect
                label="Rows per page"
                value={String(b.pageSize)}
                options={[...new Set([b.pageSize, 10, 25, 50])]
                  .sort((a, b) => a - b)
                  .map((value) => ({
                    value: String(value),
                    label: `${value} / page`,
                  }))}
                onChange={(value) => b.setPageSize(Number(value))}
                triggerStyle={{
                  padding: '4px 8px',
                  marginLeft: 8,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  fontSize: 12,
                  color: C.textDark,
                  background: C.white,
                }}
              />
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selectedRow && (
          <DetailPanel b={b} row={selectedRow} onClose={() => setSelectedTag(null)} />
        )}
      </div>
    </div>
  );
}
