import { useState } from 'react';
import type { DatasheetEligibilityItem, ProjectDocument, RevisionDeliverable } from '@scli/domain';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4Button } from '../../components/common/V4Button';
import { SctPdf, SctFile } from '../../components/common/SctIcons';

type SourceTab = 'project-files' | 'datasheets';
export function AddDeliverableDrawer({
  open,
  documents,
  datasheets,
  existing = [],
  revisionLabel = '',
  onClose,
  onAddDocument,
  onAddDatasheet,
  pending,
  error,
}: {
  open: boolean;
  documents: ProjectDocument[];
  datasheets: DatasheetEligibilityItem[];
  existing?: RevisionDeliverable[];
  revisionLabel?: string;
  onClose: () => void;
  onAddDocument: (id: string, title?: string) => Promise<unknown>;
  onAddDatasheet: (id: string) => Promise<unknown>;
  pending: boolean;
  error: string | null;
}) {
  const [tab, setTab] = useState<SourceTab>('project-files');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [done, setDone] = useState<string[]>([]);
  const [displayTitle, setDisplayTitle] = useState('');
  const rows =
    tab === 'project-files'
      ? documents.map((doc) => {
          const added = existing.some(
            (item) => item.sourceType === 'DocumentSnapshot' && item.sourceId === doc.id,
          );
          return {
            id: doc.id,
            name: doc.title || doc.filePath,
            detail: doc.category ?? '',
            file: doc.filePath,
            eligible: !added,
            status: added ? 'Already Added' : 'Available',
            reason: added ? 'This source is already included in the selected Revision.' : '',
          };
        })
      : datasheets.map((item) => ({
          id: item.assetVersionId,
          name: item.tag,
          detail: [item.manufacturer, item.model, 'v' + item.versionSequence].join(' · '),
          file: item.fileName,
          eligible: item.eligible,
          status: statusLabel(item),
          reason: item.reason,
        }));
  const visible = rows.filter((row) =>
    [row.name, row.detail, row.file].join(' ').toLowerCase().includes(search.toLowerCase()),
  );
  const eligible = visible.filter((row) => row.eligible && !done.includes(tab + ':' + row.id));
  const submit = async () => {
    if (busy || pending || !selected.length) return;
    setBusy(true);
    setLocalError('');
    const remaining = [...selected];
    try {
      for (const id of selected) {
        if (!rows.some((row) => row.id === id && row.eligible) || done.includes(tab + ':' + id))
          continue;
        if (tab === 'project-files')
          await onAddDocument(
            id,
            selected.length === 1 ? displayTitle.trim() || undefined : undefined,
          );
        else await onAddDatasheet(id);
        remaining.splice(remaining.indexOf(id), 1);
        setDone((current) => [...current, tab + ':' + id]);
        setSelected([...remaining]);
      }
      setSelected([]);
    } catch (reason) {
      setLocalError(
        reason instanceof Error
          ? reason.message
          : 'Could not add this file. Completed files stay added; retry the remaining selection.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <V4FloatingWorkspace
      open={open}
      title="Add Deliverable"
      description={
        'Selected Revision: ' +
        revisionLabel +
        '. Add immutable copies of registered project files or eligible Datasheets.'
      }
      panelClassName="v4-add-deliverable-float"
      onRequestClose={() => {
        if (!busy && !pending) onClose();
      }}
      dismissible={!busy && !pending}
      footer={
        <div className="v4-deliverables__drawer-footer">
          <span role="status">
            {selected.length} selected · {done.length} added
          </span>
          <V4Button onClick={onClose} disabled={busy || pending}>
            Close
          </V4Button>
          <V4Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!selected.length || busy || pending}
            data-testid="v4-add-deliverable-submit"
          >
            {busy ? 'Adding…' : 'Add selected files'}
          </V4Button>
        </div>
      }
    >
      {localError || error ? (
        <p role="alert" data-testid="v4-add-deliverable-error">
          {localError || error}
        </p>
      ) : null}
      <div role="tablist" aria-label="Source type" className="v4-deliverables__source-tabs">
        {(['project-files', 'datasheets'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            disabled={busy || pending}
            data-testid={'v4-add-deliverable-tab-' + value}
            onClick={() => {
              setTab(value);
              setSelected([]);
              setSearch('');
              setLocalError('');
              setDisplayTitle('');
            }}
          >
            {value === 'project-files' ? 'Project Files' : 'Datasheets'}
          </button>
        ))}
      </div>
      <div className="v4-add-deliverable-toolbar">
        <label>
          Search files
          <input value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="Select all visible available files"
            disabled={busy || pending || !eligible.length}
            checked={eligible.length > 0 && eligible.every((row) => selected.includes(row.id))}
            onChange={(event) =>
              setSelected((current) =>
                event.target.checked
                  ? [...new Set([...current, ...eligible.map((row) => row.id)])]
                  : current.filter((id) => !eligible.some((row) => row.id === id)),
              )
            }
          />
          Select all visible
        </label>
        <V4Button onClick={() => setSelected([])} disabled={busy || pending || !selected.length}>
          Clear selection
        </V4Button>
      </div>
      {tab === 'project-files' && selected.length === 1 ? (
        <label>
          Display title (optional)
          <input
            value={displayTitle}
            onChange={(event) => setDisplayTitle(event.target.value)}
            disabled={busy || pending}
          />
        </label>
      ) : null}
      <div
        className="v4-add-deliverable-list"
        role="group"
        aria-label={tab === 'datasheets' ? 'Datasheets' : 'Project Files'}
      >
        {visible.map((row) => {
          const added = done.includes(tab + ':' + row.id) || row.status === 'Already Added';
          return (
            <label
              key={row.id}
              className="v4-add-deliverable-row"
              title={added ? 'Already added to this Revision.' : row.reason}
            >
              <input
                type="checkbox"
                aria-label={'Select ' + row.name}
                data-testid={tab === 'datasheets' ? 'v4-datasheet-item-' + row.id : undefined}
                checked={selected.includes(row.id)}
                disabled={busy || pending || !row.eligible || added}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, row.id]
                      : current.filter((id) => id !== row.id),
                  )
                }
              />
              {/\.pdf$/i.test(row.file) ? (
                <SctPdf style={{ color: 'var(--v4-danger)' }} />
              ) : (
                <SctFile />
              )}
              <span>
                <strong>{row.name}</strong>
                <small>{row.detail}</small>
                <small>{row.file.split(/[\\/]/).pop()}</small>
              </span>
              <span data-testid={'v4-datasheet-status-' + row.id}>
                {added ? 'Already Added' : row.status}
              </span>
            </label>
          );
        })}
        {!visible.length ? (
          <p>No matching {tab === 'datasheets' ? 'Datasheets' : 'registered project files'}.</p>
        ) : null}
      </div>
    </V4FloatingWorkspace>
  );
}
function statusLabel(item: DatasheetEligibilityItem): string {
  return (
    {
      VERIFIED: 'Available',
      ALREADY_ADDED: 'Already Added',
      LEGACY_UNVERIFIED: 'Legacy Unverified',
      MISSING: 'Missing',
      HASH_MISMATCH: 'Hash Mismatch',
    } as const
  )[item.integrityStatus];
}
