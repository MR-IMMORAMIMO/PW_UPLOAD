import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import { V4ResizableTable } from '../common/V4ResizableTable';
import * as InlineGlyphs from '../common/SctIcons';
import { useWindowPageSize } from '../common/useWindowPageSize';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/environment';
import type { LibraryWorkspaceBinding } from '../../pages/luminaire-library/LibraryWorkspaceController';
import {
  libraryProductViews,
  type LibraryProductView,
} from '../../pages/luminaire-library/libraryViewModel';
import './referenceUtilities.css';
import { useFinalUiPreferences } from './useFinalUiPreferences';
import { useMemo, useState, useRef, useId, useEffect } from 'react';
import { V4AnchoredSurface } from '../interaction/V4AnchoredSurface';
import { C as AC, SHADOW, STATUS } from './tokens';
import StatusChip from './ds/StatusChip';
import { SctCompare, SctPdf, SctImage, SctIes, SctBim } from '../common/SctIcons';
import { V4FloatingWorkspace } from '../common/V4FloatingWorkspace';
import { V4Button } from '../common/V4Button';
import type { LuminaireLibraryVariantDraft } from '@scli/domain';

import KpiCard from './ds/KpiCard';
import { InspectorSection, InspectorDivider } from './ds/InspectorSection';

// ── Status config ──────────────────────────────────────────────────────────────
type LumStatus = 'Published' | 'Draft' | 'Review' | 'Archived';

// ── Data ──────────────────────────────────────────────────────────────────────
interface Luminaire extends LibraryProductView {
  id: string;
  name: string;
  sub: string;
  manufacturer: string;
  family: string;
  ordering: string;
  version: string;
  cct: string;
  power: string;
  ip: string;
  status: LumStatus;
  updated: string;
  updatedBy: string;
}

