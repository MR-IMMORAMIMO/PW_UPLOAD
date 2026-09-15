import { V4ActionMenu } from '../common/V4ActionMenu';
import { useResizableGridColumns } from '../common/useResizableGridColumns';
import * as CustomGlyphs from '../common/SctIcons';
import type React from 'react';
import { C, SHADOW, RADIUS, LAYOUT } from './tokens';
import type { PackageRevisionSummary, IssueHistoryRecord } from '@scli/domain';
import type { PackageReadiness } from '../../pages/project-packages/packagesViewModel';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
const date = (value: string | null | undefined) => (value ? formatBusinessDateTime(value) : '—');
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

// ── shared card shell ─────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: C.white,
  borderRadius: RADIUS.card,
  border: `1px solid ${C.border}`,
  boxShadow: SHADOW.card,
  overflow: 'hidden',
};

// ── icons ─────────────────────────────────────────────────────────────────────

const IcoInfo = ({ color = C.textMid, size = 14 }: { color?: string; size?: number }) => (
  <CustomGlyphs.SctInfo size={size} style={{ color: color }} />
);
const IcoCheck = ({ color = '#22c55e', size = 14 }: { color?: string; size?: number }) => (
  <CustomGlyphs.SctCheck size={size} style={{ color: color }} />
);
const IcoWarn = ({ color = '#f97316', size = 14 }: { color?: string; size?: number }) => (
  <CustomGlyphs.SctWarning size={size} style={{ color: color }} />
);
const IcoBlock = ({ size = 14 }: { size?: number }) => (
  <CustomGlyphs.SctError size={size} style={{ color: C.red }} />
);
const IcoCheckCircleBig = () => <CustomGlyphs.SctSuccess size="28" style={{ color: '#22c55e' }} />;
const IcoDownload = () => <CustomGlyphs.SctDownload size="14" style={{ color: C.textMid }} />;
const IcoEye = () => <CustomGlyphs.SctPreview size="14" style={{ color: C.textMid }} />;
const IcoRefresh = () => <CustomGlyphs.SctRefresh size="14" style={{ color: 'currentColor' }} />;
const IcoDoc = () => <CustomGlyphs.SctFile size="14" style={{ color: C.blue }} />;
const IcoIssue = () => <CustomGlyphs.SctIssue size="14" style={{ color: 'white' }} />;
const IcoCircleWarn = () => <CustomGlyphs.SctWarning size="14" style={{ color: C.red }} />;
const IcoChevronRight = ({ color = C.blue }: { color?: string }) => (
  <CustomGlyphs.SctNext size="13" style={{ color: color }} />
);

// ── Avatar ─────────────────────────────────────────────────────────────────────

