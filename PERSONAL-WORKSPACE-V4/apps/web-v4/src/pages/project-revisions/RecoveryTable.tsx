/**
 * Recovery tab table.
 *
 * A Retry control is shown ONLY for an item with a REAL canonical recovery
 * target (Schedule/BOQ output or a revision with a resolvable owning family).
 * A FAILED revision without an owning-family recovery target is surfaced
 * truthfully ("Open owning workspace") instead of a fake Retry.
 *
 * Rows are selectable (keyboard operable, highlight matches the Revisions /
 * Outputs selected-row family) and drive the Recovery inspector.
 */
import type { KeyboardEvent } from 'react';
import { FolderOpen, RefreshCw } from '../../components/common/SctIcons';
import {
  formatIsoDateTime,
  hasDeterminableOwningFamily,
  recoveryItemCanRetry,
} from './revisionsViewModel';
import type { RecoveryItem } from './revisionsViewModel';

export function RecoveryTable({
  items,
  onSelect,
  selectedId,
  onRetry,
  onOpenOwningWorkspace,
  retryPending,
}: {
  items: RecoveryItem[];
  onSelect: (item: RecoveryItem) => void;
  selectedId: string | null;
  onRetry: (item: RecoveryItem) => void;
  onOpenOwningWorkspace: (item: RecoveryItem) => void;
  retryPending: boolean;
}) {
  if (!items.length) {
    return (
      <p className="v4-revisions__empty" data-testid="v4-recovery-empty">
        No recoverable items.
      </p>
    );
  }

  return (
    <div className="v4-revisions__table-scroll">
      <table className="v4-revisions__table" data-testid="v4-recovery-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Label</th>
            <th>Failure Reason</th>
            <th>Created At</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const canRetry = recoveryItemCanRetry(item);
            const selected = selectedId === item.id;
            const activate = () => onSelect(item);
            const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
              }
            };
            return (
              <tr
                key={item.id}
                data-testid={`v4-recovery-row-${item.id}`}
                data-selected={selected || undefined}
                className={selected ? 'v4-revisions__row--selected' : ''}
                tabIndex={0}
                aria-selected={selected}
                onClick={activate}
                onKeyDown={onRowKeyDown}
              >
                <td>
                  <span
                    className={`v4-revisions__badge v4-revisions__badge--${item.kind === 'revision' ? 'info' : 'warning'}`}
                  >
                    {item.kind}
                  </span>
                </td>
                <td>{item.label}</td>
                <td>{item.failureReason ?? '—'}</td>
                <td>{formatIsoDateTime(item.createdAt)}</td>
                <td className="v4-revisions__cell-actions">
                  {canRetry ? (
                    <button
                      type="button"
                      className="v4-revisions__action-btn v4-revisions__action-btn--retry"
                      title="Retry generation"
                      disabled={retryPending}
                      aria-busy={retryPending}
                      data-testid={`v4-recovery-retry-${item.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRetry(item);
                      }}
                    >
                      <RefreshCw size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="v4-revisions__action-btn"
                      title={
                        hasDeterminableOwningFamily(item)
                          ? 'Open owning workspace (recovery requires the owning output workspace)'
                          : 'Open project workspace (no owning output family is determinable)'
                      }
                      data-testid={`v4-recovery-open-${item.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenOwningWorkspace(item);
                      }}
                    >
                      <FolderOpen size={14} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
