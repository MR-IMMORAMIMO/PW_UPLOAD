import { ChevronDown } from './SctIcons';
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { V4StatusPillVariant } from './V4StatusPill';
import { V4AnchoredSurface } from '../interaction/V4AnchoredSurface';

export type V4FilterSelectOption = {
  value: string;
  label: string;
  /** Optional semantic identity for compact status selectors. */
  tone?: V4StatusPillVariant;
  icon?: ReactNode;
};

type V4FilterSelectProps = {
  label: string;
  value: string;
  options: readonly V4FilterSelectOption[];
  disabled?: boolean;
  variant?: 'filter' | 'status';
  onChange: (value: string) => void;
  triggerStyle?: CSSProperties;
  chevron?: ReactNode;
  searchable?: boolean;
};

/** A deliberately small, themed listbox for Actions filters. */
export function V4FilterSelect({
  label,
  value,
  options,
  disabled = false,
  variant = 'filter',
  onChange,
  triggerStyle,
  chevron,
  searchable = false,
}: V4FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visibleOptions = options.filter(
    (option) => !searchable || option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex] ?? options[0];

  const choose = (next: V4FilterSelectOption) => {
    onChange(next.value);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const move = (offset: number) => {
    const next = options[(selectedIndex + offset + options.length) % options.length];
    if (next) onChange(next.value);
  };
  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex =
        (index + (event.key === 'ArrowDown' ? 1 : -1) + visibleOptions.length) %
        visibleOptions.length;
      const next = visibleOptions[nextIndex];
      if (next) {
        onChange(next.value);
        const options =
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="option"]');
        options?.[nextIndex]?.focus();
      }
    }
  };
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      move(event.key === 'ArrowDown' ? 1 : -1);
    }
    if (event.key === 'Escape') setOpen(false);
  };

  return (
    <div
      className={`v4-filter-select v4-filter-select--${variant}`}
      ref={rootRef}
      style={triggerStyle ? { width: 'auto', minWidth: 0, flex: '0 0 auto' } : undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        className="v4-filter-select__trigger"
        data-tone={selected?.tone}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        style={triggerStyle}
        onClick={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        {selected?.tone ? <i className="v4-filter-select__dot" aria-hidden="true" /> : null}
        {selected?.icon}
        <span>{selected?.label}</span>
        {chevron ?? <ChevronDown aria-hidden="true" />}
      </button>
      <V4AnchoredSurface
        anchorToTrigger
        open={open}
        id={listboxId}
        ownerRef={rootRef}
        triggerRef={triggerRef}
        onRequestClose={() => setOpen(false)}
        className="v4-filter-select__menu"
        role="listbox"
        ariaLabel={label}
      >
        {searchable && (
          <input
            aria-label={`Search ${label.toLowerCase()}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>('[role="option"]')
                  ?.focus();
              }
            }}
          />
        )}
        {visibleOptions.map((option, index) => (
          <button
            key={option.value || '__all'}
            type="button"
            role="option"
            aria-selected={option.value === value}
            data-tone={option.tone}
            onClick={() => choose(option)}
            onKeyDown={(event) => onOptionKeyDown(event, index)}
          >
            {option.tone ? <i className="v4-filter-select__dot" aria-hidden="true" /> : null}
            {option.icon}
            {option.label}
          </button>
        ))}
        {!visibleOptions.length && <p>No matching options</p>}
      </V4AnchoredSurface>
    </div>
  );
}
