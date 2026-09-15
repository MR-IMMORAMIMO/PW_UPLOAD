import { STATUS, RADIUS } from '../tokens';

// Semantic status names mapped to STATUS token keys
const STATUS_MAP: Record<string, keyof typeof STATUS> = {
  // success variants
  Ready: 'success',
  Mapped: 'success',
  Active: 'success',
  Approved: 'success',
  Complete: 'success',
  Completed: 'success',
  Done: 'success',
  // warning variants
  'Needs Review': 'warning',
  Review: 'warning',
  Pending: 'warning',
  // danger variants
  Conflict: 'danger',
  Blocked: 'danger',
  Rejected: 'danger',
  Failed: 'danger',
  // orange / info
  'Needs Mapping': 'orange',
  'In Progress': 'info',
  Planning: 'info',
  'On Hold': 'warning',
  // orange
  Draft: 'orange',
  Update: 'orange',
  // purple
  Archived: 'purple',
  // neutral
  '—': 'neutral',
  Inactive: 'neutral',
};

type StatusKey = keyof typeof STATUS;

interface StatusChipProps {
  status: string;
  /** Override the automatic color mapping */
  variant?: StatusKey;
  size?: 'sm' | 'md';
  dot?: boolean;
}

export default function StatusChip({ status, variant, size = 'md', dot = false }: StatusChipProps) {
  if (status === '—') {
    return <span style={{ color: '#9ca3af' }}>—</span>;
  }

  const key: StatusKey = variant ?? STATUS_MAP[status] ?? 'neutral';
  const cfg = STATUS[key];

  const px = size === 'sm' ? '6px' : '8px';
  const py = size === 'sm' ? '1px' : '2px';
  const fs = size === 'sm' ? 9 : 10;

  return (
    <span
      className="inline-flex items-center font-semibold whitespace-nowrap border"
      style={{
        background: cfg.bg,
        borderColor: cfg.border,
        color: cfg.text,
        paddingLeft: px,
        paddingRight: px,
        paddingTop: py,
        paddingBottom: py,
        fontSize: fs,
        borderRadius: RADIUS.full,
      }}
    >
      {dot && (
        <span
          className="shrink-0 rounded-full mr-1.5"
          style={{ width: 6, height: 6, background: cfg.text }}
        />
      )}
      {status}
    </span>
  );
}
