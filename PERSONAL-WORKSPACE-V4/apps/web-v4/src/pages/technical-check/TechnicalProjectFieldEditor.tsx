import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LuminaireRecord } from '@scli/domain';
import { api } from '../../api/environment';
import { technicalFieldOptions } from './technicalCheckViewModel';

/** Uses the normal Project edit contract, including row version and Library protections. */
export function TechnicalProjectFieldEditor({
  luminaire,
  onSaved,
  selectedField,
  onDirtyChange,
}: {
  luminaire: LuminaireRecord;
  onSaved: () => void;
  selectedField?: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const selectedOption = technicalFieldOptions.find((option) => option.value === selectedField);
  const [field, setField] = useState(selectedOption?.value ?? technicalFieldOptions[0]!.value);
  const [value, setValue] = useState(String(luminaire[field] ?? ''));
  const [baseline, setBaseline] = useState(String(luminaire[field] ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const cache = useQueryClient();
  useEffect(() => {
    onDirtyChange?.(!saved && value !== baseline);
  }, [value, saved, baseline, onDirtyChange]);
  useEffect(() => {
    if (value === baseline || saved) {
      const latest = String(luminaire[field] ?? '');
      setValue(latest);
      setBaseline(latest);
    }
  }, [luminaire, field, baseline, value, saved]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  if (selectedField && !selectedOption)
    return (
      <p>This result has no editable Project field. Select a technical field to edit its value.</p>
    );
  return (
    <details className="v4-datasheet-confirmation">
      <summary>Edit Project value here</summary>
      <p>
        Save a Project field directly. No Datasheet is required. Library-controlled fields remain
        protected.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          setSaved(false);
          try {
            await api.updateProjectTechnicalField(luminaire.projectId, luminaire.id, {
              fieldKey: field,
              value,
              expectedRowVersion: luminaire.rowVersion,
            });
            await cache.invalidateQueries({ queryKey: ['v4'] });
            setSaved(true);
            onSaved();
          } catch (failure) {
            setError(
              failure instanceof Error ? failure.message : 'The Project value could not be saved.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Project field
          <select
            value={field}
            disabled={busy || Boolean(selectedField)}
            onChange={(event) => {
              const next = technicalFieldOptions.find(
                (option) => option.value === event.target.value,
              )!.value;
              setField(next);
              setValue(String(luminaire[next] ?? ''));
              setBaseline(String(luminaire[next] ?? ''));
            }}
          >
            {technicalFieldOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project value
          <input
            value={value}
            disabled={busy}
            maxLength={500}
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        {saved ? <p role="status">Project value saved.</p> : null}
        <button type="submit" className="is-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save Project value'}
        </button>
      </form>
    </details>
  );
}
