import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  File,
  FileArchive,
  FolderOpen,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  revisionPackageGroups,
  type RevisionPackageGroup,
  type RevisionPackageOutputMode,
  type RevisionPackageRecord,
} from '@scli/domain';
import { api } from '../api';
import { desktop } from '../desktop';
import { useToast } from './toast';
import { EmptyState, LoadingState, SectionHeading, formatDate } from './ui';

const groupLabels: Record<RevisionPackageGroup, string> = {
  SchedulePdf: 'Luminaire Schedule PDF',
  ScheduleExcel: 'Luminaire Schedule Excel',
  TechnicalBoqPdf: 'Technical BOQ PDF',
  TechnicalBoqExcel: 'Technical BOQ Excel',
  LayoutDrawings: 'Lighting Layout Drawings',
  DialuxReports: 'DIALux Reports',
  Renderings: 'Renderings',
  Datasheets: 'Datasheets',
  MeetingMinutes: 'Meeting Minutes',
  CommentResponse: 'Comment Response Sheet',
  RevisionRegister: 'Revision Register',
  IssueSummary: 'Issue Summary',
  CoverSheet: 'Cover Sheet',
  Documents: 'Documents',
};

function fileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function RevisionPackageBuilder({
  projectId,
  records,
  invalidate,
}: {
  projectId: string;
  records: RevisionPackageRecord[];
  invalidate: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const catalogQuery = useQuery({
    queryKey: ['revision-package-catalog', projectId],
    queryFn: () => api.revisionPackageCatalog(projectId),
  });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [form, setForm] = useState({
    revisionNumber: 1,
    reissueNumber: 0,
    label: 'Revision 01',
    status: 'Draft' as 'Draft' | 'Issued',
    outputMode: 'Both' as RevisionPackageOutputMode,
    relativeOutputFolder: 'ISSUED/REV_01',
    warningOverrideReason: '',
  });
  const [initialized, setInitialized] = useState(false);
  const [comparisonIds, setComparisonIds] = useState({ from: '', to: '' });
  useEffect(() => {
    if (records.length < 2 || comparisonIds.from || comparisonIds.to) return;
    setComparisonIds({ from: records[1]!.id, to: records[0]!.id });
  }, [comparisonIds.from, comparisonIds.to, records]);
  const comparisonQuery = useQuery({
    queryKey: ['revision-package-comparison', projectId, comparisonIds],
    queryFn: () => api.compareRevisionPackages(projectId, comparisonIds.from, comparisonIds.to),
    enabled: Boolean(
      comparisonIds.from && comparisonIds.to && comparisonIds.from !== comparisonIds.to,
    ),
  });

  useEffect(() => {
    if (!catalogQuery.data || initialized) return;
    const revision = catalogQuery.data.suggestedRevision;
    setForm((current) => ({
      ...current,
      revisionNumber: revision,
      label: `Revision ${String(revision).padStart(2, '0')}`,
      relativeOutputFolder: catalogQuery.data.suggestedOutputFolder,
    }));
    setInitialized(true);
  }, [catalogQuery.data, initialized]);

  const chosenItems = useMemo(
    () => catalogQuery.data?.items.filter((item) => selected.has(item.id)) ?? [],
    [catalogQuery.data, selected],
  );
  const totalBytes = chosenItems.reduce((sum, item) => sum + item.sizeBytes, 0);
  const blockingChecks =
    catalogQuery.data?.checks.filter((check) => !check.passed && check.severity === 'Blocking') ??
    [];
  const warningChecks =
    catalogQuery.data?.checks.filter((check) => !check.passed && check.severity === 'Warning') ??
    [];
  const hasWarnings = warningChecks.length > 0 || chosenItems.some((item) => item.outdated);

  const createMutation = useMutation({
    mutationFn: () =>
      api.createRevisionPackage(projectId, {
        ...form,
        selectedItemIds: [...selected],
      }),
    onSuccess: async (record) => {
      setSelected(new Set());
      await Promise.all([invalidate(), catalogQuery.refetch()]);
      showToast(
        `${record.label} created with ${record.itemCount} selected file(s). Next package starts empty.`,
      );
      const outputPath = record.folderPath || record.zipPath;
      if (outputPath && desktop.available()) void desktop.openPath(outputPath);
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  if (catalogQuery.isLoading) {
    return (
      <section className="content-card package-builder-loading">
        <LoaderCircle className="spin" /> Preparing package files…
      </section>
    );
  }
  if (catalogQuery.error || !catalogQuery.data) {
    return (
      <section className="content-card">
        <EmptyState
          title="Package files could not be checked"
          description={(catalogQuery.error as Error)?.message ?? 'Try refreshing the project.'}
          action={
            <button className="button secondary" onClick={() => void catalogQuery.refetch()}>
              <RefreshCw /> Retry
            </button>
          }
        />
      </section>
    );
  }

  return (
    <div className="revision-package-layout">
      <section className="content-card package-builder-main">
        <SectionHeading
          title="Revision Package Builder"
          detail="Nothing is selected automatically. Choose only the exact files to issue."
        />
        <div className="package-summary-strip">
          <span>
            <PackageCheck /> <strong>{selected.size}</strong> selected
          </span>
          <span>
            <Archive /> <strong>{fileSize(totalBytes)}</strong> total
          </span>
          <button className="button secondary" type="button" onClick={() => setSelected(new Set())}>
            Clear all
          </button>
        </div>

        <div className="package-groups">
          {revisionPackageGroups.map((group) => {
            const items = catalogQuery.data.items.filter((item) => item.group === group);
            const availableIds = items.filter((item) => item.available).map((item) => item.id);
            const allSelected =
              availableIds.length > 0 && availableIds.every((itemId) => selected.has(itemId));
            return (
              <article className="package-group" key={group}>
                <header>
                  <div>
                    <strong>{groupLabels[group]}</strong>
                    <small>
                      {items.filter((item) => item.available).length} available ·{' '}
                      {items.filter((item) => !item.available).length} missing
                    </small>
                  </div>
                  <button
                    className="text-link-button"
                    type="button"
                    disabled={!availableIds.length}
                    onClick={() => {
                      const next = new Set(selected);
                      for (const itemId of availableIds) {
                        if (allSelected) next.delete(itemId);
                        else next.add(itemId);
                      }
                      setSelected(next);
                    }}
                  >
                    {allSelected ? 'Clear group' : 'Select available'}
                  </button>
                </header>
                <div className="package-file-list">
                  {items.map((item) => (
                    <label
                      className={`package-file${item.available ? '' : ' unavailable'}${
                        item.outdated ? ' outdated' : ''
                      }`}
                      key={item.id}
                    >
                      <input
                        type="checkbox"
                        disabled={!item.available}
                        checked={selected.has(item.id)}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setSelected(next);
                        }}
                      />
                      <span className="package-file-icon">
                        <File />
                      </span>
                      <span className="package-file-copy">
                        <strong>{item.label}</strong>
                        <small title={item.fileName || item.note}>
                          {item.fileName || item.note}
                        </small>
                        {item.modifiedAt ? (
                          <small>
                            {fileSize(item.sizeBytes)} · updated{' '}
                            {formatDate(item.modifiedAt, { month: 'short', day: 'numeric' })}
                          </small>
                        ) : null}
                      </span>
                      <span className={`file-state ${item.available ? 'available' : 'missing'}`}>
                        {item.available ? <CheckCircle2 /> : <XCircle />}
                        {item.available ? (item.outdated ? 'Outdated' : 'Available') : 'Missing'}
                      </span>
                    </label>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
        <section className="package-history-section">
          <SectionHeading
            title="Package history"
            detail={`${records.length} immutable package record(s) · new selections always start empty`}
          />
          {records.length ? (
            <div className="package-history-list">
              {records.map((record) => (
                <article key={record.id}>
                  <span className="revision-number">
                    R{String(record.revisionNumber).padStart(2, '0')}
                    {record.reissueNumber ? `.${record.reissueNumber}` : ''}
                  </span>
                  <div>
                    <strong>{record.label}</strong>
                    <small>
                      {record.status} · {record.itemCount} files · {fileSize(record.totalBytes)} ·{' '}
                      {formatDate(record.createdAt)}
                    </small>
                  </div>
                  <div className="row-actions">
                    {record.folderPath ? (
                      <button
                        className="icon-button"
                        type="button"
                        title="Open package folder"
                        onClick={() => void desktop.openPath(record.folderPath)}
                      >
                        <FolderOpen />
                      </button>
                    ) : null}
                    {record.zipPath ? (
                      <button
                        className="icon-button"
                        type="button"
                        title="Open ZIP package"
                        onClick={() => void desktop.openPath(record.zipPath)}
                      >
                        <FileArchive />
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No revision packages yet"
              description="Select files above to create the first draft or issued package."
            />
          )}
        </section>
        {records.length >= 2 ? (
          <section className="revision-comparison-section">
            <SectionHeading
              title="Compare revision packages"
              detail="Added, removed and changed luminaire data using your comparison fields"
            />
            <div className="revision-compare-controls">
              <label>
                From
                <select
                  value={comparisonIds.from}
                  onChange={(event) =>
                    setComparisonIds({ ...comparisonIds, from: event.target.value })
                  }
                >
                  {records.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                To
                <select
                  value={comparisonIds.to}
                  onChange={(event) =>
                    setComparisonIds({ ...comparisonIds, to: event.target.value })
                  }
                >
                  {records.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {comparisonQuery.data ? (
              <>
                <div className="comparison-counts">
                  <span>
                    <strong>{comparisonQuery.data.added}</strong> Added
                  </span>
                  <span>
                    <strong>{comparisonQuery.data.removed}</strong> Removed
                  </span>
                  <span>
                    <strong>{comparisonQuery.data.changed}</strong> Changed
                  </span>
                </div>
                <div className="comparison-list">
                  {comparisonQuery.data.items.map((item) => (
                    <article key={`${item.status}-${item.tag}`}>
                      <span className={`comparison-status ${item.status.toLowerCase()}`}>
                        {item.status}
                      </span>
                      <strong>{item.tag}</strong>
                      <div>
                        {item.changes.map((change) => (
                          <small key={change.fieldKey}>
                            <b>{change.fieldKey}</b>: {String(change.before) || '—'} →{' '}
                            {String(change.after) || '—'}
                          </small>
                        ))}
                      </div>
                    </article>
                  ))}
                  {!comparisonQuery.data.items.length ? (
                    <p className="muted-copy">No luminaire changes between these packages.</p>
                  ) : null}
                </div>
              </>
            ) : comparisonQuery.isLoading ? (
              <LoadingState label="Comparing package snapshots…" />
            ) : null}
          </section>
        ) : null}
      </section>

      <aside className="operations-side-stack package-builder-side">
        <section className="content-card">
          <div className="settings-card-title">
            <ShieldCheck />
            <div>
              <h2>Ready to Issue</h2>
              <p>Blocking checks cannot be overridden.</p>
            </div>
          </div>
          <div className="package-check-list">
            {catalogQuery.data.checks.map((check) => (
              <div
                className={check.passed ? 'passed' : check.severity.toLowerCase()}
                key={check.key}
              >
                {check.passed ? <CheckCircle2 /> : <AlertTriangle />}
                <span>
                  <strong>{check.label}</strong>
                  <small>{check.detail}</small>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="content-card operations-editor">
          <div className="operations-editor-title">
            <FileArchive />
            <div>
              <strong>Package settings</strong>
              <small>Folder, ZIP, revision and issue status</small>
            </div>
          </div>
          <div className="compact-form">
            <div className="compact-form-grid">
              <label>
                Revision
                <input
                  type="number"
                  min="0"
                  value={form.revisionNumber}
                  onChange={(event) =>
                    setForm({ ...form, revisionNumber: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Reissue
                <input
                  type="number"
                  min="0"
                  value={form.reissueNumber}
                  onChange={(event) =>
                    setForm({ ...form, reissueNumber: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <label>
              Package label
              <input
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
              />
            </label>
            <label>
              Package status
              <select
                value={form.status}
                onChange={(event) =>
                  setForm({ ...form, status: event.target.value as 'Draft' | 'Issued' })
                }
              >
                <option value="Draft">Draft / working package</option>
                <option value="Issued">Final issued package</option>
              </select>
            </label>
            <label>
              Output
              <select
                value={form.outputMode}
                onChange={(event) =>
                  setForm({ ...form, outputMode: event.target.value as RevisionPackageOutputMode })
                }
              >
                <option value="Folder">Folder only</option>
                <option value="Zip">ZIP only</option>
                <option value="Both">Folder + ZIP</option>
              </select>
            </label>
            <label>
              Project-relative location
              <input
                value={form.relativeOutputFolder}
                onChange={(event) => setForm({ ...form, relativeOutputFolder: event.target.value })}
                placeholder="ISSUED/REV_02"
              />
              <small>Saved inside this project — never in a generic EXPORT folder.</small>
            </label>
            {form.status === 'Issued' && hasWarnings ? (
              <label>
                Warning override reason
                <textarea
                  rows={3}
                  required
                  value={form.warningOverrideReason}
                  onChange={(event) =>
                    setForm({ ...form, warningOverrideReason: event.target.value })
                  }
                  placeholder="Explain why the warning is acceptable for this issue…"
                />
              </label>
            ) : null}
            {form.status === 'Issued' && blockingChecks.length ? (
              <div className="package-blocker-note">
                <AlertTriangle /> Resolve {blockingChecks.length} blocking check(s) before issue.
              </div>
            ) : null}
            <button
              className="button primary"
              type="button"
              disabled={
                createMutation.isPending ||
                selected.size === 0 ||
                !form.label.trim() ||
                !form.relativeOutputFolder.trim() ||
                (form.status === 'Issued' && blockingChecks.length > 0) ||
                (form.status === 'Issued' && hasWarnings && !form.warningOverrideReason.trim())
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <LoaderCircle className="spin" /> : <PackageCheck />}{' '}
              Create {form.status} Package
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}
