import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { confirmDatasheetFieldSchema } from '@scli/contracts';
import { api } from '../../api/environment';
import type { TechnicalCheckRow } from './technicalCheckViewModel';

export function DatasheetFieldConfirmation({
  projectId,
  luminaireId,
  row,
  evidenceSeen,
  onSaved,
  identityMismatch = false,
}: {
  projectId: string;
  luminaireId: string;
  row: Pick<
    TechnicalCheckRow,
    'datasheetValue' | 'verificationFingerprint' | 'pageNumber' | 'fieldKey'
  >;
  evidenceSeen: boolean;
  identityMismatch?: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(row.datasheetValue);
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [acceptIdentity, setAcceptIdentity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const cache = useQueryClient();
  if (!row.verificationFingerprint || !row.pageNumber) return null;
  return (
    <details className="v4-datasheet-confirmation">
      <summary>Confirm value from Datasheet</summary>
      <p>
        Save a reviewed reading for this file version. Project and Library values stay unchanged.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!checked || !evidenceSeen || busy) return;
          const input = confirmDatasheetFieldSchema.safeParse({
            fieldKey: row.fieldKey,
            acceptIdentityMismatch: identityMismatch && acceptIdentity,
            value,
            note,
            pageNumber: row.pageNumber,
            verificationFingerprint: row.verificationFingerprint,
            operationId,
          });
          if (!input.success) {
            setError('Enter one value and a review note.');
            return;
          }
          setBusy(true);
          setError('');
          try {
            await api.confirmLuminaireDatasheetField(projectId, luminaireId, input.data);
            await cache.invalidateQueries({ queryKey: ['v4'] });
            onSaved();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'The review could not be saved.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Reviewed Datasheet value
          <input
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setOperationId(crypto.randomUUID());
              setChecked(false);
            }}
            maxLength={200}
            required
            disabled={busy}
          />
        </label>
        <label>
          Review note
          <input
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setOperationId(crypto.randomUUID());
            }}
            maxLength={500}
            required
            disabled={busy}
          />
        </label>
        <label className="v4-datasheet-confirmation__check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            disabled={busy || !evidenceSeen}
          />
          I checked this value against the displayed PDF page.
        </label>
        {identityMismatch && (
          <label className="v4-datasheet-confirmation__check">
            <input
              type="checkbox"
              checked={acceptIdentity}
              disabled={busy || !evidenceSeen}
              onChange={(event) => {
                setAcceptIdentity(event.target.checked);
                setOperationId(crypto.randomUUID());
              }}
            />
            I confirm this Datasheet belongs to this luminaire, even if its identity differs from
            the Project. Allow this reviewed field to be used.
          </label>
        )}
        {!evidenceSeen ? <p>Open View Evidence before confirming.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" className="is-primary" disabled={busy || !evidenceSeen || !checked}>
          {busy ? 'Saving review…' : 'Save reviewed reading'}
        </button>
      </form>
    </details>
  );
}
