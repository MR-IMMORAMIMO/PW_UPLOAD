import { useEffect, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from '../../components/common/SctIcons';
import { V4Button } from '../../components/common/V4Button';
import { V4Field } from '../../components/common/V4Field';
import { V4AnchoredSurface } from '../../components/interaction/V4AnchoredSurface';
import type { FinderFacetOption } from './LibraryFacetMenu';

export interface MoreFilterValues {
  wattageMin: string;
  wattageMax: string;
  wattageBasis: 'W' | 'W_PER_M';
  lumensMin: string;
  lumensMax: string;
  lumensBasis: 'LM' | 'LM_PER_M';
  criMin: string;
  ip: string[];
  control: string[];
  mounting: string[];
  hasProductImage: boolean;
  hasDatasheet: boolean;
  hasIes: boolean;
  hasLdt: boolean;
  missingPhotometry: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
}

function checklist(
  label: string,
  values: string[],
  options: FinderFacetOption[],
  onChange: (values: string[]) => void,
) {
  return (
    <fieldset className="v4-library__facet-checklist">
      <legend>{label}</legend>
      <div className="v4-library__facet-options">
        {options.length ? (
          options.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                aria-label={option.label}
                checked={values.includes(option.value)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...values, option.value]
                      : values.filter((value) => value !== option.value),
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
  );
}

export function LibraryMoreFilters({
  values,
  ipOptions,
  controlOptions,
  mountingOptions,
  onApply,
}: {
  values: MoreFilterValues;
  ipOptions: FinderFacetOption[];
  controlOptions: FinderFacetOption[];
  mountingOptions: FinderFacetOption[];
  onApply: (values: MoreFilterValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);
  const ownerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) setDraft(values);
  }, [open, values]);
  const activeCount =
    Number(Boolean(values.wattageMin || values.wattageMax)) +
    Number(Boolean(values.lumensMin || values.lumensMax)) +
    Number(Boolean(values.criMin)) +
    values.ip.length +
    values.control.length +
    values.mounting.length +
    Number(values.hasProductImage) +
    Number(values.hasDatasheet) +
    Number(values.hasIes) +
    Number(values.hasLdt) +
    Number(values.missingPhotometry) +
    Number(values.status === 'ARCHIVED');
  const clear = (): MoreFilterValues => ({
    wattageMin: '',
    wattageMax: '',
    wattageBasis: 'W',
    lumensMin: '',
    lumensMax: '',
    lumensBasis: 'LM',
    criMin: '',
    ip: [],
    control: [],
    mounting: [],
    hasProductImage: false,
    hasDatasheet: false,
    hasIes: false,
    hasLdt: false,
    missingPhotometry: false,
    status: 'ACTIVE',
  });
  return (
    <div className="v4-library__more-anchor" ref={ownerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="v4-library__more-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal aria-hidden="true" />
        <span>{activeCount ? `More · ${activeCount}` : 'More Filters'}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      <V4AnchoredSurface
        open={open}
        onRequestClose={() => setOpen(false)}
        ownerRef={ownerRef}
        triggerRef={triggerRef}
        className="v4-library__more-filters"
        role="dialog"
        ariaLabel="More Library filters"
      >
        <header>
          <strong>More Filters</strong>
          <span>Changes apply when confirmed</span>
        </header>
        <section>
          <h3>Technical</h3>
          <div className="v4-library__range-grid">
            <V4Field label="Wattage from" controlId="library-wattage-min">
              <input
                id="library-wattage-min"
                type="number"
                min="0"
                value={draft.wattageMin}
                onChange={(event) => setDraft({ ...draft, wattageMin: event.target.value })}
              />
            </V4Field>
            <V4Field label="Wattage to" controlId="library-wattage-max">
              <input
                id="library-wattage-max"
                type="number"
                min="0"
                value={draft.wattageMax}
                onChange={(event) => setDraft({ ...draft, wattageMax: event.target.value })}
              />
            </V4Field>
            <V4Field label="Basis" controlId="library-wattage-basis">
              <select
                id="library-wattage-basis"
                value={draft.wattageBasis}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    wattageBasis: event.target.value as MoreFilterValues['wattageBasis'],
                  })
                }
              >
                <option value="W">W</option>
                <option value="W_PER_M">W/m</option>
              </select>
            </V4Field>
          </div>
          <div className="v4-library__range-grid">
            <V4Field label="Lumens from" controlId="library-lumens-min">
              <input
                id="library-lumens-min"
                type="number"
                min="0"
                value={draft.lumensMin}
                onChange={(event) => setDraft({ ...draft, lumensMin: event.target.value })}
              />
            </V4Field>
            <V4Field label="Lumens to" controlId="library-lumens-max">
              <input
                id="library-lumens-max"
                type="number"
                min="0"
                value={draft.lumensMax}
                onChange={(event) => setDraft({ ...draft, lumensMax: event.target.value })}
              />
            </V4Field>
            <V4Field label="Basis" controlId="library-lumens-basis">
              <select
                id="library-lumens-basis"
                value={draft.lumensBasis}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    lumensBasis: event.target.value as MoreFilterValues['lumensBasis'],
                  })
                }
              >
                <option value="LM">lm</option>
                <option value="LM_PER_M">lm/m</option>
              </select>
            </V4Field>
          </div>
          <V4Field label="Minimum CRI" controlId="library-cri-min">
            <input
              id="library-cri-min"
              type="number"
              min="0"
              max="100"
              value={draft.criMin}
              onChange={(event) => setDraft({ ...draft, criMin: event.target.value })}
            />
          </V4Field>
          {checklist('IP', draft.ip, ipOptions, (ip) => setDraft({ ...draft, ip }))}
          {checklist('Control', draft.control, controlOptions, (control) =>
            setDraft({ ...draft, control }),
          )}
        </section>
        <section>
          <h3>Installation</h3>
          {checklist('Mounting', draft.mounting, mountingOptions, (mounting) =>
            setDraft({ ...draft, mounting }),
          )}
          <p className="v4-library__filter-note">
            Cut-out remains display-only until an unambiguous normalized range model is approved.
          </p>
        </section>
        <section>
          <h3>Assets</h3>
          <fieldset className="v4-library__asset-filters">
            <legend>Asset availability</legend>
            {(
              [
                ['Has Product Image', 'hasProductImage'],
                ['Has Datasheet', 'hasDatasheet'],
                ['Has IES', 'hasIes'],
                ['Has LDT', 'hasLdt'],
                ['Missing Photometry', 'missingPhotometry'],
              ] as const
            ).map(([label, key]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })}
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
        </section>
        <section>
          <h3>State</h3>
          <fieldset className="v4-library__state-filters">
            <legend>Lifecycle state</legend>
            {(['ACTIVE', 'ARCHIVED'] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="library-state"
                  checked={draft.status === value}
                  onChange={() => setDraft({ ...draft, status: value })}
                />
                <span>{value === 'ACTIVE' ? 'Active' : 'Archived'}</span>
              </label>
            ))}
          </fieldset>
        </section>
        <footer className="v4-library__popover-actions">
          <V4Button variant="tertiary" size="compact" onClick={() => setDraft(clear())}>
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
            Apply Filters
          </V4Button>
        </footer>
      </V4AnchoredSurface>
    </div>
  );
}
