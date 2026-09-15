/**
 * V4ProjectContextHeader — reusable project-level header.
 *
 * Presents SIX independent metadata cells with a clear small-muted-label +
 * strong-value hierarchy:
 *
 *   Project Code | Project Name | Client | Project Type | Design Stage | Due Date
 *
 * with an optional right-side contextual action slot.
 *
 * Locked semantic rule (owner-locked):
 *   Project Status != Design Stage != Workflow Progress
 *
 * This header intentionally does NOT label Design Stage as Project Status and
 * does not collapse the concepts. Design Stage is one distinct field.
 *
 * Data is supplied from REAL canonical Project data by the consuming route.
 * Missing/unsupported fields render a truthful neutral value (—) rather than
 * fabricated content.
 */
import type { ReactNode } from 'react';
import { deriveDueState } from './dueState';
import { useV4StickyScrolled } from './useV4StickyScrolled';
import { formatBusinessDateOnly } from '../../date-time/businessDateTime';

export interface V4ProjectContextHeaderData {
  projectCode: string;
  projectName: string;
  clientName: string | null;
  projectType: string | null;
  designStage: string | null;
  /** ISO due date; nullable/missing renders a neutral empty value. */
  requiredDeliveryDate: string | null;
  /** The "now" used for due-date state derivation (defaults to real now). */
  now?: Date;
}

export interface V4ProjectContextHeaderProps {
  data: V4ProjectContextHeaderData;
  /** Optional right-side contextual actions slot (empty in F2). */
  actions?: ReactNode;
}

/** Format an ISO date for display (UTC; truthful, not fabricated). */
function formatDate(iso: string): string {
  return (
    formatBusinessDateOnly(iso.slice(0, 10), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }) || '—'
  );
}

export function V4ProjectContextHeader({ data, actions }: V4ProjectContextHeaderProps) {
  const dueState = deriveDueState(data.requiredDeliveryDate, data.now ?? new Date());
  const dueLabel =
    data.requiredDeliveryDate == null || !data.requiredDeliveryDate
      ? '—'
      : formatDate(data.requiredDeliveryDate);

  // Sticky header + structural scrolled-state hook (H1-D1). The header stays
  // visible while page content scrolls; a subtle divider state appears once
  // content has scrolled underneath (no Phase-3 shadow polish).
  const { ref, scrolled } = useV4StickyScrolled();

  return (
    <header
      ref={ref}
      className={scrolled ? 'v4-pch v4-pch--scrolled' : 'v4-pch'}
      data-testid="v4-project-context-header"
      data-scrolled={scrolled}
    >
      <dl className="v4-pch__fields">
        <div className="v4-pch__field">
          <dt className="v4-pch__label">Project Code</dt>
          <dd className="v4-pch__value" data-testid="v4-pch-code" title={data.projectCode}>
            {data.projectCode}
          </dd>
        </div>
        <div className="v4-pch__field">
          <dt className="v4-pch__label">Project Name</dt>
          <dd
            className="v4-pch__value v4-pch__value--name"
            data-testid="v4-pch-name"
            title={data.projectName}
          >
            {data.projectName}
          </dd>
        </div>
        <div className="v4-pch__field">
          <dt className="v4-pch__label">Client</dt>
          <dd
            className="v4-pch__value"
            data-testid="v4-pch-client"
            title={data.clientName ?? undefined}
          >
            {data.clientName ?? '—'}
          </dd>
        </div>
        <div className="v4-pch__field">
          <dt className="v4-pch__label">Project Type</dt>
          <dd
            className="v4-pch__value"
            data-testid="v4-pch-type"
            title={data.projectType ?? undefined}
          >
            {data.projectType ?? '—'}
          </dd>
        </div>
        <div className="v4-pch__field">
          <dt className="v4-pch__label">Design Stage</dt>
          <dd
            className="v4-pch__value"
            data-testid="v4-pch-stage"
            title={data.designStage ?? 'Design stage — distinct from project status'}
          >
            {data.designStage ?? '—'}
          </dd>
        </div>
        <div className="v4-pch__field">
          <dt className="v4-pch__label">Due Date</dt>
          <dd
            className={`v4-pch__value v4-pch__value--due-${dueState}`}
            data-testid="v4-pch-due"
            data-due-state={dueState}
            title={dueLabel}
          >
            {dueLabel}
          </dd>
        </div>
      </dl>

      {/* Permanent invisible future-action layout slot (H2). Always reserved
          in geometry; renders NO placeholder/border/copy when empty. */}
      <div className="v4-pch__action-slot" data-testid="v4-pch-action-slot">
        {actions}
      </div>
    </header>
  );
}
