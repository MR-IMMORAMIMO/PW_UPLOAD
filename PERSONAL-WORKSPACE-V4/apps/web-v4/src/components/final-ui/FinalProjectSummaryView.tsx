import * as InlineGlyphs from '../common/SctIcons';
import { LAYOUT } from './tokens';
import { createContext, useContext } from 'react';
import type { Project } from '@scli/domain';
import type { ProjectSummaryModel } from '../../pages/project-summary/projectSummaryViewModel';
import { formatBusinessDateTime } from '../../date-time/businessDateTime';
import './referenceUtilities.css';
export interface FinalSummaryBinding {
  project: Project;
  model: ProjectSummaryModel;
  stages: Record<string, StageStatus>;
  openSection: (section: string) => void;
  openStage: (stage: string) => void;
  lastUpdatedActor: string | null;
  openAttention: () => void;
  openActivity: () => void;
  next: () => void;
  pending: boolean;
}
const Context = createContext<FinalSummaryBinding | null>(null);
function useSummary() {
  const value = useContext(Context);
  if (!value) throw new Error('Summary binding required.');
  return value;
}

// ── Palette ───────────────────────────────────────────────────────────────────

const P = {
  blue: '#2563eb',
  blueLight: 'var(--v4-accent-selected)',
  blueMid: '#3b82f6',
  blueBorder: '#bfdbfe',
  teal: 'var(--v4-action-primary)',
  tealLight: 'var(--v4-accent-soft)',
  tealBorder: 'var(--v4-accent)',
  green: '#16a34a',
  greenLight: '#dcfce7',
  greenBorder: '#86efac',
  greenIcon: '#22c55e',
  orange: '#ea580c',
  orangeLight: '#fff7ed',
  amber: '#d97706',
  amberLight: '#fffbeb',
  amberBorder: '#fde68a',
  red: '#dc2626',
  redLight: '#fee2e2',
  violet: '#7c3aed',
  violetLight: '#f5f3ff',
  violetBorder: '#ddd6fe',
  gray: 'var(--v4-text-muted)',
  grayLight: 'var(--v4-surface-subtle)',
  border: 'var(--v4-border-subtle)',
  text: 'var(--v4-text-primary)',
  textMid: 'var(--v4-text-secondary)',
  textMuted: 'var(--v4-text-muted)',
  textSub: 'var(--v4-text-disabled)',
  white: 'var(--v4-surface-raised)',
  cardShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
};

// ── Shared card ───────────────────────────────────────────────────────────────

