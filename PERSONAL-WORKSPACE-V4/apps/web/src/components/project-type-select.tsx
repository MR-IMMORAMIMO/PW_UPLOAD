import type { ProjectType } from '@scli/domain';

interface ProjectTypeSelectProps {
  value: string;
  catalogue: ProjectType[] | undefined;
  loading?: boolean;
  error?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function ProjectTypeSelect({
  value,
  catalogue,
  loading = false,
  error = false,
  disabled = false,
  onChange,
}: ProjectTypeSelectProps) {
  const currentEntry = catalogue?.find((candidate) => candidate.name === value);
  const activeTypes = catalogue?.filter((candidate) => candidate.isActive) ?? [];
  const currentIsActive = currentEntry?.isActive === true;
  const currentNeedsHistoricalOption = !currentIsActive;
  const noActiveTypes = catalogue !== undefined && activeTypes.length === 0;

  let currentLabel = value;
  if (catalogue !== undefined && currentNeedsHistoricalOption) {
    currentLabel = currentEntry
      ? `${value} — Current / Inactive`
      : `${value} — Historical / Not in catalogue`;
  }

  return (
    <label className="field">
      Project Type<span className="required">Required</span>
      <span className="select-wrap">
        <select
          value={value}
          disabled={disabled || loading || error || noActiveTypes}
          onChange={(event) => onChange(event.target.value)}
        >
          {currentNeedsHistoricalOption ? <option value={value}>{currentLabel}</option> : null}
          {activeTypes.map((projectType) => (
            <option key={projectType.id} value={projectType.name}>
              {projectType.name}
            </option>
          ))}
        </select>
      </span>
      {loading ? <small>Loading configured Project Types…</small> : null}
      {error ? (
        <small>The catalogue could not be loaded. The current value will be preserved.</small>
      ) : null}
      {!loading && !error && currentEntry && !currentEntry.isActive ? (
        <small>
          This historical value is inactive. Choose an active Project Type to replace it.
        </small>
      ) : null}
      {!loading && !error && catalogue !== undefined && !currentEntry ? (
        <small>
          This historical value is not in the catalogue. Choose an active Project Type to replace
          it.
        </small>
      ) : null}
      {!loading && !error && noActiveTypes ? (
        <small>
          No active Project Types are available. You can still save other project details.
        </small>
      ) : null}
    </label>
  );
}