// ── Luminaire thumbnail SVG ────────────────────────────────────────────────────
function LumThumb({ sub }: { sub: string }) {
  const s = sub.toLowerCase();
  if (s === 'downlight')
    return (
      <svg viewBox="0 0 36 36" className="w-8 h-8" fill="none">
        <circle cx="18" cy="18" r="15" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
        <circle cx="18" cy="18" r="9" fill="#eef2f7" stroke="#d1d9e0" strokeWidth="1" />
        <circle cx="18" cy="18" r="4" fill="#cbd5e1" />
        <circle cx="18" cy="18" r="1.5" fill="#94a3b8" />
      </svg>
    );
  if (s.includes('linear') || s.includes('high bay'))
    return (
      <svg viewBox="0 0 36 36" className="w-8 h-8" fill="none">
        <rect
          x="3"
          y="13"
          width="30"
          height="10"
          rx="2.5"
          fill="#f1f5f9"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        <rect x="6" y="15.5" width="24" height="5" rx="1.5" fill="#e2e8f0" />
      </svg>
    );
  if (s.includes('wall'))
    return (
      <svg viewBox="0 0 36 36" className="w-8 h-8" fill="none">
        <rect
          x="5"
          y="7"
          width="7"
          height="22"
          rx="2"
          fill="#f1f5f9"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        <path
          d="M12 11 Q28 13 28 18 Q28 23 12 25Z"
          fill="#eef2f7"
          stroke="#d1d9e0"
          strokeWidth="1"
        />
      </svg>
    );
  if (s.includes('spot'))
    return (
      <svg viewBox="0 0 36 36" className="w-8 h-8" fill="none">
        <circle cx="18" cy="13" r="7" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="1" />
        <circle cx="18" cy="13" r="3.5" fill="#e2e8f0" />
        <path
          d="M12 20L9 30M18 20v10M24 20L27 30"
          stroke="#e2e8f0"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  if (s.includes('flood'))
    return (
      <svg viewBox="0 0 36 36" className="w-8 h-8" fill="none">
        <rect
          x="6"
          y="11"
          width="16"
          height="14"
          rx="2"
          fill="#f1f5f9"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        <path d="M22 14L31 9v18L22 22Z" fill="#eef2f7" stroke="#d1d9e0" strokeWidth="1" />
      </svg>
    );
  if (s.includes('bollard'))
    return (
      <svg viewBox="0 0 36 36" className="w-8 h-8" fill="none">
        <rect
          x="14"
          y="25"
          width="8"
          height="7"
          rx="1"
          fill="#e2e8f0"
          stroke="#cbd5e1"
          strokeWidth="1"
        />
        <rect
          x="12"
          y="9"
          width="12"
          height="18"
          rx="3"
          fill="#f1f5f9"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        <rect x="14" y="11" width="8" height="6" rx="1" fill="#e2e8f0" />
      </svg>
    );
  if (s.includes('emergency'))
    return (
      <svg viewBox="0 0 36 36" className="w-8 h-8" fill="none">
        <rect
          x="4"
          y="13"
          width="28"
          height="11"
          rx="2"
          fill="#fef9c3"
          stroke="#fde047"
          strokeWidth="1"
        />
        <rect x="7" y="15.5" width="8" height="5.5" rx="1" fill="#fde047" />
        <rect x="21" y="15.5" width="8" height="5.5" rx="1" fill="#fde047" />
      </svg>
    );
  return (
    <svg viewBox="0 0 36 36" className="w-8 h-8" fill="none">
      <rect
        x="4"
        y="4"
        width="28"
        height="28"
        rx="4"
        fill="#f1f5f9"
        stroke="#e2e8f0"
        strokeWidth="1"
      />
      <circle cx="18" cy="18" r="7" fill="#e2e8f0" stroke="#d1d9e0" strokeWidth="1" />
    </svg>
  );
}

function KpiIcon({ id }: { id: string }) {
  const Glyph =
    id === 'published'
      ? ApprovedIcons.published
      : id === 'drafts'
        ? ApprovedIcons.draft
        : id === 'mfr'
          ? ApprovedIcons.manufacturer
          : ApprovedIcons.warning;
  return <Glyph size={20} />;
}

// StatusChip is now StatusChip from ds/StatusChip — see import above

// ── Right inspector ────────────────────────────────────────────────────────────
function Inspector({
  lum,
  onClose,
  binding,
}: {
  lum: Luminaire;
  onClose: () => void;
  binding: LibraryWorkspaceBinding;
}) {
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);
  const versions = useQuery({
    queryKey: ['v4', 'library', 'variant', lum.variantId, 'versions'],
    queryFn: () => api.luminaireLibraryVariantVersions(lum.variantId!),
    enabled: Boolean(lum.variantId),
  });
  const detail = useQuery({
    queryKey: ['v4', 'library', 'product', lum.productId],
    queryFn: () => api.luminaireLibraryProduct(lum.productId),
  });
  const entry = detail.data?.variants.find((item) => item.variant.variantId === lum.variantId);
  const comparisonFields: Array<keyof LuminaireLibraryVariantDraft> = [
    'variantLabel',
    'orderingCode',
    'wattage',
    'lumens',
    'lightColor',
    'cri',
    'beamAngle',
    'ipRating',
    'mounting',
    'cutout',
    'driver',
    'control',
    'emergency',
    'dimensions',
    'bodyColorFinish',
  ];
  const publishedAssets = entry?.latestVersion?.snapshot.assetVersionIds;
  const availableAssets = (detail.data?.assets ?? [])
    .filter((item) => !item.asset.variantId || item.asset.variantId === lum.variantId)
    .flatMap((item) =>
      item.versions
        .filter((version) =>
          publishedAssets
            ? publishedAssets.includes(version.assetVersionId)
            : version === item.versions[0],
        )
        .map((version) => ({ type: item.asset.assetType, version })),
    );
  const assetFor = (label: string) =>
    availableAssets.find((item) =>
      label === 'Product Image'
        ? item.type === 'ProductImage'
        : label === 'IES / LDT'
          ? item.type === 'IES' || item.type === 'LDT'
          : item.type === label,
    );
  return (
    <div
      role="complementary"
      aria-label="Selected product inspector"
      className="flex flex-col overflow-hidden rounded-xl flex-shrink-0"
      style={{
        width: '25%',
        minWidth: 280,
        background: AC.white,
        border: `1px solid ${AC.border}`,
        boxShadow: SHADOW.card,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: AC.border }}
      >
        <h2 className="text-[12px] font-bold truncate" style={{ color: AC.text }}>
          {lum.name}
        </h2>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
          <StatusChip status={lum.status} />
          <button
            aria-label="Close product inspector"
            onClick={onClose}
            className="p-0.5 rounded hover:bg-gray-100 transition-colors ml-1"
            style={{ color: AC.textMuted }}
          >
            <InlineGlyphs.SctClose className="w-3 h-3" color="currentColor" />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Product image + meta — side by side */}
        <div
          className="flex gap-3 p-3 border-b"
          style={{ borderColor: AC.border, background: 'var(--v4-surface-subtle)' }}
        >
          {/* Square image */}
          <div
            className="flex-shrink-0 flex items-center justify-center rounded-xl overflow-hidden"
            style={{
              width: 122,
              minWidth: 122,
              height: 122,
              background: AC.white,
              border: `1px solid ${AC.border}`,
            }}
          >
            {lum.imageUrl ? (
              <img src={lum.imageUrl} alt={lum.name} className="w-full h-full object-contain" />
            ) : (
              <InlineGlyphs.SctLuminaires aria-label="No product image" className="w-full h-full" />
            )}
          </div>

          {/* Brand + meta fields beside the image */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
            <div className="flex items-center gap-1">
              <InlineGlyphs.SctNext className="w-2.5 h-2.5 flex-shrink-0" color={AC.textMuted} />
              <span
                className="text-[10px] font-bold tracking-widest uppercase truncate"
                style={{ color: AC.blueAlt }}
              >
                {lum.manufacturer}
              </span>
            </div>
            {[
              { l: 'Product Family', v: lum.family },
              { l: 'Ordering Code', v: lum.ordering },
              { l: 'Version', v: lum.version },
            ].map((f) => (
              <div key={f.l} className="min-w-0">
                <div
                  className="text-[9px] font-semibold uppercase tracking-wider leading-none"
                  style={{ color: AC.textMuted }}
                >
                  {f.l}
                </div>
                <div
                  className="text-[11px] font-semibold mt-0.5 truncate"
                  style={{ color: AC.text }}
                >
                  {f.v}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="px-3 py-3 space-y-3">
          {/* Description */}
          <p className="text-[11px] leading-relaxed" style={{ color: AC.textSub }}>
            {lum.description}
          </p>

          {/* Specs */}
          <div
            className="grid grid-cols-3 gap-x-2 gap-y-2 py-2 border-t border-b"
            style={{ borderColor: AC.borderLight }}
          >
            {[
              { l: 'CCT', v: lum.cct },
              { l: 'Power', v: lum.power },
              { l: 'Efficacy', v: lum.efficacy },
              { l: 'CRI', v: lum.cri },
              { l: 'IP Rating', v: lum.ip },
              { l: 'Control', v: lum.control },
              { l: 'Beam Angle', v: lum.beamAngle },
              { l: 'Cut-out', v: lum.cutout },
              { l: 'Lifetime L70', v: lum.lifetime },
            ].map((s) => (
              <div key={s.l}>
                <div
                  className="text-[8px] font-semibold uppercase tracking-wider"
                  style={{ color: AC.textMuted }}
                >
                  {s.l}
                </div>
                <div className="text-[11px] font-semibold mt-0.5" style={{ color: AC.text }}>
                  {s.v}
                </div>
              </div>
            ))}
          </div>

          {/* Assets */}
          <InspectorDivider />
          <InspectorSection title="ASSETS">
            {assetError ? <p role="alert">{assetError}</p> : null}
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { l: 'Datasheet', e: 'PDF', bg: STATUS.danger.bg, c: STATUS.danger.text },
                { l: 'Product Image', e: 'PNG', bg: STATUS.info.bg, c: STATUS.info.text },
                { l: 'IES / LDT', e: '.ies', bg: STATUS.orange.bg, c: STATUS.orange.text },
                { l: 'CAD / BIM', e: '.rfa', bg: STATUS.purple.bg, c: STATUS.purple.text },
              ].map((a) => (
                <button
                  key={a.l}
                  aria-label={a.l}
                  disabled={!assetFor(a.l)}
                  title={assetFor(a.l)?.version.fileName ?? 'No managed asset available'}
                  onClick={async () => {
                    const asset = assetFor(a.l);
                    if (!asset) return;
                    setAssetError(null);
                    try {
                      if (!window.scliDesktop?.executeDesktopHandoff)
                        throw new Error('Open Library assets in the desktop app.');
                      const handoff = await api.libraryAssetFileHandoff(
                        asset.version.assetVersionId,
                      );
                      await window.scliDesktop.executeDesktopHandoff(
                        handoff.handoffId,
                        handoff.action,
                      );
                    } catch (error) {
                      setAssetError(
                        error instanceof Error
                          ? error.message
                          : 'This Library file is unavailable.',
                      );
                    }
                  }}
                  className="flex flex-col items-center gap-1 p-1.5 rounded-lg border hover:border-gray-300 transition-colors"
                  style={{ borderColor: AC.border, background: AC.white }}
                >
                  <div
                    className="w-6 h-6 rounded flex items-center justify-center"
                    style={{ background: a.bg }}
                  >
                    {a.l === 'Datasheet' ? (
                      <SctPdf size={18} style={{ color: a.c }} />
                    ) : a.l === 'Product Image' ? (
                      <SctImage size={18} style={{ color: a.c }} />
                    ) : a.l === 'IES / LDT' ? (
                      <SctIes size={18} style={{ color: a.c }} />
                    ) : (
                      <SctBim size={18} style={{ color: a.c }} />
                    )}
                  </div>
                  <div
                    className="text-[8px] font-semibold text-center leading-tight"
                    style={{ color: AC.textMid }}
                  >
                    {a.l}
                  </div>
                  <div className="text-[7px]" style={{ color: AC.textMuted }}>
                    {assetFor(a.l) ? a.e : '—'}
                  </div>
                </button>
              ))}
            </div>
          </InspectorSection>

          <InspectorDivider />

          {/* Version history */}
          <InspectorSection
            title="VERSION HISTORY"
            right={
              <button
                className="text-[10px] font-semibold hover:underline"
                style={{ color: AC.teal }}
                aria-expanded={showAllVersions}
                onClick={() => setShowAllVersions((value) => !value)}
              >
                {showAllVersions ? 'View recent' : 'View all'}
              </button>
            }
          >
            <div className="space-y-2">
              {(versions.data ?? [])
                .slice(0, showAllVersions ? undefined : 3)
                .map((version, index) => ({
                  v: 'V' + version.versionSequence,
                  cur: index === 0,
                  dot: index === 0 ? AC.greenRunning : AC.textMuted,
                  date: formatBusinessDateTime(version.publishedAt, {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  }),
                  who: 'Published by ' + version.publishedByName,
                  note: '',
                }))
                .map((h) => (
                  <div key={h.v} className="flex gap-2">
                    <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: h.dot }} />
                      {h.v !== 'V1.0' && (
                        <div
                          className="w-px flex-1 min-h-[14px]"
                          style={{ background: AC.borderLight }}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[11px] font-bold" style={{ color: AC.text }}>
                          {h.v}
                        </span>
                        {h.cur && (
                          <span
                            className="text-[8px] font-bold px-1 py-0.5 rounded"
                            style={{ background: STATUS.success.bg, color: STATUS.success.text }}
                          >
                            Current
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] mt-0.5" style={{ color: AC.textSub }}>
                        {h.date} • {h.who}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: AC.textMuted }}>
                        {h.note}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </InspectorSection>
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 pt-2">
        <button
          type="button"
          onClick={binding.archive}
          disabled={lum.status === 'Archived'}
          className="w-full py-1.5 rounded-lg border text-[11px] font-semibold"
          style={{ borderColor: AC.border, color: 'var(--v4-danger)' }}
        >
          Delete from Library
        </button>
      </div>
      <div
        className="flex items-center gap-1.5 px-3 py-2.5 border-t flex-shrink-0"
        style={{ borderColor: AC.border }}
      >
        <button
          onClick={binding.openDraft}
          className="flex-1 py-1.5 rounded-lg border text-[11px] font-semibold hover:bg-gray-50 transition-colors"
          style={{ borderColor: AC.border, color: AC.textMid }}
        >
          {lum.variantId ? 'Open Draft' : 'Add first variant'}
        </button>
        <button
          type="button"
          disabled={!lum.variantId}
          onClick={() => setComparing(true)}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg border text-[11px] font-semibold"
          style={{ borderColor: AC.border, color: AC.textMid }}
        >
          <SctCompare size={14} /> Compare
        </button>
        <V4FloatingWorkspace
          open={comparing}
          title="Compare variant"
          description="Current draft compared with the latest immutable published version."
          onRequestClose={() => setComparing(false)}
          footer={<V4Button onClick={() => setComparing(false)}>Close</V4Button>}
        >
          {detail.isPending ? (
            <p role="status">Loading variant…</p>
          ) : detail.isError ? (
            <p role="alert">
              The variant could not load.{' '}
              <button onClick={() => void detail.refetch()}>Retry</button>
            </p>
          ) : !entry?.latestVersion ? (
            <p>No published version exists for this variant yet.</p>
          ) : (
            <V4ResizableTable tableKey="FinalLibraryView-1" className="v4-library-comparison">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Published V{entry.latestVersion.versionSequence}</th>
                  <th>Current draft</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {detail.data
                  ? [
                      [
                        'Manufacturer',
                        entry.latestVersion.snapshot.manufacturerName,
                        detail.data.manufacturer.name,
                      ],
                      [
                        'Product / Family',
                        entry.latestVersion.snapshot.productName,
                        detail.data.product.name,
                      ],
                      [
                        'Product type',
                        entry.latestVersion.snapshot.productType,
                        detail.data.product.productType,
                      ],
                      [
                        'Description',
                        entry.latestVersion.snapshot.technicalDescription,
                        detail.data.product.description,
                      ],
                    ].map(([label, before, after]) => (
                      <tr key={label}>
                        <th>{label}</th>
                        <td>{before || '—'}</td>
                        <td>{after || '—'}</td>
                        <td>{before === after ? 'Unchanged' : 'Changed'}</td>
                      </tr>
                    ))
                  : null}
                {comparisonFields.map((field) => (
                  <tr key={field}>
                    <th>{field.replace(/([A-Z])/g, ' $1')}</th>
                    <td>{entry.latestVersion!.snapshot[field] || '—'}</td>
                    <td>{entry.variant[field] || '—'}</td>
                    <td>
                      {entry.latestVersion!.snapshot[field] === entry.variant[field]
                        ? 'Unchanged'
                        : 'Changed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </V4ResizableTable>
          )}
        </V4FloatingWorkspace>
        <button
          disabled={!entry || lum.status === 'Archived'}
          onClick={binding.publish}
          className="flex items-center gap-1 py-1.5 px-3 rounded-lg text-[11px] font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: AC.teal }}
        >
          Publish Version
        </button>
      </div>
    </div>
  );
}

// ── KPI card data (no JSX — strings only to avoid postMessage clone errors) ───
const KPI_CARDS = [
  {
    label: 'Published Variants',
    value: '0',
    sub: 'Live in projects',
    iconBg: AC.greenLight,
    iconColor: AC.greenRunning,
    iconId: 'published',
  },
  {
    label: 'Active Drafts',
    value: '0',
    sub: 'In progress',
    iconBg: AC.blueLight,
    iconColor: AC.blueAlt,
    iconId: 'drafts',
  },
  {
    label: 'Manufacturers',
    value: '0',
    sub: 'Active suppliers',
    iconBg: AC.purpleLight,
    iconColor: AC.purple,
    iconId: 'mfr',
  },
  {
    label: 'Needs Review',
    value: '0',
    sub: 'Pending action',
    iconBg: AC.yellowLight,
    iconColor: AC.yellow,
    iconId: 'review',
  },
];

// ── Main page ──────────────────────────────────────────────────────────────────
export default function FinalLibraryView({ binding }: { binding: LibraryWorkspaceBinding }) {
  const preferences = useFinalUiPreferences();
  const LUMINAIRES: Luminaire[] = useMemo(
    () =>
      libraryProductViews(binding.items).map((row) => ({
        ...row,
        sub: row.category,
        family: row.productFamily,
        ordering: row.orderingCode,
        ip: row.ipRating,
        status: row.lifecycle === 'Needs Review' ? 'Review' : row.lifecycle,
        updated: row.updatedDate,
      })),
    [binding.items],
  );
  const [closedInspectorId, setClosedInspectorId] = useState<string | null>(null);
  const [draftMenuOpen, setDraftMenuOpen] = useState(false);
  const draftMenuOwner = useRef<HTMLDivElement>(null);
  const draftMenuTrigger = useRef<HTMLButtonElement>(null);
  const draftMenuId = useId();
  const [activeKpi, setActiveKpi] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState('all');
  const [sideSearch, setSideSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(0);
  const visiblePageSize = useWindowPageSize(perPage, true, 330, 48);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const filterFields: Record<string, keyof Luminaire> = {
    Manufacturer: 'manufacturer',
    Category: 'sub',
    CCT: 'cct',
    'IP Rating': 'ip',
    Control: 'control',
    Status: 'status',
  };

  useEffect(() => {
    setFilters({});
    setTableSearch('');
    setSideSearch('');
    setActiveNav('all');
    setActiveKpi(null);
    setClosedInspectorId(null);
    setPage(1);
  }, [binding.focusToken]);
  const hasDraft = (row: Luminaire) => {
    const product = binding.items.find((item) => item.product.productId === row.productId);
    const entry = product?.variants.find((item) => item.variant.variantId === row.variantId);
    if (!entry?.latestVersion) return row.status !== 'Archived';
    return (
      Object.keys(entry.latestVersion.snapshot).some(
        (key) =>
          key in entry.variant &&
          entry.variant[key as keyof typeof entry.variant] !==
            entry.latestVersion!.snapshot[key as keyof typeof entry.latestVersion.snapshot],
      ) ||
      product?.product.description !== entry.latestVersion.snapshot.technicalDescription ||
      product?.product.name !== entry.latestVersion.snapshot.productName ||
      product?.product.productType !== entry.latestVersion.snapshot.productType ||
      product?.manufacturer.manufacturerId !== entry.latestVersion.snapshot.manufacturerId
    );
  };
  const selectedIdentity = binding.selectedVariantId ?? binding.selectedProductId;
  const preference = (row: Luminaire) =>
    preferences.items.find(
      (item) =>
        item.targetId === row.id &&
        item.kind === (row.variantId ? 'LIBRARY_VARIANT' : 'LIBRARY_PRODUCT'),
    );
  const inspect = (row: Luminaire) => {
    setClosedInspectorId(null);
    binding.select(row.productId, row.variantId);
    preferences.update({
      kind: row.variantId ? 'LIBRARY_VARIANT' : 'LIBRARY_PRODUCT',
      targetId: row.id,
      markViewed: true,
    });
  };
  const filtered = LUMINAIRES.filter((l) =>
    Object.entries(filters).every(([field, value]) => !value || l[filterFields[field]!] === value),
  )
    .filter(
      (l) =>
        !sideSearch ||
        `${l.name} ${l.ordering} ${l.manufacturer}`
          .toLowerCase()
          .includes(sideSearch.toLowerCase()),
    )
    .filter(
      (l) =>
        !activeKpi ||
        activeKpi === 'mfr' ||
        (activeKpi === 'published'
          ? l.status === 'Published'
          : activeKpi === 'drafts'
            ? hasDraft(l)
            : l.status === 'Review'),
    )
    .filter((l) => activeNav !== 'review' || l.status === 'Review')
    .filter((l) => activeNav !== 'recent' || Boolean(preference(l)?.viewedAt))
    .filter((l) => activeNav !== 'fav' || preference(l)?.favorite)
    .filter(
      (l) =>
        !tableSearch ||
        l.name.toLowerCase().includes(tableSearch.toLowerCase()) ||
        l.ordering.toLowerCase().includes(tableSearch.toLowerCase()) ||
        l.manufacturer.toLowerCase().includes(tableSearch.toLowerCase()),
    );

  const selectedLum =
    closedInspectorId === selectedIdentity
      ? null
      : (filtered.find((row) => row.id === selectedIdentity) ?? null);

  const PER_PAGE = visiblePageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  const navItems = [
    { id: 'all', label: 'All Luminaires', n: LUMINAIRES.length },
    {
      id: 'recent',
      label: 'Recently Viewed',
      n: LUMINAIRES.filter((row) => preference(row)?.viewedAt).length,
    },
    {
      id: 'fav',
      label: 'Favorites',
      n: LUMINAIRES.filter((row) => preference(row)?.favorite).length,
    },
    {
      id: 'review',
      label: 'Needs Review',
      n: LUMINAIRES.filter((row) => row.status === 'Review').length,
    },
    {
      id: 'arch',
      label: 'Archived',
      n: LUMINAIRES.filter((row) => row.status === 'Archived').length,
    },
  ];
  const countBy = (field: 'sub' | 'manufacturer'): Array<[string, number]> =>
    [...new Set(LUMINAIRES.map((row) => row[field]).filter(Boolean))].map((value) => [
      value,
      LUMINAIRES.filter((row) => row[field] === value).length,
    ]);
  const categories = countBy('sub');
  const manufacturers: Array<[string, number]> = [
    ...new Set([
      ...(binding.manufacturerNames ?? []),
      ...LUMINAIRES.map((row) => row.manufacturer),
    ]),
  ]
    .filter(Boolean)
    .map((name) => [name, LUMINAIRES.filter((row) => row.manufacturer === name).length]);
  const filterDropdowns = ['Manufacturer', 'Category', 'CCT', 'IP Rating', 'Control', 'Status'];

  return (
    <div
      className="final-ui-reference flex-1 flex flex-col min-w-0 overflow-hidden"
      style={{ background: AC.pageBg }}
    >
      {/* ── Page header card (matches Dashboard design language) ─────────────── */}
      <div
        className="flex items-center gap-4 mx-4 mt-3 flex-shrink-0"
        style={{
          background: AC.white,
          borderRadius: 14,
          border: `1px solid ${AC.border}`,
          boxShadow: SHADOW.card,
          padding: '10px 20px',
        }}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--v4-accent-selected)' }}
          >
            <InlineGlyphs.SctLibrary className="w-5 h-5" color="#2563eb" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold leading-tight" style={{ color: AC.text }}>
              Luminaire Library
            </h1>
            <p className="text-[11px]" style={{ color: AC.textMuted }}>
              Manage published variants and drafts across your organization.
            </p>
          </div>
        </div>
        <div
          ref={draftMenuOwner}
          className="v4-generate-output flex items-center gap-0 flex-shrink-0"
        >
          <button
            onClick={binding.newDraft}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-[12px] font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: AC.teal }}
          >
            <InlineGlyphs.SctAdd className="w-3 h-3" color="currentColor" />
            New Draft
          </button>
          <button
            ref={draftMenuTrigger}
            aria-label="New Library item options"
            aria-haspopup="menu"
            aria-expanded={draftMenuOpen}
            aria-controls={draftMenuOpen ? draftMenuId : undefined}
            onClick={() => setDraftMenuOpen((open) => !open)}
            className="px-2 rounded-r-lg text-white hover:opacity-90 transition-opacity"
            style={{
              background: AC.teal,
              borderLeft: '1px solid rgba(255,255,255,0.25)',
              height: 30,
            }}
          >
            <InlineGlyphs.SctExpand className="w-3 h-3" color="currentColor" />
          </button>
          <V4AnchoredSurface
            open={draftMenuOpen}
            id={draftMenuId}
            ownerRef={draftMenuOwner}
            triggerRef={draftMenuTrigger}
            onRequestClose={() => setDraftMenuOpen(false)}
            className="v4-generate-output__menu"
            role="menu"
            ariaLabel="New Library item"
          >
            {[
              { label: 'Add Manufacturer', action: binding.newManufacturer, disabled: false },
              { label: 'Add Product', action: binding.newDraft, disabled: false },
              {
                label: 'Add Variant',
                action: binding.newVariant,
                disabled: !binding.selectedProductId,
              },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="v4-generate-output__item"
                disabled={item.disabled}
                onClick={() => {
                  setDraftMenuOpen(false);
                  item.action();
                }}
              >
                {item.label}
              </button>
            ))}
          </V4AnchoredSurface>
        </div>
      </div>

      {/* ── Main body — sidebar | center-col | inspector ─────────────────────── */}
      <div className="flex-1 flex gap-[15px] overflow-hidden px-4 py-[15px] min-h-0">
        {/* ── Left sidebar card ─────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 flex flex-col overflow-hidden"
          style={{
            width: 220,
            background: AC.white,
            borderRadius: 14,
            border: `1px solid ${AC.border}`,
            boxShadow: SHADOW.card,
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 pt-3 pb-2 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <span
                className="text-[9px] font-bold uppercase tracking-widest"
                style={{ color: AC.textMuted }}
              >
                LUMINAIRES
              </span>
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: AC.lightBg, color: AC.textSub }}
              >
                {LUMINAIRES.length}
              </span>
            </div>
          </div>

          {/* Sidebar search — visual editor: pt/pb 10px */}
          <div className="px-2 pb-2 flex-shrink-0">
            <div className="relative">
              <InlineGlyphs.SctSearch
                className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
                color={AC.textMuted}
              />
              <input
                value={sideSearch}
                onChange={(e) => setSideSearch(e.target.value)}
                placeholder="Search luminaires..."
                className="w-full pl-7 pr-2 rounded-lg text-[11px] focus:outline-none focus:ring-1 transition-all"
                style={{
                  paddingTop: 10,
                  paddingBottom: 10,
                  background: 'var(--v4-surface-subtle)',
                  border: `1px solid ${AC.border}`,
                  color: AC.text,
                }}
              />
            </div>
          </div>

          {/* Scrollable nav */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-2">
            {/* Nav items */}
            <div className="space-y-0.5 mb-3">
              {navItems.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setActiveNav(n.id);
                    binding.setArchived(n.id === 'arch');
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors"
                  style={{
                    background: activeNav === n.id ? AC.teal : 'transparent',
                    color: activeNav === n.id ? '#fff' : AC.textMid,
                  }}
                >
                  <span className="text-[11px] font-medium">{n.label}</span>
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{
                      background: activeNav === n.id ? 'rgba(255,255,255,0.2)' : AC.lightBg,
                      color: activeNav === n.id ? '#fff' : AC.textSub,
                    }}
                  >
                    {n.n}
                  </span>
                </button>
              ))}
            </div>

            {/* Categories */}
            <div className="mb-3">
              <div
                className="text-[8px] font-bold uppercase tracking-widest px-2 mb-1.5"
                style={{ color: AC.textMuted }}
              >
                CATEGORIES
              </div>
              {categories.map(([label, n]) => (
                <button
                  key={label}
                  onClick={() => {
                    setFilters((previous) => ({
                      ...previous,
                      [categories.some(([name]) => name === label) ? 'Category' : 'Manufacturer']:
                        label,
                    }));
                    setPage(1);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1 hover:bg-gray-50 rounded transition-colors"
                >
                  <span className="text-[11px]" style={{ color: AC.textMid }}>
                    {label}
                  </span>
                  <span className="text-[10px]" style={{ color: AC.textMuted }}>
                    {n}
                  </span>
                </button>
              ))}
            </div>

            {/* Manufacturers */}
            <div>
              <div
                className="text-[8px] font-bold uppercase tracking-widest px-2 mb-1.5"
                style={{ color: AC.textMuted }}
              >
                MANUFACTURERS
              </div>
              {manufacturers.map(([label, n]) => (
                <button
                  key={label}
                  onClick={() => {
                    setFilters((previous) => ({
                      ...previous,
                      [categories.some(([name]) => name === label) ? 'Category' : 'Manufacturer']:
                        label,
                    }));
                    setPage(1);
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-1 hover:bg-gray-50 rounded transition-colors"
                >
                  <span className="text-[11px]" style={{ color: AC.textMid }}>
                    {label}
                  </span>
                  <span className="text-[10px]" style={{ color: AC.textMuted }}>
                    {n}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Center column: KPI row + table card ──────────────────────────── */}
        <div className="flex-1 flex flex-col gap-[15px] overflow-hidden min-w-0">
          {/* KPI — shared KpiCard component */}
          <div className="grid grid-cols-4 gap-[15px] flex-shrink-0">
            {KPI_CARDS.map((k) => ({
              ...k,
              value: String(
                k.iconId === 'published'
                  ? LUMINAIRES.filter((row) => row.status === 'Published').length
                  : k.iconId === 'drafts'
                    ? LUMINAIRES.filter(hasDraft).length
                    : k.iconId === 'mfr'
                      ? manufacturers.length
                      : LUMINAIRES.filter((row) => row.status === 'Review').length,
              ),
            })).map((k) => (
              <KpiCard
                key={k.label}
                onClick={() => {
                  setActiveKpi(activeKpi === k.iconId ? null : k.iconId);
                  setPage(1);
                }}
                className={activeKpi === k.iconId ? 'v4-library-kpi-active' : ''}
                label={k.label}
                value={k.value}
                sub={k.sub}
                iconBg={k.iconBg}
                iconColor={k.iconColor}
                icon={<KpiIcon id={k.iconId} />}
              />
            ))}
          </div>

          {/* Table card — flex-1, only inner table scrolls */}
          <div
            className="flex-1 flex flex-col overflow-hidden min-h-0"
            style={{
              background: AC.white,
              borderRadius: 14,
              border: `1px solid ${AC.border}`,
              boxShadow: SHADOW.card,
            }}
          >
            {/* Toolbar */}
            <div
              className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0 flex-wrap"
              style={{ borderColor: AC.border, background: AC.white }}
            >
              <div className="relative flex-shrink-0" style={{ minWidth: 230 }}>
                <InlineGlyphs.SctSearch
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
                  color={AC.textMuted}
                />
                <input
                  value={tableSearch}
                  onChange={(e) => {
                    setTableSearch(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Search Library"
                  placeholder="Search by name, model or ordering code..."
                  className="w-full pl-7 pr-2.5 py-1.5 rounded-lg text-[11px] focus:outline-none transition-all"
                  style={{ border: `1px solid ${AC.border}`, color: AC.text, background: AC.white }}
                />
              </div>
              {filtersOpen &&
                filterDropdowns.map((f) => (
                  <div key={f} className="relative flex-shrink-0">
                    <select
                      aria-label={f}
                      value={filters[f] ?? ''}
                      onChange={(event) => {
                        setFilters((previous) => ({ ...previous, [f]: event.target.value }));
                        setPage(1);
                      }}
                      className="appearance-none pl-2 pr-5 py-1.5 rounded-lg border text-[11px] font-medium cursor-pointer focus:outline-none hover:border-gray-300 transition-colors"
                      style={{ borderColor: AC.border, color: AC.textMid, background: AC.white }}
                    >
                      <option value="">{f}</option>
                      {[
                        ...new Set(
                          LUMINAIRES.map((row) => String(row[filterFields[f]!] ?? '')).filter(
                            Boolean,
                          ),
                        ),
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                    <InlineGlyphs.SctExpand
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 pointer-events-none"
                      color={AC.textMuted}
                    />
                  </div>
                ))}
              <button
                onClick={() => {
                  setFilters({});
                  setTableSearch('');
                  setSideSearch('');
                  setPage(1);
                  setActiveNav('all');
                  binding.setArchived(false);
                }}
                className="px-2 py-1.5 rounded-lg text-[11px] font-medium hover:bg-gray-100 transition-colors flex-shrink-0"
                style={{ color: AC.textSub }}
              >
                Clear
              </button>
              <button
                aria-label="Show library filters"
                title="Show or hide library filters"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((value) => !value)}
                className="p-1.5 rounded-lg border hover:bg-gray-50 transition-colors flex-shrink-0"
                style={{ borderColor: AC.border }}
              >
                <InlineGlyphs.SctFilter className="w-3.5 h-3.5" color={AC.textMid} />
              </button>
            </div>

            {activeKpi ? (
              <div role="status" className="v4-library-selection">
                {KPI_CARDS.find((k) => k.iconId === activeKpi)?.label}
                {activeKpi === 'mfr' ? (
                  <select
                    aria-label="Choose manufacturer"
                    value=""
                    onChange={(event) => {
                      setFilters((current) => ({ ...current, Manufacturer: event.target.value }));
                      setActiveKpi(null);
                      setPage(1);
                    }}
                  >
                    <option value="">Select manufacturer</option>
                    {manufacturers.map(([name, count]) => (
                      <option key={name} value={name}>
                        {name} ({count})
                      </option>
                    ))}
                  </select>
                ) : null}
                <button onClick={() => setActiveKpi(null)}>Clear KPI filter</button>
              </div>
            ) : null}
            {checkedIds.length > 0 ? (
              <div
                role="toolbar"
                aria-label="Selected Library items"
                className="v4-library-selection"
              >
                <strong>{checkedIds.length} selected</strong>
                <button onClick={() => setCheckedIds([])}>Clear selection</button>
                {checkedIds.length === 1 ? (
                  <button
                    onClick={() => {
                      const row = LUMINAIRES.find((item) => item.id === checkedIds[0]);
                      if (row) {
                        setClosedInspectorId(null);
                        binding.select(row.productId, row.variantId);
                      }
                    }}
                  >
                    View selected details
                  </button>
                ) : (
                  <span>Select one item for Draft, Compare and Publish actions.</span>
                )}
              </div>
            ) : null}
            {/* Table — flex-1, only this scrolls */}
            <div className="flex-1 overflow-auto min-h-0">
              <V4ResizableTable
                tableKey="FinalLibraryView-2"
                aria-label="Luminaire Library Products"
                className="w-full text-left border-collapse"
                style={{ minWidth: 820 }}
              >
                <thead
                  className="sticky top-0 z-10"
                  style={{ background: 'var(--v4-surface-subtle)' }}
                >
                  <tr style={{ borderBottom: `1px solid ${AC.border}` }}>
                    <th className="w-8 py-2 pl-3">
                      <input
                        aria-label="Select visible luminaires"
                        type="checkbox"
                        checked={
                          pageRows.length > 0 &&
                          pageRows.every((row) => checkedIds.includes(row.id))
                        }
                        onChange={(event) =>
                          setCheckedIds(event.target.checked ? pageRows.map((row) => row.id) : [])
                        }
                        style={{ accentColor: AC.teal }}
                      />
                    </th>
                    {[
                      'LUMINAIRE',
                      'MANUFACTURER',
                      'PRODUCT FAMILY',
                      'ORDERING CODE',
                      'VER',
                      'CCT',
                      'POWER',
                      'IP',
                      'STATUS',
                      'UPDATED',
                      '',
                    ].map((h, i) => (
                      <th
                        key={i}
                        className="py-2 px-2 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
                        style={{ color: AC.textMuted }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((l) => {
                    const isSel = selectedLum?.id === l.id;
                    return (
                      <tr
                        key={l.id}
                        aria-selected={isSel}
                        data-library-id={l.id}
                        onClick={() => {
                          inspect(l);
                        }}
                        className="cursor-pointer group transition-colors"
                        style={{
                          borderBottom: `1px solid ${AC.borderLight}`,
                          background: isSel ? 'var(--v4-accent-selected)' : 'transparent',
                          borderLeft: isSel ? `3px solid ${AC.teal}` : '3px solid transparent',
                        }}
                      >
                        <td
                          className="pl-2.5 py-2"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <input
                            aria-label={`Select ${l.name}`}
                            type="checkbox"
                            checked={checkedIds.includes(l.id)}
                            onChange={() =>
                              setCheckedIds((previous) =>
                                previous.includes(l.id)
                                  ? previous.filter((id) => id !== l.id)
                                  : [...previous, l.id],
                              )
                            }
                            style={{ accentColor: AC.teal }}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <button
                              aria-label={`Inspect ${l.name}`}
                              onClick={() => {
                                inspect(l);
                              }}
                              style={{ padding: 0, border: 0, background: 'transparent' }}
                            >
                              {l.imageUrl ? (
                                <img src={l.imageUrl} alt="" className="w-8 h-8 object-contain" />
                              ) : (
                                <LumThumb sub={l.sub} />
                              )}
                            </button>
                            <div>
                              <div
                                className="text-[11px] font-semibold leading-tight"
                                style={{ color: AC.text }}
                              >
                                {l.name}
                              </div>
                              <div className="text-[9px]" style={{ color: AC.textMuted }}>
                                {l.sub}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-[11px]" style={{ color: AC.textMid }}>
                          {l.manufacturer}
                        </td>
                        <td className="py-2 px-2 text-[11px]" style={{ color: AC.textMid }}>
                          {l.family}
                        </td>
                        <td
                          className="py-2 px-2 text-[10px] font-mono"
                          style={{ color: AC.textMid }}
                        >
                          {l.ordering}
                        </td>
                        <td
                          className="py-2 px-2 text-[11px] text-center"
                          style={{ color: AC.textMid }}
                        >
                          {l.version}
                        </td>
                        <td
                          className="py-2 px-2 text-[11px] whitespace-nowrap"
                          style={{ color: AC.textMid }}
                        >
                          {l.cct}
                        </td>
                        <td
                          className="py-2 px-2 text-[11px] whitespace-nowrap"
                          style={{ color: AC.textMid }}
                        >
                          {l.power}
                        </td>
                        <td className="py-2 px-2 text-[11px]" style={{ color: AC.textMid }}>
                          {l.ip}
                        </td>
                        <td className="py-2 px-2">
                          <StatusChip status={l.status} />
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          <div className="text-[10px] font-medium" style={{ color: AC.textMid }}>
                            {l.updated}
                          </div>
                          <div className="text-[9px]" style={{ color: AC.textMuted }}>
                            by {l.updatedBy}
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <button
                            aria-label={`${preference(l)?.favorite ? 'Remove favorite' : 'Favorite'} ${l.name}`}
                            aria-pressed={preference(l)?.favorite ?? false}
                            onClick={(event) => {
                              event.stopPropagation();
                              preferences.update({
                                kind: l.variantId ? 'LIBRARY_VARIANT' : 'LIBRARY_PRODUCT',
                                targetId: l.id,
                                favorite: !preference(l)?.favorite,
                              });
                            }}
                            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-100 transition-all"
                            style={{ color: AC.textMuted }}
                          >
                            <InlineGlyphs.SctMore className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </V4ResizableTable>
              {pageRows.length === 0 ? (
                <p role={binding.error ? 'alert' : 'status'} className="p-3">
                  {binding.loading
                    ? 'Loading Library…'
                    : binding.error || 'No luminaires match these filters.'}
                  {binding.error ? <button onClick={binding.retry}>Retry</button> : null}
                </p>
              ) : null}
            </div>

            {/* Pagination */}
            <div
              className="flex items-center justify-end px-3 py-2 border-t flex-shrink-0"
              style={{ borderColor: AC.border, background: AC.white }}
            >
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select
                    aria-label="Rows per page"
                    value={perPage}
                    onChange={(event) => {
                      setPerPage(Number(event.target.value));
                      setPage(1);
                    }}
                    className="appearance-none pl-2 pr-5 py-1 rounded border text-[10px] focus:outline-none"
                    style={{ borderColor: AC.border, color: AC.textMid }}
                  >
                    <option value={0}>Auto / window</option>
                    <option value={10}>10 per page</option>
                    <option value={20}>20 per page</option>
                  </select>
                  <InlineGlyphs.SctExpand
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 pointer-events-none"
                    color={AC.textMuted}
                  />
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    aria-label="Previous page"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                    className="w-5 h-5 rounded flex items-center justify-center hover:bg-gray-100"
                    style={{ border: `1px solid ${AC.border}` }}
                  >
                    <InlineGlyphs.SctBack className="w-2.5 h-2.5" color="currentColor" />
                  </button>
                  {Array.from({ length: totalPages }, (_, index) => index + 1)
                    .filter((n) => n === 1 || n === totalPages || Math.abs(n - currentPage) <= 2)
                    .map((n) => (
                      <button
                        key={n}
                        aria-current={currentPage === n ? 'page' : undefined}
                        onClick={() => setPage(n)}
                        className="w-5 h-5 rounded text-[10px] font-medium transition-colors"
                        style={{
                          background: currentPage === n ? AC.teal : 'transparent',
                          color: currentPage === n ? '#fff' : AC.textSub,
                          border: `1px solid ${currentPage === n ? AC.teal : AC.border}`,
                        }}
                      >
                        {n}
                      </button>
                    ))}

                  <button
                    aria-label="Next page"
                    disabled={currentPage === totalPages}
                    onClick={() => setPage(currentPage + 1)}
                    className="w-5 h-5 rounded flex items-center justify-center hover:bg-gray-100"
                    style={{ border: `1px solid ${AC.border}` }}
                  >
                    <InlineGlyphs.SctNext className="w-2.5 h-2.5" color="currentColor" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          {/* end table card */}
        </div>
        {/* end center column */}

        {/* ── Right inspector card ──────────────────────────────────────────── */}
        {selectedLum && (
          <Inspector
            key={selectedLum.id}
            binding={binding}
            lum={selectedLum}
            onClose={() => setClosedInspectorId(selectedIdentity)}
          />
        )}
      </div>
    </div>
  );
}
import { sctIcons as ApprovedIcons } from '../common/SctIcons';