function Card({
  children,
  style,
  label,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  label?: string;
}) {
  return (
    <div
      role={label ? 'region' : undefined}
      aria-label={label}
      style={{
        background: P.white,
        borderRadius: 12,
        border: `1px solid ${P.border}`,
        boxShadow: P.cardShadow,
        overflow: 'hidden',
        minHeight: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px 14px',
        borderBottom: `1px solid ${P.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <span
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 15,
            fontWeight: 700,
            color: P.text,
          }}
        >
          {title}
        </span>
      </div>
      {action}
    </div>
  );
}

function ViewAllLink({ label = 'View all', onClick }: { label?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: "'Inter', sans-serif",
        fontSize: 13,
        fontWeight: 500,
        color: P.blueMid,
        padding: 0,
      }}
    >
      {label}
      <InlineGlyphs.SctNext width="14" height="14" />
    </button>
  );
}

// ── Workflow Stage Bar ────────────────────────────────────────────────────────

type StageStatus = 'completed' | 'active' | 'pending';

interface Stage {
  id: string;
  label: string;
  status: StageStatus;
  icon: React.ReactNode;
}

// Capsule pill for each stage
function StageCapsule({ stage, borderRadius = 30 }: { stage: Stage; borderRadius?: number }) {
  const data = useSummary();
  const styles = {
    completed: {
      border: `1.5px solid ${P.greenIcon}`,
      bg: '#f0fdf4',
      iconBg: P.greenIcon,
      nameColor: 'var(--v4-text-primary)',
      subColor: P.green,
    },
    active: {
      border: `2px solid ${P.blue}`,
      bg: 'var(--v4-accent-selected)',
      iconBg: '#dbeafe',
      nameColor: P.blue,
      subColor: P.blue,
    },
    pending: {
      border: '1.5px solid #e5e7eb',
      bg: P.white,
      iconBg: '#f3f4f6',
      nameColor: 'var(--v4-text-secondary)',
      subColor: 'var(--v4-text-disabled)',
    },
  };
  const s = styles[stage.status];
  const subLabel =
    stage.status === 'completed'
      ? 'Previously'
      : stage.status === 'active'
        ? 'In Progress'
        : 'Pending';

  return (
    <button
      type="button"
      onClick={() => data.openStage(stage.id)}
      aria-label={`${stage.label}: ${stage.status}`}
      style={{
        cursor: 'pointer',
        textAlign: 'left',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 14px 9px 9px',
        borderRadius,
        border: s.border,
        background: s.bg,
        flexShrink: 0,
        minWidth: 150,
        boxShadow: stage.status === 'active' ? '0 0 0 3px rgba(37,99,235,0.1)' : 'none',
      }}
    >
      {/* Icon circle */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: s.iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {stage.status === 'completed' ? (
          <InlineGlyphs.SctCheck width="18" height="18" />
        ) : (
          stage.icon
        )}
      </div>
      {/* Labels */}
      <div>
        <div
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: s.nameColor,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          {stage.label}
        </div>
        <div
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            fontWeight: 500,
            color: s.subColor,
            marginTop: 2,
            lineHeight: 1,
          }}
        >
          {subLabel}
        </div>
      </div>
    </button>
  );
}

// Arrow connector between stages
function StageArrow({ fromCompleted, noGrow }: { fromCompleted: boolean; noGrow?: boolean }) {
  const color = fromCompleted ? P.greenIcon : 'var(--v4-border-control)';
  return (
    <div
      style={{
        flex: noGrow ? '0 0 auto' : 1,
        display: 'flex',
        alignItems: 'center',
        minWidth: 12,
        gap: 0,
      }}
    >
      {/* Line */}
      <div
        style={{
          flex: 1,
          height: 3,
          marginLeft: 2,
          marginRight: 2,
          background: fromCompleted
            ? P.greenIcon
            : 'repeating-linear-gradient(90deg, #d1d5db 0, #d1d5db 5px, transparent 5px, transparent 10px)',
        }}
      />
      {/* Arrowhead */}
      <svg width="7" height="10" viewBox="0 0 7 10" fill="none" style={{ flexShrink: 0 }}>
        <path
          d="M1 1l5 4-5 4"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

const STAGE_APPEARANCE: Stage[] = [
  {
    id: 'setup',
    label: 'Setup',
    status: 'completed',
    icon: <InlineGlyphs.SctSettings width="18" height="18" color={P.blue} />,
  },
  {
    id: 'design',
    label: 'Design',
    status: 'completed',
    icon: <InlineGlyphs.SctLightingDesign width="18" height="18" color={P.blue} />,
  },
  {
    id: 'technical',
    label: 'Technical',
    status: 'active',
    icon: <InlineGlyphs.SctTechnicalCheck width="18" height="18" color={P.blue} />,
  },
  {
    id: 'issue',
    label: 'Issue',
    status: 'pending',
    icon: <InlineGlyphs.SctIssue width="18" height="18" color="#9ca3af" />,
  },
  {
    id: 'client-review',
    label: 'Client Review',
    status: 'pending',
    icon: <InlineGlyphs.SctClient width="18" height="18" color="#9ca3af" />,
  },
  {
    id: 'revision',
    label: 'Revision',
    status: 'pending',
    icon: <InlineGlyphs.SctRevisions width="18" height="18" color="#9ca3af" />,
  },
];

function WorkflowStageBar() {
  const data = useSummary();
  const STAGES = STAGE_APPEARANCE.map((stage) => ({
    ...stage,
    status: data.stages[stage.id] ?? ('pending' as const),
  }));
  return (
    <Card style={{ padding: '16px 20px' }}>
      <div
        role="group"
        aria-label="Project workflow stages"
        style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto' }}
      >
        {STAGES.map((stage, i) => (
          <div
            key={stage.id}
            data-stage={stage.id}
            data-state={stage.status}
            style={{
              display: 'flex',
              alignItems: 'center',
              flex: i < STAGES.length - 1 ? '1 1 auto' : '0 0 auto',
              minWidth: 0,
              gap: 6,
            }}
          >
            <StageCapsule stage={stage} borderRadius={stage.status === 'active' ? 29 : 30} />
            {i < STAGES.length - 1 && <StageArrow fromCompleted={stage.status === 'completed'} />}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Need Your Attention ───────────────────────────────────────────────────────

interface AlertItem {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  desc: string;
  priority: string;
  id: string;
  target: string | null;
  priorityColor: string;
  priorityBg: string;
}

function NeedAttentionCard() {
  const data = useSummary();
  const ALERTS: AlertItem[] = data.model.attention.map((item) => ({
    id: item.id,
    target: item.targetSection,
    icon: <InlineGlyphs.SctWarning width="18" height="18" color={P.red} />,
    iconBg: P.redLight,
    title: item.message,
    desc: item.supporting ?? '',
    priority: item.severity,
    priorityColor: item.severity === 'blocking' || item.severity === 'high' ? P.red : P.amber,
    priorityBg:
      item.severity === 'blocking' || item.severity === 'high' ? P.redLight : P.amberLight,
  }));
  return (
    <Card
      label="Need Your Attention"
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <CardHeader
        icon={<InlineGlyphs.SctWarning width="18" height="18" color={P.blue} />}
        title="Need Your Attention"
        action={<ViewAllLink onClick={data.openAttention} />}
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {ALERTS.length === 0 ? (
          <p style={{ padding: 20, color: P.textMuted }}>No items need your attention</p>
        ) : null}
        {ALERTS.map((a, i) => (
          <div
            key={a.id}
            role="button"
            tabIndex={0}
            onClick={() => (a.target ? data.openSection(a.target) : data.openAttention())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (a.target) data.openSection(a.target);
                else data.openAttention();
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '13px 20px',
              borderBottom: i < ALERTS.length - 1 ? `1px solid ${P.border}` : 'none',
              cursor: 'pointer',
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = P.grayLight)}
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = 'transparent')
            }
          >
            {/* Icon bubble */}
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: a.iconBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {a.icon}
            </div>
            {/* Text */}
            <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  color: P.text,
                  lineHeight: 1.3,
                }}
              >
                {a.title}
              </div>
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  color: P.textMuted,
                  marginTop: 2,
                }}
              >
                {a.desc}
              </div>
            </div>
            {/* Priority badge */}
            <span
              style={{
                flexShrink: 0,
                fontFamily: "'Inter', sans-serif",
                fontSize: 11,
                fontWeight: 700,
                color: a.priorityColor,
                background: a.priorityBg,
                padding: '3px 10px',
                borderRadius: 6,
                whiteSpace: 'nowrap',
              }}
            >
              {a.priority}
            </span>
            {/* Chevron */}
            <InlineGlyphs.SctNext width="14" height="14" style={{ flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Next Action ───────────────────────────────────────────────────────────────

function NextActionCard() {
  const data = useSummary();
  const action = data.model.nextAction;
  return (
    <Card label="Next Action" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardHeader
        icon={<InlineGlyphs.SctActions width="18" height="18" color={P.blue} />}
        title="Next Action"
      />
      <div style={{ padding: '16px 20px 20px', flex: 1, overflowY: 'auto' }}>
        {/* Highlighted action box */}
        <div
          style={{
            background: P.blueLight,
            borderRadius: 10,
            padding: '42px 20px',
            border: `1px solid ${P.blueBorder}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            {/* Action icon */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: '#dbeafe',
                border: `1.5px solid ${P.blueBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <InlineGlyphs.SctActions width="24" height="24" color={P.blue} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 10,
                  fontWeight: 800,
                  color: P.blue,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                {action.severity ?? 'NEXT ACTION'}
              </div>
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 16,
                  fontWeight: 700,
                  color: P.text,
                  lineHeight: 1.3,
                  marginBottom: 8,
                }}
              >
                {action.title}
              </div>
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 13,
                  color: P.textMid,
                  lineHeight: 1.5,
                  marginBottom: 14,
                }}
              >
                {action.description ?? ''}
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <button
                  aria-label={action.title}
                  onClick={data.next}
                  disabled={data.pending || (!action.targetSection && !action.targetStatus)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: P.teal,
                    color: 'var(--v4-action-primary-foreground)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: 'pointer',
                    padding: '9px 18px',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {data.project.status === 'Planning' && action.targetStatus === 'InProgress'
                    ? 'Start Project'
                    : 'Open'}
                  <InlineGlyphs.SctNext width="14" height="14" />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: P.textMuted }}>
                  <InlineGlyphs.SctDuration width="14" height="14" color={P.textMuted} />
                  <span
                    style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: P.textMuted }}
                  >
                    —
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Footer note */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
          }}
        >
          <InlineGlyphs.SctInfo width="14" height="14" color={P.textSub} />
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: P.textMuted }}>
            {action.requiresReason
              ? 'A reason is required for this transition.'
              : 'Based on the current Project records.'}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ── Project Snapshot ──────────────────────────────────────────────────────────

function ProjectSnapshotCard({ project }: { project: Project }) {
  const data = useSummary();
  const snapshot = data.model.snapshot;
  const isOverdue = snapshot.dueState === 'overdue';

  const snapshotItems = [
    {
      icon: <InlineGlyphs.SctLuminaires width="32" height="32" color={P.teal} />,
      value: String(snapshot.luminaireCount),
      valueColor: P.text,
      label: 'Luminaires',
      sub: 'Total',
      link: null,
    },
    {
      icon: (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 10,
              fontWeight: 800,
              color: P.blue,
              letterSpacing: '-0.02em',
            }}
          >
            REV
          </span>
        </div>
      ),
      value: snapshot.currentRevisionLabel,
      valueColor: P.text,
      label: 'Current Revision',
      sub: null,
      link: 'View Revisions',
    },
    {
      icon: <InlineGlyphs.SctDate width="28" height="28" color={P.blue} />,
      value: snapshot.metrics.find((metric) => metric.key === 'dueDate')?.value ?? '—',
      valueColor: isOverdue ? P.orange : P.text,
      label: 'Due Date',
      sub: snapshot.dueState === 'neutral' ? null : snapshot.dueState,
      subColor: P.orange,
      link: null,
    },
    {
      icon: <InlineGlyphs.SctActions width="28" height="28" color={P.blue} />,
      value: String(snapshot.openActionsCount),
      valueColor: P.orange,
      label: 'Open Actions',
      sub: null,
      link: 'View Actions',
    },
  ];

  return (
    <Card
      label="Project Snapshot"
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <CardHeader
        icon={<InlineGlyphs.SctDashboard width="18" height="18" color={P.blue} />}
        title="Project Snapshot"
      />
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Stats grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            borderBottom: `1px solid ${P.border}`,
            flex: 1,
            alignContent: 'center',
            minHeight: 170,
            paddingBlock: 12,
          }}
        >
          {snapshotItems.map((item, i) => (
            <div
              key={i}
              style={{
                padding: '12px 8px',
                minWidth: 0,
                overflowWrap: 'anywhere',
                borderRight: i < snapshotItems.length - 1 ? `1px solid ${P.border}` : 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 6,
              }}
            >
              {/* The luminaire icon and total share one accessible navigation target. */}
              <div
                role={i === 0 ? 'button' : undefined}
                tabIndex={i === 0 ? 0 : undefined}
                aria-label={i === 0 ? 'Open project luminaires' : undefined}
                onClick={i === 0 ? () => data.openSection('luminaires') : undefined}
                onKeyDown={
                  i === 0
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          data.openSection('luminaires');
                        }
                      }
                    : undefined
                }
                style={{ cursor: i === 0 ? 'pointer' : undefined }}
              >
                <div
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 40,
                    background: i === 1 ? 'rgba(99,139,255,0.1)' : 'rgba(110,160,255,0.1)',
                    border: `1px solid ${i === 1 ? 'rgb(67,131,255)' : 'rgb(87,146,255)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item.icon}
                </div>
                {/* Big value */}
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 18,
                    fontWeight: 800,
                    color: item.valueColor,
                    lineHeight: 1.1,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {item.value}
                </div>
              </div>
              {/* Label */}
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  color: P.textMid,
                  fontWeight: 500,
                }}
              >
                {item.label}
              </div>
              {/* Sub / link */}
              {item.sub && (
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 11,
                    fontWeight: 600,
                    color: (item as { subColor?: string }).subColor ?? P.textMuted,
                    marginTop: -2,
                  }}
                >
                  {item.sub}
                </div>
              )}
              {item.link && (
                <button
                  onClick={() => data.openSection(i === 1 ? 'revisions' : 'actions')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 11,
                    fontWeight: 600,
                    color: P.blueMid,
                    marginTop: -2,
                    padding: 0,
                  }}
                >
                  {item.link}
                </button>
              )}
            </div>
          ))}
        </div>
        {/* Footer */}
        <div
          style={{
            marginTop: 'auto',
            flexShrink: 0,
            flexWrap: 'wrap',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <InlineGlyphs.SctDuration width="14" height="14" color={P.textMuted} />
            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: P.textMuted }}>
              Last Updated
            </span>
          </div>
          <span
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              color: P.textMid,
              fontWeight: 500,
            }}
          >
            {formatBusinessDateTime(project.updatedAt)}
          </span>
          <div style={{ width: 1, height: 16, background: P.border }} />
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: P.blue,
              color: 'var(--v4-action-primary-foreground)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 700,
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {data.lastUpdatedActor
              ? data.lastUpdatedActor
                  .split(/\s+/)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()
              : '—'}
          </div>
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: P.textMuted }}>
            {data.lastUpdatedActor || 'Not recorded'}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ── Recent Activity ───────────────────────────────────────────────────────────

