import { useState } from 'react';
import { studioGenerationFilesSchema } from '@scli/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/environment';
import { V4FloatingWorkspace } from '../../components/common/V4FloatingWorkspace';
import { V4FilterSelect } from '../../components/common/V4FilterSelect';
import { V4Button } from '../../components/common/V4Button';
import { SctPdf, SctExcel, SctSchedule, SctBoq, SctExport } from '../../components/common/SctIcons';
import { isComposableTargetRevision } from '../../components/revisions/canonicalRevisionDisplay';

export type StudioRevisionInput = {
  targetRevisionId: string;
  kind: 'schedule' | 'boq' | 'datasheets';
  format: 'PDF' | 'XLSX';
  selection: string[];
};

export function StudioRevisionDialog({
  projectId,
  specifications,
  initialRevisionId,
  generate,
  onClose,
}: {
  projectId: string;
  specifications: boolean;
  initialRevisionId: string | null;
  generate: (input: StudioRevisionInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const revisions = useQuery({
    queryKey: ['v4', 'studio-revision-targets', projectId],
    queryFn: () => api.projectRevisions(projectId),
  });
  const workspace = useQuery({
    queryKey: ['v4', 'studio-revision-luminaires', projectId],
    queryFn: () => api.projectWorkspace(projectId),
  });
  const [target, setTarget] = useState(initialRevisionId ?? '');
  const [kinds, setKinds] = useState<StudioRevisionInput['kind'][]>(
    specifications ? ['datasheets'] : ['schedule'],
  );
  const [formats, setFormats] = useState<StudioRevisionInput['format'][]>(['PDF']);
  const [selection, setSelection] = useState<string[]>([]);
  const [all, setAll] = useState(true);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<string[]>([]);
  const [files, setFiles] = useState<Array<{ name: string; url: string }>>([]);
  const targets = (revisions.data ?? []).filter(isComposableTargetRevision);
  const rows = workspace.data?.luminaires ?? [];
  const visible = rows.filter((row) =>
    `${row.tag} ${row.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = all ? rows.map((row) => row.id) : selection;
  const valid =
    targets.some((row) => row.revisionId === target) &&
    formats.length > 0 &&
    kinds.length > 0 &&
    (!specifications || selected.length > 0);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      for (const kind of kinds)
        for (const format of formats) {
          const key = `${target}:${kind}:${format}`;
          if (completed.includes(key)) continue;
          const result = await generate({
            targetRevisionId: target,
            kind,
            format,
            selection: specifications ? selected : [],
          });
          const parsed = studioGenerationFilesSchema.safeParse(result);
          if (parsed.success)
            setFiles((current) => [
              ...current,
              ...parsed.data.artifacts.filter(
                (file) =>
                  file.url.startsWith(`/api/projects/${projectId}/luminaire-studio/outputs/`) &&
                  file.url.endsWith('/download') &&
                  !file.url.includes('..'),
              ),
            ]);
          setCompleted((current) => [...current, key]);
        }
      await client.invalidateQueries({ queryKey: ['v4'] });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Generation failed. Completed files remain registered; retry resumes remaining selections.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <V4FloatingWorkspace
      open
      panelClassName="v4-studio-revision-dialog"
      bodyClassName="v4-studio-revision-dialog__body"
      title={specifications ? 'Generate Revision Specifications' : 'Generate Revision Outputs'}
      description="Choose an open Revision. Each generated file is registered in that Revision; closed Revisions cannot be changed."
      onRequestClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <V4Button disabled={busy} onClick={onClose}>
            Close
          </V4Button>
          <V4Button disabled={busy || !valid} onClick={() => void submit()}>
            <SctExport aria-hidden="true" />
            {busy ? 'Generating…' : 'Generate selected files'}
          </V4Button>
        </div>
      }
    >
      {revisions.isPending || workspace.isPending ? (
        <p role="status">Loading available revisions…</p>
      ) : null}
      {revisions.error || workspace.error ? (
        <p role="alert">
          Could not load project data.{' '}
          <button
            onClick={() => {
              void revisions.refetch();
              void workspace.refetch();
            }}
          >
            Retry
          </button>
        </p>
      ) : null}
      <V4FilterSelect
        label="Target Revision"
        value={target}
        disabled={busy}
        onChange={setTarget}
        options={[
          { value: '', label: 'Select an open Revision' },
          ...targets.map((row) => ({ value: row.revisionId, label: row.revisionLabel })),
        ]}
      />
      {!revisions.isPending && targets.length === 0 ? (
        <p>Prepare an open Revision on the Revisions page before generating files.</p>
      ) : null}
      {!specifications ? (
        <fieldset disabled={busy}>
          <legend>Documents</legend>
          {(['schedule', 'boq'] as const).map((kind) => (
            <label key={kind}>
              <input
                type="checkbox"
                checked={kinds.includes(kind)}
                onChange={(event) =>
                  setKinds((current) =>
                    event.target.checked
                      ? [...current, kind]
                      : current.filter((value) => value !== kind),
                  )
                }
              />
              {kind === 'schedule' ? (
                <SctSchedule aria-hidden="true" />
              ) : (
                <SctBoq aria-hidden="true" />
              )}
              {kind === 'schedule' ? 'Luminaire Schedule' : 'Technical BOQ'}
            </label>
          ))}
        </fieldset>
      ) : null}
      <fieldset disabled={busy}>
        <legend>Formats</legend>
        {(['PDF', 'XLSX'] as const).map((format) => (
          <label key={format}>
            <input
              type="checkbox"
              checked={formats.includes(format)}
              onChange={(event) =>
                setFormats((current) =>
                  event.target.checked
                    ? [...current, format]
                    : current.filter((value) => value !== format),
                )
              }
            />
            {format === 'PDF' ? <SctPdf aria-hidden="true" /> : <SctExcel aria-hidden="true" />}
            {format}
          </label>
        ))}
      </fieldset>
      {specifications ? (
        <fieldset disabled={busy}>
          <legend>Luminaires ({selected.length} selected)</legend>
          <label>
            <input
              type="checkbox"
              checked={all}
              onChange={(event) => {
                setAll(event.target.checked);
                setSelection([]);
              }}
            />
            All project luminaires
          </label>
          <label>
            Search luminaires
            <input value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          {visible.map((row) => (
            <label key={row.id} className="v4-studio-revision-dialog__luminaire">
              <input
                type="checkbox"
                checked={selected.includes(row.id)}
                onChange={(event) => {
                  setAll(false);
                  setSelection(
                    event.target.checked
                      ? [...selected, row.id]
                      : selected.filter((id) => id !== row.id),
                  );
                }}
              />
              {row.tag} — {row.description}
            </label>
          ))}
        </fieldset>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {completed.length ? (
        <div role="status">
          <p>{completed.length} file(s) generated and registered successfully.</p>
          <ul>
            {completed.map((key) => (
              <li key={key}>{key.split(':').slice(1).join(' · ')}</li>
            ))}
          </ul>
          {files.map((file) => (
            <p key={file.url}>
              <a href={file.url} download={file.name}>
                Open / download {file.name}
              </a>
            </p>
          ))}
        </div>
      ) : null}
    </V4FloatingWorkspace>
  );
}
