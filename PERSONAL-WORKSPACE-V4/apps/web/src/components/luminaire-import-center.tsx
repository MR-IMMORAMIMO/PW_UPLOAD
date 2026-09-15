import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  FileUp,
  LoaderCircle,
  Upload,
  X,
} from 'lucide-react';
import { api, type LuminaireImportPreviewRow } from '../api';
import { useToast } from './toast';

type ImportAction = 'Add' | 'Update' | 'Ignore' | 'ManualReview';

function defaultAction(row: LuminaireImportPreviewRow): ImportAction {
  if (row.status === 'Added') return 'Add';
  if (row.status === 'Unchanged') return 'Ignore';
  return 'ManualReview';
}

export function LuminaireImportCenter({
  projectId,
  initialSource,
  invalidate,
  onClose,
}: {
  projectId: string;
  initialSource: 'AutoCadCsv' | 'DialuxCsv';
  invalidate: () => Promise<void>;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const [source, setSource] = useState(initialSource);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<LuminaireImportPreviewRow[]>([]);
  const [actions, setActions] = useState<Record<string, ImportAction>>({});
  // For ambiguous rows, the user must explicitly choose ONE existing candidate.
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string | null>>({});
  const preview = useMutation({
    mutationFn: () => api.previewLuminaireImport(projectId, { source, csvText: text }),
    onSuccess: (result) => {
      setRows(result.rows);
      setActions(Object.fromEntries(result.rows.map((row) => [row.rowId, defaultAction(row)])));
      setSelectedTargets(Object.fromEntries(result.rows.map((row) => [row.rowId, row.existingId])));
      showToast(`${result.rows.length} row(s) checked. Nothing has been imported yet.`);
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const commit = useMutation({
    mutationFn: () =>
      api.commitLuminaireImport(projectId, {
        source,
        rows: rows.map((row) => ({
          action: actions[row.rowId] ?? 'ManualReview',
          matchStatus: row.matchStatus,
          existingId: selectedTargets[row.rowId] ?? null,
          record: row.record,
        })),
      }),
    onSuccess: async (result) => {
      await invalidate();
      showToast(
        `Import complete: ${result.added} added, ${result.updated} updated, ${result.ignored} ignored.`,
      );
      onClose();
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });
  const counts = useMemo(
    () =>
      rows.reduce<Record<LuminaireImportPreviewRow['status'], number>>(
        (result, row) => ({ ...result, [row.status]: result[row.status] + 1 }),
        { Added: 0, Changed: 0, Unchanged: 0, Duplicate: 0, Ambiguous: 0 },
      ),
    [rows],
  );
  const mutatingCount = rows.filter((row) =>
    ['Add', 'Update'].includes(actions[row.rowId] ?? ''),
  ).length;

  const bulk = (status: LuminaireImportPreviewRow['status'], action: ImportAction) => {
    setActions((current) => ({
      ...current,
      ...Object.fromEntries(
        rows.filter((row) => row.status === status).map((row) => [row.rowId, action]),
      ),
    }));
  };

  return (
    <div className="operation-modal-backdrop" role="presentation">
      <section className="operation-modal luminaire-import-modal" role="dialog" aria-modal="true">
        <div className="modal-heading">
          <div>
            <span>Safe import preview</span>
            <h2>Luminaire Import Center</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close import">
            <X />
          </button>
        </div>
        <div className="import-source-tabs" role="group" aria-label="Import source">
          <button
            type="button"
            className={source === 'AutoCadCsv' ? 'active' : ''}
            onClick={() => setSource('AutoCadCsv')}
          >
            AutoCAD
          </button>
          <button
            type="button"
            className={source === 'DialuxCsv' ? 'active' : ''}
            onClick={() => setSource('DialuxCsv')}
          >
            DIALux
          </button>
        </div>
        <div className="import-input-grid">
          <label className="import-drop-zone">
            <FileUp />
            <strong>{fileName || 'Choose CSV or TSV file'}</strong>
            <small>AutoCAD schedule, DIALux export or an Excel-saved CSV</small>
            <input
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setFileName(file.name);
                setText(await file.text());
                setRows([]);
              }}
            />
          </label>
          <label className="import-paste-area">
            <span>
              <ClipboardPaste /> Paste from Excel
            </span>
            <textarea
              rows={8}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setRows([]);
              }}
              placeholder={'TAG\tDESCRIPTION\tQUANTITY\tUNIT\nDL01\tAdjustable downlight\t12\tNo.'}
            />
          </label>
        </div>
        <div className="import-preview-actions">
          <p>
            Preview classifies every row as Added, Changed, Unchanged or Duplicate. Existing data is
            never overwritten unless you explicitly choose Update.
          </p>
          <button
            className="button primary"
            type="button"
            disabled={!text.trim() || preview.isPending}
            onClick={() => preview.mutate()}
          >
            {preview.isPending ? <LoaderCircle className="spin" /> : <Upload />} Preview Import
          </button>
        </div>

        {rows.length ? (
          <>
            <div className="import-counts">
              {Object.entries(counts).map(([status, value]) => (
                <span className={`import-${status.toLowerCase()}`} key={status}>
                  <strong>{value}</strong> {status}
                </span>
              ))}
            </div>
            <div className="import-bulk-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => bulk('Added', 'Add')}
              >
                Add all new
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => bulk('Changed', 'Update')}
              >
                Update all changed
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() =>
                  setActions(Object.fromEntries(rows.map((row) => [row.rowId, 'Ignore'])))
                }
              >
                Ignore all
              </button>
            </div>
            <div className="table-shell import-preview-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Tag</th>
                    <th>Description / Model</th>
                    <th>Qty / Unit</th>
                    <th>Changed fields</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.rowId}>
                      <td>
                        <span className={`import-state import-${row.status.toLowerCase()}`}>
                          {row.status === 'Added' || row.status === 'Unchanged' ? (
                            <CheckCircle2 />
                          ) : (
                            <AlertTriangle />
                          )}
                          {row.status}
                        </span>
                      </td>
                      <td>
                        <strong>{row.record.tag}</strong>
                      </td>
                      <td>
                        <strong>{row.record.description || '—'}</strong>
                        <span>
                          {row.record.manufacturer ?? ''} {row.record.model ?? ''}
                        </span>
                      </td>
                      <td>
                        {row.record.quantity ?? ''} {row.record.unit ?? ''}
                      </td>
                      <td>{row.changedFields.join(', ') || '—'}</td>
                      <td>
                        <div className="import-decision">
                          <select
                            value={actions[row.rowId] ?? defaultAction(row)}
                            onChange={(event) =>
                              setActions({
                                ...actions,
                                [row.rowId]: event.target.value as ImportAction,
                              })
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
                            <label className="import-candidate-picker">
                              <span>Update luminaire</span>
                              <select
                                aria-label={`Choose existing luminaire for ${row.record.tag}`}
                                value={selectedTargets[row.rowId] ?? ''}
                                onChange={(event) => {
                                  const target = event.target.value || null;
                                  setSelectedTargets({
                                    ...selectedTargets,
                                    [row.rowId]: target,
                                  });
                                  // Choosing a candidate resolves the ambiguity:
                                  // the row becomes an explicit Update target.
                                  if (target) {
                                    setActions({ ...actions, [row.rowId]: 'Update' });
                                  }
                                }}
                              >
                                <option value="">Select a luminaire…</option>
                                {row.candidates.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.tag} · {candidate.manufacturer || '—'}{' '}
                                    {candidate.model || '—'} · {candidate.wattage || '—'}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="import-commit-bar">
              <span>{mutatingCount} row(s) will change · a safety backup is created first</span>
              <button
                className="button primary"
                type="button"
                disabled={!mutatingCount || commit.isPending}
                onClick={() => commit.mutate()}
              >
                {commit.isPending ? <LoaderCircle className="spin" /> : <Upload />} Apply Selected
                Changes
              </button>
            </footer>
          </>
        ) : null}
      </section>
    </div>
  );
}