interface ActivityItem {
  iconBg: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  time: string;
  timestamp: string;
  avatar: string;
  avatarBg: string;
  id: string;
}

function RecentActivityCard() {
  const data = useSummary();
  const activityIcons = {
    revision: InlineGlyphs.SctRevisions,
    meeting: InlineGlyphs.SctMeetings,
    action: InlineGlyphs.SctActions,
    issue: InlineGlyphs.SctIssue,
    comment: InlineGlyphs.SctComments,
    review: InlineGlyphs.SctTechnicalCheck,
    luminaire: InlineGlyphs.SctLuminaires,
    technical: InlineGlyphs.SctTechnicalCheck,
    package: InlineGlyphs.SctPackages,
    status: InlineGlyphs.SctTimeline,
    unknown: InlineGlyphs.SctTimeline,
  };
  const ACTIVITIES: ActivityItem[] = data.model.activity.map((item) => ({
    id: item.id,
    iconBg: P.greenLight,
    icon: (() => {
      const operationIcons = {
        add: InlineGlyphs.SctAdd,
        edit: InlineGlyphs.SctEdit,
        remove: InlineGlyphs.SctRemove,
        import: InlineGlyphs.SctSmartImport,
        export: InlineGlyphs.SctExport,
      };
      const Icon = item.operation ? operationIcons[item.operation] : activityIcons[item.category];
      return <Icon width="16" height="16" color={P.green} />;
    })(),
    title: item.title,
    desc:
      item.description && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(item.description)
        ? formatBusinessDateTime(item.description)
        : (item.description ?? ''),
    timestamp: item.timestamp,
    time: formatBusinessDateTime(item.timestamp, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
    avatar: item.actor
      ? item.actor
          .split(/\s+/)
          .map((part) => part[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
      : '—',
    avatarBg: P.blue,
  }));
  return (
    <Card
      label="Recent Activity"
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <CardHeader
        icon={<InlineGlyphs.SctTimeline width="18" height="18" color={P.blue} />}
        title="Recent Activity"
        action={<ViewAllLink onClick={data.openActivity} />}
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {ACTIVITIES.length === 0 ? (
          <p style={{ padding: 20, color: P.textMuted }}>No recent activity</p>
        ) : null}
        {ACTIVITIES.map((a, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '12px 20px',
              borderBottom: i < ACTIVITIES.length - 1 ? `1px solid ${P.border}` : 'none',
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: a.iconBg,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {a.icon}
            </div>
            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  color: P.text,
                }}
              >
                {a.title}
              </div>
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  color: P.textMuted,
                  marginTop: 2,
                }}
              >
                {a.desc}
              </div>
            </div>
            {/* Time + avatar */}
            <div
              style={{
                flexShrink: 0,
                textAlign: 'right',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 4,
              }}
            >
              <time
                dateTime={a.timestamp}
                style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: P.textMuted }}
              >
                {a.time}
              </time>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: a.avatarBg,
                  color: 'var(--v4-action-primary-foreground)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 8,
                  fontWeight: 800,
                  fontFamily: "'Inter', sans-serif",
                  paddingTop: 4,
                  paddingRight: 3,
                  paddingBottom: 4,
                  paddingLeft: 3,
                  boxSizing: 'border-box',
                }}
              >
                {a.avatar}
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Footer link */}
      <div style={{ padding: '12px 20px', borderTop: `1px solid ${P.border}` }}>
        <button
          onClick={data.openActivity}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            fontWeight: 500,
            color: P.blueMid,
          }}
        >
          View all activity
          <InlineGlyphs.SctNext width="14" height="14" />
        </button>
      </div>
    </Card>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

function SummaryContent() {
  const { project } = useSummary();
  const gap = LAYOUT.sectionGap;

  return (
    <div
      className="final-ui-reference"
      style={{
        padding: gap,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: gap,
        minHeight: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Page title */}
      <h1
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 26,
          fontWeight: 800,
          color: P.text,
          margin: 0,
          letterSpacing: '-0.02em',
          flexShrink: 0,
        }}
      >
        Project Overview
      </h1>

      {/* Workflow stage bar */}
      <div style={{ flexShrink: 0 }}>
        <WorkflowStageBar />
      </div>

      {/* 2x2 grid — opposite cards share the same row height */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap,
          minHeight: 0,
        }}
      >
        <NeedAttentionCard />
        <ProjectSnapshotCard project={project} />
        <NextActionCard />
        <RecentActivityCard />
      </div>
    </div>
  );
}

export default function FinalProjectSummaryView({ binding }: { binding: FinalSummaryBinding }) {
  return (
    <Context.Provider value={binding}>
      <SummaryContent />
    </Context.Provider>
  );
}
