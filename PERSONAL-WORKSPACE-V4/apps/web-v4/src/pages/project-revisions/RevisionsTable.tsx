/**
 * Revisions tab dense table.
 *
 * Filter toolbar (view-model only) + bounded table + anchored footer with
 * result count, V4Pagination and rows-per-page.
 */
import type { CanonicalRevisionRecord, RevisionReuseCandidate } from '@scli/domain';
import { SctRestore as RotateCcw } from '../../components/common/SctIcons';
import { Plus, RefreshCw, ChevronRight } from '../../components/common/SctIcons';
import { V4Pagination } from '../../components/common/V4Pagination';
import {
  formatIsoDateTime,
  lifecycleTone,
  sourceDisplay,
  type RevisionFilters,
  type RevisionRow,
} from './revisionsViewModel';
import { RevisionsFilterToolbar } from './FilterToolbar';

const PAGE_SIZES = [10, 25, 50];

export function RevisionsTable({
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
  onSelect,
  onViewDetails,
  onRetry,
  selectedId,
  retryPending,
  onCreateRevision,
  createPending,
  reuseCandidate,
  onReuseRevision,
  reusePending,
}: {
  /** The current page slice (already filtered + paginated by the page). */
  rows: RevisionRow[];
  /** Filtered row count (pre-pagination) used by the footer. */
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  filters: RevisionFilters;
  onFiltersChange: (next: RevisionFilters) => void;
  filterOptions: { lifecycles: string[]; sources: string[]; createdBy: string[] };
  filtersActive: boolean;
  /** Whether any revision exists at all (distinguishes empty from filtered-out). */
  hasData: boolean;
  onSelect: (revision: CanonicalRevisionRecord) => void;
  onViewDetails: (revision: CanonicalRevisionRecord) => void;
  onRetry: (revision: CanonicalRevisionRecord) => void;
  selectedId: string | null;
  retryPending: boolean;
  onCreateRevision: () => void;
  createPending: boolean;
  reuseCandidate: RevisionReuseCandidate | null;
  onReuseRevision: () => void;
  reusePending: boolean;
}) {
  return (
    <div className="v4-revisions__table-card">
      <div className="v4-revisions__toolbar-row">
        <RevisionsFilterToolbar
          filters={filters}
          onChange={onFiltersChange}
          options={filterOptions}
          active={filtersActive}
          onClear={() =>
            onFiltersChange({ search: '', lifecycle: '', source: '', createdBy: '', date: 'all' })
          }
        />
        <div className="v4-revisions__create-actions">
          {reuseCandidate ? (
            <button
              type="button"
              className="v4-deliverables__secondary"
              onClick={onReuseRevision}
              disabled={reusePending || createPending}
              data-testid="v4-reuse-revision"
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>{reusePending ? 'Reusing…' : `Reuse ${reuseCandidate.revisionLabel}`}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="v4-deliverables__primary"
            onClick={onCreateRevision}
            disabled={createPending || reusePending}
            data-testid="v4-create-revision"
          >
            <Plus size={14} aria-hidden="true" />
            <span>{createPending ? 'Creating…' : 'Create Revision'}</span>
          </button>
        </div>
      </div>

      <div className="v4-revisions__table-scroll">
        {!hasData ? (
          <p className="v4-revisions__empty" data-testid="v4-revisions-empty">
            No revisions recorded yet.
          </p>
        ) : rows.length === 0 ? (
          <p className="v4-revisions__empty" data-testid="v4-revisions-filtered-empty">
            No revisions match the current filters.
          </p>
        ) : (
          <table className="v4-revisions__table" data-testid="v4-revisions-table">
            <thead>
              <tr>
                <th>Revision</th>
                <th>Source / Operation</th>
                <th>Lifecycle</th>
                <th>Created By</th>
                <th>Created At</th>
                <th>Luminaires</th>
                <th>Generated Outputs</th>
                <th>Compatibility</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ revision, outputsCount, compatibilityStatus, recoverableFamily }) => {
                const canRetry =
                  revision.lifecycleState === 'FAILED_RECOVERABLE' &&
                  (recoverableFamily === 'LuminaireSchedule' ||
                    recoverableFamily === 'TechnicalBoq');
                const selected = selectedId === revision.revisionId;
                return (
                  <tr
                    key={revision.revisionId}
                    data-testid={`v4-revision-row-${revision.revisionId}`}
                    data-selected={selected || undefined}
                    className={selected ? 'v4-revisions__row--selected' : ''}
                    onClick={() => onSelect(revision)}
                  >
                    <td>
                      <strong className="v4-revisions__revision-label">
                        {revision.revisionLabel}
                      </strong>
                    </td>
                    <td className="v4-revisions__cell-source" title={sourceDisplay(revision)}>
                      {sourceDisplay(revision)}
                    </td>
                    <td>
                      <span
                        className={`v4-revisions__badge v4-revisions__badge--${lifecycleTone(revision.lifecycleState)}`}
                      >
                        {revision.lifecycleState}
                      </span>
                    </td>
                    <td>{revision.createdByName ?? '—'}</td>
                    <td className="v4-revisions__cell-date">
                      {formatIsoDateTime(revision.createdAt)}
                    </td>
                    <td>{(revision.luminaireSnapshot ?? []).length}</td>
                    <td>{outputsCount}</td>
                    <td
                      className="v4-revisions__cell-compat"
                      title={compatibilityStatus ?? undefined}
                    >
                      {compatibilityStatus ?? '—'}
                    </td>
                    <td className="v4-revisions__cell-actions">
                      <button
                        type="button"
                        className="v4-revisions__action-btn"
                        title="View Revision details"
                        aria-label={`View Revision details for ${revision.revisionLabel}`}
                        data-testid={`v4-revision-details-${revision.revisionId}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewDetails(revision);
                        }}
                      >
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                      {canRetry ? (
                        <button
                          type="button"
                          className="v4-revisions__action-btn v4-revisions__action-btn--retry"
                          title="Retry generation"
                          disabled={retryPending}
                          data-testid={`v4-revision-retry-${revision.revisionId}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRetry(revision);
                          }}
                        >
                          <RefreshCw size={14} aria-hidden="true" />
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
        <footer className="v4-revisions__table-footer" data-testid="v4-revisions-footer">
          <span className="v4-revisions__footer-count">
            Showing {totalCount === 0 ? 0 : page * pageSize + 1} to{' '}
            {Math.min((page + 1) * pageSize, totalCount)} of {totalCount} revisions
          </span>
          <V4Pagination
            pageCount={Math.max(1, Math.ceil(totalCount / pageSize))}
            currentPage={page}
            onChange={onPageChange}
            ariaLabel="Revisions pages"
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
