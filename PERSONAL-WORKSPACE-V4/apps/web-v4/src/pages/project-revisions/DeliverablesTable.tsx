/**
 * Deliverables tab dense table.
 *
 * This is the unified Revision Deliverable read model — it can contain both
 * GeneratedOutput and DocumentSnapshot deliverables, STRICTLY scoped to the
 * currently selected Revision. Filter toolbar (view-model only) + bounded table
 * + anchored footer with result count, V4Pagination and rows-per-page. Source
 * type (Generated Output vs Registered File) is a NON-semantic provenance chip;
 * artifact state is displayed separately and truthfully. Open is offered ONLY
 * for a Present GeneratedOutput with a real open authority.
 */
import { ExternalLink } from '../../components/common/SctIcons';
import { V4Pagination } from '../../components/common/V4Pagination';
import type { RevisionDeliverable } from '@scli/domain';
import {
  deliverableFormat,
  deliverableSourceLabel,
  deliverableTitle,
  deliverableTypeLabel,
  type DeliverableFilters,
  type DeliverableRow,
} from './revisionsViewModel';
import { DeliverablesFilterToolbar } from './FilterToolbar';

const PAGE_SIZES = [10, 25, 50];

export type DeliverableEmptyState = 'no-revision' | 'preparing-zero' | 'historical-zero';

export function DeliverablesTable({
  rows,
  totalCount,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  filters,
  onFiltersChange,
  filterOptions,
  filtersActive,
  hasData,
  emptyState,
  onSelect,
  onOpen,
  canOpenDeliverable,
  onAddDeliverable,
  canAddDeliverable,
  selectedId,
}: {
  rows: DeliverableRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  filters: DeliverableFilters;
  onFiltersChange: (next: DeliverableFilters) => void;
  filterOptions: {
    sources: string[];
    types: string[];
    formats: string[];
    artifactStates: string[];
  };
  filtersActive: boolean;
  hasData: boolean;
  /** Which scoped empty state to render when there are no rows (null = data present). */
  emptyState: DeliverableEmptyState | null;
  onSelect: (deliverable: RevisionDeliverable) => void;
  onOpen: (deliverable: RevisionDeliverable) => void;
  /** True only when a real safe open authority exists for this deliverable. */
  canOpenDeliverable: (deliverable: RevisionDeliverable) => boolean;
  onAddDeliverable: () => void;
  canAddDeliverable: boolean;
  selectedId: string | null;
}) {
  return (
    <div className="v4-revisions__table-card">
      <DeliverablesFilterToolbar
        filters={filters}
        onChange={onFiltersChange}
        options={filterOptions}
        active={filtersActive}
        onClear={() => onFiltersChange({ source: '', type: '', format: '', artifactState: '' })}
      />

      <div className="v4-revisions__table-scroll">
        {!hasData ? (
          emptyState === 'no-revision' ? (
            <p className="v4-revisions__empty" data-testid="v4-deliverables-empty">
              Select a Revision to view its Deliverables.
            </p>
          ) : emptyState === 'preparing-zero' ? (
            <div className="v4-deliverables__empty-state" data-testid="v4-deliverables-empty">
              <p>No Deliverables have been added to this Revision yet.</p>
              {canAddDeliverable ? (
                <button
                  type="button"
                  className="v4-deliverables__primary"
                  onClick={onAddDeliverable}
                  data-testid="v4-deliverables-empty-add"
                >
                  Add Deliverable
                </button>
              ) : null}
            </div>
          ) : emptyState === 'historical-zero' ? (
            <p className="v4-revisions__empty" data-testid="v4-deliverables-empty">
              This Revision has no registered Deliverables — a valid historical state.
            </p>
          ) : (
            <p className="v4-revisions__empty" data-testid="v4-deliverables-empty">
              No deliverables registered yet.
            </p>
          )
        ) : rows.length === 0 ? (
          <p className="v4-revisions__empty" data-testid="v4-deliverables-filtered-empty">
            No deliverables match the current filters.
          </p>
        ) : (
          <table className="v4-revisions__table" data-testid="v4-deliverables-table">
            <thead>
              <tr>
                <th>Deliverable</th>
                <th>Source</th>
                <th>Type</th>
                <th>Format</th>
                <th>Revision</th>
                <th>Artifact</th>
                <th>Identity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ deliverable, revisionLabel, artifactState }) => {
                const selected = selectedId === deliverable.deliverableId;
                const typeLabel = deliverableTypeLabel(deliverable);
                const format = deliverableFormat(deliverable);
                // Open is allowed ONLY for a Present GeneratedOutput with a real
                // safe open authority (checked via canOpenDeliverable). For
                // DocumentSnapshot (B1) and for Missing/Unavailable/absent-path
                // states, no active Open action.
                const canOpen = canOpenDeliverable(deliverable);
                return (
                  <tr
                    key={deliverable.deliverableId}
                    data-testid={`v4-deliverable-row-${deliverable.deliverableId}`}
                    data-selected={selected || undefined}
                    className={selected ? 'v4-revisions__row--selected' : ''}
                    onClick={() => onSelect(deliverable)}
                  >
                    <td className="v4-deliverables__cell-title">{deliverableTitle(deliverable)}</td>
                    <td>
                      <span
                        className={`v4-deliverables__source-chip v4-deliverables__source-chip--${deliverable.sourceType === 'GeneratedOutput' ? 'generated' : 'registered'}`}
                      >
                        {deliverableSourceLabel(deliverable)}
                      </span>
                    </td>
                    <td>{typeLabel ?? '—'}</td>
                    <td>{format ?? '—'}</td>
                    <td>{revisionLabel ?? '—'}</td>
                    <td>
                      <span
                        className={`v4-revisions__artifact-badge v4-revisions__artifact-badge--${artifactState.toLowerCase()}`}
                      >
                        {artifactState}
                      </span>
                    </td>
                    <td className="v4-revisions__inspector-hash">
                      {deliverable.contentHash ? deliverable.contentHash.slice(0, 12) : '—'}
                    </td>
                    <td className="v4-revisions__cell-actions">
                      {canOpen ? (
                        <button
                          type="button"
                          className="v4-revisions__action-btn"
                          title="Open artifact"
                          data-testid={`v4-open-deliverable-${deliverable.deliverableId}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(deliverable);
                          }}
                        >
                          <ExternalLink size={14} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {hasData && totalCount > 0 ? (
        <footer className="v4-revisions__table-footer" data-testid="v4-deliverables-footer">
          <span className="v4-revisions__footer-count">
            Showing {totalCount === 0 ? 0 : page * pageSize + 1} to{' '}
            {Math.min((page + 1) * pageSize, totalCount)} of {totalCount} deliverables
          </span>
          <V4Pagination
            pageCount={Math.max(1, Math.ceil(totalCount / pageSize))}
            currentPage={page}
            onChange={onPageChange}
            ariaLabel="Deliverables pages"
          />
          <label className="v4-revisions__rows-per-page">
            <span className="v4-visually-hidden">Rows per page</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </label>
        </footer>
      ) : null}
    </div>
  );
}
