import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from '../../components/common/SctIcons';
import { V4Button } from '../../components/common/V4Button';
import { V4AnchoredSurface } from '../../components/interaction/V4AnchoredSurface';

export interface FinderFacetOption {
  value: string;
  label: string;
  count: number;
}

export function LibraryFacetMenu({
  label,
  values,
  options,
  searchable = false,
  onApply,
}: {
  label: string;
  values: string[];
  options: FinderFacetOption[];
  searchable?: boolean;
  onApply: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);
  const [search, setSearch] = useState('');
  const ownerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      setDraft(values);
      setSearch('');
    }
  }, [open, values]);
  const visibleOptions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('en');
    return term
      ? options.filter((option) => option.label.toLocaleLowerCase('en').includes(term))
      : options;
  }, [options, search]);
  const selectedLabels = values
    .map((value) => options.find((option) => option.value === value)?.label ?? value)
    .join(', ');
  return (
    <div className="v4-library__facet-menu" ref={ownerRef}>
      <button
        type="button"
        ref={triggerRef}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <small>{label}</small>
          <strong>{selectedLabels || `All ${label}`}</strong>
        </span>
        <ChevronDown aria-hidden="true" />
      </button>
      <V4AnchoredSurface
        open={open}
        onRequestClose={() => setOpen(false)}
        ownerRef={ownerRef}
        triggerRef={triggerRef}
        className="v4-library__facet-popover"
        role="dialog"
        ariaLabel={`${label} filters`}
      >
        <header>
          <strong>{label}</strong>
          <span>{draft.length ? `${draft.length} selected` : 'All values'}</span>
        </header>
        {searchable ? (
          <label className="v4-library__facet-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              aria-label={`Search ${label}`}
              value={search}
              placeholder={`Search ${label}…`}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        ) : null}
        <fieldset className="v4-library__facet-checklist">
          <legend>{label}</legend>
          <div className="v4-library__facet-options">
            {visibleOptions.length ? (
              visibleOptions.map((option) => (
                <label key={option.value}>
                  <input
                    type="checkbox"
                    aria-label={option.label}
                    checked={draft.includes(option.value)}
                    onChange={(event) =>
                      setDraft((current) =>
                        event.target.checked
                          ? [...current, option.value]
                          : current.filter((value) => value !== option.value),
                      )
                    }
                  />
                  <span>{option.label}</span>
                  <small>{option.count}</small>
                </label>
              ))
            ) : (
              <span>No published values</span>
            )}
          </div>
        </fieldset>
        <footer className="v4-library__popover-actions">
          <V4Button variant="tertiary" size="compact" onClick={() => setDraft([])}>
            Clear
          </V4Button>
          <V4Button
            variant="primary"
            size="compact"
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            Apply
          </V4Button>
        </footer>
      </V4AnchoredSurface>
    </div>
  );
}