function Avatar({ initials, bg = C.teal }: { initials: string; bg?: string }) {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        background: bg,
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function Badge({
  label,
  type,
}: {
  label: string;
  type: 'issued' | 'draft' | 'failed' | 'finalized' | 'failed_rec';
}) {
  const styles: Record<string, React.CSSProperties> = {
    issued: { background: '#dcfce7', color: '#16a34a', border: '1px solid #bbf7d0' },
    draft: { background: C.neutralLight, color: C.textMid, border: `1px solid ${C.border}` },
    failed: { background: '#fff7ed', color: '#ea580c', border: '1px solid #fed7aa' },
    finalized: { background: '#dcfce7', color: '#16a34a', border: '1px solid #bbf7d0' },
    failed_rec: { background: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5' },
  };
  return (
    <span
      style={{
        ...styles[type],
        fontSize: 10,
        fontWeight: 600,
        borderRadius: 4,
        padding: '2px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ num, title, info }: { num: number; title: string; info?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: C.textLabel }}>
        {num}. {title}
      </span>
      {info && <IcoInfo color={C.textFaint} size={13} />}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props {
  revision: PackageRevisionSummary | null;
  history: IssueHistoryRecord[];
  selected: IssueHistoryRecord | null;
  label: string;
  readiness: PackageReadiness;
  warningCount: number;
  included: number;
  size: string;
  pending: boolean;
  draftBlocked: boolean;
  issueBlocked: boolean;
  canRetry: boolean;
  onBuilder: () => void;
  onPreview: () => void;
  onReadiness: () => void;
  onSelect: (id: string) => void;
  onDownload: (id: string) => void;
  onVerify: (id: string) => void;
  onReissueRecord: (id: string) => void;
  onDraft: () => void;
  onIssue: () => void;
  onRetry: () => void;
  onReissue: () => void;
}

export function FinalPackagesView(b: Props) {
  const sizing = useResizableGridColumns('FinalPackagesView', [180, 90, 130, 130, 140, 68]);
  const blocking = [
    ...b.readiness.hardGuards,
    ...b.readiness.blocking.map((check) => check.detail),
  ];
  const warnings = [
    ...b.readiness.warnings.map((check) => check.detail),
    ...(b.readiness.outdatedOutputCount
      ? [`${b.readiness.outdatedOutputCount} outdated outputs selected`]
      : []),
    ...(b.readiness.deselectedDatasheetCount
      ? [`${b.readiness.deselectedDatasheetCount} available datasheets excluded`]
      : []),
  ];
  const info = b.readiness.info.map((check) => check.detail);
  const issuedName = b.selected?.package.issuedBy?.actorNameSnapshot ?? 'Not issued';
  const rows = b.history.map((record) => ({
    id: record.package.packageId,
    pkg: record.package.label,
    seq: `Seq: ${record.package.packageSequence}`,
    status: record.package.businessStatus,
    statusType:
      record.package.businessStatus === 'Issued' ? ('issued' as const) : ('draft' as const),
    avatarBg: C.teal,
    initials: initials(record.package.issuedBy?.actorNameSnapshot ?? ''),
    name: record.package.issuedBy?.actorNameSnapshot ?? 'Not issued',
    role: '',
    date: date(record.package.issuedAt),
    time: '',
    lc: record.package.lifecycleState,
    lcType:
      record.package.lifecycleState === 'FINALIZED'
        ? ('finalized' as const)
        : record.package.lifecycleState === 'FAILED_RECOVERABLE'
          ? ('failed_rec' as const)
          : ('draft' as const),
    icons: ['dl', 'eye', 'dots'],
  }));
  const G = LAYOUT.sectionGap;

  return (
    <div
      data-resizable-grid
      style={{
        padding: G,
        height: '100%',
        minHeight: 0,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        rowGap: G,
        columnGap: 0,
        boxSizing: 'border-box',
        overflow: 'auto',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 3px' }}>
            Packages
          </h1>
          <p style={{ fontSize: 12, color: C.textSub, margin: 0 }}>
            Manage output packages for this workspace.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, height: 42 }}>
          <button
            onClick={b.onDraft}
            disabled={b.pending || b.draftBlocked}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: `1px solid ${C.teal}`,
              borderRadius: RADIUS.control,
              background: C.white,
              cursor: 'pointer',
              padding: '0 14px',
              height: '100%',
              fontSize: 12,
              fontWeight: 600,
              color: C.text,
            }}
          >
            <IcoDoc /> Create Draft Package
          </button>
          <button
            onClick={b.onIssue}
            disabled={b.pending || b.issueBlocked}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              borderRadius: RADIUS.control,
              background: C.teal,
              cursor: 'pointer',
              padding: '0 14px',
              height: '100%',
              fontSize: 12,
              fontWeight: 600,
              color: 'white',
            }}
          >
            <IcoIssue /> Issue Package
          </button>
        </div>
      </div>

      {/* ── Top stats row (4 cards) ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: G, flexShrink: 0 }}>
        {/* 1. Select Finalized Revision */}
        <div style={{ ...card, flex: 1, minWidth: 0, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.textLabel }}>
              1. Select Finalized Revision
            </span>
            {b.revision ? (
              <IcoCheck color="var(--v4-success)" size={13} />
            ) : (
              <IcoInfo color={C.textFaint} size={13} />
            )}
          </div>
          <div style={{ fontSize: 10, color: C.textSub, marginBottom: 4 }}>Selected Revision</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 }}>
            {b.revision
              ? `${b.revision.revisionLabel} – ${b.revision.purpose ?? ''}`
              : 'No finalized Revision'}
          </div>
          <div style={{ fontSize: 11, color: C.textSub, marginBottom: 12 }}>
            {b.revision
              ? `Finalized ${date(b.revision.finalizedAt)}`
              : 'Finalize a Revision to build a package.'}
          </div>
          <button
            onClick={b.onBuilder}
            style={{
              background: C.teal,
              color: 'white',
              border: 'none',
              borderRadius: RADIUS.control,
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Change Revision
          </button>
        </div>

        {/* 2. Eligible Outputs */}
        <div style={{ ...card, flex: 1, padding: 14, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.textLabel }}>
              2. Eligible Outputs
            </span>
            <IcoInfo color={C.textFaint} size={13} />
          </div>
          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
            {[
              {
                icon: <IcoCheck color="#22c55e" size={22} />,
                num: String(b.included),
                label: 'Included',
                sub: 'Ready to package',
                color: '#22c55e',
              },
              {
                icon: <IcoWarn color="#f97316" size={22} />,
                num: String(b.warningCount),
                label: 'Warnings',
                sub: 'Review recommended',
                color: '#f97316',
              },
              {
                icon: <IcoInfo color={C.textMid} size={22} />,
                num: String(info.length),
                label: 'Info',
                sub: 'For awareness',
                color: C.textMid,
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 2,
                }}
              >
                {s.icon}
                <span style={{ fontSize: 20, fontWeight: 700, color: s.color, lineHeight: 1.1 }}>
                  {s.num}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: s.color }}>{s.label}</span>
                <span style={{ fontSize: 10, color: C.textSub }}>{s.sub}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 10,
              paddingTop: 8,
              borderTop: `1px solid ${C.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <button
              type="button"
              onClick={b.onBuilder}
              style={{
                background: 'none',
                border: 0,
                padding: '4px 0',
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11,
                color: 'var(--v4-accent-ink)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              View Outputs
              <IcoChevronRight />
            </button>
          </div>
        </div>

        {/* 3. Package Contents */}
        <div style={{ ...card, flex: 1, padding: 14, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.textLabel }}>
              3. Package Contents
            </span>
            <IcoInfo color={C.textFaint} size={13} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              ['Total outputs', String(b.included)],
              ['Files', String(b.included)],
              ['Total size', b.size],
            ].map(([label, val]) => (
              <div
                key={label}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span style={{ fontSize: 12, color: C.textSub }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{val}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 10,
              paddingTop: 8,
              borderTop: `1px solid ${C.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <button
              type="button"
              onClick={b.onPreview}
              style={{
                background: 'none',
                border: 0,
                padding: '4px 0',
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11,
                color: 'var(--v4-accent-ink)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Preview Contents
              <IcoChevronRight />
            </button>
          </div>
        </div>

        {/* 4. Package Readiness */}
        <div style={{ ...card, flex: 1, padding: 14, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.textLabel }}>
              4. Package Readiness
            </span>
            <IcoInfo color={C.textFaint} size={13} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {b.readiness.state === 'Blocked' ? (
              <IcoBlock size={28} />
            ) : b.readiness.state === 'Warnings' ? (
              <IcoWarn size={28} />
            ) : (
              <IcoCheckCircleBig />
            )}
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color:
                    b.readiness.state === 'Blocked'
                      ? C.red
                      : b.readiness.state === 'Warnings'
                        ? '#f97316'
                        : '#16a34a',
                }}
              >
                {b.readiness.state === 'Ready' ? 'Ready to Issue' : b.readiness.state}
              </div>
              <div style={{ fontSize: 10, color: C.textSub }}>
                {blocking.length
                  ? `${blocking.length} blocking issues`
                  : 'No blocking issues found'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, margin: '8px 0 10px' }}>
            {[
              { dot: C.red, label: 'Blocking', val: String(blocking.length) },
              { dot: '#f97316', label: 'Warnings', val: String(b.warningCount) },
              { dot: C.textMid, label: 'Info', val: String(info.length) },
            ].map((r) => (
              <div
                key={r.label}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: r.dot }} />
                  <span style={{ fontSize: 11, color: C.textSub }}>{r.label}</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{r.val}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              paddingTop: 8,
              borderTop: `1px solid ${C.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <button
              type="button"
              onClick={b.onReadiness}
              style={{
                background: 'none',
                border: 0,
                padding: '4px 0',
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11,
                color: 'var(--v4-accent-ink)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              View Details
              <IcoChevronRight />
            </button>
          </div>
        </div>
      </div>

      {/* ── Middle row ──────────────────────────────────────────────── */}
      <div style={{ flex: '1 0 auto', minHeight: 340, display: 'flex', gap: G }}>
        {/* 5. Issue History */}
        <div
          style={{
            ...card,
            flex: 2,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '13px 16px 0', flexShrink: 0 }}>
            <SectionHeading num={5} title="Issue History" />
          </div>
          {sizing.reset}
          {/* Table header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'minmax(100px, 1.4fr) minmax(65px, .8fr) minmax(95px, 1fr) minmax(85px, 1fr) minmax(105px, 1fr) 68px',
              ...sizing.style,
              padding: '0 16px',
              borderBottom: `1px solid ${C.border}`,
              background: C.tableHeader,
              flexShrink: 0,
            }}
          >
            {['Package', 'Status', 'Issued By', 'Issued At', 'Lifecycle', 'Actions'].map(
              (h, index) => (
                <div
                  key={h}
                  data-resizable-row-header
                  style={{
                    position: 'relative',
                    padding: '8px 6px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: C.textLabel,
                  }}
                >
                  {h}
                  {sizing.handle(index, h)}
                </div>
              ),
            )}
          </div>
          {/* Table body */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {rows.map((row, i, arr) => (
              <div
                key={row.id}
                data-resizable-row
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'minmax(100px, 1.4fr) minmax(65px, .8fr) minmax(95px, 1fr) minmax(85px, 1fr) minmax(105px, 1fr) 68px',
                  ...sizing.style,
                  padding: '0 16px',
                  borderBottom: i < arr.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                  alignItems: 'center',
                }}
              >
                <div style={{ padding: '10px 6px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{row.pkg}</div>
                  <div style={{ fontSize: 10, color: C.textSub }}>{row.seq}</div>
                </div>
                <div style={{ padding: '10px 6px' }}>
                  <Badge label={row.status} type={row.statusType} />
                </div>
                <div style={{ padding: '10px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {row.initials ? <Avatar initials={row.initials} bg={row.avatarBg} /> : null}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{row.name}</div>
                    {row.role && <div style={{ fontSize: 10, color: C.textSub }}>{row.role}</div>}
                  </div>
                </div>
                <div style={{ padding: '10px 6px' }}>
                  <div style={{ fontSize: 11, color: C.text }}>{row.date}</div>
                  <div style={{ fontSize: 10, color: C.textSub }}>{row.time}</div>
                </div>
                <div style={{ padding: '10px 6px' }}>
                  <Badge
                    label={row.lc === 'FINALIZED' ? 'Files saved' : row.lc}
                    type={row.lcType}
                  />
                </div>
                <div style={{ padding: '10px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    aria-label={'Download package ' + row.pkg}
                    onClick={() => b.onDownload(row.id)}
                  >
                    <IcoDownload />
                  </button>
                  <button
                    type="button"
                    aria-label={'Inspect package ' + row.pkg}
                    onClick={() => b.onSelect(row.id)}
                  >
                    <IcoEye />
                  </button>
                  <V4ActionMenu
                    label={'Package actions ' + row.pkg}
                    actions={[
                      { label: 'View details', run: () => b.onSelect(row.id) },
                      { label: 'Verify Package', run: () => b.onVerify(row.id) },
                      { label: 'Download ZIP', run: () => b.onDownload(row.id) },
                      ...(row.status === 'Issued'
                        ? [{ label: 'Start Reissue', run: () => b.onReissueRecord(row.id) }]
                        : []),
                    ]}
                  />{' '}
                </div>
              </div>
            ))}
          </div>
          {/* Footer link */}
          <div
            style={{
              padding: '9px 16px',
              borderTop: `1px solid ${C.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={b.onBuilder}
              style={{
                background: 'none',
                border: 0,
                padding: '4px 0',
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11,
                color: 'var(--v4-accent-ink)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              View All Packages
              <IcoChevronRight />
            </button>
          </div>
        </div>

        {/* 6. Package Settings */}
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
          <div style={{ padding: '13px 14px 0', flexShrink: 0 }}>
            <SectionHeading num={6} title="Package Settings" />
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              padding: '0 14px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {[
              {
                label: 'Title',
                value: b.label || b.selected?.package.label || 'Package label required',
                bold: true,
              },
              { label: 'Description', value: b.revision?.purpose ?? '—', bold: false },
              {
                label: 'Output Scope',
                value: `${b.included} selected finalized deliverables`,
                bold: false,
              },
              { label: 'Recipients (Future Use)', value: 'Not configured', bold: false },
              { label: 'Retention Policy', value: 'Retain forever', bold: false },
              { label: 'Additional Notes', value: '—', bold: false },
            ].map((row) => (
              <div key={row.label}>
                <div style={{ fontSize: 10, color: C.textSub, marginBottom: 2 }}>{row.label}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.text,
                    fontWeight: row.bold ? 600 : 400,
                    lineHeight: 1.4,
                  }}
                >
                  {row.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 7+8. Issue Audit + Actions */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: G }}>
          {/* 7. Issue Audit */}
          <div
            style={{
              ...card,
              flexShrink: 0,
              padding: 14,
              flex: 1,
              minHeight: 210,
              overflow: 'auto',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.textLabel }}>
                  7. Issue Audit (Read-Only)
                </span>
                <IcoInfo color={C.textFaint} size={13} />
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: C.textSub, marginBottom: 5 }}>Issued By</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Avatar initials={initials(issuedName)} bg={C.teal} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{issuedName}</div>
                  <div style={{ fontSize: 10, color: C.textSub }}>
                    {b.selected?.package.businessStatus ?? '—'}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: C.textSub, marginBottom: 3 }}>Issued At</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                {date(b.selected?.package.issuedAt)}
              </div>
            </div>
            <div
              style={{
                background: 'var(--v4-accent-selected)',
                border: `1px solid ${C.blueBorder}`,
                borderRadius: 7,
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 6,
              }}
            >
              <IcoInfo color={C.blue} size={13} />
              <span style={{ fontSize: 11, color: C.blueAlt, lineHeight: 1.4 }}>
                Audit values are validated and immutable.
              </span>
            </div>
          </div>

          {/* 8. Actions */}
          <div
            style={{
              ...card,
              flexShrink: 0,
              paddingTop: 8,
              paddingBottom: 8,
              paddingLeft: 14,
              paddingRight: 14,
              minHeight: 135,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: C.textLabel, marginBottom: 10 }}>
              8. Actions
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
                minHeight: 42,
                boxSizing: 'border-box',
              }}
            >
              <button
                onClick={b.onIssue}
                disabled={b.pending || b.issueBlocked}
                style={{
                  background: C.teal,
                  color: 'white',
                  border: 'none',
                  borderRadius: RADIUS.control,
                  padding: '9px 0',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                Issue This Package
              </button>
              {b.canRetry ? (
                <button
                  onClick={b.onRetry}
                  disabled={!b.canRetry || b.pending}
                  style={{
                    background: C.white,
                    color: C.text,
                    border: `1px solid ${C.border}`,
                    borderRadius: RADIUS.control,
                    padding: '8px 0',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <IcoRefresh /> Retry Failed Package
                </button>
              ) : null}
              {b.selected?.package.businessStatus === 'Issued' ? (
                <button
                  onClick={b.onReissue}
                  disabled={!b.selected || b.pending}
                  style={{
                    background: C.white,
                    color: C.red,
                    border: `1px solid ${C.border}`,
                    borderRadius: RADIUS.control,
                    padding: '8px 0',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <IcoCircleWarn /> Reissue (Create New Package)
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom row (Health Checks + About) ──────────────────────── */}
      <div style={{ display: 'flex', gap: G, flexShrink: 0 }}>
        {/* 9. Package Health Checks */}
        <div style={{ ...card, flex: 3, minWidth: 0, padding: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textLabel, marginBottom: 12 }}>
            9. Package Health Checks
          </div>
          <div style={{ display: 'flex', gap: G }}>
            {/* Blocking */}
            <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <IcoBlock size={18} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 3 }}>
                  Blocking ({blocking.length})
                </div>
                <div style={{ fontSize: 11, color: C.textSub }}>
                  {blocking.join(' · ') || 'No blocking issues'}
                </div>
              </div>
            </div>
            {/* Warnings */}
            <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <IcoWarn color="#f97316" size={18} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                  Warnings ({b.warningCount})
                </div>
                <ul
                  style={{
                    margin: 0,
                    padding: '0 0 0 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  {warnings.map((message, i) => (
                    <li key={i} style={{ fontSize: 11, color: C.textSub }}>
                      {message}
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 5 }}>
                  <button
                    type="button"
                    onClick={b.onReadiness}
                    style={{
                      background: 'none',
                      border: 0,
                      padding: 0,
                      fontSize: 11,
                      color: 'var(--v4-accent-ink)',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    View Warnings
                  </button>
                </div>
              </div>
            </div>
            {/* Info */}
            <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <IcoInfo color={C.textMid} size={18} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                  Info ({info.length})
                </div>
                <ul
                  style={{
                    margin: 0,
                    padding: '0 0 0 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  {info.map((message, i) => (
                    <li key={i} style={{ fontSize: 11, color: C.textSub }}>
                      {message}
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 5 }}>
                  <button
                    type="button"
                    onClick={b.onReadiness}
                    style={{
                      background: 'none',
                      border: 0,
                      padding: 0,
                      fontSize: 11,
                      color: 'var(--v4-accent-ink)',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    View Info
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* About Package Readiness */}
        <div
          style={{
            flex: 1,
            background: 'var(--v4-accent-selected)',
            border: `1px solid ${C.blueBorder}`,
            borderRadius: RADIUS.card,
            padding: 14,
            display: 'flex',
            gap: 9,
            alignItems: 'center',
            justifyContent: 'flex-start',
            minHeight: 152,
            boxSizing: 'border-box',
          }}
        >
          <IcoInfo color={C.blue} size={15} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.blueAlt, marginBottom: 5 }}>
              About Package Readiness
            </div>
            <div style={{ fontSize: 11, color: C.blueAlt, lineHeight: 1.5 }}>
              A package must have no blocking issues to be issued. Warnings should be reviewed but
              do not prevent issuing. Info items are for awareness only.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
