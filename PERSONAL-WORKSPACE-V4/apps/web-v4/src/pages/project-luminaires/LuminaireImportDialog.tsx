import { useMemo, useState } from 'react';
import {
  SctWarning as AlertTriangle,
  SctSuccess as CheckCircle2,
} from '../../components/common/SctIcons';
import { LoaderCircle, Upload, X } from '../../components/common/SctIcons';
import type { LuminaireImportPreviewRow } from '@scli/api-client';
import { api } from '../../api/environment';

type ImportAction = 'Add' | 'Update' | 'Ignore' | 'ManualReview';
const defaultAction = (row: LuminaireImportPreviewRow): ImportAction =>
  row.status === 'Added' ? 'Add' : row.status === 'Unchanged' ? 'Ignore' : 'ManualReview';

export function LuminaireImportDialog({
  projectId,
  initialSource,
  onClose,
  onCommitted,
}: {
  projectId: string;
  initialSource: 'AutoCadCsv' | 'DialuxCsv';
  onClose: () => void;
  onCommitted: () => Promise<void>;
}) {
  const [source, setSource] = useState(initialSource);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<LuminaireImportPreviewRow[]>([]);
  const [actions, setActions] = useState<Record<string, ImportAction>>({});
  const [targets, setTargets] = useState<Record<string, string | null>>({});
  const [pending, setPending] = useState<'preview' | 'commit' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mutationCount = useMemo(
    () => rows.filter((row) => ['Add', 'Update'].includes(actions[row.rowId] ?? '')).length,
    [actions, rows],
  );

  const preview = async () => {
    setPending('preview');
    setMessage(null);
    try {
      const result = await api.previewLuminaireImport(projectId, { source, csvText });
      setRows(result.rows);
      setActions(Object.fromEntries(result.rows.map((row) => [row.rowId, defaultAction(row)])));
      setTargets(Object.fromEntries(result.rows.map((row) => [row.rowId, row.existingId])));
      setMessage(`${result.rows.length} row(s) checked. Nothing has been imported yet.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import preview failed.');
    } finally {
      setPending(null);
    }
  };
  const commit = async () => {
    setPending('commit');
    setMessage(null);
    try {
      const result = await api.commitLuminaireImport(projectId, {
        source,
        rows: rows.map((row) => ({
          action: actions[row.rowId] ?? 'ManualReview',
          matchStatus: row.matchStatus,
          existingId: targets[row.rowId] ?? null,
          record: row.record,
        })),
      });
      await onCommitted();
      setMessage(
        `Import complete: ${result.added} added, ${result.updated} updated, ${result.ignored} ignored.`,
      );
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="v4-luminaires__modal-backdrop" role="presentation">
      <section
        className="v4-luminaires__import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Luminaire Import"
      >
        <header>
          <div>
            <span>Preview → Commit</span>
            <h2>Luminaire Import</h2>
          </div>
          <button type="button" aria-label="Close import" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="v4-luminaires__import-source" role="group" aria-label="Import source">
          <button
            type="button"
            aria-pressed={source === 'AutoCadCsv'}
            onClick={() => setSource('AutoCadCsv')}
          >
            AutoCAD CSV
          </button>
          <button
            type="button"
            aria-pressed={source === 'DialuxCsv'}
            onClick={() => setSource('DialuxCsv')}
          >
            DIALux CSV
          </button>
        </div>
        <label className="v4-luminaires__import-file">
          <Upload aria-hidden="true" />
          <strong>{fileName || 'Choose CSV or TSV file'}</strong>
          <input
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setCsvText(await file.text());
              setRows([]);
            }}
          />
        </label>
        <label className="v4-luminaires__import-paste">
          <span>Or paste CSV / TSV data</span>
          <textarea
            rows={6}
            value={csvText}
            onChange={(event) => {
              setCsvText(event.target.value);
              setRows([]);
            }}
          />
        </label>
        <div className="v4-luminaires__import-preview-action">
          <p>Preview classifies rows before any data changes.</p>
          <button
            type="button"
            className="v4-luminaires__primary"
            disabled={!csvText.trim() || pending !== null}
            onClick={() => void preview()}
          >
            {pending === 'preview' ? <LoaderCircle className="v4-luminaires__spin" /> : <Upload />}{' '}
            Preview Import
          </button>
        </div>
        {message ? (
          <p className="v4-luminaires__import-message" role="status">
            {message}
          </p>
        ) : null}
        {rows.length ? (
          <div className="v4-luminaires__import-table">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Tag</th>
                  <th>Description / Model</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowId}>
                    <td>
                      {row.status === 'Added' || row.status === 'Unchanged' ? (
                        <CheckCircle2 />
                      ) : (
                        <AlertTriangle />
                      )}
                      {row.status}
                    </td>
                    <td>
                      <strong>{row.record.tag}</strong>
                    </td>
                    <td>{row.record.description || row.record.model || '—'}</td>
                    <td>
                      <select
                        aria-label={`Import decision for ${row.record.tag}`}
                        value={actions[row.rowId] ?? defaultAction(row)}
                        onChange={(event) =>
                          setActions((current) => ({
                            ...current,
                            [row.rowId]: event.target.value as ImportAction,
                          }))
                        }
                      >
                        <option value="Add" disabled={Boolean(row.existingId)}>
                          Add
                        </option>
                        <option value="Update" disabled={!row.existingId}>
                          Update
                        </option>
                        <option value="Ignore">Ignore</option>
                        <option value="ManualReview">Manual review</option>
                      </select>
                      {row.status === 'Ambiguous' ? (
                        <select
                          aria-label={`Choose existing luminaire for ${row.record.tag}`}
                          value={targets[row.rowId] ?? ''}
                          onChange={(event) => {
                            const target = event.target.value || null;
                            setTargets((current) => ({ ...current, [row.rowId]: target }));
                            if (target)
                              setActions((current) => ({ ...current, [row.rowId]: 'Update' }));
                          }}
                        >
                          <option value="">Select luminaire…</option>
                          {row.candidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.tag} · {candidate.manufacturer || '—'}{' '}
                              {candidate.model || '—'}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <footer>
          <span>{mutationCount} row(s) will change</span>
          <button
            type="button"
            className="v4-luminaires__primary"
            disabled={!mutationCount || pending !== null}
            onClick={() => void commit()}
          >
            {pending === 'commit' ? <LoaderCircle className="v4-luminaires__spin" /> : <Upload />}{' '}
            Apply Selected Changes
          </button>
        </footer>
      </section>
    </div>
  );
}
