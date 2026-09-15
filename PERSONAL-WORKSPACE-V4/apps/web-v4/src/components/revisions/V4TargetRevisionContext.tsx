/**
 * Target Revision context strip (C1 §17 / §25).
 *
 * A COMPACT, always-visible, read-only statement of the composition target the
 * URL currently carries — never a hero banner and never an editable control.
 * It stays rendered while a historical snapshot is being inspected, because the
 * target context and the historical selector are independent concerns.
 *
 * The verdict rendered here is SERVER-DERIVED. This component never decides
 * eligibility; it only reports it and offers the single clear-target action.
 */
import { SctRemove as Link2Off, SctWarning as ShieldAlert } from '../common/SctIcons';
import { Layers } from '../common/SctIcons';
import type { TechnicalOutputRequestedTargetView } from '@scli/domain';
import { canonicalOperationDisplay } from './canonicalRevisionDisplay';
import './V4TargetRevisionContext.css';

export interface V4TargetRevisionContextProps {
  /** Server verdict for the targetRevisionId in the URL. */
  requestedTarget: TechnicalOutputRequestedTargetView;
  /** Owner-facing name of the Output family this workspace generates. */
  familyLabel: string;
  onClear: () => void;
}

export function V4TargetRevisionContext({
  requestedTarget,
  familyLabel,
  onClear,
}: V4TargetRevisionContextProps) {
  if (!requestedTarget.eligible || !requestedTarget.target) {
    return (
      <div
        className="v4-target-context v4-target-context--invalid"
        role="alert"
        data-testid="v4-target-revision-invalid"
      >
        <ShieldAlert aria-hidden="true" />
        <div className="v4-target-context__body">
          <strong>Target Revision unavailable</strong>
          <span>
            {requestedTarget.message ||
              'The selected target Revision can no longer receive a generated Output.'}{' '}
            Generation is blocked until the target is cleared.
          </span>
        </div>
        <button
          type="button"
          className="v4-target-context__clear"
          onClick={onClear}
          data-testid="v4-target-revision-clear"
        >
          <Link2Off aria-hidden="true" /> Clear Target
        </button>
      </div>
    );
  }

  const target = requestedTarget.target;
  const occupied = target.occupiedFormats.filter((format) => format !== 'Both');
  return (
    <div className="v4-target-context" data-testid="v4-target-revision-chip">
      <Layers aria-hidden="true" />
      <div className="v4-target-context__body">
        <strong>
          Generating into <span className="v4-target-context__label">{target.revisionLabel}</span>
        </strong>
        <span data-testid="v4-target-revision-meta">
          {canonicalOperationDisplay('MANUAL_DELIVERABLES')} · {target.lifecycleState} ·{' '}
          {target.snapshotCount} document{target.snapshotCount === 1 ? '' : 's'}
          {occupied.length ? ` · ${familyLabel} ${occupied.join(' + ')} already present` : ''}
        </span>
      </div>
      <button
        type="button"
        className="v4-target-context__clear"
        onClick={onClear}
        data-testid="v4-target-revision-clear"
      >
        <Link2Off aria-hidden="true" /> Clear Target
      </button>
    </div>
  );
}
