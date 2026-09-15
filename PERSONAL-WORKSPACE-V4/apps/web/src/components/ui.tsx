import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CircleOff,
  FolderKanban,
  RefreshCw,
  SearchX,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { statusLabels, type AppUser, type Priority, type ProjectStatus } from '@scli/domain';
import { workspaceDateKey } from '../local-date';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function formatDate(value: string | null, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00.000Z`)
    : new Date(value);
  return new Intl.DateTimeFormat('en-AE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Dubai',
    ...options,
  }).format(date);
}

export function Avatar({
  user,
  size = 'md',
}: {
  user: Pick<AppUser, 'displayName' | 'avatarUrl'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.displayName)}
    </span>
  );
}

export function StatusBadge({
  status,
  label,
}: {
  status: ProjectStatus;
  label?: string | undefined;
}) {
  return <span className={`status-badge status-${status}`}>{label ?? statusLabels[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`priority-badge priority-${priority}`}>{priority}</span>;
}

export function ProgressBar({ value, label = 'Progress' }: { value: number; label?: string }) {
  return (
    <div className="progress-block">
      <div className="progress-meta">
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <motion.span
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function KpiCard({
  icon,
  label,
  value,
  detail,
  tone = 'default',
  delay = 0,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  detail: string;
  tone?: 'default' | 'accent' | 'warning' | 'danger';
  delay?: number;
}) {
  return (
    <motion.article
      className={`kpi-card kpi-${tone}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay }}
    >
      <div className="kpi-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </motion.article>
  );
}

export function LoadingState({ label = 'Loading workspace…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-orbit" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-card error-state" role="alert">
      <AlertTriangle aria-hidden="true" />
      <h2>Something needs attention</h2>
      <p>{message}</p>
      {onRetry ? (
        <button className="button secondary" type="button" onClick={onRetry}>
          <RefreshCw size={16} /> Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  kind = 'empty',
}: {
  title: string;
  description: string;
  action?: ReactNode;
  kind?: 'empty' | 'search' | 'permission';
}) {
  const Icon = kind === 'search' ? SearchX : kind === 'permission' ? CircleOff : FolderKanban;
  return (
    <div className="state-card empty-state">
      <Icon aria-hidden="true" />
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function SectionHeading({
  title,
  detail,
  to,
}: {
  title: string;
  detail?: string;
  to?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      {to ? (
        <Link className="text-link" to={to}>
          View all <ArrowRight size={15} />
        </Link>
      ) : null}
    </div>
  );
}

export function Deadline({ date }: { date: string }) {
  const overdue = date < workspaceDateKey();
  return (
    <span className={overdue ? 'deadline overdue' : 'deadline'}>
      <CalendarDays size={14} aria-hidden="true" />
      {formatDate(date)}
      {overdue ? ' · Overdue' : ''}
    </span>
  );
}
