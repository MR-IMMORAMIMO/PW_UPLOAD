/**
 * Compact filter toolbars for the Revisions and Outputs tabs.
 *
 * Pure view-model/local presentation: options are derived from loaded data,
 * values are controlled by the page, and every change just narrows the visible
 * set. No extra queries, no backend projection changes.
 */
import { Search, X } from '../../components/common/SctIcons';
import { V4FilterSelect, type V4FilterSelectOption } from '../../components/common/V4FilterSelect';
import { V4Toolbar } from '../../components/common/V4Toolbar';
import {
  DATE_FILTER_OPTIONS,
  type DateFilterKey,
  type DeliverableFilters,
  type RevisionFilters,
} from './revisionsViewModel';

function toOptions(values: string[]): V4FilterSelectOption[] {
  return [{ value: '', label: 'All' }, ...values.map((value) => ({ value, label: value }))];
}

function ClearFilters({ onClear }: { onClear: () => void }) {
  return (
    <button
      type="button"
      className="v4-revisions__clear-filters"
      data-testid="v4-filters-clear"
      onClick={onClear}
    >
      <X size={13} aria-hidden="true" />
      <span>Clear Filters</span>
    </button>
  );
}

export function RevisionsFilterToolbar({
  filters,
  onChange,
  options,
  active,
  onClear,
}: {
  filters: RevisionFilters;
  onChange: (next: RevisionFilters) => void;
  options: { lifecycles: string[]; sources: string[]; createdBy: string[] };
  active: boolean;
  onClear: () => void;
}) {
  const update = (patch: Partial<RevisionFilters>) => onChange({ ...filters, ...patch });
  return (
    <V4Toolbar
      className="v4-revisions__toolbar"
      label="Filter revisions"
      data-testid="v4-revisions-toolbar"
      left={
        <>
          <label className="v4-revisions__search">
            <Search size={14} aria-hidden="true" />
            <span className="v4-visually-hidden">Search revisions</span>
            <input
              type="search"
              placeholder="Search revisions..."
              aria-label="Search revisions"
              data-testid="v4-revisions-search"
              value={filters.search}
              onChange={(event) => update({ search: event.target.value })}
            />
          </label>
          <V4FilterSelect
            label="Filter by lifecycle"
            value={filters.lifecycle}
            options={toOptions(options.lifecycles)}
            onChange={(lifecycle) => update({ lifecycle })}
          />
          <V4FilterSelect
            label="Filter by source or operation"
            value={filters.source}
            options={toOptions(options.sources)}
            onChange={(source) => update({ source })}
          />
          <V4FilterSelect
            label="Filter by created by"
            value={filters.createdBy}
            options={toOptions(options.createdBy)}
            onChange={(createdBy) => update({ createdBy })}
          />
          <V4FilterSelect
            label="Filter by date"
            value={filters.date}
            options={DATE_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(date) => update({ date: date as DateFilterKey })}
          />
          {active ? <ClearFilters onClear={onClear} /> : null}
        </>
      }
    />
  );
}

/**
 * Compact filter toolbar for the Deliverables tab.
 *
 * Pure view-model/local presentation: options are derived from loaded data,
 * values are controlled by the page, and every change just narrows the visible
 * set. No extra queries, no backend projection changes.
 */
export function DeliverablesFilterToolbar({
  filters,
  onChange,
  options,
  active,
  onClear,
}: {
  filters: DeliverableFilters;
  onChange: (next: DeliverableFilters) => void;
  options: {
    sources: string[];
    types: string[];
    formats: string[];
    artifactStates: string[];
  };
  active: boolean;
  onClear: () => void;
}) {
  const update = (patch: Partial<DeliverableFilters>) => onChange({ ...filters, ...patch });
  const sourceOptions: V4FilterSelectOption[] = [
    { value: '', label: 'All Sources' },
    ...options.sources.map((value) => ({ value, label: value })),
  ];
  const typeOptions: V4FilterSelectOption[] = [
    { value: '', label: 'All Types' },
    ...options.types.map((value) => ({ value, label: value })),
  ];
  const formatOptions: V4FilterSelectOption[] = [
    { value: '', label: 'All Formats' },
    ...options.formats.map((value) => ({ value, label: value })),
  ];
  const artifactOptions: V4FilterSelectOption[] = [
    { value: '', label: 'All Artifact States' },
    ...options.artifactStates.map((value) => ({ value, label: value })),
  ];
  return (
    <V4Toolbar
      className="v4-revisions__toolbar"
      label="Filter deliverables"
      data-testid="v4-deliverables-toolbar"
      left={
        <>
          <V4FilterSelect
            label="Filter by source"
            value={filters.source}
            options={sourceOptions}
            onChange={(source) => update({ source })}
          />
          <V4FilterSelect
            label="Filter by type or category"
            value={filters.type}
            options={typeOptions}
            onChange={(type) => update({ type })}
          />
          <V4FilterSelect
            label="Filter by format"
            value={filters.format}
            options={formatOptions}
            onChange={(format) => update({ format })}
          />
          <V4FilterSelect
            label="Filter by artifact state"
            value={filters.artifactState}
            options={artifactOptions}
            onChange={(artifactState) => update({ artifactState })}
          />
          {active ? <ClearFilters onClear={onClear} /> : null}
        </>
      }
    />
  );
}
